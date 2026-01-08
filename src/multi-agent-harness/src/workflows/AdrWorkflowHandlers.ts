/**
 * ADR Workflow Handlers
 *
 * Handles the /fn-* slash commands for the ADR (Architecture Decision Record) workflow.
 * These commands guide users through feature investigation, decision making, and implementation.
 *
 * Workflow Flow:
 * 1. /fn-feature - Create a new feature area
 * 2. /fn-investigation - Add investigations exploring approaches
 * 3. /fn-adr - Create ADR from viable investigations
 * 4. /fn-reject - Reject an investigation with reasoning
 * 5. /fn-task - Implement ADR tasks
 * 6. /fn-accept - Accept implemented ADR (moves to docs/adr/)
 * 7. /fn-review - Technical code review
 * 8. /fn-document - Update documentation
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { OrchestratorAgent } from '../coordinator/OrchestratorAgent';
import { AgentPool } from '../coordinator/AgentPool';

/**
 * Context passed to each ADR workflow handler
 */
export interface AdrHandlerContext {
  /** Parsed arguments from the command */
  args: string[];
  /** Raw arguments string */
  argsRaw: string;
  /** The orchestrator agent instance */
  orchestrator: OrchestratorAgent;
  /** The agent pool for spawning agents */
  agentPool: AgentPool;
  /** VS Code extension context */
  extensionContext: vscode.ExtensionContext;
}

/**
 * Result returned from each handler
 */
export interface AdrHandlerResult {
  /** Whether the command succeeded */
  success: boolean;
  /** Message to display to the user */
  message: string;
  /** Optional data payload */
  data?: {
    /** Path that was created or modified */
    path?: string;
    /** Feature name involved */
    featureName?: string;
    /** Investigation topic involved */
    investigationTopic?: string;
    /** Action type performed */
    action?: string;
  };
}

/**
 * File system utilities for ADR workflow
 */
class AdrFileSystem {
  private readonly workspaceRoot: string;

  constructor() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    this.workspaceRoot = workspaceFolder?.uri.fsPath ?? process.cwd();
  }

  /** Get the .clautana directory path */
  get clautanaPath(): string {
    return path.join(this.workspaceRoot, '.clautana');
  }

  /** Get the features directory path */
  get featuresPath(): string {
    return path.join(this.clautanaPath, 'features');
  }

  /** Get the ADR directory path (working ADRs) */
  get adrPath(): string {
    return path.join(this.clautanaPath, 'adr');
  }

  /** Get the final docs/adr directory path (accepted ADRs) */
  get docsAdrPath(): string {
    return path.join(this.workspaceRoot, 'docs', 'adr');
  }

  /** Get path for a specific feature */
  getFeaturePath(featureName: string): string {
    return path.join(this.featuresPath, this.sanitizeName(featureName));
  }

  /** Get path for investigations within a feature */
  getInvestigationsPath(featureName: string): string {
    return path.join(this.getFeaturePath(featureName), 'investigations');
  }

  /** Get path for a specific investigation */
  getInvestigationPath(featureName: string, investigationTopic: string): string {
    return path.join(
      this.getInvestigationsPath(featureName),
      `${this.sanitizeName(investigationTopic)}.md`
    );
  }

  /** Get path for a working ADR */
  getWorkingAdrPath(featureName: string): string {
    return path.join(this.adrPath, `${this.sanitizeName(featureName)}.md`);
  }

  /** Get path for an accepted ADR in docs */
  getAcceptedAdrPath(featureName: string): string {
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return path.join(this.docsAdrPath, `${timestamp}-${this.sanitizeName(featureName)}.md`);
  }

  /** Sanitize a name for use in file paths */
  sanitizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /** Ensure a directory exists */
  async ensureDir(dirPath: string): Promise<void> {
    const uri = vscode.Uri.file(dirPath);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      await vscode.workspace.fs.createDirectory(uri);
    }
  }

  /** Check if a file exists */
  async exists(filePath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return true;
    } catch {
      return false;
    }
  }

  /** Write content to a file */
  async writeFile(filePath: string, content: string): Promise<void> {
    const uri = vscode.Uri.file(filePath);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  }

  /** Read content from a file */
  async readFile(filePath: string): Promise<string> {
    const uri = vscode.Uri.file(filePath);
    const content = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(content).toString('utf8');
  }

  /** Move a file from source to destination */
  async moveFile(sourcePath: string, destPath: string): Promise<void> {
    const sourceUri = vscode.Uri.file(sourcePath);
    const destUri = vscode.Uri.file(destPath);
    await vscode.workspace.fs.copy(sourceUri, destUri);
    await vscode.workspace.fs.delete(sourceUri);
  }

  /** List files in a directory */
  async listFiles(dirPath: string): Promise<string[]> {
    try {
      const uri = vscode.Uri.file(dirPath);
      const entries = await vscode.workspace.fs.readDirectory(uri);
      return entries
        .filter(([, type]) => type === vscode.FileType.File)
        .map(([name]) => name);
    } catch {
      return [];
    }
  }

  /** List subdirectories */
  async listDirs(dirPath: string): Promise<string[]> {
    try {
      const uri = vscode.Uri.file(dirPath);
      const entries = await vscode.workspace.fs.readDirectory(uri);
      return entries
        .filter(([, type]) => type === vscode.FileType.Directory)
        .map(([name]) => name);
    } catch {
      return [];
    }
  }
}

