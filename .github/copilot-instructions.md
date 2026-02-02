# Clautana - Copilot Instructions

## Build & Development

All commands run from `src/multi-agent-harness/`:

```bash
# Install dependencies (extension + webview)
npm install && cd webview-ui && npm install && cd ..

# Build everything
npm run build

# Build extension only (Webpack)
npm run build:extension

# Build webview only (Vite)
npm run build:webview

# Watch mode for development
npm run watch

# Lint
npm run lint

# Package for distribution
npm run package
```

To run the extension: Open in VS Code → Press F5 → Extension Host launches.

## Architecture Overview

Clautana is a VS Code extension implementing a multi-agent orchestration system using the Model Context Protocol (MCP).

### Core Components

```
src/multi-agent-harness/
├── src/
│   ├── coordinator/           # Agent orchestration
│   │   ├── OrchestratorAgent.ts  # Central brain - plans, spawns agents, monitors
│   │   ├── AgentPool.ts          # Manages worker agent execution
│   │   └── AgentSession.ts       # Individual agent session state
│   │
│   ├── mcp/                   # MCP server implementations
│   │   ├── McpManager.ts         # Lifecycle management (stdio/http transports)
│   │   ├── MailMcpServer.ts      # Inter-agent messaging
│   │   ├── MemoryMcpServer.ts    # Persistent facts/lessons/playbooks
│   │   ├── WorkItemsMcpServer.ts # Kanban work item operations
│   │   └── ClaimsMcpServer.ts    # File locking to prevent conflicts
│   │
│   ├── kanban/                # File-based Kanban system
│   └── providers/             # VS Code UI providers (TreeViews, Webviews)
│
└── webview-ui/                # React frontend (Vite)
    └── src/                   # Chat interface, Kanban board, agent status
```

### Data Flow

1. User submits task via chat panel → OrchestratorAgent
2. Orchestrator creates User Stories in `.clautana/workitems/` (file-based, source of truth)
3. Orchestrator spawns Worker agents via AgentPool, assigns `workItemId`
4. Workers communicate via MailMcpServer, claim files via ClaimsMcpServer
5. Completed work triggers review (optionally auto-spawns Reviewer agent)

### Key Patterns

- **MCP First**: All agent interactions with OS/IDE go through MCP tools
- **File-Based State**: `.clautana/` directory is the persistence layer - never rely on in-memory state for long-term data
- **Webview API**: React UI communicates with extension backend via VS Code Webview postMessage API
- **Dual Build**: Extension uses Webpack, Webview uses Vite - must build both

## Runtime Directory

```
.clautana/
├── workitems/     # Kanban cards (User Stories) - YAML files
├── memory/        # Persistent facts, lessons, playbooks
├── mail/          # Inter-agent message queue
└── claims/        # Active file locks
```

## Configuration

VS Code settings prefix: `clautana.*`

Key settings:
- `clautana.backend`: `auto` | `claude` | `copilot` - AI backend selection
- `clautana.coordinatorModel` / `clautana.workerModel`: `opus` | `sonnet` | `haiku`
- `clautana.maxConcurrentAgents`: Default 5
- `clautana.autoReview`: Auto-spawn reviewer on task completion

## Custom Agents & Skills

- `.github/agents/`: Agent definitions (coding, documentation, ADR analyzer, etc.)
- `.github/skills/`: Skill definitions (create-feature, implement-task, reviews, etc.)

Reference these when implementing new features or understanding the orchestration workflow.
