/**
 * Types for the .clautana project configuration system
 *
 * The .clautana/ folder contains:
 * - config.json: Project-specific agent settings
 * - memory/: Persistent agent memory (playbooks, facts, sessions)
 * - hooks/: Custom hook scripts
 * - specs/: Task specifications (optional, can use spec-kit)
 */

/**
 * Main configuration file (.clautana/config.json)
 */
export interface ClautanaConfig {
  /** Project name */
  name?: string;

  /** Project description for agent context */
  description?: string;

  /** Coding standards and conventions */
  standards?: CodingStandards;

  /** Agent behavior configuration */
  agents?: AgentDefaults;

  /** Hook definitions */
  hooks?: HookConfig[];

  /** Memory settings */
  memory?: MemoryConfig;

  /** File patterns to ignore */
  ignore?: string[];

  /** Workflow settings */
  workflow?: WorkflowConfig;
}

/**
 * Workflow mode configuration
 */
export interface WorkflowConfig {
  /** Current workflow mode */
  mode?: 'adr' | 'spec-kit' | 'hybrid' | 'auto';
}

/**
 * Coding standards for agents to follow
 */
export interface CodingStandards {
  /** Programming language preferences */
  languages?: Record<string, LanguageConfig>;

  /** General coding rules */
  rules?: string[];

  /** Architecture patterns to follow */
  patterns?: string[];

  /** Testing requirements */
  testing?: TestingConfig;
}

export interface LanguageConfig {
  /** Preferred style guide */
  styleGuide?: string;

  /** Framework preferences */
  frameworks?: string[];

  /** Linting rules reference */
  lintConfig?: string;
}

export interface TestingConfig {
  /** Testing framework */
  framework?: string;

  /** Minimum coverage percentage */
  minCoverage?: number;

  /** Test file naming pattern */
  filePattern?: string;

  /** Whether to generate tests automatically */
  autoGenerate?: boolean;
}

/**
 * Default agent behavior settings
 */
export interface AgentDefaults {
  /** Default model to use */
  model?: string;

  /** Maximum concurrent agents */
  maxConcurrent?: number;

  /** Default working directory relative to project root */
  workingDirectory?: string;

  /** Files agents should always read for context */
  contextFiles?: string[];

  /** Whether to enable auto-review on completion */
  autoReview?: boolean;
}

/**
 * Hook configuration
 */
export interface HookConfig {
  /** Unique name for this hook */
  name: string;

  /** When to trigger this hook */
  trigger: HookTrigger;

  /** What the hook should do */
  action: HookAction;

  /** Optional conditions for when to run */
  conditions?: HookCondition[];

  /** Whether this hook is enabled */
  enabled?: boolean;

  /** Priority (lower runs first) */
  priority?: number;
}

/**
 * Hook trigger types
 */
export type HookTrigger =
  | { type: "onAgentFinished"; agentName?: string }
  | { type: "onAgentError"; agentName?: string }
  | { type: "onAgentSpawned"; agentName?: string }
  | { type: "onFileSaved"; pattern?: string }
  | { type: "onFileCreated"; pattern?: string }
  | { type: "onBuildSuccess" }
  | { type: "onBuildFailure" }
  | { type: "onTestsPass" }
  | { type: "onTestsFail" }
  | { type: "onCommit" }
  | { type: "manual"; command?: string };

/**
 * Hook action types
 */
export type HookAction =
  | { type: "spawnAgent"; config: SpawnAgentAction }
  | { type: "sendMessage"; config: SendMessageAction }
  | { type: "runCommand"; config: RunCommandAction }
  | { type: "promptHuman"; config: PromptHumanAction }
  | { type: "updateMemory"; config: UpdateMemoryAction };

export interface SpawnAgentAction {
  /** Role for the new agent */
  role: string;

  /** Focus/task for the agent */
  focus: string;

  /** System prompt template (can include {{variables}}) */
  systemPrompt?: string;

  /** Wait for specific agents before starting */
  waitFor?: string[];
}

export interface SendMessageAction {
  /** Recipient (agent name or "orchestrator" or "human") */
  to: string;

  /** Message subject */
  subject: string;

  /** Message body template */
  body?: string;
}

export interface RunCommandAction {
  /** Command to execute */
  command: string;

  /** Working directory */
  cwd?: string;

  /** Whether to wait for completion */
  wait?: boolean;
}

export interface PromptHumanAction {
  /** Message to show the human */
  message: string;

  /** Type of prompt */
  promptType: "approval" | "input" | "choice";

  /** Choices for "choice" type */
  choices?: string[];

  /** Timeout in seconds (0 = no timeout) */
  timeout?: number;
}

export interface UpdateMemoryAction {
  /** Type of memory to update */
  memoryType: "playbook" | "fact" | "session";

  /** Operation */
  operation: "add" | "update" | "delete";

  /** Data to store (template with {{variables}}) */
  data?: string;
}

