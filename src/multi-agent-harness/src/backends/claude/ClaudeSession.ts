/**
 * Claude Agent SDK session implementation
 * 
 * Wraps the Claude Agent SDK's query() function and converts its
 * async iterator to the BackendSession interface.
 */

import { BackendSession, AgentMessage, SendOptions, BackendType } from '../types';

/**
 * Claude SDK message types (from @anthropic-ai/claude-agent-sdk)
 */
interface ClaudeSDKMessage {
  type: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  session_id?: string;
  result?: unknown;
  total_cost_usd?: number;
  duration_ms?: number;
}

/**
 * Options for Claude SDK query() function
 */
interface ClaudeQueryOptions {
  abortController?: AbortController;
  cwd?: string;
  model?: string;
  allowedTools?: string[];
  permissionMode?: string;
  mcpServers?: Record<string, any>;
  settingSources?: string[];
  systemPrompt?: string;
  stderr?: (data: string) => void;
  pathToClaudeCodeExecutable?: string;
  [key: string]: any;
}

/**
 * Claude Agent SDK session implementation
 */
export class ClaudeSession implements BackendSession {
  readonly backendType: BackendType = 'claude';
  private _abortController?: AbortController;
  private _isDestroyed = false;

  constructor(
    public readonly id: string,
    private readonly options: ClaudeQueryOptions
  ) {
    console.log(`[Claude Backend] Session created: ${id}`);
  }

  /**
   * Send a prompt and receive streaming responses
   */
  async *send(prompt: string, options?: SendOptions): AsyncIterable<AgentMessage> {
    if (this._isDestroyed) {
      console.error(`[Claude Backend] Attempted to send on destroyed session: ${this.id}`);
      throw new Error('Session has been destroyed');
    }

    console.log(`[Claude Backend] Sending prompt to session ${this.id}`);

    // Use provided abort controller or create a new one
    this._abortController = options?.abortController || new AbortController();

    try {
      // Dynamic import of Claude SDK
      const { query } = await import('@anthropic-ai/claude-agent-sdk');

      // Merge abort controller into options
      const queryOptions: any = {
        ...this.options,
        abortController: this._abortController,
      };

      console.log(`[Claude Backend] Starting query with options:`, {
        cwd: queryOptions.cwd,
        model: queryOptions.model,
        allowedTools: queryOptions.allowedTools?.length,
        mcpServers: Object.keys(queryOptions.mcpServers || {}),
      });

      // Call Claude SDK query function
      const result = query({
        prompt,
        options: queryOptions,
      });

      // Convert Claude SDK messages to AgentMessage format
      for await (const sdkMessage of result) {
        const messages = this.convertMessage(sdkMessage);
        for (const message of messages) {
          yield message;
        }
      }

      console.log(`[Claude Backend] Query completed for session ${this.id}`);
    } catch (error) {
      console.error(
        `[Claude Backend] Query failed for session ${this.id}:`,
        error instanceof Error ? error.message : String(error)
      );

      // Yield error message
      yield {
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
        _backend: 'claude',
      };
    }
  }

  /**
   * Abort the current operation
   */
  async abort(): Promise<void> {
    console.log(`[Claude Backend] Aborting session ${this.id}`);
    this._abortController?.abort();
  }

  /**
   * Destroy the session and cleanup resources
   */
  async destroy(): Promise<void> {
    console.log(`[Claude Backend] Destroying session ${this.id}`);
    this._isDestroyed = true;
    await this.abort();
  }

  /**
   * Convert Claude SDK message to AgentMessage format(s)
   * 
   * A single Claude message can contain multiple content blocks,
   * so this returns an array of AgentMessages.
   */
  private convertMessage(sdkMessage: any): AgentMessage[] {
    const messages: AgentMessage[] = [];
    const claudeMsg = sdkMessage as ClaudeSDKMessage;

    try {
      switch (claudeMsg.type) {
        case 'assistant':
          if (claudeMsg.message?.content) {
            for (const block of claudeMsg.message.content) {
              if (block.type === 'text' && block.text) {
                messages.push({
                  type: 'text',
                  content: block.text,
                  _backend: 'claude',
                });
              } else if (block.type === 'tool_use' && block.id && block.name) {
                messages.push({
                  type: 'toolCall',
                  toolCall: {
                    id: block.id,
                    name: block.name,
                    arguments: block.input ?? {},
                  },
                  _backend: 'claude',
                });
              }
            }
          }
          break;

        case 'result':
          messages.push({
            type: 'complete',
            result: claudeMsg.result,
            sessionId: claudeMsg.session_id,
            costUsd: claudeMsg.total_cost_usd,
            durationMs: claudeMsg.duration_ms,
            _backend: 'claude',
          });
          break;

        default:
          // Log but don't emit unknown message types
          console.log(`[Claude Backend] Ignoring message type: ${claudeMsg.type}`);
          break;
      }
    } catch (error) {
      console.error(
        `[Claude Backend] Error converting message:`,
        error instanceof Error ? error.message : String(error)
      );
      messages.push({
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
        _backend: 'claude',
      });
    }

    return messages;
  }
}
