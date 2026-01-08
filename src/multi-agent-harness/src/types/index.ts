/**
 * Type definitions for Multi-Agent Harness VS Code Extension
 *
 * This file contains all core interfaces and types used throughout the extension,
 * based on the multi-agent-vscode-extension-spec.md data models.
 */

// ============================================================================
// Extension Configuration
// ============================================================================

/**
 * Extension configuration from settings.json
 *
 * These settings control the behavior of the multi-agent orchestrator
 * and worker agents.
 */
export interface ExtensionConfig {
  /** MCP server configurations for agent access */
  readonly "multiAgent.mcpServers": Record<string, McpServerConfig>;

  /** Automatically start Agent Mail server if not running */
  readonly "multiAgent.autoStartAgentMail": boolean;

  /** Show file claim indicators in editor gutter */
  readonly "multiAgent.showClaimsInEditor": boolean;

  /** Show VS Code notifications when agents send messages to each other */
  readonly "multiAgent.notifyOnAgentMessage": boolean;

  /** Model to use for the orchestrator/coordinator agent */
  readonly "multiAgent.coordinatorModel": string;

  /** Model to use for spawned worker agents */
  readonly "multiAgent.workerModel": string;

  /** Maximum number of concurrent worker agents allowed */
  readonly "multiAgent.maxConcurrentAgents": number;

  /** Color palette for dynamically spawned agents */
  readonly "multiAgent.agentColorPalette": readonly string[];

  /** Working directory for agents (defaults to workspace root) */
  readonly "multiAgent.workingDirectory"?: string;
}

/**
 * Optional agent template providing hints to the coordinator
 *
 * These templates help the orchestrator decide what kinds of agents
 * to spawn for specific types of work.
 */
export interface AgentTemplate {
  /** Agent type (e.g., "parser", "api", "test", "docs") */
  readonly type: string;

  /** Optional tool restrictions for this agent type */
  readonly suggestedTools?: readonly string[];

  /** Additional instructions to include in system prompt */
  readonly systemPromptHint?: string;
}

/**
 * MCP server configuration
 *
 * Defines how to connect to an MCP server that provides tools
 * to the agents.
 */
export interface McpServerConfig {
  /** Transport mechanism: HTTP or stdio */
  readonly transport: "http" | "stdio";

  /** Server URL (required for HTTP transport) */
  readonly url?: string;

  /** Command to execute (required for stdio transport) */
  readonly command?: string;

  /** Command arguments (for stdio transport) */
  readonly args?: readonly string[];

  /** Environment variables for the server process */
  readonly env?: Readonly<Record<string, string>>;
}

// ============================================================================
// Runtime State
// ============================================================================

/**
 * Agent status enumeration
 *
 * Tracks the current operational state of an agent.
 */
export type AgentStatus =
  | "initializing"  // Agent is being created
  | "idle"          // Agent is ready and waiting for input
  | "processing"    // Agent is actively working on a task
  | "waiting"       // Agent is waiting for dependencies
  | "paused"        // Agent has been paused by user or orchestrator
  | "complete"      // Agent has finished its work
  | "error";        // Agent encountered an error

/**
 * Orchestrator status enumeration
 *
 * Tracks the state of the orchestrator/coordinator agent.
 */
export type OrchestratorStatus =
  | "idle"          // Ready for new tasks
  | "processing"    // Analyzing and coordinating
  | "error";        // Error occurred

/**
 * Runtime state of an agent
 *
 * Captures the current state and conversation history of a single agent.
 */
export interface AgentState {
  /** Unique agent name */
  readonly name: string;

  /** Current operational status */
  readonly status: AgentStatus;

  /** Claude Agent SDK session ID (if active) */
  readonly sessionId?: string;

  /** Current task description */
  readonly currentTask?: string;

  /** Agent's role (e.g., "Core Parser Engineer") */
  readonly role?: string;

  /** What this agent is focused on */
  readonly focus?: string;

  /** Color assigned to this agent for UI */
  readonly color?: string;

  /** Conversation message history */
  readonly messages: readonly ChatMessage[];

  /** Total cost in USD for this agent's operations */
  readonly costUsd: number;

  /** Total tokens used by this agent */
  readonly tokensUsed: number;

  /** Names of agents this one is waiting for */
  readonly waitingFor?: readonly string[];
}

/**
 * A single message in a conversation
 *
 * Represents user input, assistant responses, system messages, or tool calls.
 */
export interface ChatMessage {
  /** Unique message identifier */
  readonly id: string;

  /** Message sender role */
  readonly role: "user" | "assistant" | "system" | "tool";

  /** Message content text */
  readonly content: string;

  /** When this message was created */
  readonly timestamp: Date;

  /** Tool call information (if this is a tool message) */
  readonly toolCall?: ToolCallInfo;
}

/**
 * Information about a tool call made by an agent
 *
 * Captures details about tool invocations for debugging and visualization.
 */
export interface ToolCallInfo {
  /** Unique tool call identifier */
  readonly id: string;

  /** Name of the tool being called */
  readonly name: string;

