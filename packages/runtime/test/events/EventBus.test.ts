import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
});
