/**
 * Copilot SDK backend implementation
 * 
 * Wraps @github/copilot-sdk to provide the AgentBackend interface.
 * This allows the multi-agent harness to use GitHub Copilot as a backend.
 * 
 * Reference: https://github.com/github/copilot-sdk
 */

import * as crypto from 'crypto';
import {
  AgentBackend,
  BackendSession,
  SessionConfig,
  BackendType,
  BackendOptions,
} from '../types';
import { CopilotSession } from './CopilotSession';
import { convertToolsToCopilotFormat } from './copilotToolAdapter';

/**
 * Interface for the Copilot SDK client
 */
interface CopilotSdkClient {
  start(): Promise<void>;
  stop(): Promise<Error[]>;
  createSession(config: {
    sessionId?: string;
    model?: string;
    tools?: unknown[];
    systemMessage?: { content?: string; mode?: 'append' | 'replace' };
  }): Promise<unknown>;
  getState(): string;
}

/**
 * Copilot SDK backend implementation
 * 
 * Features:
 * - Uses @github/copilot-sdk's CopilotClient
 * - Supports multiple models (GPT-5, Claude via Copilot)
 * - Converts tools from ToolDefinition to Copilot's defineTool() format
 * - Logs with [Copilot Backend] prefix for clarity
 * - Manages Copilot CLI lifecycle
 */
export class CopilotBackend implements AgentBackend {
  readonly type: BackendType = 'copilot';
  readonly name: string = 'GitHub Copilot SDK';

  private _client?: CopilotSdkClient;
  private _isDisposed = false;
  private _activeSessions: Set<CopilotSession> = new Set();
  private _isStarting = false;
  private _startPromise?: Promise<void>;

  constructor(private readonly options?: BackendOptions) {
    console.log(`[Copilot Backend] Initializing GitHub Copilot SDK backend`);
    if (options?.pathToCopilotExecutable) {
      console.log(
        `[Copilot Backend] Using custom Copilot executable: ${options.pathToCopilotExecutable}`
      );
    }
  }

  /**
   * Ensure the Copilot client is started
   */
  private async ensureStarted(): Promise<void> {
    if (this._client) {
      return;
    }

    // Prevent multiple concurrent starts
    if (this._isStarting && this._startPromise) {
      await this._startPromise;
      return;
    }

    this._isStarting = true;
    this._startPromise = this._doStart();
    
    try {
      await this._startPromise;
    } finally {
      this._isStarting = false;
      this._startPromise = undefined;
    }
  }

