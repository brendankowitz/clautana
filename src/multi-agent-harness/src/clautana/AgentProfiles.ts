import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { getConfigManager } from "./ConfigManager";
import { validateAgentProfile } from "./validation";
import { interpolate } from "./interpolation";

/**
 * Agent profile defines a reusable agent configuration template.
 * Profiles are stored in .clautana/agents/*.json
 */
export interface AgentProfile {
  /** Unique identifier for the profile */
  id: string;
  /** Display name */
  name: string;
  /** Role description (e.g., "Senior TypeScript Developer") */
  role: string;
  /** Detailed description of the agent's capabilities */
  description?: string;
  /** Icon for UI (codicon name or emoji) */
  icon?: string;
  /** Color for visual identification */
  color?: string;

  /** Model configuration */
  model: ModelConfig;

  /** System prompt template (supports {{variable}} interpolation) */
  systemPrompt: string;

  /** Additional context to include in prompts */
  context?: {
    /** Files to always read and include */
    includeFiles?: string[];
    /** Glob patterns for relevant files */
    relevantPatterns?: string[];
    /** Additional context snippets */
    snippets?: string[];
  };

  /** Tool permissions */
  tools?: {
    /** Allowed tool patterns (glob-like) */
    allowed?: string[];
    /** Denied tool patterns */
    denied?: string[];
    /** Whether to allow file editing */
    allowEdit?: boolean;
    /** Whether to allow shell commands */
    allowShell?: boolean;
    /** Whether to allow web access */
    allowWeb?: boolean;
  };

  /** Behavioral settings */
  behavior?: {
    /** Max turns before requiring human input */
    maxTurns?: number;
    /** Max cost in USD before pausing */
    maxCostUsd?: number;
    /** Temperature setting */
    temperature?: number;
    /** Whether to auto-claim files being worked on */
    autoClaimFiles?: boolean;
    /** Whether to notify on completion */
    notifyOnComplete?: boolean;
  };

  /** Tags for categorization and search */
  tags?: string[];
}

/**
 * Model configuration - supports both Claude SDK and VS Code LLM
 */
export type ModelConfig =
  | ClaudeModelConfig
  | VSCodeLLMConfig;

export interface ClaudeModelConfig {
  /** Model provider */
  provider: "claude";
  /** Claude model ID */
  modelId: string;
  /** Optional API key override (usually from env) */
  apiKeyEnv?: string;
}

export interface VSCodeLLMConfig {
  /** Model provider */
  provider: "vscode";
  /** VS Code LLM family (e.g., "copilot-gpt-4", "copilot-gpt-3.5-turbo") */
  family?: string;
  /** Preferred model version */
  version?: string;
}

/**
 * Default model-based profiles (used when no custom profiles exist)
 */
export const DEFAULT_MODEL_PROFILES: AgentProfile[] = [
  {
    id: "claude-sonnet",
    name: "Claude Sonnet",
    role: "General AI Assistant",
    description: "Balanced Claude model - great for most tasks",
    icon: "sparkle",
    color: "#D97706",
    model: {
      provider: "claude",
      modelId: "claude-sonnet-4-20250514",
    },
    systemPrompt: `You are a helpful AI assistant working on the {{projectName}} project.

Your current task: {{focus}}

Be thorough, accurate, and helpful. Follow project conventions and best practices.`,
    tools: {
      allowEdit: true,
      allowShell: true,
      allowWeb: false,
    },
    behavior: {
      maxTurns: 50,
      autoClaimFiles: true,
    },
    tags: ["default", "claude", "balanced"],
  },
  {
    id: "claude-opus",
    name: "Claude Opus",
    role: "Expert AI Assistant",
    description: "Most capable Claude model - for complex tasks",
    icon: "star-full",
    color: "#7C3AED",
    model: {
      provider: "claude",
      modelId: "claude-opus-4-20250514",
    },
    systemPrompt: `You are an expert AI assistant with deep analytical capabilities, working on the {{projectName}} project.

Your current task: {{focus}}

Take your time to think through complex problems. Provide thorough, well-reasoned solutions.`,
    tools: {
      allowEdit: true,
      allowShell: true,
      allowWeb: true,
    },
    behavior: {
      maxTurns: 100,
      autoClaimFiles: true,
    },
    tags: ["default", "claude", "expert"],
  },
  {
    id: "claude-haiku",
    name: "Claude Haiku",
    role: "Fast AI Assistant",
    description: "Fastest Claude model - for quick tasks",
    icon: "zap",
    color: "#06B6D4",
    model: {
      provider: "claude",
      modelId: "claude-haiku-3-5-20241022",
    },
    systemPrompt: `You are a fast, efficient AI assistant working on the {{projectName}} project.

Your current task: {{focus}}

Be concise and direct. Focus on getting the task done quickly and correctly.`,
    tools: {
      allowEdit: true,
      allowShell: true,
      allowWeb: false,
    },
    behavior: {
      maxTurns: 30,
      autoClaimFiles: true,
    },
    tags: ["default", "claude", "fast"],
  },
  {
    id: "copilot-auto",
    name: "Copilot (Auto)",
    role: "VS Code Copilot Assistant",
    description: "Uses VS Code's built-in Copilot model",
    icon: "copilot",
    color: "#6366F1",
    model: {
      provider: "vscode",
      // Auto-select best available model
    },
    systemPrompt: `You are a helpful AI assistant integrated with VS Code, working on the {{projectName}} project.

Your current task: {{focus}}

You have access to the codebase and can help with development tasks.`,
    tools: {
      allowEdit: true,
      allowShell: false, // Copilot typically doesn't run shell commands
      allowWeb: false,
    },
    behavior: {
      maxTurns: 30,
      autoClaimFiles: false,
    },
    tags: ["default", "copilot", "vscode"],
  },
];

