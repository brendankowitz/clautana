/**
 * Safe string interpolation utility for hooks and templates
 */

export interface InterpolationOptions {
  /** Whether to throw on missing variables (default: false) */
  strict?: boolean;
  /** Value to use for missing variables (default: "") */
  defaultValue?: string;
  /** Whether to log warnings for missing variables (default: true) */
  warnOnMissing?: boolean;
}

export interface InterpolationResult {
  /** The interpolated string */
  result: string;
  /** List of variables that were found and replaced */
  replaced: string[];
  /** List of variables that were missing */
  missing: string[];
}

/**
 * Interpolate variables in a template string
 *
 * Supports {{variableName}} syntax
 *
 * @param template - The template string with {{variable}} placeholders
 * @param variables - Object containing variable values
 * @param options - Interpolation options
 * @returns Interpolation result with the final string and metadata
 *
 * @example
 * interpolate("Hello {{name}}!", { name: "World" })
 * // => { result: "Hello World!", replaced: ["name"], missing: [] }
 *
 * @example
 * interpolate("{{greeting}} {{name}}!", { greeting: "Hi" })
 * // => { result: "Hi !", replaced: ["greeting"], missing: ["name"] }
 */
export function interpolate(
  template: string,
  variables: Record<string, string | number | boolean | null | undefined>,
  options: InterpolationOptions = {}
): InterpolationResult {
  const {
    strict = false,
    defaultValue = "",
    warnOnMissing = true,
  } = options;

  const replaced: string[] = [];
  const missing: string[] = [];

  // Find all variable placeholders
  const placeholderPattern = /\{\{(\w+)\}\}/g;

  // Track which variables we've seen to avoid duplicates in the arrays
  const seenReplaced = new Set<string>();
  const seenMissing = new Set<string>();

  // First pass: identify missing variables
  let match;
  const tempPattern = new RegExp(placeholderPattern);
  while ((match = tempPattern.exec(template)) !== null) {
    const varName = match[1];

    if (!(varName in variables)) {
      if (!seenMissing.has(varName)) {
        missing.push(varName);
        seenMissing.add(varName);
      }
    } else {
      if (!seenReplaced.has(varName)) {
        replaced.push(varName);
        seenReplaced.add(varName);
      }
    }
  }

  // Warn or throw for missing variables
  if (missing.length > 0) {
    const message = `Missing variables in template: ${missing.join(", ")}`;

    if (strict) {
      throw new Error(message);
    }

    if (warnOnMissing) {
      console.warn(message);
    }
  }

  // Second pass: replace variables
  let result = template;

  // Replace known variables
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    const stringValue = value != null ? String(value) : defaultValue;
    result = result.replace(regex, stringValue);
  }

  // Replace any remaining unreplaced placeholders with default value
  result = result.replace(/\{\{\w+\}\}/g, defaultValue);

  return { result, replaced, missing };
}

/**
 * Safely interpolate variables with error handling
 *
 * This is a wrapper around interpolate() that catches errors and returns
 * a safe result even if interpolation fails.
 *
 * @param template - The template string
 * @param variables - Variable values
 * @param options - Interpolation options
 * @returns The interpolated string (or original template on error)
 */
export function safeInterpolate(
  template: string,
  variables: Record<string, string | number | boolean | null | undefined>,
  options?: InterpolationOptions
): string {
  try {
    const result = interpolate(template, variables, options);
    return result.result;
  } catch (error) {
    console.error(`Failed to interpolate template: ${error}`);
    return template;
  }
}

/**
 * Extract all variable names from a template
 *
 * @param template - The template string
 * @returns Array of unique variable names
 *
 * @example
 * extractVariables("Hello {{name}}, your score is {{score}}")
 * // => ["name", "score"]
 */
export function extractVariables(template: string): string[] {
  const variables = new Set<string>();
  const pattern = /\{\{(\w+)\}\}/g;

  let match;
  while ((match = pattern.exec(template)) !== null) {
    variables.add(match[1]);
  }

  return Array.from(variables);
}

/**
 * Validate that all required variables are present
 *
 * @param template - The template string
 * @param variables - Variable values
 * @returns Validation result
 */
export function validateVariables(
  template: string,
  variables: Record<string, unknown>
): { valid: boolean; missing: string[] } {
  const required = extractVariables(template);
  const missing = required.filter(v => !(v in variables));

  return {
    valid: missing.length === 0,
    missing,
  };
}
