import * as vscode from "vscode";
import { OrchestratorAgent } from "../coordinator/OrchestratorAgent";
import { AgentPool } from "../coordinator/AgentPool";
import {
  OrchestratorMessage,
  AgentOutput,
  FileClaim,
  AgentMessage,
} from "../coordinator/types";
import { slashCommands, getSlashCommandCompletions } from "../commands/SlashCommands";

/**
 * Message types sent from webview to extension
 */
type WebviewToExtensionMessage =
  | { type: "getState" }
  | { type: "submitTask"; task: string }
  | { type: "stopAll" }
  | { type: "pauseAgent"; agentName: string }
  | { type: "resumeAgent"; agentName: string }
  | { type: "destroyAgent"; agentName: string }
  | { type: "sendToAgent"; agentName: string; message: string }
  | { type: "executeSlashCommand"; command: string }
  | { type: "getSlashCommandCompletions"; prefix: string };

/**
 * Message types sent from extension to webview
 */
type ExtensionToWebviewMessage =
  | { type: "state"; orchestrator: OrchestratorState; agents: AgentState[] }
  | { type: "orchestratorUpdate"; updates: Partial<OrchestratorState> }
  | { type: "orchestratorMessage"; message: OrchestratorMessage }
  | { type: "agentSpawned"; agent: AgentState }
  | { type: "agentDestroyed"; agentName: string }
  | { type: "agentUpdate"; agentName: string; updates: Partial<AgentState> }
  | { type: "agentMessage"; agentName: string; message: ChatMessage }
  | { type: "claimsUpdated"; claims: FileClaim[] }
  | { type: "interAgentMessage"; message: AgentMessage }
  | { type: "error"; error: string }
  | { type: "slashCommandResult"; success: boolean; message: string; data?: unknown }
  | { type: "slashCommandCompletions"; completions: Array<{ name: string; description: string; args?: string }> };

/**
 * Orchestrator state for webview
 */
interface OrchestratorState {
  status: "idle" | "processing" | "error";
  currentTask?: string;
  messages: OrchestratorMessage[];
  sessionId?: string;
}

/**
 * Agent state for webview
 */
interface AgentState {
  name: string;
  role: string;
  focus: string;
  status: "waiting" | "idle" | "processing" | "complete" | "error" | "paused" | "initializing";
  color: string;
  messages: ChatMessage[];
  waitingFor: string[];
}

/**
 * Chat message for webview
 */
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: Date;
}

/**
 * WebviewProvider implements the main panel webview for the multi-agent harness.
 *
 * Responsibilities:
 * - Implements vscode.WebviewViewProvider
 * - Loads the React app from dist/webview
 * - Handles bidirectional messaging between extension and webview
 * - Posts state updates to webview when orchestrator/agents change
 * - Receives commands from webview (submitTask, stopAll, pauseAgent, etc.)
 * - Maintains webview state synchronization
 */