/**
 * Built-in agent profile templates
 */
export const BUILTIN_PROFILES: AgentProfile[] = [
  // Include default model profiles
  ...DEFAULT_MODEL_PROFILES,
  {
    id: "developer",
    name: "Developer",
    role: "Senior Software Developer",
    description: "General-purpose software development agent",
    icon: "code",
    color: "#3B82F6",
    model: {
      provider: "claude",
      modelId: "claude-sonnet-4-20250514",
    },
    systemPrompt: `You are a senior software developer working on the {{projectName}} project.

Your expertise includes:
- Clean code practices and design patterns
- Test-driven development
- Code review and refactoring
- Documentation

Current focus: {{focus}}

Guidelines:
- Follow existing code patterns and conventions
- Write clear, maintainable code
- Include appropriate tests
- Document complex logic`,
    tools: {
      allowEdit: true,
      allowShell: true,
      allowWeb: false,
    },
    behavior: {
      maxTurns: 50,
      autoClaimFiles: true,
    },
    tags: ["development", "coding", "general"],
  },
  {
    id: "reviewer",
    name: "Code Reviewer",
    role: "Senior Code Reviewer",
    description: "Reviews code for quality, security, and best practices",
    icon: "checklist",
    color: "#10B981",
    model: {
      provider: "claude",
      modelId: "claude-sonnet-4-20250514",
    },
    systemPrompt: `You are a senior code reviewer for the {{projectName}} project.

Your responsibilities:
- Review code for correctness and quality
- Identify potential bugs and security issues
- Suggest improvements and optimizations
- Ensure adherence to coding standards

Review focus: {{focus}}

Be constructive and specific in your feedback. Prioritize critical issues over style preferences.`,
    tools: {
      allowEdit: false,
      allowShell: false,
      allowWeb: false,
    },
    behavior: {
      maxTurns: 20,
      autoClaimFiles: false,
    },
    tags: ["review", "quality", "security"],
  },
  {
    id: "architect",
    name: "Architect",
    role: "Software Architect",
    description: "Designs system architecture and makes high-level decisions",
    icon: "symbol-structure",
    color: "#8B5CF6",
    model: {
      provider: "claude",
      modelId: "claude-sonnet-4-20250514",
    },
    systemPrompt: `You are a software architect for the {{projectName}} project.

Your responsibilities:
- Design system architecture
- Make technology decisions
- Define patterns and conventions
- Plan technical roadmap
- Document architectural decisions

Focus area: {{focus}}

Consider scalability, maintainability, and team capabilities in your decisions.`,
    tools: {
      allowEdit: true,
      allowShell: false,
      allowWeb: true,
    },
    behavior: {
      maxTurns: 30,
      autoClaimFiles: false,
    },
    tags: ["architecture", "design", "planning"],
  },
  {
    id: "tester",
    name: "Test Engineer",
    role: "QA & Test Engineer",
    description: "Writes and maintains tests, ensures quality",
    icon: "beaker",
    color: "#F59E0B",
    model: {
      provider: "claude",
      modelId: "claude-sonnet-4-20250514",
    },
    systemPrompt: `You are a test engineer for the {{projectName}} project.

Your responsibilities:
- Write comprehensive unit tests
- Create integration tests
- Improve test coverage
- Identify edge cases
- Maintain test infrastructure

Focus: {{focus}}

Aim for high coverage with meaningful assertions. Consider edge cases and error scenarios.`,
    tools: {
      allowEdit: true,
      allowShell: true,
      allowWeb: false,
    },
    behavior: {
      maxTurns: 40,
      autoClaimFiles: true,
    },
    tags: ["testing", "quality", "qa"],
  },
  {
    id: "documenter",
    name: "Documentation Writer",
    role: "Technical Writer",
    description: "Creates and maintains documentation",
    icon: "book",
    color: "#EC4899",
    model: {
      provider: "claude",
      modelId: "claude-sonnet-4-20250514",
    },
    systemPrompt: `You are a technical writer for the {{projectName}} project.

Your responsibilities:
- Write clear API documentation
- Create user guides and tutorials
- Document architecture and decisions
- Maintain README files
- Write inline code documentation

Focus: {{focus}}

Write for your audience. Be clear, concise, and include examples.`,
    tools: {
      allowEdit: true,
      allowShell: false,
      allowWeb: true,
    },
    behavior: {
      maxTurns: 30,
      autoClaimFiles: true,
    },
    tags: ["documentation", "writing", "technical"],
  },
];

