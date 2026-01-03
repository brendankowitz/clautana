import * as vscode from "vscode";
import { EventEmitter } from "events";
import { AgentPool } from "./AgentPool";
import { OrchestratorMessage } from "./types";

// Define local types for SDK (will use dynamic import for the actual SDK functions)
type SettingSource = "user" | "project" | "local";

type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk';

type Options = {
  abortController?: AbortController;
  cwd?: string;
  model?: string;
  allowedTools?: string[];
  permissionMode?: PermissionMode;
  mcpServers?: Record<string, any>; // Use any for SDK compatibility
  settingSources?: SettingSource[];
  systemPrompt?: string;
  stderr?: (data: string) => void;
  [key: string]: any; // Allow additional properties
};

type SDKMessage = any; // Will be from the SDK
type Query = AsyncGenerator<SDKMessage, void>;

/**
 * System prompt for the orchestrator agent
 *
 * HIERARCHY:
 * - Feature = ADR/Investigation document (read-only reference in docs/features/)
 * - User Story = Discrete unit of work tracked on Kanban board (.clautana/workitems/)
 * - Task = Ephemeral in-memory todo items agents work on (TodoWrite)
 */
const ORCHESTRATOR_SYSTEM_PROMPT = `You are an orchestrating agent that manages work through a Kanban board stored in .clautana/workitems/.

## CRITICAL: USE ONLY MCP TOOLS

You MUST use the MCP tools provided (mcp__orchestrator-tools__*), NOT built-in Claude Code tools.
- Use spawn_agent (NOT Task tool) to create agents
- Use create_workitem (NOT TodoWrite) to create User Stories
- Use memory_save_fact (NOT any other memory tool) to save learnings

NEVER use: Task, TodoWrite, or other built-in tools. Always use the orchestrator-tools MCP equivalents.

## WORK HIERARCHY

1. **Features** = ADR/Investigation documents in docs/features/{feature-name}/
   - Read-only references representing approved architectural decisions
   - User Stories can link to Features via featureRef

2. **User Stories** = Work items on the Kanban board (.clautana/workitems/)
   - Discrete units of work (1-2 hours each)
   - Created with create_workitem
   - Link to Features using featureRef when working on ADR/investigation tasks

3. **Tasks** = Ephemeral agent todos (TodoWrite tool)
   - In-memory only, used by agents for sub-task tracking
   - Automatically managed by agents during work

## CRITICAL RULES

1. ALWAYS use create_workitem to create User Stories - NEVER use TodoWrite (that's for agent Tasks)
2. Every User Story must be created before an agent starts work
3. When working on ADR/investigation features, set featureRef to link the story

## YOUR USER STORY TOOLS

- **create_workitem**: Create a new User Story in the todo column
  Parameters: title, description, priority, tags[], estimatedHours, featureRef (optional)
  Use featureRef when the story implements an ADR/investigation, e.g., "docs/features/kanban-workitems"

- **list_workitems**: See all User Stories on the board (optionally filter by status)
- **assign_workitem**: Assign an agent to a User Story
- **move_workitem**: Move story between columns (todo/doing/code-review/done)

## YOUR AGENT TOOLS

- spawn_agent: Create a specialist agent with name, role, focus, systemPrompt, workItemId
  **IMPORTANT**: Pass workItemId to auto-assign and move the User Story to "doing"
- destroy_agent: Remove a completed agent
- message_agent: Send instructions to a running agent
- get_agent_status: Check status of all agents
- report_to_user: Send progress updates to the user

## WORKFLOW EXAMPLE

1. User asks: "Implement the kanban-workitems feature from the ADR"
2. You call: create_workitem(
     title="Implement WorkItem persistence",
     description="...",
     priority="high",
     tags=["kanban","backend"],
     featureRef="docs/features/kanban-workitems"
   ) → Returns: WI-2026-001
3. You call: create_workitem(
     title="Add Kanban board UI",
     description="...",
     priority="high",
     tags=["kanban","frontend"],
     featureRef="docs/features/kanban-workitems"
   ) → Returns: WI-2026-002
4. You call: spawn_agent(
     name="KanbanBackend",
     role="Backend Engineer",
     focus="WorkItem persistence",
     workItemId="WI-2026-001"  ← AUTO-ASSIGNS and moves to "doing"
   )
5. You call: spawn_agent(
     name="KanbanUI",
     role="Frontend Engineer",
     focus="Kanban board UI",
     workItemId="WI-2026-002"
   )

## MEMORY & LEARNING

When you or your agents discover important information, ALWAYS save it for future sessions:

- **memory_save_fact**: Save important facts about the codebase
  Categories: "architecture", "patterns", "gotchas", "dependencies", "conventions"
  Example: memory_save_fact(category="gotchas", statement="WorkItemManager.listItems() calls ensureInitialized() which can cause deadlock if called during initialize()")

- **memory_record_lesson**: Record lessons learned from debugging or problem-solving
  Example: memory_record_lesson(lesson="When adding async initialization, avoid calling public methods that check initialization state")

- **memory_save_playbook**: Save reusable procedures
  Example: memory_save_playbook(title="Adding a new MCP tool", steps=["1. Create tool in src/mcp/", "2. Export from ExtensionMcpServer", ...])

WHEN TO MEMORIZE:
1. After fixing a tricky bug → record the root cause and solution as a fact/lesson
2. When discovering non-obvious code patterns → save as a fact
3. When finding initialization order dependencies → save as a gotcha
4. When completing a multi-step process → save as a playbook
5. When an agent reports important findings → have them save it or save it yourself

## INBOX & MESSAGING

You have an inbox for receiving messages from agents. Check your inbox regularly, especially:
- At the start of a session
- After spawning agents
- When agents complete their work

**inbox**: Check your inbox for messages. Use unreadOnly=true to see only unread messages.
**read_message**: Read a specific message by ID. Automatically marks it as read.
**reply_to_message**: Reply to a message from an agent.
**mark_message_read**: Mark a message as read without reading full content.
**archive_message**: Archive a message after processing it (moves from inbox to archive).
**archived_messages**: View previously archived messages.

When you receive a message:
1. Read it using read_message
2. Take appropriate action based on the content
3. Archive the message using archive_message to keep your inbox organized

You're working in the codebase at: {workingDirectory}
`;

