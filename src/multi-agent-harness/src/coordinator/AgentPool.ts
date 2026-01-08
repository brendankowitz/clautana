import * as vscode from "vscode";
import { EventEmitter } from "events";
import { AgentSession } from "./AgentSession";
import { getGlobalClaimsTracker } from "../mcp/ClaimsMcpServer";
import { AgentMailClient } from "../mcp/AgentMailClient";
import { generateUniqueAgentName } from "../utils/agentNaming";
import {
  SpawnConfig,
  AgentPoolStatus,
  AgentOutput,
  ToolCallOutput,
  FileClaim,
  AgentMessage,
  McpServerConfig,
  ExtendedAgentConfig,
} from "./types";

/**
 * Default color palette for agents
 */
const DEFAULT_COLOR_PALETTE = [
  "#3B82F6", // Blue
  "#EF4444", // Red
  "#F59E0B", // Amber
  "#10B981", // Emerald
  "#8B5CF6", // Violet
  "#EC4899", // Pink
  "#06B6D4", // Cyan
  "#84CC16", // Lime
];

/**
 * AgentPool manages a collection of AgentSession instances.
 *
 * Responsibilities:
 * - Maintains Map of AgentSession instances
 * - Enforces maxConcurrentAgents limit from configuration
 * - Handles dependency tracking (waitFor) with pendingAgents queue
 * - Spawns agents with doSpawnAgent() when dependencies are satisfied
 * - Creates placeholder sessions for waiting agents
 * - Routes send_message tool calls to recipient agents via injectNotification
 * - Tracks file claims via ClaimsTracker
 * - Assigns colors from palette to new agents
 *
 * Events emitted:
 * - agentSpawned: When a new agent session is created
 * - agentDestroyed: When an agent is destroyed
 * - agentStatusChanged: When an agent's status changes
 * - agentOutput: When an agent produces output
 * - agentError: When an agent encounters an error
 * - claimsUpdated: When file claims change
 * - messageReceived: When an inter-agent message is sent
 */
