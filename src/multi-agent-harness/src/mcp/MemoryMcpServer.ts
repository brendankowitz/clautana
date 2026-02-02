import * as fs from "fs/promises";
import * as path from "path";
import { Playbook, Fact, SessionLog } from "../clautana/types";
import { getConfigManager } from "../clautana/ConfigManager";

/**
 * MemoryManager handles persistent agent memory stored in .clautana/memory/
 *
 * Three types of memory:
 * - Playbooks: Procedural memory ("how to do X")
 * - Facts: Semantic memory ("X is true about this project")
 * - Sessions: Episodic memory ("what happened in session Y")
 *
 * Memory decays over time based on configuration.
 */
class MemoryManager {
  private playbooks: Playbook[] = [];
  private facts: Fact[] = [];
  private sessions: SessionLog[] = [];
  private loaded = false;

  /**
   * Load memory from disk
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    const memoryPath = getConfigManager().getMemoryPath();

    try {
      const playbooksData = await fs.readFile(
        path.join(memoryPath, "playbooks.json"),
        "utf-8"
      );
      this.playbooks = JSON.parse(playbooksData);
    } catch {
      this.playbooks = [];
    }

    try {
      const factsData = await fs.readFile(
        path.join(memoryPath, "facts.json"),
        "utf-8"
      );
      this.facts = JSON.parse(factsData);
    } catch {
      this.facts = [];
    }

    try {
      const sessionsData = await fs.readFile(
        path.join(memoryPath, "sessions.json"),
        "utf-8"
      );
      this.sessions = JSON.parse(sessionsData);
    } catch {
      this.sessions = [];
    }

    // Apply decay
    await this.applyDecay();
    this.loaded = true;
  }

  /**
   * Save memory to disk
   */
  async save(): Promise<void> {
    const memoryPath = getConfigManager().getMemoryPath();

    await fs.mkdir(memoryPath, { recursive: true });

    await Promise.all([
      fs.writeFile(
        path.join(memoryPath, "playbooks.json"),
        JSON.stringify(this.playbooks, null, 2),
        "utf-8"
      ),
      fs.writeFile(
        path.join(memoryPath, "facts.json"),
        JSON.stringify(this.facts, null, 2),
        "utf-8"
      ),
      fs.writeFile(
        path.join(memoryPath, "sessions.json"),
        JSON.stringify(this.sessions, null, 2),
        "utf-8"
      ),
    ]);
  }

  /**
   * Apply decay to memory confidence scores
   */
  private async applyDecay(): Promise<void> {
    const config = await getConfigManager().loadConfig();
    const halfLifeDays = config.memory?.decayDays ?? 90;
    const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Decay playbooks
    this.playbooks = this.playbooks.filter((p) => {
      const age = now - new Date(p.lastUsed).getTime();
      p.confidence = Math.pow(0.5, age / halfLifeMs);
      return p.confidence > 0.1; // Remove if confidence drops below 10%
    });

    // Decay facts
    this.facts = this.facts.filter((f) => {
      const age = now - new Date(f.lastVerified).getTime();
      f.confidence = Math.pow(0.5, age / halfLifeMs);
      return f.confidence > 0.1;
    });

    // Keep only recent sessions (based on maxEntries)
    const maxSessions = config.memory?.maxEntries?.sessions ?? 1000;
    if (this.sessions.length > maxSessions) {
      this.sessions = this.sessions
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
        .slice(0, maxSessions);
    }
  }

  // ============================================================================
  // Playbook Operations
  // ============================================================================

  async addPlaybook(playbook: Omit<Playbook, "id" | "createdAt" | "lastUsed" | "useCount" | "confidence">): Promise<Playbook> {
    await this.load();

    const newPlaybook: Playbook = {
      id: crypto.randomUUID(),
      ...playbook,
      createdAt: new Date(),
      lastUsed: new Date(),
      useCount: 0,
      confidence: 1.0,
    };

    this.playbooks.push(newPlaybook);
    await this.save();
    return newPlaybook;
  }

  async searchPlaybooks(query: string): Promise<Playbook[]> {
    await this.load();

    const queryLower = query.toLowerCase();
    return this.playbooks
      .filter(
        (p) =>
          p.title.toLowerCase().includes(queryLower) ||
          p.description.toLowerCase().includes(queryLower) ||
          p.tags.some((t) => t.toLowerCase().includes(queryLower))
      )
      .sort((a, b) => b.confidence - a.confidence);
  }

