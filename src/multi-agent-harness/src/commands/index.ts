import * as vscode from "vscode";
import { OrchestratorAgent } from "../coordinator/OrchestratorAgent";
import { AgentPool } from "../coordinator/AgentPool";
import { WebviewProvider } from "../providers/WebviewProvider";
import { MessagesTreeProvider } from "../providers/MessagesTreeProvider";
import { KanbanPanel } from "../providers/KanbanPanel";
import { KnowledgePanel } from "../providers/KnowledgePanel";
import { getMemoryManager } from "../clautana/MemoryManager";
import { getWorkItemManager } from "../kanban";
import { COMMANDS } from "../constants";

export function registerCommands(
  context: vscode.ExtensionContext,
  orchestrator: OrchestratorAgent,
  agentPool: AgentPool,
  webviewProvider: WebviewProvider,
  messagesTreeProvider?: MessagesTreeProvider
): void {

  // Open panel
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.OPEN_PANEL, () => {
      webviewProvider.show();
    })
  );

  // Submit task to orchestrator (main entry point)
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.SUBMIT_TASK, async () => {
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
    vscode.commands.registerCommand(COMMANDS.SPAWN_AGENT, async () => {
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
    vscode.commands.registerCommand(COMMANDS.SEND_TO_AGENT, async () => {
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
    vscode.commands.registerCommand(COMMANDS.STOP_ALL, async () => {
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
    vscode.commands.registerCommand(COMMANDS.DESTROY_AGENT, async (item?: { name: string }) => {
      const agentName = item?.name || await selectAgent(agentPool, "Select agent to remove");
      if (!agentName) return;

      await agentPool.destroyAgent(agentName);
      vscode.window.showInformationMessage(`Agent ${agentName} removed`);
    })
  );

  // View agent status
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.VIEW_STATUS, () => {
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

  // Refresh claims display
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.REFRESH_CLAIMS, () => {
      // Trigger a refresh by emitting claims update event
      // The claims tracker will emit claimsUpdated which providers listen to
      vscode.window.showInformationMessage("Claims view refreshed");
    })
  );

  // Pause agent
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.PAUSE_AGENT, async (item?: { name: string }) => {
      const agentName = item?.name || await selectAgent(agentPool, "Select agent to pause");
      if (!agentName) return;

      const agent = agentPool.getAgent(agentName);
      if (agent) {
        agent.pause();
        vscode.window.showInformationMessage(`Agent ${agentName} paused`);
      }
    })
  );

  // Resume agent
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.RESUME_AGENT, async (item?: { name: string }) => {
      const agentName = item?.name || await selectAgent(agentPool, "Select agent to resume");
      if (!agentName) return;

      const agent = agentPool.getAgent(agentName);
      if (agent) {
        await agent.resume();
        vscode.window.showInformationMessage(`Agent ${agentName} resumed`);
      }
    })
  );

  // Open view for specific agent (via sidebar webview)
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.OPEN_AGENT_VIEW, async (item?: { name: string }) => {
      const agentName = item?.name || await selectAgent(agentPool, "Select agent to view");
      if (!agentName) return;

      // Show agent status in the main panel
      webviewProvider.show();
      vscode.window.showInformationMessage(`Viewing agent: ${agentName}`);
    })
  );

  // Initialize project with Clautana configuration
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.INIT_PROJECT, async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder open");
        return;
      }

      const configPath = vscode.Uri.joinPath(workspaceFolder.uri, ".clautana");

      try {
        await vscode.workspace.fs.stat(configPath);
        const overwrite = await vscode.window.showWarningMessage(
          ".clautana folder already exists. Overwrite?",
          { modal: true },
          "Overwrite"
        );
        if (overwrite !== "Overwrite") return;
      } catch {
        // Folder doesn't exist, create it
        await vscode.workspace.fs.createDirectory(configPath);
      }

      // Create a basic config.json
      const configFile = vscode.Uri.joinPath(configPath, "config.json");
      const defaultConfig = {
        version: "1.0",
        templates: [],
        mcpServers: {}
      };

      await vscode.workspace.fs.writeFile(
        configFile,
        Buffer.from(JSON.stringify(defaultConfig, null, 2), "utf-8")
      );

      vscode.window.showInformationMessage("Clautana project initialized");
      await vscode.commands.executeCommand("vscode.open", configFile);
    })
  );

  // Open Clautana configuration file
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.OPEN_CONFIG, async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder open");
        return;
      }

      const configPath = vscode.Uri.joinPath(workspaceFolder.uri, ".clautana", "config.json");

      try {
        await vscode.workspace.fs.stat(configPath);
        await vscode.commands.executeCommand("vscode.open", configPath);
      } catch {
        const create = await vscode.window.showWarningMessage(
          "No .clautana/config.json found. Initialize project?",
          "Initialize"
        );
        if (create === "Initialize") {
          await vscode.commands.executeCommand(COMMANDS.INIT_PROJECT);
        }
      }
    })
  );

  // View agent memory
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.VIEW_MEMORY, async (item?: { name: string }) => {
      const agentName = item?.name || await selectAgent(agentPool, "Select agent to view memory");
      if (!agentName) return;

      const output = vscode.window.createOutputChannel(`Agent Memory: ${agentName}`);
      output.clear();
      output.appendLine(`=== Memory for ${agentName} ===\n`);

      try {
        const memoryManager = getMemoryManager();
        await memoryManager.initialize();
        const stats = await memoryManager.getStats();

        output.appendLine("Memory Statistics:");
        output.appendLine(`  Playbooks: ${stats.playbooks.count} entries (${stats.playbooks.totalUseCount} uses)`);
        output.appendLine(`  Facts: ${stats.facts.count} entries (${stats.facts.totalUseCount} uses)`);
        output.appendLine(`  Sessions: ${stats.sessions.count} entries (${stats.sessions.totalUseCount} uses)`);
        output.appendLine("");

        // Show recent playbooks relevant to this agent
        const playbooks = await memoryManager.search("playbooks", { limit: 5, sortBy: "lastUsed" });
        if (playbooks.entries.length > 0) {
          output.appendLine("Recent Playbooks:");
          for (const entry of playbooks.entries) {
            const tags = entry.tags.length > 0 ? ` [${entry.tags.join(", ")}]` : "";
            output.appendLine(`  - ${entry.content.substring(0, 80)}...${tags}`);
          }
          output.appendLine("");
        }

        // Show recent facts
        const facts = await memoryManager.search("facts", { limit: 5, sortBy: "lastUsed" });
        if (facts.entries.length > 0) {
          output.appendLine("Recent Facts:");
          for (const entry of facts.entries) {
            const tags = entry.tags.length > 0 ? ` [${entry.tags.join(", ")}]` : "";
            output.appendLine(`  - ${entry.content.substring(0, 80)}...${tags}`);
          }
          output.appendLine("");
        }

        output.appendLine("Use /memory command in chat for more options.");
      } catch (error) {
        output.appendLine("Memory feature requires initialization.");
        output.appendLine("Run /init in the chat panel to set up memory storage.");
        output.appendLine("");
        output.appendLine("Memory will store:");
        output.appendLine("- Learned patterns and preferences (playbooks)");
        output.appendLine("- Project-specific knowledge (facts)");
        output.appendLine("- Session history for context (sessions)");
      }

      output.show();
    })
  );

  // Open Kanban board
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.OPEN_KANBAN, () => {
      KanbanPanel.createOrShow(context);
    })
  );

  // Create work item
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.CREATE_WORKITEM, async () => {
      const title = await vscode.window.showInputBox({
        prompt: "Work item title",
        placeHolder: "e.g., Implement user authentication",
      });
      if (!title) return;

      const description = await vscode.window.showInputBox({
        prompt: "Description",
        placeHolder: "Detailed description of the work to be done",
      });
      if (!description) return;

      const priorityPick = await vscode.window.showQuickPick(
        [
          { label: "Critical", value: "critical" },
          { label: "High", value: "high" },
          { label: "Medium", value: "medium" },
          { label: "Low", value: "low" },
        ],
        { placeHolder: "Select priority" }
      );
      const priority = (priorityPick?.value as "critical" | "high" | "medium" | "low") ?? "medium";

      const tagsInput = await vscode.window.showInputBox({
        prompt: "Tags (comma-separated, optional)",
        placeHolder: "e.g., backend, api, security",
      });
      const tags = tagsInput ? tagsInput.split(",").map(t => t.trim()).filter(Boolean) : [];

      const workItemManager = getWorkItemManager();
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        await workItemManager.initialize(workspaceFolder.uri.fsPath);
      }

      const item = await workItemManager.createItem({
        title,
        description,
        priority,
        tags,
      });

      vscode.window.showInformationMessage(`Created work item: ${item.id}`);

      // Open the Kanban board to show the new item
      KanbanPanel.createOrShow(context);
    })
  );

  // Refresh Kanban board
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.REFRESH_KANBAN, () => {
      // KanbanPanel will refresh automatically via file watcher
      vscode.window.showInformationMessage("Kanban board refreshed");
    })
  );

  // Open Knowledge Explorer
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.OPEN_KNOWLEDGE_EXPLORER, () => {
      KnowledgePanel.createOrShow(context);
    })
  );

  // Archive message
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.ARCHIVE_MESSAGE, async (item?: { message: { id: string } }) => {
      if (!messagesTreeProvider) {
        vscode.window.showErrorMessage("Messages tree provider not initialized");
        return;
      }

      const messageId = item?.message?.id;
      if (!messageId) {
        vscode.window.showErrorMessage("No message selected");
        return;
      }

      await messagesTreeProvider.archiveMessage(messageId);
      vscode.window.showInformationMessage("Message archived");
    })
  );

  // Unarchive message
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.UNARCHIVE_MESSAGE, async (item?: { message: { id: string } }) => {
      if (!messagesTreeProvider) {
        vscode.window.showErrorMessage("Messages tree provider not initialized");
        return;
      }

      const messageId = item?.message?.id;
      if (!messageId) {
        vscode.window.showErrorMessage("No message selected");
        return;
      }

      await messagesTreeProvider.unarchiveMessage(messageId);
      vscode.window.showInformationMessage("Message unarchived");
    })
  );

  // View message (opens .md file)
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.VIEW_MESSAGE, async (item?: { message: { id: string; archived?: boolean } }) => {
      const messageId = item?.message?.id;
      if (!messageId) {
        vscode.window.showErrorMessage("No message selected");
        return;
      }

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder open");
        return;
      }

      // Determine folder based on archived status
      const folder = item?.message?.archived ? "archive" : "inbox";
      const messagePath = vscode.Uri.joinPath(
        workspaceFolder.uri,
        ".clautana",
        "messages",
        folder,
        `${messageId}.md`
      );

      try {
        await vscode.commands.executeCommand("vscode.open", messagePath);

        // Mark as read when opened
        if (messagesTreeProvider) {
          messagesTreeProvider.markAsRead(messageId);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Could not open message file: ${error instanceof Error ? error.message : String(error)}`);
      }
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
