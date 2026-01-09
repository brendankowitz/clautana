/**
 * Coordinator-specific types for the multi-agent harness
 */

/**
 * Configuration for spawning a new agent
 */
export interface SpawnConfig {
  /** Unique name for this agent */
  name: string;
  /** What this agent specializes in (e.g., 'Core Parser Engineer') */
  role: string;
  /** Specific task this agent should accomplish */
  focus: string;
  /** Detailed instructions for the agent */
  systemPrompt: string;
  /** Names of agents this one should wait for before starting */
  waitFor: string[];
  /** Execution priority (lower = start sooner) */
  priority: number;
  /** Working directory for the agent */
  workingDirectory: string;
  /** Optional work item ID this agent is assigned to */
  workItemId?: string;
}

/**
 * Status of the agent pool
 */
export interface AgentPoolStatus {
  /** Currently active agents */
  activeAgents: AgentStatusEntry[];
  /** Agents waiting for dependencies */
  pendingAgents: string[];
  /** Total cost across all agents */
  totalCost: number;
}

/**
 * Status entry for a single agent
 */
export interface AgentStatusEntry {
  name: string;
  role: string;
  status: string;
  focus: string;
  workItemId?: string;
}

/**
 * Message in the orchestrator conversation
 */
export interface OrchestratorMessage {
  id: string;
  role: "user" | "assistant" | "orchestrator";
  content: string;
  timestamp: Date;
  reportType?: "progress" | "complete" | "error" | "question";
}

/**
 * Agent output types
 */
export type AgentOutputType = "text" | "toolCall" | "system" | "complete";

/**
 * Base agent output
 */
export interface AgentOutputBase {
  type: AgentOutputType;
}

/**
 * Text output from agent
 */
export interface TextOutput extends AgentOutputBase {
  type: "text";
  content: string;
}

/**
 * System notification output
 */
export interface SystemOutput extends AgentOutputBase {
  type: "system";
  content: string;
}

/**
 * Tool call output from agent
 */
export interface ToolCallOutput extends AgentOutputBase {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Completion output from agent
 */
export interface CompleteOutput extends AgentOutputBase {
  type: "complete";
  result: unknown;
  sessionId?: string;
  costUsd?: number;
  durationMs?: number;
}

/**
 * Union type for all agent outputs
 */
export type AgentOutput = TextOutput | SystemOutput | ToolCallOutput | CompleteOutput;

/**
 * Tool definition for Claude
 */
export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, ToolProperty>;
    required?: string[];
  };
}

/**
 * Tool property schema
 */
export interface ToolProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
}

/**
 * MCP server configuration (aligned with SDK types)
 */
export type McpServerConfig =
  | {
      type?: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  | {
      type: "sse";
      url: string;
      headers?: Record<string, string>;
    }
  | {
      type: "http";
      url: string;
      headers?: Record<string, string>;
    }
  | {
      type: "sdk";
      name: string;
      instance?: any; // SDK MCP server instance
    };

/**
 * File claim for tracking which agent owns which files
 */
export interface FileClaim {
  id: string;
  agentName: string;
  pathPattern: string;
  exclusive: boolean;
  reason?: string;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Message between agents
 */
export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  body?: string;
  timestamp: Date;
  read: boolean;
  archived?: boolean;
}

/**
 * Chat message in agent conversation
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: Date;
  toolCall?: ToolCallInfo;
}

/**
 * Tool call information
 */
export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
}

/**
 * Agent status type
 */
export type AgentStatus = "initializing" | "idle" | "processing" | "paused" | "error" | "waiting" | "complete";

/**
 * SDK message types (from Claude Agent SDK)
 * This is a simplified version for our purposes - the actual SDK has many more message types
 */
export type SDKMessage =
  | SDKAssistantMessageType
  | SDKUserMessageType
  | SDKResultMessageType
  | SDKSystemMessageType;

export interface SDKAssistantMessageType {
  type: "assistant";
  message: {
    content: SDKContentBlock[];
  };
  session_id: string;
  uuid: string;
}

export interface SDKUserMessageType {
  type: "user";
  message: unknown;
  session_id: string;
  uuid: string;
}

export interface SDKResultMessageType {
  type: "result";
  subtype: "success" | "error_during_execution" | "error_max_turns" | "error_max_budget_usd";
  session_id: string;
  total_cost_usd: number;
  duration_ms: number;
  result?: string;
  errors?: string[];
  uuid: string;
}

export interface SDKSystemMessageType {
  type: "system";
  subtype: string;
  session_id: string;
  uuid: string;
}

/**
 * SDK content block
 */
export interface SDKContentBlock {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}


/**
 * Events emitted by AgentPool
 */
export interface AgentPoolEvents {
  agentSpawned: (session: unknown) => void;
  agentDestroyed: (name: string) => void;
  agentStatusChanged: (name: string, status: AgentStatus) => void;
  agentOutput: (name: string, output: AgentOutput) => void;
  agentError: (name: string, error: Error) => void;
  claimsUpdated: (claims: FileClaim[]) => void;
  messageReceived: (message: AgentMessage) => void;
}

/**
 * Events emitted by OrchestratorAgent
 */
export interface OrchestratorEvents {
  statusChanged: (status: "idle" | "processing" | "error") => void;
  message: (message: OrchestratorMessage) => void;
  agentSpawned: (name: string) => void;
  agentDestroyed: (name: string) => void;
  reportToUser: (report: { type: string; message: string }) => void;
  error: (error: Error) => void;
}

/**
 * Extended agent session config with additional fields
 */
export interface ExtendedAgentConfig {
  name: string;
  role: string;
  focus: string;
  systemPrompt: string;
  workingDirectory: string;
  mcpServers: Record<string, McpServerConfig>;
  color: string;
  initialStatus?: AgentStatus;
  outputChannel?: { appendLine: (value: string) => void };
  pathToClaudeCodeExecutable?: string;
}
