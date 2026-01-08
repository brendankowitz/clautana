import { WorkItemStatus, WorkItemPriority } from "../kanban/types";

/**
 * Creates MCP tools for Kanban work item management.
 *
 * These tools help agents coordinate tasks on a shared Kanban board:
 * - list_workitems: View work items by status
 * - get_workitem: Get details of a specific work item
 * - create_workitem: Create new work items
 * - move_workitem: Move items between columns
 * - assign_workitem: Self-assign to work items
 * - unassign_workitem: Remove self-assignment
 * - update_workitem: Update item details
 * - add_workitem_note: Add progress notes
 * - cancel_workitem: Cancel a work item
 * - delete_workitem: Permanently delete a work item
 *
 * @param agentName - The name of the agent these tools are for
 */
export async function createWorkItemsMcpTools(agentName: string): Promise<any[]> {
  const { z } = await import("zod");
  const { tool } = await import("@anthropic-ai/claude-agent-sdk");
  const { getWorkItemManager } = await import("../kanban");

  return [
    tool(
      "list_workitems",
      "List User Stories on the Kanban board, optionally filtered by status",
      {
        status: z
          .enum(["todo", "doing", "code-review", "done", "cancelled"])
          .optional()
          .describe("Filter by status (omit to see all)"),
      },
      async (args) => {
        try {
          const manager = getWorkItemManager();
          const items = await manager.listItems(args.status as WorkItemStatus | undefined);

          if (items.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: args.status
                    ? `No User Stories with status "${args.status}"`
                    : "No User Stories found",
                },
              ],
            };
          }

          const formatted = items
            .map((item: any) => {
              const assignee = item.assignee ? `@${item.assignee}` : "unassigned";
              const priority = `[${item.priority.toUpperCase()}]`;
              const feature = item.featureRef ? ` [Feature: ${item.featureRef}]` : "";
              return `${item.id} ${priority} ${item.title} - ${assignee} (${item.status})${feature}`;
            })
            .join("\n");

          return {
            content: [
              {
                type: "text",
                text: `User Stories:\n${formatted}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to list User Stories: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "get_workitem",
      "Get details of a specific User Story by ID",
      {
        id: z.string().describe("User Story ID (e.g., WI-2026-001)"),
      },
      async (args) => {
        try {
          const manager = getWorkItemManager();
          const item = await manager.getItem(args.id);

          if (!item) {
            return {
              content: [
                {
                  type: "text",
                  text: `User Story not found: ${args.id}`,
                },
              ],
            };
          }

          const details = [
            `ID: ${item.id}`,
            `Title: ${item.title}`,
            `Type: ${item.type || 'story'}`,
            `Status: ${item.status}`,
            `Priority: ${item.priority}`,
            `Feature: ${item.featureRef || "none"}`,
            `Assignee: ${item.assignee || "unassigned"}`,
            `Reviewer: ${item.reviewer || "none"}`,
            `Created: ${item.created.toISOString()}`,
            `Started: ${item.started ? item.started.toISOString() : "not started"}`,
            `Completed: ${item.completed ? item.completed.toISOString() : "not completed"}`,
            `Estimated Hours: ${item.estimatedHours || "not estimated"}`,
            `Tags: ${item.tags.length > 0 ? item.tags.join(", ") : "none"}`,
            `\nDescription:\n${item.description}`,
          ].join("\n");

          return {
            content: [
              {
                type: "text",
                text: details,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get User Story: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "create_workitem",
      "Create a new User Story in the todo column. User Stories represent discrete units of work derived from Features (ADR/Investigation documents). When working on a task related to an ADR or investigation, link it to the feature using featureRef.",
      {
        title: z.string().describe("Short title for the User Story"),
        description: z.string().describe("Detailed description of what needs to be done"),
        acceptanceCriteria: z.string().optional().describe("Bullet-pointed list of acceptance criteria that define when this task is complete (e.g., '- Unit tests pass\\n- API returns 200')"),
        priority: z
          .enum(["critical", "high", "medium", "low"])
          .default("medium")
          .describe("Priority level"),
        tags: z.array(z.string()).optional().describe("Tags for categorization"),
        estimatedHours: z.number().optional().describe("Estimated AGENT HOURS to complete (not human hours)"),
        featureRef: z.string().optional().describe("Reference to parent feature folder (e.g., 'docs/features/kanban-workitems'). Use this when creating stories for ADR/investigation tasks."),
      },
      async (args) => {
        try {
          const manager = getWorkItemManager();
          const item = await manager.createItem({
            title: args.title,
            description: args.description,
            acceptanceCriteria: args.acceptanceCriteria,
            priority: args.priority as WorkItemPriority,
            tags: args.tags,
            estimatedHours: args.estimatedHours,
            featureRef: args.featureRef,
          });

          const featureInfo = item.featureRef ? ` (Feature: ${item.featureRef})` : '';
          return {
            content: [
              {
                type: "text",
                text: `Created User Story: ${item.id} - ${item.title}${featureInfo}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to create User Story: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "move_workitem",
      "Move a work item to a different column (status)",
      {
        id: z.string().describe("Work item ID"),
        newStatus: z
          .enum(["todo", "doing", "code-review", "done"])
          .describe("Target status/column"),
      },
      async (args) => {
        try {
          const manager = getWorkItemManager();
          await manager.moveItem(args.id, args.newStatus as WorkItemStatus);

          return {
            content: [
              {
                type: "text",
                text: `Moved ${args.id} to ${args.newStatus}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to move work item: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "assign_workitem",
      "Assign yourself to a work item",
      {
        id: z.string().describe("Work item ID to assign to yourself"),
      },
      async (args) => {
        try {
          const manager = getWorkItemManager();
          await manager.assignItem(args.id, agentName);

          return {
            content: [
              {
                type: "text",
                text: `Assigned ${args.id} to you (${agentName})`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to assign work item: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "unassign_workitem",
      "Unassign yourself from a work item",
      {
        id: z.string().describe("Work item ID to unassign from"),
      },
      async (args) => {
        try {
          const manager = getWorkItemManager();
          const item = await manager.getItem(args.id);

          if (!item) {
            return {
              content: [
                {
                  type: "text",
                  text: `Work item not found: ${args.id}`,
                },
              ],
            };
          }

          if (item.assignee !== agentName) {
            return {
              content: [
                {
                  type: "text",
                  text: `Cannot unassign - you are not assigned to ${args.id}`,
                },
              ],
            };
          }

          await manager.unassignItem(args.id);

          return {
            content: [
              {
                type: "text",
                text: `Unassigned yourself from ${args.id}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to unassign work item: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "update_workitem",
      "Update work item description or metadata",
      {
        id: z.string().describe("Work item ID"),
        title: z.string().optional().describe("New title"),
        description: z.string().optional().describe("New description"),
        priority: z
          .enum(["critical", "high", "medium", "low"])
          .optional()
          .describe("New priority"),
        tags: z.array(z.string()).optional().describe("New tags (replaces existing)"),
      },
      async (args) => {
        try {
          const manager = getWorkItemManager();
          const updates: any = {};

          if (args.title !== undefined) updates.title = args.title;
          if (args.description !== undefined) updates.description = args.description;
          if (args.priority !== undefined) updates.priority = args.priority as WorkItemPriority;
          if (args.tags !== undefined) updates.tags = args.tags;

          if (Object.keys(updates).length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "No updates specified",
                },
              ],
            };
          }

          await manager.updateItem(args.id, updates);

          const updatedFields = Object.keys(updates).join(", ");
          return {
            content: [
              {
                type: "text",
                text: `Updated ${args.id}: ${updatedFields}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to update work item: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "add_workitem_note",
      "Add a progress note to a work item",
      {
        id: z.string().describe("Work item ID"),
        note: z.string().describe("Progress update or note to add"),
      },
      async (args) => {
        try {
          const manager = getWorkItemManager();
          await manager.addNote(args.id, agentName, args.note);

          return {
            content: [
              {
                type: "text",
                text: `Added note to ${args.id}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to add note: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "cancel_workitem",
      "Cancel a work item (moves to cancelled, notifies coordinator)",
      {
        id: z.string().describe("Work item ID to cancel"),
        reason: z.string().describe("Reason for cancellation"),
      },
      async (args) => {
        try {
          const manager = getWorkItemManager();
          await manager.cancelItem(args.id, args.reason);

          return {
            content: [
              {
                type: "text",
                text: `Cancelled ${args.id}: ${args.reason}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to cancel work item: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "delete_workitem",
      "Permanently delete a work item file (use with caution)",
      {
        id: z.string().describe("Work item ID to delete"),
      },
      async (args) => {
        try {
          const manager = getWorkItemManager();
          await manager.deleteItem(args.id);

          return {
            content: [
              {
                type: "text",
                text: `Permanently deleted ${args.id}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to delete work item: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),
  ];
}
