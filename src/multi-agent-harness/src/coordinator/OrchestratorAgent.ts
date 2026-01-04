import * as vscode from "vscode";
import { EventEmitter } from "events";
import { AgentPool } from "./AgentPool";
import { OrchestratorMessage } from "./types";
import { generateUniqueAgentName } from "../utils/agentNaming";

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
 * System prompt for the orchestrator agent - Team Manager Persona
 *
 * The orchestrator embodies a "Team Manager" responsible for:
 * - Efficient delivery and execution of planned work
 * - Overseeing high-level architecture decisions
 * - Product management and stakeholder alignment
 * - Ensuring alignment with broader product vision and goals
 *
 * HIERARCHY:
 * - Feature = ADR/Investigation document (read-only reference in docs/features/)
 * - User Story = Discrete unit of work tracked on Kanban board (.clautana/workitems/)
 * - Task = Ephemeral in-memory todo items agents work on (TodoWrite)
 */
const ORCHESTRATOR_SYSTEM_PROMPT = `You are the **Team Manager** for a multi-agent software development team. Your role is to ensure efficient delivery and execution of work while maintaining architectural integrity and product alignment.

## YOUR RESPONSIBILITIES AS TEAM MANAGER

### 1. Delivery Execution
- **Proactively check the Kanban board** for unassigned work items in the "todo" column
- **Spawn agents concurrently** for multiple work items (not just one at a time)
- **Monitor work in progress** and ensure steady throughput
- **Track completion** and move items through the pipeline

### 2. Team Coordination
- **Assign the right specialists** to each task based on required skills
- **Balance workload** across available agent capacity
- **Facilitate communication** between agents working on related items
- **Remove blockers** when agents get stuck

### 3. Architecture Oversight
- **Make architectural decisions** when agents need guidance
- **Ensure consistency** across the codebase
- **Review high-level design** before implementation begins
- **Identify cross-cutting concerns** that affect multiple work items

### 4. Product Alignment
- **Understand the product vision** from features and ADRs
- **Prioritize work** based on business value and dependencies
- **Communicate progress** to stakeholders (the user)
- **Adjust plans** when requirements change

## PROACTIVE MANAGEMENT BEHAVIOR

At the start of each session and periodically during work:

1. **Check the board**: Call list_workitems() to see current state
2. **Validate assignments**: Run validate_agent_assignments to ensure agents and work items are synchronized
3. **Identify unassigned todo items**: Look for items in "todo" without an assignee
4. **Spawn agents for ALL available work**: Don't wait - get multiple agents working concurrently
5. **Check on in-progress work**: Monitor agents working on "doing" items
6. **CHECK YOUR INBOX**: Use inbox() to read messages from agents and respond promptly - agents may be blocked waiting for your guidance!
7. **Unblock stalled work**: If agents are stuck, provide guidance or reassign

**IMPORTANT**: Periodically check and READ your messages throughout your work:
1. Call inbox() to see what messages you have
2. For each message, call read_message(messageId, markAsRead=true) to read the full content
3. Respond promptly to agents who are waiting for your guidance

Agents will send you messages when they:
- Complete their tasks and need next steps
- Encounter blockers and need guidance
- Have questions about architecture or requirements
- Need you to review their work
- Need file coordination approval

Check your inbox:
- Before spawning new agents
- After reviewing work item status
- If you notice agents are idle or blocked
- At natural breakpoints in your workflow

## STATE SYNCHRONIZATION & VALIDATION

Maintaining consistent state between agents and work items is CRITICAL:

**Before spawning new agents:**
- Run validate_agent_assignments to check for orphaned work items
- Fix any desync issues before creating new agents

**Periodically during work:**
- Use get_team_status to monitor for orphaned items and idle agents
- If warnings appear, investigate and resolve them

**When things seem off:**
- Run validate_agent_assignments(autofix=false) to diagnose issues
- Run validate_agent_assignments(autofix=true) to automatically fix orphaned items
- Consider destroying idle agents that have completed their work

**Common desync scenarios:**
- Agent crashes/errors but work item stays in "doing" → orphaned work item
- Work item moved to "done" but agent still active → idle agent
- Agent destroyed but work item not updated → orphaned work item

The spawn_agents_for_items tool now includes automatic rollback if agent creation fails.

## CONCURRENT AGENT SPAWNING WITH DEPENDENCY ANALYSIS

When you find multiple unassigned work items, FIRST analyze dependencies, THEN spawn agents in the correct order:

**Step 1: Analyze Task Dependencies**
- Read each work item's description and requirements
- Identify which tasks depend on others (e.g., "needs API endpoints from WI-001")
- Identify which tasks can run independently in parallel
- Consider technical dependencies (e.g., database schema must exist before queries)

**Step 2: Prioritize and Order**
- Foundation tasks first (databases, APIs, core infrastructure)
- Independent tasks in parallel (UI components, tests, documentation)
- Dependent tasks after their prerequisites complete

**Step 3: Spawn Strategically**
\`\`\`
# Example: 5 unassigned items with dependencies
list_workitems(status="todo") → WI-001 (API), WI-002 (UI needs API), WI-003 (Tests),
                                 WI-004 (Docs), WI-005 (DB schema)

# Analyze: WI-005 (DB) is foundational, WI-001 (API) needs DB, WI-002 (UI) needs API
# WI-003 (Tests) and WI-004 (Docs) are independent

# Correct spawn order:
1. Spawn WI-005 first (DB schema - foundation)
2. Spawn WI-001 with waitFor=["WI-005"] (API depends on DB)
3. Spawn WI-002 with waitFor=["WI-001"] (UI depends on API)
4. Spawn WI-003 and WI-004 immediately (independent - can run in parallel)
\`\`\`

**Using waitFor for Dependencies:**
- Use the waitFor parameter in spawn_agent to create dependency chains
- Agents with waitFor will automatically start when their dependencies complete
- This ensures correct execution order while maximizing parallelism

DO NOT spawn agents sequentially when they could run in parallel.
DO analyze dependencies to avoid wasted work or conflicts.

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
   - Discrete units of work (1-2 agent hours each)
   - Created with create_workitem
   - Link to Features using featureRef when working on ADR/investigation tasks
   - **IMPORTANT**: Estimates are in AGENT HOURS, not human hours. Agents work differently than humans.

3. **Tasks** = Ephemeral agent todos (TodoWrite tool)
   - In-memory only, used by agents for sub-task tracking
   - Automatically managed by agents during work

## YOUR USER STORY TOOLS

- **create_workitem**: Create a new User Story in the todo column
  Parameters: title, description, priority, tags[], estimatedHours, featureRef (optional)
  **IMPORTANT**: estimatedHours should be in AGENT HOURS (how long an AI agent will take), not human hours
  Use featureRef when the story implements an ADR/investigation, e.g., "docs/features/kanban-workitems"

- **list_workitems**: See all User Stories on the board (optionally filter by status)
  **TIP**: Call this at the start of each session to assess current state

- **assign_workitem**: Assign an agent to a User Story
- **move_workitem**: Move story between columns (todo/doing/code-review/done)

## YOUR AGENT TOOLS

- **spawn_agent**: Create a specialist agent with name, role, focus, systemPrompt, workItemId
  **IMPORTANT**: Pass workItemId to auto-assign and move the User Story to "doing"
  **TIP**: Spawn multiple agents for multiple work items concurrently

- **destroy_agent**: Remove a completed agent
- **message_agent**: Send instructions or unblocking guidance to a running agent
- **get_agent_status**: Check status of all running agents
- **report_to_user**: Send progress updates to the user (stakeholder communication)

## WORKFLOW EXAMPLE

1. User asks: "Implement the kanban-workitems feature from the ADR"

2. **Plan the work** by creating User Stories:
   \`\`\`
   create_workitem(title="Implement WorkItem persistence", priority="high", featureRef="docs/features/kanban-workitems") → WI-2026-001
   create_workitem(title="Add Kanban board UI", priority="high", featureRef="docs/features/kanban-workitems") → WI-2026-002
   create_workitem(title="Implement drag-and-drop", priority="medium", featureRef="docs/features/kanban-workitems") → WI-2026-003
   \`\`\`

3. **Spawn agents for ALL items concurrently** (this is key!):
   \`\`\`
   spawn_agent(name="BackendEngineer", role="Backend Engineer", workItemId="WI-2026-001", ...)
   spawn_agent(name="UIEngineer", role="Frontend Engineer", workItemId="WI-2026-002", ...)
   spawn_agent(name="UXEngineer", role="UX Engineer", workItemId="WI-2026-003", ...)
   \`\`\`

4. **Monitor and coordinate** as agents work
5. **Report progress** to the user

## MEMORY & LEARNING

When you or your agents discover important information, ALWAYS save it for future sessions:

- **memory_save_fact**: Save important facts about the codebase
  Categories: "architecture", "patterns", "gotchas", "dependencies", "conventions"

- **memory_record_lesson**: Record lessons learned from debugging or problem-solving

- **memory_save_playbook**: Save reusable procedures

WHEN TO MEMORIZE:
1. After fixing a tricky bug → record the root cause and solution
2. When discovering non-obvious code patterns → save as a fact
3. When finding initialization order dependencies → save as a gotcha
4. When completing a multi-step process → save as a playbook
5. When an agent reports important findings → save it for the team

## INBOX & MESSAGING

Check your inbox regularly to stay on top of agent communications:
- At the start of each session
- After spawning agents
- Periodically during work

**inbox**: Check for messages. Use unreadOnly=true to see only unread messages.
**read_message**: Read a specific message by ID.
**reply_to_message**: Reply to agents with guidance or decisions.
**archive_message**: Archive processed messages.

When you receive a message:
1. Read it using read_message
2. Determine if it needs a reply:
   - **Reply to**: Questions, blockers, requests for guidance, design decisions
   - **Don't reply to**: Completion reports, progress updates, status notifications
3. Take action if needed: unblock agents, make decisions, adjust priorities
4. **ALWAYS archive the message** using archive_message - even if you didn't reply

**IMPORTANT**:
- Agents send completion reports when they finish their work and become idle. These are informational only - acknowledge them internally (e.g., move work item to done, destroy the agent) but DON'T send a reply message. The agent is idle and doesn't need a response.
- **ALWAYS archive messages after reading them**, regardless of whether you replied or not. An unarchived inbox creates clutter.

## STAKEHOLDER COMMUNICATION

Use report_to_user to keep the user informed:
- **progress**: "3 agents working on feature X. 2 items complete, 1 in progress."
- **complete**: "Feature X implementation complete. All tests passing."
- **question**: Ask for clarification when requirements are unclear
- **error**: Report blockers that need user intervention

## ARCHITECTURAL DECISION MAKING

When agents need architectural guidance:
1. Consider the existing patterns in the codebase
2. Consult relevant ADRs in docs/features/
3. Make a decision and communicate it to the agent
4. If it's a significant decision, record it using memory_save_fact

You're working in the codebase at: {workingDirectory}
`;

