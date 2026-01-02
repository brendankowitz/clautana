import * as vscode from "vscode";
import { OrchestratorAgent } from "../coordinator/OrchestratorAgent";
import { AgentPool } from "../coordinator/AgentPool";
import { FileClaim } from "../coordinator/types";

/**
 * StatusBarProvider manages the status bar display for the multi-agent system.
 *
 * Features:
 * - Shows orchestrator status icon (🎯 idle, ⚙️ processing, ❌ error)
 * - Displays agent count
 * - Shows claim count with lock icon
 * - Displays total cost
 * - Click to open Multi-Agent panel
 * - Detailed tooltip with agent list and cost breakdown
 *
 * Format: "🎯 Orchestrator idle │ 3 agents │ 🔒 2 claims │ $0.18"
 */
export class StatusBarProvider {
  private readonly statusBarItem: vscode.StatusBarItem;
  private orchestratorStatus: "idle" | "processing" | "error" = "idle";
  private agentCount = 0;
  private claimCount = 0;
  private totalCost = 0;

  constructor(
    private readonly orchestrator: OrchestratorAgent,
    private readonly agentPool: AgentPool
  ) {
    // Create status bar item on the left side with priority 100
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );

    // Set command to open panel on click
    this.statusBarItem.command = "clautana.openPanel";
  }

  /**
   * Register the status bar provider and subscribe to events
   */
  register(context: vscode.ExtensionContext): void {
    // Add to disposables
    context.subscriptions.push(this.statusBarItem);

    // Subscribe to orchestrator events
    this.orchestrator.on("statusChanged", (status: "idle" | "processing" | "error") => {
      this.orchestratorStatus = status;
      this.updateStatusBar();
    });

    // Subscribe to agent pool events
    this.agentPool.on("agentSpawned", () => {
      this.agentCount = this.agentPool.getAllAgents().length;
      this.updateStatusBar();
    });

    this.agentPool.on("agentDestroyed", () => {
      this.agentCount = this.agentPool.getAllAgents().length;
      this.updateStatusBar();
    });

    this.agentPool.on("claimsUpdated", (claims: FileClaim[]) => {
      this.claimCount = claims.length;
      this.updateStatusBar();
    });

    this.agentPool.on("agentStatusChanged", () => {
      // Recalculate total cost when agent status changes
      this.updateCost();
      this.updateStatusBar();
    });

    // Initial update and show
    this.updateCost();
    this.updateStatusBar();
    this.statusBarItem.show();
  }

  /**
   * Update the status bar display
   */
  private updateStatusBar(): void {
    // Select icon based on orchestrator status
    let statusIcon: string;
    let statusText: string;

    switch (this.orchestratorStatus) {
      case "idle":
        statusIcon = "🎯";
        statusText = "Orchestrator idle";
        break;
      case "processing":
        statusIcon = "⚙️";
        statusText = "Orchestrator processing";
        break;
      case "error":
        statusIcon = "❌";
        statusText = "Orchestrator error";
        break;
    }

    // Build status bar text
    const parts: string[] = [
      `${statusIcon} ${statusText}`,
      `${this.agentCount} ${this.agentCount === 1 ? "agent" : "agents"}`,
    ];

    // Add claims if any
    if (this.claimCount > 0) {
      parts.push(`🔒 ${this.claimCount} ${this.claimCount === 1 ? "claim" : "claims"}`);
    }

    // Add cost
    parts.push(`$${this.totalCost.toFixed(2)}`);

    // Join with separator
    this.statusBarItem.text = parts.join(" │ ");

    // Update tooltip
    this.statusBarItem.tooltip = this.buildTooltip();
  }

  /**
   * Build detailed tooltip with agent and cost information
   */
  private buildTooltip(): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString();
    tooltip.isTrusted = true;

    // Header
    tooltip.appendMarkdown("## Multi-Agent Harness\n\n");

    // Orchestrator status
    tooltip.appendMarkdown(`**Orchestrator:** ${this.orchestratorStatus}\n\n`);

    // Active agents
    const agents = this.agentPool.getAllAgents();
    if (agents.length > 0) {
      tooltip.appendMarkdown("### Active Agents\n\n");
      for (const agent of agents) {
        const statusEmoji = this.getStatusEmoji(agent.status);
        tooltip.appendMarkdown(
          `- ${statusEmoji} **${agent.name}** (${agent.role}) - ${agent.status}\n`
        );
        tooltip.appendMarkdown(`  - Cost: $${agent.costUsd.toFixed(4)}\n`);
      }
      tooltip.appendMarkdown("\n");
    } else {
      tooltip.appendMarkdown("*No active agents*\n\n");
    }

    // Pending agents
    const status = this.agentPool.getStatus();
    if (status.pendingAgents.length > 0) {
      tooltip.appendMarkdown("### Pending Agents\n\n");
      for (const name of status.pendingAgents) {
        tooltip.appendMarkdown(`- ⏳ **${name}** (waiting for dependencies)\n`);
      }
      tooltip.appendMarkdown("\n");
    }

    // File claims
    if (this.claimCount > 0) {
      tooltip.appendMarkdown("### File Claims\n\n");
      const claims = this.agentPool.getAllClaims();
      const claimsByAgent = new Map<string, number>();

      for (const claim of claims) {
        const count = claimsByAgent.get(claim.agentName) ?? 0;
        claimsByAgent.set(claim.agentName, count + 1);
      }

      for (const [agentName, count] of claimsByAgent) {
        tooltip.appendMarkdown(`- **${agentName}**: ${count} ${count === 1 ? "claim" : "claims"}\n`);
      }
      tooltip.appendMarkdown("\n");
    }

    // Total cost breakdown
    tooltip.appendMarkdown("### Cost Breakdown\n\n");
    if (agents.length > 0) {
      for (const agent of agents) {
        if (agent.costUsd > 0) {
          tooltip.appendMarkdown(`- **${agent.name}**: $${agent.costUsd.toFixed(4)}\n`);
        }
      }
      tooltip.appendMarkdown(`\n**Total**: $${this.totalCost.toFixed(4)}\n\n`);
    } else {
      tooltip.appendMarkdown("*No costs yet*\n\n");
    }

    // Action hint
    tooltip.appendMarkdown("---\n\n");
    tooltip.appendMarkdown("*Click to open Multi-Agent panel*");

    return tooltip;
  }

  /**
   * Get emoji for agent status
   */
  private getStatusEmoji(status: string): string {
    switch (status) {
      case "idle":
        return "💤";
      case "processing":
        return "⚙️";
      case "waiting":
        return "⏳";
      case "complete":
        return "✅";
      case "error":
        return "❌";
      case "paused":
        return "⏸️";
      case "initializing":
        return "🔄";
      default:
        return "❓";
    }
  }

  /**
   * Update total cost from all agents
   */
  private updateCost(): void {
    const agents = this.agentPool.getAllAgents();
    this.totalCost = agents.reduce((sum, agent) => sum + agent.costUsd, 0);
  }

  /**
   * Dispose of the status bar item
   */
  dispose(): void {
    this.statusBarItem.dispose();
  }
}
