import * as vscode from "vscode";
import { OrchestratorAgent } from "../coordinator/OrchestratorAgent";
import { AgentPool } from "../coordinator/AgentPool";
import { getConfigManager } from "../clautana/ConfigManager";
import { getMemoryManager } from "../clautana/MemoryManager";
import { AgentEditorProvider } from "../providers/AgentEditorProvider";
import { getProfileManager, isVSCodeLLMAvailable, getVSCodeLLMModels } from "../clautana/AgentProfiles";
import { MemoryType } from "../clautana/types";
import { executeAdrCommand, type AdrHandlerContext } from "../workflows/AdrWorkflowHandlers";

/**
 * Represents a slash command that can be invoked from the chat panel
 */
export interface SlashCommand {
  /** Command name without the slash (e.g., "init") */
  name: string;
  /** Short description shown in autocomplete */
  description: string;
  /** Detailed help text */
  help?: string;
  /** Arguments specification */
  args?: {
    name: string;
    description: string;
    required?: boolean;
    options?: string[];
  }[];
  /** Command handler */
  execute: (context: SlashCommandContext) => Promise<SlashCommandResult>;
}

export interface SlashCommandContext {
  /** Raw arguments string after the command */
  argsRaw: string;
  /** Parsed arguments */
  args: string[];
  /** VS Code extension context */
  extensionContext: vscode.ExtensionContext;
  /** Orchestrator instance */
  orchestrator: OrchestratorAgent;
  /** Agent pool instance */
  agentPool: AgentPool;
}

export interface SlashCommandResult {
  /** Message to display to the user */
  message: string;
  /** Whether the command succeeded */
  success: boolean;
  /** Optional data to pass back */
  data?: unknown;
}

/**
 * Registry for slash commands
 */
class SlashCommandRegistry {
  private commands: Map<string, SlashCommand> = new Map();

  register(command: SlashCommand): void {
    this.commands.set(command.name.toLowerCase(), command);
  }

  get(name: string): SlashCommand | undefined {
    return this.commands.get(name.toLowerCase());
  }

