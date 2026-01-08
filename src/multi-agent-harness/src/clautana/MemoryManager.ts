import * as fs from "fs/promises";
import * as path from "path";
import * as yaml from "js-yaml";
import { v4 as uuidv4 } from "uuid";
import {
  MemoryEntry,
  MemoryType,
  MemorySearchOptions,
  MemorySearchResult,
  MemoryFile,
  MemoryStats,
  MemoryConfig,
} from "./types";
import {
  validateMemoryFile,
  validateCreateMemoryEntry,
  validateUpdateMemoryEntry,
} from "./validation";
import { getConfigManager } from "./ConfigManager";

/**
 * Manages YML-based memory storage for the Clautana extension.
 *
 * Memory is stored in three YML files:
 * - playbooks.yml: Learned patterns and reusable solutions
 * - facts.yml: Project-specific knowledge (conventions, preferences)
 * - sessions.yml: Session history for context
 *
 * Each file follows the structure:
 * ```yaml
 * entries:
 *   - id: "abc123"
 *     content: "..."
 *     tags: ["tag1", "tag2"]
 *     createdAt: "2024-01-15T10:30:00Z"
 *     lastUsed: "2024-01-20T14:00:00Z"
 *     useCount: 5
 *     confidence: 0.9
 * ```
 */
export class MemoryManager {
  private memoryPath: string;
  private cache: Map<MemoryType, MemoryFile> = new Map();
  private lockFiles: Map<MemoryType, boolean> = new Map();
  private initialized = false;

  constructor(memoryPath?: string) {
    this.memoryPath = memoryPath ?? getConfigManager().getMemoryPath();
  }

  /**
   * Initialize the memory manager, ensuring files exist
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Ensure memory directory exists
    await fs.mkdir(this.memoryPath, { recursive: true });

    // Initialize each memory type
    const types: MemoryType[] = ["playbooks", "facts", "sessions"];
    for (const type of types) {
      await this.ensureFileExists(type);
    }

    this.initialized = true;
  }

  /**
   * Ensure a memory file exists, creating it if necessary
   */
  private async ensureFileExists(type: MemoryType): Promise<void> {
    const filePath = this.getFilePath(type);
    try {
      await fs.access(filePath);
    } catch {
      // Create empty memory file
      const emptyFile: MemoryFile = { entries: [] };
      await this.writeFile(type, emptyFile);
    }
  }

  /**
   * Get the file path for a memory type
   */
  private getFilePath(type: MemoryType): string {
    return path.join(this.memoryPath, `${type}.yml`);
  }

