# Multi-Agent Harness for VS Code

## Specification v1.0

A VS Code extension that orchestrates multiple Claude Code agent instances, enabling them to work collaboratively on a shared codebase with real-time coordination through MCP Agent Mail.

---

## Overview

### Vision

Developers stay in VS Code while multiple Claude Code agents work in parallel on different parts of a codebase. Agents communicate through a shared mailbox system, claim files to avoid conflicts, and the developer maintains visibility and control over everything.

### Goals

1. **Orchestrate multiple Claude Code agents** — each with full agentic capabilities via the Claude Agent SDK
2. **Enable agent-to-agent communication** — automatic notification when messages are sent between agents
3. **Visualize file ownership** — see which agent has claimed which files directly in the editor
4. **Maintain developer control** — pause, resume, redirect, or stop any agent at any time
5. **Integrate with existing workflow** — works alongside existing VS Code extensions and Claude Code

### Non-Goals (v1)

- Standalone application (VS Code extension only)
- Support for non-Claude agents (Codex, Gemini) — future consideration
- 24/7 autonomous operation — human-supervised sessions
- Fork VS Code (extension only, like Kiro for Codex)

---

## Core Concept: Dynamic Agent Orchestration

Unlike static multi-agent systems where you pre-configure fixed agents, this extension uses an **intelligent coordinator** that dynamically creates and destroys agents based on the task at hand.

### The Coordinator as Orchestrator

The coordinator is itself an agent (or uses Claude) that:

1. **Analyzes incoming tasks** — understands scope, complexity, and required skills
2. **Plans the work** — decides what specialist agents are needed
3. **Spawns agents dynamically** — creates agents with specific roles and focus areas
4. **Manages dependencies** — coordinates handoffs (e.g., "wait for Core changes before API work")
5. **Monitors progress** — watches for completion, errors, or need for additional help
6. **Scales up/down** — adds agents if task expands, removes them when their part is done
7. **Reports to user** — summarizes progress and final results

### Example Flow

```
User: "Add FHIR R6 support to Ignixa with full test coverage"

Coordinator thinks:
  "This task requires:
   1. Core parser changes (understanding FHIR R6 spec) 
   2. API endpoint updates (after core is ready)
   3. Test coverage (can start on existing code, expand after changes)
   
   I'll create 3 specialists. Parser agent goes first, 
   API agent waits for parser, test agent can work in parallel."

Coordinator actions:
  → spawn_agent("R6Parser", focus="Core FHIR parsing for R6", priority=1)
  → spawn_agent("R6Api", focus="API endpoints for R6", wait_for=["R6Parser"])  
  → spawn_agent("R6Tests", focus="Test coverage for R6 features", priority=2)

[Agents work, coordinate via Agent Mail]

R6Parser: "Core changes complete, IFhirReader now supports R6"
  → Coordinator sees completion, signals R6Api to proceed
  
R6Api: "API endpoints updated"
R6Tests: "Test coverage at 94%"

Coordinator:
  → All tasks complete
  → Spin down all agents
  → Report summary to user
```

### Dynamic vs Static Agents

| Static (Old Way) | Dynamic (This System) |
|------------------|----------------------|
| Pre-configured agent list | Agents created per-task |
| Fixed roles | Roles tailored to specific work |
| Always running | Spun up and down as needed |
| Manual coordination | Coordinator manages handoffs |
| User decides agent count | System decides optimal count |
| Same agents for every task | Fresh context per task |

### Agent Lifecycle

```
                    ┌─────────────────┐
                    │   User Task     │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   Coordinator   │
                    │   (Analyzes)    │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │  Spawn   │   │  Spawn   │   │  Spawn   │
        │ Agent A  │   │ Agent B  │   │ Agent C  │
        └────┬─────┘   └────┬─────┘   └────┬─────┘
             │              │              │
             ▼              ▼              ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │  Working │   │ Waiting  │   │  Working │
        └────┬─────┘   └────┬─────┘   └────┬─────┘
             │              │              │
             │   ┌──────────┘              │
             ▼   ▼                         ▼
        ┌──────────┐                  ┌──────────┐
        │ Complete │                  │ Complete │
        └────┬─────┘                  └────┬─────┘
             │                             │
             └──────────────┬──────────────┘
                            ▼
                    ┌─────────────────┐
                    │   Coordinator   │
                    │ (Spins down,    │
                    │  reports)       │
                    └─────────────────┘
```

---

## User Experience

### Activation

1. Developer opens a workspace with a `.claude` directory (or manually activates)
2. Extension initializes the coordinator (no agents yet)
3. Multi-Agent panel appears in the sidebar activity bar
4. MCP Agent Mail server starts (or connects to existing)