  getAll(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get commands matching a prefix (for autocomplete)
   */
  getMatching(prefix: string): SlashCommand[] {
    const lowerPrefix = prefix.toLowerCase();
    return this.getAll().filter((cmd) =>
      cmd.name.toLowerCase().startsWith(lowerPrefix)
    );
  }

  /**
   * Parse and execute a slash command
   */
  async execute(
    input: string,
    extensionContext: vscode.ExtensionContext,
    orchestrator: OrchestratorAgent,
    agentPool: AgentPool
  ): Promise<SlashCommandResult | null> {
    if (!input.startsWith("/")) {
      return null;
    }

    const parts = input.slice(1).split(/\s+/);
    const commandName = parts[0];
    const argsRaw = input.slice(1 + commandName.length).trim();
    const args = parts.slice(1);

    const command = this.get(commandName);
    if (!command) {
      return {
        success: false,
        message: `Unknown command: /${commandName}. Type /help for available commands.`,
      };
    }

    try {
      return await command.execute({
        argsRaw,
        args,
        extensionContext,
        orchestrator,
        agentPool,
      });
    } catch (error) {
      return {
        success: false,
        message: `Error executing /${commandName}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

// Global registry instance
export const slashCommands = new SlashCommandRegistry();

// ============================================================================
// Built-in Commands
// ============================================================================

/**
 * /init - Initialize .clautana folder for the project
 */
slashCommands.register({
  name: "init",
  description: "Initialize Clautana for this project",
  help: "Creates the .clautana/ folder with default configuration, memory storage, and context files.",
  async execute(_ctx) {
    const configManager = getConfigManager();

    if (await configManager.exists()) {
      return {
        success: true,
        message: "Clautana is already initialized for this project. Use /config to edit settings.",
      };
    }

    await configManager.initialize();

    return {
      success: true,
      message: `Initialized Clautana in ${configManager.getClautanaPath()}\n\nCreated:\n- config.json (project settings)\n- memory/ (agent memory storage)\n- hooks/ (custom hook scripts)\n- context/ (additional context files)\n\nEdit .clautana/config.json to customize your project settings.`,
    };
  },
});

/**
 * /status - Show current agent status
 */
slashCommands.register({
  name: "status",
  description: "Show current agent status",
  help: "Displays the status of all running agents, pending agents, and total cost.",
  async execute(ctx) {
    const status = ctx.agentPool.getStatus();

    if (status.activeAgents.length === 0 && status.pendingAgents.length === 0) {
      return {
        success: true,
        message: "No agents currently running. Use /spawn to start an agent or submit a task to the orchestrator.",
      };
    }

    let msg = `**Agent Status**\n\n`;
    msg += `Active: ${status.activeAgents.length} | Pending: ${status.pendingAgents.length} | Cost: $${status.totalCost.toFixed(4)}\n\n`;

    for (const agent of status.activeAgents) {
      const statusIcon = getStatusIcon(agent.status);
      msg += `${statusIcon} **${agent.name}** (${agent.role})\n`;
      msg += `   ${agent.focus}\n\n`;
    }

    if (status.pendingAgents.length > 0) {
      msg += `**Pending:** ${status.pendingAgents.join(", ")}`;
    }

    return { success: true, message: msg };
  },
});

/**
 * /spawn - Spawn a new agent
 */
slashCommands.register({
  name: "spawn",
  description: "Spawn a new agent",
  args: [
    { name: "name", description: "Agent name", required: true },
    { name: "role", description: "Agent role", required: true },
    { name: "focus", description: "What the agent should work on", required: true },
  ],
  help: "Manually spawn a new agent. Usage: /spawn <name> <role> <focus>\nExample: /spawn Parser \"Code Parser\" \"Parse and analyze the FHIR resources\"",
  async execute(ctx) {
    if (ctx.args.length < 3) {
      // Interactive mode - prompt for details
      const name = await vscode.window.showInputBox({
        prompt: "Agent name",
        placeHolder: "e.g., Parser, Refactor, TestWriter",
      });
      if (!name) return { success: false, message: "Spawn cancelled." };

      const role = await vscode.window.showInputBox({
        prompt: "Agent role",
        placeHolder: "e.g., Core Parser Engineer",
      });
      if (!role) return { success: false, message: "Spawn cancelled." };

      const focus = await vscode.window.showInputBox({
        prompt: "What should this agent work on?",
        placeHolder: "e.g., Refactor the FHIR parser to support R6",
      });
      if (!focus) return { success: false, message: "Spawn cancelled." };

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      await ctx.agentPool.spawnAgent({
        name,
        role,
        focus,
        systemPrompt: `You are a ${role}. Your focus: ${focus}`,
        waitFor: [],
        priority: 0,
        workingDirectory: workspaceFolder?.uri.fsPath || process.cwd(),
      });

      return { success: true, message: `Spawned agent: **${name}** (${role})` };
    }

    // Parse from args: /spawn Name "Role" "Focus"
    const [name, ...rest] = ctx.args;

    if (!name) {
      return { success: false, message: "Agent name is required" };
    }

    const restStr = rest.join(" ");

    // Parse quoted strings properly
    const quotedMatches = restStr.match(/"([^"]+)"/g);
    let role: string;
    let focus: string;

    if (quotedMatches && quotedMatches.length >= 2) {
      // Both role and focus are quoted
      role = quotedMatches[0].replace(/"/g, "");
      focus = quotedMatches[1].replace(/"/g, "");
    } else if (quotedMatches && quotedMatches.length === 1) {
      // Only one quoted string - assume it's the role
      role = quotedMatches[0].replace(/"/g, "");
      // Focus is everything after the quoted role
      const roleIndex = restStr.indexOf(quotedMatches[0]);
      focus = restStr.slice(roleIndex + quotedMatches[0].length).trim();
    } else {
      // No quotes - split on first space
      role = rest[0] || "";
      focus = rest.slice(1).join(" ");
    }

    if (!role) {
      return { success: false, message: "Agent role is required" };
    }

    if (!focus) {
      return { success: false, message: "Agent focus is required" };
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    await ctx.agentPool.spawnAgent({
      name,
      role,
      focus,
      systemPrompt: `You are a ${role}. Your focus: ${focus}`,
      waitFor: [],
      priority: 0,
      workingDirectory: workspaceFolder?.uri.fsPath || process.cwd(),
    });

    return { success: true, message: `Spawned agent: **${name}** (${role})` };
  },
});

/**
 * /stop - Stop agents
 */
slashCommands.register({
  name: "stop",
  description: "Stop agents",
  args: [
    { name: "agent", description: "Agent name or 'all'", required: false },
  ],
  help: "Stop one or all agents. Usage: /stop [agent-name|all]\nExamples:\n  /stop all - Stop all agents\n  /stop Parser - Stop the Parser agent",
  async execute(ctx) {
    const target = ctx.args[0]?.toLowerCase();

    if (!target || target === "all") {
      const agents = ctx.agentPool.getAllAgents();
      if (agents.length === 0) {
        return { success: true, message: "No agents running." };
      }

      ctx.orchestrator.stop();
      for (const agent of agents) {
        await ctx.agentPool.destroyAgent(agent.name);
      }
      return { success: true, message: `Stopped ${agents.length} agent(s).` };
    }

    const agent = ctx.agentPool.getAgent(target);
    if (!agent) {
      return { success: false, message: `Agent "${target}" not found.` };
    }

    await ctx.agentPool.destroyAgent(target);
    return { success: true, message: `Stopped agent: ${target}` };
  },
});

/**
 * /pause - Pause an agent
 */
slashCommands.register({
  name: "pause",
  description: "Pause an agent",
  args: [{ name: "agent", description: "Agent name", required: true }],
  async execute(ctx) {
    const agentName = ctx.args[0];
    if (!agentName) {
      const agents = ctx.agentPool.getAllAgents();
      if (agents.length === 0) {
        return { success: false, message: "No agents running." };
      }
      const selected = await vscode.window.showQuickPick(
        agents.map((a) => ({ label: a.name, description: a.role })),
        { placeHolder: "Select agent to pause" }
      );
      if (!selected) return { success: false, message: "Pause cancelled." };

      const agent = ctx.agentPool.getAgent(selected.label);
      if (!agent) {
        return { success: false, message: `Agent "${selected.label}" not found.` };
      }

      agent.pause();
      return { success: true, message: `Paused agent: ${selected.label}` };
    }

    const agent = ctx.agentPool.getAgent(agentName);
    if (!agent) {
      return { success: false, message: `Agent "${agentName}" not found.` };
    }

    agent.pause();
    return { success: true, message: `Paused agent: ${agentName}` };
  },
});

/**
 * /resume - Resume a paused agent
 */
slashCommands.register({
  name: "resume",
  description: "Resume a paused agent",
  args: [{ name: "agent", description: "Agent name", required: true }],
  async execute(ctx) {
    const agentName = ctx.args[0];
    if (!agentName) {
      const agents = ctx.agentPool.getAllAgents().filter((a) => a.status === "paused");
      if (agents.length === 0) {
        return { success: false, message: "No paused agents." };
      }
      const selected = await vscode.window.showQuickPick(
        agents.map((a) => ({ label: a.name, description: a.role })),
        { placeHolder: "Select agent to resume" }
      );
      if (!selected) return { success: false, message: "Resume cancelled." };

      const agent = ctx.agentPool.getAgent(selected.label);
      if (!agent) {
        return { success: false, message: `Agent "${selected.label}" not found.` };
      }

      await agent.resume();
      return { success: true, message: `Resumed agent: ${selected.label}` };
    }

    const agent = ctx.agentPool.getAgent(agentName);
    if (!agent) {
      return { success: false, message: `Agent "${agentName}" not found.` };
    }

    await agent.resume();
    return { success: true, message: `Resumed agent: ${agentName}` };
  },
});

/**
 * /config - Open configuration
 */
slashCommands.register({
  name: "config",
  description: "Open Clautana configuration",
  async execute(_ctx) {
    const configManager = getConfigManager();
    const configPath = configManager.getClautanaPath() + "/config.json";

    try {
      const doc = await vscode.workspace.openTextDocument(configPath);
      await vscode.window.showTextDocument(doc);
      return { success: true, message: "Opened config.json" };
    } catch {
      return {
        success: false,
        message: "Config file not found. Run /init first to initialize Clautana.",
      };
    }
  },
});

/**
 * /memory - Manage agent memory (YML-based storage)
 */
slashCommands.register({
  name: "memory",
  description: "Manage agent memory",
  args: [
    { name: "action", description: "Action", options: ["list", "search", "add", "stats", "decay", "open"] },
    { name: "type", description: "Memory type", options: ["playbooks", "facts", "sessions"] },
    { name: "query", description: "Search query or content" },
  ],
  help: `Manage agent memory stored in YML format.

Usage:
  /memory                     - Show memory statistics
  /memory list [type]         - List memories (optionally by type)
  /memory search <type> <query> - Search memories by content/tags
  /memory add <type> <content>  - Add a new memory entry
  /memory stats               - Show detailed memory statistics
  /memory decay               - Remove old, unused entries
  /memory open [type]         - Open memory file in editor

Examples:
  /memory list playbooks
  /memory search facts typescript
  /memory add playbooks "When fixing TypeScript errors, check tsconfig first" --tags typescript,debugging
  /memory stats
  /memory open facts`,
  async execute(ctx) {
    const [action, ...restArgs] = ctx.args;
    const memoryManager = getMemoryManager();

    // Default action: show stats
    if (!action || action === "stats") {
      try {
        await memoryManager.initialize();
        const stats = await memoryManager.getStats();

        let msg = "**Memory Statistics**\n\n";
        msg += `| Type | Count | Total Uses | Avg Confidence |\n`;
        msg += `|------|-------|------------|----------------|\n`;
        msg += `| Playbooks | ${stats.playbooks.count} | ${stats.playbooks.totalUseCount} | ${(stats.playbooks.averageConfidence * 100).toFixed(1)}% |\n`;
        msg += `| Facts | ${stats.facts.count} | ${stats.facts.totalUseCount} | ${(stats.facts.averageConfidence * 100).toFixed(1)}% |\n`;
        msg += `| Sessions | ${stats.sessions.count} | ${stats.sessions.totalUseCount} | ${(stats.sessions.averageConfidence * 100).toFixed(1)}% |\n`;
        msg += `\nLast updated: ${new Date(stats.lastUpdated).toLocaleString()}`;
        msg += `\n\nUse \`/memory list <type>\` to view entries or \`/memory add <type> <content>\` to add new ones.`;

        return { success: true, message: msg };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          message: `Failed to get memory stats. Run /init first. Error: ${message}`,
        };
      }
    }

    // List memories
    if (action === "list") {
      const type = restArgs[0]?.toLowerCase() as MemoryType | undefined;
      const validTypes: MemoryType[] = ["playbooks", "facts", "sessions"];

      try {
        await memoryManager.initialize();

        if (type && !validTypes.includes(type)) {
          return {
            success: false,
            message: `Invalid memory type. Use: ${validTypes.join(", ")}`,
          };
        }

        const typesToList = type ? [type] : validTypes;
        let msg = "**Memory Entries**\n\n";

        for (const t of typesToList) {
          const result = await memoryManager.search(t, { limit: 10, sortBy: "lastUsed" });

          msg += `### ${t.charAt(0).toUpperCase() + t.slice(1)} (${result.total} total)\n\n`;

          if (result.entries.length === 0) {
            msg += "_No entries yet._\n\n";
          } else {
            for (const entry of result.entries) {
              const tags = entry.tags.length > 0 ? ` [${entry.tags.join(", ")}]` : "";
              const confidence = entry.confidence !== undefined ? ` (${(entry.confidence * 100).toFixed(0)}%)` : "";
              const preview = entry.content.length > 100 ? entry.content.substring(0, 100) + "..." : entry.content;
              msg += `- **${entry.id}**${confidence}${tags}\n  ${preview}\n`;
            }
            if (result.hasMore) {
              msg += `  _...and ${result.total - result.entries.length} more_\n`;
            }
            msg += "\n";
          }
        }

        return { success: true, message: msg };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          message: `Failed to list memories. Error: ${message}`,
        };
      }
    }