// ============================================================================
// Template Generators
// ============================================================================

function generateInvestigationTemplate(
  featureName: string,
  investigationTopic: string
): string {
  const date = new Date().toISOString().slice(0, 10);
  return `# Investigation: ${investigationTopic}

**Feature:** ${featureName}
**Date:** ${date}
**Status:** Exploring
**Confidence:** Low | Medium | High

---

## Research Questions

<!-- What questions are we trying to answer? -->

- [ ] Question 1
- [ ] Question 2
- [ ] Question 3

## Context

<!-- Why are we investigating this? What problem does it solve? -->

## Clarifications Needed

<!-- Use [NEEDS CLARIFICATION: question] for unresolved questions -->

- [NEEDS CLARIFICATION: Example question that needs stakeholder input]

---

## Options Considered

### Option A: [Name]

**Description:** Brief description of this approach

**Pros:**
- Pro 1
- Pro 2

**Cons:**
- Con 1
- Con 2

**Effort:** ~X agent hours

### Option B: [Name]

**Description:** Brief description of this approach

**Pros:**
- Pro 1
- Pro 2

**Cons:**
- Con 1
- Con 2

**Effort:** ~X agent hours

---

## Research Findings

### Finding 1: [Title]

**Source:** [Link or reference]
**Relevance:** How this applies to our investigation

### Finding 2: [Title]

**Source:** [Link or reference]
**Relevance:** How this applies to our investigation

---

## Technical Analysis

### Architecture Impact

<!-- How does this affect the system architecture? -->

### Data Model Changes

<!-- Any new entities, fields, or relationships? -->

\`\`\`
// Schema or model changes
\`\`\`

### API/Interface Changes

<!-- New endpoints, events, or contracts? -->

### Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| Example | Library/Service/API | Why needed |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Risk 1 | Low/Med/High | Low/Med/High | Mitigation strategy |

---

## Recommendation

**Recommended Option:** [Option A/B/None]
**Confidence Level:** Low | Medium | High

### Rationale

<!-- Why is this the recommended approach? -->

### Conditions for Success

- [ ] Condition 1
- [ ] Condition 2

### Blockers

- [ ] Blocker 1 (owner: @who)

---

## Validation Plan

<!-- How will we validate this approach works? -->

- [ ] Validation step 1
- [ ] Validation step 2

## Next Steps

- [ ] Next step 1
- [ ] Next step 2

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| ${date} | Agent | Initial investigation |
`;
}

function generateAdrTemplate(
  featureName: string,
  investigations: string[]
): string {
  const date = new Date().toISOString().slice(0, 10);
  const investigationList = investigations.length > 0
    ? investigations.map(i => `- ${i}`).join('\n')
    : '- (no investigations yet)';

  return `# ADR: ${featureName}

**Date:** ${date}
**Status:** Proposed
**Deciders:** <!-- List decision makers -->

## Context

<!-- What is the issue that we're seeing that is motivating this decision? -->

## Investigations Considered

${investigationList}

## Decision

<!-- What is the change that we're proposing and/or doing? -->

### Chosen Approach

<!-- Which investigation was chosen and why -->

### Rationale

<!-- Why was this decision made? -->

## Consequences

### Positive

- Consequence 1
- Consequence 2

### Negative

- Consequence 1
- Consequence 2

### Risks

- Risk 1

## Implementation Plan

### Tasks

- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

### Timeline

| Phase | Duration | Description |
|-------|----------|-------------|
| Phase 1 | X days | Description |

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## References

- Investigation: .clautana/features/${featureName}/investigations/
- Related ADRs: (none)
`;
}