### Primary Workflow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              VS Code Window                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌────────────────────────────────────────────────────┐   │
│  │ Activity Bar │  │                    Editor Area                      │   │
│  │              │  │  ┌──────────────────────────────────────────────┐  │   │
│  │  📁 Explorer │  │  │  FhirParser.cs                 🔒 R6Parser   │  │   │
│  │  🔍 Search   │  │  │                                              │  │   │
│  │  🔀 Git      │  │  │  1  namespace Ignixa.Core;                   │  │   │
│  │  🐛 Debug    │  │  │  2                                           │  │   │
│  │              │  │  │  3  public class FhirParser                  │  │   │
│  │  ┌────────┐  │  │  │  4  {                                        │  │   │
│  │  │ 🤖     │  │  │  │  5      // ...                               │  │   │
│  │  │ Multi  │  │  │  └──────────────────────────────────────────────┘  │   │
│  │  │ Agent  │  │  │                                                     │   │
│  │  └────────┘  │  └────────────────────────────────────────────────────┘   │
│  │              │                                                            │
│  └──────────────┘  ┌────────────────────────────────────────────────────┐   │
│                    │               Multi-Agent Panel (Webview)           │   │
│  ┌──────────────┐  │                                                     │   │
│  │ Agent Tree   │  │  ┌─────────────────────────────────────────────┐   │   │
│  │              │  │  │  🎯 ORCHESTRATOR                             │   │   │
│  │ 🎯 Orchestr. │  │  │  Analyzing: Add R6 support with tests        │   │   │
│  │   ⚙️ Planning│  │  │  ─────────────────────────────────────────── │   │   │
│  │              │  │  │  → Spawned R6Spec (analyzing spec)           │   │   │
│  │ ──────────── │  │  │  → Spawned R6Parser (waiting for R6Spec)     │   │   │
│  │ Worker Agents│  │  │  → Spawned R6Tests (waiting for R6Parser)    │   │   │
│  │              │  │  └─────────────────────────────────────────────┘   │   │
│  │ 🔵 R6Spec    │  │                                                     │   │
│  │   ✅ Complete│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │   │
│  │ 🔴 R6Parser  │  │  │  R6Spec     │ │  R6Parser   │ │  R6Tests    │   │   │
│  │   ⚙️ Working │  │  │  ✅ Done    │ │  ⚙️ Working │ │  ⏳ Waiting │   │   │
│  │ 🟡 R6Tests   │  │  ├─────────────┤ ├─────────────┤ ├─────────────┤   │   │
│  │   ⏳ Waiting │  │  │ Found 12    │ │ Updating    │ │ Waiting for │   │   │
│  │              │  │  │ new R6 types│ │ IFhirReader │ │ R6Parser... │   │   │
│  │ ──────────── │  │  │ 3 breaking  │ │ to handle   │ │             │   │   │
│  │ File Claims  │  │  │ changes     │ │ R6 format   │ │             │   │   │
│  │              │  │  └─────────────┘ └─────────────┘ └─────────────┘   │   │
│  │ 📁 Core/*    │  │                                                     │   │
│  │   🔴R6Parser │  └────────────────────────────────────────────────────┘   │
│  │              │                                                            │
│  └──────────────┘  ┌────────────────────────────────────────────────────┐   │
│                    │                    Terminal                         │   │
│                    └────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ Status: 🎯 Orchestrator planning │ 3 agents │ 🔒 2 claims │ $0.18    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Interactions

| Action | How |
|--------|-----|
| Submit task to orchestrator | Command Palette → "Submit Task" or input box in panel |
| Watch orchestrator plan | Orchestrator panel shows spawn decisions in real-time |
| See agent dependencies | Tree view shows which agents are waiting for others |
| See file claims | Gutter icons in editor, hover for details |
| Manual agent spawn | Command Palette → "Spawn Agent" (bypasses orchestrator) |
| Stop everything | Command Palette → "Stop All Agents" |
| View detailed status | Command Palette → "View Agent Status" |

---

## Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VS Code Extension Host                             │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        Extension Entry Point                         │    │
│  │                          (extension.ts)                              │    │
│  │                                                                      │    │
│  │  • Register commands                                                 │    │
│  │  • Initialize coordinator                                            │    │
│  │  • Set up event listeners                                           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                      │
│         ┌────────────────────────────┼────────────────────────────┐         │
│         ▼                            ▼                            ▼         │
│  ┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────┐     │
│  │ OrchestratorAgent│   │   UI Providers       │    │  MCP Services   │     │
│  │ (Coordinator)    │    │                      │    │                 │     │
│  │                 │    │ • WebviewProvider    │    │ • AgentMail     │     │
│  │ • Analyze tasks │    │ • TreeViewProvider   │    │   Client        │     │
│  │ • Plan work     │    │ • StatusBarProvider  │    │ • ClaimsTracker │     │
│  │ • Spawn agents  │    │ • DecoratorProvider  │    │                 │     │
│  │ • Monitor prog  │    │                      │    │                 │     │
│  │ • Spin down     │    │                      │    │                 │     │
│  └────────┬────────┘    └──────────────────────┘    └─────────────────┘     │
│           │                                                                  │
│           │  spawn_agent() / destroy_agent()                                │
│           ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Dynamic Agent Pool                                │    │
│  │                                                                      │    │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              │    │
│  │  │AgentSession │    │AgentSession │    │AgentSession │   ...        │    │
│  │  │ "R6Parser"  │    │ "R6Api"     │    │ "R6Tests"   │              │    │
│  │  │             │    │             │    │             │              │    │
│  │  │ Created for │    │ Created for │    │ Created for │              │    │
│  │  │ this task   │    │ this task   │    │ this task   │              │    │
│  │  │             │    │             │    │             │              │    │
│  │  │ Claude      │    │ Claude      │    │ Claude      │              │    │
│  │  │ Agent SDK   │    │ Agent SDK   │    │ Agent SDK   │              │    │
│  │  └─────────────┘    └─────────────┘    └─────────────┘              │    │
│  │                                                                      │    │
│  │  Agents are created and destroyed dynamically by the Orchestrator   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
                            ┌───────────────────┐
                            │    MCP Servers    │
                            │                   │
                            │  • Agent Mail     │
                            │  • Ignixa (yours) │
                            │  • Others...      │
                            └───────────────────┘
```

### The Orchestrator Agent

The coordinator is itself powered by Claude, with special tools to manage the agent swarm:

```typescript
// Tools available to the Orchestrator
const orchestratorTools = [
  {
    name: "spawn_agent",
    description: "Create a new specialist agent for a specific task",
    parameters: {
      name: "string - unique identifier for this agent",
      role: "string - what this agent specializes in",
      focus: "string - specific task/area this agent should work on",
      systemPrompt: "string - detailed instructions for the agent",
      waitFor: "string[] - agent names this agent should wait for before starting",
      priority: "number - execution priority (lower = sooner)"
    }
  },
  {
    name: "destroy_agent", 
    description: "Shut down an agent that has completed its work",
    parameters: {
      name: "string - agent to shut down",
      reason: "string - why (completed, no longer needed, error)"
    }
  },
  {
    name: "message_agent",
    description: "Send instructions or updates to a running agent",
    parameters: {
      name: "string - target agent",
      message: "string - instruction or update"
    }
  },
  {
    name: "get_agent_status",
    description: "Check the status of all running agents",
    parameters: {}
  },
  {
    name: "report_to_user",
    description: "Send a progress update or final report to the user",
    parameters: {
      type: "'progress' | 'complete' | 'error' | 'question'",
      message: "string - the update"
    }
  }
];
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **OrchestratorAgent** | Analyzes tasks, plans work, spawns/destroys agents, monitors progress |
| **AgentSession** | Wraps Claude Agent SDK, handles single agent conversation |
| **AgentPool** | Manages active agent sessions, enforces resource limits |
| **WebviewProvider** | React-based panel showing orchestrator + agents |
| **TreeViewProvider** | Sidebar showing active agents, claims, messages |
| **StatusBarProvider** | Status bar items showing agent count, cost, etc. |
| **DecoratorProvider** | Editor decorations showing file claims |
| **AgentMailClient** | Communicates with MCP Agent Mail server |
| **ClaimsTracker** | Tracks file reservations across all agents |

---

## Cross-Agent Communication Flow

When BlueLake sends a message to RedPine:

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  BlueLake   │         │ Coordinator │         │   RedPine   │
│  (Agent)    │         │             │         │   (Agent)   │
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘
       │                       │                       │
       │ send_message(         │                       │
       │   to: "RedPine",      │                       │
       │   subject: "R6 done"  │                       │
       │ )                     │                       │
       │───────────────────────▶                       │
       │                       │                       │
       │              ┌────────┴────────┐              │
       │              │ Intercept tool  │              │
       │              │ call, extract   │              │
       │              │ recipient       │              │
       │              └────────┬────────┘              │
       │                       │                       │
       │                       │ injectNotification(   │
       │                       │   "New message from   │
       │                       │    BlueLake: R6 done" │
       │                       │ )                     │
       │                       │───────────────────────▶
       │                       │                       │
       │                       │                       │ Agent SDK
       │                       │                       │ processes
       │                       │                       │ notification
       │                       │                       │
       │                       │                       │ inbox()
       │                       │                       │ reads message
       │                       │                       │
       │                       │◀──────────────────────│
       │                       │   Tool call: inbox()  │
       │                       │                       │
```

**Key Insight:** The coordinator observes all tool calls streaming from agents. When it sees `send_message`, it immediately injects a prompt into the recipient agent, waking them up to check their inbox.

---

## Data Models

### Configuration

```typescript
// Extension configuration (settings.json)
interface ExtensionConfig {
  "multiAgent.mcpServers": Record<string, McpServerConfig>;
  "multiAgent.autoStartAgentMail": boolean;
  "multiAgent.showClaimsInEditor": boolean;
  "multiAgent.notifyOnAgentMessage": boolean;
  "multiAgent.coordinatorModel": string;           // Model for coordinator decisions
  "multiAgent.workerModel": string;                // Model for spawned agents
  "multiAgent.maxConcurrentAgents": number;        // Resource limit
  "multiAgent.autoSpawnAgents": boolean;           // Let coordinator decide vs manual
  "multiAgent.agentColorPalette": string[];        // Colors for dynamic agents
}

// Agent templates (optional hints for coordinator)
interface AgentTemplate {
  type: string;                    // "parser", "api", "test", "docs", etc.
  suggestedTools?: string[];       // Tool restrictions
  systemPromptHint?: string;       // Additional instructions
}

interface McpServerConfig {
  transport: "http" | "stdio";
  url?: string;                    // For HTTP transport
  command?: string;                // For stdio transport
  args?: string[];
  env?: Record<string, string>;
}
```

### Runtime State

```typescript
interface AgentState {
  name: string;
  status: "initializing" | "idle" | "processing" | "paused" | "error";
  sessionId?: string;
  currentTask?: string;
  messages: ChatMessage[];
  costUsd: number;
  tokensUsed: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: Date;
  toolCall?: ToolCallInfo;
}

interface ToolCallInfo {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
}

interface FileClaim {
  id: string;
  agentName: string;
  pathPattern: string;             // "src/Ignixa.Core/**/*.cs"
  exclusive: boolean;
  reason?: string;
  createdAt: Date;
  expiresAt: Date;
}

