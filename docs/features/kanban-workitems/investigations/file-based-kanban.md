# Investigation: File-Based Kanban System

**Feature**: kanban-workitems
**Status**: In Progress
**Created**: 2026-01-01

## Approach

Build a Kanban board system using the file system as the persistence layer, with Markdown files containing YAML frontmatter for work item metadata. The folder structure represents the workflow columns:

```
.clautana/workitems/
  todo/           # Backlog items waiting for assignment
  doing/          # Work in progress (agent assigned)
  code-review/    # Completed work awaiting review
  done/           # Reviewed and completed work
  cancelled/      # Cancelled/abandoned items (archived)
```

### Core Components

#### 1. WorkItemManager (Singleton Service)

```typescript
// src/kanban/WorkItemManager.ts
interface WorkItem {
  id: string;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'todo' | 'doing' | 'code-review' | 'done';
  assignee: string | null;
  reviewer: string | null;
  tags: string[];
  created: Date;
  started: Date | null;
  completed: Date | null;
  filePath: string;
}

class WorkItemManager extends EventEmitter {
  // File system operations
  async listItems(status?: WorkItemStatus): Promise<WorkItem[]>
  async getItem(id: string): Promise<WorkItem | null>
  async createItem(item: Partial<WorkItem>): Promise<WorkItem>
  async updateItem(id: string, updates: Partial<WorkItem>): Promise<WorkItem>
  async moveItem(id: string, newStatus: WorkItemStatus): Promise<WorkItem>
  async assignItem(id: string, agentName: string): Promise<WorkItem>
  async deleteItem(id: string, reason?: string): Promise<void>
  async cancelItem(id: string, reason: string): Promise<WorkItem>  // Moves to cancelled + unassigns

  // File watching
  private setupFileWatcher(): void

  // Events: 'itemCreated', 'itemUpdated', 'itemMoved', 'itemAssigned', 'itemDeleted', 'itemCancelled'
}
```

#### 2. WorkItems MCP Server

Following the pattern from `ClaimsMcpServer.ts`, create MCP tools for agent access:

```typescript
// src/mcp/WorkItemsMcpServer.ts
export async function createWorkItemsMcpTools(agentName: string): Promise<any[]> {
  return [
    tool("list_workitems", "List work items, optionally filtered by status", ...),
    tool("get_workitem", "Get details of a specific work item", ...),
    tool("create_workitem", "Create a new work item in the todo column", ...),
    tool("move_workitem", "Move a work item to a different column", ...),
    tool("assign_workitem", "Assign a work item to yourself", ...),
    tool("unassign_workitem", "Unassign yourself from a work item", ...),
    tool("update_workitem", "Update work item description or metadata", ...),
    tool("add_workitem_note", "Add a progress note to a work item", ...),
    tool("cancel_workitem", "Cancel a work item (moves to cancelled, notifies coordinator)", ...),
    tool("delete_workitem", "Permanently delete a work item file", ...),
  ];
}
```

#### 3. Coordinator Integration

The coordinator should **always** work through the Kanban board rather than handling tasks ad-hoc. When a user submits a task, the coordinator should:

1. **Break down** the task into discrete work items
2. **Create** work items in the `todo` column
3. **Spawn** agents and assign them to work items
4. **Monitor** progress through the board
5. **Spawn reviewers** when items reach code-review

##### Updated System Prompt

```typescript
const ORCHESTRATOR_SYSTEM_PROMPT = `You are an orchestrating agent that manages work through a Kanban board.

CRITICAL: Always work through the Kanban board. Never do ad-hoc work.

When you receive a task:
1. Break it down into discrete, parallelizable work items
2. Create each work item using create_workitem tool
3. Spawn specialist agents for each work item
4. Assign agents to their work items using assign_workitem
5. Monitor the board and spawn reviewers when items reach code-review

Your workflow tools:
- create_workitem: Add a new item to the todo column
- list_workitems: See current board state
- assign_workitem: Assign an agent to a work item
- move_workitem: Move items between columns

