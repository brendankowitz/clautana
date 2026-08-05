import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeEvent } from "@clautana/protocol";
import { EventLog } from "../../src/events/EventLog.js";
import { EventBus } from "../../src/events/EventBus.js";
import { FakeBackend } from "../../src/backend/FakeBackend.js";
import { AgentSession } from "../../src/agent/AgentSession.js";

let dir: string;
let log: EventLog;
let bus: EventBus;
let seen: RuntimeEvent[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clautana-session-"));
  log = await EventLog.open(dir, "run-1");
  bus = new EventBus(log);
  seen = [];
  await bus.subscribe(0, (event) => seen.push(event));
});

afterEach(async () => {
  await log.close();
  await rm(dir, { recursive: true, force: true });
});

function makeSession(backend: FakeBackend): AgentSession {
  return new AgentSession({
    agentId: "agent-1",
    name: "Coder",
    profile: "coder",
    backend,
    bus,
  });
}

describe("AgentSession", () => {
  it("starts idle", () => {
    const session = makeSession(new FakeBackend([]));
    expect(session.status).toBe("idle");
  });

  it("publishes status transitions around a prompt", async () => {
    const session = makeSession(new FakeBackend([[{ kind: "text", content: "hi" }]]));
    await session.sendPrompt("hello");

    const statuses = seen
      .filter((e) => e.type === "agent.status")
      .map((e) => (e as { status: string }).status);
    expect(statuses).toEqual(["processing", "idle"]);
  });

  it("publishes text output as an agent.output event", async () => {
    const session = makeSession(new FakeBackend([[{ kind: "text", content: "hi there" }]]));
    await session.sendPrompt("hello");

    const output = seen.find((e) => e.type === "agent.output");
    expect(output).toBeDefined();
    expect((output as { payload: { content: string } }).payload.content).toBe("hi there");
  });

  it("publishes tool calls", async () => {
    const backend = new FakeBackend([
      [{ kind: "toolCall", toolCallId: "t1", name: "Read", arguments: { path: "a.ts" } }],
    ]);
    const session = makeSession(backend);
    await session.sendPrompt("read it");

    const toolCall = seen.find((e) => e.type === "agent.toolCall");
    expect((toolCall as { payload: { name: string } }).payload.name).toBe("Read");
  });

  it("accumulates cost and tokens across runs", async () => {
    const backend = new FakeBackend([
      [{ kind: "result", costUsd: 0.01, tokensUsed: 10 }],
      [{ kind: "result", costUsd: 0.02, tokensUsed: 5 }],
    ]);
    const session = makeSession(backend);

    await session.sendPrompt("one");
    await session.sendPrompt("two");

    expect(session.costUsd).toBeCloseTo(0.03);
    expect(session.tokensUsed).toBe(15);
  });

  it("publishes agent.error and goes to error status when the backend throws", async () => {
    const session = makeSession(FakeBackend.failing("boom"));
    await session.sendPrompt("hello");

    const error = seen.find((e) => e.type === "agent.error");
    expect((error as { message: string }).message).toContain("boom");
    expect(session.status).toBe("error");
  });

  it("rejects a concurrent prompt while processing", async () => {
    const backend = new FakeBackend([[{ kind: "text", content: "slow" }]]);
    const session = makeSession(backend);

    const first = session.sendPrompt("one");
    await expect(session.sendPrompt("two")).rejects.toThrow(/already processing/i);
    await first;
  });

  it("interrupt() moves the session to interrupted", async () => {
    const backend = new FakeBackend([
      [
        { kind: "text", content: "one" },
        { kind: "text", content: "two" },
      ],
    ]);
    const session = makeSession(backend);

    const running = session.sendPrompt("go");
    session.interrupt();
    await running;

    expect(session.status).toBe("interrupted");
  });

  it("kill() disposes the backend", async () => {
    let disposed = false;
    const backend = new FakeBackend([]);
    backend.dispose = async () => {
      disposed = true;
    };
    const session = makeSession(backend);

    await session.kill();

    expect(disposed).toBe(true);
    expect(session.status).toBe("complete");
  });

  it("kill() sequences after an in-flight multi-event turn, ending at complete", async () => {
    // Three events so the turn is genuinely mid-flight (not exhausted) when
    // kill() fires after only the first has been observed.
    const backend = new FakeBackend([
      [
        { kind: "text", content: "first" },
        { kind: "text", content: "second" },
        { kind: "text", content: "third" },
      ],
    ]);
    const session = makeSession(backend);

    let resolveFirstOutput: () => void;
    const firstOutput = new Promise<void>((resolve) => {
      resolveFirstOutput = resolve;
    });
    const unsubscribe = await bus.subscribe(0, (event) => {
      if (event.type === "agent.output") {
        resolveFirstOutput();
      }
    });

    const running = session.sendPrompt("go");
    // Wait for genuine mid-flight evidence instead of guessing a microtask
    // count: the turn must have actually started producing events.
    await firstOutput;

    await session.kill();
    await running;
    unsubscribe();

    expect(session.status).toBe("complete");

    // Proves events actually flowed before the kill — a no-op kill()
    // implementation would still pass a test that only checked the end state.
    expect(seen.some((e) => e.type === "agent.output")).toBe(true);

    const statuses = seen
      .filter((e) => e.type === "agent.status")
      .map((e) => (e as { status: string }).status);
    expect(statuses[statuses.length - 1]).toBe("complete");
    expect(statuses.indexOf("complete")).toBe(statuses.length - 1);
  });
});