interface AgentMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  body?: string;
  timestamp: Date;
  read: boolean;
}
```

---

## Extension Structure

```
multi-agent-harness/
├── package.json                    # Extension manifest
├── tsconfig.json
├── webpack.config.js               # Bundle extension + webview
├── src/
│   ├── extension.ts                # Entry point
│   ├── constants.ts                # Command IDs, config keys
│   │
│   ├── coordinator/
│   │   ├── OrchestratorAgent.ts    # The brain - analyzes tasks, spawns agents
│   │   ├── AgentPool.ts            # Manages worker agent lifecycle
│   │   ├── AgentSession.ts         # Single worker agent wrapper
│   │   └── types.ts                # Shared types for coordination
│   │
│   ├── mcp/
│   │   ├── AgentMailClient.ts      # Agent Mail MCP client
│   │   ├── ClaimsTracker.ts        # Track file reservations
│   │   └── McpManager.ts           # MCP server lifecycle
│   │
│   ├── providers/
│   │   ├── AgentTreeProvider.ts    # Sidebar: orchestrator + workers
│   │   ├── ClaimsTreeProvider.ts   # Sidebar: file claims
│   │   ├── MessagesTreeProvider.ts # Sidebar: agent messages
│   │   ├── WebviewProvider.ts      # Main panel
│   │   ├── DecoratorProvider.ts    # Editor decorations
│   │   └── StatusBarProvider.ts    # Status bar items
│   │
│   ├── commands/
│   │   ├── submitTask.ts           # Main entry point
│   │   ├── spawnAgent.ts           # Manual agent spawn
│   │   ├── sendToAgent.ts          # Send selection to agent
│   │   ├── stopAll.ts              # Emergency stop
│   │   └── index.ts                # Command registration
│   │
│   └── types/
│       └── index.ts                # Shared type definitions
│
├── webview-ui/                     # React app for main panel
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── OrchestratorPanel.tsx   # Orchestrator status + log
│   │   │   ├── AgentCard.tsx           # Individual agent view
│   │   │   ├── AgentGrid.tsx           # Grid of agent cards
│   │   │   ├── ChatView.tsx            # Message history
│   │   │   ├── TaskInput.tsx           # Submit task input
│   │   │   ├── ToolCallView.tsx        # Tool call visualization
│   │   │   └── StatusIndicator.tsx     # Status badges
│   │   ├── hooks/
│   │   │   ├── useVsCodeApi.ts
│   │   │   ├── useOrchestrator.ts
│   │   │   └── useAgentPool.ts
│   │   └── styles/
│   │       └── index.css           # Tailwind or VS Code themed
│   └── vite.config.ts
│
├── resources/
│   ├── icon.png                    # Extension icon
│   ├── orchestrator-icon.svg       # Orchestrator indicator
│   ├── agent-icon.svg              # Worker agent indicator
│   ├── claim-icon.svg              # Claim gutter icon
│   └── waiting-icon.svg            # Waiting status
│
└── test/
    ├── suite/
    │   ├── orchestrator.test.ts
    │   ├── agentPool.test.ts
    │   └── session.test.ts
    └── runTests.ts
```

---

## package.json (Extension Manifest)

```json
{
  "name": "multi-agent-harness",
  "displayName": "Multi-Agent Harness",
  "description": "Orchestrate multiple Claude Code agents working collaboratively on your codebase",
  "version": "0.1.0",
  "publisher": "ignixa",
  "engines": {
    "vscode": "^1.84.0"
  },
  "categories": ["Other", "Machine Learning"],
  "keywords": ["claude", "ai", "agent", "multi-agent", "mcp"],
  "icon": "resources/icon.png",
  "activationEvents": [
    "workspaceContains:.claude",
    "onCommand:multiAgent.openPanel"
  ],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "multiAgent.openPanel",
        "title": "Open Multi-Agent Panel",
        "category": "Multi-Agent",
        "icon": "$(robot)"
      },
      {
        "command": "multiAgent.submitTask",
        "title": "Submit Task to Orchestrator",
        "category": "Multi-Agent",
        "icon": "$(play)"
      },
      {
        "command": "multiAgent.spawnAgent",
        "title": "Manually Spawn Agent",
        "category": "Multi-Agent"
      },
      {
        "command": "multiAgent.destroyAgent",
        "title": "Remove Agent",
        "category": "Multi-Agent"
      },
      {
        "command": "multiAgent.sendToAgent",
        "title": "Send Selection to Agent",
        "category": "Multi-Agent"
      },
      {
        "command": "multiAgent.stopAll",
        "title": "Stop All Agents",
        "category": "Multi-Agent",
        "icon": "$(debug-stop)"
      },
      {
        "command": "multiAgent.viewStatus",
        "title": "View Agent Status",
        "category": "Multi-Agent"
      },
      {
        "command": "multiAgent.refreshClaims",
        "title": "Refresh File Claims",
        "category": "Multi-Agent"
      }
    ],
    "viewsContainers": {
      "activitybar": [
        {
          "id": "multiAgentHarness",
          "title": "Multi-Agent",
          "icon": "resources/agent-icon.svg"
        }
      ]
    },
    "views": {
      "multiAgentHarness": [
        {
          "id": "multiAgent.agents",
          "name": "Agents",
          "contextualTitle": "Active Agents"
        },
        {
          "id": "multiAgent.claims",
          "name": "File Claims",
          "contextualTitle": "Active File Claims"
        },
        {
          "id": "multiAgent.messages",
          "name": "Messages",
          "contextualTitle": "Agent Messages"
        }
      ]
    },
    "viewsWelcome": [
      {
        "view": "multiAgent.agents",
        "contents": "No agents running.\n[Create Agent](command:multiAgent.createAgent)\n[Open Panel](command:multiAgent.openPanel)"
      }
    ],
    "menus": {
      "editor/context": [
        {
          "command": "multiAgent.sendToAgent",
          "when": "editorHasSelection",
          "group": "multiAgent"
        }
      ],
      "view/item/context": [
        {
          "command": "multiAgent.pauseAgent",
          "when": "view == multiAgent.agents && viewItem == agent",
          "group": "inline"
        },
        {
          "command": "multiAgent.destroyAgent",
          "when": "view == multiAgent.agents && viewItem == agent"
        }
      ]
    },
    "configuration": {
      "title": "Multi-Agent Harness",
      "properties": {
        "multiAgent.coordinatorModel": {
          "type": "string",
          "default": "claude-sonnet-4-20250514",
          "description": "Model to use for the orchestrator agent"
        },
        "multiAgent.workerModel": {
          "type": "string",
          "default": "claude-sonnet-4-20250514",
          "description": "Model to use for spawned worker agents"
        },
        "multiAgent.maxConcurrentAgents": {
          "type": "number",
          "default": 5,
          "description": "Maximum number of concurrent worker agents"
        },
        "multiAgent.autoSpawnAgents": {
          "type": "boolean",
          "default": true,
          "description": "Let orchestrator automatically spawn agents (vs manual control)"
        },
        "multiAgent.mcpServers": {
          "type": "object",
          "default": {
            "agent-mail": {
              "transport": "http",
              "url": "http://localhost:8765"
            }
          },
          "description": "MCP server configurations for agents"
        },
        "multiAgent.autoStartAgentMail": {
          "type": "boolean",
          "default": true,
          "description": "Automatically start Agent Mail server if not running"
        },
        "multiAgent.showClaimsInEditor": {
          "type": "boolean",
          "default": true,
          "description": "Show file claim indicators in editor gutter"
        },
        "multiAgent.notifyOnAgentMessage": {
          "type": "boolean",
          "default": true,
          "description": "Show notification when agents send messages to each other"
        },
        "multiAgent.workingDirectory": {
          "type": "string",
          "default": "",
          "description": "Working directory for agents (defaults to workspace root)"
        },
        "multiAgent.agentColorPalette": {
          "type": "array",
          "default": ["#3B82F6", "#EF4444", "#F59E0B", "#10B981", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16"],
          "description": "Color palette for dynamically spawned agents"
        }
      }
    },
    "colors": [
      {
        "id": "multiAgent.claimExclusiveBackground",
        "description": "Background color for exclusively claimed files",
        "defaults": {
          "dark": "#F59E0B20",
          "light": "#F59E0B20"
        }
      },
      {
        "id": "multiAgent.claimSharedBackground",
        "description": "Background color for shared claimed files",
        "defaults": {
          "dark": "#3B82F620",
          "light": "#3B82F620"
        }
      }
    ]
  },
  "scripts": {
    "vscode:prepublish": "npm run build",
    "build": "npm run build:extension && npm run build:webview",
    "build:extension": "webpack --mode production",
    "build:webview": "cd webview-ui && npm run build",
    "watch": "webpack --mode development --watch",
    "lint": "eslint src --ext ts",
    "test": "node ./out/test/runTests.js"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.84.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "eslint": "^8.50.0",
    "typescript": "^5.2.0",
    "webpack": "^5.88.0",
    "webpack-cli": "^5.1.0",
    "ts-loader": "^9.4.0"
  }
}
```

---

## Core Implementation

### extension.ts

```typescript
import * as vscode from "vscode";
import { OrchestratorAgent } from "./coordinator/OrchestratorAgent";
import { AgentPool } from "./coordinator/AgentPool";
import { WebviewProvider } from "./providers/WebviewProvider";
import { AgentTreeProvider } from "./providers/AgentTreeProvider";
import { ClaimsTreeProvider } from "./providers/ClaimsTreeProvider";
import { MessagesTreeProvider } from "./providers/MessagesTreeProvider";
import { DecoratorProvider } from "./providers/DecoratorProvider";
import { StatusBarProvider } from "./providers/StatusBarProvider";
import { registerCommands } from "./commands";