    // Search memories
    if (action === "search") {
      const type = restArgs[0]?.toLowerCase() as MemoryType | undefined;
      const query = restArgs.slice(1).join(" ");

      if (!type) {
        return {
          success: false,
          message: "Please specify a memory type: /memory search <playbooks|facts|sessions> <query>",
        };
      }

      const validTypes: MemoryType[] = ["playbooks", "facts", "sessions"];
      if (!validTypes.includes(type)) {
        return {
          success: false,
          message: `Invalid memory type. Use: ${validTypes.join(", ")}`,
        };
      }

      if (!query) {
        return {
          success: false,
          message: "Please provide a search query: /memory search <type> <query>",
        };
      }

      try {
        await memoryManager.initialize();
        const result = await memoryManager.search(type, { query, limit: 20 });

        if (result.entries.length === 0) {
          return {
            success: true,
            message: `No ${type} found matching "${query}".`,
          };
        }

        let msg = `**Search Results for "${query}" in ${type}**\n\n`;
        msg += `Found ${result.total} match(es):\n\n`;

        for (const entry of result.entries) {
          const tags = entry.tags.length > 0 ? ` [${entry.tags.join(", ")}]` : "";
          const confidence = entry.confidence !== undefined ? ` (${(entry.confidence * 100).toFixed(0)}% confidence)` : "";
          const usedDate = new Date(entry.lastUsed).toLocaleDateString();

          msg += `**${entry.id}**${confidence}${tags}\n`;
          msg += `> ${entry.content}\n`;
          msg += `_Used ${entry.useCount} times, last: ${usedDate}_\n\n`;
        }

        if (result.hasMore) {
          msg += `_...and ${result.total - result.entries.length} more results_`;
        }

        return { success: true, message: msg };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          message: `Search failed. Error: ${message}`,
        };
      }
    }

    // Add a new memory entry
    if (action === "add") {
      const type = restArgs[0]?.toLowerCase() as MemoryType | undefined;
      const validTypes: MemoryType[] = ["playbooks", "facts", "sessions"];

      if (!type || !validTypes.includes(type)) {
        return {
          success: false,
          message: `Please specify a valid memory type: /memory add <playbooks|facts|sessions> <content>`,
        };
      }

      // Parse content and optional tags from the rest of the arguments
      let contentPart = restArgs.slice(1).join(" ");

      if (!contentPart) {
        // Interactive mode - prompt for content
        const content = await vscode.window.showInputBox({
          prompt: `Enter the ${type.slice(0, -1)} content`,
          placeHolder: type === "playbooks"
            ? "e.g., When fixing TypeScript errors, always check tsconfig paths first"
            : type === "facts"
            ? "e.g., This project uses React with TypeScript and Tailwind CSS"
            : "e.g., Implemented user authentication feature",
        });

        if (!content) {
          return { success: false, message: "Add cancelled." };
        }

        const tagsInput = await vscode.window.showInputBox({
          prompt: "Enter tags (comma-separated, optional)",
          placeHolder: "e.g., typescript, debugging, patterns",
        });

        const confidenceInput = await vscode.window.showInputBox({
          prompt: "Enter confidence score 0-100 (optional, default: 80)",
          placeHolder: "80",
          validateInput: (value) => {
            if (!value) return null;
            const num = parseInt(value, 10);
            if (isNaN(num) || num < 0 || num > 100) {
              return "Please enter a number between 0 and 100";
            }
            return null;
          },
        });

        const tags = tagsInput ? tagsInput.split(",").map((t) => t.trim()).filter((t) => t) : [];
        const confidence = confidenceInput ? parseInt(confidenceInput, 10) / 100 : 0.8;

        try {
          await memoryManager.initialize();
          const entry = await memoryManager.add(type, {
            content,
            tags,
            confidence,
          });

          return {
            success: true,
            message: `Added new ${type.slice(0, -1)} with ID: **${entry.id}**\n\nContent: ${content}\nTags: ${tags.join(", ") || "none"}\nConfidence: ${(confidence * 100).toFixed(0)}%`,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            success: false,
            message: `Failed to add memory. Error: ${message}`,
          };
        }
      }

      // Parse --tags from content
      let tags: string[] = [];
      let confidence = 0.8;
      const tagsMatch = contentPart.match(/--tags?\s+([^\-]+)/i);
      if (tagsMatch) {
        tags = tagsMatch[1].split(",").map((t) => t.trim()).filter((t) => t);
        contentPart = contentPart.replace(/--tags?\s+[^\-]+/i, "").trim();
      }

      // Parse --confidence from content
      const confMatch = contentPart.match(/--confidence\s+(\d+)/i);
      if (confMatch) {
        confidence = Math.min(100, Math.max(0, parseInt(confMatch[1], 10))) / 100;
        contentPart = contentPart.replace(/--confidence\s+\d+/i, "").trim();
      }

      // Remove quotes if present
      if ((contentPart.startsWith('"') && contentPart.endsWith('"')) ||
          (contentPart.startsWith("'") && contentPart.endsWith("'"))) {
        contentPart = contentPart.slice(1, -1);
      }

      if (!contentPart) {
        return {
          success: false,
          message: "Please provide content for the memory entry.",
        };
      }

      try {
        await memoryManager.initialize();
        const entry = await memoryManager.add(type, {
          content: contentPart,
          tags,
          confidence,
        });

        return {
          success: true,
          message: `Added new ${type.slice(0, -1)} with ID: **${entry.id}**`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          message: `Failed to add memory. Error: ${message}`,
        };
      }
    }

    // Decay old entries
    if (action === "decay") {
      try {
        await memoryManager.initialize();
        const result = await memoryManager.decay();

        const total = result.playbooks + result.facts + result.sessions;

        if (total === 0) {
          return {
            success: true,
            message: "No entries needed to be removed. All memories are within retention policy.",
          };
        }

        let msg = `**Memory Decay Complete**\n\n`;
        msg += `Removed ${total} old/unused entries:\n`;
        msg += `- Playbooks: ${result.playbooks}\n`;
        msg += `- Facts: ${result.facts}\n`;
        msg += `- Sessions: ${result.sessions}\n`;

        return { success: true, message: msg };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          message: `Decay failed. Error: ${message}`,
        };
      }
    }

    // Open memory file
    if (action === "open") {
      const type = restArgs[0]?.toLowerCase() as MemoryType | undefined;
      const validTypes: MemoryType[] = ["playbooks", "facts", "sessions"];

      if (type && !validTypes.includes(type)) {
        return {
          success: false,
          message: `Invalid memory type. Use: ${validTypes.join(", ")}`,
        };
      }

      const configManager = getConfigManager();

      if (!type) {
        // Open memory folder
        const memoryPath = configManager.getMemoryPath();
        const uri = vscode.Uri.file(memoryPath);
        await vscode.commands.executeCommand("revealInExplorer", uri);
        return { success: true, message: "Opened memory folder in explorer." };
      }

      // Open specific file
      const filePath = `${configManager.getMemoryPath()}/${type}.yml`;
      try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc);
        return { success: true, message: `Opened ${type}.yml` };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          message: `Memory file not found. Run /init first. Error: ${message}`,
        };
      }
    }

    // Unknown action
    return {
      success: false,
      message: `Unknown action: ${action}. Use: list, search, add, stats, decay, or open.`,
    };
  },
});

