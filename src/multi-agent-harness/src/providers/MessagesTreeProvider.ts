import * as vscode from "vscode";
import { AgentPool } from "../coordinator/AgentPool";
import { AgentMessage } from "../coordinator/types";
import { globalMessageStore } from "../mcp/MailMcpServer";

/**
 * Folder tree item for Inbox/Archive
 */
class FolderTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly folderType: "inbox" | "archive"
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "folder";
    this.iconPath = new vscode.ThemeIcon(
      folderType === "inbox" ? "inbox" : "archive"
    );
  }
}

/**
 * Tree item representing an agent message
 */
class MessageTreeItem extends vscode.TreeItem {
  constructor(public readonly message: AgentMessage) {
    super(message.subject, vscode.TreeItemCollapsibleState.None);

    this.description = this.buildDescription();
    this.tooltip = this.buildTooltip();
    this.iconPath = this.getMessageIcon();
    this.contextValue = message.archived ? "archivedMessage" : "message";

    // Double-click opens the message file
    this.command = {
      command: "clautana.viewMessage",
      title: "View Message",
      arguments: [this],
    };
  }

  private buildDescription(): string {
    const time = this.getRelativeTime(this.message.timestamp);
    return `${this.message.from} → ${this.message.to} • ${time}`;
  }

  private buildTooltip(): string {
    const lines = [
      `From: ${this.message.from}`,
      `To: ${this.message.to}`,
      `Subject: ${this.message.subject}`,
      `Time: ${this.message.timestamp.toLocaleString()}`,
      `Status: ${this.message.read ? "Read" : "Unread"}`,
    ];

    if (this.message.body) {
      lines.push("");
      lines.push("Body:");
      lines.push(this.message.body);
    }

    return lines.join("\n");
  }

  private getMessageIcon(): vscode.ThemeIcon {
    if (this.message.read) {
      // Use check icon for read messages
      return new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.green"));
    } else {
      // Use mail icon for unread messages
      return new vscode.ThemeIcon("mail", new vscode.ThemeColor("charts.blue"));
    }
  }

  private getRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) {
      return "just now";
    } else if (diffMin < 60) {
      return `${diffMin}m ago`;
    } else if (diffMin < 1440) {
      const diffHr = Math.floor(diffMin / 60);
      return `${diffHr}h ago`;
    } else {
      const diffDay = Math.floor(diffMin / 1440);
      return `${diffDay}d ago`;
    }
  }
}

/**
 * Tree data provider for the agent messages sidebar view
 *
 * Shows messages between agents organized into Inbox and Archive folders.
 * Updates automatically when new messages are received.
 */
export class MessagesTreeProvider implements vscode.TreeDataProvider<FolderTreeItem | MessageTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    FolderTreeItem | MessageTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private messages: AgentMessage[] = [];

  constructor(private readonly agentPool: AgentPool) {
    // Listen to message events from agent pool
    this.agentPool.on("messageReceived", (message: AgentMessage) => {
      this.addMessage(message);
    });

    // Also listen to global message store (for MCP tool-based messages)
    globalMessageStore.on("messageReceived", (message: AgentMessage) => {
      this.addMessage(message);
    });

    // Listen to archive/unarchive events
    globalMessageStore.on("messageArchived", () => {
      this.refresh();
    });

    globalMessageStore.on("messageUnarchived", () => {
      this.refresh();
    });

    // Load existing messages from disk on startup
    this.loadExistingMessages();
  }

  /**
   * Load existing inbox messages from the global message store
   * (Archived messages are not loaded - they're kept for future vector search indexing)
   */
  private async loadExistingMessages(): Promise<void> {
    try {
      await globalMessageStore.initialize();
      const allMessages = await globalMessageStore.getAllMessages();
      // Only load non-archived messages
      this.messages = allMessages.filter(m => !m.archived);
      this.refresh();
    } catch (error) {
      // Silently ignore errors (e.g., if .clautana folder doesn't exist yet)
      console.log("Failed to load existing messages:", error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Add a message to the list (avoiding duplicates)
   */
  private addMessage(message: AgentMessage): void {
    // Check for duplicates by ID
    if (!this.messages.some(m => m.id === message.id)) {
      this.messages.unshift(message); // Add to beginning for newest-first
      this.refresh();
    }
  }

  /**
   * Mark a message as read
   */
  markAsRead(messageId: string): void {
    const message = this.messages.find((m) => m.id === messageId);
    if (message && !message.read) {
      // Create a new message object with read = true
      const index = this.messages.indexOf(message);
      this.messages[index] = { ...message, read: true };
      this.refresh();
    }
  }

  /**
   * Clear all messages
   */
  clearMessages(): void {
    this.messages = [];
    this.refresh();
  }

  /**
   * Refresh the tree view
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FolderTreeItem | MessageTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: FolderTreeItem | MessageTreeItem): Thenable<(FolderTreeItem | MessageTreeItem)[]> {
    if (!element) {
      // Root level: show only Inbox (archived messages are kept on disk for vector search)
      const inboxCount = this.messages.length;
      const inboxLabel = `Inbox${inboxCount > 0 ? ` (${inboxCount})` : ""}`;

      return Promise.resolve([
        new FolderTreeItem(inboxLabel, "inbox"),
      ]);
    }

    if (element instanceof FolderTreeItem) {
      // Show messages in inbox
      const items = this.messages.map((msg) => new MessageTreeItem(msg));
      return Promise.resolve(items);
    }

    // MessageTreeItem has no children
    return Promise.resolve([]);
  }

  /**
   * Get all messages
   */
  getAllMessages(): readonly AgentMessage[] {
    return this.messages;
  }

  /**
   * Get unread message count
   */
  getUnreadCount(): number {
    return this.messages.filter((m) => !m.read).length;
  }

  /**
   * Archive a message
   */
  async archiveMessage(messageId: string): Promise<void> {
    const success = await globalMessageStore.archiveMessage(messageId);
    if (success) {
      // Reload messages from store to get updated state
      await this.reloadMessagesFromStore();
      this.refresh();
    }
  }

  /**
   * Unarchive a message
   */
  async unarchiveMessage(messageId: string): Promise<void> {
    const success = await globalMessageStore.unarchiveMessage(messageId);
    if (success) {
      // Reload messages from store to get updated state
      await this.reloadMessagesFromStore();
      this.refresh();
    }
  }

  /**
   * Reload inbox messages from the global store
   * (Archived messages are not loaded - they're kept for future vector search indexing)
   */
  private async reloadMessagesFromStore(): Promise<void> {
    const allMessages = await globalMessageStore.getAllMessages();
    this.messages = allMessages.filter(m => !m.archived);
  }
}
