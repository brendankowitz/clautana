import { EventEmitter } from "events";
import * as vscode from "vscode";
import {
  HookConfig,
  HookContext,
  HookTrigger,
  SpawnAgentAction,
  SendMessageAction,
  PromptHumanAction,
} from "./types";
import { getConfigManager } from "./ConfigManager";
import { globalMessageStore } from "../mcp/MailMcpServer";
import { AgentMessage } from "../coordinator/types";

/**
 * HooksManager processes hook triggers and executes actions.
 *
 * Hooks are triggered by:
 * - Agent lifecycle events (onAgentFinished, onAgentError, onAgentSpawned)
 * - File events (onFileSaved, onFileCreated)
 * - Build/test events (onBuildSuccess, onTestsPass, etc.)
 * - Manual triggers
 *
 * Actions include:
 * - Spawning new agents
 * - Sending messages (to agents, orchestrator, or human)
 * - Running commands
 * - Prompting human for input/approval
 * - Updating memory
 */
export class HooksManager extends EventEmitter {
  private hooks: HookConfig[] = [];
  private outputChannel: vscode.OutputChannel;

  constructor() {
    super();
    this.outputChannel = vscode.window.createOutputChannel("Clautana Hooks");
  }

  /**
   * Load hooks from configuration
   */
  async loadHooks(): Promise<void> {
    const configManager = getConfigManager();
    const config = await configManager.loadConfig();
    this.hooks = (config.hooks ?? []).filter((h) => h.enabled !== false);
    this.hooks.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    this.outputChannel.appendLine(`Loaded ${this.hooks.length} hooks`);
  }