function generateRejectionNote(
  featureName: string,
  investigationTopic: string,
  reason: string
): string {
  const date = new Date().toISOString().slice(0, 10);
  return `
---

## Rejection Notice

**Date:** ${date}
**Feature:** ${featureName}
**Investigation:** ${investigationTopic}
**Status:** REJECTED

### Reason for Rejection

${reason}

### Lessons Learned

<!-- What did we learn from this investigation? -->

---
`;
}

// ============================================================================
// Handler Implementations
// ============================================================================

/**
 * /fn-feature - Create a new feature area for investigation
 */
export async function handleFnFeature(ctx: AdrHandlerContext): Promise<AdrHandlerResult> {
  const fs = new AdrFileSystem();
  let featureName = ctx.args[0];

  // Interactive mode if no feature name provided
  if (!featureName) {
    featureName = await vscode.window.showInputBox({
      prompt: 'Enter feature name',
      placeHolder: 'e.g., api-caching, authentication, real-time-updates',
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Feature name is required';
        }
        if (!/^[a-zA-Z0-9-_]+$/.test(value)) {
          return 'Feature name can only contain letters, numbers, hyphens, and underscores';
        }
        return null;
      },
    }) ?? '';

    if (!featureName) {
      return { success: false, message: 'Feature creation cancelled.' };
    }
  }

  const sanitizedName = fs.sanitizeName(featureName);
  const featurePath = fs.getFeaturePath(sanitizedName);

  // Check if feature already exists
  if (await fs.exists(featurePath)) {
    return {
      success: false,
      message: `Feature "${sanitizedName}" already exists at ${featurePath}`,
    };
  }

  // Create feature structure
  await fs.ensureDir(featurePath);
  await fs.ensureDir(fs.getInvestigationsPath(sanitizedName));

  // Create initial README with basic template
  const readmePath = path.join(featurePath, 'README.md');
  const date = new Date().toISOString().slice(0, 10);
  const initialReadme = `# Feature: ${sanitizedName}

**Status**: Exploring
**Created**: ${date}

## Problem Statement

_Analyzing feature requirements..._

## Constraints

_Identifying technical and organizational constraints..._

## Investigations

| Investigation | Status | Summary |
|--------------|--------|---------|

## Decision

*No ADR yet - investigations in progress*
`;

  await fs.writeFile(readmePath, initialReadme);

  // Open the README in the editor
  const doc = await vscode.workspace.openTextDocument(readmePath);
  await vscode.window.showTextDocument(doc);

  // Send task to orchestrator to fill in the feature details
  const analysisTask = `Analyze the feature "${sanitizedName}" and update the README file at ${readmePath} with:

1. **Problem Statement**: Based on the feature name, describe what problem this feature solves. Consider common use cases and pain points.

2. **Constraints**: Identify potential technical, organizational, or domain constraints that might shape the solution. Think about:
   - Technical limitations (performance, scalability, compatibility)
   - Business constraints (budget, timeline, resources)
   - Domain-specific requirements (compliance, security, standards)
   - Integration constraints (existing systems, dependencies)

Replace the placeholder text in the README with detailed, thoughtful content. Be specific and actionable.

The file is already created and open in the editor. Read it, analyze the feature name, and update it with comprehensive details.`;

  // Send to orchestrator for AI analysis
  await ctx.orchestrator.handleUserTask(analysisTask);

  return {
    success: true,
    message: `Created feature area: **${sanitizedName}**\n\nThe AI is analyzing the feature and will fill in:\n• Problem Statement\n• Technical and organizational constraints\n\nNext steps:\n1. Review the AI-generated content in README.md\n2. Use \`/fn-investigation ${sanitizedName} <topic>\` to explore approaches`,
    data: {
      path: featurePath,
      featureName: sanitizedName,
      action: 'created',
    },
  };
}

/**
 * /fn-investigation - Add an investigation exploring one approach
 */