let orchestrator: OrchestratorAgent;
let agentPool: AgentPool;

export async function activate(context: vscode.ExtensionContext) {
  console.log("Multi-Agent Harness activating...");

  // Initialize agent pool (manages worker agents)
  agentPool = new AgentPool(context);

  // Initialize orchestrator (the brain that spawns/manages agents)
  orchestrator = new OrchestratorAgent(context, agentPool);

  // Initialize UI providers
  const webviewProvider = new WebviewProvider(context, orchestrator, agentPool);
  const agentTreeProvider = new AgentTreeProvider(agentPool);
  const claimsTreeProvider = new ClaimsTreeProvider(agentPool);
  const messagesTreeProvider = new MessagesTreeProvider(agentPool);
  const decoratorProvider = new DecoratorProvider(agentPool);
  const statusBarProvider = new StatusBarProvider(orchestrator, agentPool);

  // Register webview
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "multiAgent.panel",
      webviewProvider
    )
  );

  // Register tree views
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "multiAgent.agents",
      agentTreeProvider
    ),
    vscode.window.registerTreeDataProvider(
      "multiAgent.claims",
      claimsTreeProvider
    ),
    vscode.window.registerTreeDataProvider(
      "multiAgent.messages",
      messagesTreeProvider
    )
  );

  // Register commands
  registerCommands(context, orchestrator, agentPool, webviewProvider);

  // Initialize decorators
  decoratorProvider.register(context);

  // Initialize status bar
  statusBarProvider.register(context);

  // Start Agent Mail if configured
  const config = vscode.workspace.getConfiguration("multiAgent");
  if (config.get<boolean>("autoStartAgentMail")) {
    await agentPool.ensureAgentMailRunning();
  }

  console.log("Multi-Agent Harness activated - orchestrator ready");
}

export function deactivate() {
  orchestrator?.dispose();
  agentPool?.dispose();
}
```

### OrchestratorAgent.ts

```typescript
import * as vscode from "vscode";
import { EventEmitter } from "events";
import { query, ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";
import { AgentPool } from "./AgentPool";

const ORCHESTRATOR_SYSTEM_PROMPT = `You are an orchestrating agent that manages a team of specialist AI agents to accomplish coding tasks.

Your job is to:
1. Analyze incoming tasks from the user
2. Break them down into parallelizable work items
3. Spawn specialist agents to handle each piece
4. Coordinate handoffs between agents
5. Monitor progress and adjust as needed
6. Report results back to the user

You have these tools available:
- spawn_agent: Create a new specialist agent
- destroy_agent: Shut down an agent that's done
- message_agent: Send instructions to a running agent
- get_agent_status: Check status of all agents
- report_to_user: Send updates to the user

Guidelines:
- Spawn agents with clear, focused responsibilities
- Use meaningful names that reflect what the agent does (e.g., "R6Parser", "ApiRefactor", "TestWriter")
- Set up dependencies correctly (waitFor) so agents don't step on each other
- Claim files before editing to prevent conflicts
- Spin down agents when their work is complete to save resources
- Keep the user informed of major milestones

You're working in the codebase at: {workingDirectory}
`;

export class OrchestratorAgent extends EventEmitter {
  private outputChannel: vscode.OutputChannel;
  private isProcessing = false;
  private _sessionId?: string;
  private _abortController?: AbortController;
  private _messages: OrchestratorMessage[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly agentPool: AgentPool
  ) {
    super();
    this.outputChannel = vscode.window.createOutputChannel("Multi-Agent Orchestrator");
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  get messages(): OrchestratorMessage[] {
    return [...this._messages];
  }

  async handleUserTask(task: string): Promise<void> {
    if (this.isProcessing) {
      vscode.window.showWarningMessage("Orchestrator is already processing a task");
      return;
    }

    this.isProcessing = true;
    this.emit("statusChanged", "processing");

    // Add user message
    this._messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: task,
      timestamp: new Date(),
    });
    this.emit("message", this._messages[this._messages.length - 1]);

    const config = vscode.workspace.getConfiguration("multiAgent");
    const model = config.get<string>("coordinatorModel") || "claude-sonnet-4-20250514";

    const options: ClaudeAgentOptions = {
      model,
      workingDirectory: this.getWorkingDirectory(),
      systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT.replace(
        "{workingDirectory}",
        this.getWorkingDirectory()
      ),
      tools: this.getOrchestratorTools(),
      mcpServers: this.getMcpServers(),
    };

    try {
      this._abortController = new AbortController();

      const result = query({
        prompt: task,
        options,
        signal: this._abortController.signal,
      });

      for await (const message of result) {
        await this.processOrchestratorMessage(message);
      }

      this.isProcessing = false;
      this.emit("statusChanged", "idle");
    } catch (error) {
      this.isProcessing = false;
      this.emit("statusChanged", "error");
      this.emit("error", error);
      this.outputChannel.appendLine(`Orchestrator error: ${error}`);
    }
  }

  private async processOrchestratorMessage(message: SDKMessage): Promise<void> {
    if (message.type === "assistant" && message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === "text") {
          this._messages.push({
            id: crypto.randomUUID(),
            role: "assistant",
            content: block.text,
            timestamp: new Date(),
          });
          this.emit("message", this._messages[this._messages.length - 1]);
        }

        if (block.type === "tool_use") {
          await this.handleOrchestratorToolCall(block.name, block.input);
        }
      }
    }

    if (message.type === "result") {
      this._sessionId = message.session_id;
    }
  }

  private async handleOrchestratorToolCall(
    name: string,
    args: Record<string, unknown>
  ): Promise<void> {
    this.outputChannel.appendLine(`Orchestrator tool: ${name} ${JSON.stringify(args)}`);

    switch (name) {
      case "spawn_agent": {
        const { name: agentName, role, focus, systemPrompt, waitFor, priority } = args as {
          name: string;
          role: string;
          focus: string;
          systemPrompt?: string;
          waitFor?: string[];
          priority?: number;
        };

        await this.agentPool.spawnAgent({
          name: agentName,
          role,
          focus,
          systemPrompt: systemPrompt || `You are a ${role}. Your focus: ${focus}`,
          waitFor: waitFor || [],
          priority: priority || 0,
          workingDirectory: this.getWorkingDirectory(),
        });

        this.emit("agentSpawned", agentName);
        vscode.window.showInformationMessage(`Spawned agent: ${agentName} (${role})`);
        break;
      }

      case "destroy_agent": {
        const { name: agentName, reason } = args as { name: string; reason: string };
        await this.agentPool.destroyAgent(agentName);
        this.emit("agentDestroyed", agentName);
        this.outputChannel.appendLine(`Destroyed ${agentName}: ${reason}`);
        break;
      }

      case "message_agent": {
        const { name: agentName, message } = args as { name: string; message: string };
        await this.agentPool.messageAgent(agentName, message);
        break;
      }

      case "get_agent_status": {
        const status = this.agentPool.getStatus();
        this.outputChannel.appendLine(`Agent status: ${JSON.stringify(status, null, 2)}`);
        break;
      }

      case "report_to_user": {
        const { type, message } = args as { type: string; message: string };
        this._messages.push({
          id: crypto.randomUUID(),
          role: "orchestrator",
          content: message,
          timestamp: new Date(),
          reportType: type as "progress" | "complete" | "error" | "question",
        });
        this.emit("message", this._messages[this._messages.length - 1]);
        this.emit("reportToUser", { type, message });

        // Show VS Code notification for important updates
        if (type === "complete") {
          vscode.window.showInformationMessage(`✅ ${message}`);
        } else if (type === "error") {
          vscode.window.showErrorMessage(`❌ ${message}`);
        }
        break;
      }
    }
  }

  private getOrchestratorTools(): Tool[] {
    return [
      {
        name: "spawn_agent",
        description: "Create a new specialist agent to work on a specific part of the task",
        input_schema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Unique name for this agent (e.g., 'R6Parser', 'ApiRefactor')",
            },
            role: {
              type: "string",
              description: "What this agent specializes in (e.g., 'Core Parser Engineer')",
            },
            focus: {
              type: "string",
              description: "Specific task this agent should accomplish",
            },
            systemPrompt: {
              type: "string",
              description: "Detailed instructions for the agent (optional)",
            },
            waitFor: {
              type: "array",
              items: { type: "string" },
              description: "Names of agents this one should wait for before starting",
            },
            priority: {
              type: "number",
              description: "Execution priority (lower = start sooner)",
            },
          },
          required: ["name", "role", "focus"],
        },
      },
      {
        name: "destroy_agent",
        description: "Shut down an agent that has completed its work or is no longer needed",
        input_schema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Agent name to shut down" },
            reason: { type: "string", description: "Why (completed, no longer needed, error)" },
          },
          required: ["name", "reason"],
        },
      },
      {
        name: "message_agent",
        description: "Send instructions or updates to a running agent",
        input_schema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Target agent name" },
            message: { type: "string", description: "Message to send" },
          },
          required: ["name", "message"],
        },
      },
      {
        name: "get_agent_status",
        description: "Get the current status of all running agents",
        input_schema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "report_to_user",
        description: "Send a progress update or final report to the user",
        input_schema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["progress", "complete", "error", "question"],
              description: "Type of report",
            },
            message: { type: "string", description: "The update message" },
          },
          required: ["type", "message"],
        },
      },
    ];
  }

  private getMcpServers(): Record<string, McpServerConfig> {
    const config = vscode.workspace.getConfiguration("multiAgent");
    return config.get<Record<string, McpServerConfig>>("mcpServers") || {};
  }

  private getWorkingDirectory(): string {
    const config = vscode.workspace.getConfiguration("multiAgent");
    const configured = config.get<string>("workingDirectory");
    if (configured) return configured;

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    return workspaceFolder?.uri.fsPath || process.cwd();
  }

  stop(): void {
    this._abortController?.abort();
    this.isProcessing = false;
    this.emit("statusChanged", "idle");
  }

  dispose(): void {
    this.stop();
    this.outputChannel.dispose();
  }
}