  /**
   * Trigger hooks for an event
   */
  async trigger(triggerType: HookTrigger["type"], context: Partial<HookContext>): Promise<void> {
    const fullContext: HookContext = {
      trigger: triggerType,
      timestamp: new Date(),
      variables: {},
      ...context,
    };

    // Build variables from context
    if (context.agent) {
      fullContext.variables["agent.name"] = context.agent.name;
      fullContext.variables["agent.role"] = context.agent.role;
      fullContext.variables["agent.focus"] = context.agent.focus;
      fullContext.variables["agent.status"] = context.agent.status;
      if (context.agent.error) {
        fullContext.variables["agent.error"] = context.agent.error;
      }
    }

    if (context.file) {
      fullContext.variables["file.path"] = context.file.path;
      fullContext.variables["file.language"] = context.file.language ?? "";
      fullContext.variables["file.changeType"] = context.file.changeType;
    }

    // Find matching hooks
    const matchingHooks = this.hooks.filter((hook) => {
      if (hook.trigger.type !== triggerType) {
        return false;
      }

      // Check agent name filter
      if ("agentName" in hook.trigger && hook.trigger.agentName) {
        if (context.agent?.name !== hook.trigger.agentName) {
          return false;
        }
      }

      // Check file pattern filter
      if ("pattern" in hook.trigger && hook.trigger.pattern) {
        if (!context.file?.path.match(new RegExp(hook.trigger.pattern))) {
          return false;
        }
      }

      // Check conditions
      if (hook.conditions) {
        for (const condition of hook.conditions) {
          const value = fullContext.variables[condition.variable];
          if (!this.evaluateCondition(value, condition.operator, condition.value)) {
            return false;
          }
        }
      }

      return true;
    });

    this.outputChannel.appendLine(
      `Trigger: ${triggerType} → ${matchingHooks.length} matching hooks`
    );

    // Execute matching hooks
    for (const hook of matchingHooks) {
      try {
        await this.executeHook(hook, fullContext);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`Hook "${hook.name}" failed: ${message}`);
        this.emit("hookError", hook.name, error);
      }
    }
  }

  /**
   * Execute a single hook
   */
  private async executeHook(hook: HookConfig, context: HookContext): Promise<void> {
    this.outputChannel.appendLine(`Executing hook: ${hook.name}`);

    switch (hook.action.type) {
      case "spawnAgent":
        await this.executeSpawnAgent(hook.action.config, context);
        break;

      case "sendMessage":
        await this.executeSendMessage(hook.action.config, context);
        break;

      case "promptHuman":
        await this.executePromptHuman(hook.action.config, context);
        break;

      case "runCommand":
        await this.executeRunCommand(hook.action.config, context);
        break;

      case "updateMemory":
        await this.executeUpdateMemory(hook.action.config, context);
        break;
    }

    this.emit("hookExecuted", hook.name, context);
  }

  /**
   * Spawn a new agent
   */
  private async executeSpawnAgent(
    config: SpawnAgentAction,
    context: HookContext
  ): Promise<void> {
    const agentConfig = {
      name: `Hook-${Date.now()}`,
      role: this.interpolate(config.role, context.variables),
      focus: this.interpolate(config.focus, context.variables),
      systemPrompt: config.systemPrompt
        ? this.interpolate(config.systemPrompt, context.variables)
        : undefined,
      waitFor: config.waitFor ?? [],
    };

    this.emit("spawnAgent", agentConfig);
    this.outputChannel.appendLine(`Requested agent spawn: ${agentConfig.role}`);
  }

  /**
   * Send a message to an agent, orchestrator, or human
   */
  private async executeSendMessage(
    config: SendMessageAction,
    context: HookContext
  ): Promise<void> {
    const to = this.interpolate(config.to, context.variables);
    const subject = this.interpolate(config.subject, context.variables);
    const body = config.body
      ? this.interpolate(config.body, context.variables)
      : undefined;

    const message: AgentMessage = {
      id: crypto.randomUUID(),
      from: "hooks",
      to,
      subject,
      body,
      timestamp: new Date(),
      read: false,
    };

    // If sending to "human", show a VS Code notification
    if (to === "human") {
      const action = await vscode.window.showInformationMessage(
        `[Clautana] ${subject}`,
        "View Details",
        "Dismiss"
      );

      if (action === "View Details" && body) {
        vscode.window.showInformationMessage(body);
      }
    } else {
      // Send via the message store
      globalMessageStore.addMessage(message);
    }

    this.emit("messageSent", message);
    this.outputChannel.appendLine(`Sent message to ${to}: "${subject}"`);
  }

  /**
   * Prompt the human for input or approval
   */
  private async executePromptHuman(
    config: PromptHumanAction,
    context: HookContext
  ): Promise<void> {
    const message = this.interpolate(config.message, context.variables);

    switch (config.promptType) {
      case "approval": {
        const result = await vscode.window.showWarningMessage(
          `[Clautana Approval Required] ${message}`,
          { modal: true },
          "Approve",
          "Reject"
        );

        const approved = result === "Approve";
        this.emit("humanResponse", {
          type: "approval",
          approved,
          message,
          context,
        });

        // Send response back as a message
        const responseMessage: AgentMessage = {
          id: crypto.randomUUID(),
          from: "human",
          to: context.agent?.name ?? "orchestrator",
          subject: approved ? "Approval Granted" : "Approval Rejected",
          body: `Human ${approved ? "approved" : "rejected"}: ${message}`,
          timestamp: new Date(),
          read: false,
        };
        globalMessageStore.addMessage(responseMessage);
        break;
      }

      case "input": {
        const input = await vscode.window.showInputBox({
          prompt: message,
          placeHolder: "Enter your response...",
        });

        if (input !== undefined) {
          this.emit("humanResponse", {
            type: "input",
            input,
            message,
            context,
          });

          const responseMessage: AgentMessage = {
            id: crypto.randomUUID(),
            from: "human",
            to: context.agent?.name ?? "orchestrator",
            subject: "Human Input",
            body: input,
            timestamp: new Date(),
            read: false,
          };
          globalMessageStore.addMessage(responseMessage);
        }
        break;
      }

      case "choice": {
        const choice = await vscode.window.showQuickPick(config.choices ?? [], {
          placeHolder: message,
        });

        if (choice) {
          this.emit("humanResponse", {
            type: "choice",
            choice,
            message,
            context,
          });

          const responseMessage: AgentMessage = {
            id: crypto.randomUUID(),
            from: "human",
            to: context.agent?.name ?? "orchestrator",
            subject: "Human Choice",
            body: choice,
            timestamp: new Date(),
            read: false,
          };
          globalMessageStore.addMessage(responseMessage);
        }
        break;
      }
    }
  }

  /**
   * Run a shell command
   */
  private async executeRunCommand(
    config: { command: string; cwd?: string; wait?: boolean },
    context: HookContext
  ): Promise<void> {
    const command = this.interpolate(config.command, context.variables);
    const cwd = config.cwd
      ? this.interpolate(config.cwd, context.variables)
      : undefined;

    this.outputChannel.appendLine(`Running command: ${command}`);

    // Use VS Code terminal or task
    const terminal = vscode.window.createTerminal({
      name: "Clautana Hook",
      cwd,
    });

    terminal.sendText(command);

    if (!config.wait) {
      terminal.show();
    }

    this.emit("commandRun", { command, cwd });
  }

  /**
   * Update agent memory
   */
  private async executeUpdateMemory(
    config: { memoryType: string; operation: string; data?: string },
    context: HookContext
  ): Promise<void> {
    const data = config.data
      ? this.interpolate(config.data, context.variables)
      : undefined;

    this.emit("updateMemory", {
      memoryType: config.memoryType,
      operation: config.operation,
      data,
      context,
    });

    this.outputChannel.appendLine(
      `Memory update: ${config.operation} ${config.memoryType}`
    );
  }

  /**
   * Interpolate template variables
   */
  private interpolate(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      return variables[key.trim()] ?? match;
    });
  }

  /**
   * Evaluate a condition
   */
  private evaluateCondition(
    value: string | undefined,
    operator: string,
    expected?: string
  ): boolean {
    switch (operator) {
      case "exists":
        return value !== undefined && value !== "";
      case "equals":
        return value === expected;
      case "contains":
        return expected ? (value ?? "").includes(expected) : false;
      case "matches":
        return expected ? new RegExp(expected).test(value ?? "") : false;
      default:
        return true;
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.outputChannel.dispose();
  }
}

// Singleton instance
let globalHooksManager: HooksManager | null = null;

export function getHooksManager(): HooksManager {
  if (!globalHooksManager) {
    globalHooksManager = new HooksManager();
  }
  return globalHooksManager;
}
