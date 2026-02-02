import { EventEmitter } from "events";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { AgentMessage } from "../coordinator/types";
import { getConfigManager } from "../clautana/ConfigManager";

/**
 * File-backed message store for inter-agent communication.
 *
 * Messages are stored as markdown files with YAML frontmatter in:
 * .clautana/messages/inbox/{message-id}.md
 * .clautana/messages/archive/{message-id}.md
 *
 * This allows agents to:
 * - Use MCP tools for messaging
 * - Directly read/write message files
 * - Human-readable message format
 *
 * Message file format:
 * ```
 * ---
 * id: uuid
 * from: agent-name
 * to: recipient-name
 * subject: Message subject
 * timestamp: ISO date
 * read: false
 * archived: false
 * ---
 *
 * Message body content here...
 * ```
 */
class FileBackedMessageStore extends EventEmitter {
  private messagesDir: string | null = null;
  private inboxDir: string | null = null;
  private archiveDir: string | null = null;
  private cache: Map<string, AgentMessage> = new Map();
  private initialized = false;
  private initializing = false;

  /**
   * Get the messages directory path
   */
  private getMessagesDir(): string {
    if (!this.messagesDir) {
      const configManager = getConfigManager();
      if (!configManager) {
        throw new Error("ConfigManager not initialized");
      }
      this.messagesDir = path.join(configManager.getClautanaPath(), "messages");
    }
    return this.messagesDir;
  }

  /**
   * Get the inbox directory path
   */
  private getInboxDir(): string {
    if (!this.inboxDir) {
      this.inboxDir = path.join(this.getMessagesDir(), "inbox");
    }
    return this.inboxDir;
  }

  /**
   * Get the archive directory path
   */
  private getArchiveDir(): string {
    if (!this.archiveDir) {
      this.archiveDir = path.join(this.getMessagesDir(), "archive");
    }
    return this.archiveDir;
  }

  /**
   * Initialize the messages directory
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) {
      // Wait for existing initialization to complete
      while (this.initializing) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return;
    }

    this.initializing = true;
    try {
      const dir = this.getMessagesDir();
      const inboxDir = this.getInboxDir();
      const archiveDir = this.getArchiveDir();

      // Create main messages directory
      await fs.mkdir(dir, { recursive: true }).catch((err) => {
        if (err.code !== "EEXIST") {
          throw err;
        }
      });

      // Create inbox and archive subdirectories
      await fs.mkdir(inboxDir, { recursive: true }).catch((err) => {
        if (err.code !== "EEXIST") {
          throw err;
        }
      });
      await fs.mkdir(archiveDir, { recursive: true }).catch((err) => {
        if (err.code !== "EEXIST") {
          throw err;
        }
      });

      // Migrate existing messages from root to inbox
      await this.migrateExistingMessages();

      // Load existing messages into cache
      await this.loadMessages();
      this.initialized = true;
    } catch (error) {
      this.initializing = false;
      throw new Error(`Failed to initialize message store: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.initializing = false;
    }
  }

  /**
   * Migrate existing messages from root messages directory to inbox
   */
  private async migrateExistingMessages(): Promise<void> {
    const dir = this.getMessagesDir();
    const inboxDir = this.getInboxDir();

    try {
      const files = await fs.readdir(dir);

      for (const file of files) {
        if (!file.endsWith(".md")) continue;

        try {
          const oldPath = path.join(dir, file);
          const newPath = path.join(inboxDir, file);

          // Move file to inbox if it exists in root
          await fs.rename(oldPath, newPath);
          console.log(`Migrated message ${file} to inbox`);
        } catch (err) {
          // Ignore errors - file might already be moved or doesn't exist
        }
      }
    } catch {
      // Directory doesn't exist yet or is empty
    }
  }

  /**
   * Load all messages from disk into cache
   */
  private async loadMessages(): Promise<void> {
    this.cache.clear();

    // Load from inbox
    await this.loadMessagesFromDir(this.getInboxDir(), false);

    // Load from archive
    await this.loadMessagesFromDir(this.getArchiveDir(), true);
  }

