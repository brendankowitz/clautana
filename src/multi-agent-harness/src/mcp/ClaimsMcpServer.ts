import { ClaimsTracker } from "./ClaimsTracker";

// Singleton claims tracker shared across all agents
let globalClaimsTracker: ClaimsTracker | null = null;

export function getGlobalClaimsTracker(): ClaimsTracker {
  if (!globalClaimsTracker) {
    globalClaimsTracker = new ClaimsTracker();
  }
  return globalClaimsTracker;
}

/**
 * Creates MCP tools for file path claiming/reservation.
 *
 * These tools help agents coordinate file access:
 * - reserve_file_paths: Claim ownership of file paths before editing
 * - release_claims: Release all claims held by this agent
 * - get_claims: View all current file claims
 * - check_availability: Check if specific paths are available
 *
 * @param agentName - The name of the agent these tools are for
 */
export async function createClaimsMcpTools(agentName: string): Promise<any[]> {
  const { z } = await import("zod");
  const { tool } = await import("@anthropic-ai/claude-agent-sdk");

  const tracker = getGlobalClaimsTracker();

  return [
    tool(
      "reserve_file_paths",
      "Reserve file paths before editing to prevent conflicts with other agents. " +
        "Use glob patterns like 'src/components/*.tsx' or specific paths.",
      {
        paths: z.array(z.string()).describe("File paths or glob patterns to reserve"),
        exclusive: z
          .boolean()
          .optional()
          .describe("If true, no other agent can claim these paths (default: true)"),
        reason: z.string().optional().describe("Why you need these files"),
        ttlMinutes: z
          .number()
          .optional()
          .describe("How long to hold the claim in minutes (default: 30)"),
      },
      async (args) => {
        const exclusive = args.exclusive ?? true;
        const ttlSeconds = (args.ttlMinutes ?? 30) * 60;

        try {
          // Check for conflicts
          const conflicts: string[] = [];
          for (const path of args.paths) {
            const existingClaims = tracker.getClaimsForPath(path);
            for (const claim of existingClaims) {
              if (claim.agentName !== agentName && claim.exclusive) {
                conflicts.push(`${path} is exclusively claimed by ${claim.agentName}`);
              }
            }
          }

          if (conflicts.length > 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `Cannot reserve paths - conflicts found:\n${conflicts.join("\n")}`,
                },
              ],
            };
          }

          // Add claims
          tracker.addClaims(agentName, args.paths, exclusive, args.reason, ttlSeconds);
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to reserve paths: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Reserved ${args.paths.length} path(s): ${args.paths.join(", ")}`,
            },
          ],
        };
      }
    ),

    tool(
      "release_claims",
      "Release all file path claims held by this agent",
      {},
      async () => {
        try {
          tracker.releaseClaims(agentName);

          return {
            content: [
              {
                type: "text",
                text: "All file claims released.",
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to release claims: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "get_claims",
      "View all current file claims across all agents",
      {},
      async () => {
        try {
          const claims = tracker.getAllClaims();

          if (claims.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "No active file claims.",
                },
              ],
            };
          }

          const formatted = claims
            .map((c) => {
              const exclusive = c.exclusive ? "[EXCLUSIVE]" : "[shared]";
              const expires = new Date(c.expiresAt).toLocaleTimeString();
              return `${exclusive} ${c.pathPattern} - ${c.agentName} (expires ${expires})${c.reason ? ` - ${c.reason}` : ""}`;
            })
            .join("\n");

          return {
            content: [
              {
                type: "text",
                text: `Current file claims:\n${formatted}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get claims: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "check_availability",
      "Check if specific file paths are available to claim",
      {
        paths: z.array(z.string()).describe("File paths to check"),
      },
      async (args) => {
        try {
          const results: string[] = [];

          for (const path of args.paths) {
            const claims = tracker.getClaimsForPath(path);
            const exclusiveClaims = claims.filter((c) => c.exclusive && c.agentName !== agentName);

            if (exclusiveClaims.length > 0) {
              results.push(`${path}: UNAVAILABLE (claimed by ${exclusiveClaims.map((c) => c.agentName).join(", ")})`);
            } else if (claims.length > 0) {
              results.push(`${path}: available (shared claims exist)`);
            } else {
              results.push(`${path}: available`);
            }
          }

          return {
            content: [
              {
                type: "text",
                text: results.join("\n"),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to check availability: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),
  ];
}