  async usePlaybook(id: string): Promise<Playbook | null> {
    await this.load();

    const playbook = this.playbooks.find((p) => p.id === id);
    if (playbook) {
      playbook.lastUsed = new Date();
      playbook.useCount++;
      playbook.confidence = Math.min(1.0, playbook.confidence + 0.1);
      await this.save();
    }
    return playbook ?? null;
  }

  async getAllPlaybooks(): Promise<Playbook[]> {
    await this.load();
    return this.playbooks.sort((a, b) => b.confidence - a.confidence);
  }

  // ============================================================================
  // Fact Operations
  // ============================================================================

  async addFact(fact: Omit<Fact, "id" | "createdAt" | "lastVerified" | "confidence">): Promise<Fact> {
    await this.load();

    // Check for existing similar fact
    const existing = this.facts.find(
      (f) => f.category === fact.category && f.statement === fact.statement
    );

    if (existing) {
      existing.lastVerified = new Date();
      existing.confidence = 1.0;
      await this.save();
      return existing;
    }

    const newFact: Fact = {
      id: crypto.randomUUID(),
      ...fact,
      createdAt: new Date(),
      lastVerified: new Date(),
      confidence: 1.0,
    };

    this.facts.push(newFact);
    await this.save();
    return newFact;
  }

  async searchFacts(query: string, category?: string): Promise<Fact[]> {
    await this.load();

    const queryLower = query.toLowerCase();
    return this.facts
      .filter((f) => {
        if (category && f.category !== category) return false;
        return (
          f.statement.toLowerCase().includes(queryLower) ||
          f.category.toLowerCase().includes(queryLower)
        );
      })
      .sort((a, b) => b.confidence - a.confidence);
  }

  async getFactsByCategory(category: string): Promise<Fact[]> {
    await this.load();
    return this.facts
      .filter((f) => f.category === category)
      .sort((a, b) => b.confidence - a.confidence);
  }

  async getAllFacts(): Promise<Fact[]> {
    await this.load();
    return this.facts.sort((a, b) => b.confidence - a.confidence);
  }

  // ============================================================================
  // Session Operations
  // ============================================================================

  async startSession(task: string, agents: string[]): Promise<SessionLog> {
    await this.load();

    const session: SessionLog = {
      id: crypto.randomUUID(),
      startTime: new Date(),
      task,
      agents,
      outcome: "partial",
      filesChanged: [],
    };

    this.sessions.push(session);
    await this.save();
    return session;
  }

  async endSession(
    id: string,
    outcome: SessionLog["outcome"],
    summary?: string,
    filesChanged?: string[],
    lessonsLearned?: string[]
  ): Promise<SessionLog | null> {
    await this.load();

    const session = this.sessions.find((s) => s.id === id);
    if (session) {
      session.endTime = new Date();
      session.outcome = outcome;
      if (summary) session.summary = summary;
      if (filesChanged) session.filesChanged = filesChanged;
      if (lessonsLearned) session.lessonsLearned = lessonsLearned;
      await this.save();
    }
    return session ?? null;
  }

  async searchSessions(query: string): Promise<SessionLog[]> {
    await this.load();

    const queryLower = query.toLowerCase();
    return this.sessions
      .filter(
        (s) =>
          s.task.toLowerCase().includes(queryLower) ||
          s.summary?.toLowerCase().includes(queryLower) ||
          s.lessonsLearned?.some((l) => l.toLowerCase().includes(queryLower))
      )
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  }

  async getRecentSessions(count: number = 10): Promise<SessionLog[]> {
    await this.load();
    return this.sessions
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
      .slice(0, count);
  }
}

// Singleton
const globalMemoryManager = new MemoryManager();

/**
 * Creates MCP tools for agent memory operations.
 */
