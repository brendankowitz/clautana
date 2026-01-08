import { z } from "zod";

/**
 * Zod validation schemas for Clautana configuration types
 */

// Language configuration schema
export const LanguageConfigSchema = z.object({
  styleGuide: z.string().optional(),
  frameworks: z.array(z.string()).optional(),
  lintConfig: z.string().optional(),
});

// Testing configuration schema
export const TestingConfigSchema = z.object({
  framework: z.string().optional(),
  minCoverage: z.number().min(0).max(100).optional(),
  filePattern: z.string().optional(),
  autoGenerate: z.boolean().optional(),
});

// Coding standards schema
export const CodingStandardsSchema = z.object({
  languages: z.record(z.string(), LanguageConfigSchema).optional(),
  rules: z.array(z.string()).optional(),
  patterns: z.array(z.string()).optional(),
  testing: TestingConfigSchema.optional(),
});

// Agent defaults schema
export const AgentDefaultsSchema = z.object({
  model: z.string().optional(),
  maxConcurrent: z.number().min(1).max(20).optional(),
  workingDirectory: z.string().optional(),
  contextFiles: z.array(z.string()).optional(),
  autoReview: z.boolean().optional(),
});

// Hook trigger schemas
export const HookTriggerSchema = z.union([
  z.object({ type: z.literal("onAgentFinished"), agentName: z.string().optional() }),
  z.object({ type: z.literal("onAgentError"), agentName: z.string().optional() }),
  z.object({ type: z.literal("onAgentSpawned"), agentName: z.string().optional() }),
  z.object({ type: z.literal("onFileSaved"), pattern: z.string().optional() }),
  z.object({ type: z.literal("onFileCreated"), pattern: z.string().optional() }),
  z.object({ type: z.literal("onBuildSuccess") }),
  z.object({ type: z.literal("onBuildFailure") }),
  z.object({ type: z.literal("onTestsPass") }),
  z.object({ type: z.literal("onTestsFail") }),
  z.object({ type: z.literal("onCommit") }),
  z.object({ type: z.literal("manual"), command: z.string().optional() }),
]);

// Hook action schemas
export const SpawnAgentActionSchema = z.object({
  role: z.string(),
  focus: z.string(),
  systemPrompt: z.string().optional(),
  waitFor: z.array(z.string()).optional(),
});

export const SendMessageActionSchema = z.object({
  to: z.string(),
  subject: z.string(),
  body: z.string().optional(),
});

export const RunCommandActionSchema = z.object({
  command: z.string(),
  cwd: z.string().optional(),
  wait: z.boolean().optional(),
});

export const PromptHumanActionSchema = z.object({
  message: z.string(),
  promptType: z.enum(["approval", "input", "choice"]),
  choices: z.array(z.string()).optional(),
  timeout: z.number().optional(),
});

export const UpdateMemoryActionSchema = z.object({
  memoryType: z.enum(["playbook", "fact", "session"]),
  operation: z.enum(["add", "update", "delete"]),
  data: z.string().optional(),
});

export const HookActionSchema = z.union([
  z.object({ type: z.literal("spawnAgent"), config: SpawnAgentActionSchema }),
  z.object({ type: z.literal("sendMessage"), config: SendMessageActionSchema }),
  z.object({ type: z.literal("runCommand"), config: RunCommandActionSchema }),
  z.object({ type: z.literal("promptHuman"), config: PromptHumanActionSchema }),
  z.object({ type: z.literal("updateMemory"), config: UpdateMemoryActionSchema }),
]);

// Hook condition schema
export const HookConditionSchema = z.object({
  variable: z.string(),
  operator: z.enum(["equals", "contains", "matches", "exists"]),
  value: z.string().optional(),
});

// Hook configuration schema
export const HookConfigSchema = z.object({
  name: z.string(),
  trigger: HookTriggerSchema,
  action: HookActionSchema,
  conditions: z.array(HookConditionSchema).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().optional(),
});

// Memory configuration schema
export const MemoryConfigSchema = z.object({
  enabled: z.boolean().optional(),
  decayDays: z.number().min(1).optional(),
  maxEntries: z
    .object({
      playbooks: z.number().min(1).optional(),
      facts: z.number().min(1).optional(),
      sessions: z.number().min(1).optional(),
    })
    .optional(),
  autoCapture: z
    .object({
      solutions: z.boolean().optional(),
      errorFixes: z.boolean().optional(),
      decisions: z.boolean().optional(),
    })
    .optional(),
});

// Task generation configuration schema
export const TaskGenerationConfigSchema = z.object({
  descriptionFormat: z.enum(["plain", "user-story"]).optional(),
});

// Workflow configuration schema
export const WorkflowConfigSchema = z.object({
  mode: z.enum(["adr", "spec-kit", "hybrid", "auto"]).optional(),
  taskGeneration: TaskGenerationConfigSchema.optional(),
});

// Main Clautana configuration schema
export const ClautanaConfigSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  standards: CodingStandardsSchema.optional(),
  agents: AgentDefaultsSchema.optional(),
  hooks: z.array(HookConfigSchema).optional(),
  memory: MemoryConfigSchema.optional(),
  ignore: z.array(z.string()).optional(),
  workflow: WorkflowConfigSchema.optional(),
});

