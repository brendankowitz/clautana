/**
 * Dynamic Slash Commands
 *
 * Provides context-aware slash command completion based on active workflow mode.
 * Commands are filtered and organized by the current workflow (ADR, Spec-Kit, or Hybrid).
 */

import * as vscode from 'vscode';
import { ConfigManager } from '../clautana/ConfigManager';

export type WorkflowMode = 'adr' | 'spec-kit' | 'hybrid' | 'auto';

export interface SlashCommand {
  command: string;
  description: string;
  usage: string;
  workflow: WorkflowMode | 'all'; // Which workflow this command belongs to
  category: 'feature' | 'investigation' | 'decision' | 'implementation' | 'review' | 'spec' | 'workflow';
  examples?: string[];
  aliases?: string[];
}

/**
 * Complete slash command registry
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  // ============================================================================
  // ADR Workflow Commands (/fn-*)
  // ============================================================================
  {
    command: '/fn-feature',
    description: 'Create a new feature area for investigation',
    usage: '/fn-feature {feature-name}',
    workflow: 'adr',
    category: 'feature',
    examples: [
      '/fn-feature api-caching',
      '/fn-feature authentication',
      '/fn-feature real-time-updates',
    ],
  },
  {
    command: '/fn-investigation',
    description: 'Add an investigation exploring one approach',
    usage: '/fn-investigation {feature-name} {investigation-topic}',
    workflow: 'adr',
    category: 'investigation',
    examples: [
      '/fn-investigation api-caching redis-approach',
      '/fn-investigation authentication oauth2-flow',
      '/fn-investigation real-time-updates websockets',
    ],
  },
  {
    command: '/fn-adr',
    description: 'Create ADR from viable investigations',
    usage: '/fn-adr {feature-name}',
    workflow: 'adr',
    category: 'decision',
    examples: [
      '/fn-adr api-caching',
      '/fn-adr authentication',
    ],
  },
  {
    command: '/fn-reject',
    description: 'Formally reject an investigation with reasoning',
    usage: '/fn-reject {feature-name} {investigation-topic}',
    workflow: 'adr',
    category: 'decision',
    examples: [
      '/fn-reject api-caching in-memory-only',
      '/fn-reject authentication basic-auth',
    ],
  },
  {
    command: '/fn-task',
    description: 'Implement and iterate on ADR tasks',
    usage: '/fn-task',
    workflow: 'adr',
    category: 'implementation',
    examples: ['/fn-task'],
  },
  {
    command: '/fn-accept',
    description: 'Accept implemented ADR and move to docs/adr/',
    usage: '/fn-accept {feature-name}',
    workflow: 'adr',
    category: 'decision',
    examples: [
      '/fn-accept api-caching',
      '/fn-accept authentication',
    ],
  },
  {
    command: '/fn-review',
    description: 'Technical code review before acceptance',
    usage: '/fn-review',
    workflow: 'adr',
    category: 'review',
    examples: ['/fn-review'],
  },
  {
    command: '/fn-document',
    description: 'Update documentation for implemented feature',
    usage: '/fn-document {feature-name}',
    workflow: 'adr',
    category: 'implementation',
    examples: ['/fn-document api-caching'],
  },

  // ============================================================================
  // Spec-Kit Workflow Commands (/speckit.*)
  // ============================================================================
  {
    command: '/speckit.init',
    description: 'Initialize GitHub Spec-Kit in this project',
    usage: '/speckit.init {project-name}',
    workflow: 'spec-kit',
    category: 'workflow',
    examples: ['/speckit.init my-app'],
  },
  {
    command: '/speckit.constitution',
    description: 'Establish project principles and guidelines',
    usage: '/speckit.constitution',
    workflow: 'spec-kit',
    category: 'spec',
    examples: ['/speckit.constitution'],
  },
  {
    command: '/speckit.specify',
    description: 'Create functional specification from requirements',
    usage: '/speckit.specify {feature-name}',
    workflow: 'spec-kit',
    category: 'spec',
    examples: [
      '/speckit.specify photo-upload',
      '/speckit.specify dark-mode',
    ],
  },
  {
    command: '/speckit.plan',
    description: 'Generate technical implementation plan from spec',
    usage: '/speckit.plan {feature-name}',
    workflow: 'spec-kit',
    category: 'spec',
    examples: ['/speckit.plan photo-upload'],
  },
  {
    command: '/speckit.tasks',
    description: 'Break plan into executable tasks',
    usage: '/speckit.tasks {feature-name}',
    workflow: 'spec-kit',
    category: 'spec',
    examples: ['/speckit.tasks photo-upload'],
  },
  {
    command: '/speckit.implement',
    description: 'Execute all tasks systematically',
    usage: '/speckit.implement {feature-name}',
    workflow: 'spec-kit',
    category: 'implementation',
    examples: ['/speckit.implement photo-upload'],
  },
  {
    command: '/speckit.clarify',
    description: 'Structured requirement refinement',
    usage: '/speckit.clarify {feature-name}',
    workflow: 'spec-kit',
    category: 'spec',
    examples: ['/speckit.clarify photo-upload'],
  },
  {
    command: '/speckit.analyze',
    description: 'Check cross-artifact consistency',
    usage: '/speckit.analyze {feature-name}',
    workflow: 'spec-kit',
    category: 'review',
    examples: ['/speckit.analyze photo-upload'],
  },

  // ============================================================================
  // Well-Architected Framework Commands (/wa-*)
  // ============================================================================
  {
    command: '/wa-review',
    description: 'Comprehensive Well-Architected Framework review',
    usage: '/wa-review',
    workflow: 'all',
    category: 'review',
    examples: ['/wa-review'],
  },
  {
    command: '/wa-reliability',
    description: 'Review reliability and fault tolerance',
    usage: '/wa-reliability',
    workflow: 'all',
    category: 'review',
    examples: ['/wa-reliability'],
  },
  {
    command: '/wa-security',
    description: 'Security and compliance audit',
    usage: '/wa-security',
    workflow: 'all',
    category: 'review',
    examples: ['/wa-security'],
  },
  {
    command: '/wa-performance',
    description: 'Performance and efficiency review',
    usage: '/wa-performance',
    workflow: 'all',
    category: 'review',
    examples: ['/wa-performance'],
  },

  // ============================================================================
  // Workflow Management Commands
  // ============================================================================
  {
    command: '/workflow',
    description: 'Check workflow status and available modes',
    usage: '/workflow',
    workflow: 'all',
    category: 'workflow',
    examples: ['/workflow'],
    aliases: ['/workflow-status'],
  },
  {
    command: '/workflow-mode',
    description: 'Switch workflow mode (adr|spec-kit|hybrid|auto)',
    usage: '/workflow-mode {mode}',
    workflow: 'all',
    category: 'workflow',
    examples: [
      '/workflow-mode adr',
      '/workflow-mode spec-kit',
      '/workflow-mode hybrid',
      '/workflow-mode auto',
    ],
  },
];

/**
 * Slash Command Completion Provider
 */