Your agent tools:
- spawn_agent: Create a specialist agent
- destroy_agent: Remove completed agents
- message_agent: Send instructions to agents
- get_agent_status: Check agent states

Guidelines:
- Create focused work items (1-2 hours of work each)
- Set appropriate priorities (critical, high, medium, low)
- Use tags for categorization
- Always assign agents to work items before they start
- Spawn a CodeReviewer agent when items enter code-review
- Report progress to the user via report_to_user
`;
```

##### Work Item Watcher

```typescript
// In OrchestratorAgent constructor or init
private async initWorkItemWatcher(): Promise<void> {
  const workItemManager = getWorkItemManager();

  // Check for unassigned items on startup
  await this.processUnassignedItems();

  // Watch for new items (created by coordinator or user)
  workItemManager.on('itemCreated', async (item) => {
    if (item.status === 'todo' && !item.assignee) {
      await this.spawnAgentForItem(item);
    }
  });

  // Auto-spawn reviewer when item moves to code-review
  workItemManager.on('itemMoved', async (item, oldStatus, newStatus) => {
    if (newStatus === 'code-review' && !item.reviewer) {
      await this.spawnReviewerForItem(item);
    }
  });

  // Handle cancelled items - destroy associated agent
  workItemManager.on('itemCancelled', async (item) => {
    if (item.assignee) {
      await this.agentPool.destroyAgent(item.assignee);
    }
  });
}

private async spawnAgentForItem(item: WorkItem): Promise<void> {
  const agent = await this.agentPool.spawnAgent({
    name: `${item.id}-Agent`,
    role: this.inferRoleFromItem(item),
    focus: item.title,
    systemPrompt: this.buildAgentPrompt(item),
    workingDirectory: this.getWorkingDirectory(),
  });

  // Immediately assign the agent to the work item
  await workItemManager.assignItem(item.id, agent.name);
  await workItemManager.moveItem(item.id, 'doing');
}
```

##### Coordinator MCP Tools for Work Items

The coordinator gets additional tools to manage the board:

```typescript
// Added to orchestrator MCP tools
tool("create_workitem", "Create a new work item in the todo column", {
  title: z.string().describe("Short title for the work item"),
  description: z.string().describe("Detailed description with acceptance criteria"),
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  tags: z.array(z.string()).optional(),
  estimatedHours: z.number().optional(),
}),

tool("list_workitems", "Get current state of the Kanban board", {
  status: z.enum(["todo", "doing", "code-review", "done", "cancelled"]).optional(),
}),

tool("assign_workitem", "Assign an agent to a work item", {
  itemId: z.string(),
  agentName: z.string(),
}),

tool("move_workitem", "Move a work item to a different column", {
  itemId: z.string(),
  newStatus: z.enum(["todo", "doing", "code-review", "done"]),
}),
```

#### 4. KanbanPanel (WebviewPanel)

Following `OrchestratorPanel.ts` pattern, create a full-tab Kanban board:

```typescript
// src/providers/KanbanPanel.ts
export class KanbanPanel {
  private static instance: KanbanPanel | undefined;

  static createOrShow(context: vscode.ExtensionContext): KanbanPanel

  // Real-time updates via postMessage
  private setupEventListeners(): void {
    workItemManager.on('itemCreated', (item) => this.postMessage({ type: 'itemCreated', item }));
    workItemManager.on('itemMoved', (item) => this.postMessage({ type: 'itemMoved', item }));
    // ...
  }

  // Handle webview messages
  private setupMessageHandler(): void {
    // 'moveItem' - drag-drop handler
    // 'openItem' - double-click opens .md file in VS Code
    // 'createItem' - new item form
    // 'assignItem' - manual assignment
    // 'cancelItem' - cancel with reason (moves to cancelled folder)
    // 'deleteItem' - permanently delete with confirmation
  }
}
```

#### 5. Webview UI (React)

