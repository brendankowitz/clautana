import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventDraft } from "../../src/events/EventLog.js";
import { EventLog } from "../../src/events/EventLog.js";

// Helper to type event drafts (fixes TypeScript union discrimination)
const evt = (draft: unknown): EventDraft => draft as EventDraft;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clautana-eventlog-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("EventLog", () => {
  it("assigns monotonically increasing seq starting at 1", async () => {
    const log = await EventLog.open(dir, "run-1");
    const first = await log.append(evt({ type: "agent.status", agentId: "a", status: "idle" }));
    const second = await log.append(evt({ type: "agent.status", agentId: "a", status: "processing" }));
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(log.lastSeq).toBe(2);
    await log.close();
  });

  it("stamps runId and an ISO timestamp", async () => {
    const log = await EventLog.open(dir, "run-1");
    const event = await log.append(evt({ type: "agent.status", agentId: "a", status: "idle" }));
    expect(event.runId).toBe("run-1");
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    await log.close();
  });

  it("persists one JSON object per line", async () => {
    const log = await EventLog.open(dir, "run-1");
    await log.append(evt({ type: "agent.status", agentId: "a", status: "idle" }));
    await log.append(evt({ type: "agent.status", agentId: "a", status: "processing" }));
    await log.close();

    const raw = await readFile(join(dir, "run-1", "events.jsonl"), "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).seq).toBe(1);
    expect(JSON.parse(lines[1]!).seq).toBe(2);
  });

  it("replays only events after sinceSeq", async () => {
    const log = await EventLog.open(dir, "run-1");
    await log.append(evt({ type: "agent.status", agentId: "a", status: "idle" }));
    await log.append(evt({ type: "agent.status", agentId: "a", status: "processing" }));
    await log.append(evt({ type: "agent.status", agentId: "a", status: "complete" }));

    const replayed = await log.replay(1);
    expect(replayed.map((e) => e.seq)).toEqual([2, 3]);
    await log.close();
  });

  it("resumes seq from an existing log on reopen", async () => {
    const first = await EventLog.open(dir, "run-1");
    await first.append(evt({ type: "agent.status", agentId: "a", status: "idle" }));
    await first.append(evt({ type: "agent.status", agentId: "a", status: "processing" }));
    await first.close();

    const reopened = await EventLog.open(dir, "run-1");
    expect(reopened.lastSeq).toBe(2);
    const next = await reopened.append(evt({ type: "agent.status", agentId: "a", status: "complete" }));
    expect(next.seq).toBe(3);
    await reopened.close();
  });

  it("skips corrupt trailing lines when resuming", async () => {
    const log = await EventLog.open(dir, "run-1");
    await log.append(evt({ type: "agent.status", agentId: "a", status: "idle" }));
    await log.close();

    const { appendFile } = await import("node:fs/promises");
    await appendFile(join(dir, "run-1", "events.jsonl"), '{"seq":2,"broken\n', "utf8");

    const reopened = await EventLog.open(dir, "run-1");
    expect(reopened.lastSeq).toBe(1);
    await reopened.close();
  });

  it("handles concurrent appends without interleaving or seq reuse", async () => {
    const log = await EventLog.open(dir, "run-1");

    // Fire 20 concurrent appends without awaiting individually
    const promises = Array.from({ length: 20 }, (_, i) =>
      log.append(evt({ type: "agent.status", agentId: `a${i}`, status: "idle" })),
    );
    const results = await Promise.all(promises);

    // All seqs must be distinct and exactly 1..20
    const seqs = results.map((e) => e.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));

    // File must have exactly 20 lines
    const raw = await readFile(join(dir, "run-1", "events.jsonl"), "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(20);

    // Every line must parse as JSON
    const parsed = lines.map((line) => JSON.parse(line));
    expect(parsed).toHaveLength(20);

    await log.close();
  });

  it("survives a write failure: later appends still reach disk and close() resolves", async () => {
    const log = await EventLog.open(dir, "run-1");
    const filePath = join(dir, "run-1", "events.jsonl");

    const first = await log.append(evt({ type: "agent.status", agentId: "a", status: "idle" }));
    expect(first.seq).toBe(1);

    // Make the write target un-writable as a file: put a directory in its place.
    await rm(filePath, { force: true });
    await mkdir(filePath);

    await expect(
      log.append(evt({ type: "agent.status", agentId: "a", status: "processing" })),
    ).rejects.toThrow();

    // Restore a writable path.
    await rm(filePath, { recursive: true, force: true });

    // The queue must NOT be poisoned: this append has to actually reach disk.
    const third = await log.append(evt({ type: "agent.status", agentId: "a", status: "complete" }));

    // Seq gap is the ruled behaviour: 2 was consumed by the failed write and is
    // never reused.
    expect(third.seq).toBe(3);

    const raw = await readFile(filePath, "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).seq).toBe(3);

    // close() must resolve, not inherit the earlier rejection.
    await expect(log.close()).resolves.toBeUndefined();
  });

  it("stops reading at corrupt-shape JSON that is not a valid runtime event", async () => {
    const log = await EventLog.open(dir, "run-1");
    await log.append(evt({ type: "agent.status", agentId: "a", status: "idle" }));
    await log.close();

    const { appendFile } = await import("node:fs/promises");
    // Write valid JSON that is not a RuntimeEvent (missing seq, runId, timestamp, etc.)
    await appendFile(join(dir, "run-1", "events.jsonl"), '{"seq":2,"nonsense":true}\n', "utf8");

    const reopened = await EventLog.open(dir, "run-1");
    // Should stop reading and preserve history up to the corrupt line
    expect(reopened.lastSeq).toBe(1);
    await reopened.close();
  });
});