  /** Arguments passed to the tool */
  readonly arguments: Readonly<Record<string, unknown>>;

  /** Result returned by the tool (if available) */
  readonly result?: unknown;

  /** Whether the tool call resulted in an error */
  readonly isError?: boolean;
}

/**
 * File claim/reservation
 *
 * Represents an agent's claim on specific files to prevent conflicts.
 */
export interface FileClaim {
  /** Unique claim identifier */
  readonly id: string;

  /** Name of the agent that owns this claim */
  readonly agentName: string;

  /** File path pattern (e.g., "src/Ignixa.Core/**​/*.cs") */
  readonly pathPattern: string;

  /** Whether this is an exclusive claim (no other agents can edit) */
  readonly exclusive: boolean;

  /** Optional reason for the claim */
  readonly reason?: string;

  /** When the claim was created */
  readonly createdAt: Date;

  /** When the claim expires */
  readonly expiresAt: Date;
}

/**
 * Inter-agent message
 *
 * Represents a message sent from one agent to another via Agent Mail.
 */
export interface AgentMessage {
  /** Unique message identifier */
  readonly id: string;

  /** Sender agent name */
  readonly from: string;

  /** Recipient agent name (or "orchestrator") */
  readonly to: string;

  /** Message subject line */
  readonly subject: string;

  /** Optional message body */
  readonly body?: string;

  /** When the message was sent */
  readonly timestamp: Date;

  /** Whether the recipient has read this message */
  readonly read: boolean;
}

// ============================================================================
// Orchestrator Types
// ============================================================================

/**
 * Message from/to the orchestrator
 *
 * Orchestrator messages have special handling for reports to the user.
 */
export interface OrchestratorMessage {
  /** Unique message identifier */
  readonly id: string;

  /** Message role */
  readonly role: "user" | "assistant" | "orchestrator";

  /** Message content */
  readonly content: string;

  /** When this message was created */
  readonly timestamp: Date;

  /** Type of report (for orchestrator reports to user) */
  readonly reportType?: "progress" | "complete" | "error" | "question";
}

// ============================================================================
// Agent Output Types
// ============================================================================

/**
 * Base interface for agent outputs
 */
interface AgentOutputBase {
  readonly type: string;
}

/**
 * Text output from an agent
 */
export interface TextOutput extends AgentOutputBase {
  readonly type: "text";
  readonly content: string;
}

/**
 * Tool call output from an agent
 */
export interface ToolCallOutput extends AgentOutputBase {
  readonly type: "toolCall";
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly result?: unknown;
  readonly isError?: boolean;
}

/**
 * System notification output
 */
export interface SystemOutput extends AgentOutputBase {
  readonly type: "system";
  readonly content: string;
}

/**
 * Agent completion output
 */
export interface CompleteOutput extends AgentOutputBase {
  readonly type: "complete";
  readonly result?: unknown;
  readonly sessionId?: string;
  readonly costUsd?: number;
  readonly durationMs?: number;
}

/**
 * Union type for all possible agent outputs
 *
 * This is used for streaming agent responses to the UI.
 */
export type AgentOutput =
  | TextOutput
  | ToolCallOutput
  | SystemOutput
  | CompleteOutput;

// ============================================================================
// Spawn Configuration
// ============================================================================

/**
 * Configuration for spawning a new agent
 *
 * Used by the orchestrator when creating worker agents dynamically.
 */
export interface SpawnConfig {
  /** Unique name for this agent (e.g., "R6Parser", "ApiRefactor") */
  readonly name: string;

  /** Agent's role (e.g., "Core Parser Engineer") */
  readonly role: string;

  /** Specific task/focus for this agent */
  readonly focus: string;

  /** Detailed system prompt instructions */
  readonly systemPrompt: string;

  /** Names of agents this one should wait for before starting */
  readonly waitFor: readonly string[];

  /** Execution priority (lower = start sooner) */
  readonly priority: number;

  /** Working directory for this agent */
  readonly workingDirectory: string;

  /** Optional MCP server configuration overrides */
  readonly mcpServers?: Readonly<Record<string, McpServerConfig>>;

  /** Optional tool restrictions */
  readonly allowedTools?: readonly string[];

  /** Initial status (defaults to "initializing") */
  readonly initialStatus?: AgentStatus;

  /** Color for UI (auto-assigned if not provided) */
  readonly color?: string;
}

// ============================================================================
// Pool Status
// ============================================================================

/**
 * Agent pool status summary
 *
 * Provides overview of all agents in the pool.
 */
export interface AgentPoolStatus {
  /** Currently active agents */
  readonly activeAgents: readonly AgentSummary[];

  /** Agents queued waiting for dependencies */
  readonly pendingAgents: readonly string[];

  /** Total cost across all agents */
  readonly totalCost: number;

  /** Total number of active file claims */
  readonly totalClaims?: number;
}

/**
 * Summary information for a single agent
 */
export interface AgentSummary {
  /** Agent name */
  readonly name: string;

  /** Agent role */
  readonly role: string;

  /** Current status */
  readonly status: AgentStatus;

  /** What the agent is focused on */
  readonly focus: string;