```typescript
// webview-ui/src/components/KanbanBoard.tsx
interface KanbanBoardProps {
  items: WorkItem[];
  agents: AgentInfo[];
}

function KanbanBoard({ items, agents }: KanbanBoardProps) {
  const columns = ['todo', 'doing', 'code-review', 'done'];

  const handleDrop = (itemId: string, newStatus: string) => {
    vscode.postMessage({ type: 'moveItem', itemId, newStatus });
  };

  const handleDoubleClick = (item: WorkItem) => {
    // Open the .md file in VS Code editor
    vscode.postMessage({ type: 'openItem', filePath: item.filePath });
  };

  const handleCancel = (item: WorkItem) => {
    // Show reason input, then cancel
    const reason = prompt('Reason for cancellation:');
    if (reason) {
      vscode.postMessage({ type: 'cancelItem', itemId: item.id, reason });
    }
  };

  const handleDelete = (item: WorkItem) => {
    // Confirm before permanent deletion
    if (confirm(`Permanently delete "${item.title}"? This cannot be undone.`)) {
      vscode.postMessage({ type: 'deleteItem', itemId: item.id });
    }
  };

  return (
    <div className="kanban-board">
      {columns.map(status => (
        <KanbanColumn
          key={status}
          status={status}
          items={items.filter(i => i.status === status)}
          agents={agents}
          onDrop={handleDrop}
          onItemDoubleClick={handleDoubleClick}
          onItemCancel={handleCancel}
          onItemDelete={handleDelete}
        />
      ))}
    </div>
  );
}

// Card component with context menu
function KanbanCard({ item, onDoubleClick, onCancel, onDelete }: KanbanCardProps) {
  return (
    <div
      className="kanban-card"
      onDoubleClick={() => onDoubleClick(item)}
      onContextMenu={(e) => showContextMenu(e, item, onCancel, onDelete)}
    >
      <div className="card-header">
        <span className={`priority-badge priority-${item.priority}`}>{item.priority}</span>
        <span className="card-id">{item.id}</span>
      </div>
      <div className="card-title">{item.title}</div>
      {item.assignee && (
        <div className="card-assignee">
          <AgentAvatar name={item.assignee} />
          <span>{item.assignee}</span>
        </div>
      )}
      <div className="card-actions">
        <button onClick={() => onCancel(item)} title="Cancel">✕</button>
        <button onClick={() => onDelete(item)} title="Delete" className="danger">🗑</button>
      </div>
    </div>
  );
}
```

### Work Item File Format

```markdown
---
id: WI-2026-001
title: "Implement JWT authentication"
priority: high
assignee: AuthAgent
reviewer: null
tags:
  - security
  - backend
  - api
created: 2026-01-01T10:00:00Z
started: 2026-01-01T10:30:00Z
completed: null
estimatedHours: 4
---

## Description

Add JWT-based authentication to all API endpoints. The system should support
token refresh and secure token storage.

## Acceptance Criteria

- [ ] Login endpoint returns JWT token
- [ ] Refresh token mechanism works
- [ ] Protected routes validate tokens
- [ ] Token expiry is handled gracefully

## Agent Notes

### 2026-01-01 10:30 - AuthAgent
Starting implementation. Will use jose library for JWT handling.

### 2026-01-01 11:15 - AuthAgent
JWT signing working. Now implementing refresh flow.
```

### Commands & Menus

```json
{
  "commands": [
    {
      "command": "clautana.openKanban",
      "title": "Open Kanban Board",
      "category": "Clautana",
      "icon": "$(checklist)"
    },
    {
      "command": "clautana.createWorkItem",
      "title": "Create Work Item",
      "category": "Clautana"
    },
    {
      "command": "clautana.assignToAgent",
      "title": "Assign Work Item to Agent",
      "category": "Clautana"
    }
  ]
}
```

## Tradeoffs

| Pros | Cons |
|------|------|
| Files are human-readable and editable | File system operations can be slow |
| Git-friendly - work items are versioned | Concurrent writes need careful handling |
| No database setup required | Limited query capabilities vs SQL |
| Works offline | File watching can miss events |
| Easy to backup/migrate | Parsing YAML frontmatter on every read |
| Double-click opens native editor | Large boards may hit FS limits |
| Agents can read/write directly | Need to handle file locking |

