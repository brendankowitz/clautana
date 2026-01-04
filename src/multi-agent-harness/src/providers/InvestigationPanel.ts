import * as vscode from "vscode";
import type { Investigation, Spec, ADR, BrowserViewMode } from "../investigations/types";

// Lazy import to avoid circular dependencies
async function getInvestigationManagerModule() {
  const module = await import("../investigations");
  return module.getInvestigationManager();
}

async function getConfigManagerModule() {
  const module = await import("../clautana/ConfigManager");
  return module.getConfigManager();
}

/**
 * Full-tab WebviewPanel for the Investigation/Spec Browser
 */
export class InvestigationPanel {
  private static instance: InvestigationPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtmlContent();
    this.setupMessageHandler();

    // Refresh data when panel regains focus/visibility
    this.panel.onDidChangeViewState(
      (e) => {
        if (e.webviewPanel.visible) {
          // Panel became visible - refresh data from disk
          this.sendFullState();
        }
      },
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  /**
   * Create or show the Investigation panel
   */
  static createOrShow(context: vscode.ExtensionContext): InvestigationPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (InvestigationPanel.instance) {
      InvestigationPanel.instance.panel.reveal(column);
      return InvestigationPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      "clautana.investigationBrowser",
      "Investigation Browser",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "dist", "webview"),
          vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "assets"),
        ],
      }
    );

    InvestigationPanel.instance = new InvestigationPanel(panel, context);
    return InvestigationPanel.instance;
  }

  /**
   * Get the current instance if it exists
   */
  static getInstance(): InvestigationPanel | undefined {
    return InvestigationPanel.instance;
  }

  private setupMessageHandler(): void {
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        console.log('[InvestigationPanel] Received message:', message.type, message);
        switch (message.type) {
          case "getState":
            await this.sendFullState();
            break;
          case "openItem":
            await this.handleOpenItem(message);
            break;
          case "splitIntoTasks":
            await this.handleSplitIntoTasks(message);
            break;
          case "acceptToADR":
            await this.handleAcceptToADR(message);
            break;
          case "changeView":
            await this.handleChangeView(message);
            break;
          case "createInvestigation":
            console.log('[InvestigationPanel] About to call handleCreateInvestigation');
            await this.handleCreateInvestigation(message);
            break;
          default:
            console.log('[InvestigationPanel] Unknown message type:', message.type);
        }
      },
      null,
      this.disposables
    );
  }

  private async sendFullState(): Promise<void> {
    try {
      const investigationManager = await getInvestigationManagerModule();
      const configManager = await getConfigManagerModule();

      // Ensure InvestigationManager is initialized with workspace
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        await investigationManager.initialize(workspaceFolder.uri.fsPath);
      } else {
        this.postMessage({
          type: "fullState",
          features: [],
          viewMode: "investigations",
          workflowMode: "auto",
        });
        return;
      }

      // Get workflow mode from config
      const config = await configManager.getConfig();
      const workflowMode = config?.workflow?.mode || 'auto';

      // Get all features
      const features = await investigationManager.getFeatures();

      this.postMessage({
        type: "fullState",
        features: features.map((f) => this.serializeFeature(f)),
        viewMode: this.getDefaultViewMode(workflowMode),
        workflowMode,
      });
    } catch (error) {
      console.error("[InvestigationPanel] Failed to send full state:", error);
      this.postMessage({
        type: "error",
        message: "Failed to load investigations",
      });
    }
  }

  private getDefaultViewMode(workflowMode: string): BrowserViewMode {
    switch (workflowMode) {
      case 'adr':
        return 'investigations';
      case 'spec-kit':
        return 'specs';
      case 'hybrid':
      case 'auto':
      default:
        return 'investigations';
    }
  }

  private async handleOpenItem(message: { filePath: string }): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(message.filePath);
      await vscode.window.showTextDocument(doc, {
        preview: false,
        preserveFocus: false,
      });
    } catch (error) {
      console.error("[InvestigationPanel] Failed to open item:", error);
      vscode.window.showErrorMessage(
        `Failed to open file: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  private async handleSplitIntoTasks(message: { itemId: string; filePath: string }): Promise<void> {
    console.log('[InvestigationPanel] handleSplitIntoTasks called with:', message);
    try {
      // Get orchestrator and send task to split this investigation/spec into tasks
      const { getOrchestrator } = await import("../extension");
      const orchestrator = getOrchestrator();

      console.log('[InvestigationPanel] Orchestrator available:', !!orchestrator);

      if (!orchestrator) {
        const errorMsg = "Orchestrator not available. Please ensure the multi-agent system is initialized.";
        console.error('[InvestigationPanel]', errorMsg);
        vscode.window.showErrorMessage(errorMsg);
        this.postMessage({
          type: "error",
          message: errorMsg,
        });
        return;
      }

      // Read the investigation/spec content
      console.log('[InvestigationPanel] Reading file:', message.filePath);
      const content = await vscode.workspace.fs.readFile(vscode.Uri.file(message.filePath));
      const contentStr = Buffer.from(content).toString('utf-8');

      // Extract feature name from path: .clautana/features/{featureName}/investigations/...
      // or .clautana/features/{featureName}/specs/...
      const pathParts = message.filePath.split(/[/\\]/);
      const featuresIndex = pathParts.findIndex(part => part === 'features');
      const featureName = featuresIndex >= 0 && featuresIndex + 1 < pathParts.length
        ? pathParts[featuresIndex + 1]
        : 'unknown';

      console.log('[InvestigationPanel] Sending task to orchestrator...');
      console.log('[InvestigationPanel] Feature name:', featureName);

      // Send a task to the orchestrator to split into tasks
      await orchestrator.handleUserTask(
        `Read the investigation/spec at ${message.filePath} and split it into actionable tasks on the Kanban board. Create work items for each task.

IMPORTANT: When creating work items, set the featureRef to "${featureName}" (NOT "investigations" or "specs" - use the parent feature name).

Content:
${contentStr}`
      );

      console.log('[InvestigationPanel] Task sent successfully');

      // Update the investigation status to "Planned"
      // Match both formats: "## Status: X" and "**Status:** X"
      let updatedContent = contentStr.replace(
        /\*\*Status:\*\*\s*(In Progress|Exploring|Viable)/i,
        '**Status:** Planned'
      );
      // Also try the heading format
      if (updatedContent === contentStr) {
        updatedContent = contentStr.replace(
          /##\s*Status:\s*(Exploring|Viable)/i,
          '## Status: Planned'
        );
      }
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(message.filePath),
        Buffer.from(updatedContent, 'utf-8')
      );

      vscode.window.showInformationMessage(
        `Splitting ${message.itemId} into tasks...`
      );

      // Refresh the browser to show updated status
      await this.sendFullState();
    } catch (error) {
      console.error("[InvestigationPanel] Failed to split into tasks:", error);
      vscode.window.showErrorMessage(
        `Failed to split into tasks: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      this.postMessage({
        type: "error",
        message: `Failed to split into tasks: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  private async handleAcceptToADR(message: { itemId: string; filePath: string; featureName: string }): Promise<void> {
    try {
      // Move the investigation to the ADR folder
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error("No workspace folder found");
      }

      const clautanaDir = vscode.Uri.joinPath(workspaceFolder.uri, '.clautana');
      const featureDir = vscode.Uri.joinPath(clautanaDir, 'features', message.featureName);
      const adrDir = vscode.Uri.joinPath(featureDir, 'adr');

      // Ensure ADR directory exists
      await vscode.workspace.fs.createDirectory(adrDir);

      // Get the filename
      const fileName = message.filePath.split(/[/\\]/).pop() || 'investigation.md';

      // New ADR path
      const newAdrPath = vscode.Uri.joinPath(adrDir, fileName);

      // Read current content
      const content = await vscode.workspace.fs.readFile(vscode.Uri.file(message.filePath));
      let contentStr = Buffer.from(content).toString('utf-8');

      // Update status to Accepted
      contentStr = contentStr.replace(
        /## Status: (Viable|Exploring)/,
        '## Status: Accepted'
      );

      // Add acceptance timestamp
      const timestamp = new Date().toISOString().split('T')[0];
      contentStr = contentStr.replace(
        /## Status: Accepted/,
        `## Status: Accepted\n\n**Accepted on:** ${timestamp}`
      );

      // Write to ADR location
      await vscode.workspace.fs.writeFile(newAdrPath, Buffer.from(contentStr, 'utf-8'));

      // Delete original investigation file
      await vscode.workspace.fs.delete(vscode.Uri.file(message.filePath));

      vscode.window.showInformationMessage(
        `Investigation accepted as ADR: ${fileName}`
      );

      // Refresh the browser
      await this.sendFullState();
    } catch (error) {
      console.error("[InvestigationPanel] Failed to accept to ADR:", error);
      this.postMessage({
        type: "error",
        message: `Failed to accept to ADR: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  private async handleChangeView(message: { viewMode: BrowserViewMode }): Promise<void> {
    // Just send acknowledgment - the frontend handles the view change
    this.postMessage({
      type: "viewChanged",
      viewMode: message.viewMode,
    });
  }

  private async handleCreateInvestigation(message: { featureName: string }): Promise<void> {
    console.log('[InvestigationPanel] handleCreateInvestigation called for feature:', message.featureName);
    try {
      // Prompt user for investigation topic
      const topic = await vscode.window.showInputBox({
        prompt: `Enter investigation topic for feature "${message.featureName}"`,
        placeHolder: 'e.g., redis-approach, websockets, oauth2-flow',
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Investigation topic is required';
          }
          return null;
        },
      });

      console.log('[InvestigationPanel] User entered topic:', topic);

      if (!topic) {
        console.log('[InvestigationPanel] User cancelled input');
        return; // User cancelled
      }

      // Get orchestrator and execute the /fn-investigation command
      console.log('[InvestigationPanel] Getting orchestrator...');
      const { getOrchestrator } = await import("../extension");
      const orchestrator = getOrchestrator();

      console.log('[InvestigationPanel] Orchestrator available:', !!orchestrator);

      if (!orchestrator) {
        const msg = 'Orchestrator not available. Make sure Clautana is initialized.';
        console.error('[InvestigationPanel]', msg);
        vscode.window.showErrorMessage(msg);
        return;
      }

      const command = `/fn-investigation ${message.featureName} ${topic}`;
      console.log('[InvestigationPanel] Executing slash command directly:', command);

      // Execute the slash command directly instead of going through chat
      const { executeAdrCommand } = await import('../workflows/AdrWorkflowHandlers');

      const result = await executeAdrCommand('fn-investigation', {
        args: [message.featureName, topic],
        argsRaw: `${message.featureName} ${topic}`,
        orchestrator: orchestrator,
        agentPool: (orchestrator as any).agentPool,
        extensionContext: this.context,
      });

      console.log('[InvestigationPanel] Command executed, result:', result);

      if (result.success) {
        vscode.window.showInformationMessage(result.message);
      } else {
        vscode.window.showErrorMessage(result.message);
      }
    } catch (error) {
      console.error("[InvestigationPanel] Failed to create investigation:", error);
      vscode.window.showErrorMessage(
        `Failed to create investigation: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Serialize a Feature for sending to the webview
   */
  private serializeFeature(feature: any): Record<string, unknown> {
    return {
      name: feature.name,
      path: feature.path,
      investigations: feature.investigations.map((i: Investigation) => this.serializeInvestigation(i)),
      specs: feature.specs.map((s: Spec) => this.serializeSpec(s)),
      adrs: feature.adrs.map((a: ADR) => this.serializeADR(a)),
      created: feature.created instanceof Date ? feature.created.toISOString() : feature.created,
      updated: feature.updated instanceof Date ? feature.updated.toISOString() : feature.updated,
    };
  }

  private serializeInvestigation(item: Investigation): Record<string, unknown> {
    return {
      id: item.id,
      featureName: item.featureName,
      topic: item.topic,
      title: item.title,
      status: item.status,
      filePath: item.filePath,
      created: item.created instanceof Date ? item.created.toISOString() : item.created,
      updated: item.updated instanceof Date ? item.updated.toISOString() : item.updated,
      summary: item.summary,
    };
  }

  private serializeSpec(item: Spec): Record<string, unknown> {
    return {
      id: item.id,
      featureName: item.featureName,
      title: item.title,
      status: item.status,
      filePath: item.filePath,
      created: item.created instanceof Date ? item.created.toISOString() : item.created,
      updated: item.updated instanceof Date ? item.updated.toISOString() : item.updated,
      summary: item.summary,
    };
  }

  private serializeADR(item: ADR): Record<string, unknown> {
    return {
      id: item.id,
      featureName: item.featureName,
      title: item.title,
      status: item.status,
      filePath: item.filePath,
      created: item.created instanceof Date ? item.created.toISOString() : item.created,
      updated: item.updated instanceof Date ? item.updated.toISOString() : item.updated,
      decision: item.decision,
    };
  }

  private postMessage(message: unknown): void {
    this.panel.webview.postMessage(message);
  }

  private getHtmlContent(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "assets", "investigation.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "assets", "investigation.css")
    );

    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};">
  <link href="${styleUri}" rel="stylesheet">
  <title>Investigation Browser</title>
  <style>
    body { padding: 0; margin: 0; }
    .investigation-app-container { height: 100vh; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    window.vscode = vscode;
  </script>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }

  private dispose(): void {
    InvestigationPanel.instance = undefined;
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