/**
 * Agent Profile Manager - loads and manages agent profiles
 */
class AgentProfileManager {
  private profiles: Map<string, AgentProfile> = new Map();
  private loaded = false;

  /**
   * Load profiles from .clautana/agents/ and built-ins
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    // Load built-in profiles
    for (const profile of BUILTIN_PROFILES) {
      this.profiles.set(profile.id, profile);
    }

    // Load custom profiles from .clautana/agents/
    const configManager = getConfigManager();
    const agentsDir = path.join(configManager.getClautanaPath(), "agents");

    try {
      await fs.mkdir(agentsDir, { recursive: true });
      const files = await fs.readdir(agentsDir);

      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        try {
          const content = await fs.readFile(path.join(agentsDir, file), "utf-8");
          const parsed = JSON.parse(content);

          // Validate using Zod schema
          const validation = validateAgentProfile(parsed);
          if (!validation.success) {
            console.warn(`Invalid agent profile in ${file}: ${validation.error}`);
            continue;
          }

          const profile = validation.data!;
          // Custom profiles override built-ins
          this.profiles.set(profile.id, profile);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`Failed to load agent profile ${file}: ${message}`);
        }
      }
    } catch (err) {
      // Directory doesn't exist yet - this is fine
      if (err instanceof Error && !err.message.includes("ENOENT")) {
        console.warn(`Error loading agent profiles: ${err.message}`);
      }
    }

    this.loaded = true;
  }

  /**
   * Get a profile by ID
   */
  async getProfile(id: string): Promise<AgentProfile | undefined> {
    await this.load();
    return this.profiles.get(id);
  }

  /**
   * Get all profiles
   */
  async getAllProfiles(): Promise<AgentProfile[]> {
    await this.load();
    return Array.from(this.profiles.values());
  }

  /**
   * Get profiles by tag
   */
  async getProfilesByTag(tag: string): Promise<AgentProfile[]> {
    await this.load();
    return Array.from(this.profiles.values()).filter(
      (p) => p.tags?.includes(tag)
    );
  }

  /**
   * Save a custom profile
   */
  async saveProfile(profile: AgentProfile): Promise<void> {
    const configManager = getConfigManager();
    const agentsDir = path.join(configManager.getClautanaPath(), "agents");
    await fs.mkdir(agentsDir, { recursive: true });

    const filePath = path.join(agentsDir, `${profile.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(profile, null, 2), "utf-8");

    this.profiles.set(profile.id, profile);
  }

  /**
   * Delete a custom profile
   */
  async deleteProfile(id: string): Promise<boolean> {
    // Can't delete built-in profiles
    if (BUILTIN_PROFILES.some((p) => p.id === id)) {
      return false;
    }

    const configManager = getConfigManager();
    const filePath = path.join(configManager.getClautanaPath(), "agents", `${id}.json`);

    try {
      await fs.unlink(filePath);
      this.profiles.delete(id);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Build system prompt from profile with variable interpolation
   */
  buildSystemPrompt(
    profile: AgentProfile,
    variables: Record<string, string>
  ): string {
    const result = interpolate(
      profile.systemPrompt,
      variables,
      {
        strict: false,
        defaultValue: "",
        warnOnMissing: true,
      }
    );

    // Log additional context for debugging
    if (result.missing.length > 0) {
      console.warn(
        `Profile '${profile.id}' is missing variables: ${result.missing.join(", ")}. ` +
        "Using empty strings as defaults."
      );
    }

    return result.result;
  }

  /**
   * Reload profiles from disk
   */
  async reload(): Promise<void> {
    this.loaded = false;
    this.profiles.clear();
    await this.load();
  }
}

// Singleton
const globalProfileManager = new AgentProfileManager();

export function getProfileManager(): AgentProfileManager {
  return globalProfileManager;
}

/**
 * Check if VS Code LLM API is available
 */
export async function isVSCodeLLMAvailable(): Promise<boolean> {
  try {
    // Check if vscode.lm exists and has models
    if (typeof vscode.lm === "undefined") {
      return false;
    }

    const models = await vscode.lm.selectChatModels({});
    return models.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get available VS Code LLM models
 */
export async function getVSCodeLLMModels(): Promise<Array<{ id: string; family: string; version: string }>> {
  try {
    if (typeof vscode.lm === "undefined") {
      return [];
    }

    const models = await vscode.lm.selectChatModels({});
    return models.map((m) => ({
      id: m.id,
      family: m.family,
      version: m.version,
    }));
  } catch {
    return [];
  }
}
