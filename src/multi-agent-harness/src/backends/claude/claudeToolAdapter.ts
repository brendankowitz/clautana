/**
 * Tool adapter for Claude Agent SDK
 * 
 * Converts backend-agnostic ToolDefinition to Claude's tool() format
 */

import { ToolDefinition } from '../types';

/**
 * Convert ToolDefinition array to Claude SDK tools
 * 
 * The Claude SDK uses a `tool()` helper function to define tools.
 * This adapter converts our backend-agnostic format to Claude's format.
 * 
 * @param tools - Array of backend-agnostic tool definitions
 * @returns Array of Claude SDK tool configurations
 */
export async function convertToolsToClaudeFormat(
  tools: ToolDefinition[]
): Promise<any[]> {
  console.log(`[Claude Tool Adapter] Converting ${tools.length} tools to Claude format`);

  // Dynamic import of Claude SDK with error handling
  let tool: any;
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    tool = sdk.tool;
  } catch (importError) {
    console.error('[Claude Tool Adapter] Failed to import Claude SDK:', importError);
    throw new Error(
      'Claude Agent SDK not installed. Please run: npm install @anthropic-ai/claude-agent-sdk'
    );
  }

  const claudeTools = tools.map((toolDef) => {
    console.log(`[Claude Tool Adapter] Converting tool: ${toolDef.name}`);

    return tool(
      toolDef.name,
      toolDef.description,
      toolDef.parameters as any, // Claude SDK expects Zod schema, we're using JSON Schema
      async (args: Record<string, unknown>) => {
        console.log(`[Claude Tool Adapter] Executing tool: ${toolDef.name}`);
        try {
          const result = await toolDef.handler(args);
          return result;
        } catch (error) {
          console.error(
            `[Claude Tool Adapter] Tool ${toolDef.name} failed:`,
            error instanceof Error ? error.message : String(error)
          );
          throw error;
        }
      }
    );
  });

  console.log(`[Claude Tool Adapter] Converted ${claudeTools.length} tools successfully`);
  return claudeTools;
}

/**
 * Validate that a JSON Schema is compatible with Claude SDK
 * 
 * Claude SDK expects standard JSON Schema format.
 * This function validates basic compatibility.
 * 
 * @param schema - JSON Schema to validate
 * @returns true if valid, throws error if invalid
 */
export function validateClaudeSchema(schema: any): boolean {
  if (!schema || typeof schema !== 'object') {
    throw new Error('[Claude Tool Adapter] Schema must be an object');
  }

  if (!schema.type) {
    throw new Error('[Claude Tool Adapter] Schema must have a type property');
  }

  const validTypes = ['string', 'number', 'boolean', 'object', 'array', 'null'];
  if (!validTypes.includes(schema.type)) {
    throw new Error(
      `[Claude Tool Adapter] Invalid schema type: ${schema.type}. Must be one of: ${validTypes.join(', ')}`
    );
  }

  return true;
}
