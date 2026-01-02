import * as vscode from "vscode";
import { AgentPool } from "../coordinator/AgentPool";
import { FileClaim } from "../types";

/**
 * Tree item representing a file claim or agent group
 */
class ClaimTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly claim?: FileClaim
  ) {
    super(label, collapsibleState);

    if (claim) {
      this.description = this.buildDescription();
      this.tooltip = this.buildTooltip();
      this.iconPath = this.getClaimIcon();
      this.contextValue = "claim";
    } else {
      // This is an agent group header
      this.contextValue = "claimGroup";
      this.iconPath = new vscode.ThemeIcon("person");
    }
  }

  private buildDescription(): string {
    if (!this.claim) {
      return "";
    }

    const type = this.claim.exclusive ? "Exclusive" : "Shared";
    const expires = this.getRelativeTime(this.claim.expiresAt);
    return `${type} • Expires ${expires}`;
  }

  private buildTooltip(): string {
    if (!this.claim) {
      return "";
    }

    const lines = [
      `Path: ${this.claim.pathPattern}`,
      `Agent: ${this.claim.agentName}`,
      `Type: ${this.claim.exclusive ? "Exclusive" : "Shared"}`,
      `Created: ${this.claim.createdAt.toLocaleString()}`,
      `Expires: ${this.claim.expiresAt.toLocaleString()}`,
    ];

    if (this.claim.reason) {
      lines.push(`Reason: ${this.claim.reason}`);
    }

    return lines.join("\n");
  }

  private getClaimIcon(): vscode.ThemeIcon {
    if (!this.claim) {
      return new vscode.ThemeIcon("file");
    }

    return this.claim.exclusive
      ? new vscode.ThemeIcon("lock", new vscode.ThemeColor("charts.red"))
      : new vscode.ThemeIcon("unlock", new vscode.ThemeColor("charts.green"));
  }

  private getRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 0) {
      return "expired";
    } else if (diffMin < 60) {
      return `in ${diffMin}m`;
    } else {
      const diffHr = Math.floor(diffMin / 60);
      return `in ${diffHr}h`;
    }
  }
}

/**
 * Tree data provider for the file claims sidebar view
 *
 * Groups claims by agent name and shows details about each claim.
 * Updates automatically when claims are added or released.
 */
export class ClaimsTreeProvider implements vscode.TreeDataProvider<ClaimTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    ClaimTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly agentPool: AgentPool) {
    // Listen to claims updates
    this.agentPool.on("claimsUpdated", () => this.refresh());
  }

  /**
   * Refresh the tree view
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ClaimTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ClaimTreeItem): Thenable<ClaimTreeItem[]> {
    if (!element) {
      // Root level: group by agent name
      return Promise.resolve(this.getAgentGroups());
    }

    // Child level: show claims for this agent
    if (!element.claim) {
      // This is an agent group, show its claims
      const agentName = element.label;
      return Promise.resolve(this.getClaimsForAgent(agentName));
    }

    // Leaf level: no children
    return Promise.resolve([]);
  }

  private getAgentGroups(): ClaimTreeItem[] {
    const claims = this.agentPool.getAllClaims();

    // Group claims by agent name
    const agentGroups = new Map<string, FileClaim[]>();
    for (const claim of claims) {
      const existing = agentGroups.get(claim.agentName) || [];
      existing.push(claim);
      agentGroups.set(claim.agentName, existing);
    }

    // Create tree items for each agent group
    const items: ClaimTreeItem[] = [];
    for (const [agentName] of agentGroups) {
      items.push(
        new ClaimTreeItem(
          agentName,
          vscode.TreeItemCollapsibleState.Expanded
        )
      );
    }

    return items;
  }

  private getClaimsForAgent(agentName: string): ClaimTreeItem[] {
    const claims = this.agentPool
      .getAllClaims()
      .filter((c) => c.agentName === agentName);

    return claims.map(
      (claim) =>
        new ClaimTreeItem(
          claim.pathPattern,
          vscode.TreeItemCollapsibleState.None,
          claim
        )
    );
  }
}
