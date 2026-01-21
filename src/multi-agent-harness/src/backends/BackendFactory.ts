/**
 * Backend factory for creating AI backend instances
 * 
 * This factory provides a single entry point for creating backend instances,
 * making it easy to switch between Claude and Copilot (or add new backends).
 */

import { AgentBackend, BackendType, BackendOptions } from './types';
import { ClaudeAgentBackend } from './claude/ClaudeAgentBackend';
import { CopilotBackend } from './copilot/CopilotBackend';

/**
 * Create an AI backend instance
 * 
 * @param type - Backend type to create ('claude' or 'copilot')
 * @param options - Backend-specific options
 * @returns Backend instance
 * @throws Error if backend type is unknown
 * 
 * @example
 * ```typescript
 * // Create Claude backend
 * const claudeBackend = createBackend('claude', {
 *   pathToClaudeCodeExecutable: '/custom/path/to/claude'
 * });
 * 
 * // Create Copilot backend
 * const copilotBackend = createBackend('copilot', {
 *   pathToCopilotExecutable: '/custom/path/to/copilot'
 * });
 * ```
 */
export function createBackend(
  type: BackendType,
  options?: BackendOptions
): AgentBackend {
  console.log(`[Backend Factory] Creating ${type} backend`);

  switch (type) {
    case 'claude':
      console.log(`[Backend Factory] Instantiating Claude Agent SDK backend`);
      return new ClaudeAgentBackend(options);

    case 'copilot':
      console.log(`[Backend Factory] Instantiating Copilot SDK backend`);
      return new CopilotBackend(options);

    default:
      const exhaustiveCheck: never = type;
      throw new Error(`[Backend Factory] Unknown backend type: ${exhaustiveCheck}`);
  }
}

/**
 * Get the default backend type
 * 
 * Currently defaults to 'claude' as it's the only fully implemented backend.
 * This can be overridden via configuration in the future.
 * 
 * @returns Default backend type
 */
export function getDefaultBackendType(): BackendType {
  return 'claude';
}

/**
 * Check if a backend type is available
 * 
 * @param type - Backend type to check
 * @returns true if backend is implemented and available
 */
export function isBackendAvailable(type: BackendType): boolean {
  switch (type) {
    case 'claude':
      // Claude backend is fully implemented
      return true;

    case 'copilot':
      // Copilot backend is fully implemented
      return true;

    default:
      return false;
  }
}

/**
 * Get list of all available backend types
 * 
 * @returns Array of available backend types
 */
export function getAvailableBackends(): BackendType[] {
  const allBackends: BackendType[] = ['claude', 'copilot'];
  return allBackends.filter(isBackendAvailable);
}

/**
 * Get human-readable name for a backend type
 * 
 * @param type - Backend type
 * @returns Human-readable name
 */
export function getBackendName(type: BackendType): string {
  switch (type) {
    case 'claude':
      return 'Claude Agent SDK';
    case 'copilot':
      return 'GitHub Copilot SDK';
    default:
      return 'Unknown Backend';
  }
}
