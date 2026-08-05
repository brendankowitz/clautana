import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeEvent } from "@clautana/protocol";
import { EventLog } from "../../src/events/EventLog.js";
import { EventBus } from "../../src/events/EventBus.js";

let dir: string;
let log: EventLog;
let bus: EventBus;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clautana-eventbus-"));
  log = await EventLog.open(dir, "run-1");
  bus = new EventBus(log);
});

afterEach(async () => {
  await log.close();
  await rm(dir, { recursive: true, force: true });
});

describe("EventBus", () => {
  it("delivers live events to a subscriber", async () => {
    const seen: RuntimeEvent[] = [];
    await bus.subscribe(0, (event) => seen.push(event));

    await bus.publish({ type: "agent.status", agentId: "a", status: "idle" });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.type).toBe("agent.status");
  });

  it("replays missed events before live ones, in seq order", async () => {
    await bus.publish({ type: "agent.status", agentId: "a", status: "idle" });
    await bus.publish({ type: "agent.status", agentId: "a", status: "processing" });

    const seen: RuntimeEvent[] = [];
    await bus.subscribe(0, (event) => seen.push(event));

    await bus.publish({ type: "agent.status", agentId: "a", status: "complete" });

    expect(seen.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("honours sinceSeq so a reattaching client skips what it has", async () => {
    await bus.publish({ type: "agent.status", agentId: "a", status: "idle" });
    await bus.publish({ type: "agent.status", agentId: "a", status: "processing" });

    const seen: RuntimeEvent[] = [];
    await bus.subscribe(1, (event) => seen.push(event));

    expect(seen.map((e) => e.seq)).toEqual([2]);
  });

  it("stops delivering after unsubscribe", async () => {
    const seen: RuntimeEvent[] = [];
    const unsubscribe = await bus.subscribe(0, (event) => seen.push(event));

    await bus.publish({ type: "agent.status", agentId: "a", status: "idle" });
    unsubscribe();
    await bus.publish({ type: "agent.status", agentId: "a", status: "processing" });

    expect(seen).toHaveLength(1);
  });

  it("isolates subscribers from each other's failures", async () => {
    const seen: RuntimeEvent[] = [];
    await bus.subscribe(0, () => {
      throw new Error("bad subscriber");
    });
    await bus.subscribe(0, (event) => seen.push(event));

    await bus.publish({ type: "agent.status", agentId: "a", status: "idle" });

    expect(seen).toHaveLength(1);
  });

  it("interleaves live events during replay with an empty initial log", async () => {
    const seen: RuntimeEvent[] = [];

    // Start subscribe without awaiting; it will find no history to replay.
    const subscribePromise = bus.subscribe(0, (event) => seen.push(event));

    // While subscribe is pending (between attaching listener and finishing), publish events.
    // These will arrive while subscribe is in flight and should be buffered.
    await bus.publish({ type: "agent.status", agentId: "a", status: "idle" });
    await bus.publish({ type: "agent.status", agentId: "a", status: "processing" });

    // Await subscribe to finish; it will drain the buffer.
    await subscribePromise;

    // Should see both events exactly once, in seq order.
    expect(seen).toHaveLength(2);
    expect(seen.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("interleaves live events during replay with a pre-populated log", async () => {
    // Pre-populate log with 20 events so replay takes long enough for interleaving to be real.
    for (let i = 0; i < 20; i++) {
      await bus.publish({ type: "agent.status", agentId: "a", status: "idle" });
    }

    const seen: RuntimeEvent[] = [];

    // Start subscribe without awaiting; it will replay all 20 events.
    const subscribePromise = bus.subscribe(0, (event) => seen.push(event));

    // While subscribe is replaying (between attaching and finishing), publish more events.
    // These should be buffered and delivered after replay, without duplicates.
    await bus.publish({ type: "agent.status", agentId: "a", status: "processing" });
    await bus.publish({ type: "agent.status", agentId: "a", status: "complete" });

    // Await subscribe to finish; it will drain the buffer with dedup.
    await subscribePromise;

    // Should see all 22 events exactly once, in seq order.
    expect(seen).toHaveLength(22);
    expect(seen.map((e) => e.seq)).toEqual(
      Array.from({ length: 22 }, (_, i) => i + 1)
    );
  });

  it("isolates async listeners that reject after an await", async () => {
    const seen: RuntimeEvent[] = [];

    // Subscribe an async listener that throws after an await.
    await bus.subscribe(0, async () => {
      await new Promise((resolve) => setImmediate(resolve));
      throw new Error("async subscriber threw");
    });

    // Subscribe another listener to verify it still receives events.
    await bus.subscribe(0, (event) => seen.push(event));

    // Publish an event. The async listener will reject, but should be caught internally.
    await bus.publish({ type: "agent.status", agentId: "a", status: "idle" });

    // Give the async rejection time to be handled.
    await new Promise((resolve) => setImmediate(resolve));

    // The non-async listener should have received the event.
    expect(seen).toHaveLength(1);
  });

  it("rejects publish when log.append fails and notifies no subscribers", async () => {
    const seen: RuntimeEvent[] = [];
    await bus.subscribe(0, (event) => seen.push(event));

    // Mock append to reject.
    const appendSpy = vi
      .spyOn(log, "append")
      .mockRejectedValueOnce(new Error("append failed"));

    try {
      await bus.publish({ type: "agent.status", agentId: "a", status: "idle" });
      expect.fail("publish should have thrown");
    } catch (error) {
      expect((error as Error).message).toBe("append failed");
    }

    // The subscriber should not have been notified.
    expect(seen).toHaveLength(0);

    appendSpy.mockRestore();
  });
});