// ============================================================================
// Memory Entry Schemas (YML-based storage)
// ============================================================================

/**
 * Schema for a single memory entry
 */
export const MemoryEntrySchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string()),
  createdAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  lastUsed: z.string().datetime({ offset: true }).or(z.string().datetime()),
  useCount: z.number().int().min(0),
  confidence: z.number().min(0).max(1).optional(),
  title: z.string().optional(),
  category: z.string().optional(),
  source: z.string().optional(),
});

/**
 * Schema for the memory YML file structure
 */
export const MemoryFileSchema = z.object({
  entries: z.array(MemoryEntrySchema),
});

/**
 * Schema for memory search options
 */
export const MemorySearchOptionsSchema = z.object({
  query: z.string().optional(),
  tags: z.array(z.string()).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  minUseCount: z.number().int().min(0).optional(),
  createdAfter: z.date().optional(),
  usedAfter: z.date().optional(),
  limit: z.number().int().min(1).optional(),
  sortBy: z.enum(["createdAt", "lastUsed", "useCount", "confidence"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

/**
 * Schema for creating a new memory entry (without auto-generated fields)
 */
export const CreateMemoryEntrySchema = z.object({
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
  title: z.string().optional(),
  category: z.string().optional(),
  source: z.string().optional(),
});

/**
 * Schema for updating a memory entry
 */
export const UpdateMemoryEntrySchema = z.object({
  content: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  title: z.string().optional(),
  category: z.string().optional(),
  source: z.string().optional(),
});

/**
 * Validate a memory entry
 */
export function validateMemoryEntry(data: unknown): {
  success: boolean;
  data?: z.infer<typeof MemoryEntrySchema>;
  error?: string;
} {
  try {
    const result = MemoryEntrySchema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return { success: false, error: issues };
    }
    return { success: false, error: String(error) };
  }
}

/**
 * Validate a memory file structure
 */
export function validateMemoryFile(data: unknown): {
  success: boolean;
  data?: z.infer<typeof MemoryFileSchema>;
  error?: string;
} {
  try {
    const result = MemoryFileSchema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return { success: false, error: issues };
    }
    return { success: false, error: String(error) };
  }
}

/**
 * Validate create memory entry input
 */
export function validateCreateMemoryEntry(data: unknown): {
  success: boolean;
  data?: z.infer<typeof CreateMemoryEntrySchema>;
  error?: string;
} {
  try {
    const result = CreateMemoryEntrySchema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return { success: false, error: issues };
    }
    return { success: false, error: String(error) };
  }
}

/**
 * Validate update memory entry input
 */
export function validateUpdateMemoryEntry(data: unknown): {
  success: boolean;
  data?: z.infer<typeof UpdateMemoryEntrySchema>;
  error?: string;
} {
  try {
    const result = UpdateMemoryEntrySchema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return { success: false, error: issues };
    }
    return { success: false, error: String(error) };
  }
}

// Model configuration schemas
export const ClaudeModelConfigSchema = z.object({
  provider: z.literal("claude"),
  modelId: z.string(),
  apiKeyEnv: z.string().optional(),
});

export const VSCodeLLMConfigSchema = z.object({
  provider: z.literal("vscode"),
  family: z.string().optional(),
  version: z.string().optional(),
});

export const ModelConfigSchema = z.union([ClaudeModelConfigSchema, VSCodeLLMConfigSchema]);

// Agent profile schema
export const AgentProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  model: ModelConfigSchema,
  systemPrompt: z.string(),
  context: z
    .object({
      includeFiles: z.array(z.string()).optional(),
      relevantPatterns: z.array(z.string()).optional(),
      snippets: z.array(z.string()).optional(),
    })
    .optional(),
  tools: z
    .object({
      allowed: z.array(z.string()).optional(),
      denied: z.array(z.string()).optional(),
      allowEdit: z.boolean().optional(),
      allowShell: z.boolean().optional(),
      allowWeb: z.boolean().optional(),
    })
    .optional(),
  behavior: z
    .object({
      maxTurns: z.number().min(1).optional(),
      maxCostUsd: z.number().min(0).optional(),
      temperature: z.number().min(0).max(2).optional(),
      autoClaimFiles: z.boolean().optional(),
      notifyOnComplete: z.boolean().optional(),
    })
    .optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * Validation helper functions
 */

export function validateClautanaConfig(data: unknown): {
  success: boolean;
  data?: z.infer<typeof ClautanaConfigSchema>;
  error?: string;
} {
  try {
    const result = ClautanaConfigSchema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return { success: false, error: issues };
    }
    return { success: false, error: String(error) };
  }
}

export function validateAgentProfile(data: unknown): {
  success: boolean;
  data?: z.infer<typeof AgentProfileSchema>;
  error?: string;
} {
  try {
    const result = AgentProfileSchema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return { success: false, error: issues };
    }
    return { success: false, error: String(error) };
  }
}

export function validateHookConfig(data: unknown): {
  success: boolean;
  data?: z.infer<typeof HookConfigSchema>;
  error?: string;
} {
  try {
    const result = HookConfigSchema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return { success: false, error: issues };
    }
    return { success: false, error: String(error) };
  }
}
