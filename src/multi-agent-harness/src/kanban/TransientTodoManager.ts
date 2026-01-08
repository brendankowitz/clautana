import { EventEmitter } from 'events';
import { TransientTodo, TransientTodoStatus } from './types';

export interface TransientTodoInput {
  content: string;
  activeForm: string;
  status: TransientTodoStatus;
  /** Links to parent WorkItem.id (User Story) */
  storyId?: string;
}

export interface TransientTodoManagerEvents {
  todoAdded: (todo: TransientTodo) => void;
  todoUpdated: (todo: TransientTodo) => void;
  todoRemoved: (todoId: string) => void;
}

/**
 * Manages transient (in-memory) todos from Claude Code's TodoWrite tool.
 * These are ephemeral tasks that agents are currently working on.
 *
 * Unlike WorkItems which are persisted to disk, TransientTodos:
 * - Exist only in memory
 * - Auto-remove after completion (configurable delay)
 * - Represent real-time agent activity
 */
export class TransientTodoManager extends EventEmitter {
  private todos: Map<string, TransientTodo> = new Map();
  private removalTimers: Map<string, NodeJS.Timeout> = new Map();
  private todoIdCounter = 0;

  /** Default delay before auto-removing completed todos (in milliseconds) */
  private completedRemovalDelayMs: number;

  constructor(completedRemovalDelayMs: number = 2 * 60 * 1000) {
    super();
    this.completedRemovalDelayMs = completedRemovalDelayMs;
  }

  /**
   * Set the delay before completed todos are auto-removed
   */
  setCompletedRemovalDelay(delayMs: number): void {
    this.completedRemovalDelayMs = delayMs;
  }

  /**
   * Get all current transient todos
   */
  getAllTodos(): TransientTodo[] {
    return Array.from(this.todos.values());
  }

  /**
   * Get todos for a specific agent
   */
  getTodosByAgent(agentName: string): TransientTodo[] {
    return this.getAllTodos().filter(todo => todo.agentName === agentName);
  }

  /**
   * Get a specific todo by ID
   */
  getTodo(id: string): TransientTodo | undefined {
    return this.todos.get(id);
  }

  /**
   * Generate a unique todo ID for an agent
   */
  private generateId(agentName: string): string {
    this.todoIdCounter++;
    const sanitizedName = agentName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    return `tt-${sanitizedName}-${this.todoIdCounter}`;
  }

  /**
   * Sync all todos for an agent from a TodoWrite call.
   * This replaces all existing todos for the agent with the new list.
   *
   * @param agentName - Name of the agent updating its todos
   * @param todos - Array of todo items from TodoWrite
   */
  syncTodos(agentName: string, todos: TransientTodoInput[]): void {
    // Get current todos for this agent
    const existingTodos = this.getTodosByAgent(agentName);
    const existingByContent = new Map<string, TransientTodo>();

    for (const todo of existingTodos) {
      existingByContent.set(todo.content, todo);
    }

    // Track which todos we've seen in the new list
    const seenIds = new Set<string>();

    for (const input of todos) {
      const existing = existingByContent.get(input.content);

      if (existing) {
        // Update existing todo
        seenIds.add(existing.id);

        if (existing.status !== input.status || existing.activeForm !== input.activeForm || existing.storyId !== input.storyId) {
          const updated: TransientTodo = {
            ...existing,
            status: input.status,
            activeForm: input.activeForm,
            storyId: input.storyId,
            completedAt: input.status === 'completed' && existing.completedAt === null
              ? new Date()
              : existing.completedAt,
          };

          this.todos.set(existing.id, updated);
          this.emit('todoUpdated', updated);

          // Schedule removal if completed
          if (input.status === 'completed') {
            this.scheduleRemoval(existing.id);
          } else {
            // Cancel any pending removal if status changed back
            this.cancelRemoval(existing.id);
          }
        }
      } else {
        // Add new todo
        const id = this.generateId(agentName);
        const todo: TransientTodo = {
          id,
          content: input.content,
          activeForm: input.activeForm,
          status: input.status,
          agentName,
          createdAt: new Date(),
          completedAt: input.status === 'completed' ? new Date() : null,
          storyId: input.storyId,
        };

        this.todos.set(id, todo);
        seenIds.add(id);
        this.emit('todoAdded', todo);

        // Schedule removal if already completed
        if (input.status === 'completed') {
          this.scheduleRemoval(id);
        }
      }
    }

    // Remove todos that are no longer in the list (except completed ones still in timer)
    for (const existing of existingTodos) {
      if (!seenIds.has(existing.id) && !this.removalTimers.has(existing.id)) {
        this.removeTodo(existing.id);
      }
    }
  }

  /**
   * Clear all todos for an agent
   */
  clearAgentTodos(agentName: string): void {
    const agentTodos = this.getTodosByAgent(agentName);
    for (const todo of agentTodos) {
      this.removeTodo(todo.id);
    }
  }

  /**
   * Clear all todos
   */
  clearAllTodos(): void {
    const allIds = Array.from(this.todos.keys());
    for (const id of allIds) {
      this.removeTodo(id);
    }
  }

  /**
   * Schedule auto-removal of a completed todo
   */
  private scheduleRemoval(todoId: string): void {
    // Cancel any existing timer
    this.cancelRemoval(todoId);

    const timer = setTimeout(() => {
      this.removalTimers.delete(todoId);
      this.removeTodo(todoId);
    }, this.completedRemovalDelayMs);

    this.removalTimers.set(todoId, timer);
  }

  /**
   * Cancel scheduled removal of a todo
   */
  private cancelRemoval(todoId: string): void {
    const timer = this.removalTimers.get(todoId);
    if (timer) {
      clearTimeout(timer);
      this.removalTimers.delete(todoId);
    }
  }

  /**
   * Remove a todo immediately
   */
  private removeTodo(todoId: string): void {
    this.cancelRemoval(todoId);

    if (this.todos.has(todoId)) {
      this.todos.delete(todoId);
      this.emit('todoRemoved', todoId);
    }
  }

  /**
   * Dispose of the manager and clean up timers
   */
  dispose(): void {
    for (const timer of this.removalTimers.values()) {
      clearTimeout(timer);
    }
    this.removalTimers.clear();
    this.todos.clear();
    this.removeAllListeners();
  }
}

// Singleton instance
let instance: TransientTodoManager | null = null;

export function getTransientTodoManager(): TransientTodoManager {
  if (!instance) {
    instance = new TransientTodoManager();
  }
  return instance;
}