  /**
   * Actually start the Copilot client
   */
  private async _doStart(): Promise<void> {
    console.log(`[Copilot Backend] Starting Copilot client...`);

    // Check if Copilot CLI is available
    const copilotAvailable = await this.checkCopilotCli();
    if (!copilotAvailable) {
      throw new Error(
        '[Copilot Backend] Copilot CLI not found. Please install it: https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli'
      );
    }

    try {
      // Dynamic import of the Copilot SDK
      const { CopilotClient } = await import('@github/copilot-sdk');

      const clientOptions: Record<string, unknown> = {
        autoStart: false,  // We'll start manually for better control
        autoRestart: true,
        logLevel: 'info',
      };

      if (this.options?.pathToCopilotExecutable) {
        clientOptions.cliPath = this.options.pathToCopilotExecutable;
      }

      this._client = new CopilotClient(clientOptions) as unknown as CopilotSdkClient;
      await this._client.start();

      console.log(`[Copilot Backend] Copilot client started successfully`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Copilot Backend] Failed to start Copilot client:`, message);
      throw new Error(`[Copilot Backend] Failed to start: ${message}`);
    }
  }

  /**
   * Check if Copilot CLI is available in PATH
   */
  private async checkCopilotCli(): Promise<boolean> {
    console.log(`[Copilot Backend] Checking for Copilot CLI...`);

    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Try to get copilot version
      const copilotPath = this.options?.pathToCopilotExecutable || 'copilot';
      await execAsync(`${copilotPath} --version`);
      
      console.log(`[Copilot Backend] Copilot CLI found`);
      return true;
    } catch {
      console.warn(`[Copilot Backend] Copilot CLI not found in PATH`);
      return false;
    }
  }

  /**
   * Create a new session for agent communication
   */
  async createSession(config: SessionConfig): Promise<BackendSession> {
    if (this._isDisposed) {
      throw new Error('[Copilot Backend] Backend has been disposed');
    }

    // Ensure client is started
    await this.ensureStarted();

    if (!this._client) {
      throw new Error('[Copilot Backend] Client failed to initialize');
    }

    console.log(`[Copilot Backend] Creating session with config:`, {
      sessionId: config.sessionId,
      workingDirectory: config.workingDirectory,
      model: config.model || 'gpt-5',
      toolCount: config.tools?.length || 0,
    });

    // Generate session ID if not provided
    const sessionId = config.sessionId || crypto.randomUUID();

    // Convert tools to Copilot format
    let copilotTools: unknown[] = [];
    if (config.tools && config.tools.length > 0) {
      console.log(`[Copilot Backend] Converting ${config.tools.length} tools to Copilot format`);
      try {
        const { defineTool } = await import('@github/copilot-sdk');
        
        const convertedTools = convertToolsToCopilotFormat(config.tools);
        copilotTools = convertedTools.map(tool => 
          defineTool(tool.name, {
            description: tool.description,
            parameters: tool.parameters,
            handler: tool.handler,
          })
        );
        
        console.log(`[Copilot Backend] Converted ${copilotTools.length} tools`);
      } catch (err) {
        console.error(`[Copilot Backend] Failed to convert tools:`, err);
        // Continue without tools rather than failing
        copilotTools = [];
      }
    }

    // Build session config
    const sdkSessionConfig: Record<string, unknown> = {
      sessionId,
      model: config.model || 'gpt-5',
      tools: copilotTools,
    };

    // Add system message if provided
    if (config.systemPrompt) {
      sdkSessionConfig.systemMessage = {
        content: config.systemPrompt,
        mode: 'append',  // Append to default CLI persona
      };
    }

    // Create SDK session
    try {
      const sdkSession = await this._client.createSession(sdkSessionConfig);
      
      // Wrap in our CopilotSession
      const session = new CopilotSession(sessionId, {
        model: config.model,
      });
      
      // Attach the SDK session
      session.setSdkSession(sdkSession as any);
      
      this._activeSessions.add(session);
      
      console.log(`[Copilot Backend] Session created successfully: ${sessionId}`);
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Copilot Backend] Failed to create session:`, message);
      throw new Error(`[Copilot Backend] Session creation failed: ${message}`);
    }
  }

  /**
   * Dispose of all resources and cleanup
   */
  async dispose(): Promise<void> {
    if (this._isDisposed) {
      return;
    }

    console.log(`[Copilot Backend] Disposing backend with ${this._activeSessions.size} active sessions`);

    // Destroy all active sessions
    const destroyPromises = Array.from(this._activeSessions).map(async (session) => {
      try {
        await session.destroy();
        this._activeSessions.delete(session);
      } catch (error) {
        console.error(
          `[Copilot Backend] Error destroying session ${session.id}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    });

    await Promise.all(destroyPromises);

    // Stop the client
    if (this._client) {
      try {
        console.log(`[Copilot Backend] Stopping Copilot client...`);
        const errors = await this._client.stop();
        if (errors.length > 0) {
          console.warn(`[Copilot Backend] Errors during client stop:`, errors);
        }
      } catch (err) {
        console.error(`[Copilot Backend] Error stopping client:`, err);
      }
      this._client = undefined;
    }

    this._isDisposed = true;
    console.log(`[Copilot Backend] Backend disposed successfully`);
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

  /**
   * Check if the Copilot client is connected
   */
  get isConnected(): boolean {
    return this._client !== undefined;
  }
}
