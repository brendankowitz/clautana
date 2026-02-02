import { createLspMcpTools } from "./LspMcpServer";
import { createMailMcpTools, createMailToolDefinitions } from "./MailMcpServer";
import { createClaimsMcpTools } from "./ClaimsMcpServer";
import { createMemoryMcpTools, createMemoryToolDefinitions } from "./MemoryMcpServer";
import { createWorkItemsMcpTools } from "./WorkItemsMcpServer";

/**
 * Creates an MCP server instance with all extension-provided tools.
 * 
 * FOR CLAUDE BACKEND ONLY.
 *
 * This combines:
 * - LSP tools (go-to-definition, find-references, hover, etc.)
 * - Mail tools (send_message, inbox, etc.)
 * - Claims tools (reserve_file_paths, release_claims, etc.)
 * - Memory tools (playbooks, facts, sessions)
 * - Work Items tools (list_workitems, create_workitem, assign_workitem, etc.)
 *
 * @param agentName - The name of the agent these tools are for
 * @returns An SDK MCP server instance
 */
export async function createExtensionMcpServer(agentName: string): Promise<any> {
  const { createSdkMcpServer } = await import("@anthropic-ai/claude-agent-sdk");

  // Get all tool definitions
  const [lspTools, mailTools, claimsTools, memoryTools, workItemsTools] = await Promise.all([
    createLspMcpTools(),
    createMailMcpTools(agentName),
    createClaimsMcpTools(agentName),
    createMemoryMcpTools(),
    createWorkItemsMcpTools(agentName),
  ]);

  // Create a single MCP server with all tools
  return createSdkMcpServer({
    name: "clautana",
    version: "1.0.0",
    tools: [...lspTools, ...mailTools, ...claimsTools, ...memoryTools, ...workItemsTools],
  });
}

/**
 * Creates tool definitions for Copilot backend.
 * 
 * FOR COPILOT BACKEND ONLY.
 * 
 * Returns tools in ToolDefinition format (not MCP servers).
 * This is a subset of the full MCP tools since Copilot doesn't support MCP.
 *
 * @param agentName - The name of the agent these tools are for
 * @returns Array of ToolDefinition objects
 */
export async function createExtensionToolDefinitions(agentName: string): Promise<any[]> {
  // Get tool definitions from each server that supports ToolDefinition format
  const [mailTools, memoryTools, claimsTools, workItemsTools] = await Promise.all([
    createMailToolDefinitions(agentName),
    createMemoryToolDefinitions(),
    createClaimsToolDefinitions(agentName),
    createWorkItemsToolDefinitions(agentName),
  ]);

  // Note: LSP tools are complex and VS Code-specific, simplified version below
  const lspTools = createLspToolDefinitions();

  return [...lspTools, ...mailTools, ...memoryTools, ...claimsTools, ...workItemsTools];
}

/**
 * Simplified LSP tools for Copilot backend.
 * Full LSP support requires VS Code Language Server integration.
 */
function createLspToolDefinitions(): any[] {
  return [
    {
      name: 'lsp_hover',
      description: 'Get type information and documentation for a symbol at a position.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the file' },
          line: { type: 'number', description: 'Line number (1-based)' },
          character: { type: 'number', description: 'Character position (1-based)' },
        },
        required: ['filePath', 'line', 'character'],
      },
      handler: async (_args: any) => {
        return { content: [{ type: 'text', text: 'LSP hover not available in Copilot backend. Use code inspection tools.' }] };
      },
    },
    {
      name: 'lsp_go_to_definition',
      description: 'Find where a symbol is defined.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the file' },
          line: { type: 'number', description: 'Line number (1-based)' },
          character: { type: 'number', description: 'Character position (1-based)' },
        },
        required: ['filePath', 'line', 'character'],
      },
      handler: async (_args: any) => {
        return { content: [{ type: 'text', text: 'LSP go-to-definition not available in Copilot backend. Use grep/search tools.' }] };
      },
    },
  ];
}

/**
 * Claims tools in ToolDefinition format for Copilot backend.
 */