  /** Cost in USD for this agent */
  readonly costUsd?: number;

  /** Color assigned to this agent */
  readonly color?: string;
}

// ============================================================================
// Webview Messages
// ============================================================================

/**
 * Messages sent from extension to webview
 */
export type ExtensionToWebviewMessage =
  | { type: "state"; orchestrator: OrchestratorState; agents: AgentState[] }
  | { type: "orchestratorUpdate"; updates: Partial<OrchestratorState> }
  | { type: "orchestratorMessage"; message: OrchestratorMessage }
  | { type: "agentSpawned"; agent: AgentState }
  | { type: "agentDestroyed"; agentName: string }
  | { type: "agentUpdate"; agentName: string; updates: Partial<AgentState> }
  | { type: "agentMessage"; agentName: string; message: ChatMessage }
  | { type: "claimsUpdated"; claims: readonly FileClaim[] }
  | { type: "error"; error: string };

/**
 * Messages sent from webview to extension
 */
export type WebviewToExtensionMessage =
  | { type: "getState" }
  | { type: "submitTask"; task: string }
  | { type: "stopAll" }
  | { type: "pauseAgent"; agentName: string }
  | { type: "resumeAgent"; agentName: string }
  | { type: "destroyAgent"; agentName: string }
  | { type: "sendToAgent"; agentName: string; message: string };

/**
 * Orchestrator state for webview
 */
export interface OrchestratorState {
  /** Current orchestrator status */
  readonly status: OrchestratorStatus;

  /** Current task being analyzed/coordinated */
  readonly currentTask?: string;

  /** Orchestrator conversation messages */
  readonly messages: readonly OrchestratorMessage[];

  /** Session ID if active */
  readonly sessionId?: string;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Events emitted by AgentSession
 */
export interface AgentSessionEvents {
  /** Agent output (text, tool call, etc.) */
  output: [AgentOutput];

  /** Status changed */
  statusChanged: [AgentStatus];

  /** Error occurred */
  error: [Error];

  /** New message added */
  message: [ChatMessage];
}

/**
 * Events emitted by AgentPool
 */
export interface AgentPoolEvents {
  /** New agent spawned */
  agentSpawned: [AgentState];

  /** Agent destroyed */
  agentDestroyed: [string];

  /** Agent status changed */
  agentStatusChanged: [string, AgentStatus];

  /** Agent output */
  agentOutput: [string, AgentOutput];

  /** Agent error */
  agentError: [string, Error];

  /** File claims updated */
  claimsUpdated: [readonly FileClaim[]];

  /** Inter-agent message received */
  messageReceived: [AgentMessage];
}

/**
 * Events emitted by OrchestratorAgent
 */
export interface OrchestratorEvents {
  /** Status changed */
  statusChanged: [OrchestratorStatus];

  /** New message */
  message: [OrchestratorMessage];

  /** Agent spawned by orchestrator */
  agentSpawned: [string];

  /** Agent destroyed by orchestrator */
  agentDestroyed: [string];

  /** Report to user */
  reportToUser: [{ type: string; message: string }];

  /** Error occurred */
  error: [Error];
}

// ============================================================================
// Claude Agent SDK Types (subset needed for integration)
// ============================================================================

/**
 * Options for Claude Agent SDK query
 */
export interface ClaudeAgentOptions {
  /** Model to use */
  readonly model?: string;

  /** Working directory for file operations */
  readonly workingDirectory?: string;

  /** System prompt */
  readonly systemPrompt?: string;

  /** Allowed tools (undefined = all tools) */
  readonly allowedTools?: readonly string[];

  /** MCP servers to connect to */
  readonly mcpServers?: Readonly<Record<string, McpServerConfig>>;

  /** Setting sources (project, user, etc.) */
  readonly settingSources?: readonly string[];
}

/**
 * SDK message from Claude Agent SDK
 */
export interface SDKMessage {
  /** Message type */
  readonly type: "assistant" | "result" | "error" | "system";

  /** Message content (for assistant messages) */
  readonly message?: {
    readonly content: readonly SDKContentBlock[];
  };

  /** Session ID (for result messages) */
  readonly session_id?: string;

  /** Total cost in USD (for result messages) */
  readonly total_cost_usd?: number;

  /** Duration in milliseconds (for result messages) */
  readonly duration_ms?: number;

  /** Result data (for result messages) */
  readonly result?: unknown;

  /** Error details (for error messages) */
  readonly error?: string;
}

/**
 * Content block from SDK
 */
export type SDKContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

/**
 * Tool definition for Claude Agent SDK
 */
export interface Tool {
  /** Tool name */
  readonly name: string;

  /** Tool description */
  readonly description: string;

  /** Input schema (JSON Schema) */
  readonly input_schema: ToolInputSchema;
}

/**
 * Tool input schema (JSON Schema)
 */
export interface ToolInputSchema {
  readonly type: "object";
  readonly properties: Record<string, ToolProperty>;
  readonly required?: readonly string[];
}

/**
 * Tool property definition
 */
export interface ToolProperty {
  readonly type: string;
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly items?: { readonly type: string };
}
