import * as vscode from "vscode";
import type { WorkItem, WorkItemStatus, TransientTodo } from "../kanban/types";

// Lazy import to avoid circular dependencies
async function getWorkItemManagerModule() {
  const kanbanModule = await import("../kanban");
  return kanbanModule.getWorkItemManager();
}

async function getTransientTodoManagerModule() {
  const kanbanModule = await import("../kanban");
  return kanbanModule.getTransientTodoManager();
}

/**
 * Full-tab WebviewPanel for the Kanban Board
 */
export class KanbanPanel {
  private static instance: KanbanPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtmlContent();
    this.setupEventListeners();
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
   * Create or show the Kanban panel
   */
  static createOrShow(context: vscode.ExtensionContext): KanbanPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (KanbanPanel.instance) {
      KanbanPanel.instance.panel.reveal(column);
      return KanbanPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      "clautana.kanbanBoard",
      "Clautana Kanban",
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

    KanbanPanel.instance = new KanbanPanel(panel, context);
    return KanbanPanel.instance;
  }

  /**
   * Get the current instance if it exists
   */
  static getInstance(): KanbanPanel | undefined {
    return KanbanPanel.instance;
  }

  private async setupEventListeners(): Promise<void> {
    try {
      const workItemManager = await getWorkItemManagerModule();

      // Use any type for handlers since EventEmitter uses generic types
      const itemCreatedHandler = (item: any) => {
        this.postMessage({
          type: "itemCreated",
          item: this.serializeWorkItem(item as WorkItem),
        });
      };
      workItemManager.on("itemCreated", itemCreatedHandler);
      this.disposables.push({
        dispose: () => workItemManager.off("itemCreated", itemCreatedHandler),
      });

      const itemMovedHandler = (item: any, oldStatus: any) => {
        this.postMessage({
          type: "itemMoved",
          item: this.serializeWorkItem(item as WorkItem),
          oldStatus,
        });
      };
      workItemManager.on("itemMoved", itemMovedHandler);
      this.disposables.push({
        dispose: () => workItemManager.off("itemMoved", itemMovedHandler),
      });

      const itemUpdatedHandler = (item: any) => {
        this.postMessage({
          type: "itemUpdated",
          item: this.serializeWorkItem(item as WorkItem),
        });
      };
      workItemManager.on("itemUpdated", itemUpdatedHandler);
      this.disposables.push({
        dispose: () => workItemManager.off("itemUpdated", itemUpdatedHandler),
      });

      const itemDeletedHandler = (itemId: any) => {
        this.postMessage({
          type: "itemDeleted",
          itemId: itemId as string,
        });
      };
      workItemManager.on("itemDeleted", itemDeletedHandler);
      this.disposables.push({
        dispose: () => workItemManager.off("itemDeleted", itemDeletedHandler),
      });

      const itemCancelledHandler = (item: any, reason: any) => {
        this.postMessage({
          type: "itemCancelled",
          item: this.serializeWorkItem(item as WorkItem),
          reason: reason as string,
        });
      };
      workItemManager.on("itemCancelled", itemCancelledHandler);
      this.disposables.push({
        dispose: () => workItemManager.off("itemCancelled", itemCancelledHandler),
      });
    } catch (error) {
      console.error("[KanbanPanel] Failed to setup work item event listeners:", error);
    }

    // Setup transient todo event listeners
    try {
      const transientTodoManager = await getTransientTodoManagerModule();

      const todoAddedHandler = (todo: any) => {
        this.postMessage({
          type: "transientTodoAdded",
          todo: this.serializeTransientTodo(todo as TransientTodo),
        });
      };
      transientTodoManager.on("todoAdded", todoAddedHandler);
      this.disposables.push({
        dispose: () => transientTodoManager.off("todoAdded", todoAddedHandler),
      });

      const todoUpdatedHandler = (todo: any) => {
        this.postMessage({
          type: "transientTodoUpdated",
          todo: this.serializeTransientTodo(todo as TransientTodo),
        });
      };
      transientTodoManager.on("todoUpdated", todoUpdatedHandler);
      this.disposables.push({
        dispose: () => transientTodoManager.off("todoUpdated", todoUpdatedHandler),
      });

      const todoRemovedHandler = (todoId: any) => {
        this.postMessage({
          type: "transientTodoRemoved",
          todoId: todoId as string,
        });
      };
      transientTodoManager.on("todoRemoved", todoRemovedHandler);
      this.disposables.push({
        dispose: () => transientTodoManager.off("todoRemoved", todoRemovedHandler),
      });
    } catch (error) {
      console.error("[KanbanPanel] Failed to setup transient todo event listeners:", error);
    }
  }