/**
 * /view - Open full-tab view
 */
slashCommands.register({
  name: "view",
  description: "Open full-tab agent view",
  args: [{ name: "agent", description: "Agent name or 'dashboard'" }],
  help: "Open full-tab view. Usage: /view [agent-name|dashboard]\nExamples:\n  /view dashboard - Open orchestrator dashboard\n  /view Parser - Open Parser agent view",
  async execute(ctx) {
    const target = ctx.args[0]?.toLowerCase();

    if (!target || target === "dashboard" || target === "orchestrator") {
      await AgentEditorProvider.openAgentView();
      return { success: true, message: "Opened orchestrator dashboard." };
    }

    const agent = ctx.agentPool.getAgent(target);
    if (!agent) {
      return { success: false, message: `Agent "${target}" not found.` };
    }

    await AgentEditorProvider.openAgentView(target);
    return { success: true, message: `Opened view for agent: ${target}` };
  },
});

/**
 * /clear - Clear chat history
 */
slashCommands.register({
  name: "clear",
  description: "Clear chat history",
  async execute(_ctx) {
    // This will be handled by the webview
    return {
      success: true,
      message: "",
      data: { action: "clearChat" },
    };
  },
});

/**
 * /export - Export agent session
 */
slashCommands.register({
  name: "export",
  description: "Export agent session or conversation",
  args: [
    { name: "target", description: "Agent name or 'all'", required: false },
    { name: "format", description: "Export format", options: ["json", "md", "html"] },
  ],
  help: "Export agent sessions to a file. Usage: /export [agent|all] [json|md|html]\nExamples:\n  /export all json - Export all agents to JSON\n  /export Parser md - Export Parser agent to Markdown",
  async execute(ctx) {
    const [target = "all", format = "json"] = ctx.args;
    const validFormats = ["json", "md", "markdown", "html"];

    if (!validFormats.includes(format.toLowerCase())) {
      return {
        success: false,
        message: `Invalid format. Use: json, md, or html`,
      };
    }

    const agents = target.toLowerCase() === "all"
      ? ctx.agentPool.getAllAgents()
      : [ctx.agentPool.getAgent(target)].filter(Boolean);

    if (agents.length === 0) {
      return {
        success: false,
        message: target.toLowerCase() === "all"
          ? "No agents to export."
          : `Agent "${target}" not found.`,
      };
    }

    // Build export data
    const exportData = {
      exportedAt: new Date().toISOString(),
      agents: agents.map((agent) => ({
        name: agent!.name,
        role: agent!.role,
        focus: agent!.focus,
        status: agent!.status,
        color: agent!.color,
        messages: agent!.messages,
        fileClaims: ctx.agentPool.getAllClaims().filter((c) => c.agentName === agent!.name),
      })),
    };

    // Generate content based on format
    let content: string;
    let fileExt: string;

    switch (format.toLowerCase()) {
      case "md":
      case "markdown":
        content = generateMarkdownExport(exportData);
        fileExt = "md";
        break;
      case "html":
        content = generateHtmlExport(exportData);
        fileExt = "html";
        break;
      default:
        content = JSON.stringify(exportData, null, 2);
        fileExt = "json";
    }

    // Save to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const fileName = `clautana-export-${timestamp}.${fileExt}`;

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(fileName),
      filters: {
        [fileExt.toUpperCase()]: [fileExt],
        "All Files": ["*"],
      },
    });

    if (!saveUri) {
      return { success: false, message: "Export cancelled." };
    }

    await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, "utf8"));

    return {
      success: true,
      message: `Exported ${agents.length} agent(s) to ${saveUri.fsPath}`,
    };
  },
});

