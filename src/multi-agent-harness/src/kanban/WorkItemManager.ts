import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';
import * as yaml from 'js-yaml';
import {
  WorkItem,
  WorkItemStatus,
  WorkItemCreateInput,
  WorkItemUpdateInput,
  WorkItemFrontmatter,
} from './types';
// WorkItemPriority and WorkItemType are part of WorkItem type
export type { WorkItemPriority, WorkItemType } from './types';

export class WorkItemManager extends EventEmitter {
  private clautanaDir: string | null = null;
  private workItemsDir: string | null = null;
  private initialized = false;
  private itemCounter = 0;

  async initialize(workspaceRoot: string): Promise<void> {
    if (!workspaceRoot) {
      throw new Error('WorkItemManager.initialize() requires a valid workspaceRoot path');
    }
    this.clautanaDir = path.join(workspaceRoot, '.clautana');
    this.workItemsDir = path.join(this.clautanaDir, 'workitems');

    // Create folder structure if needed
    const statuses: WorkItemStatus[] = ['todo', 'doing', 'code-review', 'done', 'cancelled'];

    await fs.mkdir(this.clautanaDir, { recursive: true });
    await fs.mkdir(this.workItemsDir, { recursive: true });

    for (const status of statuses) {
      await fs.mkdir(path.join(this.workItemsDir, status), { recursive: true });
    }

    // Initialize item counter by scanning existing items
    await this.initializeCounter();

    this.initialized = true;
  }

  private async initializeCounter(): Promise<void> {
    if (!this.workItemsDir) {
      return;
    }

    // Directly scan items without calling listItems() to avoid ensureInitialized() deadlock
    const allItems = await this.scanItemsInternal();
    const currentYear = new Date().getFullYear();

    // Find the highest counter for the current year
    let maxCounter = 0;
    for (const item of allItems) {
      const match = item.id.match(/^WI-(\d{4})-(\d{3})$/);
      if (match) {
        const year = parseInt(match[1], 10);
        const counter = parseInt(match[2], 10);
        if (year === currentYear && counter > maxCounter) {
          maxCounter = counter;
        }
      }
    }

    this.itemCounter = maxCounter;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized && this.workItemsDir) {
      return;
    }