## Alignment

- [x] Follows layer rules (API -> App -> Domain -> Data)
  - MCP tools = API layer
  - WorkItemManager = App/Domain layer
  - File system = Data layer
- [x] F5 Developer Experience (works with minimal setup)
  - Just creates folders on first use
  - No database or server required
- [ ] FHIR spec compliance (N/A)
- [x] Consistent with existing patterns
  - MCP tools follow ClaimsMcpServer pattern
  - WebviewPanel follows OrchestratorPanel pattern
  - EventEmitter for real-time updates

## Evidence

### Existing Patterns Found

1. **MCP Tools Pattern** (`ClaimsMcpServer.ts`):
   - Uses `zod` for schema validation
   - Uses `tool()` from claude-agent-sdk
   - Returns `{ content: [{ type: "text", text: "..." }] }`
   - Agent name passed to factory function

2. **WebviewPanel Pattern** (`OrchestratorPanel.ts`):
   - Singleton with `createOrShow()` static method
   - Event listeners setup for real-time updates
   - Message handler for webview commands
   - HTML template with CSP and nonce

3. **Extension MCP Server** (`ExtensionMcpServer.ts`):
   - Combines multiple tool sets into one server
   - Uses `createSdkMcpServer()` from SDK
   - Exports tool name list for permissions

4. **File-based Config** (`ConfigManager.ts`):
   - Already uses `.clautana/` folder structure
   - YAML parsing with `js-yaml`
   - File watching with `vscode.workspace.createFileSystemWatcher`

### Prior Art

1. **VS Code Tasks**: Built-in task system, but not designed for agent workflows
2. **GitHub Issues**: Good model but requires external service
3. **Linear/Jira**: Enterprise solutions, overkill for local agent coordination
4. **Obsidian Kanban Plugin**: Similar file-based approach with Markdown

## Implementation Sequence

1. **Phase 1: Core Infrastructure**
   - Create `WorkItemManager` class with CRUD operations
   - Define `WorkItem` interface and types
   - Implement file system read/write with frontmatter parsing
   - Add file watcher for real-time updates

2. **Phase 2: MCP Integration**
   - Create `WorkItemsMcpServer.ts` with agent tools
   - Register tools in `ExtensionMcpServer.ts`
   - Update tool permissions in `getExtensionToolNames()`

3. **Phase 3: Coordinator Integration**
   - Add work item watcher to `OrchestratorAgent`
   - Implement auto-spawn for unassigned items
   - Implement auto-review assignment

4. **Phase 4: Kanban UI**
   - Create `KanbanPanel.ts` WebviewPanel
   - Build React components for board/columns/cards
   - Implement drag-drop with status updates
   - Add double-click to open file in editor
   - Add agent avatars and status indicators

5. **Phase 5: Polish**
   - Add commands to package.json
   - Add keyboard shortcuts
   - Add context menus
   - Persist column widths/preferences

## Alternative Approaches Worth Investigating

1. **SQLite-backed Kanban**: Use SQLite for better query performance and concurrent access. Trade off: requires database file, not as human-readable.

2. **VS Code Tasks Integration**: Leverage the built-in `tasks.json` system. Trade off: limited metadata, not designed for agent workflows.

3. **Hybrid File+Index**: Keep Markdown files but maintain a JSON index for fast queries. Trade off: index can get out of sync.

## Verdict

**Recommended for implementation.** The file-based approach aligns well with:
- Existing `.clautana/` folder structure
- Human-readable/editable work items
- Git-friendly versioning
- Minimal infrastructure requirements
- Established patterns in the codebase

The main risks (file watching reliability, concurrent access) can be mitigated with:
- Debounced file watchers
- Atomic file operations using temp files + rename
- Pessimistic locking via claims system (already built)

Proceed with implementation following the phased approach above.