export class AgentPool extends EventEmitter {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly pendingAgents = new Map<string, SpawnConfig>();
  private readonly claimsTracker;
  private readonly outputChannel: vscode.OutputChannel;
  private colorIndex = 0;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_context: vscode.ExtensionContext) {
    super();
    this.outputChannel = vscode.window.createOutputChannel("Multi-Agent Pool");
    // Use the global claims tracker shared with MCP tools
    this.claimsTracker = getGlobalClaimsTracker();

    // Forward claims events from the tracker
    this.claimsTracker.on("claimsUpdated", (claims) => {
      this.emit("claimsUpdated", claims);
    });
  }

  /**
   * Spawn a new agent with the given configuration.
   * If dependencies (waitFor) are not satisfied, the agent will be queued.
   */
  async spawnAgent(config: SpawnConfig): Promise<AgentSession> {
    // Check resource limits
    const maxAgents = this.getMaxConcurrentAgents();

    if (this.sessions.size >= maxAgents) {
      throw new Error(`Maximum concurrent agents (${maxAgents}) reached`);
    }

    // Generate unique name if the provided name already exists
    let uniqueName = config.name;
    if (this.sessions.has(config.name) || this.pendingAgents.has(config.name)) {
      const existingNames = new Set([
        ...this.sessions.keys(),
        ...this.pendingAgents.keys(),
      ]);
      uniqueName = generateUniqueAgentName(config.name, existingNames);
      this.outputChannel.appendLine(
        `Agent name '${config.name}' already exists, using unique name: ${uniqueName}`
      );
      // Update config with the unique name
      config = { ...config, name: uniqueName };
    }

    // Check if dependencies are satisfied
    // An agent is waiting if the dependency doesn't exist yet OR if it exists but isn't complete
    const unsatisfied = config.waitFor.filter(
      (dep) => !this.sessions.has(dep) || this.sessions.get(dep)!.status !== "complete"
    );

    if (unsatisfied.length > 0) {
      // Queue for later
      this.pendingAgents.set(config.name, config);
      this.outputChannel.appendLine(
        `${config.name} queued, waiting for: ${unsatisfied.join(", ")}`
      );
      return this.createPlaceholderSession(config);
    }

    return this.doSpawnAgent(config);
  }

  /**
   * Actually spawn an agent (dependencies satisfied)
   */
  private async doSpawnAgent(config: SpawnConfig): Promise<AgentSession> {
    const color = this.getNextColor();
    const userMcpServers = this.getMcpServers();

    // Create extension MCP server with all clautana tools (work items, memory, etc.)
    const { createExtensionMcpServer } = await import("../mcp/ExtensionMcpServer");
    const extensionMcpServer = await createExtensionMcpServer(config.name);

    // Merge extension server with user-configured servers
    const mcpServers = {
      clautana: extensionMcpServer,
      ...userMcpServers,
    };

    const sessionConfig: ExtendedAgentConfig = {
      name: config.name,
      role: config.role,
      focus: config.focus,
      systemPrompt: this.buildAgentSystemPrompt(config),
      workingDirectory: config.workingDirectory,
      mcpServers,
      color,
      outputChannel: this.outputChannel,
    };

    const session = new AgentSession(sessionConfig);

    // Wire up event handlers
    session.on("output", (output: AgentOutput) => {
      this.handleAgentOutput(config.name, output);
    });

    session.on("statusChanged", (status: string) => {
      this.emit("agentStatusChanged", config.name, status);

      // Check if any pending agents can now start
      if (status === "complete" || status === "idle") {
        this.checkPendingAgents(config.name);
      }
    });

    session.on("error", (error: Error) => {
      this.outputChannel.appendLine(`[${config.name}] Error: ${error.message}`);
      this.emit("agentError", config.name, error);
    });

    this.sessions.set(config.name, session);
    this.emit("agentSpawned", session);

    // Start the agent with its focus task
    await session.sendPrompt(
      `Your task: ${config.focus}\n\nBegin working on this now. Claim any files you need to edit.`
    );

    return session;
  }

  /**
   * Build the system prompt for an agent
   */
  private buildAgentSystemPrompt(config: SpawnConfig): string {
    const workItemInfo = config.workItemId
      ? `\nYour assigned User Story: ${config.workItemId}
When you complete your task:
1. Call add_workitem_note("${config.workItemId}", "your summary") to document what you did
2. Call move_workitem("${config.workItemId}", "code-review") to mark as ready for review
3. Send a completion message to the orchestrator\n`
      : '';

    return `${config.systemPrompt}

Your agent name is "${config.name}".
Your role: ${config.role}
Your focus: ${config.focus}
${workItemInfo}
You are part of a multi-agent team coordinated by an orchestrator.
- Use send_message() to communicate with other agents
- Use inbox() to check for messages, then read_message(messageId) to read and respond to them
- Use reserve_file_paths() before editing files to avoid conflicts
- When your task is complete, send a message to the orchestrator summarizing your work

IMPORTANT: Periodically check and READ your messages throughout your work:
1. Call inbox() to see what messages you have
2. For each message, call read_message(messageId, markAsRead=true) to read the full content
3. Respond appropriately to the sender if they're waiting for information
4. Messages may contain critical information:
   - File coordination requests from other agents
   - Guidance or instructions from the orchestrator
   - Questions that block other agents' work
   - Updates that affect your task

Check your inbox:
- Before starting significant work
- After completing major subtasks
- If you're blocked or waiting on something
- At natural breakpoints in your workflow
`;
  }

  /**
   * Check if any pending agents can now start after an agent completes
   */
  private checkPendingAgents(completedAgent: string): void {
    for (const [name, config] of this.pendingAgents) {
      const stillWaiting = config.waitFor.filter(
        (dep) =>
          dep !== completedAgent &&
          this.sessions.has(dep) &&
          this.sessions.get(dep)!.status !== "complete"
      );

      if (stillWaiting.length === 0) {
        this.pendingAgents.delete(name);
        this.outputChannel.appendLine(`${name} dependencies satisfied, spawning...`);
        // Await the spawn to prevent race conditions
        void this.doSpawnAgent(config).catch((error) => {
          this.outputChannel.appendLine(`Error spawning ${name}: ${error instanceof Error ? error.message : String(error)}`);
          this.emit("agentError", name, error);
        });
      }
    }
  }

  /**
   * Create a placeholder session for an agent waiting on dependencies
   */
  private createPlaceholderSession(config: SpawnConfig): AgentSession {
    const sessionConfig: ExtendedAgentConfig = {
      name: config.name,
      role: config.role,
      focus: config.focus,
      systemPrompt: "",
      workingDirectory: config.workingDirectory,
      mcpServers: {},
      color: this.getNextColor(),
      initialStatus: "waiting",
    };

    const session = new AgentSession(sessionConfig);
    this.sessions.set(config.name, session);
    return session;
  }

  /**
   * Handle output from an agent, including routing messages
   */
  private handleAgentOutput(agentName: string, output: AgentOutput): void {
    this.emit("agentOutput", agentName, output);

    // Intercept tool calls for routing
    if (output.type === "toolCall") {
      this.handleToolCall(agentName, output as ToolCallOutput);
    }
  }

  /**
   * Handle tool calls from agents, routing messages and tracking claims
   */
  private async handleToolCall(agentName: string, toolCall: ToolCallOutput): Promise<void> {
    try {
      const { name, arguments: args } = toolCall;

      // Validate arguments exist
      if (!args || typeof args !== 'object') {
        this.outputChannel.appendLine(`Warning: Tool call ${name} has invalid arguments`);
        return;
      }

      // Route send_message to recipient
      if (name === "send_message") {
        // Validate required fields
        if (typeof args.to !== 'string' || typeof args.subject !== 'string') {
          this.outputChannel.appendLine(`Warning: send_message missing required fields`);
          return;
        }

        const to = args.to as string;
        const subject = args.subject as string;
        const body = (args.body as string | undefined) ?? '';

        const message: AgentMessage = {
          id: crypto.randomUUID(),
          from: agentName,
          to,
          subject,
          body,
          timestamp: new Date(),
          read: false,
        };

        this.emit("messageReceived", message);

        // Wake up recipient if it's another agent
        const recipient = this.sessions.get(to);
        if (recipient && recipient.status !== "waiting") {
          await recipient.injectNotification(
            `New message from ${agentName}.\nSubject: "${subject}"\nUse inbox() to read.`
          );
        }
      }

      // Track file claims
      if (name === "reserve_file_paths") {
        // Validate required fields
        if (!Array.isArray(args.paths)) {
          this.outputChannel.appendLine(`Warning: reserve_file_paths missing paths array`);
          return;
        }

        const paths = args.paths as string[];
        const exclusive = (args.exclusive as boolean | undefined) ?? false;
        const reason = (args.reason as string | undefined) ?? '';
        const ttl = (args.ttl as number | undefined) ?? 3600000; // Default 1 hour

        this.claimsTracker.addClaims(agentName, paths, exclusive, reason, ttl);
        this.emit("claimsUpdated", this.claimsTracker.getAllClaims());
      }

      // Release file claims
      if (name === "release_claims") {
        this.claimsTracker.releaseClaims(agentName);
        this.emit("claimsUpdated", this.claimsTracker.getAllClaims());
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`Error handling tool call from ${agentName}: ${errorMessage}`);
      this.emit("agentError", agentName, error instanceof Error ? error : new Error(errorMessage));
    }
  }

  /**
   * Destroy an agent by name
   */
  async destroyAgent(agentName: string): Promise<void> {
    const session = this.sessions.get(agentName);
    if (session) {
      await session.stop();
      // Clean up all event listeners to prevent memory leaks
      session.removeAllListeners();
      this.sessions.delete(agentName);
      this.claimsTracker.releaseClaims(agentName);
      this.emit("agentDestroyed", agentName);
      this.emit("claimsUpdated", this.claimsTracker.getAllClaims());
    }
    this.pendingAgents.delete(agentName);
  }

  /**
   * Send a message to an agent
   */
  async messageAgent(agentName: string, message: string): Promise<void> {
    const session = this.sessions.get(agentName);
    if (session) {
      // Create a message object for tracking
      const agentMessage: AgentMessage = {
        id: crypto.randomUUID(),
        from: "orchestrator",
        to: agentName,
        subject: message.length > 50 ? message.substring(0, 50) + "..." : message,
        body: message,
        timestamp: new Date(),
        read: false,
      };

      // Emit the message for UI updates
      this.emit("messageReceived", agentMessage);

      // Inject the notification to the agent
      await session.injectNotification(message);
    }
  }

  /**
   * Get an agent session by name
   */
  getAgent(name: string): AgentSession | undefined {
    return this.sessions.get(name);
  }

  /**
   * Get all active agent sessions
   */
  getAllAgents(): AgentSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get all current file claims
   */
  getAllClaims(): FileClaim[] {
    return this.claimsTracker.getAllClaims();
  }

  /**
   * Get the current status of the agent pool
   */
  getStatus(): AgentPoolStatus {
    return {
      activeAgents: Array.from(this.sessions.entries()).map(([name, session]) => ({
        name,
        role: session.role,
        status: session.status,
        focus: session.focus,
      })),
      pendingAgents: Array.from(this.pendingAgents.keys()),
      totalCost: Array.from(this.sessions.values()).reduce((sum, s) => sum + s.costUsd, 0),
    };
  }

  /**
   * Get the maximum concurrent agents from configuration
   */
  private getMaxConcurrentAgents(): number {
    const config = vscode.workspace.getConfiguration("multiAgent");
    return config.get<number>("maxConcurrentAgents") ?? 5;
  }

  /**
   * Get MCP server configuration converted to SDK format
   * Includes both user-configured servers and the clautana extension server
   */
  private getMcpServers(): Record<string, McpServerConfig> {
    const config = vscode.workspace.getConfiguration("clautana");
    const userServers = config.get<Record<string, any>>("mcpServers") ?? {};

    // Convert our transport format to SDK type format
    const sdkServers: Record<string, McpServerConfig> = {};

    // Note: The clautana extension MCP server is added in doSpawnAgent() via createExtensionMcpServer()

    for (const [name, serverConfig] of Object.entries(userServers)) {
      if (!serverConfig) continue;

      // Convert our transport format to SDK type format
      if (serverConfig.transport === "stdio" && serverConfig.command) {
        sdkServers[name] = {
          type: "stdio",
          command: serverConfig.command,
          args: serverConfig.args,
          env: serverConfig.env,
        };
      } else if (serverConfig.transport === "http" && serverConfig.url) {
        sdkServers[name] = {
          type: "http",
          url: serverConfig.url,
          headers: serverConfig.headers,
        };
      } else if (serverConfig.type) {
        // Already in SDK format
        sdkServers[name] = serverConfig as McpServerConfig;
      }
      // Skip invalid configs
    }

    return sdkServers;
  }

  /**
   * Get the next color from the palette for a new agent
   */
  private getNextColor(): string {
    const config = vscode.workspace.getConfiguration("multiAgent");
    const palette = config.get<string[]>("agentColorPalette") ?? DEFAULT_COLOR_PALETTE;
    const color = palette[this.colorIndex % palette.length];
    this.colorIndex++;
    return color;
  }

  /**
   * Ensure the Agent Mail server is running
   */
  async ensureAgentMailRunning(): Promise<void> {
    const client = new AgentMailClient();
    const isRunning = await client.healthCheck();
    if (!isRunning) {
      await client.start();
    }
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    for (const session of this.sessions.values()) {
      session.stop();
      session.removeAllListeners();
    }
    this.sessions.clear();
    this.pendingAgents.clear();
    this.removeAllListeners();
    this.outputChannel.dispose();
  }
}