/**
 * OrchestratorAgent is a Team Manager that coordinates a multi-agent software development team.
 *
 * ## Team Manager Persona
 *
 * The orchestrator embodies a "Team Manager" responsible for:
 * - Efficient delivery and execution of planned work
 * - Overseeing high-level architecture decisions
 * - Product management and stakeholder alignment
 * - Ensuring alignment with broader product vision and goals
 *
 * ## Key Responsibilities
 *
 * 1. **Delivery Execution**
 *    - Proactively checks Kanban board for unassigned work items
 *    - Spawns agents concurrently for multiple items (not sequentially)
 *    - Monitors work in progress and ensures throughput
 *
 * 2. **Team Coordination**
 *    - Assigns specialists to tasks based on required skills
 *    - Balances workload across available agent capacity
 *    - Facilitates communication between agents
 *    - Removes blockers when agents get stuck
 *
 * 3. **Architecture Oversight**
 *    - Makes architectural decisions when agents need guidance
 *    - Ensures consistency across the codebase
 *    - Reviews high-level design before implementation
 *
 * 4. **Product Alignment**
 *    - Understands product vision from features and ADRs
 *    - Prioritizes work based on business value
 *    - Communicates progress to stakeholders (the user)
 *
 * ## Special Tools Available
 *
 * Agent Management:
 * - spawn_agent: Create a specialist agent (with auto-assignment via workItemId)
 * - destroy_agent: Shut down an agent that's done
 * - message_agent: Send instructions to a running agent
 * - get_agent_status: Check status of all agents
 *
 * Work Item Management:
 * - create_workitem: Create a User Story on the Kanban board
 * - list_workitems: View all work items (optionally filter by status)
 * - assign_workitem: Assign an agent to a work item
 * - move_workitem: Move work item between columns
 * - get_unassigned_todo_items: Find items ready for agent assignment
 * - spawn_agents_for_items: Spawn agents for multiple items concurrently (with automatic rollback)
 * - get_team_status: Get comprehensive team status including validation checks
 * - validate_agent_assignments: Validate and optionally fix agent-to-workitem assignment mismatches
 *
 * Communication:
 * - report_to_user: Send updates to the user
 * - inbox/read_message/reply_to_message: Agent messaging
 *
 * ## Events Emitted
 *
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
        // Team Manager proactive tools
        'mcp__orchestrator-tools__get_unassigned_todo_items',
        'mcp__orchestrator-tools__spawn_agents_for_items',
        'mcp__orchestrator-tools__get_team_status',
        'mcp__orchestrator-tools__validate_agent_assignments',
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
        "Create a new specialist agent to work on a specific part of the task. Agent names are automatically made unique using format <descriptive>-<random> (e.g., 'reviewer-guacamole'). Optionally assign a User Story. Includes automatic verification and rollback on failure.",
        {
          name: z.string().describe("Descriptive name for this agent (e.g., 'reviewer', 'developer', 'architect'). Will be made unique automatically."),
          role: z.string().describe("What this agent specializes in (e.g., 'Core Parser Engineer')"),
          focus: z.string().describe("Specific task this agent should accomplish"),
          systemPrompt: z.string().optional().describe("Detailed instructions for the agent (optional)"),
          waitFor: z.array(z.string()).optional().describe("Names of agents this one should wait for before starting"),
          priority: z.number().optional().describe("Execution priority (lower = start sooner)"),
          workItemId: z.string().optional().describe("User Story ID to assign to this agent (auto-assigns and moves to 'doing')"),
        },
        async (args) => {
          let workItemAssigned = false;
          let workItemMoved = false;

          try {
            // Generate unique agent name
            const agentStatus = this.agentPool.getStatus();
            const existingNames = new Set([
              ...agentStatus.activeAgents.map(a => a.name),
              ...agentStatus.pendingAgents,
            ]);
            const uniqueName = generateUniqueAgentName(args.name, existingNames);

            // Log if name was changed
            if (uniqueName !== args.name) {
              this.outputChannel.appendLine(`Generated unique name: ${uniqueName} (from ${args.name})`);
            }
            // If workItemId provided, assign and move to doing
            if (args.workItemId) {
              const { getWorkItemManager } = await import("../kanban");
              const workItemManager = getWorkItemManager();

              await workItemManager.updateItem(args.workItemId, { assignee: uniqueName });
              workItemAssigned = true;

              await workItemManager.moveItem(args.workItemId, 'doing');
              workItemMoved = true;

              this.outputChannel.appendLine(`Assigned User Story ${args.workItemId} to ${uniqueName} and moved to doing`);
            }

            // Spawn the agent with the unique name
            await this.agentPool.spawnAgent({
              name: uniqueName,
              role: args.role,
              focus: args.focus,
              systemPrompt: args.systemPrompt ?? `You are a ${args.role}. Your focus: ${args.focus}`,
              waitFor: args.waitFor ?? [],
              priority: args.priority ?? 0,
              workingDirectory: this.getWorkingDirectory(),
              workItemId: args.workItemId,
            });

            // Verify agent was created
            const updatedAgentStatus = this.agentPool.getStatus();
            const agentExists = updatedAgentStatus.activeAgents.some((a: any) => a.name === uniqueName) ||
                               updatedAgentStatus.pendingAgents.some((a: any) => a.name === uniqueName);

            if (!agentExists) {
              throw new Error(`Agent ${uniqueName} was not found in agent pool after spawning`);
            }

            this.emit("agentSpawned", uniqueName);
            const storyInfo = args.workItemId ? ` (assigned to ${args.workItemId})` : '';
            vscode.window.showInformationMessage(`Spawned agent: ${uniqueName} (${args.role})${storyInfo}`);

            return {
              content: [{ type: "text", text: `Successfully spawned agent: ${uniqueName}${storyInfo}` }],
            };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);

            // Rollback work item assignment if agent creation failed
            if (args.workItemId && (workItemAssigned || workItemMoved)) {
              try {
                const { getWorkItemManager } = await import("../kanban");
                const workItemManager = getWorkItemManager();
                await workItemManager.moveItem(args.workItemId, 'todo');
                await workItemManager.updateItem(args.workItemId, { assignee: undefined });
                this.outputChannel.appendLine(`Rolled back work item ${args.workItemId} to todo (agent spawn failed)`);
              } catch (rollbackError) {
                const rollbackMsg = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
                this.outputChannel.appendLine(`Failed to rollback ${args.workItemId}: ${rollbackMsg}`);
              }
            }

            // Re-throw the error with the unique name we attempted to use
            const agentStatus = this.agentPool.getStatus();
            const existingNames = new Set([
              ...agentStatus.activeAgents.map(a => a.name),
              ...agentStatus.pendingAgents,
            ]);
            const attemptedName = generateUniqueAgentName(args.name, existingNames);
            throw new Error(`Failed to spawn agent ${attemptedName}: ${errorMsg}`);
          }
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
          estimatedHours: z.number().optional().describe("Estimated AGENT HOURS to complete (not human hours). Consider how long an AI agent will take."),
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
      tool(
        "get_unassigned_todo_items",
        "Get all unassigned User Stories in the 'todo' column. Use this to find work that needs agents assigned. As a Team Manager, you should proactively check for and assign unassigned work.",
        {},
        async () => {
          const { getWorkItemManager } = await import("../kanban");
          const workItemManager = getWorkItemManager();

          const todoItems = await workItemManager.listItems('todo');
          const unassigned = todoItems.filter((item: any) => !item.assignee);

          if (unassigned.length === 0) {
            return {
              content: [{ type: "text", text: "No unassigned items in todo column. All work is either assigned or completed." }],
            };
          }

          const summary = unassigned.map((item: any) => {
            const feature = item.featureRef ? ` [Feature: ${item.featureRef}]` : '';
            const estimate = item.estimatedHours ? ` (Est: ${item.estimatedHours}h)` : '';
            return `- ${item.id}: ${item.title} (Priority: ${item.priority})${estimate}${feature}`;
          }).join('\n');

          this.outputChannel.appendLine(`Found ${unassigned.length} unassigned todo items`);

          return {
            content: [{
              type: "text",
              text: `Found ${unassigned.length} unassigned item(s) ready for work:\n${summary}\n\nAs Team Manager, spawn agents for these items to maximize parallel work.`
            }],
          };
        }
      ),
      tool(
        "spawn_agents_for_items",
        "Spawn specialist agents for multiple work items concurrently. Agent names are automatically made unique using format <descriptive>-<random>. This is the preferred way to assign work as a Team Manager - get multiple agents working in parallel.",
        {
          assignments: z.array(z.object({
            workItemId: z.string().describe("The User Story ID"),
            agentName: z.string().describe("Descriptive name for the agent (e.g., 'developer', 'tester'). Will be made unique automatically."),
            role: z.string().describe("Agent's role (e.g., 'Backend Engineer', 'Frontend Engineer')"),
            focus: z.string().describe("Specific focus/task for this agent"),
          })).describe("List of work item to agent assignments"),
        },
        async (args) => {
          const { getWorkItemManager } = await import("../kanban");
          const workItemManager = getWorkItemManager();

          const results: string[] = [];
          const errors: string[] = [];
          const rollbacks: Array<{ workItemId: string; agentName: string }> = [];

          // Generate unique names for all agents first
          const agentStatus = this.agentPool.getStatus();
          const existingNames = new Set([
            ...agentStatus.activeAgents.map(a => a.name),
            ...agentStatus.pendingAgents,
          ]);

          // Map original names to unique names
          const nameMapping = new Map<string, string>();
          for (const assignment of args.assignments) {
            const uniqueName = generateUniqueAgentName(assignment.agentName, existingNames);
            nameMapping.set(assignment.agentName, uniqueName);
            existingNames.add(uniqueName); // Add to set to avoid duplicates within this batch
            if (uniqueName !== assignment.agentName) {
              this.outputChannel.appendLine(`Generated unique name: ${uniqueName} (from ${assignment.agentName})`);
            }
          }

          // Get max concurrent agents limit
          const config = vscode.workspace.getConfiguration("multiAgent");
          const maxAgents = config.get<number>("maxConcurrentAgents") ?? 5;
          const currentAgents = this.agentPool.getStatus().activeAgents.length;
          const availableSlots = maxAgents - currentAgents;

          if (availableSlots <= 0) {
            return {
              content: [{
                type: "text",
                text: `Cannot spawn agents: Maximum concurrent agents (${maxAgents}) already reached. Wait for agents to complete or increase the limit.`
              }],
            };
          }

          // Limit assignments to available slots
          const assignmentsToProcess = args.assignments.slice(0, availableSlots);
          if (assignmentsToProcess.length < args.assignments.length) {
            results.push(`Note: Only spawning ${assignmentsToProcess.length} of ${args.assignments.length} agents due to concurrency limit (${maxAgents}).`);
          }

          // Spawn agents concurrently using Promise.allSettled
          const spawnPromises = assignmentsToProcess.map(async (assignment) => {
            let workItemAssigned = false;
            let workItemMoved = false;
            const uniqueName = nameMapping.get(assignment.agentName)!;

            try {
              // Step 1: Assign work item with unique name
              await workItemManager.updateItem(assignment.workItemId, { assignee: uniqueName });
              workItemAssigned = true;

              // Step 2: Move to doing
              await workItemManager.moveItem(assignment.workItemId, 'doing');
              workItemMoved = true;

              // Step 3: Spawn the agent with unique name
              await this.agentPool.spawnAgent({
                name: uniqueName,
                role: assignment.role,
                focus: assignment.focus,
                systemPrompt: `You are a ${assignment.role}. Your focus: ${assignment.focus}`,
                waitFor: [],
                priority: 0,
                workingDirectory: this.getWorkingDirectory(),
                workItemId: assignment.workItemId,
              });

              // Step 4: Verify agent was created
              const updatedAgentStatus = this.agentPool.getStatus();
              const agentExists = updatedAgentStatus.activeAgents.some((a: any) => a.name === uniqueName) ||
                                 updatedAgentStatus.pendingAgents.some((a: any) => a.name === uniqueName);

              if (!agentExists) {
                throw new Error(`Agent ${uniqueName} was not found in agent pool after spawning`);
              }

              this.emit("agentSpawned", uniqueName);
              return { success: true, agentName: uniqueName, workItemId: assignment.workItemId };
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);

              // Rollback work item assignment if agent creation failed
              if (workItemAssigned || workItemMoved) {
                try {
                  // Move back to todo and clear assignee
                  await workItemManager.moveItem(assignment.workItemId, 'todo');
                  await workItemManager.updateItem(assignment.workItemId, { assignee: undefined });
                  rollbacks.push({ workItemId: assignment.workItemId, agentName: uniqueName });
                } catch (rollbackError) {
                  const rollbackMsg = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
                  this.outputChannel.appendLine(`Failed to rollback ${assignment.workItemId}: ${rollbackMsg}`);
                }
              }

              return { success: false, agentName: uniqueName, workItemId: assignment.workItemId, error: errorMsg };
            }
          });

          const spawnResults = await Promise.allSettled(spawnPromises);

          for (const result of spawnResults) {
            if (result.status === 'fulfilled') {
              const r = result.value;
              if (r.success) {
                results.push(`Spawned ${r.agentName} for ${r.workItemId}`);
              } else {
                errors.push(`Failed to spawn ${r.agentName} for ${r.workItemId}: ${r.error}`);
              }
            } else {
              errors.push(`Unexpected error: ${result.reason}`);
            }
          }

          const successCount = results.filter(r => r.startsWith('Spawned')).length;
          const summary = [
            `Team Manager spawned ${successCount} agent(s) concurrently.`,
            '',
            'Results:',
            ...results,
            ...(errors.length > 0 ? ['', 'Errors:', ...errors] : []),
            ...(rollbacks.length > 0 ? ['', 'Rollbacks (moved back to todo):', ...rollbacks.map(r => `- ${r.workItemId} (agent: ${r.agentName})`)] : []),
          ].join('\n');

          this.outputChannel.appendLine(summary);

          return {
            content: [{ type: "text", text: summary }],
          };
        }
      ),
      tool(
        "get_team_status",
        "Get comprehensive status of the team including agents, work items, and capacity. Use this to understand current team state and identify bottlenecks.",
        {},
        async () => {
          const { getWorkItemManager } = await import("../kanban");
          const workItemManager = getWorkItemManager();

          // Get agent status
          const agentStatus = this.agentPool.getStatus();

          // Get work item counts by status
          const allItems = await workItemManager.listItems();
          const itemsByStatus = {
            todo: allItems.filter((i: any) => i.status === 'todo'),
            doing: allItems.filter((i: any) => i.status === 'doing'),
            'code-review': allItems.filter((i: any) => i.status === 'code-review'),
            done: allItems.filter((i: any) => i.status === 'done'),
          };

          const unassignedTodo = itemsByStatus.todo.filter((i: any) => !i.assignee);

          // Check for orphaned work items (assigned but no active agent)
          const activeAgentNames = new Set([
            ...agentStatus.activeAgents.map((a: any) => a.name),
            ...agentStatus.pendingAgents.map((a: any) => a.name)
          ]);

          const orphanedItems = itemsByStatus.doing.filter((i: any) =>
            i.assignee && !activeAgentNames.has(i.assignee)
          );

          // Note: We can't easily detect "idle" agents (agents that completed work but still running)
          // because workItemId isn't stored in agent status. This would require updating AgentSession.
          const idleAgents: any[] = [];

          // Get capacity info
          const config = vscode.workspace.getConfiguration("multiAgent");
          const maxAgents = config.get<number>("maxConcurrentAgents") ?? 5;
          const availableSlots = maxAgents - agentStatus.activeAgents.length;

          const summary = [
            '## Team Status Report',
            '',
            '### Capacity',
            `- Active Agents: ${agentStatus.activeAgents.length}/${maxAgents}`,
            `- Available Slots: ${availableSlots}`,
            `- Pending Agents: ${agentStatus.pendingAgents.length}`,
            `- Total Cost: $${agentStatus.totalCost.toFixed(4)}`,
            '',
            '### Kanban Board',
            `- Todo: ${itemsByStatus.todo.length} (${unassignedTodo.length} unassigned)`,
            `- Doing: ${itemsByStatus.doing.length}`,
            `- Code Review: ${itemsByStatus['code-review'].length}`,
            `- Done: ${itemsByStatus.done.length}`,
            '',
            '### Active Agents',
            ...(agentStatus.activeAgents.length > 0
              ? agentStatus.activeAgents.map((a: any) => `- ${a.name} (${a.role}): ${a.status} - ${a.focus}`)
              : ['- No active agents']),
            '',
            '### Validation Status',
            ...(orphanedItems.length > 0
              ? [`- WARNING: ${orphanedItems.length} orphaned work item(s) (assigned but no active agent)`, ...orphanedItems.map((i: any) => `  - ${i.id}: ${i.title} (assigned to: ${i.assignee})`)]
              : ['- No orphaned work items detected']),
            ...(idleAgents.length > 0
              ? [`- WARNING: ${idleAgents.length} idle agent(s) (active but no assigned work item)`, ...idleAgents.map((a: any) => `  - ${a.name} (workItemId: ${a.workItemId})`)]
              : ['- No idle agents detected']),
            '',
            '### Recommendations',
            ...(orphanedItems.length > 0
              ? ['- Run validate_agent_assignments with autofix=true to resolve orphaned items']
              : []),
            ...(unassignedTodo.length > 0 && availableSlots > 0
              ? [`- ${unassignedTodo.length} unassigned item(s) can be picked up. Spawn agents!`]
              : []),
            ...(availableSlots === 0 && unassignedTodo.length > 0
              ? ['- At capacity. Wait for agents to complete or increase limit.']
              : []),
            ...(itemsByStatus['code-review'].length > 0
              ? [`- ${itemsByStatus['code-review'].length} item(s) awaiting code review.`]
              : []),
            ...(unassignedTodo.length === 0 && agentStatus.activeAgents.length === 0
              ? ['- No pending work and no active agents. Team is idle.']
              : []),
          ].join('\n');

          this.outputChannel.appendLine('Generated team status report');

          return {
            content: [{ type: "text", text: summary }],
          };
        }
      ),
      tool(
        "validate_agent_assignments",
        "Validate synchronization between active agents and assigned work items. Detects orphaned work items (assigned but no active agent) and idle agents (active but no assigned work item). Can optionally auto-fix issues by moving orphaned items back to 'todo'.",
        {
          autofix: z.boolean().optional().describe("If true, automatically move orphaned items back to 'todo' and clear assignee (default: false)"),
        },
        async (args) => {
          const { getWorkItemManager } = await import("../kanban");
          const workItemManager = getWorkItemManager();

          // Get agent status
          const agentStatus = this.agentPool.getStatus();

          // Get all work items in "doing" status
          const doingItems = await workItemManager.listItems('doing');

          // Build set of active agent names
          const activeAgentNames = new Set([
            ...agentStatus.activeAgents.map((a: any) => a.name),
            ...agentStatus.pendingAgents.map((a: any) => a.name)
          ]);

          // Find orphaned work items (assigned but no corresponding agent)
          const orphanedItems = doingItems.filter((i: any) =>
            i.assignee && !activeAgentNames.has(i.assignee)
          );

          // Note: We can't easily detect "idle" agents (agents that completed work but still running)
          // because workItemId isn't stored in agent status. This would require updating AgentSession.
          const idleAgents: any[] = [];
          const unassignedAgents: any[] = [];

          const issues: string[] = [];
          const fixes: string[] = [];

          // Report orphaned items
          if (orphanedItems.length > 0) {
            issues.push(`Found ${orphanedItems.length} orphaned work item(s):`);
            for (const item of orphanedItems) {
              issues.push(`  - ${item.id}: "${item.title}" (assigned to: ${item.assignee})`);

              if (args.autofix) {
                try {
                  // Move back to todo and clear assignee
                  await workItemManager.moveItem(item.id, 'todo');
                  await workItemManager.updateItem(item.id, { assignee: undefined });
                  fixes.push(`  - Fixed ${item.id}: moved to 'todo' and cleared assignee`);
                } catch (error) {
                  const errorMsg = error instanceof Error ? error.message : String(error);
                  fixes.push(`  - ERROR fixing ${item.id}: ${errorMsg}`);
                }
              }
            }
          }

          // Report idle agents
          if (idleAgents.length > 0) {
            issues.push(`Found ${idleAgents.length} idle agent(s) (active but work item not in 'doing'):`);
            for (const agent of idleAgents) {
              issues.push(`  - ${agent.name}: workItemId=${agent.workItemId} (not found in 'doing')`);
            }
            issues.push(`  Note: These agents may have completed their work. Consider destroying them.`);
          }

          // Report unassigned agents (may be legitimate for some workflows)
          if (unassignedAgents.length > 0) {
            issues.push(`Found ${unassignedAgents.length} agent(s) without assigned work items:`);
            for (const agent of unassignedAgents) {
              issues.push(`  - ${agent.name} (${agent.role})`);
            }
            issues.push(`  Note: This may be intentional for coordination/review agents.`);
          }

          // Build summary
          const summary = [];
          summary.push('## Agent Assignment Validation Report');
          summary.push('');

          if (issues.length === 0) {
            summary.push('Status: All agent assignments are synchronized.');
            summary.push(`- ${agentStatus.activeAgents.length + agentStatus.pendingAgents.length} active/pending agents`);
            summary.push(`- ${doingItems.length} work items in 'doing'`);
            summary.push('- No mismatches detected');
          } else {
            summary.push('Status: Issues detected');
            summary.push('');
            summary.push(...issues);

            if (args.autofix && fixes.length > 0) {
              summary.push('');
              summary.push('Auto-fix Results:');
              summary.push(...fixes);
            }

            if (!args.autofix && orphanedItems.length > 0) {
              summary.push('');
              summary.push('Recommendation: Run validate_agent_assignments with autofix=true to automatically resolve orphaned items.');
            }
          }

          const summaryText = summary.join('\n');
          this.outputChannel.appendLine(summaryText);

          return {
            content: [{ type: "text", text: summaryText }],
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
    // Generate unique reviewer name
    const agentStatus = this.agentPool.getStatus();
    const existingNames = new Set([
      ...agentStatus.activeAgents.map(a => a.name),
      ...agentStatus.pendingAgents,
    ]);
    const uniqueReviewerName = generateUniqueAgentName(`reviewer-${item.id}`, existingNames);

    const reviewer = await this.agentPool.spawnAgent({
      name: uniqueReviewerName,
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
