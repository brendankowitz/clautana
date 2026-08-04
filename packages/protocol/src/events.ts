export type AgentStatus =
  | "initializing"
  | "idle"
  | "processing"
  | "paused"
  | "error"
  | "waiting"
  | "interrupted"
  | "complete";

export interface ToolCallPayload {
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface OutputPayload {
  kind: "text" | "system" | "stderr";
  content: string;
}

export interface EventBase {
  seq: number;
  runId: string;
  timestamp: string;
}

export interface RunStartedEvent extends EventBase {
  type: "run.started";
  projectId: string;
}

export interface RunEndedEvent extends EventBase {
  type: "run.ended";
  projectId: string;
  reason: "completed" | "aborted" | "error";
}

export interface AgentSpawnedEvent extends EventBase {
  type: "agent.spawned";
  agentId: string;
  name: string;
  profile: string;
}

export interface AgentStatusEvent extends EventBase {
  type: "agent.status";
  agentId: string;
  status: AgentStatus;
}

export interface AgentOutputEvent extends EventBase {
  type: "agent.output";
  agentId: string;
  payload: OutputPayload;
}

export interface AgentToolCallEvent extends EventBase {
  type: "agent.toolCall";
  agentId: string;
  payload: ToolCallPayload;
}

export interface AgentResultEvent extends EventBase {
  type: "agent.result";
  agentId: string;
  costUsd: number;
  tokensUsed: number;
}

export interface AgentErrorEvent extends EventBase {
  type: "agent.error";
  agentId: string;
  message: string;
}

export type RuntimeEvent =
  | RunStartedEvent
  | RunEndedEvent
  | AgentSpawnedEvent
  | AgentStatusEvent
  | AgentOutputEvent
  | AgentToolCallEvent
  | AgentResultEvent
  | AgentErrorEvent;

const RUNTIME_EVENT_TYPE_MAP = {
  "run.started": true,
  "run.ended": true,
  "agent.spawned": true,
  "agent.status": true,
  "agent.output": true,
  "agent.toolCall": true,
  "agent.result": true,
  "agent.error": true,
} satisfies Record<RuntimeEvent["type"], true>;

export const RUNTIME_EVENT_TYPES = Object.keys(
  RUNTIME_EVENT_TYPE_MAP,
) as readonly RuntimeEvent["type"][];

/**
 * Type guard that validates a value is a well-formed RuntimeEvent.
 *
 * This function validates only the event ENVELOPE — it confirms that the value
 * is an object with the required top-level fields (seq, runId, timestamp) and
 * that its type is one of the known RuntimeEvent types. It does NOT verify that
 * the event's variant-specific fields are present (e.g., projectId for
 * RunStartedEvent).
 *
 * This limited validation is acceptable because the sole producer of RuntimeEvents
 * is the sidecar's own typed code, which guarantees full type correctness at
 * the source. Callers should trust a narrowed RuntimeEvent type without
 * performing additional validation, but should not use this guard to prove
 * that variant-specific fields exist at runtime.
 *
 * @param value - The value to check
 * @returns true if value is a RuntimeEvent of a known type
 */
export function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["seq"] === "number" &&
    typeof candidate["runId"] === "string" &&
    typeof candidate["timestamp"] === "string" &&
    RUNTIME_EVENT_TYPES.includes(candidate["type"] as RuntimeEvent["type"])
  );
}