export async function createMemoryMcpTools(): Promise<any[]> {
  const { z } = await import("zod");
  const { tool } = await import("@anthropic-ai/claude-agent-sdk");

  return [
    // ========================================================================
    // Playbook Tools
    // ========================================================================
    tool(
      "memory_search_playbooks",
      "Search for existing playbooks (procedures) that might help with the current task. " +
        "Playbooks contain step-by-step instructions learned from previous successful tasks.",
      {
        query: z.string().describe("Search query for playbook titles, descriptions, or tags"),
      },
      async (args) => {
        const playbooks = await globalMemoryManager.searchPlaybooks(args.query);

        if (playbooks.length === 0) {
          return {
            content: [{ type: "text", text: "No matching playbooks found." }],
          };
        }

        const formatted = playbooks
          .slice(0, 5)
          .map((p) => {
            const confidence = Math.round(p.confidence * 100);
            return `[${confidence}%] ${p.title}\n  ${p.description}\n  Tags: ${p.tags.join(", ")}\n  ID: ${p.id}`;
          })
          .join("\n\n");

        return {
          content: [
            { type: "text", text: `Found ${playbooks.length} playbook(s):\n\n${formatted}` },
          ],
        };
      }
    ),

    tool(
      "memory_get_playbook",
      "Get the full details of a playbook by ID, including all steps.",
      {
        id: z.string().describe("Playbook ID"),
      },
      async (args) => {
        const playbook = await globalMemoryManager.usePlaybook(args.id);

        if (!playbook) {
          return {
            content: [{ type: "text", text: `Playbook ${args.id} not found.` }],
          };
        }

        const steps = playbook.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");

        return {
          content: [
            {
              type: "text",
              text: `# ${playbook.title}\n\n${playbook.description}\n\n## Steps:\n${steps}\n\nTags: ${playbook.tags.join(", ")}`,
            },
          ],
        };
      }
    ),

    tool(
      "memory_save_playbook",
      "Save a new playbook for future reference. Use this when you've figured out " +
        "a good procedure that could help in similar future tasks.",
      {
        title: z.string().describe("Short title for the playbook"),
        description: z.string().describe("What this playbook is for"),
        steps: z.array(z.string()).describe("Step-by-step instructions"),
        tags: z.array(z.string()).describe("Tags for searching"),
      },
      async (args) => {
        const playbook = await globalMemoryManager.addPlaybook({
          title: args.title,
          description: args.description,
          steps: args.steps,
          tags: args.tags,
        });

        return {
          content: [
            { type: "text", text: `Saved playbook: ${playbook.title} (ID: ${playbook.id})` },
          ],
        };
      }
    ),

    // ========================================================================
    // Fact Tools
    // ========================================================================
    tool(
      "memory_search_facts",
      "Search for known facts about this project. Facts are things learned about " +
        "the codebase, architecture, conventions, or requirements.",
      {
        query: z.string().describe("Search query"),
        category: z.string().optional().describe("Optional category filter (e.g., 'architecture', 'convention', 'requirement')"),
      },
      async (args) => {
        const facts = await globalMemoryManager.searchFacts(args.query, args.category);

        if (facts.length === 0) {
          return {
            content: [{ type: "text", text: "No matching facts found." }],
          };
        }

        const formatted = facts
          .slice(0, 10)
          .map((f) => {
            const confidence = Math.round(f.confidence * 100);
            return `[${confidence}%] [${f.category}] ${f.statement}`;
          })
          .join("\n");

        return {
          content: [{ type: "text", text: `Found ${facts.length} fact(s):\n\n${formatted}` }],
        };
      }
    ),

    tool(
      "memory_save_fact",
      "Save a new fact about this project. Use this when you learn something " +
        "important about the codebase that future agents should know.",
      {
        category: z
          .string()
          .describe("Category (e.g., 'architecture', 'convention', 'requirement', 'dependency', 'gotcha')"),
        statement: z.string().describe("The fact statement"),
        source: z.string().optional().describe("Where this was learned from (file, documentation, etc.)"),
      },
      async (args) => {
        const fact = await globalMemoryManager.addFact({
          category: args.category,
          statement: args.statement,
          source: args.source,
        });

        return {
          content: [{ type: "text", text: `Saved fact: [${fact.category}] ${fact.statement}` }],
        };
      }
    ),

    // ========================================================================
    // Session Tools
    // ========================================================================
    tool(
      "memory_search_sessions",
      "Search past work sessions for similar tasks. Useful for learning from " +
        "previous attempts and avoiding past mistakes.",
      {
        query: z.string().describe("Search query for tasks, summaries, or lessons"),
      },
      async (args) => {
        const sessions = await globalMemoryManager.searchSessions(args.query);

        if (sessions.length === 0) {
          return {
            content: [{ type: "text", text: "No matching sessions found." }],
          };
        }

        const formatted = sessions.slice(0, 5).map((s) => {
          const outcome = s.outcome.toUpperCase();
          const date = new Date(s.startTime).toLocaleDateString();
          let text = `[${outcome}] ${date}: ${s.task}`;
          if (s.summary) text += `\n  Summary: ${s.summary}`;
          if (s.lessonsLearned && s.lessonsLearned.length > 0) {
            text += `\n  Lessons: ${s.lessonsLearned.join("; ")}`;
          }
          return text;
        }).join("\n\n");

        return {
          content: [{ type: "text", text: `Found ${sessions.length} session(s):\n\n${formatted}` }],
        };
      }
    ),

    tool(
      "memory_get_recent_sessions",
      "Get the most recent work sessions to understand recent project activity.",
      {
        count: z.number().optional().describe("Number of sessions to retrieve (default: 5)"),
      },
      async (args) => {
        const sessions = await globalMemoryManager.getRecentSessions(args.count ?? 5);

        if (sessions.length === 0) {
          return {
            content: [{ type: "text", text: "No recent sessions found." }],
          };
        }

        const formatted = sessions.map((s) => {
          const outcome = s.outcome.toUpperCase();
          const date = new Date(s.startTime).toLocaleDateString();
          return `[${outcome}] ${date}: ${s.task}${s.summary ? ` - ${s.summary}` : ""}`;
        }).join("\n");

        return {
          content: [{ type: "text", text: `Recent sessions:\n\n${formatted}` }],
        };
      }
    ),

    tool(
      "memory_record_lesson",
      "Record a lesson learned during the current task. This helps future agents " +
        "avoid the same mistakes or learn from your discoveries.",
      {
        lesson: z.string().describe("What was learned"),
        context: z.string().describe("The situation where this was learned"),
        category: z.string().optional().describe("Category (e.g., 'gotcha', 'best-practice', 'workaround')"),
      },
      async (args) => {
        // Save as a fact with the lesson category
        await globalMemoryManager.addFact({
          category: args.category ?? "lesson",
          statement: `${args.lesson} (Context: ${args.context})`,
          source: "agent-learned",
        });

        return {
          content: [{ type: "text", text: `Recorded lesson: ${args.lesson}` }],
        };
      }
    ),
  ];
}

