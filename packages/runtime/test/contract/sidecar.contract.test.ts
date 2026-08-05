import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { PROTOCOL_VERSION } from "@clautana/protocol";

// import.meta.dirname (Node 20.11+) — __dirname does not exist in ESM.
const ENTRY = resolve(import.meta.dirname, "../../dist/main.js");

let child: ChildProcessWithoutNullStreams;
let dir: string;
let nextId = 1;
const events: Record<string, unknown>[] = [];
const pending = new Map<number, (value: Record<string, unknown>) => void>();

beforeAll(() => {
  execFileSync("npm", ["-w", "@clautana/runtime", "run", "build"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}, 120_000);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clautana-contract-"));
  events.length = 0;
  pending.clear();
  nextId = 1;

  child = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, CLAUTANA_FAKE_BACKEND: "1", CLAUTANA_RUNS_DIR: join(dir, "runs") },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (line.trim() === "") return;
    const message = JSON.parse(line) as Record<string, unknown>;
    if (message["method"] === "event") {
      events.push(message["params"] as Record<string, unknown>);
      return;
    }
    if (typeof message["id"] === "number") {
      pending.get(message["id"] as number)?.(message);
      pending.delete(message["id"] as number);
    }
  });

  await waitFor(() => events.length >= 0, 50);
});

afterEach(async () => {
  child.kill();
  await rm(dir, { recursive: true, force: true });
});

function call(method: string, params: unknown): Promise<Record<string, unknown>> {
  const id = nextId++;
  return new Promise((resolvePromise) => {
    pending.set(id, resolvePromise);
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("Timed out waiting for condition");
}

describe("sidecar contract", () => {
  it("answers runtime.ping with the protocol version", async () => {
    const response = await call("runtime.ping", {});
    const result = response["result"] as { protocolVersion: string };
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it("opens a project and returns a projectId", async () => {
    const response = await call("project.open", { path: dir });
    expect((response["result"] as { projectId: string }).projectId).toMatch(/\S/);
  });

  it("errors on project.open with a missing path parameter", async () => {
    const response = await call("project.open", {});
    expect((response["error"] as { message: string }).message).toMatch(/path/i);
  });

  it("spawns an agent and emits agent.spawned", async () => {
    const { result: opened } = (await call("project.open", { path: dir })) as {
      result: { projectId: string };
    };
    await call("events.subscribe", { sinceSeq: 0 });
    await call("agent.spawn", { projectId: opened.projectId, profile: "default" });

    await waitFor(() => events.some((e) => e["type"] === "agent.spawned"));
    expect(events.some((e) => e["type"] === "agent.spawned")).toBe(true);
  });

  it("streams status and output events for a prompt", async () => {
    const { result: opened } = (await call("project.open", { path: dir })) as {
      result: { projectId: string };
    };
    await call("events.subscribe", { sinceSeq: 0 });
    const { result: spawned } = (await call("agent.spawn", {
      projectId: opened.projectId,
      profile: "default",
    })) as { result: { agentId: string } };

    await call("agent.prompt", { agentId: spawned.agentId, text: "hello" });

    await waitFor(() => events.some((e) => e["type"] === "agent.output"));
    const statuses = events.filter((e) => e["type"] === "agent.status").map((e) => e["status"]);
    expect(statuses).toContain("processing");
  });

  it("delivers events with strictly increasing seq", async () => {
    const { result: opened } = (await call("project.open", { path: dir })) as {
      result: { projectId: string };
    };
    await call("events.subscribe", { sinceSeq: 0 });
    const { result: spawned } = (await call("agent.spawn", {
      projectId: opened.projectId,
      profile: "default",
    })) as { result: { agentId: string } };
    await call("agent.prompt", { agentId: spawned.agentId, text: "hello" });

    await waitFor(() => events.length >= 3);

    const seqs = events.map((e) => e["seq"] as number);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("replays from sinceSeq for a reattaching subscriber", async () => {
    const { result: opened } = (await call("project.open", { path: dir })) as {
      result: { projectId: string };
    };
    await call("agent.spawn", { projectId: opened.projectId, profile: "default" });

    // Subscribe only after the spawn: the missed event must still arrive.
    await call("events.subscribe", { sinceSeq: 0 });

    await waitFor(() => events.some((e) => e["type"] === "agent.spawned"));
    expect(events[0]!["seq"]).toBe(1);
  });

  it("returns an error for an unknown agentId rather than dying", async () => {
    const response = await call("agent.prompt", { agentId: "nope", text: "hi" });
    expect((response["error"] as { message: string }).message).toMatch(/unknown agentid/i);

    const ping = await call("runtime.ping", {});
    expect(ping["result"]).toBeDefined();
  });
});