interface OrchestratorMessage {
  id: string;
  role: "user" | "assistant" | "orchestrator";
  content: string;
  timestamp: Date;
  reportType?: "progress" | "complete" | "error" | "question";
}
```

### AgentPool.ts

```typescript
import * as vscode from "vscode";
import { EventEmitter } from "events";
import { AgentSession, AgentConfig } from "./AgentSession";
import { AgentMailClient } from "../mcp/AgentMailClient";
import { ClaimsTracker } from "../mcp/ClaimsTracker";

interface SpawnConfig {
  name: string;
  role: string;
  focus: string;
  systemPrompt: string;
  waitFor: string[];
  priority: number;
  workingDirectory: string;
}

export class AgentPool extends EventEmitter {
  private sessions = new Map<string, AgentSession>();
  private pendingAgents = new Map<string, SpawnConfig>(); // Waiting for dependencies
  private agentMailClient: AgentMailClient;
  private claimsTracker: ClaimsTracker;
  private outputChannel: vscode.OutputChannel;
  private colorIndex = 0;

  constructor(private readonly context: vscode.ExtensionContext) {
    super();
    this.outputChannel = vscode.window.createOutputChannel("Multi-Agent Pool");
    this.agentMailClient = new AgentMailClient();
    this.claimsTracker = new ClaimsTracker();
  }

  async spawnAgent(config: SpawnConfig): Promise<AgentSession> {
    // Check resource limits
    const maxAgents = vscode.workspace
      .getConfiguration("multiAgent")
      .get<number>("maxConcurrentAgents") || 5;

    if (this.sessions.size >= maxAgents) {
      throw new Error(`Maximum concurrent agents (${maxAgents}) reached`);
    }

    if (this.sessions.has(config.name)) {
      throw new Error(`Agent ${config.name} already exists`);
    }

    // Check if dependencies are satisfied
    const unsatisfied = config.waitFor.filter(
      (dep) => this.sessions.has(dep) && this.sessions.get(dep)!.status !== "complete"
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

  private async doSpawnAgent(config: SpawnConfig): Promise<AgentSession> {
    const color = this.getNextColor();
    const mcpServers = this.getMcpServers();

    const session = new AgentSession({
      name: config.name,
      role: config.role,
      focus: config.focus,
      systemPrompt: this.buildAgentSystemPrompt(config),
      workingDirectory: config.workingDirectory,
      mcpServers,
      color,
    });

    // Wire up event handlers
    session.on("output", (output) => {
      this.handleAgentOutput(config.name, output);
    });

    session.on("statusChanged", (status) => {
      this.emit("agentStatusChanged", config.name, status);

      // Check if any pending agents can now start
      if (status === "complete" || status === "idle") {
        this.checkPendingAgents(config.name);
      }
    });

    session.on("error", (error) => {
      this.outputChannel.appendLine(`[${config.name}] Error: ${error}`);
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

  private buildAgentSystemPrompt(config: SpawnConfig): string {
    return `${config.systemPrompt}

Your agent name is "${config.name}".
Your role: ${config.role}
Your focus: ${config.focus}

You are part of a multi-agent team coordinated by an orchestrator.
- Use send_message() to communicate with other agents
- Use inbox() to check for messages
- Use reserve_file_paths() before editing files to avoid conflicts
- When your task is complete, send a message to the orchestrator summarizing your work
`;
  }

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
        this.doSpawnAgent(config);
      }
    }
  }

  private createPlaceholderSession(config: SpawnConfig): AgentSession {
    // Return a session in "waiting" state
    const session = new AgentSession({
      name: config.name,
      role: config.role,
      focus: config.focus,
      systemPrompt: "",
      workingDirectory: config.workingDirectory,
      mcpServers: {},
      color: this.getNextColor(),
      initialStatus: "waiting",
    });
    this.sessions.set(config.name, session);
    return session;
  }

  private handleAgentOutput(agentName: string, output: AgentOutput): void {
    this.emit("agentOutput", agentName, output);

    // Intercept tool calls for routing
    if (output.type === "toolCall") {
      this.handleToolCall(agentName, output as ToolCallOutput);
    }
  }

  private async handleToolCall(agentName: string, toolCall: ToolCallOutput): Promise<void> {
    const { name, arguments: args } = toolCall;

    // Route send_message to recipient
    if (name === "send_message") {
      const to = args.to as string;
      const subject = args.subject as string;
      const body = args.body as string;

      this.emit("messageReceived", {
        id: crypto.randomUUID(),
        from: agentName,
        to,
        subject,
        body,
        timestamp: new Date(),
        read: false,
      });

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
      const paths = args.paths as string[];
      const exclusive = args.exclusive as boolean;
      const reason = args.reason as string;
      const ttl = args.ttl as number;

      this.claimsTracker.addClaims(agentName, paths, exclusive, reason, ttl);
      this.emit("claimsUpdated", this.claimsTracker.getAllClaims());
    }

    if (name === "release_claims") {
      this.claimsTracker.releaseClaims(agentName);
      this.emit("claimsUpdated", this.claimsTracker.getAllClaims());
    }
  }

  async destroyAgent(agentName: string): Promise<void> {
    const session = this.sessions.get(agentName);
    if (session) {
      await session.stop();
      this.sessions.delete(agentName);
      this.claimsTracker.releaseClaims(agentName);
      this.emit("agentDestroyed", agentName);
      this.emit("claimsUpdated", this.claimsTracker.getAllClaims());
    }
    this.pendingAgents.delete(agentName);
  }

  async messageAgent(agentName: string, message: string): Promise<void> {
    const session = this.sessions.get(agentName);
    if (session) {
      await session.injectNotification(message);
    }
  }

  getAgent(name: string): AgentSession | undefined {
    return this.sessions.get(name);
  }

  getAllAgents(): AgentSession[] {
    return Array.from(this.sessions.values());
  }

  getAllClaims(): FileClaim[] {
    return this.claimsTracker.getAllClaims();
  }

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

  async ensureAgentMailRunning(): Promise<void> {
    const isRunning = await this.agentMailClient.healthCheck();
    if (!isRunning) {
      this.outputChannel.appendLine("Starting Agent Mail server...");
      await this.agentMailClient.start();
    }
  }

  private getMcpServers(): Record<string, McpServerConfig> {
    const config = vscode.workspace.getConfiguration("multiAgent");
    return config.get<Record<string, McpServerConfig>>("mcpServers") || {};
  }

  private getNextColor(): string {
    const config = vscode.workspace.getConfiguration("multiAgent");
    const palette = config.get<string[]>("agentColorPalette") || [
      "#3B82F6", "#EF4444", "#F59E0B", "#10B981",
      "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16",
    ];
    const color = palette[this.colorIndex % palette.length];
    this.colorIndex++;
    return color;
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      session.stop();
    }
    this.sessions.clear();
    this.pendingAgents.clear();
    this.outputChannel.dispose();
  }
}

interface AgentPoolStatus {
  activeAgents: Array<{
    name: string;
    role: string;
    status: string;
    focus: string;
  }>;
  pendingAgents: string[];
  totalCost: number;
}
```

### AgentSession.ts

```typescript
import { query, ClaudeAgentOptions, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { EventEmitter } from "events";

export interface AgentConfig {
  name: string;
  workingDirectory: string;
  systemPrompt?: string;
  role?: string;
  allowedTools?: string[];
  mcpServers?: Record<string, McpServerConfig>;
}

export type AgentStatus = "initializing" | "idle" | "processing" | "paused" | "error";

export class AgentSession extends EventEmitter {
  private _status: AgentStatus = "initializing";
  private _sessionId?: string;
  private _abortController?: AbortController;
  private _isPaused = false;
  private _pendingPrompt?: string;
  private _costUsd = 0;
  private _messages: ChatMessage[] = [];

  constructor(private readonly config: AgentConfig) {
    super();
  }

  get name(): string {
    return this.config.name;
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

  async sendPrompt(prompt: string): Promise<void> {
    if (this._isPaused) {
      this._pendingPrompt = prompt;
      return;
    }

    this._status = "processing";
    this.emit("statusChanged", this._status);

    // Add user message
    this._messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
      timestamp: new Date(),
    });

    const options: ClaudeAgentOptions = {
      workingDirectory: this.config.workingDirectory,
      allowedTools: this.config.allowedTools,
      mcpServers: this.config.mcpServers,
      settingSources: ["project"],
      systemPrompt: this.buildSystemPrompt(),
    };

    try {
      this._abortController = new AbortController();

      const result = query({
        prompt,
        options,
        signal: this._abortController.signal,
      });

      for await (const message of result) {
        const output = this.processMessage(message);
        if (output) {
          this.emit("output", output);
        }
      }

      this._status = "idle";
      this.emit("statusChanged", this._status);
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        this._status = "paused";
      } else {
        this._status = "error";
        this.emit("error", error);
      }
      this.emit("statusChanged", this._status);
    }
  }

