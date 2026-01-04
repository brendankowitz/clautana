import * as vscode from "vscode";
import { OrchestratorAgent } from "./coordinator/OrchestratorAgent";
import { AgentPool } from "./coordinator/AgentPool";
import { WebviewProvider } from "./providers/WebviewProvider";
import { AgentTreeProvider } from "./providers/AgentTreeProvider";
import { ClaimsTreeProvider } from "./providers/ClaimsTreeProvider";
import { MessagesTreeProvider } from "./providers/MessagesTreeProvider";
import { DecoratorProvider } from "./providers/DecoratorProvider";
import { StatusBarProvider } from "./providers/StatusBarProvider";
// AgentEditorProvider disabled - see TODO comment below
// import { AgentEditorProvider, AgentDocumentProvider } from "./providers/AgentEditorProvider";
import { registerCommands } from "./commands";
import { registerSlashCommands } from "./commands/DynamicSlashCommands";
import { getConfigManager } from "./clautana/ConfigManager";
import { VIEWS } from "./constants";

let orchestrator: OrchestratorAgent | undefined;
let agentPool: AgentPool | undefined;
let webviewProvider: WebviewProvider | undefined;
let decoratorProvider: DecoratorProvider | undefined;
let statusBarProvider: StatusBarProvider | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log("Clautana activating...");

  // Initialize config manager with workspace root first (needed by many components)
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    const { initConfigManager } = await import("./clautana/ConfigManager");
    initConfigManager(workspaceRoot);
  } else {
    console.warn("No workspace folder open - some features may be unavailable");
  }

  // Initialize agent pool (manages worker agents)
  agentPool = new AgentPool(context);

  // Initialize orchestrator (the brain that spawns/manages agents)
  orchestrator = new OrchestratorAgent(context, agentPool);

  // Listen to message arrival events and notify orchestrator
  const { globalMessageStore } = await import("./mcp/MailMcpServer");
  globalMessageStore.on("messageArrived", (data: { recipient: string; sender: string; subject: string }) => {
    // Show notification to user about new message
    const message = `Agent ${data.recipient} has a message waiting from ${data.sender}: "${data.subject}"`;
    vscode.window.showInformationMessage(message, "View Messages").then(selection => {
      if (selection === "View Messages") {
        vscode.commands.executeCommand("clautana.messages.focus");
      }
    });

    // If the message is for the orchestrator, inject a notification to prompt it to check inbox
    if (data.recipient === "orchestrator" && orchestrator) {
      const inboxPrompt = `You have a new message from ${data.sender} with subject: "${data.subject}". Please check your inbox using the inbox() tool and process the message.`;
      orchestrator.handleUserTask(inboxPrompt).catch(err => {
        console.error("Failed to notify orchestrator about new message:", err);
      });
    }
  });

  // Check inbox on startup for any pending unread messages (fire-and-forget)
  checkInboxOnStartup(globalMessageStore).catch(err => {
    console.log("Failed to check inbox on startup:", err instanceof Error ? err.message : String(err));
  });

  // Initialize UI providers
  webviewProvider = new WebviewProvider(context, orchestrator, agentPool);
  const agentTreeProvider = new AgentTreeProvider(agentPool);
  const claimsTreeProvider = new ClaimsTreeProvider(agentPool);
  const messagesTreeProvider = new MessagesTreeProvider(agentPool);
  decoratorProvider = new DecoratorProvider(agentPool);
  statusBarProvider = new StatusBarProvider(orchestrator, agentPool);

  // Register webview
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      VIEWS.PANEL,
      webviewProvider
    )
  );

  // Register tree views
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      VIEWS.AGENTS,
      agentTreeProvider
    ),
    vscode.window.registerTreeDataProvider(
      VIEWS.CLAIMS,
      claimsTreeProvider
    ),
    vscode.window.registerTreeDataProvider(
      VIEWS.MESSAGES,
      messagesTreeProvider
    )
  );

  // Register commands
  registerCommands(context, orchestrator, agentPool, webviewProvider, messagesTreeProvider);

  // Register slash commands (workflow-aware command completion and status bar)
  if (workspaceRoot) {
    registerSlashCommands(context, getConfigManager());
  }

  // Initialize decorators
  decoratorProvider.register(context);

  // Initialize status bar
  statusBarProvider.register(context);

  // TODO: Custom editor with virtual URIs needs FileSystemProvider implementation
  // Disabled for now - VS Code tries to restore editors before extension activates
  // causing "Unable to resolve resource" errors
  // const agentEditorProvider = new AgentEditorProvider(context, orchestrator, agentPool);
  // context.subscriptions.push(
  //   vscode.window.registerCustomEditorProvider(
  //     AgentEditorProvider.viewType,
  //     agentEditorProvider,
  //     {
  //       webviewOptions: { retainContextWhenHidden: true },
  //       supportsMultipleEditorsPerDocument: false,
  //     }
  //   )
  // );
  // context.subscriptions.push(
  //   vscode.workspace.registerTextDocumentContentProvider(
  //     "clautana-agent",
  //     new AgentDocumentProvider()
  //   )
  // );

  console.log("Clautana activated - orchestrator ready");
}

export function getOrchestrator(): OrchestratorAgent | undefined {
  return orchestrator;
}

export function deactivate() {
  // Clean up all providers and core components
  // Order matters: clean up UI first, then agents, then orchestrator
  try {
    decoratorProvider?.dispose();
    statusBarProvider?.dispose();
    webviewProvider?.dispose();
    agentPool?.dispose();
    orchestrator?.dispose();
  } catch (error) {
    console.error("Error during deactivation:", error);
  } finally {
    // Clear references
    decoratorProvider = undefined;
    statusBarProvider = undefined;
    webviewProvider = undefined;
    agentPool = undefined;
    orchestrator = undefined;
  }
}

/**
 * Check for unread messages in the inbox on startup
 * Shows a notification if there are pending messages
 */
async function checkInboxOnStartup(messageStore: any): Promise<void> {
  try {
    // Initialize the message store to load existing messages
    await messageStore.initialize();

    const allMessages = await messageStore.getAllMessages();
    const unreadMessages = allMessages.filter((m: any) => !m.read && !m.archived);

    if (unreadMessages.length > 0) {
      const message = unreadMessages.length === 1
        ? `You have 1 unread message in your inbox`
        : `You have ${unreadMessages.length} unread messages in your inbox`;

      vscode.window.showInformationMessage(message, "View Messages").then(selection => {
        if (selection === "View Messages") {
          vscode.commands.executeCommand("clautana.messages.focus");
        }
      });
    }
  } catch (error) {
    // Silently ignore errors during startup inbox check
    // (e.g., if .clautana folder doesn't exist yet)
    console.log("Inbox check skipped:", error instanceof Error ? error.message : String(error));
  }
}
