/**
 * Backend abstraction layer types for Clautana multi-agent system.
 * 
 * This module defines the core interfaces for supporting multiple AI backends
 * (Claude Agent SDK, GitHub Copilot SDK, etc.) with a unified API.
 * 
 * Key design principles:
 * - Make it OBVIOUS which SDK is in use (backendType property everywhere)
 * - Log prefixes like [Claude Backend] or [Copilot Backend]
 * - Type-safe discrimination via BackendType enum
 * - Backend-specific options via escape hatches
 */

/**
 * Backend identification - MUST be obvious which SDK is in use
 */
export type BackendType = 'claude' | 'copilot';

/**
 * Backend-specific configuration options
 */
export interface BackendOptions {
  /**
   * Path to the Claude CLI executable (Claude backend only)
   */
  pathToClaudeCodeExecutable?: string;

  /**
   * Path to the Copilot CLI executable (Copilot backend only)
   */
  pathToCopilotExecutable?: string;

  /**
   * Additional backend-specific options
   */
  [key: string]: unknown;
}

/**
 * Core interface for AI backend implementations.
 * 
 * Implementations:
 * - ClaudeAgentBackend: Wraps @anthropic-ai/claude-agent-sdk
 * - CopilotBackend: Wraps @github/copilot-sdk
 */
export interface AgentBackend {
  /**
   * Backend type identifier for logging and debugging
   */
  readonly type: BackendType;

  /**
   * Human-readable backend name (e.g., "Claude Agent SDK", "GitHub Copilot SDK")
   */
  readonly name: string;

  /**
   * Create a new session for agent communication
   */
  createSession(config: SessionConfig): Promise<BackendSession>;

  /**
   * Dispose of all resources and cleanup
   */
  dispose(): Promise<void>;
}

/**
 * Configuration for creating a new backend session
 */
export interface SessionConfig {
  /**
   * Unique session identifier (optional, will be generated if not provided)
   */
  sessionId?: string;

  /**
   * Working directory for file operations
   */
  workingDirectory: string;

  /**
   * System prompt to set agent behavior and capabilities
   */
  systemPrompt?: string;

  /**
   * Tool definitions available to the agent
   */
  tools?: ToolDefinition[];

  /**
   * Model identifier (backend-specific)
   * Examples:
   * - Claude: "claude-sonnet-4-20250514", "claude-opus-4-20250514"
   * - Copilot: "gpt-5", "claude-sonnet-4.5"
   */
  model?: string;

  /**
   * List of tool names that are allowed without permission prompts
   */
  allowedTools?: string[];

  /**
   * MCP server configurations (backend-dependent support)
   */
  mcpServers?: Record<string, unknown>;

  /**
   * Permission mode for file operations (backend-specific)
   */
  permissionMode?: string;

  /**
   * Setting sources to load MCP servers from (backend-specific)
   */
  settingSources?: string[];

  /**
   * Backend-specific options (escape hatch for backend-unique features)
   */
  backendOptions?: Record<string, unknown>;

  /**
   * Optional callback for stderr output
   */
  stderr?: (data: string) => void;
}

/**
 * Options for sending messages
 */
export interface SendOptions {
  /**
   * Abort controller for cancellation
   */
  abortController?: AbortController;
}

/**
 * Active session for communicating with an AI backend
 */
export interface BackendSession {
  /**
   * Unique session identifier
   */
  readonly id: string;

  /**
   * Backend type for logging and debugging
   */
  readonly backendType: BackendType;

  /**
   * Send a prompt and receive streaming responses
   * 
   * @param prompt - The user prompt to send
   * @param options - Optional send options (abort controller, etc.)
   * @returns Async iterable of agent messages
   */
  send(prompt: string, options?: SendOptions): AsyncIterable<AgentMessage>;

  /**
   * Abort the current operation
   */
  abort(): Promise<void>;

  /**
   * Destroy the session and cleanup resources
   */
  destroy(): Promise<void>;
}

/**
 * Message types from the AI backend
 */
export type AgentMessageType = 
  | 'text'        // Text response from the assistant
  | 'toolCall'    // Agent is calling a tool
  | 'toolResult'  // Result from a tool execution
  | 'complete'    // Conversation turn completed
  | 'error';      // Error occurred

/**
 * Unified message format from any backend
 */
export interface AgentMessage {
  /**
   * Message type
   */
  type: AgentMessageType;

  /**
   * Text content (for text messages)
   */
  content?: string;

  /**
   * Tool call details (for toolCall messages)
   */
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  };

  /**
   * Result from the conversation (for complete messages)
   */
  result?: unknown;

  /**
   * Session ID (for complete messages)
   */
  sessionId?: string;

  /**
   * Cost in USD (for complete messages, backend-dependent)
   */
  costUsd?: number;

  /**
   * Duration in milliseconds (for complete messages)
   */
  durationMs?: number;

  /**
   * Error details (for error messages)
   */
  error?: Error;

  /**
   * Backend type for debugging (included in all messages)
   */
  _backend?: BackendType;
}

/**
 * Tool definition in backend-agnostic format
 */
export interface ToolDefinition {
  /**
   * Tool name (must be unique)
   */
  name: string;

  /**
   * Human-readable description of what the tool does
   */
  description: string;

  /**
   * Parameter schema (JSON Schema format)
   */
  parameters: JsonSchema;

  /**
   * Tool implementation handler
   */
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * JSON Schema definition for tool parameters
 * 
 * This is a simplified JSON Schema type that covers common use cases.
 * Backends will convert this to their native schema format:
 * - Claude: Uses JSON Schema directly
 * - Copilot: Converts to Zod schemas
 */
export interface JsonSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  additionalProperties?: boolean | JsonSchema;
}