/**
 * /search - Search agent conversations
 */
slashCommands.register({
  name: "search",
  description: "Search agent conversations",
  args: [
    { name: "query", description: "Search query", required: true },
  ],
  help: "Search across all agent conversations. Usage: /search <query>\nExample: /search FHIR parser error",
  async execute(ctx) {
    const query = ctx.argsRaw.toLowerCase();

    if (!query) {
      return { success: false, message: "Please provide a search query." };
    }

    const agents = ctx.agentPool.getAllAgents();
    const results: Array<{
      agentName: string;
      messageId: string;
      content: string;
      timestamp: Date;
      matchContext: string;
    }> = [];

    for (const agent of agents) {
      for (const message of agent.messages) {
        const content = message.content.toLowerCase();
        if (content.includes(query)) {
          // Extract context around the match
          const index = content.indexOf(query);
          const start = Math.max(0, index - 50);
          const end = Math.min(content.length, index + query.length + 50);
          const matchContext = (start > 0 ? "..." : "") +
            message.content.slice(start, end) +
            (end < content.length ? "..." : "");

          results.push({
            agentName: agent.name,
            messageId: message.id,
            content: message.content,
            timestamp: message.timestamp,
            matchContext,
          });
        }
      }
    }

    if (results.length === 0) {
      return {
        success: true,
        message: `No results found for "${ctx.argsRaw}".`,
      };
    }

    // Format results
    let msg = `**Search Results for "${ctx.argsRaw}"**\n\n`;
    msg += `Found ${results.length} match(es) across ${new Set(results.map((r) => r.agentName)).size} agent(s):\n\n`;

    const groupedResults = new Map<string, typeof results>();
    for (const result of results.slice(0, 20)) {
      const existing = groupedResults.get(result.agentName) || [];
      existing.push(result);
      groupedResults.set(result.agentName, existing);
    }

    for (const [agentName, agentResults] of groupedResults) {
      msg += `**${agentName}** (${agentResults.length} match${agentResults.length > 1 ? "es" : ""}):\n`;
      for (const result of agentResults.slice(0, 5)) {
        msg += `- ${result.matchContext}\n`;
      }
      msg += "\n";
    }

    if (results.length > 20) {
      msg += `_...and ${results.length - 20} more results_`;
    }

    return {
      success: true,
      message: msg,
      data: { results },
    };
  },
});

/**
 * /history - View session history
 */
