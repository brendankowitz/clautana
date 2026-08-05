import { describe, it, expect } from "vitest";
import { FakeBackend } from "../../src/backend/FakeBackend.js";
import type { BackendEvent } from "../../src/backend/AgentBackend.js";

async function drain(iterable: AsyncIterable<BackendEvent>): Promise<BackendEvent[]> {
  const out: BackendEvent[] = [];
  for await (const event of iterable) {
    out.push(event);
  }
  return out;
}

describe("FakeBackend", () => {
  it("yields the scripted events for a run", async () => {
    const backend = new FakeBackend([
      [
        { kind: "text", content: "hello" },
        { kind: "result", costUsd: 0.01, tokensUsed: 42 },
      ],
    ]);

    const events = await drain(backend.run("hi", new AbortController().signal));

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ kind: "text", content: "hello" });
  });

  it("advances through the script across successive runs", async () => {
    const backend = new FakeBackend([
      [{ kind: "text", content: "first" }],
      [{ kind: "text", content: "second" }],
    ]);

    const one = await drain(backend.run("a", new AbortController().signal));
    const two = await drain(backend.run("b", new AbortController().signal));

    expect((one[0] as { content: string }).content).toBe("first");
    expect((two[0] as { content: string }).content).toBe("second");
  });

  it("records the prompts it received", async () => {
    const backend = new FakeBackend([[], []]);
    await drain(backend.run("first prompt", new AbortController().signal));
    await drain(backend.run("second prompt", new AbortController().signal));
    expect(backend.prompts).toEqual(["first prompt", "second prompt"]);
  });

  it("stops yielding once the signal aborts", async () => {
    const backend = new FakeBackend([
      [
        { kind: "text", content: "one" },
        { kind: "text", content: "two" },
      ],
    ]);
    const controller = new AbortController();

    const events: BackendEvent[] = [];
    for await (const event of backend.run("hi", controller.signal)) {
      events.push(event);
      controller.abort();
    }

    expect(events).toHaveLength(1);
  });

  it("throws the configured failure", async () => {
    const backend = FakeBackend.failing("backend exploded");
    await expect(drain(backend.run("hi", new AbortController().signal))).rejects.toThrow(
      "backend exploded",
    );
  });

  it("reports capabilities", () => {
    const backend = new FakeBackend([]);
    expect(backend.capabilities).toEqual({ mcp: true, interrupt: true, cost: true });
  });
});
