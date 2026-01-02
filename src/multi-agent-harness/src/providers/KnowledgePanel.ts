import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";

interface Fact {
  id: string;
  category: string;
  statement: string;
  source?: string;
  createdAt: string;
  lastVerified: string;
  confidence: number;
}

interface SessionLog {
  id: string;
  startTime: string;
  endTime?: string;
  task: string;
  agents: string[];
  outcome: "success" | "partial" | "failure";
  summary?: string;
  filesChanged: string[];
  lessonsLearned?: string[];
}

interface Playbook {
  id: string;
  title: string;
  description: string;
  steps: string[];
  tags: string[];
  createdAt: string;
  lastUsed: string;
  useCount: number;
  confidence: number;
}

interface KnowledgeData {
  facts: Fact[];
  sessions: SessionLog[];
  playbooks: Playbook[];
}

/**
 * Full-tab WebviewPanel for the Knowledge Explorer
 */
export class KnowledgePanel {
  private static instance: KnowledgePanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private memoryPath: string | undefined;

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
          this.sendKnowledgeData();
        }
      },
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  /**
   * Create or show the Knowledge panel
   */
  static createOrShow(context: vscode.ExtensionContext): KnowledgePanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (KnowledgePanel.instance) {
      KnowledgePanel.instance.panel.reveal(column);
      return KnowledgePanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      "clautana.knowledgeExplorer",
      "Knowledge Explorer",
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

    KnowledgePanel.instance = new KnowledgePanel(panel, context);
    return KnowledgePanel.instance;
  }

  /**
   * Get the current instance if it exists
   */
  static getInstance(): KnowledgePanel | undefined {
    return KnowledgePanel.instance;
  }

  private setupMessageHandler(): void {
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case "getKnowledge":
            await this.sendKnowledgeData();
            break;
        }
      },
      null,
      this.disposables
    );
  }

  private async sendKnowledgeData(): Promise<void> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        this.postMessage({
          type: "knowledgeData",
          data: { facts: [], lessons: [], playbooks: [] },
        });
        return;
      }

      this.memoryPath = path.join(workspaceFolder.uri.fsPath, ".clautana", "memory");

      const data: KnowledgeData = {
        facts: await this.readJson<Fact[]>(path.join(this.memoryPath, "facts.json")) ?? [],
        sessions: await this.readJson<SessionLog[]>(path.join(this.memoryPath, "sessions.json")) ?? [],
        playbooks: await this.readJson<Playbook[]>(path.join(this.memoryPath, "playbooks.json")) ?? [],
      };

      this.postMessage({
        type: "knowledgeData",
        data,
      });
    } catch (error) {
      console.error("[KnowledgePanel] Failed to send knowledge data:", error);
      this.postMessage({
        type: "error",
        message: "Failed to load knowledge data",
      });
    }
  }

  /**
   * Read a JSON file and parse it
   */
  private async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content) as T;
    } catch (error) {
      // File might not exist yet - return null
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      console.error(`[KnowledgePanel] Error reading ${filePath}:`, error);
      return null;
    }
  }

  private postMessage(message: unknown): void {
    this.panel.webview.postMessage(message);
  }

  private getHtmlContent(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "assets", "knowledge.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "assets", "knowledge.css")
    );

    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};">
  <link href="${styleUri}" rel="stylesheet">
  <title>Knowledge Explorer</title>
  <style>
    body { padding: 0; margin: 0; }
    .knowledge-app-container { height: 100vh; }
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
    KnowledgePanel.instance = undefined;
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