export class WebviewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private orchestratorState: OrchestratorState = {
    status: "idle",
    messages: [],
  };
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly orchestrator: OrchestratorAgent,
    private readonly agentPool: AgentPool
  ) {
    this.setupEventListeners();
  }

  /**
   * Set up event listeners for orchestrator and agent pool
   */
  private setupEventListeners(): void {
    console.log("[WebviewProvider] Setting up event listeners");

    // Orchestrator events
    const statusChangedHandler = (status: "idle" | "processing" | "error") => {
      try {
        console.log(`[WebviewProvider] Orchestrator status changed: ${status}`);
        this.orchestratorState.status = status;
        this.postMessage({
          type: "orchestratorUpdate",
          updates: { status },
        });
      } catch (error) {
        console.error("Failed to handle status change:", error);
      }
    };
    this.orchestrator.on("statusChanged", statusChangedHandler);

    const messageHandler = (message: OrchestratorMessage) => {
      try {
        this.orchestratorState.messages.push(message);
        this.postMessage({
          type: "orchestratorMessage",
          message,
        });
      } catch (error) {
        console.error("Failed to handle orchestrator message:", error);
      }
    };
    this.orchestrator.on("message", messageHandler);

    // Agent pool events
    const agentSpawnedHandler = (session: any) => {
      try {
        console.log(`[WebviewProvider] Agent spawned: ${session?.name}`, session);
        const agentState = this.buildAgentState(session);
        this.postMessage({
          type: "agentSpawned",
          agent: agentState,
        });
      } catch (error) {
        console.error("Failed to handle agent spawned:", error);
      }
    };
    this.agentPool.on("agentSpawned", agentSpawnedHandler);

    const agentDestroyedHandler = (agentName: string) => {
      try {
        this.postMessage({
          type: "agentDestroyed",
          agentName,
        });
      } catch (error) {
        console.error("Failed to handle agent destroyed:", error);
      }
    };
    this.agentPool.on("agentDestroyed", agentDestroyedHandler);

    const agentStatusChangedHandler = (agentName: string, status: string) => {
      try {
        this.postMessage({
          type: "agentUpdate",
          agentName,
          updates: { status: status as any },
        });
      } catch (error) {
        console.error("Failed to handle agent status change:", error);
      }
    };
    this.agentPool.on("agentStatusChanged", agentStatusChangedHandler);

    const agentOutputHandler = (agentName: string, output: AgentOutput) => {
      try {
        if (output.type === "text") {
          const message: ChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: output.content,
            timestamp: new Date(),
          };
          this.postMessage({
            type: "agentMessage",
            agentName,
            message,
          });
        }
      } catch (error) {
        console.error("Failed to handle agent output:", error);
      }
    };
    this.agentPool.on("agentOutput", agentOutputHandler);

    const claimsUpdatedHandler = (claims: FileClaim[]) => {
      try {
        this.postMessage({
          type: "claimsUpdated",
          claims,
        });
      } catch (error) {
        console.error("Failed to handle claims update:", error);
      }
    };
    this.agentPool.on("claimsUpdated", claimsUpdatedHandler);

    const messageReceivedHandler = (message: AgentMessage) => {
      try {
        console.log(`[WebviewProvider] Inter-agent message received: ${message.from} -> ${message.to}`, message);
        this.postMessage({
          type: "interAgentMessage",
          message: {
            id: message.id,
            from: message.from,
            to: message.to,
            subject: message.subject,
            body: message.body,
            timestamp: message.timestamp,
            read: message.read,
          },
        });
      } catch (error) {
        console.error("Failed to handle message received:", error);
      }
    };
    this.agentPool.on("messageReceived", messageReceivedHandler);
    this.disposables.push({ dispose: () => this.agentPool.off("messageReceived", messageReceivedHandler) });
  }

  /**
   * Resolve the webview view (called by VS Code)
   */
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    this.view = webviewView;

    // Configure webview options
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"),
        vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "assets"),
      ],
    };

    // Set HTML content
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Handle messages from webview
    const messageDisposable = webviewView.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      this.handleWebviewMessage(message).catch((error) => {
        console.error("Failed to handle webview message:", error);
        this.postMessage({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });

    this.disposables.push(messageDisposable);
  }

  /**
   * Handle messages received from the webview
   */
  private async handleWebviewMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case "getState": {
        // Send current state to webview
        const agents = this.agentPool.getAllAgents().map((session) =>
          this.buildAgentState(session)
        );

        this.postMessage({
          type: "state",
          orchestrator: this.orchestratorState,
          agents,
        });
        break;
      }

      case "submitTask": {
        // Submit task to orchestrator
        this.orchestratorState.currentTask = message.task;
        this.postMessage({
          type: "orchestratorUpdate",
          updates: { currentTask: message.task },
        });

        try {
          await this.orchestrator.handleUserTask(message.task);
        } catch (error) {
          this.postMessage({
            type: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }

      case "stopAll": {
        // Stop orchestrator and all agents
        this.orchestrator.stop();
        const agents = this.agentPool.getAllAgents();
        for (const agent of agents) {
          await this.agentPool.destroyAgent(agent.name);
        }
        break;
      }

      case "pauseAgent": {
        // Pause specific agent
        const agent = this.agentPool.getAgent(message.agentName);
        if (agent) {
          agent.pause();
        }
        break;
      }

      case "resumeAgent": {
        // Resume specific agent
        const agent = this.agentPool.getAgent(message.agentName);
        if (agent) {
          await agent.resume();
        }
        break;
      }

      case "destroyAgent": {
        // Destroy specific agent
        await this.agentPool.destroyAgent(message.agentName);
        break;
      }

      case "sendToAgent": {
        // Send message to specific agent
        await this.agentPool.messageAgent(message.agentName, message.message);
        break;
      }

      case "executeSlashCommand": {
        // Execute a slash command
        try {
          const result = await slashCommands.execute(
            message.command,
            this.context,
            this.orchestrator,
            this.agentPool
          );

          if (result) {
            // Handle special command actions
            if (result.data && typeof result.data === "object" && "action" in result.data) {
              const action = (result.data as { action: string }).action;
              if (action === "clearChat") {
                this.orchestratorState.messages = [];
                this.postMessage({
                  type: "orchestratorUpdate",
                  updates: { messages: [] },
                });
              }
            }

            // Show result message if present
            if (result.message) {
              this.postMessage({
                type: "slashCommandResult",
                success: result.success,
                message: result.message,
                data: result.data,
              });
            }
          }
        } catch (error) {
          this.postMessage({
            type: "error",
            error: `Failed to execute command: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
        break;
      }

      case "getSlashCommandCompletions": {
        // Get slash command completions for autocomplete
        const completions = getSlashCommandCompletions(message.prefix);
        this.postMessage({
          type: "slashCommandCompletions",
          completions,
        });
        break;
      }
    }
  }

  /**
   * Build agent state object for webview
   */
  private buildAgentState(session: any): AgentState {
    return {
      name: session.name,
      role: session.role ?? "Agent",
      focus: session.focus ?? "Working...",
      status: session.status,
      color: session.color ?? "#3B82F6",
      messages: session.messages ?? [],
      waitingFor: [], // TODO: Track dependencies
    };
  }

  /**
   * Post message to webview
   */
  private postMessage(message: ExtensionToWebviewMessage): void {
    if (this.view) {
      console.log(`[WebviewProvider] Posting message: ${message.type}`, message);
      this.view.webview.postMessage(message).then(
        () => {
          // Message sent successfully
        },
        (error) => {
          console.error("Failed to post message to webview:", error);
        }
      );
    } else {
      console.warn(`[WebviewProvider] No view available for message: ${message.type}`);
    }
  }

  /**
   * Show the webview panel
   */
  show(): void {
    if (this.view) {
      this.view.show();
    } else {
      // View not yet resolved - show the container first, then focus the panel
      vscode.commands.executeCommand("workbench.view.extension.clautana").then(() => {
        vscode.commands.executeCommand("clautana.panel.focus");
      });
    }
  }

  /**
   * Generate HTML content for the webview
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    // Load the built React app from dist/webview/assets
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "assets", "index.js")
    );
    const vendorScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "assets", "index2.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "assets", "index.css")
    );

    // Get VS Code theme
    const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;

    // Generate a nonce for inline scripts to satisfy CSP
    const nonce = this.generateNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource};">
  <link href="${styleUri}" rel="stylesheet">
  <link rel="modulepreload" href="${vendorScriptUri}">
  <title>Multi-Agent Harness</title>
</head>
<body class="${isDark ? "vscode-dark" : "vscode-light"}">
  <div id="root"></div>
  <script nonce="${nonce}">
    // Make VS Code API available to the React app
    const vscode = acquireVsCodeApi();
    window.vscode = vscode;
  </script>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Generate a cryptographically secure nonce for CSP
   */
  private generateNonce(): string {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let i = 0; i < 32; i++) {
      nonce += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return nonce;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    // Dispose all event listeners
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