export class SlashCommandCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private configManager: ConfigManager) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[]> {
    const linePrefix = document.lineAt(position).text.substr(0, position.character);

    // Only trigger on "/" at start of message or after whitespace
    if (!linePrefix.match(/(?:^|\s)\/\w*$/)) {
      return [];
    }

    const config = await this.configManager.getConfig();
    const workflowMode = config?.workflow?.mode || 'auto';

    // Filter commands based on active workflow
    const availableCommands = this.getCommandsForWorkflow(workflowMode);

    // Create completion items
    return availableCommands.map(cmd => this.createCompletionItem(cmd));
  }

  /**
   * Get commands available for the current workflow mode
   */
  private getCommandsForWorkflow(mode: WorkflowMode): SlashCommand[] {
    return SLASH_COMMANDS.filter(cmd => {
      if (cmd.workflow === 'all') return true;

      switch (mode) {
        case 'adr':
          return cmd.workflow === 'adr';

        case 'spec-kit':
          return cmd.workflow === 'spec-kit';

        case 'hybrid':
        case 'auto':
          return true; // Show all commands in hybrid mode

        default:
          return true;
      }
    });
  }

  /**
   * Create a completion item from a slash command
   */
  private createCompletionItem(cmd: SlashCommand): vscode.CompletionItem {
    const item = new vscode.CompletionItem(cmd.command, vscode.CompletionItemKind.Function);

    // Set description
    item.detail = cmd.description;

    // Set documentation with examples
    const docs = new vscode.MarkdownString();
    docs.appendMarkdown(`**${cmd.description}**\n\n`);
    docs.appendMarkdown(`**Usage:** \`${cmd.usage}\`\n\n`);

    if (cmd.examples && cmd.examples.length > 0) {
      docs.appendMarkdown('**Examples:**\n');
      cmd.examples.forEach(ex => {
        docs.appendCodeblock(ex, 'text');
      });
    }

    docs.appendMarkdown(`\n*Workflow:* ${cmd.workflow === 'all' ? 'All workflows' : cmd.workflow.toUpperCase()}`);
    docs.appendMarkdown(`\n*Category:* ${cmd.category}`);

    item.documentation = docs;

    // Set sort text to group by category
    const categoryOrder: Record<string, string> = {
      workflow: '1',
      feature: '2',
      investigation: '3',
      decision: '4',
      spec: '5',
      implementation: '6',
      review: '7',
    };
    item.sortText = `${categoryOrder[cmd.category] || '9'}-${cmd.command}`;

    // Insert just the command (user will type the args)
    item.insertText = cmd.command;

    // Add filter text for better matching
    item.filterText = [cmd.command, ...cmd.aliases || []].join(' ');

    return item;
  }
}