  /**
   * Load messages from a specific directory
   */
  private async loadMessagesFromDir(dir: string, archived: boolean): Promise<void> {
    try {
      const files = await fs.readdir(dir);

      for (const file of files) {
        if (!file.endsWith(".md")) continue;

        try {
          const content = await fs.readFile(path.join(dir, file), "utf-8");
          const message = this.parseMessageFile(content, file.replace(".md", ""));
          if (message) {
            message.archived = archived;
            this.cache.set(message.id, message);
          }
        } catch (err) {
          console.warn(`Failed to load message ${file} from ${dir}:`, err);
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
  }

  /**
   * Parse a message file content into an AgentMessage
   */
  private parseMessageFile(content: string, fallbackId: string): AgentMessage | null {
    try {
      // Parse YAML frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (!frontmatterMatch) {
        console.warn(`Invalid message file format for ${fallbackId}: missing frontmatter`);
        return null;
      }

      const [, frontmatter, body] = frontmatterMatch;

      // Parse YAML manually (simple key: value pairs)
      const meta: Record<string, string> = {};
      for (const line of frontmatter.split("\n")) {
        const match = line.match(/^(\w+):\s*(.*)$/);
        if (match) {
          meta[match[1]] = match[2].trim();
        }
      }

      if (!meta.from || !meta.to || !meta.subject) {
        console.warn(`Invalid message file for ${fallbackId}: missing required fields`);
        return null;
      }

      return {
        id: meta.id || fallbackId,
        from: meta.from,
        to: meta.to,
        subject: meta.subject,
        body: body.trim() || undefined,
        timestamp: meta.timestamp ? new Date(meta.timestamp) : new Date(),
        read: meta.read === "true",
        archived: meta.archived === "true",
      };
    } catch (error) {
      console.error(`Failed to parse message file ${fallbackId}:`, error);
      return null;
    }
  }

  /**
   * Serialize a message to markdown with YAML frontmatter
   */
  private serializeMessage(message: AgentMessage): string {
    // Escape YAML special characters in values
    const escapeYaml = (str: string): string => {
      if (str.includes(":") || str.includes("#") || str.includes("\n")) {
        return `"${str.replace(/"/g, '\\"')}"`;
      }
      return str;
    };

    const frontmatter = [
      "---",
      `id: ${message.id}`,
      `from: ${escapeYaml(message.from)}`,
      `to: ${escapeYaml(message.to)}`,
      `subject: ${escapeYaml(message.subject)}`,
      `timestamp: ${message.timestamp.toISOString()}`,
      `read: ${message.read}`,
      `archived: ${message.archived ?? false}`,
      "---",
    ].join("\n");

    return message.body
      ? `${frontmatter}\n\n${message.body}\n`
      : `${frontmatter}\n`;
  }

  /**
   * Save a message to disk
   */
  private async saveMessage(message: AgentMessage): Promise<void> {
    await this.initialize();

    try {
      const targetDir = message.archived ? this.getArchiveDir() : this.getInboxDir();
      const filePath = path.join(targetDir, `${message.id}.md`);
      const content = this.serializeMessage(message);
      await fs.writeFile(filePath, content, "utf-8");
    } catch (error) {
      throw new Error(`Failed to save message ${message.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Delete a message file from both inbox and archive
   */
  private async deleteMessageFile(messageId: string): Promise<void> {
    const inboxPath = path.join(this.getInboxDir(), `${messageId}.md`);
    const archivePath = path.join(this.getArchiveDir(), `${messageId}.md`);

    // Try to delete from both locations
    for (const filePath of [inboxPath, archivePath]) {
      try {
        await fs.unlink(filePath);
      } catch (error: any) {
        // File might not exist - only ignore ENOENT errors
        if (error.code !== "ENOENT") {
          console.warn(`Failed to delete message file ${messageId}:`, error);
        }
      }
    }
  }

  /**
   * Store a new message
   */
  async addMessage(message: AgentMessage): Promise<void> {
    await this.initialize();

    this.cache.set(message.id, message);
    await this.saveMessage(message);
    this.emit("messageReceived", message);

    // Emit messageArrived event for orchestrator notification
    this.emit("messageArrived", {
      recipient: message.to,
      sender: message.from,
      subject: message.subject,
      messageId: message.id,
    });
  }

  /**
   * Get all messages for an agent (non-archived only)
   */
  async getInbox(agentName: string): Promise<AgentMessage[]> {
    await this.initialize();

    const messages: AgentMessage[] = [];
    for (const message of this.cache.values()) {
      if (message.to === agentName && !message.archived) {
        messages.push(message);
      }
    }
    return messages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get archived messages for an agent
   */
  async getArchived(agentName: string): Promise<AgentMessage[]> {
    await this.initialize();

    const messages: AgentMessage[] = [];
    for (const message of this.cache.values()) {
      if (message.to === agentName && message.archived) {
        messages.push(message);
      }
    }
    return messages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get unread messages for an agent
   */
  async getUnread(agentName: string): Promise<AgentMessage[]> {
    const inbox = await this.getInbox(agentName);
    return inbox.filter((m) => !m.read);
  }

  /**
   * Get sent messages from an agent
   */
  async getSent(agentName: string): Promise<AgentMessage[]> {
    await this.initialize();

    const messages: AgentMessage[] = [];
    for (const message of this.cache.values()) {
      if (message.from === agentName) {
        messages.push(message);
      }
    }
    return messages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Mark a message as read
   */
  async markRead(messageId: string): Promise<boolean> {
    await this.initialize();

    const message = this.cache.get(messageId);
    if (message) {
      message.read = true;
      await this.saveMessage(message);
      return true;
    }
    return false;
  }

  /**
   * Archive a message (moves it from inbox to archive)
   */
  async archiveMessage(messageId: string): Promise<boolean> {
    await this.initialize();

    const message = this.cache.get(messageId);
    if (message && !message.archived) {
      // Delete from inbox
      const inboxPath = path.join(this.getInboxDir(), `${messageId}.md`);
      try {
        await fs.unlink(inboxPath);
      } catch (error: any) {
        if (error.code !== "ENOENT") {
          console.warn(`Failed to delete from inbox: ${error}`);
        }
      }

      // Update message state and save to archive
      message.archived = true;
      message.read = true; // Auto-mark as read when archiving
      await this.saveMessage(message);

      this.emit("messageArchived", message);
      return true;
    }
    return false;
  }

  /**
   * Unarchive a message (moves it from archive to inbox)
   */
  async unarchiveMessage(messageId: string): Promise<boolean> {
    await this.initialize();

    const message = this.cache.get(messageId);
    if (message && message.archived) {
      // Delete from archive
      const archivePath = path.join(this.getArchiveDir(), `${messageId}.md`);
      try {
        await fs.unlink(archivePath);
      } catch (error: any) {
        if (error.code !== "ENOENT") {
          console.warn(`Failed to delete from archive: ${error}`);
        }
      }

      // Update message state and save to inbox
      message.archived = false;
      await this.saveMessage(message);

      this.emit("messageUnarchived", message);
      return true;
    }
    return false;
  }

  /**
   * Delete a message
   */
  async deleteMessage(messageId: string): Promise<boolean> {
    await this.initialize();

    if (this.cache.has(messageId)) {
      this.cache.delete(messageId);
      await this.deleteMessageFile(messageId);
      return true;
    }
    return false;
  }

  /**
   * Clear all messages for an agent
   */
  async clearInbox(agentName: string): Promise<void> {
    await this.initialize();

    const toDelete: string[] = [];
    for (const [id, message] of this.cache.entries()) {
      if (message.to === agentName) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.cache.delete(id);
      await this.deleteMessageFile(id);
    }
  }

  /**
   * Get all messages (for debugging/admin)
   */
  async getAllMessages(): Promise<AgentMessage[]> {
    await this.initialize();

    return Array.from(this.cache.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Reload messages from disk (useful if files were modified externally)
   */
  async reload(): Promise<void> {
    this.cache.clear();
    this.initialized = false;
    await this.initialize();
  }
}

// Singleton message store shared across all agents
export const globalMessageStore = new FileBackedMessageStore();

/**
 * Creates MCP tools for inter-agent messaging.
 *
 * These tools allow Claude agents to communicate with each other:
 * - send_message: Send a message to another agent
 * - inbox: Get messages for the current agent
 * - sent: Get sent messages
 * - mark_read: Mark a message as read
 * - delete_message: Delete a message
 *
 * Messages are stored as markdown files in .clautana/messages/
 * Agents can also directly read/write these files.
 *
 * @param agentName - The name of the agent these tools are for
 */
export async function createMailMcpTools(agentName: string): Promise<any[]> {
  const { z } = await import("zod");
  const { tool } = await import("@anthropic-ai/claude-agent-sdk");

  return [
    tool(
      "send_message",
      "Send a message to another agent or the orchestrator. " +
        "Messages are stored in .clautana/messages/ as markdown files.",
      {
        to: z.string().describe("Recipient agent name (or 'orchestrator' or 'human')"),
        subject: z.string().describe("Message subject/summary"),
        body: z.string().optional().describe("Detailed message content (markdown supported)"),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional()
          .describe("Message priority level"),
      },
      async (args) => {
        const message: AgentMessage = {
          id: crypto.randomUUID(),
          from: agentName,
          to: args.to,
          subject: args.subject,
          body: args.body,
          timestamp: new Date(),
          read: false,
        };

        await globalMessageStore.addMessage(message);

        return {
          content: [
            {
              type: "text",
              text: `Message sent to ${args.to}: "${args.subject}"\nFile: .clautana/messages/${message.id}.md`,
            },
          ],
        };
      }
    ),

    tool(
      "inbox",
      "Check your inbox for messages from other agents. " +
        "Messages are stored in .clautana/messages/ as markdown files.",
      {
        unreadOnly: z.boolean().optional().describe("Only show unread messages"),
        from: z.string().optional().describe("Filter by sender"),
      },
      async (args) => {
        let messages = args.unreadOnly
          ? await globalMessageStore.getUnread(agentName)
          : await globalMessageStore.getInbox(agentName);

        if (args.from) {
          messages = messages.filter((m) => m.from === args.from);
        }

        if (messages.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: args.unreadOnly
                  ? "No unread messages."
                  : "Your inbox is empty.",
              },
            ],
          };
        }

        const formatted = messages
          .map((m) => {
            const readStatus = m.read ? "[read]" : "[NEW]";
            const time = m.timestamp.toLocaleTimeString();
            const date = m.timestamp.toLocaleDateString();
            let text = `${readStatus} From: ${m.from} @ ${date} ${time}\n  Subject: ${m.subject}`;
            if (m.body) {
              const preview = m.body.length > 100 ? m.body.slice(0, 100) + "..." : m.body;
              text += `\n  Preview: ${preview}`;
            }
            text += `\n  File: .clautana/messages/${m.id}.md`;
            return text;
          })
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: `You have ${messages.length} message(s):\n\n${formatted}`,
            },
          ],
        };
      }
    ),

    tool(
      "read_message",
      "Read the full content of a message by ID",
      {
        messageId: z.string().describe("The message ID to read"),
        markAsRead: z.boolean().optional().describe("Mark as read after reading (default: true)"),
      },
      async (args) => {
        const messages = await globalMessageStore.getAllMessages();
        const message = messages.find((m) => m.id === args.messageId);

        if (!message) {
          return {
            content: [
              { type: "text", text: `Message ${args.messageId} not found.` },
            ],
          };
        }

        if (args.markAsRead !== false) {
          await globalMessageStore.markRead(args.messageId);
        }

        let text = `From: ${message.from}\n`;
        text += `To: ${message.to}\n`;
        text += `Subject: ${message.subject}\n`;
        text += `Date: ${message.timestamp.toLocaleString()}\n`;
        text += `Status: ${message.read ? "Read" : "Unread"}\n`;
        text += `---\n\n`;
        text += message.body || "(No body)";

        return {
          content: [{ type: "text", text }],
        };
      }
    ),

    tool(
      "sent_messages",
      "View messages you have sent",
      {
        to: z.string().optional().describe("Filter by recipient"),
      },
      async (args) => {
        let messages = await globalMessageStore.getSent(agentName);

        if (args.to) {
          messages = messages.filter((m) => m.to === args.to);
        }

        if (messages.length === 0) {
          return {
            content: [{ type: "text", text: "You haven't sent any messages." }],
          };
        }

        const formatted = messages
          .map((m) => {
            const time = m.timestamp.toLocaleTimeString();
            const date = m.timestamp.toLocaleDateString();
            const readStatus = m.read ? "(read by recipient)" : "(unread)";
            return `To: ${m.to} ${readStatus} @ ${date} ${time}\n  Subject: ${m.subject}`;
          })
          .join("\n\n");

        return {
          content: [
            { type: "text", text: `Sent messages (${messages.length}):\n\n${formatted}` },
          ],
        };
      }
    ),

    tool(
      "mark_message_read",
      "Mark a message as read",
      {
        messageId: z.string().describe("The message ID to mark as read"),
      },
      async (args) => {
        const success = await globalMessageStore.markRead(args.messageId);

        return {
          content: [
            {
              type: "text",
              text: success
                ? `Message ${args.messageId} marked as read.`
                : `Message ${args.messageId} not found.`,
            },
          ],
        };
      }
    ),

    tool(
      "delete_message",
      "Delete a message from your inbox",
      {
        messageId: z.string().describe("The message ID to delete"),
      },
      async (args) => {
        const success = await globalMessageStore.deleteMessage(args.messageId);

        return {
          content: [
            {
              type: "text",
              text: success
                ? `Message ${args.messageId} deleted.`
                : `Message ${args.messageId} not found.`,
            },
          ],
        };
      }
    ),

    tool(
      "reply_to_message",
      "Reply to an existing message",
      {
        messageId: z.string().describe("The message ID to reply to"),
        body: z.string().describe("Reply content"),
      },
      async (args) => {
        const messages = await globalMessageStore.getAllMessages();
        const originalMessage = messages.find((m) => m.id === args.messageId);

        if (!originalMessage) {
          return {
            content: [{ type: "text", text: `Message ${args.messageId} not found.` }],
          };
        }

        const reply: AgentMessage = {
          id: crypto.randomUUID(),
          from: agentName,
          to: originalMessage.from,
          subject: `Re: ${originalMessage.subject}`,
          body: args.body,
          timestamp: new Date(),
          read: false,
        };

        await globalMessageStore.addMessage(reply);

        return {
          content: [
            {
              type: "text",
              text: `Reply sent to ${reply.to}: "Re: ${originalMessage.subject}"`,
            },
          ],
        };
      }
    ),

    tool(
      "archive_message",
      "Archive a message (moves it from inbox to archive folder). Archived messages are automatically marked as read.",
      {
        messageId: z.string().describe("The message ID to archive"),
      },
      async (args) => {
        const success = await globalMessageStore.archiveMessage(args.messageId);

        return {
          content: [
            {
              type: "text",
              text: success
                ? `Message ${args.messageId} archived successfully.`
                : `Message ${args.messageId} not found or already archived.`,
            },
          ],
        };
      }
    ),

    tool(
      "archived_messages",
      "View your archived messages",
      {
        from: z.string().optional().describe("Filter by sender"),
      },
      async (args) => {
        let messages = await globalMessageStore.getArchived(agentName);

        if (args.from) {
          messages = messages.filter((m) => m.from === args.from);
        }

        if (messages.length === 0) {
          return {
            content: [{ type: "text", text: "No archived messages." }],
          };
        }

        const formatted = messages
          .map((m) => {
            const time = m.timestamp.toLocaleTimeString();
            const date = m.timestamp.toLocaleDateString();
            return `From: ${m.from} @ ${date} ${time}\n  Subject: ${m.subject}\n  ID: ${m.id}`;
          })
          .join("\n\n");

        return {
          content: [
            { type: "text", text: `Archived messages (${messages.length}):\n\n${formatted}` },
          ],
        };
      }
    ),
  ];
}

/**
 * Create mail tools in ToolDefinition format for Copilot backend.
 * 
 * This is a simplified version of createMailMcpTools() that returns
 * tools in the backend-agnostic ToolDefinition format.
 * 
 * @param agentName - The name of the agent these tools are for
 */
export async function createMailToolDefinitions(agentName: string): Promise<any[]> {
  return [
    {
      name: 'send_message',
      description: 'Send a message to another agent or the orchestrator.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient agent name' },
          subject: { type: 'string', description: 'Message subject' },
          body: { type: 'string', description: 'Message content' },
        },
        required: ['to', 'subject'],
      },
      handler: async (args: any) => {
        const message: AgentMessage = {
          id: crypto.randomUUID(),
          from: agentName,
          to: args.to,
          subject: args.subject,
          body: args.body,
          timestamp: new Date(),
          read: false,
        };
        await globalMessageStore.addMessage(message);
        return { content: [{ type: 'text', text: `Message sent to ${args.to}` }] };
      },
    },
    {
      name: 'inbox',
      description: 'Get messages for this agent.',
      parameters: {
        type: 'object',
        properties: {
          includeRead: { type: 'boolean', description: 'Include read messages' },
        },
        required: [],
      },
      handler: async (args: any) => {
        const allMessages = await globalMessageStore.getAllMessages();
        const messages = allMessages.filter((m: AgentMessage) => 
          m.to === agentName && (args.includeRead || !m.read)
        );
        const formatted = messages.map((m: AgentMessage) => 
          `[${m.id}] From: ${m.from}, Subject: ${m.subject}, Read: ${m.read}`
        ).join('\n');
        return { content: [{ type: 'text', text: formatted || 'No messages' }] };
      },
    },
    {
      name: 'read_message',
      description: 'Read a specific message by ID.',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'The message ID' },
          markAsRead: { type: 'boolean', description: 'Mark as read after reading' },
        },
        required: ['messageId'],
      },
      handler: async (args: any) => {
        const messages = await globalMessageStore.getAllMessages();
        const message = messages.find((m: AgentMessage) => m.id === args.messageId);
        if (!message) {
          return { content: [{ type: 'text', text: 'Message not found' }] };
        }
        if (args.markAsRead) {
          await globalMessageStore.markRead(args.messageId);
        }
        return { content: [{ type: 'text', text: `From: ${message.from}\nSubject: ${message.subject}\n\n${message.body || '(no body)'}` }] };
      },
    },
    {
      name: 'archive_message',
      description: 'Archive a message after processing it. Always archive messages after reading them to keep inbox clean.',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'The message ID to archive' },
        },
        required: ['messageId'],
      },
      handler: async (args: any) => {
        const success = await globalMessageStore.archiveMessage(args.messageId);
        if (success) {
          return { content: [{ type: 'text', text: `Message ${args.messageId} archived` }] };
        }
        return { content: [{ type: 'text', text: 'Message not found or already archived' }] };
      },
    },
    {
      name: 'reply_to_message',
      description: 'Reply to a message. Automatically addresses the reply to the original sender.',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'The message ID to reply to' },
          body: { type: 'string', description: 'Reply content' },
        },
        required: ['messageId', 'body'],
      },
      handler: async (args: any) => {
        const messages = await globalMessageStore.getAllMessages();
        const originalMessage = messages.find((m: AgentMessage) => m.id === args.messageId);
        if (!originalMessage) {
          return { content: [{ type: 'text', text: 'Original message not found' }] };
        }
        const reply: AgentMessage = {
          id: crypto.randomUUID(),
          from: agentName,
          to: originalMessage.from,
          subject: `Re: ${originalMessage.subject}`,
          body: args.body,
          timestamp: new Date(),
          read: false,
          replyTo: args.messageId,
        };
        await globalMessageStore.addMessage(reply);
        return { content: [{ type: 'text', text: `Reply sent to ${originalMessage.from}` }] };
      },
    },
    {
      name: 'mark_message_read',
      description: 'Mark a message as read without archiving it.',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'The message ID to mark as read' },
        },
        required: ['messageId'],
      },
      handler: async (args: any) => {
        await globalMessageStore.markRead(args.messageId);
        return { content: [{ type: 'text', text: `Message ${args.messageId} marked as read` }] };
      },
    },
  ];
}