    // Try to auto-initialize with workspace folder
    try {
      const vscode = await import('vscode');
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        const workspaceFolder = workspaceFolders[0];
        const fsPath = workspaceFolder?.uri?.fsPath;
        if (fsPath && typeof fsPath === 'string' && fsPath.length > 0) {
          await this.initialize(fsPath);
          return;
        }
      }
    } catch (error) {
      // vscode import may fail in some contexts
      console.error('[WorkItemManager] Auto-initialize failed:', error);
    }

    throw new Error('WorkItemManager not initialized. Call initialize() with workspace path first.');
  }

  private generateId(): string {
    const year = new Date().getFullYear();
    this.itemCounter++;
    const counter = this.itemCounter.toString().padStart(3, '0');
    return `WI-${year}-${counter}`;
  }

  /**
   * Internal method to scan items during initialization.
   * Does NOT call ensureInitialized() to avoid deadlock.
   */
  private async scanItemsInternal(): Promise<WorkItem[]> {
    if (!this.workItemsDir) {
      return [];
    }

    const statuses: WorkItemStatus[] = ['todo', 'doing', 'code-review', 'done', 'cancelled'];
    const items: WorkItem[] = [];

    for (const currentStatus of statuses) {
      const statusDir = path.join(this.workItemsDir, currentStatus);

      try {
        const files = await fs.readdir(statusDir);

        for (const file of files) {
          if (file.endsWith('.md')) {
            const filePath = path.join(statusDir, file);
            try {
              const item = await this.parseWorkItemFile(filePath, currentStatus);
              items.push(item);
            } catch (error) {
              console.error(`Error parsing work item file ${filePath}:`, error);
            }
          }
        }
      } catch {
        // Directory might not exist yet, skip
        continue;
      }
    }

    return items;
  }

  private async parseWorkItemFile(filePath: string, status: WorkItemStatus): Promise<WorkItem> {
    const content = await fs.readFile(filePath, 'utf-8');

    // Extract frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) {
      throw new Error(`Invalid work item file format: ${filePath}`);
    }

    const frontmatter = yaml.load(frontmatterMatch[1]) as WorkItemFrontmatter;
    const body = frontmatterMatch[2].trim();

    // Extract description (content between ## Description and next ## section)
    const descriptionMatch = body.match(/## Description\s*\n([\s\S]*?)(?=\n##|$)/);
    const description = descriptionMatch ? descriptionMatch[1].trim() : '';

    return {
      id: frontmatter.id,
      title: frontmatter.title,
      description,
      priority: frontmatter.priority,
      status,
      type: frontmatter.type || 'story',
      assignee: frontmatter.assignee,
      reviewer: frontmatter.reviewer,
      tags: frontmatter.tags || [],
      created: new Date(frontmatter.created),
      started: frontmatter.started ? new Date(frontmatter.started) : null,
      completed: frontmatter.completed ? new Date(frontmatter.completed) : null,
      estimatedHours: frontmatter.estimatedHours,
      filePath,
      featureRef: frontmatter.featureRef,
    };
  }

  private async writeWorkItemFile(item: WorkItem, body: string): Promise<void> {
    const frontmatter: WorkItemFrontmatter = {
      id: item.id,
      title: item.title,
      priority: item.priority,
      status: item.status,
      type: item.type,
      assignee: item.assignee,
      reviewer: item.reviewer,
      tags: item.tags,
      created: item.created.toISOString(),
      started: item.started ? item.started.toISOString() : null,
      completed: item.completed ? item.completed.toISOString() : null,
      estimatedHours: item.estimatedHours,
      featureRef: item.featureRef,
    };

    const yamlFrontmatter = yaml.dump(frontmatter, { lineWidth: -1 });
    const content = `---\n${yamlFrontmatter}---\n\n${body}`;

    await fs.writeFile(item.filePath, content, 'utf-8');
  }

  private async getStatusDirectory(status: WorkItemStatus): Promise<string> {
    await this.ensureInitialized();
    return path.join(this.workItemsDir!, status);
  }

  private async getFilePath(id: string, status: WorkItemStatus): Promise<string> {
    const statusDir = await this.getStatusDirectory(status);
    return path.join(statusDir, `${id}.md`);
  }

  async listItems(status?: WorkItemStatus): Promise<WorkItem[]> {
    await this.ensureInitialized();

    const statuses: WorkItemStatus[] = status
      ? [status]
      : ['todo', 'doing', 'code-review', 'done', 'cancelled'];

    const items: WorkItem[] = [];

    for (const currentStatus of statuses) {
      const statusDir = await this.getStatusDirectory(currentStatus);

      try {
        const files = await fs.readdir(statusDir);

        for (const file of files) {
          if (file.endsWith('.md')) {
            const filePath = path.join(statusDir, file);
            try {
              const item = await this.parseWorkItemFile(filePath, currentStatus);
              items.push(item);
            } catch (error) {
              console.error(`Error parsing work item file ${filePath}:`, error);
            }
          }
        }
      } catch (error) {
        // Directory might not exist yet, skip
        continue;
      }
    }

    // Sort by created date (newest first)
    items.sort((a, b) => b.created.getTime() - a.created.getTime());

    return items;
  }

  async getItem(id: string): Promise<WorkItem | null> {
    await this.ensureInitialized();

    const allItems = await this.listItems();
    return allItems.find(item => item.id === id) || null;
  }

  async createItem(input: WorkItemCreateInput): Promise<WorkItem> {
    await this.ensureInitialized();

    const id = this.generateId();
    const now = new Date();
    const status: WorkItemStatus = 'todo';
    const filePath = await this.getFilePath(id, status);

    const item: WorkItem = {
      id,
      title: input.title,
      description: input.description,
      priority: input.priority || 'medium',
      status,
      type: input.type || 'story',
      assignee: null,
      reviewer: null,
      tags: input.tags || [],
      created: now,
      started: null,
      completed: null,
      estimatedHours: input.estimatedHours || null,
      filePath,
      featureRef: input.featureRef,
    };

    const acceptanceCriteria = input.acceptanceCriteria || '';
    const body = `## Description\n${input.description}\n\n## Acceptance Criteria\n${acceptanceCriteria}\n\n## Notes\n`;

    await this.writeWorkItemFile(item, body);

    this.emit('itemCreated', item);

    return item;
  }

  async updateItem(id: string, updates: WorkItemUpdateInput): Promise<WorkItem> {
    await this.ensureInitialized();

    const item = await this.getItem(id);
    if (!item) {
      throw new Error(`Work item not found: ${id}`);
    }

    // Read current file content to preserve body
    const content = await fs.readFile(item.filePath, 'utf-8');
    const frontmatterMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    let body = frontmatterMatch ? frontmatterMatch[1].trim() : '';

    // Apply updates
    if (updates.title !== undefined) {
      item.title = updates.title;
    }
    if (updates.description !== undefined) {
      item.description = updates.description;
      // Update description in body
      body = body.replace(
        /## Description\s*\n[\s\S]*?(?=\n##|$)/,
        `## Description\n${updates.description}\n\n`
      );
    }
    if (updates.priority !== undefined) {
      item.priority = updates.priority;
    }
    if (updates.type !== undefined) {
      item.type = updates.type;
    }
    if (updates.assignee !== undefined) {
      item.assignee = updates.assignee;
    }
    if (updates.reviewer !== undefined) {
      item.reviewer = updates.reviewer;
    }
    if (updates.tags !== undefined) {
      item.tags = updates.tags;
    }
    if (updates.estimatedHours !== undefined) {
      item.estimatedHours = updates.estimatedHours;
    }
    if (updates.featureRef !== undefined) {
      item.featureRef = updates.featureRef;
    }

    await this.writeWorkItemFile(item, body);

    this.emit('itemUpdated', item);

    return item;
  }

  async moveItem(id: string, newStatus: WorkItemStatus): Promise<WorkItem> {
    await this.ensureInitialized();

    const item = await this.getItem(id);
    if (!item) {
      throw new Error(`Work item not found: ${id}`);
    }

    if (item.status === newStatus) {
      return item; // No change needed
    }

    const oldStatus = item.status;
    const oldFilePath = item.filePath;
    const newFilePath = await this.getFilePath(id, newStatus);

    // Update timestamps based on status transitions
    const now = new Date();
    if (newStatus === 'doing' && item.started === null) {
      item.started = now;
    } else if ((newStatus === 'done' || newStatus === 'cancelled') && item.completed === null) {
      item.completed = now;
    }

    item.status = newStatus;
    item.filePath = newFilePath;

    // Read current content
    const content = await fs.readFile(oldFilePath, 'utf-8');
    const frontmatterMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    const body = frontmatterMatch ? frontmatterMatch[1].trim() : '';

    // Write to new location
    await this.writeWorkItemFile(item, body);

    // Delete old file
    await fs.unlink(oldFilePath);

    this.emit('itemMoved', item, oldStatus, newStatus);

    return item;
  }

  async assignItem(id: string, agentName: string): Promise<WorkItem> {
    await this.ensureInitialized();

    const item = await this.getItem(id);
    if (!item) {
      throw new Error(`Work item not found: ${id}`);
    }

    await this.updateItem(id, { assignee: agentName });

    const updatedItem = await this.getItem(id);
    if (!updatedItem) {
      throw new Error(`Failed to retrieve updated work item: ${id}`);
    }

    this.emit('itemAssigned', updatedItem, agentName);

    return updatedItem;
  }

  async unassignItem(id: string): Promise<WorkItem> {
    await this.ensureInitialized();

    const item = await this.getItem(id);
    if (!item) {
      throw new Error(`Work item not found: ${id}`);
    }

    return await this.updateItem(id, { assignee: null });
  }

  async cancelItem(id: string, reason: string): Promise<WorkItem> {
    await this.ensureInitialized();

    const item = await this.getItem(id);
    if (!item) {
      throw new Error(`Work item not found: ${id}`);
    }

    // Add cancellation note
    await this.addNote(id, 'System', `CANCELLED: ${reason}`);

    // Move to cancelled status
    const cancelledItem = await this.moveItem(id, 'cancelled');

    this.emit('itemCancelled', cancelledItem, reason);

    return cancelledItem;
  }

  async deleteItem(id: string): Promise<void> {
    await this.ensureInitialized();

    const item = await this.getItem(id);
    if (!item) {
      throw new Error(`Work item not found: ${id}`);
    }

    await fs.unlink(item.filePath);

    this.emit('itemDeleted', id);
  }

  async addNote(id: string, agentName: string, note: string): Promise<WorkItem> {
    await this.ensureInitialized();

    const item = await this.getItem(id);
    if (!item) {
      throw new Error(`Work item not found: ${id}`);
    }

    // Read current content
    const content = await fs.readFile(item.filePath, 'utf-8');
    const frontmatterMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    let body = frontmatterMatch ? frontmatterMatch[1].trim() : '';

    // Format timestamp
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);

    // Add note to Notes section
    const noteEntry = `\n### ${timestamp} - ${agentName}\n${note}\n`;

    if (body.includes('## Notes')) {
      // Append to existing Notes section
      body = body.replace(
        /(## Notes\s*\n)/,
        `$1${noteEntry}`
      );
    } else {
      // Add Notes section
      body += `\n\n## Notes${noteEntry}`;
    }

    await this.writeWorkItemFile(item, body);

    return await this.getItem(id) as WorkItem;
  }
}

// Singleton instance
let instance: WorkItemManager | null = null;

export function getWorkItemManager(): WorkItemManager {
  if (!instance) {
    instance = new WorkItemManager();
  }
  return instance;
}