  async injectNotification(message: string): Promise<void> {
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
  }

  pause(): void {
    this._isPaused = true;
    this._abortController?.abort();
    this._status = "paused";
    this.emit("statusChanged", this._status);
  }

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

  stop(): void {
    this._abortController?.abort();
    this._status = "idle";
    this.emit("statusChanged", this._status);
  }

  private buildSystemPrompt(): string {
    const parts: string[] = [];

    if (this.config.role) {
      parts.push(`You are ${this.config.role}.`);
    }

    parts.push(`Your agent name is "${this.config.name}".`);
    parts.push(
      "You are part of a multi-agent team. " +
      "Use send_message() to communicate with other agents. " +
      "Use inbox() to check for messages. " +
      "Use reserve_file_paths() before editing files to avoid conflicts."
    );

    if (this.config.systemPrompt) {
      parts.push(this.config.systemPrompt);
    }

    return parts.join("\n\n");
  }

  private processMessage(message: SDKMessage): AgentOutput | null {
    switch (message.type) {
      case "assistant":
        if (message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === "text") {
              const chatMsg: ChatMessage = {
                id: crypto.randomUUID(),
                role: "assistant",
                content: block.text,
                timestamp: new Date(),
              };
              this._messages.push(chatMsg);
              return { type: "text", content: block.text };
            }
            
            if (block.type === "tool_use") {
              const chatMsg: ChatMessage = {
                id: crypto.randomUUID(),
                role: "tool",
                content: `Using ${block.name}`,
                timestamp: new Date(),
                toolCall: {
                  id: block.id,
                  name: block.name,
                  arguments: block.input,
                },
              };
              this._messages.push(chatMsg);
              return {
                type: "toolCall",
                id: block.id,
                name: block.name,
                arguments: block.input,
              };
            }
          }
        }
        break;

      case "result":
        this._sessionId = message.session_id;
        this._costUsd += message.total_cost_usd || 0;
        return {
          type: "complete",
          result: message.result,
          sessionId: message.session_id,
          costUsd: message.total_cost_usd,
          durationMs: message.duration_ms,
        };
    }

    return null;
  }
}
```

### DecoratorProvider.ts (Editor Decorations)

```typescript
import * as vscode from "vscode";
import { AgentCoordinator } from "../coordinator/AgentCoordinator";
import { FileClaim } from "../types";

export class DecoratorProvider {
  private exclusiveDecoration: vscode.TextEditorDecorationType;
  private sharedDecoration: vscode.TextEditorDecorationType;
  private claims: FileClaim[] = [];

  constructor(private readonly coordinator: AgentCoordinator) {
    // Create decoration types
    this.exclusiveDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.file(__dirname + "/../../resources/lock-icon.svg"),
      gutterIconSize: "contain",
      overviewRulerColor: new vscode.ThemeColor("multiAgent.claimExclusiveBackground"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor("multiAgent.claimExclusiveBackground"),
    });

    this.sharedDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.file(__dirname + "/../../resources/shared-icon.svg"),
      gutterIconSize: "contain",
      overviewRulerColor: new vscode.ThemeColor("multiAgent.claimSharedBackground"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    // Listen for claims updates
    coordinator.on("claimsUpdated", (claims: FileClaim[]) => {
      this.claims = claims;
      this.updateDecorations();
    });
  }

  register(context: vscode.ExtensionContext): void {
    // Update decorations when active editor changes
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.updateDecorations()),
      vscode.workspace.onDidOpenTextDocument(() => this.updateDecorations())
    );

    // Register hover provider for claim details
    context.subscriptions.push(
      vscode.languages.registerHoverProvider("*", {
        provideHover: (document, position) => this.provideClaimHover(document, position),
      })
    );
  }

  private updateDecorations(): void {
    const config = vscode.workspace.getConfiguration("multiAgent");
    if (!config.get<boolean>("showClaimsInEditor")) return;

    for (const editor of vscode.window.visibleTextEditors) {
      const filePath = editor.document.uri.fsPath;
      const claim = this.findMatchingClaim(filePath);

      if (claim) {
        const range = new vscode.Range(0, 0, editor.document.lineCount, 0);
        const decoration = claim.exclusive ? this.exclusiveDecoration : this.sharedDecoration;
        
        editor.setDecorations(decoration, [{ range }]);
        editor.setDecorations(
          claim.exclusive ? this.sharedDecoration : this.exclusiveDecoration,
          []
        );
      } else {
        editor.setDecorations(this.exclusiveDecoration, []);
        editor.setDecorations(this.sharedDecoration, []);
      }
    }
  }

  private findMatchingClaim(filePath: string): FileClaim | undefined {
    for (const claim of this.claims) {
      if (this.matchesPattern(filePath, claim.pathPattern)) {
        return claim;
      }
    }
    return undefined;
  }

  private matchesPattern(filePath: string, pattern: string): boolean {
    // Simple glob matching - could use minimatch for full support
    const regexPattern = pattern
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")
      .replace(/\//g, "\\/");
    return new RegExp(regexPattern).test(filePath);
  }

  private provideClaimHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | undefined {
    const claim = this.findMatchingClaim(document.uri.fsPath);
    if (!claim) return undefined;

    const markdown = new vscode.MarkdownString();
    markdown.appendMarkdown(`## 🔒 File Claimed\n\n`);
    markdown.appendMarkdown(`**Agent:** ${claim.agentName}\n\n`);
    markdown.appendMarkdown(`**Type:** ${claim.exclusive ? "Exclusive" : "Shared"}\n\n`);
    
    if (claim.reason) {
      markdown.appendMarkdown(`**Reason:** ${claim.reason}\n\n`);
    }
    
    const expiresIn = Math.round((claim.expiresAt.getTime() - Date.now()) / 1000 / 60);
    markdown.appendMarkdown(`**Expires in:** ${expiresIn} minutes\n`);

    return new vscode.Hover(markdown);
  }

  dispose(): void {
    this.exclusiveDecoration.dispose();
    this.sharedDecoration.dispose();
  }
}
```

---

## Webview UI (React)

### App.tsx

```tsx
import React, { useState, useEffect } from "react";
import { OrchestratorPanel } from "./components/OrchestratorPanel";
import { AgentGrid } from "./components/AgentGrid";
import { TaskInput } from "./components/TaskInput";
import { useVsCodeApi } from "./hooks/useVsCodeApi";
import "./styles/index.css";