slashCommands.register({
  name: "history",
  description: "View past session history",
  args: [
    { name: "count", description: "Number of sessions to show" },
  ],
  help: "View past session history from memory. Usage: /history [count]",
  async execute(ctx) {
    const count = parseInt(ctx.args[0], 10) || 10;
    const memoryManager = getMemoryManager();

    try {
      await memoryManager.initialize();
      const result = await memoryManager.search("sessions", {
        limit: count,
        sortBy: "createdAt",
        sortOrder: "desc",
      });

      if (result.entries.length === 0) {
        return { success: true, message: "No session history found. Sessions are recorded when agents complete tasks." };
      }

      let msg = `**Recent Sessions** (${result.entries.length} of ${result.total})\n\n`;

      for (const session of result.entries) {
        const date = new Date(session.createdAt).toLocaleDateString();
        const time = new Date(session.createdAt).toLocaleTimeString();
        const confidence = session.confidence !== undefined ? ` (${(session.confidence * 100).toFixed(0)}%)` : "";
        const tags = session.tags.length > 0 ? ` [${session.tags.join(", ")}]` : "";

        msg += `**${date} ${time}**${confidence}${tags}\n`;
        msg += `> ${session.content}\n`;
        msg += `_Used ${session.useCount} time(s)_\n\n`;
      }

      if (result.hasMore) {
        msg += `_...and ${result.total - result.entries.length} more sessions. Use \`/history ${count + 10}\` to see more._`;
      }

      return { success: true, message: msg };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Could not load session history. Run /init first. Error: ${message}`,
      };
    }
  },
});

/**
 * /profile - Manage agent profiles
 */
slashCommands.register({
  name: "profile",
  description: "Manage agent profiles",
  args: [
    { name: "action", description: "Action", options: ["list", "show", "create", "use"] },
    { name: "name", description: "Profile name" },
  ],
  help: "Manage agent profiles. Usage: /profile [list|show|create|use] [name]\nExamples:\n  /profile list - List all profiles\n  /profile show developer - Show developer profile\n  /profile use claude-opus - Spawn agent with Opus profile",
  async execute(ctx) {
    const [action = "list", profileId] = ctx.args;
    const profileManager = getProfileManager();

    switch (action.toLowerCase()) {
      case "list": {
        const profiles = await profileManager.getAllProfiles();
        let msg = "**Available Agent Profiles**\n\n";

        // Group by tags
        const defaultProfiles = profiles.filter((p) => p.tags?.includes("default"));
        const roleProfiles = profiles.filter((p) => !p.tags?.includes("default"));

        if (defaultProfiles.length > 0) {
          msg += "**Default Model Profiles:**\n";
          for (const p of defaultProfiles) {
            const icon = p.icon ? `$(${p.icon})` : "";
            msg += `- ${icon} **${p.name}** (\`${p.id}\`) - ${p.description || p.role}\n`;
          }
          msg += "\n";
        }

        if (roleProfiles.length > 0) {
          msg += "**Role-Based Profiles:**\n";
          for (const p of roleProfiles) {
            const icon = p.icon ? `$(${p.icon})` : "";
            msg += `- ${icon} **${p.name}** (\`${p.id}\`) - ${p.description || p.role}\n`;
          }
        }

        msg += "\nUse `/profile show <id>` for details or `/profile use <id>` to spawn.";
        return { success: true, message: msg };
      }

      case "show": {
        if (!profileId) {
          return { success: false, message: "Please specify a profile ID." };
        }

        const profile = await profileManager.getProfile(profileId);
        if (!profile) {
          return { success: false, message: `Profile "${profileId}" not found.` };
        }

        let msg = `**${profile.name}** (\`${profile.id}\`)\n\n`;
        msg += `**Role:** ${profile.role}\n`;
        if (profile.description) msg += `**Description:** ${profile.description}\n`;
        msg += `**Model:** ${profile.model.provider === "claude" ? profile.model.modelId : "VS Code Copilot"}\n`;

        if (profile.tools) {
          const perms = [];
          if (profile.tools.allowEdit) perms.push("Edit");
          if (profile.tools.allowShell) perms.push("Shell");
          if (profile.tools.allowWeb) perms.push("Web");
          msg += `**Permissions:** ${perms.join(", ") || "Read-only"}\n`;
        }

        if (profile.tags && profile.tags.length > 0) {
          msg += `**Tags:** ${profile.tags.join(", ")}\n`;
        }

        msg += `\n**System Prompt:**\n\`\`\`\n${profile.systemPrompt.slice(0, 300)}${profile.systemPrompt.length > 300 ? "..." : ""}\n\`\`\``;

        return { success: true, message: msg };
      }

      case "use": {
        if (!profileId) {
          // Show quick pick
          const profiles = await profileManager.getAllProfiles();
          const selected = await vscode.window.showQuickPick(
            profiles.map((p) => ({
              label: p.name,
              description: p.role,
              detail: p.description,
              id: p.id,
            })),
            { placeHolder: "Select a profile to use" }
          );

          if (!selected) {
            return { success: false, message: "Cancelled." };
          }

          return spawnWithProfile(ctx, selected.id);
        }

        return spawnWithProfile(ctx, profileId);
      }

      case "create": {
        // Open the agents folder and create a template
        const configManager = getConfigManager();
        const agentsDir = `${configManager.getClautanaPath()}/agents`;

        const templateProfile = {
          id: "my-custom-agent",
          name: "My Custom Agent",
          role: "Custom Role",
          description: "Description of what this agent does",
          icon: "code",
          color: "#3B82F6",
          model: {
            provider: "claude",
            modelId: "claude-sonnet-4-20250514",
          },
          systemPrompt: "You are a helpful assistant.\n\nYour current task: {{focus}}",
          tools: {
            allowEdit: true,
            allowShell: true,
            allowWeb: false,
          },
          behavior: {
            maxTurns: 50,
            autoClaimFiles: true,
          },
          tags: ["custom"],
        };

        const fileName = "custom-agent.json";
        const filePath = `${agentsDir}/${fileName}`;

        try {
          await vscode.workspace.fs.createDirectory(vscode.Uri.file(agentsDir));
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(filePath),
            Buffer.from(JSON.stringify(templateProfile, null, 2), "utf8")
          );

          const doc = await vscode.workspace.openTextDocument(filePath);
          await vscode.window.showTextDocument(doc);

          return {
            success: true,
            message: `Created template profile at ${filePath}. Edit and save to create your custom profile.`,
          };
        } catch (err) {
          return {
            success: false,
            message: `Failed to create profile: ${err}`,
          };
        }
      }

      default:
        return { success: false, message: `Unknown action: ${action}. Use: list, show, create, or use.` };
    }
  },
});

async function spawnWithProfile(
  ctx: SlashCommandContext,
  profileId: string
): Promise<SlashCommandResult> {
  const profileManager = getProfileManager();
  const profile = await profileManager.getProfile(profileId);

  if (!profile) {
    return { success: false, message: `Profile "${profileId}" not found.` };
  }

  // Get the focus/task from user
  const focus = await vscode.window.showInputBox({
    prompt: `What should the ${profile.name} agent work on?`,
    placeHolder: "e.g., Implement user authentication",
  });

  if (!focus) {
    return { success: false, message: "Cancelled." };
  }

  const configManager = getConfigManager();
  const config = await configManager.loadConfig();

  // Build system prompt with variables
  const systemPrompt = profileManager.buildSystemPrompt(profile, {
    projectName: config.name || "Project",
    focus,
  });

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  await ctx.agentPool.spawnAgent({
    name: profile.name.replace(/\s+/g, ""),
    role: profile.role,
    focus,
    systemPrompt,
    waitFor: [],
    priority: 0,
    workingDirectory: workspaceFolder?.uri.fsPath || process.cwd(),
  });

  return {
    success: true,
    message: `Spawned **${profile.name}** agent with focus: ${focus}`,
  };
}

/**
 * /models - Show available models
 */