  private setupMessageHandler(): void {
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case "getState":
            await this.sendFullState();
            break;
          case "moveItem":
            await this.handleMoveItem(message);
            break;
          case "openItem":
            await this.handleOpenItem(message);
            break;
          case "cancelItem":
            await this.handleCancelItem(message);
            break;
          case "deleteItem":
            await this.handleDeleteItem(message);
            break;
          case "archiveItem":
            await this.handleArchiveItem(message);
            break;
          case "createItem":
            await this.handleCreateItem(message);
            break;
          case "assignItem":
            await this.handleAssignItem(message);
            break;
        }
      },
      null,
      this.disposables
    );
  }

  private async sendFullState(): Promise<void> {
    try {
      const workItemManager = await getWorkItemManagerModule();
      const transientTodoManager = await getTransientTodoManagerModule();

      // Ensure WorkItemManager is initialized with workspace
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        await workItemManager.initialize(workspaceFolder.uri.fsPath);
      } else {
        this.postMessage({
          type: "fullState",
          items: [],
          transientTodos: [],
        });
        return;
      }

      const items = await workItemManager.listItems();
      const transientTodos = transientTodoManager.getAllTodos();

      this.postMessage({
        type: "fullState",
        items: items.map((item: WorkItem) => this.serializeWorkItem(item)),
        transientTodos: transientTodos.map((todo: TransientTodo) => this.serializeTransientTodo(todo)),
      });
    } catch (error) {
      console.error("[KanbanPanel] Failed to send full state:", error);
      this.postMessage({
        type: "error",
        message: "Failed to load work items",
      });
    }
  }

  private async handleMoveItem(message: {
    itemId: string;
    newStatus: WorkItemStatus;
  }): Promise<void> {
    try {
      const workItemManager = await getWorkItemManagerModule();
      await workItemManager.moveItem(message.itemId, message.newStatus);
    } catch (error) {
      console.error("[KanbanPanel] Failed to move item:", error);
      this.postMessage({
        type: "error",
        message: `Failed to move item: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
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
      console.error("[KanbanPanel] Failed to open item:", error);
      vscode.window.showErrorMessage(
        `Failed to open file: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  private async handleCancelItem(message: {
    itemId: string;
    reason: string;
  }): Promise<void> {
    try {
      const workItemManager = await getWorkItemManagerModule();
      await workItemManager.cancelItem(message.itemId, message.reason);
    } catch (error) {
      console.error("[KanbanPanel] Failed to cancel item:", error);
      this.postMessage({
        type: "error",
        message: `Failed to cancel item: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  private async handleDeleteItem(message: { itemId: string }): Promise<void> {
    try {
      const workItemManager = await getWorkItemManagerModule();
      await workItemManager.deleteItem(message.itemId);
    } catch (error) {
      console.error("[KanbanPanel] Failed to delete item:", error);
      this.postMessage({
        type: "error",
        message: `Failed to delete item: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  private async handleArchiveItem(message: { itemId: string }): Promise<void> {
    try {
      const workItemManager = await getWorkItemManagerModule();
      // Archive by deleting the item from the board
      // In the future, this could be enhanced to move items to a separate archive location
      await workItemManager.deleteItem(message.itemId);

      this.postMessage({
        type: "itemArchived",
        itemId: message.itemId,
      });
    } catch (error) {
      console.error("[KanbanPanel] Failed to archive item:", error);
      this.postMessage({
        type: "error",
        message: `Failed to archive item: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  private async handleCreateItem(message: {
    title: string;
    description: string;
    priority?: "critical" | "high" | "medium" | "low";
    tags?: string[];
    estimatedHours?: number;
  }): Promise<void> {
    try {
      const workItemManager = await getWorkItemManagerModule();
      await workItemManager.createItem({
        title: message.title,
        description: message.description,
        priority: message.priority,
        tags: message.tags,
        estimatedHours: message.estimatedHours,
      });
    } catch (error) {
      console.error("[KanbanPanel] Failed to create item:", error);
      this.postMessage({
        type: "error",
        message: `Failed to create item: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  private async handleAssignItem(message: { itemId: string }): Promise<void> {
    try {
      // Get orchestrator and send task to assign this work item
      const { getOrchestrator } = await import("../extension");
      const orchestrator = getOrchestrator();

      if (!orchestrator) {
        this.postMessage({
          type: "error",
          message: "Orchestrator not available. Please ensure the multi-agent system is initialized.",
        });
        return;
      }

      // Send a task to the orchestrator to assign and work on this item
      await orchestrator.handleUserTask(
        `Assign work item ${message.itemId} to an appropriate agent and begin working on it.`
      );

      vscode.window.showInformationMessage(
        `Work item ${message.itemId} has been assigned to the orchestrator.`
      );
    } catch (error) {
      console.error("[KanbanPanel] Failed to assign item:", error);
      this.postMessage({
        type: "error",
        message: `Failed to assign item: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  /**
   * Serialize a WorkItem for sending to the webview
   * Converts Date objects to ISO strings
   */
  private serializeWorkItem(item: WorkItem): Record<string, unknown> {
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      priority: item.priority,
      status: item.status,
      assignee: item.assignee,
      reviewer: item.reviewer,
      tags: item.tags,
      created: item.created instanceof Date ? item.created.toISOString() : item.created,
      started: item.started instanceof Date ? item.started.toISOString() : item.started,
      completed: item.completed instanceof Date ? item.completed.toISOString() : item.completed,
      estimatedHours: item.estimatedHours,
      filePath: item.filePath,
    };
  }

  /**
   * Serialize a TransientTodo for sending to the webview
   * Converts Date objects to ISO strings
   */
  private serializeTransientTodo(todo: TransientTodo): Record<string, unknown> {
    return {
      id: todo.id,
      content: todo.content,
      activeForm: todo.activeForm,
      status: todo.status,
      agentName: todo.agentName,
      createdAt: todo.createdAt instanceof Date ? todo.createdAt.toISOString() : todo.createdAt,
      completedAt: todo.completedAt instanceof Date ? todo.completedAt.toISOString() : todo.completedAt,
    };
  }

  private postMessage(message: unknown): void {
    this.panel.webview.postMessage(message);
  }

  private getHtmlContent(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "assets", "kanban.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "assets", "kanban.css")
    );

    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};">
  <link href="${styleUri}" rel="stylesheet">
  <title>Clautana Kanban</title>
  <style>
    body { padding: 0; margin: 0; }
    .kanban-app-container { height: 100vh; }
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
    KanbanPanel.instance = undefined;
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
