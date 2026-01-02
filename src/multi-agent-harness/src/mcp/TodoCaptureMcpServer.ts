import { TransientTodoStatus } from "../kanban/types";

/**
 * Creates MCP tool for capturing TodoWrite calls from agents.
 *
 * This tool allows agents to report their current todo list state,
 * which is then displayed on the Kanban board as transient items.
 *
 * @param agentName - The name of the agent these tools are for
 */
export async function createTodoCaptureMcpTools(agentName: string): Promise<any[]> {
  const { z } = await import("zod");
  const { tool } = await import("@anthropic-ai/claude-agent-sdk");
  const { getTransientTodoManager } = await import("../kanban/TransientTodoManager");

  return [
    tool(
      "capture_todos",
      "Report your current todo list state to the Kanban board. " +
      "This displays your tasks alongside persistent work items. " +
      "Call this whenever your todo list changes.",
      {
        todos: z.array(z.object({
          content: z.string().describe("The todo content (imperative form, e.g., 'Run tests')"),
          status: z.enum(["pending", "in_progress", "completed"]).describe("Current status of the todo"),
          activeForm: z.string().describe("Present continuous form shown during execution (e.g., 'Running tests')"),
        })).describe("Array of all current todos"),
      },
      async (args) => {
        try {
          const manager = getTransientTodoManager();

          const todos = args.todos.map(t => ({
            content: t.content,
            status: t.status as TransientTodoStatus,
            activeForm: t.activeForm,
          }));

          manager.syncTodos(agentName, todos);

          const summary = {
            pending: todos.filter(t => t.status === 'pending').length,
            in_progress: todos.filter(t => t.status === 'in_progress').length,
            completed: todos.filter(t => t.status === 'completed').length,
          };

          return {
            content: [
              {
                type: "text",
                text: `Updated ${agentName} todos: ${summary.pending} pending, ${summary.in_progress} in progress, ${summary.completed} completed`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to capture todos: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),

    tool(
      "clear_todos",
      "Clear all your todos from the Kanban board. " +
      "Use this when you've completed all work or are resetting your task list.",
      {},
      async () => {
        try {
          const manager = getTransientTodoManager();
          manager.clearAgentTodos(agentName);

          return {
            content: [
              {
                type: "text",
                text: `Cleared all todos for ${agentName}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to clear todos: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    ),
  ];
}
