export interface PingResult {
  protocolVersion: string;
  runtimeVersion: string;
}

export interface OpenProjectParams {
  path: string;
}
export interface OpenProjectResult {
  projectId: string;
}

export interface SpawnAgentParams {
  projectId: string;
  profile: string;
}
export interface SpawnAgentResult {
  agentId: string;
  runId: string;
}

export interface PromptAgentParams {
  agentId: string;
  text: string;
}

export interface AgentIdParams {
  agentId: string;
}

export interface SubscribeParams {
  sinceSeq: number;
}

export interface RpcMethods {
  "runtime.ping": { params: Record<string, never>; result: PingResult };
  "project.open": { params: OpenProjectParams; result: OpenProjectResult };
  "agent.spawn": { params: SpawnAgentParams; result: SpawnAgentResult };
  "agent.prompt": { params: PromptAgentParams; result: { ok: true } };
  "agent.interrupt": { params: AgentIdParams; result: { ok: true } };
  "agent.kill": { params: AgentIdParams; result: { ok: true } };
  "events.subscribe": { params: SubscribeParams; result: { ok: true } };
}

export type RpcMethodName = keyof RpcMethods;

export interface RpcRequest<M extends RpcMethodName = RpcMethodName> {
  id: number;
  method: M;
  params: RpcMethods[M]["params"];
}

export interface RpcSuccess<M extends RpcMethodName = RpcMethodName> {
  id: number;
  result: RpcMethods[M]["result"];
}

export interface RpcError {
  id: number;
  error: { code: number; message: string };
}

export type RpcResponse = RpcSuccess | RpcError;

/** Server-pushed event, correlates to no request id. */
export interface RpcNotification {
  method: "event";
  params: import("./events.js").RuntimeEvent;
}

export const RPC_ERROR_METHOD_NOT_FOUND = -32601;
export const RPC_ERROR_INVALID_PARAMS = -32602;
export const RPC_ERROR_INTERNAL = -32603;
