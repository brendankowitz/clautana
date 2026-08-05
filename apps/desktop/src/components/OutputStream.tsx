import type { RuntimeEvent } from "@clautana/protocol";

export function OutputStream({ events }: { events: RuntimeEvent[] }) {
  return (
    <div className="output-stream">
      {events.length === 0 && (
        <div className="output-stream-empty">No output yet — spawn an agent and send a prompt.</div>
      )}
      {events.map((event) => (
        <div key={event.seq} className={`event event-${event.type.replace(".", "-")}`}>
          <span className="event-seq">{event.seq}</span>
          <span className="event-body">{renderEvent(event)}</span>
        </div>
      ))}
    </div>
  );
}

function renderEvent(event: RuntimeEvent): string {
  switch (event.type) {
    case "agent.output":
      return event.payload.content;
    case "agent.toolCall":
      return `→ ${event.payload.name}`;
    case "agent.status":
      return `[${event.status}]`;
    case "agent.error":
      return `error: ${event.message}`;
    case "agent.result":
      return `done — $${event.costUsd.toFixed(4)}, ${event.tokensUsed} tokens`;
    case "agent.spawned":
      return `spawned ${event.name}`;
    default:
      return event.type;
  }
}