export async function handleFnInvestigation(ctx: AdrHandlerContext): Promise<AdrHandlerResult> {
  const fs = new AdrFileSystem();
  let [featureName, ...topicParts] = ctx.args;
  let investigationTopic = topicParts.join(' ');

  // Interactive mode if arguments not provided
  if (!featureName) {
    // Show list of existing features
    const features = await fs.listDirs(fs.featuresPath);

    if (features.length === 0) {
      return {
        success: false,
        message: 'No features exist yet. Create one first with `/fn-feature <name>`',
      };
    }

    const selected = await vscode.window.showQuickPick(features, {
      placeHolder: 'Select a feature',
    });

    if (!selected) {
      return { success: false, message: 'Investigation creation cancelled.' };
    }

    featureName = selected;
  }

  if (!investigationTopic) {
    investigationTopic = await vscode.window.showInputBox({
      prompt: 'Enter investigation topic',
      placeHolder: 'e.g., redis-approach, websockets, oauth2-flow',
    }) ?? '';

    if (!investigationTopic) {
      return { success: false, message: 'Investigation creation cancelled.' };
    }
  }

  const sanitizedFeature = fs.sanitizeName(featureName);
  const sanitizedTopic = fs.sanitizeName(investigationTopic);
  const featurePath = fs.getFeaturePath(sanitizedFeature);

  // Check if feature exists
  if (!(await fs.exists(featurePath))) {
    return {
      success: false,
      message: `Feature "${sanitizedFeature}" does not exist. Create it first with \`/fn-feature ${sanitizedFeature}\``,
    };
  }

  // Create investigation
  const investigationPath = fs.getInvestigationPath(sanitizedFeature, sanitizedTopic);

  if (await fs.exists(investigationPath)) {
    return {
      success: false,
      message: `Investigation "${sanitizedTopic}" already exists for feature "${sanitizedFeature}"`,
    };
  }

  await fs.ensureDir(fs.getInvestigationsPath(sanitizedFeature));
  await fs.writeFile(
    investigationPath,
    generateInvestigationTemplate(sanitizedFeature, sanitizedTopic)
  );

  // Open the investigation in the editor
  const doc = await vscode.workspace.openTextDocument(investigationPath);
  await vscode.window.showTextDocument(doc);

  // Automatically spawn an agent to help research this investigation
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const agentName = `${sanitizedTopic}-researcher`;

  await ctx.agentPool.spawnAgent({
    name: agentName,
    role: 'Technical Researcher',
    focus: `Research and document the ${investigationTopic} approach for the ${featureName} feature. Analyze pros, cons, technical details, and provide a recommendation.`,
    systemPrompt: `You are a technical researcher investigating the "${investigationTopic}" approach for the "${featureName}" feature.

Your task:
1. Research best practices for this approach
2. Identify pros and cons
3. Document technical implementation details
4. Estimate effort and identify risks
5. Provide a clear recommendation

Update the investigation document at: ${investigationPath}`,
    waitFor: [],
    priority: 0,
    workingDirectory: workspaceFolder?.uri.fsPath ?? process.cwd(),
  });

  // Show notification that agent has been spawned
  vscode.window.showInformationMessage(
    `🔍 Research agent "${agentName}" has been launched to investigate "${investigationTopic}"`,
    'View Agents'
  ).then(selection => {
    if (selection === 'View Agents') {
      // Open the Agent View panel
      vscode.commands.executeCommand('clautana.showAgentView');
    }
  });

  return {
    success: true,
    message: `Created investigation: **${sanitizedTopic}** for feature **${sanitizedFeature}**`,
    data: {
      path: investigationPath,
      featureName: sanitizedFeature,
      investigationTopic: sanitizedTopic,
      action: 'created',
    },
  };
}

/**
 * /fn-adr - Create ADR from viable investigations
 */