  /**
   * Read a memory file from disk
   */
  private async readFile(type: MemoryType): Promise<MemoryFile> {
    // Check cache first
    const cached = this.cache.get(type);
    if (cached) {
      return cached;
    }

    const filePath = this.getFilePath(type);

    try {
      const content = await fs.readFile(filePath, "utf-8");

      // Handle empty files
      if (!content.trim()) {
        const emptyFile: MemoryFile = { entries: [] };
        this.cache.set(type, emptyFile);
        return emptyFile;
      }

      const parsed = yaml.load(content) as unknown;

      // Validate the file structure
      const validation = validateMemoryFile(parsed);
      if (!validation.success) {
        console.warn(
          `Invalid memory file ${filePath}: ${validation.error}. Creating backup and resetting.`
        );
        // Backup the invalid file
        const backupPath = `${filePath}.backup.${Date.now()}`;
        await fs.copyFile(filePath, backupPath);
        // Return empty file
        const emptyFile: MemoryFile = { entries: [] };
        this.cache.set(type, emptyFile);
        return emptyFile;
      }

      this.cache.set(type, validation.data!);
      return validation.data!;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // File doesn't exist, create it
        const emptyFile: MemoryFile = { entries: [] };
        await this.writeFile(type, emptyFile);
        this.cache.set(type, emptyFile);
        return emptyFile;
      }
      throw error;
    }
  }

  /**
   * Write a memory file to disk with basic locking
   */
  private async writeFile(type: MemoryType, data: MemoryFile): Promise<void> {
    // Simple lock mechanism
    while (this.lockFiles.get(type)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    this.lockFiles.set(type, true);

    try {
      const filePath = this.getFilePath(type);

      // Generate YAML with nice formatting
      const yamlContent = yaml.dump(data, {
        indent: 2,
        lineWidth: 120,
        quotingType: '"',
        forceQuotes: false,
        noRefs: true,
        sortKeys: false,
      });

      // Write atomically by writing to temp file first
      const tempPath = `${filePath}.tmp`;
      await fs.writeFile(tempPath, yamlContent, "utf-8");
      await fs.rename(tempPath, filePath);

      // Update cache
      this.cache.set(type, data);
    } finally {
      this.lockFiles.set(type, false);
    }
  }

  /**
   * Invalidate cache for a specific memory type
   */
  public invalidateCache(type?: MemoryType): void {
    if (type) {
      this.cache.delete(type);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Generate a unique ID for a new entry
   */
  private generateId(): string {
    return uuidv4().replace(/-/g, "").substring(0, 12);
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Add a new memory entry
   */
  async add(
    type: MemoryType,
    entry: Omit<MemoryEntry, "id" | "createdAt" | "lastUsed" | "useCount">
  ): Promise<MemoryEntry> {
    await this.initialize();

    // Validate input
    const validation = validateCreateMemoryEntry(entry);
    if (!validation.success) {
      throw new Error(`Invalid memory entry: ${validation.error}`);
    }

    const now = new Date().toISOString();
    const newEntry: MemoryEntry = {
      id: this.generateId(),
      content: entry.content,
      tags: entry.tags ?? [],
      createdAt: now,
      lastUsed: now,
      useCount: 0,
      confidence: entry.confidence,
      title: entry.title,
      category: entry.category,
      source: entry.source,
    };

    const file = await this.readFile(type);
    file.entries.push(newEntry);
    await this.writeFile(type, file);

    return newEntry;
  }

  /**
   * Get a specific memory entry by ID
   */
  async get(type: MemoryType, id: string): Promise<MemoryEntry | null> {
    await this.initialize();

    const file = await this.readFile(type);
    const entry = file.entries.find((e) => e.id === id);

    if (entry) {
      // Update last used timestamp and use count
      entry.lastUsed = new Date().toISOString();
      entry.useCount++;
      await this.writeFile(type, file);
    }

    return entry ?? null;
  }

  /**
   * Search memories by content and/or tags
   */
  async search(
    type: MemoryType,
    options: MemorySearchOptions = {}
  ): Promise<MemorySearchResult> {
    await this.initialize();

    const file = await this.readFile(type);
    let entries = [...file.entries];

    // Filter by query (case-insensitive)
    if (options.query) {
      const query = options.query.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.content.toLowerCase().includes(query) ||
          e.title?.toLowerCase().includes(query) ||
          e.tags.some((t) => t.toLowerCase().includes(query))
      );
    }

    // Filter by tags (match any)
    if (options.tags && options.tags.length > 0) {
      const searchTags = options.tags.map((t) => t.toLowerCase());
      entries = entries.filter((e) =>
        e.tags.some((t) => searchTags.includes(t.toLowerCase()))
      );
    }

    // Filter by minimum confidence
    if (options.minConfidence !== undefined) {
      entries = entries.filter(
        (e) => (e.confidence ?? 0) >= options.minConfidence!
      );
    }

    // Filter by minimum use count
    if (options.minUseCount !== undefined) {
      entries = entries.filter((e) => e.useCount >= options.minUseCount!);
    }

    // Filter by created after
    if (options.createdAfter) {
      const afterTime = options.createdAfter.getTime();
      entries = entries.filter(
        (e) => new Date(e.createdAt).getTime() >= afterTime
      );
    }

    // Filter by used after
    if (options.usedAfter) {
      const afterTime = options.usedAfter.getTime();
      entries = entries.filter(
        (e) => new Date(e.lastUsed).getTime() >= afterTime
      );
    }

    // Sort
    const sortBy = options.sortBy ?? "lastUsed";
    const sortOrder = options.sortOrder ?? "desc";
    entries.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "createdAt":
          comparison =
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "lastUsed":
          comparison =
            new Date(a.lastUsed).getTime() - new Date(b.lastUsed).getTime();
          break;
        case "useCount":
          comparison = a.useCount - b.useCount;
          break;
        case "confidence":
          comparison = (a.confidence ?? 0) - (b.confidence ?? 0);
          break;
      }
      return sortOrder === "desc" ? -comparison : comparison;
    });

    // Apply limit
    const total = entries.length;
    const limit = options.limit ?? 50;
    const hasMore = entries.length > limit;
    entries = entries.slice(0, limit);

    return { entries, total, hasMore };
  }

  /**
   * Update an existing memory entry
   */
  async update(
    type: MemoryType,
    id: string,
    updates: Partial<Omit<MemoryEntry, "id" | "createdAt">>
  ): Promise<MemoryEntry | null> {
    await this.initialize();

    // Validate update data
    const validation = validateUpdateMemoryEntry(updates);
    if (!validation.success) {
      throw new Error(`Invalid update data: ${validation.error}`);
    }

    const file = await this.readFile(type);
    const index = file.entries.findIndex((e) => e.id === id);

    if (index === -1) {
      return null;
    }

    const entry = file.entries[index];

    // Apply updates
    if (updates.content !== undefined) entry.content = updates.content;
    if (updates.tags !== undefined) entry.tags = updates.tags;
    if (updates.confidence !== undefined) entry.confidence = updates.confidence;
    if (updates.title !== undefined) entry.title = updates.title;
    if (updates.category !== undefined) entry.category = updates.category;
    if (updates.source !== undefined) entry.source = updates.source;

    // Update lastUsed
    entry.lastUsed = new Date().toISOString();

    await this.writeFile(type, file);
    return entry;
  }

  /**
   * Delete a memory entry
   */
  async delete(type: MemoryType, id: string): Promise<boolean> {
    await this.initialize();

    const file = await this.readFile(type);
    const index = file.entries.findIndex((e) => e.id === id);

    if (index === -1) {
      return false;
    }

    file.entries.splice(index, 1);
    await this.writeFile(type, file);
    return true;
  }

  /**
   * Get all entries of a specific type
   */
  async getAll(type: MemoryType): Promise<MemoryEntry[]> {
    await this.initialize();

    const file = await this.readFile(type);
    return [...file.entries];
  }

  /**
   * Decay old, unused entries based on configuration
   * Removes entries that haven't been used within the decay period
   * and have low confidence/use count
   */
  async decay(): Promise<{
    playbooks: number;
    facts: number;
    sessions: number;
  }> {
    await this.initialize();

    const configManager = getConfigManager();
    const config = await configManager.loadConfig();
    const memoryConfig: MemoryConfig = config.memory ?? {};

    const decayDays = memoryConfig.decayDays ?? 90;
    const maxEntries = memoryConfig.maxEntries ?? {
      playbooks: 100,
      facts: 500,
      sessions: 1000,
    };

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - decayDays);
    const cutoffTime = cutoffDate.getTime();

    const result = { playbooks: 0, facts: 0, sessions: 0 };

    const types: MemoryType[] = ["playbooks", "facts", "sessions"];
    for (const type of types) {
      const file = await this.readFile(type);
      const originalCount = file.entries.length;

      // Remove entries that are:
      // 1. Not used within the decay period AND
      // 2. Have low confidence (< 0.5) or low use count (< 3)
      file.entries = file.entries.filter((entry) => {
        const lastUsedTime = new Date(entry.lastUsed).getTime();
        const isOld = lastUsedTime < cutoffTime;
        const isLowValue =
          (entry.confidence ?? 0) < 0.5 && entry.useCount < 3;

        // Keep entry if it's not old OR if it has high value
        return !isOld || !isLowValue;
      });

      // Enforce max entries limit (keep most recently used)
      const maxForType = maxEntries[type] ?? 100;
      if (file.entries.length > maxForType) {
        file.entries.sort(
          (a, b) =>
            new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime()
        );
        file.entries = file.entries.slice(0, maxForType);
      }

      const removedCount = originalCount - file.entries.length;
      result[type] = removedCount;

      if (removedCount > 0) {
        await this.writeFile(type, file);
      }
    }

    return result;
  }

  /**
   * Get statistics about memory usage
   */
  async getStats(): Promise<MemoryStats> {
    await this.initialize();

    const types: MemoryType[] = ["playbooks", "facts", "sessions"];
    const stats: MemoryStats = {
      playbooks: { count: 0, totalUseCount: 0, averageConfidence: 0 },
      facts: { count: 0, totalUseCount: 0, averageConfidence: 0 },
      sessions: { count: 0, totalUseCount: 0, averageConfidence: 0 },
      lastUpdated: new Date().toISOString(),
    };

    for (const type of types) {
      const file = await this.readFile(type);
      const entries = file.entries;

      stats[type].count = entries.length;
      stats[type].totalUseCount = entries.reduce(
        (sum, e) => sum + e.useCount,
        0
      );

      const confidenceSum = entries.reduce(
        (sum, e) => sum + (e.confidence ?? 0),
        0
      );
      stats[type].averageConfidence =
        entries.length > 0 ? confidenceSum / entries.length : 0;
    }

    return stats;
  }

  /**
   * Import entries from a JSON file (for migration from old format)
   */
  async importFromJson(
    type: MemoryType,
    jsonContent: string
  ): Promise<number> {
    await this.initialize();

    let imported = 0;

    try {
      const parsed = JSON.parse(jsonContent);
      const entries = Array.isArray(parsed) ? parsed : [];

      for (const entry of entries) {
        if (entry && typeof entry === "object") {
          // Convert old format to new format
          const newEntry: Omit<
            MemoryEntry,
            "id" | "createdAt" | "lastUsed" | "useCount"
          > = {
            content:
              entry.content ||
              entry.statement ||
              entry.task ||
              entry.description ||
              "",
            tags: entry.tags || [],
            confidence: entry.confidence,
            title: entry.title,
            category: entry.category,
            source: entry.source,
          };

          if (newEntry.content) {
            await this.add(type, newEntry);
            imported++;
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to import JSON for ${type}: ${error}`);
    }

    return imported;
  }

  /**
   * Export entries to JSON format
   */
  async exportToJson(type: MemoryType): Promise<string> {
    await this.initialize();

    const file = await this.readFile(type);
    return JSON.stringify(file.entries, null, 2);
  }

  /**
   * Clear all entries of a specific type
   */
  async clear(type: MemoryType): Promise<void> {
    await this.initialize();

    const emptyFile: MemoryFile = { entries: [] };
    await this.writeFile(type, emptyFile);
  }

  /**
   * Get the memory folder path
   */
  getMemoryPath(): string {
    return this.memoryPath;
  }

  /**
   * Reload from disk (invalidate cache)
   */
  async reload(): Promise<void> {
    this.cache.clear();
    this.initialized = false;
    await this.initialize();
  }
}

// ===========================================================================
// Singleton Instance
// ===========================================================================

let globalMemoryManager: MemoryManager | null = null;

/**
 * Get the global MemoryManager instance
 */
export function getMemoryManager(): MemoryManager {
  if (!globalMemoryManager) {
    globalMemoryManager = new MemoryManager();
  }
  return globalMemoryManager;
}

/**
 * Initialize the global MemoryManager with a specific path
 */
export function initMemoryManager(memoryPath: string): MemoryManager {
  globalMemoryManager = new MemoryManager(memoryPath);
  return globalMemoryManager;
}

/**
 * Reset the global MemoryManager (for testing)
 */
export function resetMemoryManager(): void {
  globalMemoryManager = null;
}
