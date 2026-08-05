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
let ready: Record<string, unknown> | undefined;

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
  ready = undefined;

  child = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, CLAUTANA_FAKE_BACKEND: "1", CLAUTANA_RUNS_DIR: join(dir, "runs") },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (line.trim() === "") return;
    const message = JSON.parse(line) as Record<string, unknown>;
    if (message["method"] === "runtime.ready") {
      ready = message;
      return;
    }
    if (message["method"] === "event") {
      events.push(message["params"] as Record<string, unknown>);
      return;
    }
    if (typeof message["id"] === "number") {
      pending.get(message["id"] as number)?.(message);
      pending.delete(message["id"] as number);
    }
  });

  // A real readiness handshake, not an incidental one: RPC calls must not be
  // sent until the sidecar has actually attached its JsonRpcServer and
  // announced runtime.ready, so beforeEach blocks the test body on it.
  await waitFor(() => ready !== undefined);
});

function waitForChildClose(proc: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolveClose) => {
    const timer = setTimeout(() => resolveClose(false), timeoutMs);
    proc.once("close", () => {
      clearTimeout(timer);
      resolveClose(true);
    });
  });
}

afterEach(async () => {
  // Orphaned sidecars are a theme this system takes seriously: if shutdown()
  // hangs, a failing test must not leave a live process racing the temp-dir
  // cleanup below. Ask nicely first, then force it after a short grace period.
  child.kill();
  const closedGracefully = await waitForChildClose(child, 2000);
  if (!closedGracefully) {
    child.kill("SIGKILL");
    await waitForChildClose(child, 2000);
  }

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
  it("emits runtime.ready with the expected shape once listening", () => {
    // beforeEach already blocked on this arriving; assert its exact shape so
    // a future change to the payload (e.g. accidentally adding fields a
    // naive "any line with a method field is an event" router would forward
    // to the UI as garbage) is caught here.
    expect(ready).toEqual({ method: "runtime.ready" });
  });

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

  it("replays the missed agent.spawned event for a reattaching subscriber", async () => {
    const { result: opened } = (await call("project.open", { path: dir })) as {
      result: { projectId: string };
    };
    const { result: spawned } = (await call("agent.spawn", {
      projectId: opened.projectId,
      profile: "default",
    })) as { result: { agentId: string } };

    // Subscribe only after the spawn: the missed event must still arrive via
    // replay. Asserting on the specific agent.spawned event (rather than on
    // whatever happens to sit at events[0]) is what actually proves replay
    // worked, as opposed to merely proving the process started.
    await call("events.subscribe", { sinceSeq: 0 });

    await waitFor(() => events.some((e) => e["type"] === "agent.spawned"));
    const spawnedEvent = events.find((e) => e["type"] === "agent.spawned");
    expect(spawnedEvent).toBeDefined();
    expect(spawnedEvent!["agentId"]).toBe(spawned.agentId);
  });

  it("delivers each event exactly once even after a repeat events.subscribe", async () => {
    const { result: opened } = (await call("project.open", { path: dir })) as {
      result: { projectId: string };
    };
    // A reattaching client (e.g. the UI resubscribing on window reopen)
    // sends a second events.subscribe on the same channel. It must replace
    // the first subscription, not stack on top of it.
    await call("events.subscribe", { sinceSeq: 0 });
    await call("events.subscribe", { sinceSeq: 0 });

    await call("agent.spawn", { projectId: opened.projectId, profile: "default" });

    await waitFor(() => events.some((e) => e["type"] === "agent.spawned"));
    const spawnedEvents = events.filter((e) => e["type"] === "agent.spawned");
    expect(spawnedEvents).toHaveLength(1);
  });

  it("returns an error for an unknown agentId rather than dying", async () => {
    const response = await call("agent.prompt", { agentId: "nope", text: "hi" });
    expect((response["error"] as { message: string }).message).toMatch(/unknown agentid/i);

    const ping = await call("runtime.ping", {});
    expect(ping["result"]).toBeDefined();
  });

  it("flushes the shutdown agent.status event to stdout before the process exits", async () => {
    const { result: opened } = (await call("project.open", { path: dir })) as {
      result: { projectId: string };
    };
    await call("events.subscribe", { sinceSeq: 0 });
    const { result: spawned } = (await call("agent.spawn", {
      projectId: opened.projectId,
      profile: "default",
    })) as { result: { agentId: string } };

    const closed = new Promise<void>((resolveClosed) => {
      child.once("close", () => resolveClosed());
    });

    // EOF on stdin is the one shutdown trigger this test can rely on across
    // platforms: on Windows, child_process#kill() terminates the process
    // unconditionally regardless of signal name, so it never reaches a
    // SIGTERM handler and cannot exercise the graceful-shutdown path
    // deterministically. Closing stdin is portable and is also exactly what
    // happens when the Tauri shell tears down its side of the pipe.
    child.stdin.end();
    await closed;

    // pool.killAll() (invoked from shutdown()) publishes a final
    // agent.status "complete" for the still-live session. It is durable on
    // disk regardless; this asserts it also reached the live subscriber
    // over stdout before the process actually exited - the property the
    // pre-fix code did not guarantee.
    const finalStatus = events.find(
      (e) =>
        e["type"] === "agent.status" && e["agentId"] === spawned.agentId && e["status"] === "complete",
    );
    expect(finalStatus).toBeDefined();
  });
});
