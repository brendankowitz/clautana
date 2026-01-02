/**
 * Command identifiers for the Clautana extension.
 * These must match the command IDs defined in package.json.
 */
export const COMMANDS = {
  OPEN_PANEL: 'clautana.openPanel',
  SUBMIT_TASK: 'clautana.submitTask',
  INIT_PROJECT: 'clautana.initProject',
  SPAWN_AGENT: 'clautana.spawnAgent',
  DESTROY_AGENT: 'clautana.destroyAgent',
  SEND_TO_AGENT: 'clautana.sendToAgent',
  STOP_ALL: 'clautana.stopAll',
  VIEW_STATUS: 'clautana.viewStatus',
  REFRESH_CLAIMS: 'clautana.refreshClaims',
  PAUSE_AGENT: 'clautana.pauseAgent',
  RESUME_AGENT: 'clautana.resumeAgent',
  OPEN_CONFIG: 'clautana.openConfig',
  VIEW_MEMORY: 'clautana.viewMemory',
  OPEN_AGENT_VIEW: 'clautana.openAgentView',
  // Kanban commands
  OPEN_KANBAN: 'clautana.openKanban',
  CREATE_WORKITEM: 'clautana.createWorkItem',
  REFRESH_KANBAN: 'clautana.refreshKanban',
  // Knowledge Explorer
  OPEN_KNOWLEDGE_EXPLORER: 'clautana.openKnowledgeExplorer',
  // Message commands
  ARCHIVE_MESSAGE: 'clautana.archiveMessage',
  UNARCHIVE_MESSAGE: 'clautana.unarchiveMessage',
  VIEW_MESSAGE: 'clautana.viewMessage'
} as const;

/**
 * Configuration keys for the Clautana extension.
 * These correspond to the settings defined in package.json under contributes.configuration.
 */
export const CONFIG = {
  COORDINATOR_MODEL: 'clautana.coordinatorModel',
  WORKER_MODEL: 'clautana.workerModel',
  MAX_CONCURRENT_AGENTS: 'clautana.maxConcurrentAgents',
  AUTO_SPAWN_AGENTS: 'clautana.autoSpawnAgents',
  MCP_SERVERS: 'clautana.mcpServers',
  SHOW_CLAIMS_IN_EDITOR: 'clautana.showClaimsInEditor',
  NOTIFY_ON_AGENT_MESSAGE: 'clautana.notifyOnAgentMessage',
  WORKING_DIRECTORY: 'clautana.workingDirectory',
  AGENT_COLOR_PALETTE: 'clautana.agentColorPalette',
  MEMORY_ENABLED: 'clautana.memory.enabled',
  MEMORY_DECAY_DAYS: 'clautana.memory.decayDays',
  HOOKS_ENABLED: 'clautana.hooks.enabled',
  AUTO_REVIEW: 'clautana.autoReview'
} as const;

/**
 * View identifiers for the Clautana extension.
 */
export const VIEWS = {
  PANEL: 'clautana.panel',
  AGENTS: 'clautana.agents',
  CLAIMS: 'clautana.claims',
  MESSAGES: 'clautana.messages'
} as const;

/**
 * Color theme identifiers for file claim decorations.
 */
export const COLORS = {
  CLAIM_EXCLUSIVE_BACKGROUND: 'clautana.claimExclusiveBackground',
  CLAIM_SHARED_BACKGROUND: 'clautana.claimSharedBackground'
} as const;

/**
 * Output channel names
 */
export const OUTPUT_CHANNELS = {
  ORCHESTRATOR: 'Clautana Orchestrator',
  AGENT_POOL: 'Clautana Agents',
  HOOKS: 'Clautana Hooks',
  MEMORY: 'Clautana Memory'
} as const;
