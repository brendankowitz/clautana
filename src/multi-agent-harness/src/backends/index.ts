/**
 * Backend abstraction layer for Clautana multi-agent system
 * 
 * This module provides a unified interface for multiple AI backends
 * (Claude Agent SDK, GitHub Copilot SDK, etc.).
 * 
 * ## Usage
 * 
 * ```typescript
 * import { createBackend, BackendType } from './backends';
 * 
 * // Create a backend
 * const backend = createBackend('claude');
 * 
 * // Create a session
 * const session = await backend.createSession({
 *   workingDirectory: '/path/to/project',
 *   systemPrompt: 'You are a helpful assistant',
 *   model: 'claude-sonnet-4-20250514'
 * });
 * 
 * // Send a prompt and process responses
 * for await (const message of session.send('Hello!')) {
 *   switch (message.type) {
 *     case 'text':
 *       console.log(message.content);
 *       break;
 *     case 'toolCall':
 *       console.log(`Calling tool: ${message.toolCall?.name}`);
 *       break;
 *     case 'complete':
 *       console.log('Done!');
 *       break;
 *   }
 * }
 * 
 * // Cleanup
 * await session.destroy();
 * await backend.dispose();
 * ```
 * 
 * ## Current Status
 * 
 * - ✅ Claude Agent SDK: Fully implemented
 * - ✅ Copilot SDK: Fully implemented
 * 
 * ## Architecture
 * 
 * The abstraction follows a simple pattern:
 * 
 * 1. **AgentBackend**: Factory for creating sessions
 * 2. **BackendSession**: Manages a single conversation
 * 3. **AgentMessage**: Unified message format
 * 4. **ToolDefinition**: Backend-agnostic tool definitions
 * 
 * Each backend (Claude, Copilot) implements these interfaces and converts
 * to/from its native SDK format.
 */

// Core types and interfaces
export type {
  BackendType,
  AgentBackend,
  BackendSession,
  SessionConfig,
  SendOptions,
  AgentMessage,
  AgentMessageType,
  ToolDefinition,
  JsonSchema,
  BackendOptions,
} from './types';

// Factory functions
export {
  createBackend,
  getDefaultBackendType,
  isBackendAvailable,
  getAvailableBackends,
  getBackendName,
  autoDetectBackend,
  detectAvailableBackends,
  isClaudeCliInstalled,
  isCopilotCliInstalled,
  clearCliDetectionCache,
} from './BackendFactory';

// Claude backend (fully implemented)
export { ClaudeAgentBackend } from './claude/ClaudeAgentBackend';
export { ClaudeSession } from './claude/ClaudeSession';
export { convertToolsToClaudeFormat, validateClaudeSchema } from './claude/claudeToolAdapter';

// Copilot backend (fully implemented)
export { CopilotBackend } from './copilot/CopilotBackend';
export { CopilotSession } from './copilot/CopilotSession';
export { convertToolsToCopilotFormat, jsonSchemaToZod, validateZodSchema } from './copilot/copilotToolAdapter';
export type { CopilotToolDefinition } from './copilot/copilotToolAdapter';
