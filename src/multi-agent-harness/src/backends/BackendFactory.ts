/**
 * Backend factory for creating AI backend instances
 * 
 * This factory provides a single entry point for creating backend instances,
 * making it easy to switch between Claude and Copilot (or add new backends).
 */

import { execSync } from 'child_process';
import { AgentBackend, BackendType, BackendOptions } from './types';
import { ClaudeAgentBackend } from './claude/ClaudeAgentBackend';
import { CopilotBackend } from './copilot/CopilotBackend';

/**
 * Cache for CLI detection results (to avoid repeated checks)
 */
const cliDetectionCache: {
  claude?: boolean;
  copilot?: boolean;
  lastCheck?: number;
} = {};

const CACHE_TTL_MS = 60000; // 1 minute cache

/**
 * Check if a CLI is available in PATH
 */
function isCliAvailable(command: string): boolean {
  try {
    // Use 'where' on Windows, 'which' on Unix
    const checkCommand = process.platform === 'win32' 
      ? `where ${command}` 
      : `which ${command}`;
    execSync(checkCommand, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Claude CLI is installed
 */
export function isClaudeCliInstalled(): boolean {
  const now = Date.now();
  if (cliDetectionCache.claude !== undefined && 
      cliDetectionCache.lastCheck && 
      now - cliDetectionCache.lastCheck < CACHE_TTL_MS) {
    return cliDetectionCache.claude;
  }

  // Check for 'claude' CLI in PATH
  const available = isCliAvailable('claude');
  cliDetectionCache.claude = available;
  cliDetectionCache.lastCheck = now;
  
  console.log(`[Backend Factory] Claude CLI ${available ? 'found' : 'not found'} in PATH`);
  return available;
}

/**
 * Check if Copilot CLI is installed
 */
export function isCopilotCliInstalled(): boolean {
  const now = Date.now();
  if (cliDetectionCache.copilot !== undefined && 
      cliDetectionCache.lastCheck && 
      now - cliDetectionCache.lastCheck < CACHE_TTL_MS) {
    return cliDetectionCache.copilot;
  }

  // Check for 'copilot' CLI in PATH
  const available = isCliAvailable('copilot');
  cliDetectionCache.copilot = available;
  cliDetectionCache.lastCheck = now;
  
  console.log(`[Backend Factory] Copilot CLI ${available ? 'found' : 'not found'} in PATH`);
  return available;
}

/**
 * Detect which backends are available based on installed CLIs
 */
export function detectAvailableBackends(): { claude: boolean; copilot: boolean } {
  return {
    claude: isClaudeCliInstalled(),
    copilot: isCopilotCliInstalled(),
  };
}

/**
 * Auto-detect the best available backend
 * 
 * Priority order:
 * 1. Claude (if installed) - more mature, full MCP support
 * 2. Copilot (if installed) - alternative option
 * 3. Claude (fallback) - will show helpful error if not installed
 * 
 * @returns Detected backend type
 */
export function autoDetectBackend(): BackendType {
  console.log(`[Backend Factory] Auto-detecting available backend...`);
  
  const available = detectAvailableBackends();
  
  if (available.claude) {
    console.log(`[Backend Factory] Auto-detected: Claude CLI available, using 'claude' backend`);
    return 'claude';
  }
  
  if (available.copilot) {
    console.log(`[Backend Factory] Auto-detected: Copilot CLI available, using 'copilot' backend`);
    return 'copilot';
  }
  
  // Neither found - default to Claude (will show helpful error later)
  console.log(`[Backend Factory] No CLI detected, defaulting to 'claude' backend`);
  return 'claude';
}

/**
 * Create an AI backend instance
 * 
 * @param type - Backend type to create ('claude', 'copilot', or 'auto')
 * @param options - Backend-specific options
 * @returns Backend instance
 * @throws Error if backend type is unknown
 * 
 * @example
 * ```typescript
 * // Auto-detect best available backend
 * const backend = createBackend('auto');
 * 
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
  type: BackendType | 'auto',
  options?: BackendOptions
): AgentBackend {
  // Handle auto-detection
  const resolvedType: BackendType = type === 'auto' ? autoDetectBackend() : type;
  
  console.log(`[Backend Factory] Creating ${resolvedType} backend${type === 'auto' ? ' (auto-detected)' : ''}`);

  switch (resolvedType) {
    case 'claude':
      console.log(`[Backend Factory] Instantiating Claude Agent SDK backend`);
      return new ClaudeAgentBackend(options);

    case 'copilot':
      console.log(`[Backend Factory] Instantiating Copilot SDK backend`);
      return new CopilotBackend(options);

    default:
      const exhaustiveCheck: never = resolvedType;
      throw new Error(`[Backend Factory] Unknown backend type: ${exhaustiveCheck}`);
  }
}

/**
 * Get the default backend type (with auto-detection)
 * 
 * @returns Detected or default backend type
 */
export function getDefaultBackendType(): BackendType {
  return autoDetectBackend();
}

/**
 * Check if a backend type is available (CLI installed)
 * 
 * @param type - Backend type to check
 * @returns true if backend CLI is installed
 */
export function isBackendAvailable(type: BackendType): boolean {
  switch (type) {
    case 'claude':
      return isClaudeCliInstalled();

    case 'copilot':
      return isCopilotCliInstalled();

    default:
      return false;
  }
}

/**
 * Get list of all available backend types (with installed CLIs)
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

/**
 * Clear the CLI detection cache (useful for testing or after installation)
 */
export function clearCliDetectionCache(): void {
  delete cliDetectionCache.claude;
  delete cliDetectionCache.copilot;
  delete cliDetectionCache.lastCheck;
  console.log(`[Backend Factory] CLI detection cache cleared`);
}
