import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeEvent } from "@clautana/protocol";
import { EventLog } from "../../src/events/EventLog.js";
import { EventBus } from "../../src/events/EventBus.js";
import { FakeBackend } from "../../src/backend/FakeBackend.js";
import { ConfigManager } from "../../src/project/ConfigManager.js";
import { AgentPool } from "../../src/agent/AgentPool.js";

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

  it("rejects an unknown profile", async () => {
    const pool = makePool();
    await expect(
      pool.spawn({ projectId: "p1", config, profile: "does-not-exist" }),
    ).rejects.toThrow(/unknown profile/i);
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
});
