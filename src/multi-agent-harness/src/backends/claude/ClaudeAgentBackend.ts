/**
 * Claude Agent SDK backend implementation
 * 
 * Wraps @anthropic-ai/claude-agent-sdk to provide the AgentBackend interface.
 * This allows the multi-agent harness to use Claude as one of several possible backends.
 */

import * as crypto from 'crypto';
import {
  AgentBackend,
  BackendSession,
  SessionConfig,
  BackendType,
  BackendOptions,
} from '../types';
import { ClaudeSession } from './ClaudeSession';
import { convertToolsToClaudeFormat } from './claudeToolAdapter';

/**
 * Claude Agent SDK backend implementation
 * 
 * Features:
 * - Uses @anthropic-ai/claude-agent-sdk's query() function
 * - Supports MCP servers via createSdkMcpServer()
 * - Supports tool definitions
 * - Logs with [Claude Backend] prefix for clarity
 */
export class ClaudeAgentBackend implements AgentBackend {
  readonly type: BackendType = 'claude';
  readonly name: string = 'Claude Agent SDK';

  private _isDisposed = false;
  private _activeSessions: Set<ClaudeSession> = new Set();

  constructor(private readonly options?: BackendOptions) {
    console.log(`[Claude Backend] Initializing Claude Agent SDK backend`);
    if (options?.pathToClaudeCodeExecutable) {
      console.log(
        `[Claude Backend] Using custom Claude executable: ${options.pathToClaudeCodeExecutable}`
      );
    }
  }

  /**
   * Create a new session for agent communication
   */
  async createSession(config: SessionConfig): Promise<BackendSession> {
    if (this._isDisposed) {
      throw new Error('[Claude Backend] Backend has been disposed');
    }

    console.log(`[Claude Backend] Creating session with config:`, {
      sessionId: config.sessionId,
      workingDirectory: config.workingDirectory,
      model: config.model,
      toolCount: config.tools?.length || 0,
      mcpServers: config.mcpServers ? Object.keys(config.mcpServers) : [],
    });

    // Generate session ID if not provided
    const sessionId = config.sessionId || crypto.randomUUID();

    // Build Claude SDK options
    const queryOptions: any = {
      cwd: config.workingDirectory,
      systemPrompt: config.systemPrompt,
      allowedTools: config.allowedTools,
      mcpServers: config.mcpServers,
      settingSources: config.settingSources || ['user', 'project', 'local'],
      permissionMode: config.permissionMode || 'acceptEdits',
      stderr: config.stderr,
    };

    // Add model if specified
    if (config.model) {
      queryOptions.model = config.model;
      console.log(`[Claude Backend] Using model: ${config.model}`);
    }

    // Add path to Claude executable if specified
    if (this.options?.pathToClaudeCodeExecutable) {
      queryOptions.pathToClaudeCodeExecutable = this.options.pathToClaudeCodeExecutable;
    }

    // Convert tools to Claude format if provided
    if (config.tools && config.tools.length > 0) {
      console.log(`[Claude Backend] Converting ${config.tools.length} tools to Claude format`);
      try {
        const claudeTools = await convertToolsToClaudeFormat(config.tools);
        queryOptions.tools = claudeTools;
        console.log(`[Claude Backend] Converted ${claudeTools.length} tools successfully`);
      } catch (error) {
        console.error(
          `[Claude Backend] Failed to convert tools:`,
          error instanceof Error ? error.message : String(error)
        );
        throw error;
      }
    }

    // Merge backend-specific options
    if (config.backendOptions) {
      Object.assign(queryOptions, config.backendOptions);
      console.log(`[Claude Backend] Applied backend-specific options:`, Object.keys(config.backendOptions));
    }

    // Create the session
    const session = new ClaudeSession(sessionId, queryOptions);
    this._activeSessions.add(session);

    console.log(`[Claude Backend] Session created successfully: ${sessionId}`);
    return session;
  }

  /**
   * Dispose of all resources and cleanup
   */
  async dispose(): Promise<void> {
    if (this._isDisposed) {
      return;
    }

    console.log(`[Claude Backend] Disposing backend with ${this._activeSessions.size} active sessions`);

    // Destroy all active sessions
    const destroyPromises = Array.from(this._activeSessions).map(async (session) => {
      try {
        await session.destroy();
        this._activeSessions.delete(session);
      } catch (error) {
        console.error(
          `[Claude Backend] Error destroying session ${session.id}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    });

    await Promise.all(destroyPromises);

    this._isDisposed = true;
    console.log(`[Claude Backend] Backend disposed successfully`);
  }

  /**
   * Get the number of active sessions
   */
  get activeSessionCount(): number {
    return this._activeSessions.size;
  }

  /**
   * Check if backend is disposed
   */
  get isDisposed(): boolean {
    return this._isDisposed;
  }
}