export async function handleFnAdr(ctx: AdrHandlerContext): Promise<AdrHandlerResult> {
  const fs = new AdrFileSystem();
  let featureName = ctx.args[0];

  // Interactive mode if no feature name provided
  if (!featureName) {
    const features = await fs.listDirs(fs.featuresPath);

    if (features.length === 0) {
      return {
        success: false,
        message: 'No features exist yet. Create one first with `/fn-feature <name>`',
      };
    }

    const selected = await vscode.window.showQuickPick(features, {
      placeHolder: 'Select a feature to create ADR for',
    });

    if (!selected) {
      return { success: false, message: 'ADR creation cancelled.' };
    }

    featureName = selected;
  }

  const sanitizedFeature = fs.sanitizeName(featureName);
  const featurePath = fs.getFeaturePath(sanitizedFeature);

  // Check if feature exists
  if (!(await fs.exists(featurePath))) {
    return {
      success: false,
      message: `Feature "${sanitizedFeature}" does not exist.`,
    };
  }

  // Get list of investigations
  const investigationsPath = fs.getInvestigationsPath(sanitizedFeature);
  const investigationFiles = await fs.listFiles(investigationsPath);
  const investigations = investigationFiles
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''));

  if (investigations.length === 0) {
    return {
      success: false,
      message: `No investigations found for "${sanitizedFeature}". Add investigations first with \`/fn-investigation ${sanitizedFeature} <topic>\``,
    };
  }

  // Check if ADR already exists
  const adrPath = fs.getWorkingAdrPath(sanitizedFeature);
  if (await fs.exists(adrPath)) {
    const overwrite = await vscode.window.showQuickPick(['Open existing', 'Overwrite'], {
      placeHolder: `ADR already exists for ${sanitizedFeature}`,
    });

    if (overwrite === 'Open existing') {
      const doc = await vscode.workspace.openTextDocument(adrPath);
      await vscode.window.showTextDocument(doc);
      return {
        success: true,
        message: `Opened existing ADR for **${sanitizedFeature}**`,
        data: { path: adrPath, featureName: sanitizedFeature, action: 'opened' },
      };
    }

    if (!overwrite) {
      return { success: false, message: 'ADR creation cancelled.' };
    }
  }

  // Create ADR directory and file
  await fs.ensureDir(fs.adrPath);
  await fs.writeFile(adrPath, generateAdrTemplate(sanitizedFeature, investigations));

  // Open the ADR in the editor
  const doc = await vscode.workspace.openTextDocument(adrPath);
  await vscode.window.showTextDocument(doc);

  return {
    success: true,
    message: `Created ADR for feature: **${sanitizedFeature}**\n\nInvestigations included:\n${investigations.map(i => `- ${i}`).join('\n')}\n\nNext steps:\n1. Review investigations and select an approach\n2. Fill in the decision rationale\n3. Define implementation tasks\n4. Use \`/fn-task\` to begin implementation`,
    data: {
      path: adrPath,
      featureName: sanitizedFeature,
      action: 'created',
    },
  };
}

/**
 * /fn-reject - Formally reject an investigation with reasoning
 */
export async function handleFnReject(ctx: AdrHandlerContext): Promise<AdrHandlerResult> {
  const fs = new AdrFileSystem();
  let [featureName, ...topicParts] = ctx.args;
  let investigationTopic = topicParts.join(' ');

  // Interactive mode
  if (!featureName) {
    const features = await fs.listDirs(fs.featuresPath);

    if (features.length === 0) {
      return {
        success: false,
        message: 'No features exist yet.',
      };
    }

    const selectedFeature = await vscode.window.showQuickPick(features, {
      placeHolder: 'Select a feature',
    });

    if (!selectedFeature) {
      return { success: false, message: 'Rejection cancelled.' };
    }

    featureName = selectedFeature;
  }

  const sanitizedFeature = fs.sanitizeName(featureName);

  if (!investigationTopic) {
    const investigationsPath = fs.getInvestigationsPath(sanitizedFeature);
    const investigationFiles = await fs.listFiles(investigationsPath);
    const investigations = investigationFiles
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''));

    if (investigations.length === 0) {
      return {
        success: false,
        message: `No investigations found for "${sanitizedFeature}".`,
      };
    }

    const selectedInvestigation = await vscode.window.showQuickPick(investigations, {
      placeHolder: 'Select investigation to reject',
    });

    if (!selectedInvestigation) {
      return { success: false, message: 'Rejection cancelled.' };
    }

    investigationTopic = selectedInvestigation;
  }

  const sanitizedTopic = fs.sanitizeName(investigationTopic);
  const investigationPath = fs.getInvestigationPath(sanitizedFeature, sanitizedTopic);

  if (!(await fs.exists(investigationPath))) {
    return {
      success: false,
      message: `Investigation "${sanitizedTopic}" not found for feature "${sanitizedFeature}".`,
    };
  }

  // Get rejection reason
  const reason = await vscode.window.showInputBox({
    prompt: 'Enter reason for rejection',
    placeHolder: 'e.g., Does not meet scalability requirements, Too complex for timeline',
  });

  if (!reason) {
    return { success: false, message: 'Rejection cancelled.' };
  }

  // Append rejection notice to the investigation
  const existingContent = await fs.readFile(investigationPath);
  const updatedContent = existingContent + generateRejectionNote(
    sanitizedFeature,
    sanitizedTopic,
    reason
  );
  await fs.writeFile(investigationPath, updatedContent);

  // Rename file to indicate rejection
  const rejectedPath = investigationPath.replace('.md', '.rejected.md');
  await fs.moveFile(investigationPath, rejectedPath);

  return {
    success: true,
    message: `Rejected investigation: **${sanitizedTopic}**\n\nReason: ${reason}\n\nThe investigation has been marked as rejected and archived.`,
    data: {
      path: rejectedPath,
      featureName: sanitizedFeature,
      investigationTopic: sanitizedTopic,
      action: 'rejected',
    },
  };
}