slashCommands.register({
  name: "models",
  description: "Show available AI models",
  async execute(_ctx) {
    let msg = "**Available AI Models**\n\n";

    // Claude models
    msg += "**Claude (via Agent SDK):**\n";
    msg += "- `claude-opus-4-20250514` - Most capable, best for complex tasks\n";
    msg += "- `claude-sonnet-4-20250514` - Balanced performance and speed\n";
    msg += "- `claude-haiku-3-5-20241022` - Fastest, good for simple tasks\n\n";

    // VS Code LLM
    const vscodeLLMAvailable = await isVSCodeLLMAvailable();
    if (vscodeLLMAvailable) {
      msg += "**VS Code Language Models:**\n";
      const models = await getVSCodeLLMModels();
      if (models.length > 0) {
        for (const model of models) {
          msg += `- \`${model.id}\` (${model.family})\n`;
        }
      } else {
        msg += "- No models currently available\n";
      }
    } else {
      msg += "**VS Code Language Models:**\n";
      msg += "- Not available (Copilot not installed or not signed in)\n";
    }

    msg += "\nUse `/profile list` to see agent profiles using these models.";
    return { success: true, message: msg };
  },
});

/**
 * /help - Show available commands
 */
slashCommands.register({
  name: "help",
  description: "Show available commands",
  args: [{ name: "command", description: "Command name for detailed help" }],
  async execute(ctx) {
    const commandName = ctx.args[0];

    if (commandName) {
      const command = slashCommands.get(commandName);
      if (!command) {
        return { success: false, message: `Unknown command: /${commandName}` };
      }

      let msg = `**/${command.name}** - ${command.description}\n\n`;
      if (command.help) {
        msg += `${command.help}\n\n`;
      }
      if (command.args && command.args.length > 0) {
        msg += `**Arguments:**\n`;
        for (const arg of command.args) {
          const required = arg.required ? " (required)" : "";
          const options = arg.options ? ` [${arg.options.join("|")}]` : "";
          msg += `- \`${arg.name}\`${required}${options}: ${arg.description}\n`;
        }
      }
      return { success: true, message: msg };
    }

    // Show all commands
    let msg = `**Available Commands**\n\n`;
    for (const cmd of slashCommands.getAll()) {
      msg += `**/${cmd.name}** - ${cmd.description}\n`;
    }
    msg += `\nType \`/help <command>\` for detailed help on a specific command.`;

    return { success: true, message: msg };
  },
});

// Helper function
function getStatusIcon(status: string): string {
  switch (status) {
    case "processing":
      return "🔄";
    case "idle":
      return "✓";
    case "waiting":
      return "⏳";
    case "paused":
      return "⏸";
    case "error":
      return "❌";
    case "complete":
      return "✅";
    default:
      return "○";
  }
}

/**
 * Get slash command completions for autocomplete
 */
export function getSlashCommandCompletions(prefix: string): Array<{
  name: string;
  description: string;
  args?: string;
}> {
  const commands = prefix ? slashCommands.getMatching(prefix) : slashCommands.getAll();
  return commands.map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    args: cmd.args?.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(" "),
  }));
}

// ============================================================================
// Export Helpers
// ============================================================================

interface ExportData {
  exportedAt: string;
  agents: Array<{
    name: string;
    role: string;
    focus: string;
    status: string;
    color: string;
    messages: Array<{
      id: string;
      role: string;
      content: string;
      timestamp: Date;
      toolCall?: {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
        result?: unknown;
        isError?: boolean;
      };
    }>;
    fileClaims: Array<{
      pathPattern: string;
      exclusive: boolean;
    }>;
  }>;
}

function generateMarkdownExport(data: ExportData): string {
  let md = `# Clautana Session Export\n\n`;
  md += `**Exported:** ${new Date(data.exportedAt).toLocaleString()}\n\n`;
  md += `---\n\n`;

  for (const agent of data.agents) {
    md += `## Agent: ${agent.name}\n\n`;
    md += `- **Role:** ${agent.role}\n`;
    md += `- **Focus:** ${agent.focus}\n`;
    md += `- **Status:** ${agent.status}\n\n`;

    if (agent.fileClaims.length > 0) {
      md += `### File Claims\n\n`;
      for (const claim of agent.fileClaims) {
        md += `- \`${claim.pathPattern}\` (${claim.exclusive ? "exclusive" : "shared"})\n`;
      }
      md += `\n`;
    }

    md += `### Conversation\n\n`;
    for (const message of agent.messages) {
      const timestamp = new Date(message.timestamp).toLocaleTimeString();
      const roleIcon = message.role === "user" ? "👤" : message.role === "assistant" ? "🤖" : "⚙️";

      if (message.toolCall) {
        md += `**${roleIcon} ${message.role}** (${timestamp})\n\n`;
        md += `> Tool: \`${message.toolCall.name}\`\n`;
        md += `> \`\`\`json\n> ${JSON.stringify(message.toolCall.arguments, null, 2).replace(/\n/g, "\n> ")}\n> \`\`\`\n`;
        if (message.toolCall.result !== undefined) {
          const result = typeof message.toolCall.result === "string"
            ? message.toolCall.result.slice(0, 500)
            : JSON.stringify(message.toolCall.result).slice(0, 500);
          md += `> Result: ${result}${result.length >= 500 ? "..." : ""}\n`;
        }
        md += `\n`;
      } else {
        md += `**${roleIcon} ${message.role}** (${timestamp})\n\n`;
        md += `${message.content}\n\n`;
      }
    }

    md += `---\n\n`;
  }

  return md;
}

// ============================================================================
// ADR Workflow Commands
// ============================================================================

/**
 * Helper to create ADR workflow command handlers
 */
function registerAdrCommand(
  name: string,
  description: string,
  help: string,
  args?: SlashCommand['args']
): void {
  slashCommands.register({
    name,
    description,
    help,
    args,
    async execute(ctx): Promise<SlashCommandResult> {
      const adrCtx: AdrHandlerContext = {
        args: ctx.args,
        argsRaw: ctx.argsRaw,
        orchestrator: ctx.orchestrator,
        agentPool: ctx.agentPool,
        extensionContext: ctx.extensionContext,
      };

      const result = await executeAdrCommand(name, adrCtx);

      return {
        success: result.success,
        message: result.message,
        data: result.data,
      };
    },
  });
}

// Register all ADR workflow commands
registerAdrCommand(
  'fn-feature',
  'Create a new feature area for investigation',
  'Creates a feature folder in .clautana/features/ with README and investigations subfolder.\n\nUsage: /fn-feature <feature-name>\nExample: /fn-feature api-caching',
  [{ name: 'feature-name', description: 'Name of the feature', required: true }]
);

