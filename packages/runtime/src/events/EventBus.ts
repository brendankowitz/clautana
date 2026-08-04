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

  constructor(private readonly log: EventLog) {}

  async publish(draft: EventDraft): Promise<RuntimeEvent> {
    const event = await this.log.append(draft);
    for (const listener of this.listeners) {
      this.deliver(listener, event);
    }
    return event;
  }

  async subscribe(sinceSeq: number, listener: EventListener): Promise<() => void> {
    const history = await this.log.replay(sinceSeq);
    for (const event of history) {
      this.deliver(listener, event);
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private deliver(listener: EventListener, event: RuntimeEvent): void {
    // One broken subscriber must not stall the run or starve its peers.
    try {
      listener(event);
    } catch (error) {
      console.error("[EventBus] subscriber threw", error);
    }
  }
}