interface OrchestratorState {
  status: "idle" | "processing" | "error";
  currentTask?: string;
  messages: OrchestratorMessage[];
}

interface AgentState {
  name: string;
  role: string;
  focus: string;
  status: "waiting" | "idle" | "processing" | "complete" | "error";
  color: string;
  messages: ChatMessage[];
  waitingFor: string[];
  costUsd: number;
}

export function App() {
  const vscode = useVsCodeApi();
  const [orchestrator, setOrchestrator] = useState<OrchestratorState>({
    status: "idle",
    messages: [],
  });
  const [agents, setAgents] = useState<AgentState[]>([]);

  useEffect(() => {
    vscode.postMessage({ type: "getState" });

    const handler = (event: MessageEvent) => {
      const message = event.data;

      switch (message.type) {
        case "state":
          setOrchestrator(message.orchestrator);
          setAgents(message.agents);
          break;

        case "orchestratorUpdate":
          setOrchestrator((prev) => ({ ...prev, ...message.updates }));
          break;

        case "orchestratorMessage":
          setOrchestrator((prev) => ({
            ...prev,
            messages: [...prev.messages, message.message],
          }));
          break;

        case "agentSpawned":
          setAgents((prev) => [...prev, message.agent]);
          break;

        case "agentDestroyed":
          setAgents((prev) => prev.filter((a) => a.name !== message.agentName));
          break;

        case "agentUpdate":
          setAgents((prev) =>
            prev.map((a) =>
              a.name === message.agentName ? { ...a, ...message.updates } : a
            )
          );
          break;
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [vscode]);

  const submitTask = (task: string) => {
    vscode.postMessage({ type: "submitTask", task });
  };

  const stopAll = () => {
    vscode.postMessage({ type: "stopAll" });
  };

  return (
    <div className="app">
      {/* Task Input */}
      <TaskInput
        onSubmit={submitTask}
        disabled={orchestrator.status === "processing"}
      />

      {/* Orchestrator Panel */}
      <OrchestratorPanel
        status={orchestrator.status}
        currentTask={orchestrator.currentTask}
        messages={orchestrator.messages}
        onStop={stopAll}
      />

      {/* Dynamic Agent Grid */}
      {agents.length > 0 && (
        <AgentGrid agents={agents} />
      )}

      {/* Empty State */}
      {agents.length === 0 && orchestrator.status === "idle" && (
        <div className="empty-state">
          <h2>No agents running</h2>
          <p>Submit a task above and the orchestrator will spawn the right agents</p>
        </div>
      )}
    </div>
  );
}
```

### OrchestratorPanel.tsx

```tsx
import React from "react";
import { StatusIndicator } from "./StatusIndicator";

interface OrchestratorPanelProps {
  status: "idle" | "processing" | "error";
  currentTask?: string;
  messages: OrchestratorMessage[];
  onStop: () => void;
}

export function OrchestratorPanel({
  status,
  currentTask,
  messages,
  onStop,
}: OrchestratorPanelProps) {
  return (
    <div className="orchestrator-panel">
      <div className="orchestrator-header">
        <div className="orchestrator-title">
          <span className="icon">🎯</span>
          <span>Orchestrator</span>
          <StatusIndicator status={status} />
        </div>
        {status === "processing" && (
          <button className="stop-button" onClick={onStop} title="Stop all">
            ⏹️
          </button>
        )}
      </div>

      {currentTask && (
        <div className="current-task">
          <strong>Task:</strong> {currentTask}
        </div>
      )}

      <div className="orchestrator-log">
        {messages.map((msg) => (
          <div key={msg.id} className={`log-entry ${msg.role} ${msg.reportType || ""}`}>
            {msg.reportType === "progress" && <span className="icon">📊</span>}
            {msg.reportType === "complete" && <span className="icon">✅</span>}
            {msg.reportType === "error" && <span className="icon">❌</span>}
            {msg.role === "user" && <span className="icon">👤</span>}
            <span className="content">{msg.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### AgentCard.tsx

```tsx
import React from "react";
import { StatusIndicator } from "./StatusIndicator";
import { ChatView } from "./ChatView";

interface AgentCardProps {
  agent: AgentState;
}

export function AgentCard({ agent }: AgentCardProps) {
  const isWaiting = agent.status === "waiting";

  return (
    <div
      className={`agent-card ${agent.status}`}
      style={{ borderColor: agent.color }}
    >
      <div className="agent-header" style={{ backgroundColor: agent.color + "20" }}>
        <div className="agent-info">
          <span className="agent-name">{agent.name}</span>
          <span className="agent-role">{agent.role}</span>
        </div>
        <StatusIndicator status={agent.status} />
      </div>

      <div className="agent-focus">
        <strong>Focus:</strong> {agent.focus}
      </div>

      {isWaiting && agent.waitingFor.length > 0 && (
        <div className="waiting-for">
          ⏳ Waiting for: {agent.waitingFor.join(", ")}
        </div>
      )}

      {!isWaiting && (
        <ChatView messages={agent.messages} compact />
      )}

      <div className="agent-footer">
        <span className="cost">${agent.costUsd.toFixed(4)}</span>
      </div>
    </div>
  );
}
```

### TaskInput.tsx

```tsx
import React, { useState } from "react";

interface TaskInputProps {
  onSubmit: (task: string) => void;
  disabled: boolean;
}

export function TaskInput({ onSubmit, disabled }: TaskInputProps) {
  const [task, setTask] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (task.trim() && !disabled) {
      onSubmit(task.trim());
      setTask("");
    }
  };

  return (
    <form className="task-input" onSubmit={handleSubmit}>
      <input
        type="text"
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="Describe a task for the agent team..."
        disabled={disabled}
      />
      <button type="submit" disabled={disabled || !task.trim()}>
        {disabled ? "Working..." : "Submit Task"}
      </button>
    </form>
  );
}
```

---

## Commands

### commands/index.ts

```typescript
import * as vscode from "vscode";
import { OrchestratorAgent } from "../coordinator/OrchestratorAgent";
import { AgentPool } from "../coordinator/AgentPool";
import { WebviewProvider } from "../providers/WebviewProvider";

export function registerCommands(
  context: vscode.ExtensionContext,
  orchestrator: OrchestratorAgent,
  agentPool: AgentPool,
  webviewProvider: WebviewProvider
): void {

  // Open panel
  context.subscriptions.push(
    vscode.commands.registerCommand("multiAgent.openPanel", () => {
      webviewProvider.show();
    })
  );

  // Submit task to orchestrator (main entry point)
  context.subscriptions.push(
    vscode.commands.registerCommand("multiAgent.submitTask", async () => {
      const task = await vscode.window.showInputBox({
        prompt: "Describe the task for the agent team",
        placeHolder: "e.g., Add FHIR R6 support with full test coverage",
        ignoreFocusOut: true,
      });

      if (!task) return;

      await orchestrator.handleUserTask(task);
    })
  );

  // Manual agent spawn (bypass orchestrator)
  context.subscriptions.push(
    vscode.commands.registerCommand("multiAgent.spawnAgent", async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Agent name",
        placeHolder: "e.g., Parser, ApiRefactor, TestWriter",
      });
      if (!name) return;

      const role = await vscode.window.showInputBox({
        prompt: "Agent role",
        placeHolder: "e.g., Core Parser Engineer",
      });
      if (!role) return;

      const focus = await vscode.window.showInputBox({
        prompt: "What should this agent work on?",
        placeHolder: "e.g., Refactor the FHIR parser to support R6",
      });
      if (!focus) return;

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      await agentPool.spawnAgent({
        name,
        role,
        focus,
        systemPrompt: `You are a ${role}. Your focus: ${focus}`,
        waitFor: [],
        priority: 0,
        workingDirectory: workspaceFolder?.uri.fsPath || process.cwd(),
      });

      vscode.window.showInformationMessage(`Spawned agent: ${name}`);
    })
  );

  // Send selection to specific agent
  context.subscriptions.push(
    vscode.commands.registerCommand("multiAgent.sendToAgent", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.document.getText(editor.selection);
      if (!selection) {
        vscode.window.showWarningMessage("No text selected");
        return;
      }

      const agents = agentPool.getAllAgents();
      if (agents.length === 0) {
        vscode.window.showWarningMessage("No agents running");
        return;
      }

      const agentName = await vscode.window.showQuickPick(
        agents.map((a) => ({ label: a.name, description: a.role })),
        { placeHolder: "Select agent" }
      );

      if (!agentName) return;

      const prompt = await vscode.window.showInputBox({
        prompt: "What should the agent do with this code?",
        placeHolder: "e.g., Review this code, Fix the bug, Add tests",
      });

      if (!prompt) return;

      const fullPrompt = `${prompt}\n\nCode:\n\`\`\`\n${selection}\n\`\`\``;
      await agentPool.messageAgent(agentName.label, fullPrompt);
    })
  );

  // Stop all agents
  context.subscriptions.push(
    vscode.commands.registerCommand("multiAgent.stopAll", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Stop all agents?",
        { modal: true },
        "Stop All"
      );

      if (confirm === "Stop All") {
        orchestrator.stop();
        for (const agent of agentPool.getAllAgents()) {
          await agentPool.destroyAgent(agent.name);
        }
        vscode.window.showInformationMessage("All agents stopped");
      }
    })
  );

  // Destroy specific agent
  context.subscriptions.push(
    vscode.commands.registerCommand("multiAgent.destroyAgent", async (item?: { name: string }) => {
      const agentName = item?.name || await selectAgent(agentPool, "Select agent to remove");
      if (!agentName) return;

      await agentPool.destroyAgent(agentName);
      vscode.window.showInformationMessage(`Agent ${agentName} removed`);
    })
  );

  // View agent status
  context.subscriptions.push(
    vscode.commands.registerCommand("multiAgent.viewStatus", () => {
      const status = agentPool.getStatus();
      const output = vscode.window.createOutputChannel("Agent Status");
      output.clear();
      output.appendLine("=== Multi-Agent Status ===\n");
      output.appendLine(`Active Agents: ${status.activeAgents.length}`);
      output.appendLine(`Pending Agents: ${status.pendingAgents.length}`);
      output.appendLine(`Total Cost: $${status.totalCost.toFixed(4)}\n`);

      for (const agent of status.activeAgents) {
        output.appendLine(`[${agent.status.toUpperCase()}] ${agent.name} (${agent.role})`);
        output.appendLine(`  Focus: ${agent.focus}\n`);
      }

      if (status.pendingAgents.length > 0) {
        output.appendLine("Pending:");
        for (const name of status.pendingAgents) {
          output.appendLine(`  - ${name}`);
        }
      }

      output.show();
    })
  );
}

async function selectAgent(
  agentPool: AgentPool,
  placeholder: string
): Promise<string | undefined> {
  const agents = agentPool.getAllAgents();
  if (agents.length === 0) {
    vscode.window.showWarningMessage("No agents running");
    return undefined;
  }
  const selected = await vscode.window.showQuickPick(
    agents.map((a) => ({ label: a.name, description: a.role })),
    { placeHolder: placeholder }
  );
  return selected?.label;
}
```

---

## Installation & Usage

### Prerequisites

- VS Code 1.84.0 or later
- Node.js 20+ (for Claude Agent SDK)
- Claude Code CLI or API key
- MCP Agent Mail (optional, for cross-agent messaging)

### Installation

```bash
# From VS Code Marketplace (when published)
ext install ignixa.multi-agent-harness

# Or from VSIX
code --install-extension multi-agent-harness-0.1.0.vsix
```

### First Use

1. Open a workspace with your code
2. Click the Multi-Agent icon in the Activity Bar (🤖)
3. Default agents (BlueLake, RedPine, GoldStar) are created automatically
4. Click on an agent panel and type a prompt
5. Watch agents work and communicate

### Configuration

Add to your `settings.json`:

```json
{
  "multiAgent.coordinatorModel": "claude-sonnet-4-20250514",
  "multiAgent.workerModel": "claude-sonnet-4-20250514",
  "multiAgent.maxConcurrentAgents": 5,
  "multiAgent.autoSpawnAgents": true,
  "multiAgent.mcpServers": {
    "agent-mail": {
      "transport": "http",
      "url": "http://localhost:8765"
    },
    "ignixa": {
      "transport": "http",
      "url": "http://localhost:5100"
    }
  },
  "multiAgent.agentColorPalette": [
    "#3B82F6",
    "#EF4444", 
    "#F59E0B",
    "#10B981",
    "#8B5CF6",
    "#EC4899"
  ]
}
```

### Example Session

```
You: "Add FHIR R6 support to the parser with tests"

Orchestrator: "I'll analyze this task and create a team..."

  → Spawns "R6Spec" (FHIR Spec Analyst) 
    Focus: Analyze R6 spec changes from R5
    
  → Spawns "R6Parser" (Core Engineer)
    Focus: Update IFhirReader for R6
    Waits for: R6Spec
    
  → Spawns "R6Tests" (Test Engineer)
    Focus: Test coverage for R6 parsing
    Waits for: R6Parser

[R6Spec completes, R6Parser starts]
[R6Parser completes, R6Tests starts]
[R6Tests completes]

Orchestrator: "✅ Task complete. 
  - R6 spec analyzed: 12 new resource types, 3 breaking changes
  - Parser updated: IFhirReader now handles R6
  - Tests added: 47 new tests, 94% coverage
  All agents have been shut down."
```

---

## Roadmap

### v0.1.0 (MVP)
- [x] Basic extension structure
- [x] Orchestrator agent with spawn/destroy tools
- [x] AgentPool for worker management
- [x] Dynamic agent spawning based on task analysis
- [x] Webview with orchestrator panel + agent cards
- [x] File claims visualization
- [ ] Claude Agent SDK integration
- [ ] Status bar integration
- [ ] Basic tree views

### v0.2.0
- [ ] Agent Mail MCP integration
- [ ] Dependency tracking (waitFor)
- [ ] Agent-to-agent message routing
- [ ] Session persistence (resume tasks)
- [ ] Cost tracking dashboard

### v0.3.0
- [ ] Orchestrator learning (remember what worked)
- [ ] Task templates (common patterns)
- [ ] Git integration (auto-branch per task)
- [ ] Beads integration for task tracking
- [ ] Export task history

### v1.0.0
- [ ] Multi-model support (different models for different agents)
- [ ] Remote agent execution
- [ ] Team sharing (shared orchestrator configs)
- [ ] VS Code Marketplace publication
- [ ] Codex/Gemini agent support (experimental)

---

## Open Questions

1. **Orchestrator persistence** — Should orchestrator remember previous tasks and what agent configurations worked?
2. **Agent reuse** — When should orchestrator reuse an existing agent vs spawn a fresh one?
3. **Cost budgets** — Should orchestrator respect per-task or per-session cost limits?
4. **Parallelism strategy** — How aggressive should orchestrator be in spawning parallel agents?
5. **Human checkpoints** — Should orchestrator pause for human approval at certain points?
6. **Recovery** — If orchestrator or VS Code crashes mid-task, how to resume?

---

## References

- [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview)
- [VS Code Extension API](https://code.visualstudio.com/api)
- [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [MCP Agent Mail](https://github.com/Dicklesworthstone/mcp_agent_mail)
- [Kiro IDE](https://kiro.dev/) — Inspiration for spec-driven development
- [OpenAI Swarm](https://github.com/openai/swarm) — Multi-agent orchestration patterns
- [LangGraph](https://github.com/langchain-ai/langgraph) — Agent workflow graphs