registerAdrCommand(
  'fn-investigation',
  'Add an investigation exploring one approach',
  'Creates an investigation document in .clautana/features/<feature>/investigations/.\n\nUsage: /fn-investigation <feature-name> <investigation-topic>\nExample: /fn-investigation api-caching redis-approach',
  [
    { name: 'feature-name', description: 'Name of the feature', required: true },
    { name: 'investigation-topic', description: 'Topic of the investigation', required: true },
  ]
);

registerAdrCommand(
  'fn-adr',
  'Create ADR from viable investigations',
  'Creates an Architecture Decision Record in .clautana/adr/ based on completed investigations.\n\nUsage: /fn-adr <feature-name>\nExample: /fn-adr api-caching',
  [{ name: 'feature-name', description: 'Name of the feature', required: true }]
);

registerAdrCommand(
  'fn-reject',
  'Formally reject an investigation with reasoning',
  'Marks an investigation as rejected and archives it with the rejection reason.\n\nUsage: /fn-reject <feature-name> <investigation-topic>\nExample: /fn-reject api-caching in-memory-only',
  [
    { name: 'feature-name', description: 'Name of the feature', required: true },
    { name: 'investigation-topic', description: 'Topic to reject', required: true },
  ]
);

registerAdrCommand(
  'fn-task',
  'Implement and iterate on ADR tasks',
  'Spawns an implementation agent to work on tasks from an ADR.\n\nUsage: /fn-task\nThe command will prompt you to select an ADR and tasks to work on.',
  []
);

registerAdrCommand(
  'fn-accept',
  'Accept implemented ADR and move to docs/adr/',
  'Marks an ADR as accepted and moves it to the official docs/adr/ directory.\n\nUsage: /fn-accept <feature-name>\nExample: /fn-accept api-caching',
  [{ name: 'feature-name', description: 'Name of the feature', required: true }]
);

registerAdrCommand(
  'fn-review',
  'Technical code review before acceptance',
  'Spawns a code reviewer agent to review the implementation of an ADR.\n\nUsage: /fn-review\nThe command will prompt you to select an ADR to review.',
  []
);

registerAdrCommand(
  'fn-document',
  'Update documentation for implemented feature',
  'Spawns a documentation agent to update docs for a feature.\n\nUsage: /fn-document <feature-name>\nExample: /fn-document api-caching',
  [{ name: 'feature-name', description: 'Name of the feature', required: true }]
);

// ============================================================================
// Export Helpers
// ============================================================================

function generateHtmlExport(data: ExportData): string {
  const escapeHtml = (str: string) =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Clautana Session Export</title>
  <style>
    :root {
      --bg: #1e1e1e;
      --fg: #d4d4d4;
      --accent: #569cd6;
      --border: #404040;
      --user-bg: #264f78;
      --assistant-bg: #2d2d2d;
      --tool-bg: #3e3e3e;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--fg);
      margin: 0;
      padding: 20px;
      line-height: 1.6;
    }
    h1, h2, h3 { color: var(--accent); }
    .header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .agent {
      margin-bottom: 40px;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .agent-header {
      padding: 16px;
      background: var(--assistant-bg);
      border-bottom: 1px solid var(--border);
    }
    .agent-header h2 { margin: 0 0 8px 0; }
    .meta { font-size: 0.9em; opacity: 0.8; }
    .messages { padding: 16px; }
    .message {
      margin-bottom: 16px;
      padding: 12px;
      border-radius: 8px;
    }
    .message.user { background: var(--user-bg); }
    .message.assistant { background: var(--assistant-bg); }
    .message.tool { background: var(--tool-bg); font-family: monospace; font-size: 0.9em; }
    .message-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 0.85em;
      opacity: 0.8;
    }
    .message-content { white-space: pre-wrap; }
    pre {
      background: var(--bg);
      padding: 10px;
      border-radius: 4px;
      overflow-x: auto;
    }
    code { font-family: 'Fira Code', Consolas, monospace; }
    .claims {
      padding: 16px;
      background: var(--tool-bg);
      border-top: 1px solid var(--border);
    }
    .claim {
      display: inline-block;
      padding: 4px 8px;
      background: var(--bg);
      border-radius: 4px;
      margin: 4px;
      font-family: monospace;
      font-size: 0.85em;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Clautana Session Export</h1>
    <p class="meta">Exported: ${new Date(data.exportedAt).toLocaleString()}</p>
  </div>
`;

  for (const agent of data.agents) {
    html += `
  <div class="agent">
    <div class="agent-header">
      <h2>${escapeHtml(agent.name)}</h2>
      <p class="meta">
        <strong>Role:</strong> ${escapeHtml(agent.role)}<br>
        <strong>Focus:</strong> ${escapeHtml(agent.focus)}<br>
        <strong>Status:</strong> ${escapeHtml(agent.status)}
      </p>
    </div>
    <div class="messages">
`;

    for (const message of agent.messages) {
      const timestamp = new Date(message.timestamp).toLocaleTimeString();
      const roleClass = message.toolCall ? "tool" : message.role;

      html += `
      <div class="message ${roleClass}">
        <div class="message-header">
          <span>${escapeHtml(message.role)}</span>
          <span>${timestamp}</span>
        </div>
`;

      if (message.toolCall) {
        html += `
        <div class="message-content">
          <strong>Tool:</strong> <code>${escapeHtml(message.toolCall.name)}</code>
          <pre><code>${escapeHtml(JSON.stringify(message.toolCall.arguments, null, 2))}</code></pre>
`;
        if (message.toolCall.result !== undefined) {
          const result = typeof message.toolCall.result === "string"
            ? message.toolCall.result.slice(0, 1000)
            : JSON.stringify(message.toolCall.result).slice(0, 1000);
          html += `          <strong>Result:</strong> <pre><code>${escapeHtml(result)}</code></pre>\n`;
        }
        html += `        </div>\n`;
      } else {
        html += `        <div class="message-content">${escapeHtml(message.content)}</div>\n`;
      }

      html += `      </div>\n`;
    }

    html += `    </div>\n`;

    if (agent.fileClaims.length > 0) {
      html += `
    <div class="claims">
      <strong>File Claims:</strong><br>
`;
      for (const claim of agent.fileClaims) {
        html += `      <span class="claim">${escapeHtml(claim.pathPattern)} (${claim.exclusive ? "exclusive" : "shared"})</span>\n`;
      }
      html += `    </div>\n`;
    }

    html += `  </div>\n`;
  }

  html += `</body>
</html>`;

  return html;
}
