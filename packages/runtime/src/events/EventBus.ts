import type { RuntimeEvent } from "@clautana/protocol";
import type { EventDraft, EventLog } from "./EventLog.js";

export type EventListener = (event: RuntimeEvent) => void;

/**
 * Fans persisted events out to live subscribers.
 *
 * Subscribing replays history from the log first, then attaches for live
 * delivery. Because publish() awaits the log write before notifying, a
 * subscriber can never observe an event that is not yet durable.
 */
export class EventBus {
  private readonly listeners = new Set<EventListener>();
  private readonly pendingBuffers = new Map<EventListener, RuntimeEvent[]>();

  constructor(private readonly log: EventLog) {}

  async publish(draft: EventDraft): Promise<RuntimeEvent> {
    const event = await this.log.append(draft);
    for (const listener of this.listeners) {
      this.deliver(listener, event);
    }
    return event;
  }

  async subscribe(
    sinceSeq: number,
    listener: EventListener
  ): Promise<() => void> {
    // The unsubscribe handle below is only returned once replay and buffer
    // drain complete, so a caller has no way to cancel a subscription while
    // this method is still pending.
    const buffer: RuntimeEvent[] = [];

    // Step 1: Attach listener to live set FIRST with a pending buffer.
    // While replay is in flight, live events will be buffered instead of delivered directly.
    this.listeners.add(listener);
    this.pendingBuffers.set(listener, buffer);

    try {
      // Step 2: Await log.replay and deliver replayed events, tracking highest seq.
      const history = await this.log.replay(sinceSeq);
      let maxSeq = sinceSeq;

      for (const event of history) {
        this.deliverDirect(listener, event);
        maxSeq = Math.max(maxSeq, event.seq);
      }

      // Step 3: Drain the buffer, delivering only events whose seq > highest replayed seq.
      // This dedupes any events that arrived during replay.
      for (const event of buffer) {
        if (event.seq > maxSeq) {
          this.deliverDirect(listener, event);
          maxSeq = Math.max(maxSeq, event.seq);
        }
      }

      // Step 4: Switch the subscription to direct live delivery by removing the buffer.
      // Buffer is now exhausted and will be garbage-collected.
      this.pendingBuffers.delete(listener);
    } catch (error) {
      // Step 4 (error path): Roll back the registration.
      // If replay fails, the listener must not remain registered.
      this.listeners.delete(listener);
      this.pendingBuffers.delete(listener);
      throw error;
    }

    // Step 5: Return unsubscribe function.
    return () => {
      this.listeners.delete(listener);
      this.pendingBuffers.delete(listener);
    };
  }

  private deliver(listener: EventListener, event: RuntimeEvent): void {
    // If this listener has a pending buffer, add to it instead of calling directly.
    const buffer = this.pendingBuffers.get(listener);
    if (buffer) {
      buffer.push(event);
      return;
    }

    this.deliverDirect(listener, event);
  }

  private deliverDirect(listener: EventListener, event: RuntimeEvent): void {
    // One broken subscriber must not stall the run or starve its peers.
    try {
      const result: unknown = listener(event);
      // A listener typed `=> void` may still be an async function: TypeScript's
      // void-return compatibility permits it, and its rejection would otherwise
      // escape the synchronous catch below as an unhandledRejection.
      if (
        typeof result === "object" &&
        result !== null &&
        "then" in result &&
        typeof (result as { then: unknown }).then === "function"
      ) {
        void (result as Promise<unknown>).catch((error: unknown) => {
          console.error("[EventBus] subscriber threw", error);
        });
      }
    } catch (error) {
      console.error("[EventBus] subscriber threw", error);
    }
  }
}
