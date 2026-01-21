/**
 * Copilot tool adapter
 * 
 * Converts ToolDefinition to Copilot SDK's defineTool() format.
 * Uses Zod schemas for parameter validation.
 * 
 * Reference: https://github.com/github/copilot-sdk
 */

import { z, ZodTypeAny } from 'zod';
import { ToolDefinition, JsonSchema } from '../types';

/**
 * Copilot tool definition matching SDK format
 */
export interface CopilotToolDefinition {
  name: string;
  description: string;
  parameters: ZodTypeAny;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Convert ToolDefinition array to Copilot SDK tools
 * 
 * @param tools - Array of backend-agnostic tool definitions
 * @returns Array of Copilot SDK tool configurations
 */
export function convertToolsToCopilotFormat(
  tools: ToolDefinition[]
): CopilotToolDefinition[] {
  console.log(`[Copilot Tool Adapter] Converting ${tools.length} tools to Copilot format`);
  
  return tools.map(tool => {
    console.log(`[Copilot Tool Adapter] Converting tool: ${tool.name}`);
    
    const zodSchema = jsonSchemaToZod(tool.parameters);
    
    return {
      name: tool.name,
      description: tool.description,
      parameters: zodSchema,
      handler: tool.handler,
    };
  });
}

/**
 * Convert JSON Schema to Zod schema
 * 
 * Mapping:
 * - type: 'string' -> z.string()
 * - type: 'number' -> z.number()
 * - type: 'boolean' -> z.boolean()
 * - type: 'object' -> z.object({...})
 * - type: 'array' -> z.array(...)
 * - type: 'null' -> z.null()
 * - enum: [...] -> z.enum([...]) or z.union([z.literal(...)])
 * - minimum/maximum -> .min()/.max()
 * - minLength/maxLength -> .min()/.max() on strings
 * - pattern -> .regex()
 * - description -> .describe()
 * 
 * @param schema - JSON Schema to convert
 * @param required - Whether this field is required (affects .optional())
 * @returns Zod schema object
 */
export function jsonSchemaToZod(schema: JsonSchema, required = true): ZodTypeAny {
  let zodSchema: ZodTypeAny;

  // Handle enum first (works with any type)
  if (schema.enum && schema.enum.length > 0) {
    if (schema.enum.every(v => typeof v === 'string')) {
      // String enum - use z.enum for string literals
      zodSchema = z.enum(schema.enum as [string, ...string[]]);
    } else {
      // Mixed enum - use union of literals
      const literals = schema.enum.map(v => z.literal(v as string | number | boolean));
      zodSchema = z.union(literals as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
    }
  } else {
    // Handle by type
    switch (schema.type) {
      case 'string':
        zodSchema = buildStringSchema(schema);
        break;
        
      case 'number':
        zodSchema = buildNumberSchema(schema);
        break;
        
      case 'boolean':
        zodSchema = z.boolean();
        break;
        
      case 'object':
        zodSchema = buildObjectSchema(schema);
        break;
        
      case 'array':
        zodSchema = buildArraySchema(schema);
        break;
        
      case 'null':
        zodSchema = z.null();
        break;
        
      default:
        console.warn(`[Copilot Tool Adapter] Unknown schema type: ${schema.type}, using z.unknown()`);
        zodSchema = z.unknown();
    }
  }

  // Add description if present
  if (schema.description) {
    zodSchema = zodSchema.describe(schema.description);
  }

  // Make optional if not required
  if (!required) {
    zodSchema = zodSchema.optional();
  }

  // Add default if present
  if (schema.default !== undefined) {
    zodSchema = zodSchema.default(schema.default);
  }

  return zodSchema;
}

/**
 * Build Zod string schema with constraints
 */
function buildStringSchema(schema: JsonSchema): ZodTypeAny {
  let s = z.string();
  
  if (schema.minLength !== undefined) {
    s = s.min(schema.minLength);
  }
  if (schema.maxLength !== undefined) {
    s = s.max(schema.maxLength);
  }
  if (schema.pattern) {
    s = s.regex(new RegExp(schema.pattern));
  }
  
  return s;
}

/**
 * Build Zod number schema with constraints
 */
function buildNumberSchema(schema: JsonSchema): ZodTypeAny {
  let n = z.number();
  
  if (schema.minimum !== undefined) {
    n = n.min(schema.minimum);
  }
  if (schema.maximum !== undefined) {
    n = n.max(schema.maximum);
  }
  
  return n;
}

/**
 * Build Zod object schema from JSON Schema properties
 */
function buildObjectSchema(schema: JsonSchema): ZodTypeAny {
  if (!schema.properties) {
    // No properties defined - allow any object
    if (schema.additionalProperties === false) {
      return z.object({}).strict();
    }
    return z.record(z.unknown());
  }

  const shape: Record<string, ZodTypeAny> = {};
  const requiredFields = new Set(schema.required || []);

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const isRequired = requiredFields.has(key);
    shape[key] = jsonSchemaToZod(propSchema, isRequired);
  }

  let objSchema = z.object(shape);
  
  if (schema.additionalProperties === false) {
    objSchema = objSchema.strict();
  }

  return objSchema;
}

/**
 * Build Zod array schema
 */
function buildArraySchema(schema: JsonSchema): ZodTypeAny {
  if (schema.items) {
    return z.array(jsonSchemaToZod(schema.items));
  }
  return z.array(z.unknown());
}

/**
 * Validate that a Zod schema was created correctly
 * Useful for debugging tool conversion issues
 */
export function validateZodSchema(zodSchema: ZodTypeAny, testData: unknown): { valid: boolean; error?: string } {
  try {
    zodSchema.parse(testData);
    return { valid: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: message };
  }
}