/**
 * /fn-task - Implement and iterate on ADR tasks
 */
export async function handleFnTask(ctx: AdrHandlerContext): Promise<AdrHandlerResult> {
  const fs = new AdrFileSystem();

  // List available ADRs
  const adrFiles = await fs.listFiles(fs.adrPath);
  const adrs = adrFiles
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''));

  if (adrs.length === 0) {
    return {
      success: false,
      message: 'No ADRs found. Create one first with `/fn-adr <feature-name>`',
    };
  }

  // Let user select an ADR
  const selectedAdr = await vscode.window.showQuickPick(adrs, {
    placeHolder: 'Select ADR to implement tasks for',
  });

  if (!selectedAdr) {
    return { success: false, message: 'Task implementation cancelled.' };
  }

  const adrPath = fs.getWorkingAdrPath(selectedAdr);
  const adrContent = await fs.readFile(adrPath);

  // Parse tasks from ADR (look for checkbox items)
  const taskRegex = /- \[( |x)\] (.+)/g;
  const tasks: Array<{ done: boolean; description: string }> = [];
  let match;

  while ((match = taskRegex.exec(adrContent)) !== null) {
    tasks.push({
      done: match[1] === 'x',
      description: match[2],
    });
  }

  if (tasks.length === 0) {
    return {
      success: false,
      message: `No tasks found in ADR "${selectedAdr}". Add tasks to the Implementation Plan section.`,
    };
  }

  const pendingTasks = tasks.filter(t => !t.done);

  if (pendingTasks.length === 0) {
    return {
      success: true,
      message: `All tasks in ADR "${selectedAdr}" are complete! Consider running \`/fn-review\` before accepting.`,
    };
  }

  // Show pending tasks
  const taskItems = pendingTasks.map(t => ({
    label: t.description,
    picked: false,
  }));

  const selectedTasks = await vscode.window.showQuickPick(taskItems, {
    placeHolder: 'Select tasks to work on (or cancel to work on all)',
    canPickMany: true,
  });

  const tasksToWork = selectedTasks && selectedTasks.length > 0
    ? selectedTasks.map(t => t.label)
    : pendingTasks.map(t => t.description);

  // Spawn implementation agent
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const agentName = `${selectedAdr}-implementer`;

  await ctx.agentPool.spawnAgent({
    name: agentName,
    role: 'Implementation Engineer',
    focus: `Implement tasks from the ${selectedAdr} ADR`,
    systemPrompt: `You are implementing tasks from the "${selectedAdr}" ADR.

ADR Location: ${adrPath}

Tasks to complete:
${tasksToWork.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Guidelines:
1. Work through tasks systematically
2. Write clean, tested code
3. Update the ADR to mark tasks as complete when done
4. Use the Kanban board to track progress
5. Send updates to the orchestrator on progress

When you complete a task, update the ADR file to check it off:
- [ ] Task -> - [x] Task`,
    waitFor: [],
    priority: 0,
    workingDirectory: workspaceFolder?.uri.fsPath ?? process.cwd(),
  });

  return {
    success: true,
    message: `Spawned implementation agent: **${agentName}**\n\nWorking on ${tasksToWork.length} task(s) from **${selectedAdr}**:\n${tasksToWork.map(t => `- ${t}`).join('\n')}`,
    data: {
      featureName: selectedAdr,
      action: 'implementing',
    },
  };
}