/**
 * Create memory tools in ToolDefinition format for Copilot backend.
 * 
 * This is a simplified version of createMemoryMcpTools() that returns
 * tools in the backend-agnostic ToolDefinition format.
 */
export async function createMemoryToolDefinitions(): Promise<any[]> {
  return [
    {
      name: 'memory_search_facts',
      description: 'Search for remembered facts about the codebase.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          category: { type: 'string', description: 'Filter by category (architecture, patterns, gotchas, etc.)' },
        },
        required: ['query'],
      },
      handler: async (args: any) => {
        const facts = await globalMemoryManager.searchFacts(args.query, args.category);
        const formatted = facts.slice(0, 10).map(f => 
          `[${f.category}] ${f.statement} (source: ${f.source})`
        ).join('\n');
        return { content: [{ type: 'text', text: formatted || 'No facts found' }] };
      },
    },
    {
      name: 'memory_save_fact',
      description: 'Save a fact about the codebase for future reference.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Category (architecture, patterns, gotchas, dependencies, conventions)' },
          statement: { type: 'string', description: 'The fact to remember' },
        },
        required: ['category', 'statement'],
      },
      handler: async (args: any) => {
        await globalMemoryManager.addFact({
          category: args.category,
          statement: args.statement,
          source: 'agent',
        });
        return { content: [{ type: 'text', text: `Saved fact: ${args.statement}` }] };
      },
    },
    {
      name: 'memory_search_playbooks',
      description: 'Search for reusable procedure playbooks.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
      handler: async (args: any) => {
        const playbooks = await globalMemoryManager.searchPlaybooks(args.query);
        const formatted = playbooks.slice(0, 5).map(p => 
          `[${p.title}] ${p.description}`
        ).join('\n');
        return { content: [{ type: 'text', text: formatted || 'No playbooks found' }] };
      },
    },
    {
      name: 'memory_record_lesson',
      description: 'Record a lesson learned during the current task.',
      parameters: {
        type: 'object',
        properties: {
          lesson: { type: 'string', description: 'What was learned' },
          context: { type: 'string', description: 'The situation where this was learned' },
        },
        required: ['lesson', 'context'],
      },
      handler: async (args: any) => {
        await globalMemoryManager.addFact({
          category: 'lesson',
          statement: `${args.lesson} (Context: ${args.context})`,
          source: 'agent-learned',
        });
        return { content: [{ type: 'text', text: `Recorded lesson: ${args.lesson}` }] };
      },
    },
  ];
}
