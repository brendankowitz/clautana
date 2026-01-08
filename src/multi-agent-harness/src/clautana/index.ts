/**
 * Clautana - Project configuration and memory management
 *
 * This module provides:
 * - ConfigManager: Manages .clautana/config.json and folder structure
 * - MemoryManager: YML-based persistent memory storage
 * - HooksManager: Event-driven automation hooks
 * - AgentProfiles: Pre-defined and custom agent configurations
 * - Validation: Zod schemas for configuration validation
 * - Types: TypeScript interfaces for all configuration objects
 */

// Configuration management
export {
  ConfigManager,
  getConfigManager,
  initConfigManager,
} from "./ConfigManager";

// Memory management (YML-based storage)
export {
  MemoryManager,
  getMemoryManager,
  initMemoryManager,
  resetMemoryManager,
} from "./MemoryManager";

// Hooks management
export { HooksManager, getHooksManager } from "./HooksManager";

// Agent profiles
export {
  getProfileManager,
  isVSCodeLLMAvailable,
  getVSCodeLLMModels,
} from "./AgentProfiles";

// Validation schemas and functions
export {
  // Config schemas
  ClautanaConfigSchema,
  AgentDefaultsSchema,
  CodingStandardsSchema,
  MemoryConfigSchema,
  HookConfigSchema,
  HookTriggerSchema,
  HookActionSchema,
  AgentProfileSchema,

  // Memory schemas
  MemoryEntrySchema,
  MemoryFileSchema,
  MemorySearchOptionsSchema,
  CreateMemoryEntrySchema,
  UpdateMemoryEntrySchema,

  // Validation functions
  validateClautanaConfig,
  validateAgentProfile,
  validateHookConfig,
  validateMemoryEntry,
  validateMemoryFile,
  validateCreateMemoryEntry,
  validateUpdateMemoryEntry,
} from "./validation";

// Template interpolation
export {
  interpolate,
  safeInterpolate,
  extractVariables,
  validateVariables,
} from "./interpolation";

export type {
  InterpolationOptions,
  InterpolationResult,
} from "./interpolation";

// Types
export type {
  // Main config types
  ClautanaConfig,
  CodingStandards,
  LanguageConfig,
  TestingConfig,
  AgentDefaults,
  MemoryConfig,

  // Hook types
  HookConfig,
  HookTrigger,
  HookAction,
  HookCondition,
  HookContext,
  SpawnAgentAction,
  SendMessageAction,
  RunCommandAction,
  PromptHumanAction,
  UpdateMemoryAction,

  // Legacy memory types
  Playbook,
  Fact,
  SessionLog,
  MemoryStore,

  // New memory types (YML-based)
  MemoryType,
  MemoryEntry,
  MemorySearchOptions,
  MemorySearchResult,
  MemoryFile,
  MemoryStats,
} from "./types";