/**
 * Slash Command Quick Pick Provider
 *
 * Shows a categorized list of available commands in a quick pick menu
 */
export class SlashCommandQuickPick {
  constructor(private configManager: ConfigManager) {}

  async show(): Promise<string | undefined> {
    const config = await this.configManager.getConfig();
    const workflowMode = config?.workflow?.mode || 'auto';

    // Get available commands
    const commands = SLASH_COMMANDS.filter(cmd => {
      if (cmd.workflow === 'all') return true;
      if (workflowMode === 'hybrid' || workflowMode === 'auto') return true;
      return cmd.workflow === workflowMode;
    });

    // Group by category
    const grouped = this.groupByCategory(commands);

    // Create quick pick items
    const items: vscode.QuickPickItem[] = [];

    for (const [category, cmds] of Object.entries(grouped)) {
      // Add category separator
      items.push({
        label: this.getCategoryLabel(category),
        kind: vscode.QuickPickItemKind.Separator,
      });

      // Add commands in this category
      cmds.forEach(cmd => {
        items.push({
          label: cmd.command,
          description: cmd.description,
          detail: cmd.usage,
        });
      });
    }

    // Show quick pick
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a slash command',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    return selected?.label;
  }

  private groupByCategory(commands: SlashCommand[]): Record<string, SlashCommand[]> {
    const grouped: Record<string, SlashCommand[]> = {};

    commands.forEach(cmd => {
      if (!grouped[cmd.category]) {
        grouped[cmd.category] = [];
      }
      grouped[cmd.category].push(cmd);
    });

    return grouped;
  }

  private getCategoryLabel(category: string): string {
    const labels: Record<string, string> = {
      workflow: '⚙️ Workflow Management',
      feature: '📁 Feature Areas',
      investigation: '🔍 Investigations',
      decision: '✅ Decisions (ADR)',
      spec: '📝 Specifications',
      implementation: '⚡ Implementation',
      review: '🔎 Review & Quality',
    };
    return labels[category] || category;
  }
}

/**
 * Workflow Mode Status Bar Item
 *
 * Shows current workflow mode in the status bar with quick switcher
 */
export class WorkflowModeStatusBar {
  private statusBarItem: vscode.StatusBarItem;

  constructor(private configManager: ConfigManager) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'clautana.switchWorkflowMode';
    this.updateStatusBar();
  }

  async updateStatusBar(): Promise<void> {
    const config = await this.configManager.getConfig();
    const mode = config?.workflow?.mode || 'auto';

    const icons: Record<WorkflowMode, string> = {
      adr: '🔍',
      'spec-kit': '📋',
      hybrid: '🔄',
      auto: '✨',
    };

    const icon = icons[mode] || '✨';
    this.statusBarItem.text = `${icon} ${mode.toUpperCase()}`;
    this.statusBarItem.tooltip = `Workflow Mode: ${mode}\nClick to change`;
    this.statusBarItem.show();
  }

  async showModeSwitcher(): Promise<void> {
    const modes: Array<{ label: string; mode: WorkflowMode; description: string }> = [
      {
        label: '🔍 ADR Workflow',
        mode: 'adr',
        description: 'Investigation-driven with formal decision tracking',
      },
      {
        label: '📋 Spec-Kit Workflow',
        mode: 'spec-kit',
        description: 'Spec-driven with GitHub templates',
      },
      {
        label: '🔄 Hybrid Mode',
        mode: 'hybrid',
        description: 'Use both workflows as needed',
      },
      {
        label: '✨ Auto-Detect',
        mode: 'auto',
        description: 'Automatically choose based on task',
      },
    ];

    const selected = await vscode.window.showQuickPick(modes, {
      placeHolder: 'Select workflow mode',
    });

    if (selected) {
      await this.configManager.updateWorkflowMode(selected.mode);
      await this.updateStatusBar();
      vscode.window.showInformationMessage(`Switched to ${selected.mode} workflow mode`);
    }
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}