/**
 * Hook conditions
 */
export interface HookCondition {
  /** Variable to check */
  variable: string;

  /** Comparison operator */
  operator: "equals" | "contains" | "matches" | "exists";

  /** Value to compare against */
  value?: string;
}

/**
 * Memory configuration
 */
export interface MemoryConfig {
  /** Whether memory is enabled */
  enabled?: boolean;

  /** Decay half-life in days */
  decayDays?: number;

  /** Maximum entries per type */
  maxEntries?: {
    playbooks?: number;
    facts?: number;
    sessions?: number;
  };

  /** What to remember automatically */
  autoCapture?: {
    /** Remember successful solutions */
    solutions?: boolean;

    /** Remember errors and fixes */
    errorFixes?: boolean;

    /** Remember architectural decisions */
    decisions?: boolean;
  };
}

// ============================================================================
// Memory Types
// ============================================================================

/**
 * A playbook is a procedural memory - "how to do X"
 */
export interface Playbook {
  id: string;
  title: string;
  description: string;
  steps: string[];
  tags: string[];
  createdAt: Date;
  lastUsed: Date;
  useCount: number;
  confidence: number; // 0-1, decays over time
}

/**
 * A fact is semantic memory - "X is true about this project"
 */
export interface Fact {
  id: string;
  category: string;
  statement: string;
  source?: string; // Where this was learned
  createdAt: Date;
  lastVerified: Date;
  confidence: number;
}

/**
 * A session log is episodic memory - "what happened in session Y"
 */
export interface SessionLog {
  id: string;
  startTime: Date;
  endTime?: Date;
  task: string;
  agents: string[];
  outcome: "success" | "failure" | "partial" | "abandoned";
  summary?: string;
  filesChanged: string[];
  lessonsLearned?: string[];
}

/**
 * Complete memory store
 */
export interface MemoryStore {
  version: number;
  projectId: string;
  playbooks: Playbook[];
  facts: Fact[];
  sessions: SessionLog[];
  lastUpdated: Date;
}

// ============================================================================
// Memory Manager Types (YML-based storage)
// ============================================================================

/**
 * Type of memory storage
 */
export type MemoryType = "playbooks" | "facts" | "sessions";

/**
 * A generic memory entry stored in YML files
 */
export interface MemoryEntry {
  /** Unique identifier */
  id: string;

  /** The actual memory content */
  content: string;

  /** Array of tags for categorization */
  tags: string[];

  /** Creation timestamp (ISO string) */
  createdAt: string;

  /** Last access timestamp (ISO string) */
  lastUsed: string;

  /** How many times this entry has been used */
  useCount: number;

  /** Optional confidence score (0-1) */
  confidence?: number;

  /** Optional title for the entry */
  title?: string;

  /** Optional category for facts */
  category?: string;

  /** Optional source information */
  source?: string;
}

/**
 * Options for searching memories
 */
export interface MemorySearchOptions {
  /** Text query to search in content */
  query?: string;

  /** Filter by tags (matches any) */
  tags?: string[];

  /** Filter by minimum confidence */
  minConfidence?: number;

  /** Filter by minimum use count */
  minUseCount?: number;

  /** Filter entries created after this date */
  createdAfter?: Date;

  /** Filter entries used after this date */
  usedAfter?: Date;

  /** Maximum number of results */
  limit?: number;

  /** Sort by field */
  sortBy?: "createdAt" | "lastUsed" | "useCount" | "confidence";

  /** Sort order */
  sortOrder?: "asc" | "desc";
}

/**
 * Result of a memory search operation
 */
export interface MemorySearchResult {
  entries: MemoryEntry[];
  total: number;
  hasMore: boolean;
}

/**
 * Structure of a memory YML file
 */
export interface MemoryFile {
  entries: MemoryEntry[];
}

/**
 * Statistics about memory usage
 */
export interface MemoryStats {
  playbooks: {
    count: number;
    totalUseCount: number;
    averageConfidence: number;
  };
  facts: {
    count: number;
    totalUseCount: number;
    averageConfidence: number;
  };
  sessions: {
    count: number;
    totalUseCount: number;
    averageConfidence: number;
  };
  lastUpdated: string;
}

// ============================================================================
// Hook Event Context
// ============================================================================

/**
 * Context passed to hooks when triggered
 */
export interface HookContext {
  /** The trigger event type */
  trigger: HookTrigger["type"];

  /** Timestamp */
  timestamp: Date;

  /** Agent-related context */
  agent?: {
    name: string;
    role: string;
    focus: string;
    status: string;
    result?: unknown;
    error?: string;
  };

  /** File-related context */
  file?: {
    path: string;
    language?: string;
    changeType: "created" | "modified" | "deleted";
  };

  /** Build/test context */
  build?: {
    success: boolean;
    output?: string;
    errors?: string[];
  };

  /** Additional context variables */
  variables: Record<string, string>;
}