/**
 * OrchestratorAgent is a Claude-powered coordinator that analyzes tasks and spawns specialist agents.
 *
 * Responsibilities:
 * - Analyzes incoming tasks from the user
 * - Plans work breakdown and spawns specialist agents
 * - Coordinates handoffs between agents
 * - Monitors progress and adjusts as needed
 * - Reports results back to the user
 *
 * Special tools available:
 * - spawn_agent: Create a new specialist agent
 * - destroy_agent: Shut down an agent that's done
 * - message_agent: Send instructions to a running agent
 * - get_agent_status: Check status of all agents
 * - report_to_user: Send updates to the user
 *
 * Events emitted:
 * - statusChanged: When orchestrator status changes ("idle" | "processing" | "error")
 * - message: When a new message is added to the conversation
 * - agentSpawned: When a new agent is spawned
 * - agentDestroyed: When an agent is destroyed
 * - reportToUser: When the orchestrator reports to the user
 * - error: When an error occurs
 */
export class OrchestratorAgent extends EventEmitter {
  private readonly outputChannel: vscode.OutputChannel;
  private isProcessing = false;
  private _sessionId?: string;
  private _abortController?: AbortController;
  private _messages: OrchestratorMessage[] = [];
  private _messageQueue: string[] = [];
  private _isProcessingQueue = false;
  private workItemWatcherInitialized = false;
  private _contextTokens = 0;
  private _maxContextTokens = 200000; // Sonnet 4 context window

  constructor(
    _context: vscode.ExtensionContext,
    private readonly agentPool: AgentPool
  ) {
    super();
    this.outputChannel = vscode.window.createOutputChannel("Multi-Agent Orchestrator");
  }

  /**
   * Get current context usage (0-100%)
   */
  get contextUsage(): number {
    return Math.min(100, Math.round((this._contextTokens / this._maxContextTokens) * 100));
  }

  /**
   * Estimate tokens for a string (rough approximation: ~4 chars per token)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Get the current session ID
   */
  get sessionId(): string | undefined {
    return this._sessionId;
  }

  /**
   * Get a copy of all messages in the orchestrator conversation
   */
  get messages(): OrchestratorMessage[] {
    return [...this._messages];
  }

