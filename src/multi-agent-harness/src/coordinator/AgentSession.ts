import { EventEmitter } from "events";
import {
  AgentStatus,
  ChatMessage,
  AgentOutput,
  McpServerConfig,
} from "./types";
import {
  createExtensionMcpServer,
  getExtensionToolNames,
} from "../mcp/ExtensionMcpServer";
import {
  AgentBackend,
  BackendSession,
  AgentMessage,
  createBackend,
} from "../backends";

export interface AgentConfig {
  name: string;
  role?: string;
  focus?: string;
  color?: string;
  workingDirectory: string;
  systemPrompt?: string;
  allowedTools?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  initialStatus?: AgentStatus;
  outputChannel?: { appendLine: (value: string) => void };
  pathToClaudeCodeExecutable?: string;
  backend?: AgentBackend; // Optional, will create default Claude backend if not provided
}

/**
 * AgentSession wraps AI backend for individual agent instances.
 *
 * Key responsibilities:
 * - Uses backend abstraction layer (Claude Agent SDK, Copilot SDK, etc.)
 * - Maintains conversation history (_messages)
 * - Tracks session ID, cost, and status
 * - Supports pause/resume with pending prompt queue
 * - Has injectNotification() for system messages that bypass pause
 * - Emits events: 'output', 'statusChanged', 'error'
 * - Processes backend messages and extracts text, tool calls, results
 * - Builds system prompt with agent identity and multi-agent instructions
 */
export class AgentSession extends EventEmitter {
  private _status: AgentStatus;
  private _sessionId?: string;
  private _abortController?: AbortController;
  private _isPaused = false;
  private _pendingPrompt?: string;
  private _costUsd = 0;
  private _messages: ChatMessage[] = [];
  private _currentTask?: string;
  private _tokensUsed = 0;
  private _waitingFor: string[] = [];
  private _backend: AgentBackend;
  private _backendSession?: BackendSession;
  private _ownsBackend: boolean;

  constructor(private readonly config: AgentConfig) {
    super();
    this._status = config.initialStatus || "initializing";
    
    // Use provided backend or create a default Claude backend
    if (config.backend) {
      this._backend = config.backend;
      this._ownsBackend = false;
    } else {
      this._backend = createBackend('claude', {
        pathToClaudeCodeExecutable: config.pathToClaudeCodeExecutable,
      });
      this._ownsBackend = true;
    }
    
    // Log which backend is being used
    console.log(`[${this.config.name}] Using backend: ${this._backend.name} (${this._backend.type})`);
  }

  get name(): string {
    return this.config.name;
  }

  get role(): string {
    return this.config.role || "Agent";
  }

  get focus(): string {
    return this.config.focus || "";
  }

  get color(): string {
    return this.config.color || "#3B82F6";
  }

  get status(): AgentStatus {
    return this._status;
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  get costUsd(): number {
    return this._costUsd;
  }

  get messages(): ChatMessage[] {
    return [...this._messages];
  }

  get isPaused(): boolean {
    return this._isPaused;
  }

  get currentTask(): string | undefined {
    return this._currentTask;
  }

  get tokensUsed(): number {
    return this._tokensUsed;
  }

  get waitingFor(): string[] {
    return [...this._waitingFor];
  }

  /**
   * Send a prompt to the agent. If the agent is paused, the prompt will be queued.
   */
  async sendPrompt(prompt: string): Promise<void> {
    // Check pause state and set status atomically to avoid race conditions
    if (this._isPaused) {
      this._pendingPrompt = prompt;
      return;
    }

    // Set processing status before any async operations
    this._status = "processing";
    this.emit("statusChanged", this._status);

    // Add user message
    this._messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
      timestamp: new Date(),
    });

    this._abortController = new AbortController();

