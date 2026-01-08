# MCP Services

This directory contains MCP (Model Context Protocol) related services for the multi-agent harness.

## Components

### AgentMailClient

Client for connecting to the Agent Mail MCP server for cross-agent messaging.

**Features:**
- Health check to verify server is running
- Auto-start server if configured with stdio transport
- Send messages between agents
- Retrieve agent inboxes
- Mark messages as read/unread
- Delete messages and clear inboxes

**Usage:**

```typescript
import { AgentMailClient } from "./mcp/AgentMailClient";

const client = new AgentMailClient();

// Check if server is running
const isRunning = await client.healthCheck();

// Start server if not running
if (!isRunning) {
  await client.start();
}

// Send a message
await client.sendMessage(
  "BlueLake",     // from
  "RedPine",      // to
  "Task complete", // subject
  "The parser changes are ready for review" // body
);

// Get inbox
const messages = await client.getInbox("RedPine");

// Mark message as read
await client.markRead(messages[0].id);

// Clean up
client.dispose();
```

**Configuration:**

In VS Code settings (`settings.json`):

```json
{
  "multiAgent.mcpServers": {
    "agent-mail": {
      "transport": "http",
      "url": "http://localhost:8765"
    }
  },
  "multiAgent.autoStartAgentMail": true
}
```

For stdio transport (client can start the server):

```json
{
  "multiAgent.mcpServers": {
    "agent-mail": {
      "transport": "stdio",
      "command": "node",
      "args": ["path/to/agent-mail-server.js"],
      "env": {
        "PORT": "8765"
      }
    }
  }
}
```

### McpManager

Manages MCP server lifecycle including starting, stopping, health monitoring, and auto-restart.

**Features:**
- Start/stop MCP servers (stdio and HTTP)
- Health monitoring with auto-restart
- Status tracking
- Graceful shutdown
- Exponential backoff for restarts

**Usage:**

```typescript
import { McpManager } from "./mcp/McpManager";

const manager = new McpManager();

// Start a server
await manager.startServer("agent-mail", {
  transport: "stdio",
  command: "npx",
  args: ["agent-mail-server"],
}, {
  autoRestart: true,
  maxRestartAttempts: 3,
  healthCheckInterval: 30000, // 30 seconds
});

// Check status
const status = manager.getServerStatus("agent-mail");
console.log(`Server status: ${status}`); // "running" | "stopped" | "error" | "starting"

// Get server info
const info = manager.getServerInfo("agent-mail");
console.log(`Started at: ${info?.startedAt}`);

// Restart server
await manager.restartServer("agent-mail");

// Stop server
await manager.stopServer("agent-mail");

// Clean up all servers
await manager.dispose();
```

**Server Status:**
- `starting`: Server is being initialized
- `running`: Server is operational
- `stopped`: Server is not running
- `error`: Server encountered an error

### ClaimsTracker

Tracks file reservations/claims across agents to prevent conflicts.

See `ClaimsTracker.ts` for implementation details.

## Integration with AgentPool

The AgentPool can be extended to use the AgentMailClient:

```typescript
import { AgentMailClient } from "../mcp/AgentMailClient";
import { McpManager } from "../mcp/McpManager";

export class AgentPool extends EventEmitter {
  private agentMailClient: AgentMailClient;
  private mcpManager: McpManager;

  constructor(private readonly context: vscode.ExtensionContext) {
    super();
    this.agentMailClient = new AgentMailClient();
    this.mcpManager = new McpManager();
  }

  async ensureAgentMailRunning(): Promise<void> {
    const isRunning = await this.agentMailClient.healthCheck();
    if (!isRunning) {
      const config = this.getAgentMailConfig();
      await this.mcpManager.startServer("agent-mail", config);
    }
  }

  private getAgentMailConfig(): McpServerConfig {
    const config = vscode.workspace.getConfiguration("multiAgent");
    const mcpServers = config.get<Record<string, McpServerConfig>>("mcpServers");
    return mcpServers?.["agent-mail"] || {
      transport: "http",
      url: "http://localhost:8765",
    };
  }

  dispose(): void {
    this.agentMailClient.dispose();
    this.mcpManager.dispose();
  }
}
```

## Error Handling

All methods throw errors if operations fail. Wrap calls in try-catch:

```typescript
try {
  await client.sendMessage("Agent1", "Agent2", "Hello");
} catch (error) {
  console.error("Failed to send message:", error);
  vscode.window.showErrorMessage("Agent Mail error: " + error.message);
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     VS Code Extension                    │
│                                                          │
│  ┌──────────────┐         ┌──────────────┐             │
│  │  AgentPool   │────────▶│ McpManager   │             │
│  │              │         │              │             │
│  │ Manages      │         │ Lifecycle    │             │
│  │ agents       │         │ management   │             │
│  └──────┬───────┘         └──────┬───────┘             │
│         │                        │                      │
│         │ Uses                   │ Manages              │
│         ▼                        ▼                      │
│  ┌──────────────┐         ┌──────────────┐             │
│  │AgentMailClient│────────▶│ Child Process│             │
│  │              │         │ (stdio)      │             │
│  │ HTTP/stdio   │         └──────────────┘             │
│  │ client       │                                       │
│  └──────┬───────┘                                       │
│         │                                               │
│         │ HTTP                                          │
│         ▼                                               │
└─────────┼───────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│            Agent Mail MCP Server                         │
│            (External process or HTTP service)            │
│                                                          │
│  Endpoints:                                              │
│  - GET  /health                                          │
│  - POST /messages                                        │
│  - GET  /inbox/:agentName                                │
│  - PATCH /messages/:id/read                              │
│  - DELETE /messages/:id                                  │
│  - DELETE /inbox/:agentName                              │
└─────────────────────────────────────────────────────────┘
```

## Testing

To test the Agent Mail integration:

1. Start Agent Mail server manually:
   ```bash
   npx agent-mail-server --port 8765
   ```

2. In VS Code, open the Multi-Agent panel

3. Configure settings:
   ```json
   {
     "multiAgent.mcpServers": {
       "agent-mail": {
         "transport": "http",
         "url": "http://localhost:8765"
       }
     }
   }
   ```

4. Spawn two agents and have them send messages to each other

5. Check the Agent Mail output channel for logs

## Troubleshooting

### Server won't start
- Check if port is already in use
- Verify command path is correct (for stdio)
- Check Output panel → "MCP Manager" for logs

### Health check fails
- Verify server URL is correct
- Check firewall/network settings
- Ensure server is running and accessible

### Messages not being delivered
- Check Output panel → "Agent Mail Client" for errors
- Verify agent names are correct
- Check server logs for issues

## References

- [MCP Agent Mail GitHub](https://github.com/Dicklesworthstone/mcp_agent_mail)
- [Multi-Agent Spec](../../docs/proposals/multi-agent-vscode-extension-spec.md)
- [MCP Protocol Spec](https://modelcontextprotocol.io/introduction)