  /**
   * Handle a user task submission
   * Messages are queued and processed in order, allowing users to submit
   * new messages while the orchestrator is still processing previous ones.
   */
  async handleUserTask(task: string): Promise<void> {
    // Add user message to the conversation immediately (for UI feedback)
    this._messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: task,
      timestamp: new Date(),
    });

    // Track token usage for context indicator
    this._contextTokens += this.estimateTokens(task);
    this.emit("contextUsageChanged", this.contextUsage);

    this.emit("message", this._messages[this._messages.length - 1]);

    // Queue the task for processing
    this._messageQueue.push(task);

    // If already processing, the queued message will be picked up
    if (this._isProcessingQueue) {
      vscode.window.showInformationMessage(`Message queued (${this._messageQueue.length} pending)`);
      return;
    }

    // Start processing the queue
    await this.processMessageQueue();
  }

  /**
   * Process messages from the queue one at a time
   */
  private async processMessageQueue(): Promise<void> {
    if (this._isProcessingQueue) return;
    this._isProcessingQueue = true;

    while (this._messageQueue.length > 0) {
      const task = this._messageQueue.shift()!;
      await this.processTask(task);
    }

    this._isProcessingQueue = false;
  }

  /**
   * Process a single task (internal implementation)
   */
  private async processTask(task: string): Promise<void> {
    this.outputChannel.appendLine(`[DEBUG] processTask starting: "${task.substring(0, 50)}..."`);
    this.outputChannel.show(); // Force show the output channel

    this.isProcessing = true;
    this.emit("statusChanged", "processing");

    // Initialize work item watcher on first task
    if (!this.workItemWatcherInitialized) {
      this.outputChannel.appendLine("[DEBUG] About to init work item watcher...");
      await this.initWorkItemWatcher();
      this.workItemWatcherInitialized = true;
      this.outputChannel.appendLine("[DEBUG] Work item watcher init complete");
    }

    const config = vscode.workspace.getConfiguration("clautana");
    const model = config.get<string>("coordinatorModel") ?? "claude-sonnet-4-20250514";

    try {
      // Dynamic import for ES module SDK
      const { query, createSdkMcpServer } = await import("@anthropic-ai/claude-agent-sdk");
      const { createMemoryMcpTools } = await import("../mcp/MemoryMcpServer");
      const { createMailMcpTools } = await import("../mcp/MailMcpServer");

      // Get orchestrator tools, memory tools, and mail tools
      const orchestratorTools = await this.getOrchestratorMcpTools();
      const memoryTools = await createMemoryMcpTools();
      const mailTools = await createMailMcpTools("orchestrator");

      // Create MCP server for custom orchestrator tools (includes memory and mail)
      const orchestratorMcpServer = createSdkMcpServer({
        name: "orchestrator-tools",
        version: "1.0.0",
        tools: [...orchestratorTools, ...memoryTools, ...mailTools],
      });

      // Merge with user-configured MCP servers
      const mcpServers = {
        "orchestrator-tools": orchestratorMcpServer,
        ...this.getMcpServers(),
      };

      this.outputChannel.appendLine(`Starting orchestrator with model: ${model}`);
      this.outputChannel.appendLine(`Working directory: ${this.getWorkingDirectory()}`);
      this.outputChannel.appendLine(`Queue depth: ${this._messageQueue.length}`);

      // Allow all orchestrator MCP tools without permission prompts
      const allowedTools = [
        // Agent management
        'mcp__orchestrator-tools__spawn_agent',
        'mcp__orchestrator-tools__destroy_agent',
        'mcp__orchestrator-tools__message_agent',
        'mcp__orchestrator-tools__get_agent_status',
        'mcp__orchestrator-tools__report_to_user',
        // User Stories (Kanban)
        'mcp__orchestrator-tools__create_workitem',
        'mcp__orchestrator-tools__list_workitems',
        'mcp__orchestrator-tools__assign_workitem',
        'mcp__orchestrator-tools__move_workitem',
        // Memory & Learning
        'mcp__orchestrator-tools__memory_search_playbooks',
        'mcp__orchestrator-tools__memory_get_playbook',
        'mcp__orchestrator-tools__memory_save_playbook',
        'mcp__orchestrator-tools__memory_search_facts',
        'mcp__orchestrator-tools__memory_save_fact',
        'mcp__orchestrator-tools__memory_search_sessions',
        'mcp__orchestrator-tools__memory_get_recent_sessions',
        'mcp__orchestrator-tools__memory_record_lesson',
        // Mail tools
        'mcp__orchestrator-tools__inbox',
        'mcp__orchestrator-tools__read_message',
        'mcp__orchestrator-tools__mark_message_read',
        'mcp__orchestrator-tools__send_message',
        'mcp__orchestrator-tools__sent_messages',
        'mcp__orchestrator-tools__delete_message',
        'mcp__orchestrator-tools__reply_to_message',
        'mcp__orchestrator-tools__archive_message',
        'mcp__orchestrator-tools__archived_messages',
      ];

      const options: Options = {
        model,
        cwd: this.getWorkingDirectory(),
        systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT.replace(
          "{workingDirectory}",
          this.getWorkingDirectory()
        ),
        mcpServers,
        allowedTools,
        permissionMode: 'acceptEdits',
        abortController: this._abortController = new AbortController(),
        settingSources: ['user'],
        // Resume the session if we have one (enables multi-turn conversation)
        ...(this._sessionId && { resume: this._sessionId }),
        stderr: (data: string) => {
          this.outputChannel.appendLine(`[Claude Code stderr] ${data}`);
        },
      };

      const result: Query = query({
        prompt: task,
        options,
      });

      // Process messages as they stream in
      for await (const message of result) {
        await this.processOrchestratorMessage(message);
      }

      this.isProcessing = false;

      // If there are more messages in the queue, show "processing" status
      if (this._messageQueue.length > 0) {
        this.emit("statusChanged", `processing (${this._messageQueue.length} queued)`);
      } else {
        this.emit("statusChanged", "idle");
      }
    } catch (error) {
      this.isProcessing = false;
      this.emit("statusChanged", "error");

      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.outputChannel.appendLine(`\n=== ORCHESTRATOR ERROR ===`);
      this.outputChannel.appendLine(`Error: ${errorMessage}`);
      if (errorStack) {
        this.outputChannel.appendLine(`Stack: ${errorStack}`);
      }
      this.outputChannel.show();

      this._messages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Error: ${errorMessage}`,
        timestamp: new Date(),
      });
      this.emit("message", this._messages[this._messages.length - 1]);

      vscode.window.showErrorMessage(`Orchestrator error: ${errorMessage}`);
      this.emit("error", error);
    }
  }

  /**
   * Process a message from the Claude Agent SDK
   */
  private async processOrchestratorMessage(message: SDKMessage): Promise<void> {
    try {
      // Handle assistant messages
      if (message.type === "assistant") {
        // Add null safety check
        if (!message.message?.content) {
          this.outputChannel.appendLine("Warning: Assistant message has no content");
          return;
        }

        const content = message.message.content;
        for (const block of content) {
          if (block.type === "text" && block.text) {
            this._messages.push({
              id: crypto.randomUUID(),
              role: "assistant",
              content: block.text,
              timestamp: new Date(),
            });

            // Track token usage for context indicator
            this._contextTokens += this.estimateTokens(block.text);
            this.emit("contextUsageChanged", this.contextUsage);

            this.emit("message", this._messages[this._messages.length - 1]);
          }

          if (block.type === "tool_use") {
            // Tool calls are handled by MCP server, but we can log them
            this.outputChannel.appendLine(
              `Tool call: ${block.name ?? 'unknown'} ${JSON.stringify(block.input ?? {})}`
            );
          }
        }
      }

      // Handle result messages
      if (message.type === "result") {
        this._sessionId = message.session_id;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`Error processing orchestrator message: ${errorMessage}`);
      this.emit("error", error);
    }
  }


  /**
   * Get the MCP tools available to the orchestrator
   */
  private async getOrchestratorMcpTools(): Promise<any[]> {
    // Import zod for schema definition
    const { z } = await import("zod");
    const { tool } = await import("@anthropic-ai/claude-agent-sdk");

    return [
      tool(
        "spawn_agent",
        "Create a new specialist agent to work on a specific part of the task. Optionally assign a User Story.",
        {
          name: z.string().describe("Unique name for this agent (e.g., 'R6Parser', 'ApiRefactor')"),
          role: z.string().describe("What this agent specializes in (e.g., 'Core Parser Engineer')"),
          focus: z.string().describe("Specific task this agent should accomplish"),
          systemPrompt: z.string().optional().describe("Detailed instructions for the agent (optional)"),
          waitFor: z.array(z.string()).optional().describe("Names of agents this one should wait for before starting"),
          priority: z.number().optional().describe("Execution priority (lower = start sooner)"),
          workItemId: z.string().optional().describe("User Story ID to assign to this agent (auto-assigns and moves to 'doing')"),
        },
        async (args) => {
          // If workItemId provided, assign and move to doing
          if (args.workItemId) {
            const { getWorkItemManager } = await import("../kanban");
            const workItemManager = getWorkItemManager();
            await workItemManager.updateItem(args.workItemId, { assignee: args.name });
            await workItemManager.moveItem(args.workItemId, 'doing');
            this.outputChannel.appendLine(`Assigned User Story ${args.workItemId} to ${args.name} and moved to doing`);
          }

          await this.agentPool.spawnAgent({
            name: args.name,
            role: args.role,
            focus: args.focus,
            systemPrompt: args.systemPrompt ?? `You are a ${args.role}. Your focus: ${args.focus}`,
            waitFor: args.waitFor ?? [],
            priority: args.priority ?? 0,
            workingDirectory: this.getWorkingDirectory(),
            workItemId: args.workItemId,
          });

          this.emit("agentSpawned", args.name);
          const storyInfo = args.workItemId ? ` (assigned to ${args.workItemId})` : '';
          vscode.window.showInformationMessage(`Spawned agent: ${args.name} (${args.role})${storyInfo}`);

          return {
            content: [{ type: "text", text: `Successfully spawned agent: ${args.name}${storyInfo}` }],
          };
        }
      ),
      tool(
        "destroy_agent",
        "Shut down an agent that has completed its work or is no longer needed",
        {
          name: z.string().describe("Agent name to shut down"),
          reason: z.string().describe("Why (completed, no longer needed, error)"),
        },
        async (args) => {
          await this.agentPool.destroyAgent(args.name);
          this.emit("agentDestroyed", args.name);
          this.outputChannel.appendLine(`Destroyed ${args.name}: ${args.reason}`);

          return {
            content: [{ type: "text", text: `Successfully destroyed agent: ${args.name}` }],
          };
        }
      ),
      tool(
        "message_agent",
        "Send instructions or updates to a running agent",
        {
          name: z.string().describe("Target agent name"),
          message: z.string().describe("Message to send"),
        },
        async (args) => {
          await this.agentPool.messageAgent(args.name, args.message);

          return {
            content: [{ type: "text", text: `Message sent to agent: ${args.name}` }],
          };
        }
      ),
      tool(
        "get_agent_status",
        "Get the current status of all running agents",
        {},
        async () => {
          const status = this.agentPool.getStatus();
          this.outputChannel.appendLine(`Agent status: ${JSON.stringify(status, null, 2)}`);

          return {
            content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
          };
        }
      ),
      tool(
        "report_to_user",
        "Send a progress update or final report to the user",
        {
          type: z.enum(["progress", "complete", "error", "question"]).describe("Type of report"),
          message: z.string().describe("The update message"),
        },
        async (args) => {
          this._messages.push({
            id: crypto.randomUUID(),
            role: "orchestrator",
            content: args.message,
            timestamp: new Date(),
            reportType: args.type,
          });
          this.emit("message", this._messages[this._messages.length - 1]);
          this.emit("reportToUser", { type: args.type, message: args.message });

          // Show VS Code notification for important updates
          if (args.type === "complete") {
            vscode.window.showInformationMessage(args.message);
          } else if (args.type === "error") {
            vscode.window.showErrorMessage(args.message);
          }

          return {
            content: [{ type: "text", text: `Report sent to user: ${args.message}` }],
          };
        }
      ),
      tool(
        "create_workitem",
        "Create a new User Story on the Kanban board in the todo column. Link to a Feature using featureRef when implementing ADR/investigation work.",
        {
          title: z.string().describe("Short title for the User Story"),
          description: z.string().describe("Detailed description of the work to be done"),
          priority: z.enum(["critical", "high", "medium", "low"]).optional().describe("Priority level (default: medium)"),
          tags: z.array(z.string()).optional().describe("Tags for categorization"),
          estimatedHours: z.number().optional().describe("Estimated hours to complete"),
          featureRef: z.string().optional().describe("Reference to parent feature folder (e.g., 'docs/features/kanban-workitems'). Use when implementing ADR/investigation features."),
        },
        async (args) => {
          const { getWorkItemManager } = await import("../kanban");
          const workItemManager = getWorkItemManager();

          const item = await workItemManager.createItem({
            title: args.title,
            description: args.description,
            priority: args.priority ?? "medium",
            tags: args.tags ?? [],
            estimatedHours: args.estimatedHours,
            featureRef: args.featureRef,
          });

          const featureInfo = item.featureRef ? ` (Feature: ${item.featureRef})` : '';
          this.outputChannel.appendLine(`Created User Story: ${item.id} - ${item.title}${featureInfo}`);

          return {
            content: [{ type: "text", text: `Created User Story ${item.id}: ${item.title}${featureInfo}` }],
          };
        }
      ),
      tool(
        "list_workitems",
        "List all User Stories on the Kanban board",
        {
          status: z.enum(["todo", "doing", "code-review", "done", "cancelled"]).optional().describe("Filter by status"),
        },
        async (args) => {
          const { getWorkItemManager } = await import("../kanban");
          const workItemManager = getWorkItemManager();

          const items = await workItemManager.listItems(args.status);

          const summary = items.map((item: any) => {
            const feature = item.featureRef ? ` [Feature: ${item.featureRef}]` : '';
            return `[${item.status}] ${item.id}: ${item.title} (Priority: ${item.priority}, Assignee: ${item.assignee || 'unassigned'})${feature}`;
          }).join('\n');

          this.outputChannel.appendLine(`User Stories:\n${summary}`);

          return {
            content: [{ type: "text", text: `User Stories:\n${summary}` }],
          };
        }
      ),
      tool(
        "assign_workitem",
        "Assign a User Story to a specific agent",
        {
          itemId: z.string().describe("User Story ID to assign"),
          agentName: z.string().describe("Name of the agent to assign to this story"),
        },
        async (args) => {
          const { getWorkItemManager } = await import("../kanban");
          const workItemManager = getWorkItemManager();

          await workItemManager.updateItem(args.itemId, {
            assignee: args.agentName,
          });

          this.outputChannel.appendLine(`Assigned User Story ${args.itemId} to ${args.agentName}`);

          return {
            content: [{ type: "text", text: `Assigned User Story ${args.itemId} to ${args.agentName}` }],
          };
        }
      ),
      tool(
        "move_workitem",
        "Move a User Story to a different column on the Kanban board",
        {
          itemId: z.string().describe("User Story ID to move"),
          status: z.enum(["todo", "doing", "code-review", "done", "cancelled"]).describe("Target status/column"),
        },
        async (args) => {
          const { getWorkItemManager } = await import("../kanban");
          const workItemManager = getWorkItemManager();

          await workItemManager.moveItem(args.itemId, args.status);

          this.outputChannel.appendLine(`Moved User Story ${args.itemId} to ${args.status}`);

          return {
            content: [{ type: "text", text: `Moved User Story ${args.itemId} to ${args.status}` }],
          };
        }
      ),
    ];
  }

  /**
   * Get MCP server configuration
   */
  private getMcpServers(): Record<string, any> {
    const config = vscode.workspace.getConfiguration("clautana");
    const userServers = config.get<Record<string, any>>("mcpServers") ?? {};

    // Filter and convert to SDK format
    // SDK expects: { type: 'stdio'|'sse'|'http', command/url, args/headers }
    // Our config uses: { transport: 'stdio'|'http', command/url, args }
    const sdkServers: Record<string, any> = {};

    for (const [name, serverConfig] of Object.entries(userServers)) {
      if (!serverConfig) continue;

      // Convert our transport format to SDK type format
      if (serverConfig.transport === 'stdio' && serverConfig.command) {
        sdkServers[name] = {
          type: 'stdio',
          command: serverConfig.command,
          args: serverConfig.args,
          env: serverConfig.env,
        };
      } else if (serverConfig.transport === 'http' && serverConfig.url) {
        sdkServers[name] = {
          type: 'http',
          url: serverConfig.url,
          headers: serverConfig.headers,
        };
      } else if (serverConfig.type) {
        // Already in SDK format
        sdkServers[name] = serverConfig;
      }
      // Skip invalid configs
    }

    return sdkServers;
  }

  /**
   * Get the working directory for agents
   */
  private getWorkingDirectory(): string {
    const config = vscode.workspace.getConfiguration("clautana");
    const configured = config.get<string>("workingDirectory");
    if (configured) {
      return configured;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    return workspaceFolder?.uri.fsPath ?? process.cwd();
  }

  /**
   * Get the number of pending messages in the queue
   */
  get queueDepth(): number {
    return this._messageQueue.length;
  }

  /**
   * Check if the orchestrator is currently processing
   */
  get processing(): boolean {
    return this.isProcessing;
  }

  /**
   * Clear all pending messages from the queue
   */
  clearQueue(): void {
    const cleared = this._messageQueue.length;
    this._messageQueue = [];
    if (cleared > 0) {
      vscode.window.showInformationMessage(`Cleared ${cleared} pending message(s)`);
    }
  }

  /**
   * Initialize the work item watcher to respond to Kanban board events
   */
  private async initWorkItemWatcher(): Promise<void> {
    this.outputChannel.appendLine("[DEBUG] initWorkItemWatcher: importing kanban module...");
    const { getWorkItemManager } = await import("../kanban");
    this.outputChannel.appendLine("[DEBUG] initWorkItemWatcher: got getWorkItemManager");
    const workItemManager = getWorkItemManager();
    this.outputChannel.appendLine("[DEBUG] initWorkItemWatcher: got workItemManager instance");

    // Explicitly initialize with workspace path
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    this.outputChannel.appendLine(`[DEBUG] initWorkItemWatcher: workspaceFolder = ${workspaceFolder?.uri?.fsPath ?? 'null'}`);
    if (workspaceFolder) {
      try {
        this.outputChannel.appendLine("[DEBUG] initWorkItemWatcher: calling initialize...");
        await workItemManager.initialize(workspaceFolder.uri.fsPath);
        this.outputChannel.appendLine(`WorkItemManager initialized with: ${workspaceFolder.uri.fsPath}`);
      } catch (error) {
        this.outputChannel.appendLine(`Failed to initialize WorkItemManager: ${error}`);
      }
    }

    // Watch for items moving to code-review - spawn reviewer
    workItemManager.on('itemMoved', async (item: any, _oldStatus: any, newStatus: any) => {
      if (newStatus === 'code-review' && !item.reviewer) {
        await this.spawnReviewerForItem(item);
      }
    });

    // Handle cancelled items - destroy associated agent
    workItemManager.on('itemCancelled', async (item: any) => {
      if (item.assignee) {
        await this.agentPool.destroyAgent(item.assignee);
      }
    });

    this.outputChannel.appendLine("Work item watcher initialized");
  }

  /**
   * Spawn a code reviewer agent for a work item that has moved to code-review
   */
  private async spawnReviewerForItem(item: any): Promise<void> {
    const reviewer = await this.agentPool.spawnAgent({
      name: `${item.id}-Reviewer`,
      role: 'Code Reviewer',
      focus: `Review: ${item.title}`,
      systemPrompt: `You are a code reviewer. Review the changes for work item ${item.id}: "${item.title}".
Check for:
- Code quality and best practices
- Potential bugs or issues
- Test coverage
- Documentation

When done, move the item to 'done' if approved, or back to 'doing' with notes if changes needed.`,
      workingDirectory: this.getWorkingDirectory(),
      waitFor: [],
      priority: 0,
    });

    // Assign as reviewer
    const { getWorkItemManager } = await import("../kanban");
    await getWorkItemManager().updateItem(item.id, { reviewer: reviewer.name });

    this.outputChannel.appendLine(`Spawned reviewer ${reviewer.name} for work item ${item.id}`);
  }

  /**
   * Stop the orchestrator and clear the queue
   */
  stop(): void {
    this._abortController?.abort();
    this.clearQueue();
    this.isProcessing = false;
    this._isProcessingQueue = false;
    this.emit("statusChanged", "idle");
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.stop();
    this._abortController = undefined;
    this.removeAllListeners();
    this.outputChannel.dispose();
  }
}
