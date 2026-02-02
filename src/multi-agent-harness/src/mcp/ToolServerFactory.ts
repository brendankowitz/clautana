/**
 * Backend-aware tool server factory
 * 
 * Creates tool servers that work with both Claude (MCP) and Copilot (direct tools).
 * 
 * Claude: Uses createSdkMcpServer() to wrap tools as MCP servers
 * Copilot: Converts tools to Copilot's defineTool() format directly
 * 
 * This abstraction allows the same tool definitions to work with both backends.
 */

import { ToolDefinition, JsonSchema, BackendType } from '../backends/types';

/**
 * Result of creating a tool server
 */
export interface ToolServerResult {
  /** For Claude: MCP server instance. For Copilot: array of tool definitions */
  server: unknown;
  /** List of tool names for permission configuration */
  toolNames: string[];
  /** Whether this is an MCP server (Claude) or direct tools (Copilot) */
  isMcpServer: boolean;
}

/**
 * Convert a Zod-style tool definition to backend-agnostic ToolDefinition
 * 
 * This is a helper for migrating existing Claude tools to the abstraction.
 */
export function createToolDefinition(
  name: string,
  description: string,
  parameters: JsonSchema,
  handler: (args: Record<string, unknown>) => Promise<unknown>
): ToolDefinition {
  return { name, description, parameters, handler };
}

/**
 * Create a tool server for the specified backend type.
 * 
 * @param backendType - 'claude' or 'copilot'
 * @param serverName - Name of the server (used for MCP server naming)
 * @param tools - Array of backend-agnostic tool definitions
 * @returns ToolServerResult with server instance and metadata
 */
export async function createToolServer(
  backendType: BackendType,
  serverName: string,
  tools: ToolDefinition[]
): Promise<ToolServerResult> {
  const toolNames = tools.map(t => 
    backendType === 'claude' ? `mcp__${serverName}__${t.name}` : t.name
  );

  if (backendType === 'claude') {
    // Claude: Create MCP server
    const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk');
    const { z } = await import('zod');
    
    // Convert tools to Claude format
    const claudeTools = tools.map(t => 
      tool(
        t.name,
        t.description,
        jsonSchemaToZod(t.parameters, z) as any,
        t.handler
      )
    );
    
    const server = createSdkMcpServer({
      name: serverName,
      version: '1.0.0',
      tools: claudeTools,
    });
    
    return { server, toolNames, isMcpServer: true };
  } else {
    // Copilot: Return tools directly (will be converted by CopilotBackend)
    return { server: tools, toolNames, isMcpServer: false };
  }
}

/**
 * Convert JSON Schema to Zod schema for Claude SDK compatibility
 * 
 * This is needed because Claude SDK uses Zod internally.
 */
function jsonSchemaToZod(schema: JsonSchema, z: typeof import('zod').z): unknown {
  let zodSchema: unknown;

  // Handle enum first
  if (schema.enum && schema.enum.length > 0) {
    if (schema.enum.every(v => typeof v === 'string')) {
      zodSchema = z.enum(schema.enum as [string, ...string[]]);
    } else {
      const literals = schema.enum.map(v => z.literal(v as string | number | boolean));
      if (literals.length >= 2) {
        zodSchema = z.union(literals as [typeof literals[0], typeof literals[0], ...typeof literals]);
      } else if (literals.length === 1) {
        zodSchema = literals[0];
      } else {
        zodSchema = z.never();
      }
    }
  } else {
    // Handle by type
    switch (schema.type) {
      case 'string': {
        let s = z.string();
        if (schema.minLength !== undefined) s = s.min(schema.minLength);
        if (schema.maxLength !== undefined) s = s.max(schema.maxLength);
        if (schema.pattern) s = s.regex(new RegExp(schema.pattern));
        zodSchema = s;
        break;
      }
      case 'number': {
        let n = z.number();
        if (schema.minimum !== undefined) n = n.min(schema.minimum);
        if (schema.maximum !== undefined) n = n.max(schema.maximum);
        zodSchema = n;
        break;
      }
      case 'boolean':
        zodSchema = z.boolean();
        break;
      case 'object': {
        if (!schema.properties) {
          zodSchema = schema.additionalProperties === false 
            ? z.object({}).strict() 
            : z.record(z.unknown());
        } else {
          const shape: Record<string, unknown> = {};
          const required = new Set(schema.required || []);
          for (const [key, propSchema] of Object.entries(schema.properties)) {
            let propZod = jsonSchemaToZod(propSchema, z);
            if (!required.has(key)) {
              propZod = (propZod as any).optional();
            }
            shape[key] = propZod;
          }
          zodSchema = z.object(shape as any);
        }
        break;
      }
      case 'array':
        zodSchema = schema.items 
          ? z.array(jsonSchemaToZod(schema.items, z) as any)
          : z.array(z.unknown());
        break;
      case 'null':
        zodSchema = z.null();
        break;
      default:
        zodSchema = z.unknown();
    }
  }

  // Add description
  if (schema.description && typeof (zodSchema as any).describe === 'function') {
    zodSchema = (zodSchema as any).describe(schema.description);
  }

  // Add default
  if (schema.default !== undefined && typeof (zodSchema as any).default === 'function') {
    zodSchema = (zodSchema as any).default(schema.default);
  }

  return zodSchema;
}

/**
 * Helper to merge multiple tool servers into session config
 * 
 * @param backendType - Backend type
 * @param servers - Array of ToolServerResult
 * @returns Object suitable for SessionConfig
 */
export function mergeToolServers(
  backendType: BackendType,
  servers: { name: string; result: ToolServerResult }[]
): { mcpServers?: Record<string, unknown>; tools?: ToolDefinition[]; allowedTools: string[] } {
  const allowedTools: string[] = [];
  
  if (backendType === 'claude') {
    // Claude: Merge MCP servers
    const mcpServers: Record<string, unknown> = {};
    for (const { name, result } of servers) {
      mcpServers[name] = result.server;
      allowedTools.push(...result.toolNames);
    }
    return { mcpServers, allowedTools };
  } else {
    // Copilot: Merge tool arrays
    const tools: ToolDefinition[] = [];
    for (const { result } of servers) {
      if (Array.isArray(result.server)) {
        tools.push(...(result.server as ToolDefinition[]));
      }
      allowedTools.push(...result.toolNames);
    }
    return { tools, allowedTools };
  }
}
