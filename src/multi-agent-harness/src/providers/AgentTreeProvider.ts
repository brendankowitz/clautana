import * as vscode from "vscode";
import { AgentPool } from "../coordinator/AgentPool";
import { AgentState, AgentStatus } from "../types";

/**
 * Tree item representing an agent in the sidebar
 */
class AgentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly agent: AgentState,
    public readonly isOrchestrator: boolean
  ) {
    super(agent.name, vscode.TreeItemCollapsibleState.None);

    this.description = agent.role || agent.focus;
    this.tooltip = this.buildTooltip();
    this.iconPath = this.getStatusIcon();
    this.contextValue = isOrchestrator ? "orchestrator" : "agent";

    // Color the label if the agent has a color assigned
    if (agent.color) {
      this.resourceUri = vscode.Uri.parse(`agent:${agent.name}`);
    }
  }

  private buildTooltip(): string {
    const lines = [
      `Name: ${this.agent.name}`,
      `Status: ${this.agent.status}`,
    ];

    if (this.agent.role) {
      lines.push(`Role: ${this.agent.role}`);
    }

    if (this.agent.focus) {
      lines.push(`Focus: ${this.agent.focus}`);
    }

    if (this.agent.currentTask) {
      lines.push(`Task: ${this.agent.currentTask}`);
    }

    if (this.agent.waitingFor && this.agent.waitingFor.length > 0) {
      lines.push(`Waiting for: ${this.agent.waitingFor.join(", ")}`);
    }

    lines.push(`Cost: $${this.agent.costUsd.toFixed(4)}`);
    lines.push(`Tokens: ${this.agent.tokensUsed}`);

    return lines.join("\n");
  }

  private getStatusIcon(): vscode.ThemeIcon {
    if (this.isOrchestrator) {
      return new vscode.ThemeIcon("target");
    }

    // Status icons for worker agents
    switch (this.agent.status) {
      case "idle":
        return new vscode.ThemeIcon("circle-outline", new vscode.ThemeColor("charts.blue"));
      case "processing":
        return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("charts.green"));
      case "waiting":
        return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("charts.yellow"));
      case "error":
        return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("charts.red"));
      case "complete":
        return new vscode.ThemeIcon("pass", new vscode.ThemeColor("charts.green"));
      case "paused":
        return new vscode.ThemeIcon("debug-pause", new vscode.ThemeColor("charts.gray"));
      case "initializing":
        return new vscode.ThemeIcon("sync~spin", new vscode.ThemeColor("charts.blue"));
      default:
        return new vscode.ThemeIcon("circle-outline");
    }
  }
}

/**
 * Tree data provider for the agents sidebar view
 *
 * Shows the orchestrator agent at the top followed by all worker agents.
 * Updates automatically when agents are spawned, destroyed, or status changes.
 */
export class AgentTreeProvider implements vscode.TreeDataProvider<AgentTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    AgentTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private orchestratorState: AgentState | undefined;

  constructor(private readonly agentPool: AgentPool) {
    // Listen to agent pool events
    this.agentPool.on("agentSpawned", () => this.refresh());
    this.agentPool.on("agentDestroyed", () => this.refresh());
    this.agentPool.on("agentStatusChanged", () => this.refresh());
    this.agentPool.on("agentOutput", () => this.refresh());
  }

  /**
   * Set the orchestrator state (called from extension when orchestrator updates)
   */
  setOrchestratorState(state: AgentState): void {
    this.orchestratorState = state;
    this.refresh();
  }

  /**
   * Refresh the tree view
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AgentTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AgentTreeItem): Thenable<AgentTreeItem[]> {
    if (element) {
      // No children for individual agents
      return Promise.resolve([]);
    }

    // Root level: show orchestrator first, then worker agents
    const items: AgentTreeItem[] = [];

    // Add orchestrator if available
    if (this.orchestratorState) {
      items.push(new AgentTreeItem(this.orchestratorState, true));
    }

    // Add all worker agents
    const agents = this.agentPool.getAllAgents();
    for (const agent of agents) {
      const agentState: AgentState = {
        name: agent.name,
        status: agent.status as AgentStatus,
        sessionId: agent.sessionId,
        currentTask: (agent as any).currentTask ?? undefined,
        role: agent.role,
        focus: agent.focus,
        color: agent.color,
        messages: agent.messages,
        costUsd: agent.costUsd,
        tokensUsed: (agent as any).tokensUsed ?? 0,
        waitingFor: (agent as any).waitingFor ?? [],
      };
      items.push(new AgentTreeItem(agentState, false));
    }

    return Promise.resolve(items);
  }
}
