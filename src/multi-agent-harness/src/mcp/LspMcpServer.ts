import * as vscode from "vscode";

/**
 * LSP result types
 */
interface LocationResult {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

interface SymbolResult {
  name: string;
  kind: string;
  location?: LocationResult;
  containerName?: string;
  range?: LocationResult["range"];
  selectionRange?: LocationResult["range"];
}

interface HoverResult {
  contents: string;
  range?: LocationResult["range"];
}

/**
 * Creates MCP tools that wrap VS Code's LSP capabilities.
 *
 * These tools allow Claude agents to use IDE-level code intelligence:
 * - Go to definition
 * - Find references
 * - Get hover information
 * - List document symbols
 * - Search workspace symbols
 * - Find implementations
 * - Get call hierarchy
 */
export async function createLspMcpTools(): Promise<any[]> {
  const { z } = await import("zod");
  const { tool } = await import("@anthropic-ai/claude-agent-sdk");

  return [
    tool(
      "lsp_go_to_definition",
      "Find where a symbol is defined. Returns file path and position.",
      {
        filePath: z.string().describe("Absolute path to the file"),
        line: z.number().describe("Line number (1-based)"),
        character: z.number().describe("Character offset (1-based)"),
      },
      async (args) => {
        try {
          const locations = await executeDefinitionProvider(
            args.filePath,
            args.line - 1,
            args.character - 1
          );
          return formatLocationsResult(locations, "definition");
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get definition: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "lsp_find_references",
      "Find all references to a symbol across the workspace.",
      {
        filePath: z.string().describe("Absolute path to the file"),
        line: z.number().describe("Line number (1-based)"),
        character: z.number().describe("Character offset (1-based)"),
        includeDeclaration: z.boolean().optional().describe("Include the declaration itself"),
      },
      async (args) => {
        try {
          const locations = await executeReferenceProvider(
            args.filePath,
            args.line - 1,
            args.character - 1,
            args.includeDeclaration ?? true
          );
          return formatLocationsResult(locations, "references");
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to find references: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "lsp_hover",
      "Get hover information (documentation, type info) for a symbol.",
      {
        filePath: z.string().describe("Absolute path to the file"),
        line: z.number().describe("Line number (1-based)"),
        character: z.number().describe("Character offset (1-based)"),
      },
      async (args) => {
        try {
          const hover = await executeHoverProvider(
            args.filePath,
            args.line - 1,
            args.character - 1
          );
          return formatHoverResult(hover);
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get hover info: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "lsp_document_symbols",
      "Get all symbols (functions, classes, variables) in a document.",
      {
        filePath: z.string().describe("Absolute path to the file"),
      },
      async (args) => {
        try {
          const symbols = await executeDocumentSymbolProvider(args.filePath);
          return formatSymbolsResult(symbols, "document symbols");
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get document symbols: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "lsp_workspace_symbols",
      "Search for symbols across the entire workspace.",
      {
        query: z.string().describe("Search query for symbol names"),
      },
      async (args) => {
        try {
          const symbols = await executeWorkspaceSymbolProvider(args.query);
          return formatSymbolsResult(symbols, "workspace symbols");
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to search workspace symbols: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "lsp_go_to_implementation",
      "Find implementations of an interface or abstract method.",
      {
        filePath: z.string().describe("Absolute path to the file"),
        line: z.number().describe("Line number (1-based)"),
        character: z.number().describe("Character offset (1-based)"),
      },
      async (args) => {
        try {
          const locations = await executeImplementationProvider(
            args.filePath,
            args.line - 1,
            args.character - 1
          );
          return formatLocationsResult(locations, "implementations");
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to find implementations: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "lsp_incoming_calls",
      "Find all functions/methods that call the function at a position.",
      {
        filePath: z.string().describe("Absolute path to the file"),
        line: z.number().describe("Line number (1-based)"),
        character: z.number().describe("Character offset (1-based)"),
      },
      async (args) => {
        try {
          const calls = await executeIncomingCallsProvider(
            args.filePath,
            args.line - 1,
            args.character - 1
          );
          return formatCallHierarchyResult(calls, "incoming calls");
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get incoming calls: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "lsp_outgoing_calls",
      "Find all functions/methods called by the function at a position.",
      {
        filePath: z.string().describe("Absolute path to the file"),
        line: z.number().describe("Line number (1-based)"),
        character: z.number().describe("Character offset (1-based)"),
      },
      async (args) => {
        try {
          const calls = await executeOutgoingCallsProvider(
            args.filePath,
            args.line - 1,
            args.character - 1
          );
          return formatCallHierarchyResult(calls, "outgoing calls");
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get outgoing calls: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "lsp_get_diagnostics",
      "Get current diagnostics (errors, warnings) for a file.",
      {
        filePath: z.string().describe("Absolute path to the file"),
      },
      async (args) => {
        try {
          const diagnostics = await getDiagnostics(args.filePath);
          return formatDiagnosticsResult(diagnostics);
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get diagnostics: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),
  ];
}

// ============================================================================
// VS Code LSP Command Executors
// ============================================================================

async function executeDefinitionProvider(
  filePath: string,
  line: number,
  character: number
): Promise<LocationResult[]> {
  try {
    const uri = vscode.Uri.file(filePath);
    const position = new vscode.Position(line, character);

    const result = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      uri,
      position
    );

    if (!result) {
      return [];
    }

    return result.map(locationToResult);
  } catch (error) {
    console.error(`LSP definition provider failed for ${filePath}:${line}:${character}`, error);
    throw error;
  }
}

async function executeReferenceProvider(
  filePath: string,
  line: number,
  character: number,
  includeDeclaration: boolean
): Promise<LocationResult[]> {
  try {
    const uri = vscode.Uri.file(filePath);
    const position = new vscode.Position(line, character);

    const result = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      uri,
      position,
      { includeDeclaration }
    );

    if (!result) {
      return [];
    }

    return result.map(locationToResult);
  } catch (error) {
    console.error(`LSP reference provider failed for ${filePath}:${line}:${character}`, error);
    throw error;
  }
}

async function executeHoverProvider(
  filePath: string,
  line: number,
  character: number
): Promise<HoverResult | null> {
  const uri = vscode.Uri.file(filePath);
  const position = new vscode.Position(line, character);

  const result = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    uri,
    position
  );

  if (!result || result.length === 0) {
    return null;
  }

  const hover = result[0];
  const contents = hover.contents
    .map((content) => {
      if (typeof content === "string") {
        return content;
      }
      if ("value" in content) {
        return content.value;
      }
      return String(content);
    })
    .join("\n\n");

  return {
    contents,
    range: hover.range ? rangeToResult(hover.range) : undefined,
  };
}

async function executeDocumentSymbolProvider(
  filePath: string
): Promise<SymbolResult[]> {
  try {
    const uri = vscode.Uri.file(filePath);

    const result = await vscode.commands.executeCommand<
      (vscode.SymbolInformation | vscode.DocumentSymbol)[]
    >("vscode.executeDocumentSymbolProvider", uri);

    if (!result) {
      return [];
    }

    return result.map(symbolToResult);
  } catch (error) {
    console.error(`LSP document symbol provider failed for ${filePath}`, error);
    throw error;
  }
}

async function executeWorkspaceSymbolProvider(
  query: string
): Promise<SymbolResult[]> {
  try {
    const result = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      query
    );

    if (!result) {
      return [];
    }

    return result.map(symbolToResult);
  } catch (error) {
    console.error(`LSP workspace symbol provider failed for query: ${query}`, error);
    throw error;
  }
}

async function executeImplementationProvider(
  filePath: string,
  line: number,
  character: number
): Promise<LocationResult[]> {
  try {
    const uri = vscode.Uri.file(filePath);
    const position = new vscode.Position(line, character);

    const result = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeImplementationProvider",
      uri,
      position
    );

    if (!result) {
      return [];
    }

    return result.map(locationToResult);
  } catch (error) {
    console.error(`LSP implementation provider failed for ${filePath}:${line}:${character}`, error);
    throw error;
  }
}

async function executeIncomingCallsProvider(
  filePath: string,
  line: number,
  character: number
): Promise<vscode.CallHierarchyIncomingCall[]> {
  const uri = vscode.Uri.file(filePath);
  const position = new vscode.Position(line, character);

  // First, prepare the call hierarchy item
  const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
    "vscode.prepareCallHierarchy",
    uri,
    position
  );

  if (!items || items.length === 0) {
    return [];
  }

  // Then get incoming calls
  const result = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
    "vscode.provideIncomingCalls",
    items[0]
  );

  return result ?? [];
}

async function executeOutgoingCallsProvider(
  filePath: string,
  line: number,
  character: number
): Promise<vscode.CallHierarchyOutgoingCall[]> {
  const uri = vscode.Uri.file(filePath);
  const position = new vscode.Position(line, character);

  // First, prepare the call hierarchy item
  const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
    "vscode.prepareCallHierarchy",
    uri,
    position
  );

  if (!items || items.length === 0) {
    return [];
  }

  // Then get outgoing calls
  const result = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
    "vscode.provideOutgoingCalls",
    items[0]
  );

  return result ?? [];
}

async function getDiagnostics(filePath: string): Promise<vscode.Diagnostic[]> {
  try {
    const uri = vscode.Uri.file(filePath);
    const diagnostics = vscode.languages.getDiagnostics(uri);
    return diagnostics ?? [];
  } catch (error) {
    console.error(`Failed to get diagnostics for ${filePath}`, error);
    throw error;
  }
}

// ============================================================================
// Result Formatters
// ============================================================================

function locationToResult(location: vscode.Location): LocationResult {
  return {
    uri: location.uri.fsPath,
    range: rangeToResult(location.range),
  };
}

function rangeToResult(range: vscode.Range): LocationResult["range"] {
  return {
    start: { line: range.start.line + 1, character: range.start.character + 1 },
    end: { line: range.end.line + 1, character: range.end.character + 1 },
  };
}

function symbolToResult(
  symbol: vscode.SymbolInformation | vscode.DocumentSymbol
): SymbolResult {
  const kindName = vscode.SymbolKind[symbol.kind];

  if ("location" in symbol) {
    // SymbolInformation
    return {
      name: symbol.name,
      kind: kindName,
      location: locationToResult(symbol.location),
      containerName: symbol.containerName,
    };
  } else {
    // DocumentSymbol
    return {
      name: symbol.name,
      kind: kindName,
      range: rangeToResult(symbol.range),
      selectionRange: rangeToResult(symbol.selectionRange),
    };
  }
}

function formatLocationsResult(
  locations: LocationResult[],
  type: string
): { content: { type: "text"; text: string }[] } {
  if (locations.length === 0) {
    return {
      content: [{ type: "text", text: `No ${type} found.` }],
    };
  }

  const formatted = locations
    .map((loc) => `${loc.uri}:${loc.range.start.line}:${loc.range.start.character}`)
    .join("\n");

  return {
    content: [
      {
        type: "text",
        text: `Found ${locations.length} ${type}:\n${formatted}`,
      },
    ],
  };
}

function formatSymbolsResult(
  symbols: SymbolResult[],
  type: string
): { content: { type: "text"; text: string }[] } {
  if (symbols.length === 0) {
    return {
      content: [{ type: "text", text: `No ${type} found.` }],
    };
  }

  const formatted = symbols
    .map((s) => {
      const loc = s.location
        ? ` @ ${s.location.uri}:${s.location.range.start.line}`
        : s.range
        ? `:${s.range.start.line}`
        : "";
      const container = s.containerName ? ` (in ${s.containerName})` : "";
      return `[${s.kind}] ${s.name}${container}${loc}`;
    })
    .join("\n");

  return {
    content: [
      {
        type: "text",
        text: `Found ${symbols.length} ${type}:\n${formatted}`,
      },
    ],
  };
}

function formatHoverResult(
  hover: HoverResult | null
): { content: { type: "text"; text: string }[] } {
  if (!hover) {
    return {
      content: [{ type: "text", text: "No hover information available." }],
    };
  }

  return {
    content: [{ type: "text", text: hover.contents }],
  };
}

function formatCallHierarchyResult(
  calls: (vscode.CallHierarchyIncomingCall | vscode.CallHierarchyOutgoingCall)[],
  type: string
): { content: { type: "text"; text: string }[] } {
  if (calls.length === 0) {
    return {
      content: [{ type: "text", text: `No ${type} found.` }],
    };
  }

  const formatted = calls
    .map((call) => {
      const item = "from" in call ? call.from : call.to;
      return `${item.name} @ ${item.uri.fsPath}:${item.range.start.line + 1}`;
    })
    .join("\n");

  return {
    content: [
      {
        type: "text",
        text: `Found ${calls.length} ${type}:\n${formatted}`,
      },
    ],
  };
}

function formatDiagnosticsResult(
  diagnostics: vscode.Diagnostic[]
): { content: { type: "text"; text: string }[] } {
  if (diagnostics.length === 0) {
    return {
      content: [{ type: "text", text: "No diagnostics found." }],
    };
  }

  const severityNames = ["Error", "Warning", "Information", "Hint"];

  const formatted = diagnostics
    .map((d) => {
      const severity = severityNames[d.severity] ?? "Unknown";
      const line = d.range.start.line + 1;
      return `[${severity}] Line ${line}: ${d.message}`;
    })
    .join("\n");

  return {
    content: [
      {
        type: "text",
        text: `Found ${diagnostics.length} diagnostics:\n${formatted}`,
      },
    ],
  };
}