/**
 * Contextual Command Suggestions
 *
 * Suggests relevant commands based on current context
 */
export class ContextualCommandSuggester {
  constructor(private configManager: ConfigManager) {}

  /**
   * Suggest next commands based on current state
   */
  async suggestNextCommands(context: {
    hasFeatures: boolean;
    hasInvestigations: boolean;
    hasAdr: boolean;
    hasSpecs: boolean;
    hasTasks: boolean;
  }): Promise<SlashCommand[]> {
    const config = await this.configManager.getConfig();
    const mode = config?.workflow?.mode || 'auto';

    const suggestions: SlashCommand[] = [];

    if (mode === 'adr' || mode === 'hybrid' || mode === 'auto') {
      // ADR workflow suggestions
      if (!context.hasFeatures) {
        suggestions.push(SLASH_COMMANDS.find(c => c.command === '/fn-feature')!);
      } else if (!context.hasInvestigations) {
        suggestions.push(SLASH_COMMANDS.find(c => c.command === '/fn-investigation')!);
      } else if (!context.hasAdr) {
        suggestions.push(SLASH_COMMANDS.find(c => c.command === '/fn-adr')!);
      } else {
        suggestions.push(SLASH_COMMANDS.find(c => c.command === '/fn-task')!);
        suggestions.push(SLASH_COMMANDS.find(c => c.command === '/fn-accept')!);
      }
    }

    if (mode === 'spec-kit' || mode === 'hybrid') {
      // Spec-Kit workflow suggestions
      if (!context.hasSpecs) {
        suggestions.push(SLASH_COMMANDS.find(c => c.command === '/speckit.specify')!);
      } else if (!context.hasTasks) {
        suggestions.push(SLASH_COMMANDS.find(c => c.command === '/speckit.plan')!);
        suggestions.push(SLASH_COMMANDS.find(c => c.command === '/speckit.tasks')!);
      } else {
        suggestions.push(SLASH_COMMANDS.find(c => c.command === '/speckit.implement')!);
      }
    }

    // Always suggest review commands at appropriate times
    if (context.hasAdr || context.hasTasks) {
      suggestions.push(SLASH_COMMANDS.find(c => c.command === '/wa-review')!);
    }

    return suggestions.filter(Boolean);
  }
}

/**
 * Command Palette Integration
 *
 * Registers commands in VS Code command palette with workflow-aware filtering
 */
export function registerSlashCommands(
  context: vscode.ExtensionContext,
  configManager: ConfigManager
): void {
  // Register completion provider
  const completionProvider = new SlashCommandCompletionProvider(configManager);
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { scheme: 'clautana' },
      completionProvider,
      '/'
    )
  );

  // Register quick pick command
  const quickPick = new SlashCommandQuickPick(configManager);
  context.subscriptions.push(
    vscode.commands.registerCommand('clautana.showSlashCommands', async () => {
      const command = await quickPick.show();
      if (command) {
        // Insert command into active chat
        vscode.window.showInformationMessage(`Selected: ${command}`);
      }
    })
  );

  // Workflow mode status bar hidden for now - using ADR workflow by default
  // const statusBar = new WorkflowModeStatusBar(configManager);
  // context.subscriptions.push(statusBar);
  // context.subscriptions.push(
  //   vscode.commands.registerCommand('clautana.switchWorkflowMode', async () => {
  //     await statusBar.showModeSwitcher();
  //   })
  // );
  // configManager.onConfigChanged(() => {
  //   statusBar.updateStatusBar();
  // });
}
