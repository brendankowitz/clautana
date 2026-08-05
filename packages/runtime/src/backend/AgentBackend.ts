export interface AgentBackendConfig {
  name: string;
  role?: string;
  focus?: string;
  workingDirectory: string;
  systemPrompt?: string;
  allowedTools?: string[];
  mcpServers?: Record<string, unknown>;
}

export type BackendEvent =
  | { kind: "text"; content: string }
  | { kind: "system"; content: string }
  | { kind: "stderr"; content: string }
  | {
      kind: "toolCall";
      toolCallId: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  | { kind: "result"; costUsd: number; tokensUsed: number; sessionId?: string };

/**
 * What a backend can actually do. Backends differ — the UI asks rather than
 * assuming, so a capability gap degrades visibly instead of failing at runtime.
 */
export interface BackendCapabilities {
  mcp: boolean;
  interrupt: boolean;
  cost: boolean;
}

export interface AgentBackend {
  readonly capabilities: BackendCapabilities;
  run(prompt: string, signal: AbortSignal): AsyncIterable<BackendEvent>;
  dispose(): Promise<void>;
}
