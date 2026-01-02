import * as vscode from "vscode";
import { AgentPool } from "../coordinator/AgentPool";
import { FileClaim } from "../types";

/**
 * DecoratorProvider manages visual decorations in the VS Code editor
 * to show which files are claimed by agents.
 *
 * Key features:
 * - Shows exclusive claims with lock icon and warning background
 * - Shows shared claims with unlock icon and info background
 * - Provides hover information with claim details
 * - Updates decorations when claims change
 * - Uses VS Code theme colors for consistent appearance
 */
export class DecoratorProvider {
  private exclusiveDecoration: vscode.TextEditorDecorationType;
  private sharedDecoration: vscode.TextEditorDecorationType;
  private claims: readonly FileClaim[] = [];

  constructor(agentPool: AgentPool) {
    // Create decoration type for exclusive claims (locked files)
    this.exclusiveDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.parse(
        "data:image/svg+xml," +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><text x="0" y="14" font-size="14">🔒</text></svg>'
          )
      ),
      gutterIconSize: "contain",
      overviewRulerColor: new vscode.ThemeColor("clautana.claimExclusiveBackground"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor("clautana.claimExclusiveBackground"),
    });

    // Create decoration type for shared claims (shared access files)
    this.sharedDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.parse(
        "data:image/svg+xml," +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><text x="0" y="14" font-size="14">🔓</text></svg>'
          )
      ),
      gutterIconSize: "contain",
      overviewRulerColor: new vscode.ThemeColor("clautana.claimSharedBackground"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: false,
    });

    // Listen for claims updates from the agent pool
    agentPool.on("claimsUpdated", (claims: readonly FileClaim[]) => {
      this.claims = claims;
      this.updateDecorations();
    });
  }

  /**
   * Register event handlers and hover provider
   * @param context Extension context for subscriptions
   */
  register(context: vscode.ExtensionContext): void {
    // Update decorations when active editor changes
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.updateDecorations()),
      vscode.workspace.onDidOpenTextDocument(() => this.updateDecorations())
    );

    // Register hover provider for claim details
    context.subscriptions.push(
      vscode.languages.registerHoverProvider("*", {
        provideHover: (document, position) => this.provideClaimHover(document, position),
      })
    );

    // Initial decoration update
    this.updateDecorations();
  }

  /**
   * Update decorations for all visible editors
   * Checks configuration and applies appropriate decorations based on claims
   */
  private updateDecorations(): void {
    const config = vscode.workspace.getConfiguration("clautana");
    if (!config.get<boolean>("showClaimsInEditor")) {
      // Feature disabled - clear all decorations
      for (const editor of vscode.window.visibleTextEditors) {
        editor.setDecorations(this.exclusiveDecoration, []);
        editor.setDecorations(this.sharedDecoration, []);
      }
      return;
    }

    // Update decorations for each visible editor
    for (const editor of vscode.window.visibleTextEditors) {
      const filePath = editor.document.uri.fsPath;
      const claim = this.findMatchingClaim(filePath);

      if (claim) {
        // File is claimed - apply appropriate decoration
        const range = new vscode.Range(0, 0, editor.document.lineCount, 0);
        const decoration = claim.exclusive ? this.exclusiveDecoration : this.sharedDecoration;

        editor.setDecorations(decoration, [{ range }]);
        // Clear the other decoration type
        editor.setDecorations(
          claim.exclusive ? this.sharedDecoration : this.exclusiveDecoration,
          []
        );
      } else {
        // No claim - clear all decorations
        editor.setDecorations(this.exclusiveDecoration, []);
        editor.setDecorations(this.sharedDecoration, []);
      }
    }
  }

  /**
   * Find a claim that matches the given file path
   * @param filePath Absolute file path to check
   * @returns Matching claim or undefined
   */
  private findMatchingClaim(filePath: string): FileClaim | undefined {
    for (const claim of this.claims) {
      if (this.matchesPattern(filePath, claim.pathPattern)) {
        return claim;
      }
    }
    return undefined;
  }

  /**
   * Check if a file path matches a glob pattern
   * @param filePath Absolute file path to check
   * @param pattern Glob pattern (supports ** for directories, * for files)
   * @returns True if the path matches the pattern
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    // Normalize paths for comparison (handle Windows paths)
    const normalizedPath = filePath.replace(/\\/g, "/");
    const normalizedPattern = pattern.replace(/\\/g, "/");

    // Convert glob pattern to regex
    // ** matches any number of directories
    // * matches any characters except path separator
    const regexPattern = normalizedPattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // Escape special regex chars
      .replace(/\*\*/g, "§DOUBLESTAR§") // Temporary placeholder
      .replace(/\*/g, "[^/]*") // * matches anything except /
      .replace(/§DOUBLESTAR§/g, ".*"); // ** matches anything

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(normalizedPath);
  }

  /**
   * Provide hover information for claimed files
   * @param document Document being hovered over
   * @param position Position in the document
   * @returns Hover information or undefined
   */
  private provideClaimHover(
    document: vscode.TextDocument,
    _position: vscode.Position
  ): vscode.Hover | undefined {
    const claim = this.findMatchingClaim(document.uri.fsPath);
    if (!claim) {
      return undefined;
    }

    // Build hover content
    const markdown = new vscode.MarkdownString();
    markdown.appendMarkdown(`## ${claim.exclusive ? "🔒" : "🔓"} File Claimed\n\n`);
    markdown.appendMarkdown(`**Agent:** ${claim.agentName}\n\n`);
    markdown.appendMarkdown(`**Type:** ${claim.exclusive ? "Exclusive" : "Shared"}\n\n`);

    if (claim.reason) {
      markdown.appendMarkdown(`**Reason:** ${claim.reason}\n\n`);
    }

    // Calculate time until expiry
    const expiresIn = Math.round((claim.expiresAt.getTime() - Date.now()) / 1000 / 60);
    if (expiresIn > 0) {
      markdown.appendMarkdown(`**Expires in:** ${expiresIn} minute${expiresIn !== 1 ? "s" : ""}\n`);
    } else {
      markdown.appendMarkdown(`**Status:** Expired\n`);
    }

    markdown.appendMarkdown(`\n**Pattern:** \`${claim.pathPattern}\`\n`);

    return new vscode.Hover(markdown);
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.exclusiveDecoration.dispose();
    this.sharedDecoration.dispose();
  }
}