/**
 * /fn-accept - Accept implemented ADR and move to docs/adr/
 */
export async function handleFnAccept(ctx: AdrHandlerContext): Promise<AdrHandlerResult> {
  const fs = new AdrFileSystem();
  let featureName = ctx.args[0];

  // Interactive mode
  if (!featureName) {
    const adrFiles = await fs.listFiles(fs.adrPath);
    const adrs = adrFiles
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''));

    if (adrs.length === 0) {
      return {
        success: false,
        message: 'No ADRs found to accept.',
      };
    }

    const selected = await vscode.window.showQuickPick(adrs, {
      placeHolder: 'Select ADR to accept',
    });

    if (!selected) {
      return { success: false, message: 'Acceptance cancelled.' };
    }

    featureName = selected;
  }

  const sanitizedFeature = fs.sanitizeName(featureName);
  const workingAdrPath = fs.getWorkingAdrPath(sanitizedFeature);

  if (!(await fs.exists(workingAdrPath))) {
    return {
      success: false,
      message: `ADR "${sanitizedFeature}" not found.`,
    };
  }

  // Confirm acceptance
  const confirm = await vscode.window.showQuickPick(['Yes, accept ADR', 'No, cancel'], {
    placeHolder: `Accept ADR "${sanitizedFeature}" and move to docs/adr/?`,
  });

  if (confirm !== 'Yes, accept ADR') {
    return { success: false, message: 'Acceptance cancelled.' };
  }

  // Update ADR status
  let adrContent = await fs.readFile(workingAdrPath);
  adrContent = adrContent.replace(
    /\*\*Status:\*\* (Proposed|Draft|In Progress)/i,
    '**Status:** Accepted'
  );
  await fs.writeFile(workingAdrPath, adrContent);

  // Move to docs/adr/
  await fs.ensureDir(fs.docsAdrPath);
  const acceptedPath = fs.getAcceptedAdrPath(sanitizedFeature);
  await fs.moveFile(workingAdrPath, acceptedPath);

  // Open the accepted ADR
  const doc = await vscode.workspace.openTextDocument(acceptedPath);
  await vscode.window.showTextDocument(doc);

  return {
    success: true,
    message: `Accepted ADR: **${sanitizedFeature}**\n\nMoved to: ${acceptedPath}\n\nThe ADR is now part of the official documentation.`,
    data: {
      path: acceptedPath,
      featureName: sanitizedFeature,
      action: 'accepted',
    },
  };
}

/**
 * /fn-review - Technical code review before acceptance
 */
export async function handleFnReview(ctx: AdrHandlerContext): Promise<AdrHandlerResult> {
  const fs = new AdrFileSystem();

  // List ADRs that might need review
  const adrFiles = await fs.listFiles(fs.adrPath);
  const adrs = adrFiles
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''));

  if (adrs.length === 0) {
    return {
      success: false,
      message: 'No ADRs found to review.',
    };
  }

  const selectedAdr = await vscode.window.showQuickPick(adrs, {
    placeHolder: 'Select ADR to review implementation for',
  });

  if (!selectedAdr) {
    return { success: false, message: 'Review cancelled.' };
  }

  // Spawn a code reviewer agent
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const reviewerName = `${selectedAdr}-reviewer`;

  await ctx.agentPool.spawnAgent({
    name: reviewerName,
    role: 'Code Reviewer',
    focus: `Review implementation of the ${selectedAdr} ADR`,
    systemPrompt: `You are reviewing the implementation of the "${selectedAdr}" ADR.

ADR Location: ${fs.getWorkingAdrPath(selectedAdr)}
Feature Location: ${fs.getFeaturePath(selectedAdr)}

Your review should cover:
1. **Code Quality**: Clean code, proper patterns, no code smells
2. **Testing**: Adequate test coverage, edge cases handled
3. **Documentation**: Code comments, API docs, README updates
4. **Architecture**: Follows the ADR decisions, no deviations
5. **Security**: No vulnerabilities, proper input validation
6. **Performance**: No obvious bottlenecks, efficient algorithms

Provide a detailed review report with:
- Summary of findings
- Critical issues (must fix)
- Recommendations (should fix)
- Nice-to-haves (optional improvements)
- Overall assessment (approve/request changes)

When done, send your review report to the orchestrator.`,
    waitFor: [],
    priority: 0,
    workingDirectory: workspaceFolder?.uri.fsPath ?? process.cwd(),
  });

  return {
    success: true,
    message: `Spawned code reviewer: **${reviewerName}**\n\nReviewing implementation of **${selectedAdr}**\n\nThe reviewer will analyze the code and provide a detailed report.`,
    data: {
      featureName: selectedAdr,
      action: 'reviewing',
    },
  };
}

