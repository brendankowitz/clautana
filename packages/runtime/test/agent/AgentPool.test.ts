import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeEvent } from "@clautana/protocol";
import { EventLog } from "../../src/events/EventLog.js";
import { EventBus } from "../../src/events/EventBus.js";
import { FakeBackend } from "../../src/backend/FakeBackend.js";
import { ConfigManager } from "../../src/project/ConfigManager.js";
import { AgentPool } from "../../src/agent/AgentPool.js";
import type { AgentBackend, BackendCapabilities } from "../../src/backend/AgentBackend.js";

const CAPABILITIES: BackendCapabilities = { mcp: true, interrupt: true, cost: true };

/** A backend whose dispose() is observable/controllable, for lifecycle tests. */
function makeTrackedBackend(options: { failDispose?: boolean } = {}): {
  backend: AgentBackend;
  disposed: () => boolean;
} {
  let disposed = false;
  const backend: AgentBackend = {
    capabilities: CAPABILITIES,
    async *run() {
      // no events
    },
    async dispose() {
      disposed = true;
      if (options.failDispose) {
        throw new Error("dispose failed");
      }
    },
  };
  return { backend, disposed: () => disposed };
}

let dir: string;
let log: EventLog;
let bus: EventBus;
let config: ConfigManager;
let seen: RuntimeEvent[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clautana-pool-"));
  log = await EventLog.open(dir, "run-1");
  bus = new EventBus(log);
  config = new ConfigManager(dir);
  await config.initialize();
  seen = [];
  await bus.subscribe(0, (event) => seen.push(event));
});

afterEach(async () => {
  await log.close();
  await rm(dir, { recursive: true, force: true });
});

function makePool(): AgentPool {
  return new AgentPool({ bus, backendFactory: () => new FakeBackend([]) });
}

describe("AgentPool", () => {
  it("spawns an agent and returns its id", async () => {
    const pool = makePool();
    const agentId = await pool.spawn({ projectId: "p1", config, profile: "default" });
    expect(agentId).toMatch(/\S/);
    expect(pool.get(agentId)).toBeDefined();
  });

  it("publishes agent.spawned", async () => {
    const pool = makePool();
    await pool.spawn({ projectId: "p1", config, profile: "default" });

    const spawned = seen.find((e) => e.type === "agent.spawned");
    expect(spawned).toBeDefined();
    expect((spawned as { profile: string }).profile).toBe("default");
  });

  it("gives each agent a distinct id", async () => {
    const pool = makePool();
    const a = await pool.spawn({ projectId: "p1", config, profile: "default" });
    const b = await pool.spawn({ projectId: "p1", config, profile: "default" });
    expect(a).not.toBe(b);
    expect(pool.activeCount).toBe(2);
  });

  it("rejects an unknown profile, listing the available profiles", async () => {
    const pool = makePool();
    await expect(
      pool.spawn({ projectId: "p1", config, profile: "does-not-exist" }),
    ).rejects.toThrow(/unknown profile.*default/is);
  });

  it("passes the project root as the backend working directory", async () => {
    let received: string | undefined;
    const pool = new AgentPool({
      bus,
      backendFactory: (backendConfig) => {
        received = backendConfig.workingDirectory;
        return new FakeBackend([]);
      },
    });
    await pool.spawn({ projectId: "p1", config, profile: "default" });
    expect(received).toBe(dir);
  });

  it("passes a profile's model and effort through to the backend config", async () => {
    const agentsDir = join(config.agentsDir);
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, "coder.json"),
      JSON.stringify({
        name: "Coder",
        role: "engineer",
        focus: "implementation",
        model: "claude-opus-4-8",
        effort: "xhigh",
      }),
      "utf8",
    );

    let received: { model?: string; effort?: string } | undefined;
    const pool = new AgentPool({
      bus,
      backendFactory: (backendConfig) => {
        received = { model: backendConfig.model, effort: backendConfig.effort };
        return new FakeBackend([]);
      },
    });
    await pool.spawn({ projectId: "p1", config, profile: "coder" });

    expect(received).toEqual({ model: "claude-opus-4-8", effort: "xhigh" });
  });

  it("leaves model and effort undefined when a profile omits them", async () => {
    let received: { model?: string; effort?: string } | undefined;
    const pool = new AgentPool({
      bus,
      backendFactory: (backendConfig) => {
        received = { model: backendConfig.model, effort: backendConfig.effort };
        return new FakeBackend([]);
      },
    });
    await pool.spawn({ projectId: "p1", config, profile: "default" });

    expect(received?.model).toBeUndefined();
  });

  it("killAll empties the pool", async () => {
    const pool = makePool();
    await pool.spawn({ projectId: "p1", config, profile: "default" });
    await pool.spawn({ projectId: "p1", config, profile: "default" });

    await pool.killAll();

    expect(pool.activeCount).toBe(0);
  });

  it("returns undefined for an unknown agent id", () => {
    expect(makePool().get("nope")).toBeUndefined();
  });

  it("disposes the backend and leaves the pool untouched when publish fails", async () => {
    const { backend, disposed } = makeTrackedBackend();
    const pool = new AgentPool({ bus, backendFactory: () => backend });

    vi.spyOn(bus, "publish").mockRejectedValueOnce(new Error("disk full"));

    await expect(
      pool.spawn({ projectId: "p1", config, profile: "default" }),
    ).rejects.toThrow("disk full");

    expect(pool.activeCount).toBe(0);
    expect(disposed()).toBe(true);
  });

  it("killAll still resolves and empties the pool when one session's dispose rejects", async () => {
    const backends = [makeTrackedBackend(), makeTrackedBackend({ failDispose: true }), makeTrackedBackend()];
    let next = 0;
    const pool = new AgentPool({
      bus,
      backendFactory: () => backends[next++]!.backend,
    });

    await pool.spawn({ projectId: "p1", config, profile: "default" });
    await pool.spawn({ projectId: "p1", config, profile: "default" });
    await pool.spawn({ projectId: "p1", config, profile: "default" });

    await expect(pool.killAll()).resolves.toBeUndefined();

    expect(pool.activeCount).toBe(0);
    expect(backends.every((b) => b.disposed())).toBe(true);
  });
});
