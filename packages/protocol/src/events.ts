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

export const RUNTIME_EVENT_TYPES: readonly RuntimeEvent["type"][] = [
  "run.started",
  "run.ended",
  "agent.spawned",
  "agent.status",
  "agent.output",
  "agent.toolCall",
  "agent.result",
  "agent.error",
];

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