/**
 * /fn-document - Update documentation for implemented feature
 */
export async function handleFnDocument(ctx: AdrHandlerContext): Promise<AdrHandlerResult> {
  const fs = new AdrFileSystem();
  let featureName = ctx.args[0];

  // Interactive mode
  if (!featureName) {
    // Combine features and accepted ADRs
    const features = await fs.listDirs(fs.featuresPath);
    const acceptedAdrs = (await fs.listFiles(fs.docsAdrPath))
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace(/^\d+-/, '').replace('.md', ''));

    const allFeatures = [...new Set([...features, ...acceptedAdrs])];

    if (allFeatures.length === 0) {
      return {
        success: false,
        message: 'No features found to document.',
      };
    }

    const selected = await vscode.window.showQuickPick(allFeatures, {
      placeHolder: 'Select feature to document',
    });

    if (!selected) {
      return { success: false, message: 'Documentation cancelled.' };
    }

    featureName = selected;
  }

  const sanitizedFeature = fs.sanitizeName(featureName);

  // Ask what kind of documentation
  const docType = await vscode.window.showQuickPick([
    { label: 'API Documentation', value: 'api' },
    { label: 'User Guide', value: 'guide' },
    { label: 'README Update', value: 'readme' },
    { label: 'All of the above', value: 'all' },
  ], {
    placeHolder: 'What documentation should be updated?',
  });

  if (!docType) {
    return { success: false, message: 'Documentation cancelled.' };
  }

  // Spawn documentation agent
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const agentName = `${sanitizedFeature}-documenter`;

  await ctx.agentPool.spawnAgent({
    name: agentName,
    role: 'Technical Writer',
    focus: `Update documentation for the ${featureName} feature`,
    systemPrompt: `You are a technical writer updating documentation for the "${featureName}" feature.

Documentation type requested: ${docType.value}

Your tasks:
${docType.value === 'all' || docType.value === 'api' ? '1. Update/create API documentation (JSDoc, TypeDoc, etc.)' : ''}
${docType.value === 'all' || docType.value === 'guide' ? '2. Write/update user guide with examples' : ''}
${docType.value === 'all' || docType.value === 'readme' ? '3. Update README with feature description and usage' : ''}

Guidelines:
- Write clear, concise documentation
- Include code examples where appropriate
- Update any existing docs that reference this feature
- Ensure consistency with existing documentation style
- Add/update any necessary diagrams or flowcharts

Reference files:
- Feature: .clautana/features/${sanitizedFeature}/
- ADR: docs/adr/ (look for ${sanitizedFeature})`,
    waitFor: [],
    priority: 0,
    workingDirectory: workspaceFolder?.uri.fsPath ?? process.cwd(),
  });

  return {
    success: true,
    message: `Spawned documentation agent: **${agentName}**\n\nUpdating ${docType.label.toLowerCase()} for **${featureName}**`,
    data: {
      featureName: sanitizedFeature,
      action: 'documenting',
    },
  };
}

// ============================================================================
// Handler Registry
// ============================================================================

/**
 * Map of command names to their handlers
 */
export const adrWorkflowHandlers: Record<
  string,
  (ctx: AdrHandlerContext) => Promise<AdrHandlerResult>
> = {
  'fn-feature': handleFnFeature,
  'fn-investigation': handleFnInvestigation,
  'fn-adr': handleFnAdr,
  'fn-reject': handleFnReject,
  'fn-task': handleFnTask,
  'fn-accept': handleFnAccept,
  'fn-review': handleFnReview,
  'fn-document': handleFnDocument,
};

/**
 * Execute an ADR workflow command by name
 */
export async function executeAdrCommand(
  commandName: string,
  ctx: AdrHandlerContext
): Promise<AdrHandlerResult> {
  const handler = adrWorkflowHandlers[commandName];

  if (!handler) {
    return {
      success: false,
      message: `Unknown ADR workflow command: ${commandName}`,
    };
  }

  try {
    return await handler(ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Error executing ${commandName}: ${message}`,
    };
  }
}