async function createClaimsToolDefinitions(agentName: string): Promise<any[]> {
  const { getGlobalClaimsTracker } = await import('./ClaimsMcpServer');
  const claimsTracker = getGlobalClaimsTracker();

  return [
    {
      name: 'reserve_file_paths',
      description: 'Reserve file paths to prevent other agents from editing them.',
      parameters: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' }, description: 'File paths to reserve' },
          exclusive: { type: 'boolean', description: 'Whether to claim exclusively' },
          reason: { type: 'string', description: 'Why you need these files' },
        },
        required: ['paths'],
      },
      handler: async (args: any) => {
        const ttl = 3600000; // 1 hour
        claimsTracker.addClaims(agentName, args.paths, args.exclusive ?? false, args.reason ?? '', ttl);
        return { content: [{ type: 'text', text: `Reserved ${args.paths.length} file(s)` }] };
      },
    },
    {
      name: 'release_claims',
      description: 'Release your file claims.',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        claimsTracker.releaseClaims(agentName);
        return { content: [{ type: 'text', text: 'Released all claims' }] };
      },
    },
    {
      name: 'get_claims',
      description: 'See what files are claimed by agents.',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        const claims = claimsTracker.getAllClaims();
        const formatted = claims.map(c => `${c.agentName}: ${c.pathPattern} (${c.exclusive ? 'exclusive' : 'shared'})`).join('\n');
        return { content: [{ type: 'text', text: formatted || 'No active claims' }] };
      },
    },
  ];
}

/**
 * Work Items tools in ToolDefinition format for Copilot backend.
 */
async function createWorkItemsToolDefinitions(agentName: string): Promise<any[]> {
  return [
    {
      name: 'list_workitems',
      description: 'List work items from the Kanban board.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status (todo, doing, code-review, done)' },
        },
        required: [],
      },
      handler: async (args: any) => {
        const { getWorkItemManager } = await import('../kanban');
        const workItemManager = getWorkItemManager();
        const items = await workItemManager.listItems(args.status);
        return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
      },
    },
    {
      name: 'move_workitem',
      description: 'Move a work item to a different status.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Work item ID' },
          status: { type: 'string', enum: ['todo', 'doing', 'code-review', 'done'], description: 'New status' },
        },
        required: ['id', 'status'],
      },
      handler: async (args: any) => {
        const { getWorkItemManager } = await import('../kanban');
        const workItemManager = getWorkItemManager();
        await workItemManager.moveItem(args.id, args.status);
        return { content: [{ type: 'text', text: `Moved ${args.id} to ${args.status}` }] };
      },
    },
    {
      name: 'add_workitem_note',
      description: 'Add a progress note to a work item.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Work item ID' },
          note: { type: 'string', description: 'Note to add' },
        },
        required: ['id', 'note'],
      },
      handler: async (args: any) => {
        const { getWorkItemManager } = await import('../kanban');
        const workItemManager = getWorkItemManager();
        await workItemManager.addNote(args.id, agentName, args.note);
        return { content: [{ type: 'text', text: `Added note to ${args.id}` }] };
      },
    },
  ];
}

/**
 * Get the list of all extension-provided tool names for permission configuration.
 */
export function getExtensionToolNames(): string[] {
  return [
    // LSP tools
    "mcp__clautana__lsp_go_to_definition",
    "mcp__clautana__lsp_find_references",
    "mcp__clautana__lsp_hover",
    "mcp__clautana__lsp_document_symbols",
    "mcp__clautana__lsp_workspace_symbols",
    "mcp__clautana__lsp_go_to_implementation",
    "mcp__clautana__lsp_incoming_calls",
    "mcp__clautana__lsp_outgoing_calls",
    "mcp__clautana__lsp_get_diagnostics",
    // Mail tools
    "mcp__clautana__send_message",
    "mcp__clautana__inbox",
    "mcp__clautana__mark_message_read",
    "mcp__clautana__delete_message",
    // Claims tools
    "mcp__clautana__reserve_file_paths",
    "mcp__clautana__release_claims",
    "mcp__clautana__get_claims",
    "mcp__clautana__check_availability",
    // Memory tools
    "mcp__clautana__memory_search_playbooks",
    "mcp__clautana__memory_get_playbook",
    "mcp__clautana__memory_save_playbook",
    "mcp__clautana__memory_search_facts",
    "mcp__clautana__memory_save_fact",
    "mcp__clautana__memory_search_sessions",
    "mcp__clautana__memory_get_recent_sessions",
    "mcp__clautana__memory_record_lesson",
    // Work Items tools
    "mcp__clautana__list_workitems",
    "mcp__clautana__get_workitem",
    "mcp__clautana__create_workitem",
    "mcp__clautana__move_workitem",
    "mcp__clautana__assign_workitem",
    "mcp__clautana__unassign_workitem",
    "mcp__clautana__update_workitem",
    "mcp__clautana__add_workitem_note",
    "mcp__clautana__cancel_workitem",
    "mcp__clautana__delete_workitem",
  ];
}
