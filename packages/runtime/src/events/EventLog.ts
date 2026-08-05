import { mkdir, readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { isRuntimeEvent, type RuntimeEvent } from "@clautana/protocol";

/**
 * Omit that distributes over a union. A plain `Omit<RuntimeEvent, ...>` collapses
 * to the keys common to every variant, silently discarding per-variant fields and
 * leaving every publisher unchecked.
 */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

/** An event as supplied by callers, before the log stamps identity onto it. */
export type EventDraft = DistributiveOmit<RuntimeEvent, "seq" | "runId" | "timestamp">;

/**
 * Append-only, crash-tolerant event log for a single run.
 *
 * Writes are serialised through a promise chain so concurrent append() calls
 * cannot interleave partial lines or duplicate a seq.
 */
export class EventLog {
  private _lastSeq: number;
  private _writeQueue: Promise<unknown> = Promise.resolve();
  private _closed = false;

  private constructor(
    private readonly filePath: string,
    private readonly runId: string,
    lastSeq: number,
  ) {
    this._lastSeq = lastSeq;
  }

  static async open(runsDir: string, runId: string): Promise<EventLog> {
    const runDir = join(runsDir, runId);
    await mkdir(runDir, { recursive: true });
    const filePath = join(runDir, "events.jsonl");
    const lastSeq = await EventLog.readLastSeq(filePath);
    return new EventLog(filePath, runId, lastSeq);
  }

  get lastSeq(): number {
    return this._lastSeq;
  }

  async append(draft: EventDraft): Promise<RuntimeEvent> {
    if (this._closed) {
      throw new Error("EventLog is closed");
    }
    // seq does not roll back on write failure. Sequence gaps are harmless and accepted;
    // sequence reuse is prohibited to prevent two different events claiming the same seq.
    const event = {
      ...draft,
      seq: ++this._lastSeq,
      runId: this.runId,
      timestamp: new Date().toISOString(),
    } as RuntimeEvent;

    // Chain writes so concurrent appends cannot interleave. Swallow prior write failures
    // so one failure does not poison the queue for all future writes.
    const attempt = this._writeQueue
      .catch(() => {})                    // never inherit a prior write's failure
      .then(() => appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8"));
    this._writeQueue = attempt.catch(() => {}); // successor writes are not blocked
    await attempt;                        // this caller still sees its own error
    return event;
  }

  async replay(sinceSeq: number): Promise<RuntimeEvent[]> {
    const events = await EventLog.readAll(this.filePath);
    return events.filter((event) => event.seq > sinceSeq);
  }

  async close(): Promise<void> {
    await this._writeQueue;
    this._closed = true;
  }

  private static async readAll(filePath: string): Promise<RuntimeEvent[]> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const events: RuntimeEvent[] = [];
    for (const line of raw.split("\n")) {
      if (line.trim() === "") {
        continue;
      }
      // A crash can truncate the final line. Stop at the first unparseable
      // record rather than discarding the valid history before it.
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        break;
      }
      if (!isRuntimeEvent(parsed)) {
        break;
      }
      events.push(parsed);
    }
    return events;
  }

  private static async readLastSeq(filePath: string): Promise<number> {
    const events = await EventLog.readAll(filePath);
    return events.length === 0 ? 0 : events[events.length - 1]!.seq;
  }
}
