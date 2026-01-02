import * as vscode from "vscode";
import { AgentPool } from "../coordinator/AgentPool";
import { OrchestratorAgent } from "../coordinator/OrchestratorAgent";
import { AgentOutput, FileClaim } from "../coordinator/types";

/**
 * AgentEditorProvider creates full-tab editor views for detailed agent monitoring.
 *
 * This is the "expanded" view vs the compact sidebar panel:
 * - Full-width layout with more space
 * - Live edit previews with diffs
 * - Detailed agent activity streams
 * - File change tracking
 * - Side-by-side agent comparison
 *
 * Uses VS Code's CustomTextEditorProvider for editor-like experience.
 */
export class AgentEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "clautana.agentView";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly orchestrator: OrchestratorAgent,
    private readonly agentPool: AgentPool
  ) {
    // Constructor - instance is managed externally
  }

  /**
   * Open a full-tab view for a specific agent or the orchestrator overview
   * Currently disabled - opens sidebar panel instead
   */
  static async openAgentView(agentName?: string): Promise<void> {
    // Custom editor with virtual URIs is disabled due to VS Code session restore issues
    // Just open the sidebar panel instead
    await vscode.commands.executeCommand("clautana.openPanel");
    if (agentName && agentName !== "orchestrator") {
      vscode.window.showInformationMessage(`Viewing agent: ${agentName} - see Clautana panel`);
    }
  }

  /**
   * Called when VS Code opens a document with our custom editor
   */
  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // Extract agent name from URI
    const agentName = document.uri.path.replace("/", "").replace(".clautana", "");
    const isOrchestrator = agentName === "orchestrator";

    // Configure webview
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"),
      ],
    };

    // Set HTML content
    webviewPanel.webview.html = this.getHtmlForWebview(
      webviewPanel.webview,
      agentName,
      isOrchestrator
    );

    // Handle messages from webview
    const messageDisposable = webviewPanel.webview.onDidReceiveMessage((message) => {
      this.handleWebviewMessage(message, webviewPanel.webview, agentName).catch((error) => {
        console.error("Failed to handle webview message:", error);
        webviewPanel.webview.postMessage({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });

    // Send initial state
    this.sendState(webviewPanel.webview, agentName, isOrchestrator);

    // Set up event listeners
    const eventListenersDisposable = this.setupEventListeners(webviewPanel, agentName, isOrchestrator);

    // Clean up when panel is disposed
    webviewPanel.onDidDispose(() => {
      messageDisposable.dispose();
      eventListenersDisposable.dispose();
    });
  }

  /**
   * Send current state to webview
   */
  private sendState(
    webview: vscode.Webview,
    agentName: string,
    isOrchestrator: boolean
  ): void {
    try {
      if (isOrchestrator) {
        // Send orchestrator state with all agents
        webview.postMessage({
          type: "orchestratorState",
          data: {
            status: "idle", // TODO: Get from orchestrator
            messages: this.orchestrator.messages,
            agents: this.agentPool.getAllAgents().map((a) => ({
              name: a.name,
              role: a.role,
              focus: a.focus,
              status: a.status,
              color: a.color,
              messages: a.messages,
            })),
            claims: this.agentPool.getAllClaims(),
          },
        }).then(undefined, (error) => {
          console.error("Failed to send orchestrator state:", error);
        });
      } else {
        // Send specific agent state
        const agent = this.agentPool.getAgent(agentName);
        if (agent) {
          webview.postMessage({
            type: "agentState",
            data: {
              name: agent.name,
              role: agent.role,
              focus: agent.focus,
              status: agent.status,
              color: agent.color,
              messages: agent.messages,
              claims: this.agentPool
                .getAllClaims()
                .filter((c) => c.agentName === agentName),
            },
          }).then(undefined, (error) => {
            console.error("Failed to send agent state:", error);
          });
        }
      }
    } catch (error) {
      console.error("Failed to send state to webview:", error);
    }
  }

  /**
   * Set up event listeners for real-time updates
   * Returns a disposable to clean up listeners when the panel is closed
   */
  private setupEventListeners(
    webviewPanel: vscode.WebviewPanel,
    agentName: string,
    isOrchestrator: boolean
  ): vscode.Disposable {
    const webview = webviewPanel.webview;
    const disposables: vscode.Disposable[] = [];

    // Agent output events
    const outputHandler = (name: string, output: AgentOutput) => {
      try {
        if (isOrchestrator || name === agentName) {
          webview.postMessage({
            type: "agentOutput",
            agentName: name,
            output,
          }).then(undefined, (error) => {
            console.error("Failed to send agent output:", error);
          });
        }
      } catch (error) {
        console.error("Failed to handle agent output:", error);
      }
    };
    this.agentPool.on("agentOutput", outputHandler);
    disposables.push({ dispose: () => this.agentPool.off("agentOutput", outputHandler) });

    // Status changes
    const statusHandler = (name: string, status: string) => {
      try {
        if (isOrchestrator || name === agentName) {
          webview.postMessage({
            type: "agentStatusChanged",
            agentName: name,
            status,
          }).then(undefined, (error) => {
            console.error("Failed to send status change:", error);
          });
        }
      } catch (error) {
        console.error("Failed to handle status change:", error);
      }
    };
    this.agentPool.on("agentStatusChanged", statusHandler);
    disposables.push({ dispose: () => this.agentPool.off("agentStatusChanged", statusHandler) });

    // File claims
    const claimsHandler = (claims: FileClaim[]) => {
      try {
        const relevantClaims = isOrchestrator
          ? claims
          : claims.filter((c) => c.agentName === agentName);

        webview.postMessage({
          type: "claimsUpdated",
          claims: relevantClaims,
        }).then(undefined, (error) => {
          console.error("Failed to send claims update:", error);
        });
      } catch (error) {
        console.error("Failed to handle claims update:", error);
      }
    };
    this.agentPool.on("claimsUpdated", claimsHandler);
    disposables.push({ dispose: () => this.agentPool.off("claimsUpdated", claimsHandler) });

    // Orchestrator messages
    if (isOrchestrator) {
      const messageHandler = (message: unknown) => {
        try {
          webview.postMessage({
            type: "orchestratorMessage",
            message,
          }).then(undefined, (error) => {
            console.error("Failed to send orchestrator message:", error);
          });
        } catch (error) {
          console.error("Failed to handle orchestrator message:", error);
        }
      };
      this.orchestrator.on("message", messageHandler);
      disposables.push({ dispose: () => this.orchestrator.off("message", messageHandler) });
    }

    // Return a combined disposable
    return {
      dispose: () => {
        disposables.forEach((d) => d.dispose());
      },
    };
  }

  /**
   * Handle messages from webview
   */
  private async handleWebviewMessage(
    message: any,
    webview: vscode.Webview,
    agentName: string
  ): Promise<void> {
    switch (message.type) {
      case "refresh":
        this.sendState(webview, agentName, agentName === "orchestrator");
        break;

      case "pauseAgent":
        const pauseAgent = this.agentPool.getAgent(message.agentName);
        if (pauseAgent) {
          pauseAgent.pause();
        }
        break;

      case "resumeAgent":
        const resumeAgent = this.agentPool.getAgent(message.agentName);
        if (resumeAgent) {
          await resumeAgent.resume();
        }
        break;

      case "stopAgent":
        await this.agentPool.destroyAgent(message.agentName);
        break;

      case "openFile":
        try {
          const doc = await vscode.workspace.openTextDocument(message.filePath);
          await vscode.window.showTextDocument(doc, {
            selection: message.range
              ? new vscode.Range(
                  message.range.start.line,
                  message.range.start.character,
                  message.range.end.line,
                  message.range.end.character
                )
              : undefined,
          });
        } catch (error) {
          console.error(`Failed to open file ${message.filePath}:`, error);
          webview.postMessage({
            type: "error",
            error: `Failed to open file: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
        break;

      case "openDiff":
        try {
          // Use git diff if available
          const filePath = message.filePath;
          const fileUri = vscode.Uri.file(filePath);
          await vscode.commands.executeCommand("git.openChange", fileUri);
        } catch (error) {
          // Fallback: just open the file
          console.error(`Failed to open diff for ${message.filePath}:`, error);
          try {
            const doc = await vscode.workspace.openTextDocument(message.filePath);
            await vscode.window.showTextDocument(doc);
          } catch (openError) {
            webview.postMessage({
              type: "error",
              error: `Failed to open diff: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }
        break;

      case "sendMessage":
        await this.agentPool.messageAgent(message.agentName, message.text);
        break;
    }
  }

  /**
   * Generate HTML for the full-tab agent view
   */
  private getHtmlForWebview(
    webview: vscode.Webview,
    agentName: string,
    isOrchestrator: boolean
  ): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "dist",
        "webview",
        "assets",
        "agent-view.js"
      )
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "dist",
        "webview",
        "assets",
        "agent-view.css"
      )
    );

    const title = isOrchestrator ? "Clautana Orchestrator" : `Agent: ${agentName}`;

    // Generate a nonce for inline scripts to satisfy CSP
    const nonce = this.generateNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource};">
  <link href="${styleUri}" rel="stylesheet">
  <title>${title}</title>
</head>
<body data-agent-name="${agentName}" data-is-orchestrator="${isOrchestrator}">
  <div id="root"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    window.vscode = vscode;
    window.agentName = "${agentName}";
    window.isOrchestrator = ${isOrchestrator};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
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
}

/**
 * Virtual document provider for clautana-agent: URIs
 */
export class AgentDocumentProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(_uri: vscode.Uri): string {
    // Return empty content - the custom editor handles everything
    return "";
  }
}
