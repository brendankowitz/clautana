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
          case "changeItemStatus":
            await this.handleChangeItemStatus(message);
            break;
          case "archiveInvestigation":
            await this.handleArchiveInvestigation(message);
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

      // Get task description format from VS Code settings
      const descriptionFormat = vscode.workspace.getConfiguration('clautana.workflow').get<string>('taskDescriptionFormat') || 'plain';

      // Extract feature name from path: .clautana/features/{featureName}/investigations/...
      // or .clautana/features/{featureName}/specs/...
      const pathParts = message.filePath.split(/[/\\]/);
      const featuresIndex = pathParts.findIndex(part => part === 'features');
      const featureName = featuresIndex >= 0 && featuresIndex + 1 < pathParts.length
        ? pathParts[featuresIndex + 1]
        : 'unknown';

      console.log('[InvestigationPanel] Sending task to orchestrator...');
      console.log('[InvestigationPanel] Feature name:', featureName);
      console.log('[InvestigationPanel] File path:', message.filePath);
      console.log('[InvestigationPanel] Description format:', descriptionFormat);

      // Build description format instruction based on config
      const descriptionFormatInstruction = descriptionFormat === 'user-story'
        ? `- Write each task description in USER STORY format: "As a [user/role], I want [feature/action] so that [benefit/reason]." Example: "As a user, I want a login button so that I can access my account."`
        : `- Write each task description in plain text format, clearly describing what needs to be done.`;

      // Send a task to the orchestrator with just a file reference (let the agent read it)
      await orchestrator.handleUserTask(
        `Read the investigation/spec file at "${message.filePath}" and split it into actionable tasks on the Kanban board. Create work items for each task.

IMPORTANT:
- When creating work items, set the featureRef to "${featureName}" (NOT "investigations" or "specs" - use the parent feature name).
- Estimate time in "agent hours" - this represents how long an AI agent would take to complete the task, not human hours. Agent hours are typically much shorter than human hours for coding tasks.
${descriptionFormatInstruction}
- For EACH task, you MUST fill in the acceptanceCriteria field with specific, testable criteria that define when the task is complete. Use bullet points for multiple criteria.
- Acceptance criteria should be concrete and verifiable (e.g., "Unit tests pass", "API returns 200 status", "UI displays error message on invalid input").`
      );

      console.log('[InvestigationPanel] Task sent successfully');

      // Add a Tasks field to indicate tasks have been created
      const content = await vscode.workspace.fs.readFile(vscode.Uri.file(message.filePath));
      const contentStr = Buffer.from(content).toString('utf-8');

      // Format today's date as YYYY-MM-DD
      const today = new Date().toISOString().split('T')[0];

      // Check if Tasks field already exists
      if (!contentStr.includes('**Tasks:**')) {
        // Insert Tasks field after Status line
        let updatedContent = contentStr.replace(
          /(\*\*Status:\*\*\s*[^\n]+)/i,
          `$1\n**Tasks:** Created (${today})`
        );

        // If no match with bold format, try heading format
        if (updatedContent === contentStr) {
          updatedContent = contentStr.replace(
            /(##\s*Status:\s*[^\n]+)/i,
            `$1\n**Tasks:** Created (${today})`
          );
        }

        if (updatedContent !== contentStr) {
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(message.filePath),
            Buffer.from(updatedContent, 'utf-8')
          );
        }
      }

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
    console.log('[InvestigationPanel] handleAcceptToADR called with:', message);
    try {
      // Get orchestrator to create a proper ADR from the investigation
      const { getOrchestrator } = await import("../extension");
      const orchestrator = getOrchestrator();

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

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error("No workspace folder found");
      }

      // Determine the ADR output path
      const clautanaDir = vscode.Uri.joinPath(workspaceFolder.uri, '.clautana');
      const featureDir = vscode.Uri.joinPath(clautanaDir, 'features', message.featureName);
      const adrDir = vscode.Uri.joinPath(featureDir, 'adr');

      // Get the filename base for the ADR
      const investigationFileName = message.filePath.split(/[/\\]/).pop() || 'investigation.md';
      const adrFileName = investigationFileName.replace(/^investigation-/, 'adr-');

      console.log('[InvestigationPanel] Sending task to orchestrator to create ADR...');
      console.log('[InvestigationPanel] Feature:', message.featureName);
      console.log('[InvestigationPanel] Investigation file:', message.filePath);
      console.log('[InvestigationPanel] ADR directory:', adrDir.fsPath);

      // Send task to orchestrator to create a proper ADR
      await orchestrator.handleUserTask(
        `Promote the investigation at "${message.filePath}" to an Architecture Decision Record (ADR).

INSTRUCTIONS:
1. Read the investigation file to understand the context, findings, and recommendations
2. Create a new ADR file at "${adrDir.fsPath}/${adrFileName}" using the standard ADR template format:
   - Title: Clear decision title
   - Status: Accepted
   - Context: Summarize the problem/situation from the investigation
   - Decision: State the architectural decision clearly and concisely
   - Consequences: List the positive and negative outcomes of this decision
   - References: Link back to the original investigation file for detailed analysis

3. The ADR should be at a higher level than the investigation - focus on the DECISION and its implications, not all the research details
4. After creating the ADR, update the original investigation file's status to "Accepted" and add a reference to the new ADR

Feature: ${message.featureName}
Investigation ID: ${message.itemId}`
      );

      vscode.window.showInformationMessage(
        `Promoting investigation to ADR...`
      );

      // Refresh the browser after a short delay to allow the orchestrator to work
      setTimeout(() => this.sendFullState(), 2000);
    } catch (error) {
      console.error("[InvestigationPanel] Failed to accept to ADR:", error);
      vscode.window.showErrorMessage(
        `Failed to promote to ADR: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      this.postMessage({
        type: "error",
        message: `Failed to promote to ADR: ${error instanceof Error ? error.message : "Unknown error"}`,
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

  private async handleChangeItemStatus(message: { itemId: string; newStatus: string }): Promise<void> {
    console.log('[InvestigationPanel] handleChangeItemStatus:', message);
    try {
      // Read the investigation file
      // The itemId format is like "investigation-{featureName}-{topic}"
      // We need to find the file and update its status in the frontmatter/content

      const investigationManager = await getInvestigationManagerModule();
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error("No workspace folder found");
      }

      await investigationManager.initialize(workspaceFolder.uri.fsPath);

      // Find the investigation by ID
      const features = await investigationManager.getFeatures();
      let targetInvestigation: any = null;

      for (const feature of features) {
        const found = feature.investigations.find((inv: any) => inv.id === message.itemId);
        if (found) {
          targetInvestigation = found;
          break;
        }
      }

      if (!targetInvestigation) {
        throw new Error(`Investigation not found: ${message.itemId}`);
      }

      // Read the file content
      const content = await vscode.workspace.fs.readFile(vscode.Uri.file(targetInvestigation.filePath));
      let contentStr = Buffer.from(content).toString('utf-8');

      // Update the status in the file content
      // Match various status formats with any status value:
      // - "**Status:** X" or "**Status**: X" (bold with colon variations)
      // - "## Status: X" (heading format)
      // - "Status: X" with optional emoji prefix like "Status: ✅ Viable"
      const statusRegex1 = /\*\*Status:\*\*\s*[^\n]+/i;
      const statusRegex2 = /\*\*Status\*\*:\s*[^\n]+/i;
      const statusRegex3 = /##\s*Status:\s*[^\n]+/i;
      const statusRegex4 = /(?<![#*])Status:\s*(?:[✅📋❌🔍]?\s*)?[^\n]+/i;

      // Capitalize first letter of new status
      const newStatusCapitalized = message.newStatus.charAt(0).toUpperCase() + message.newStatus.slice(1);

      let updated = false;
      if (statusRegex1.test(contentStr)) {
        contentStr = contentStr.replace(statusRegex1, `**Status:** ${newStatusCapitalized}`);
        updated = true;
      } else if (statusRegex2.test(contentStr)) {
        contentStr = contentStr.replace(statusRegex2, `**Status**: ${newStatusCapitalized}`);
        updated = true;
      } else if (statusRegex3.test(contentStr)) {
        contentStr = contentStr.replace(statusRegex3, `## Status: ${newStatusCapitalized}`);
        updated = true;
      } else if (statusRegex4.test(contentStr)) {
        contentStr = contentStr.replace(statusRegex4, `Status: ${newStatusCapitalized}`);
        updated = true;
      }

      if (!updated) {
        throw new Error("Could not find status field in investigation file");
      }

      // Write the updated content back
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(targetInvestigation.filePath),
        Buffer.from(contentStr, 'utf-8')
      );

      vscode.window.showInformationMessage(
        `Investigation status changed to ${newStatusCapitalized}`
      );

      // Refresh the browser to show updated status
      await this.sendFullState();
    } catch (error) {
      console.error("[InvestigationPanel] Failed to change item status:", error);
      vscode.window.showErrorMessage(
        `Failed to change status: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      this.postMessage({
        type: "error",
        message: `Failed to change status: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  private async handleArchiveInvestigation(message: { itemId: string; filePath: string }): Promise<void> {
    console.log('[InvestigationPanel] handleArchiveInvestigation:', message);
    try {
      const filePath = message.filePath;
      const fileUri = vscode.Uri.file(filePath);

      // Create archived folder path
      const pathParts = filePath.split(/[/\\]/);
      const fileName = pathParts.pop()!;
      const parentDir = pathParts.join('/');
      const archivedDir = `${parentDir}/archived`;
      const archivedPath = `${archivedDir}/${fileName}`;

      // Ensure archived directory exists
      const archivedUri = vscode.Uri.file(archivedDir);
      try {
        await vscode.workspace.fs.stat(archivedUri);
      } catch {
        await vscode.workspace.fs.createDirectory(archivedUri);
      }

      // Move file to archived folder
      const destinationUri = vscode.Uri.file(archivedPath);
      await vscode.workspace.fs.rename(fileUri, destinationUri, { overwrite: false });

      vscode.window.showInformationMessage(
        `Investigation archived: ${message.itemId}`
      );

      // Refresh the browser to remove the item
      await this.sendFullState();
    } catch (error) {
      console.error("[InvestigationPanel] Failed to archive investigation:", error);
      vscode.window.showErrorMessage(
        `Failed to archive: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      this.postMessage({
        type: "error",
        message: `Failed to archive: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
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