    try {
      // Create backend session if it doesn't exist
      if (!this._backendSession) {
        // Create extension MCP server with LSP, Mail, and Claims tools
        const extensionMcpServer = await createExtensionMcpServer(this.config.name);

        // Combine extension MCP server with any configured servers
        const mcpServers = {
          "vscode-extension": extensionMcpServer,
          ...this.config.mcpServers,
        };

        // Allow all extension-provided tools without permission prompts
        const extensionTools = getExtensionToolNames();
        const allowedTools = [
          ...extensionTools,
          ...(this.config.allowedTools ?? []),
        ];

        this._backendSession = await this._backend.createSession({
          workingDirectory: this.config.workingDirectory,
          systemPrompt: this.buildSystemPrompt(),
          allowedTools,
          mcpServers,
          settingSources: ["user", "project", "local"],
          permissionMode: "acceptEdits",
          stderr: (data: string) => {
            const line = `[${this.config.name} stderr] ${data}`;
            if (this.config.outputChannel) {
              this.config.outputChannel.appendLine(line);
            }
            console.error(line);
          },
        });
      }

      // Send prompt through backend session
      for await (const message of this._backendSession.send(prompt, { 
        abortController: this._abortController 
      })) {
        const output = this.processBackendMessage(message);
        if (output) {
          this.emit("output", output);
        }
      }

      this._status = "idle";
      this.emit("statusChanged", this._status);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[${this.config.name}] Agent error: ${errorMessage}`);

      if ((error as Error).name === "AbortError") {
        this._status = "paused";
      } else {
        this._status = "error";
        this.emit("error", error);
      }
      this.emit("statusChanged", this._status);
    }
  }

  /**
   * Inject a system notification that bypasses pause state.
   * This is used for inter-agent messages and coordinator notifications.
   */
  async injectNotification(message: string): Promise<void> {
    try {
      // System notifications bypass pause
      const systemMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "system",
        content: message,
        timestamp: new Date(),
      };
      this._messages.push(systemMessage);
      this.emit("output", { type: "system", content: message });

      // Send as a prompt
      await this.sendPrompt(`[SYSTEM NOTIFICATION]\n${message}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[${this.config.name}] Failed to inject notification: ${errorMessage}`);
      this.emit("error", error instanceof Error ? error : new Error(errorMessage));
    }
  }

  /**
   * Pause the agent. Current operation will be aborted and any new prompts will be queued.
   */
  pause(): void {
    this._isPaused = true;
    this._abortController?.abort();
    this._status = "paused";
    this.emit("statusChanged", this._status);
  }

  /**
   * Resume the agent. If there's a pending prompt, it will be sent.
   */
  async resume(): Promise<void> {
    this._isPaused = false;
    this._status = "idle";
    this.emit("statusChanged", this._status);

    if (this._pendingPrompt) {
      const prompt = this._pendingPrompt;
      this._pendingPrompt = undefined;
      await this.sendPrompt(prompt);
    }
  }

  /**
   * Stop the current operation without pausing (agent goes to idle).
   */
  stop(): void {
    this._abortController?.abort();
    this._abortController = undefined;
    this._status = "idle";
    this.emit("statusChanged", this._status);
  }

  /**
   * Dispose of all resources
   */
  async dispose(): Promise<void> {
    this.stop();
    
    // Destroy backend session
    if (this._backendSession) {
      await this._backendSession.destroy();
      this._backendSession = undefined;
    }
    
    // Dispose backend if we own it
    if (this._ownsBackend) {
      await this._backend.dispose();
    }
    
    this.removeAllListeners();
  }

  /**
   * Build the system prompt with agent identity and multi-agent instructions.
   */
  private buildSystemPrompt(): string {
    const parts: string[] = [];

    if (this.config.role) {
      parts.push(`You are ${this.config.role}.`);
    }

    parts.push(`Your agent name is "${this.config.name}".`);

    parts.push(`You are part of a multi-agent team coordinated by an orchestrator.

## Inter-Agent Communication
- Use send_message() to communicate with other agents or the orchestrator
- Use inbox() to check for messages from other agents
- Always send a completion report to the orchestrator when your task is done

## File Coordination
- Use reserve_file_paths() BEFORE editing files to avoid conflicts with other agents
- Use get_claims() to see what files other agents are working on
- Use release_claims() when you're done with your files

## Code Intelligence (LSP)
You have access to IDE-level code intelligence:
- lsp_go_to_definition(): Find where a symbol is defined
- lsp_find_references(): Find all usages of a symbol
- lsp_hover(): Get type info and documentation
- lsp_document_symbols(): List all symbols in a file
- lsp_workspace_symbols(): Search for symbols across the codebase
- lsp_incoming_calls(): Find what calls a function
- lsp_outgoing_calls(): Find what a function calls
- lsp_get_diagnostics(): Get errors/warnings for a file

Use these tools to understand code structure before making changes.

## Memory & Learning
When you discover important information, save it for future sessions:
- memory_save_fact(category, statement): Save facts about the codebase
  Categories: "architecture", "patterns", "gotchas", "dependencies", "conventions"
- memory_record_lesson(lesson): Record debugging insights or lessons learned
- memory_save_playbook(title, description, steps, tags): Save reusable procedures

ALWAYS memorize when you:
1. Fix a tricky bug → save the root cause as a "gotcha" fact
2. Discover non-obvious patterns → save as "patterns" or "architecture" fact
3. Find initialization dependencies → save as "gotcha" fact
4. Complete a multi-step procedure → save as a playbook

## User Stories (Kanban)
You may be assigned to a User Story on the Kanban board. Use these tools:
- list_workitems(): See all stories and find yours (look for your name as assignee)
- add_workitem_note(id, note): Add progress updates to your assigned story
- move_workitem(id, status): Move your story when done:
  - "code-review" = ready for review
  - "done" = fully complete

IMPORTANT: When you complete your task:
1. Add a completion note to your story with add_workitem_note()
2. Move your story to "code-review" or "done" with move_workitem()
3. Send a completion message to the orchestrator`);

    if (this.config.systemPrompt) {
      parts.push(this.config.systemPrompt);
    }

    return parts.join("\n\n");
  }

  /**
   * Process backend messages and extract text, tool calls, and results.
   * Returns AgentOutput objects that get emitted as events.
   */
  private processBackendMessage(message: AgentMessage): AgentOutput | null {
    try {
      switch (message.type) {
        case "text":
          if (!message.content) {
            if (this.config.outputChannel) {
              this.config.outputChannel.appendLine(`[${this.config.name}] Warning: Text message has no content`);
            }
            return null;
          }

          const chatMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: message.content,
            timestamp: new Date(),
          };
          this._messages.push(chatMsg);
          return { type: "text", content: message.content };

        case "toolCall":
          if (!message.toolCall) {
            if (this.config.outputChannel) {
              this.config.outputChannel.appendLine(`[${this.config.name}] Warning: Tool call message missing toolCall data`);
            }
            return null;
          }

          const toolMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "tool",
            content: `Using ${message.toolCall.name}`,
            timestamp: new Date(),
            toolCall: {
              id: message.toolCall.id,
              name: message.toolCall.name,
              arguments: message.toolCall.arguments,
            },
          };
          this._messages.push(toolMsg);
          return {
            type: "toolCall",
            id: message.toolCall.id,
            name: message.toolCall.name,
            arguments: message.toolCall.arguments,
          };

        case "complete":
          if (message.sessionId) {
            this._sessionId = message.sessionId;
          }
          if (message.costUsd !== undefined) {
            this._costUsd += message.costUsd;
          }
          return {
            type: "complete",
            result: message.result,
            sessionId: message.sessionId,
            costUsd: message.costUsd,
            durationMs: message.durationMs,
          };

        case "error":
          const error = message.error || new Error("Unknown backend error");
          if (this.config.outputChannel) {
            this.config.outputChannel.appendLine(`[${this.config.name}] Backend error: ${error.message}`);
          }
          console.error(`[${this.config.name}] Backend error:`, error);
          this.emit("error", error);
          return null;

        case "toolResult":
          // Tool results are handled internally by the backend
          // We don't need to emit them as output
          if (this.config.outputChannel) {
            this.config.outputChannel.appendLine(`[${this.config.name}] Received tool result`);
          }
          return null;

        default:
          // Log ignored message types for debugging
          if (this.config.outputChannel) {
            this.config.outputChannel.appendLine(`[${this.config.name}] Ignoring message type: ${(message as any).type}`);
          }
          return null;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (this.config.outputChannel) {
        this.config.outputChannel.appendLine(`[${this.config.name}] Error processing message: ${errorMessage}`);
      }
      console.error(`[${this.config.name}] Error processing message:`, error);
    }

    return null;
  }
}
