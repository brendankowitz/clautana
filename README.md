# Clautana

**AI-powered multi-agent orchestration for VS Code.**

Clautana brings the power of multi-agent systems directly into your IDE. It features a central "Orchestrator" agent that intelligently breaks down complex coding tasks, manages a team of specialized "Worker" agents, and tracks progress on a built-in Kanban board.

## Features

*   **🤖 Intelligent Orchestrator**: A master agent that plans, delegates, and oversees work.
*   **👥 Specialist Workers**: Spawns purpose-built agents (e.g., "Backend Engineer", "Code Reviewer") to handle specific sub-tasks.
*   **📋 Kanban Workflow**: Integrated Kanban board to visualize User Stories and task progress in real-time.
*   **🔌 MCP-Native**: Built on the **Model Context Protocol (MCP)** for standardized tool use and inter-agent communication.
*   **🧠 Persistent Memory**: Agents learn and remember facts, lessons, and playbooks across sessions.
*   **📨 Agent Messaging**: Full email-like communication system between agents for coordination and hand-offs.
*   **🔒 File Claims**: Prevents conflicts by allowing agents to "claim" files they are editing.

## How it Works

1.  **Submit a Task**: You describe your goal to the Orchestrator in the chat panel.
2.  **Plan & Create**: The Orchestrator analyzes the request and creates **User Stories** on the Kanban board.
3.  **Spawn & Delegate**: Specialized Worker Agents are spawned and assigned to specific stories.
4.  **Execute**: Agents work autonomously, using tools to edit code, run commands, and communicate.
5.  **Review**: Optional review agents check the work before it's marked as done.

## Getting Started

### Prerequisites

*   VS Code ^1.84.0
*   Node.js & npm (for building from source)

### Installation

1.  Clone the repository.
2.  Run `npm run build` in the `src/multi-agent-harness` directory.
3.  Press `F5` in VS Code to launch the extension in a new window.

## Usage

*   **Open Panel**: Click the Clautana icon in the Activity Bar or run `Clautana: Open Clautana Panel`.
*   **Submit Task**: Type your request in the chat (e.g., "Refactor the login service to use OAuth").
*   **View Board**: Click the "Kanban" icon in the panel header to see the generated work items.
*   **Monitor Agents**: Expand the "Agents" view to see running workers and their status.

## Configuration

Customize Clautana in your VS Code settings (`settings.json`):

| Setting | Default | Description |
| :--- | :--- | :--- |
| `clautana.coordinatorModel` | `claude-sonnet-4-20250514` | Model for the Orchestrator agent. |
| `clautana.workerModel` | `claude-sonnet-4-20250514` | Model for Worker agents. |
| `clautana.maxConcurrentAgents` | `5` | Limit on simultaneous worker agents. |
| `clautana.autoSpawnAgents` | `true` | Allow Orchestrator to spawn agents automatically. |
| `clautana.memory.enabled` | `true` | Enable persistent memory for agents. |

## Development

The project is structured as a VS Code extension with a React-based webview.

*   `src/coordinator/`: Orchestrator and Agent Pool logic.
*   `src/mcp/`: MCP Server implementations (Mail, Memory, etc.).
*   `src/kanban/`: Kanban board and Work Item management.
*   `webview-ui/`: React frontend for the panel.

Run `npm run watch` to recompile changes on the fly.

## References

Built on the **Claude Agent SDK** and inspired by the [Agent Flywheel](https://agent-flywheel.com/flywheel) pattern.

## License

[MIT](LICENSE)
