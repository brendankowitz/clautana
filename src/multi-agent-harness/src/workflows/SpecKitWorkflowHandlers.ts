/**
 * Spec-Kit Workflow Handlers
 *
 * Implements handlers for GitHub Spec-Kit workflow slash commands.
 * These commands follow the Spec-Kit convention for organizing specifications,
 * plans, and tasks in the .github/specs/ directory structure.
 *
 * Workflow stages:
 * 1. /speckit.init - Initialize GitHub Spec-Kit structure
 * 2. /speckit.constitution - Establish project principles
 * 3. /speckit.specify - Create functional specification
 * 4. /speckit.plan - Generate implementation plan
 * 5. /speckit.tasks - Break plan into tasks
 * 6. /speckit.implement - Execute tasks
 * 7. /speckit.clarify - Refine requirements
 * 8. /speckit.analyze - Check consistency
 */

import * as vscode from 'vscode';
import { OrchestratorAgent } from '../coordinator/OrchestratorAgent';
import { AgentPool } from '../coordinator/AgentPool';

/**
 * Context passed to each Spec-Kit workflow handler
 */
export interface SpecKitHandlerContext {
  /** Command arguments */
  args: string[];
  /** Raw arguments string */
  argsRaw: string;
  /** Orchestrator agent instance */
  orchestrator: OrchestratorAgent;
  /** Agent pool instance */
  agentPool: AgentPool;
  /** VS Code extension context */
  extensionContext: vscode.ExtensionContext;
}

/**
 * Result returned by Spec-Kit workflow handlers
 */
export interface SpecKitHandlerResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Message to display to the user */
  message: string;
  /** Optional additional data */
  data?: Record<string, unknown>;
}

/**
 * Spec-Kit directory structure paths
 */
const SPEC_KIT_PATHS = {
  root: '.github',
  specs: '.github/specs',
  constitution: '.github/CONSTITUTION.md',
  getFeaturePath: (featureName: string) => `.github/specs/${featureName}`,
  getSpecPath: (featureName: string) => `.github/specs/${featureName}/spec.md`,
  getPlanPath: (featureName: string) => `.github/specs/${featureName}/plan.md`,
  getTasksPath: (featureName: string) => `.github/specs/${featureName}/tasks.md`,
  getClarificationsPath: (featureName: string) => `.github/specs/${featureName}/clarifications.md`,
  getAnalysisPath: (featureName: string) => `.github/specs/${featureName}/analysis.md`,
};

/**
 * Get the workspace root path
 */
function getWorkspaceRoot(): string {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  return workspaceFolder?.uri.fsPath ?? process.cwd();
}

/**
 * Ensure a directory exists, creating it if necessary
 */
async function ensureDirectory(dirPath: string): Promise<void> {
  const uri = vscode.Uri.file(dirPath);
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    await vscode.workspace.fs.createDirectory(uri);
  }
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  const uri = vscode.Uri.file(filePath);
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write content to a file
 */
async function writeFile(filePath: string, content: string): Promise<void> {
  const uri = vscode.Uri.file(filePath);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
}

/**
 * Read content from a file
 */
async function readFile(filePath: string): Promise<string> {
  const uri = vscode.Uri.file(filePath);
  const content = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(content).toString('utf8');
}

/**
 * Normalize feature name to a valid directory name
 */
function normalizeFeatureName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// =============================================================================
// Handler: /speckit.init
// =============================================================================

/**
 * Initialize GitHub Spec-Kit structure in the project
 *
 * Creates:
 * - .github/ directory
 * - .github/specs/ directory
 * - .github/CONSTITUTION.md (placeholder)
 */
export async function handleSpecKitInit(ctx: SpecKitHandlerContext): Promise<SpecKitHandlerResult> {
  const projectName = ctx.args[0] || 'Project';
  const workspaceRoot = getWorkspaceRoot();

  try {
    // Create .github directory
    const githubPath = `${workspaceRoot}/${SPEC_KIT_PATHS.root}`;
    await ensureDirectory(githubPath);

    // Create .github/specs directory
    const specsPath = `${workspaceRoot}/${SPEC_KIT_PATHS.specs}`;
    await ensureDirectory(specsPath);

    // Check if constitution already exists
    const constitutionPath = `${workspaceRoot}/${SPEC_KIT_PATHS.constitution}`;
    const constitutionExists = await fileExists(constitutionPath);

    if (!constitutionExists) {
      // Create placeholder constitution
      const constitutionContent = `# ${projectName} Constitution

## Project Principles

> Define the core principles that guide development decisions for this project.
> Use \`/speckit.constitution\` to collaboratively establish these principles.

### 1. Purpose

_What is the primary goal of this project?_

### 2. Core Values

_What principles should guide all development decisions?_

### 3. Technical Guidelines

_What technical standards should be followed?_

### 4. Quality Standards

_What defines "done" for features in this project?_

---

*This constitution was initialized on ${new Date().toISOString().split('T')[0]}.*
*Use \`/speckit.constitution\` to refine these principles with AI assistance.*
`;
      await writeFile(constitutionPath, constitutionContent);
    }

    // Create a README in the specs folder
    const specsReadmePath = `${specsPath}/README.md`;
    const specsReadmeExists = await fileExists(specsReadmePath);

    if (!specsReadmeExists) {
      const specsReadmeContent = `# Specifications

This directory contains feature specifications following the GitHub Spec-Kit workflow.

## Structure

Each feature has its own directory containing:

- \`spec.md\` - Functional specification
- \`plan.md\` - Implementation plan
- \`tasks.md\` - Executable task breakdown
- \`clarifications.md\` - Requirement refinements (optional)
- \`analysis.md\` - Consistency analysis (optional)

## Workflow Commands

| Command | Description |
|---------|-------------|
| \`/speckit.specify <feature>\` | Create a new specification |
| \`/speckit.plan <feature>\` | Generate implementation plan |
| \`/speckit.tasks <feature>\` | Break plan into tasks |
| \`/speckit.implement <feature>\` | Execute tasks |
| \`/speckit.clarify <feature>\` | Refine requirements |
| \`/speckit.analyze <feature>\` | Check consistency |

## Features

<!-- Feature list will be updated as specs are created -->
`;
      await writeFile(specsReadmePath, specsReadmeContent);
    }

    return {
      success: true,
      message: `Initialized Spec-Kit for "${projectName}"

Created:
- \`.github/\` - GitHub configuration directory
- \`.github/specs/\` - Feature specifications
- \`.github/CONSTITUTION.md\` - Project principles${constitutionExists ? ' (already exists)' : ''}

Next steps:
1. Run \`/speckit.constitution\` to establish project principles
2. Run \`/speckit.specify <feature-name>\` to create your first specification`,
      data: {
        projectName,
        paths: {
          github: githubPath,
          specs: specsPath,
          constitution: constitutionPath,
        },
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to initialize Spec-Kit: ${errorMessage}`,
    };
  }
}

// =============================================================================
// Handler: /speckit.constitution
// =============================================================================

/**
 * Establish or refine project constitution with AI assistance
 *
 * Uses the orchestrator to guide the user through defining:
 * - Project purpose and goals
 * - Core development principles
 * - Technical guidelines
 * - Quality standards
 */
export async function handleSpecKitConstitution(ctx: SpecKitHandlerContext): Promise<SpecKitHandlerResult> {
  const workspaceRoot = getWorkspaceRoot();
  const constitutionPath = `${workspaceRoot}/${SPEC_KIT_PATHS.constitution}`;

  try {
    // Check if constitution exists
    const exists = await fileExists(constitutionPath);

    if (!exists) {
      return {
        success: false,
        message: 'Spec-Kit not initialized. Run `/speckit.init` first.',
      };
    }

    // Read current constitution
    const currentContent = await readFile(constitutionPath);

    // Send task to orchestrator to help refine the constitution
    const task = `Help me establish or refine the project constitution at ${SPEC_KIT_PATHS.constitution}.

Current constitution content:
\`\`\`markdown
${currentContent}
\`\`\`

Please:
1. Review the current constitution
2. Ask clarifying questions about the project's purpose, values, and technical guidelines
3. Help draft comprehensive principles that will guide development decisions
4. Update the CONSTITUTION.md file with the refined content

Focus on making the constitution practical and actionable for development teams.`;

    // Queue the task for the orchestrator
    await ctx.orchestrator.handleUserTask(task);

    return {
      success: true,
      message: `Starting constitution refinement session.

The orchestrator will guide you through establishing project principles.

Current constitution: \`${SPEC_KIT_PATHS.constitution}\``,
      data: {
        constitutionPath,
        action: 'refine',
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to start constitution session: ${errorMessage}`,
    };
  }
}

// =============================================================================
// Handler: /speckit.specify
// =============================================================================

/**
 * Create a functional specification for a feature
 *
 * Creates a new feature directory and spec.md file with AI assistance
 */
export async function handleSpecKitSpecify(ctx: SpecKitHandlerContext): Promise<SpecKitHandlerResult> {
  const featureNameRaw = ctx.args[0];

  if (!featureNameRaw) {
    // Interactive mode - prompt for feature name
    const input = await vscode.window.showInputBox({
      prompt: 'Enter the feature name',
      placeHolder: 'e.g., user-authentication, photo-upload, dark-mode',
      validateInput: (value) => {
        if (!value.trim()) return 'Feature name is required';
        return null;
      },
    });

    if (!input) {
      return { success: false, message: 'Specification cancelled.' };
    }

    ctx.args[0] = input;
    return handleSpecKitSpecify(ctx);
  }

  const featureName = normalizeFeatureName(featureNameRaw);
  const workspaceRoot = getWorkspaceRoot();

  try {
    // Check if Spec-Kit is initialized
    const specsPath = `${workspaceRoot}/${SPEC_KIT_PATHS.specs}`;
    const specsExists = await fileExists(specsPath);

    if (!specsExists) {
      return {
        success: false,
        message: 'Spec-Kit not initialized. Run `/speckit.init` first.',
      };
    }

    // Create feature directory
    const featurePath = `${workspaceRoot}/${SPEC_KIT_PATHS.getFeaturePath(featureName)}`;
    await ensureDirectory(featurePath);

    // Check if spec already exists
    const specPath = `${workspaceRoot}/${SPEC_KIT_PATHS.getSpecPath(featureName)}`;
    const specExists = await fileExists(specPath);

    if (specExists) {
      const overwrite = await vscode.window.showQuickPick(['Continue editing existing spec', 'Cancel'], {
        placeHolder: `Specification for "${featureName}" already exists`,
      });

      if (overwrite === 'Cancel') {
        return { success: false, message: 'Specification cancelled.' };
      }
    }

    // Read constitution for context
    const constitutionPath = `${workspaceRoot}/${SPEC_KIT_PATHS.constitution}`;
    let constitutionContent = '';
    try {
      constitutionContent = await readFile(constitutionPath);
    } catch {
      // Constitution might not exist
    }

    // Create initial spec template if it doesn't exist
    if (!specExists) {
      const specTemplate = `# ${featureNameRaw.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} Specification

## Overview

_Describe what this feature does and why it's needed._

## User Stories

### As a [user type]

- I want to [action]
- So that [benefit]

## Functional Requirements

### FR-1: [Requirement Name]

_Description of the requirement_

**Acceptance Criteria:**
- [ ] Criteria 1
- [ ] Criteria 2

### FR-2: [Requirement Name]

_Description of the requirement_

**Acceptance Criteria:**
- [ ] Criteria 1
- [ ] Criteria 2

## Non-Functional Requirements

### Performance

_Performance expectations_

### Security

_Security considerations_

### Accessibility

_Accessibility requirements_

## Out of Scope

_What is explicitly NOT part of this feature_

## Dependencies

_Other features or systems this depends on_

## Open Questions

- [ ] Question 1
- [ ] Question 2

---

*Created: ${new Date().toISOString().split('T')[0]}*
*Status: Draft*
`;
      await writeFile(specPath, specTemplate);
    }

    // Send task to orchestrator to help develop the specification
    const existingSpec = specExists ? await readFile(specPath) : '';

    const task = `Help me ${specExists ? 'refine' : 'create'} a functional specification for the "${featureName}" feature.

${constitutionContent ? `Project Constitution (for context):
\`\`\`markdown
${constitutionContent.slice(0, 2000)}${constitutionContent.length > 2000 ? '\n...(truncated)' : ''}
\`\`\`

` : ''}${specExists ? `Current specification:
\`\`\`markdown
${existingSpec}
\`\`\`

` : ''}Please:
1. ${specExists ? 'Review the current specification and identify gaps' : 'Ask clarifying questions about the feature requirements'}
2. Help define clear user stories and acceptance criteria
3. Identify functional and non-functional requirements
4. Document dependencies and open questions
5. Update the specification file at: ${SPEC_KIT_PATHS.getSpecPath(featureName)}

Focus on making the specification complete enough for implementation planning.`;

    await ctx.orchestrator.handleUserTask(task);

    return {
      success: true,
      message: `Starting specification session for "${featureName}".

The orchestrator will help you define the feature requirements.

Specification file: \`${SPEC_KIT_PATHS.getSpecPath(featureName)}\``,
      data: {
        featureName,
        specPath,
        isNew: !specExists,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to create specification: ${errorMessage}`,
    };
  }
}

// =============================================================================
// Handler: /speckit.plan
// =============================================================================

/**
 * Generate an implementation plan from a specification
 *
 * Reads the spec.md and creates plan.md with technical implementation details
 */
export async function handleSpecKitPlan(ctx: SpecKitHandlerContext): Promise<SpecKitHandlerResult> {
  const featureNameRaw = ctx.args[0];

  if (!featureNameRaw) {
    // List available features for selection
    const workspaceRoot = getWorkspaceRoot();
    const specsPath = `${workspaceRoot}/${SPEC_KIT_PATHS.specs}`;

    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(specsPath));
      const features = entries
        .filter(([, type]) => type === vscode.FileType.Directory)
        .map(([name]) => name)
        .filter((name) => name !== '.git');

      if (features.length === 0) {
        return {
          success: false,
          message: 'No features found. Create a specification first with `/speckit.specify <feature-name>`.',
        };
      }

      const selected = await vscode.window.showQuickPick(features, {
        placeHolder: 'Select a feature to plan',
      });

      if (!selected) {
        return { success: false, message: 'Planning cancelled.' };
      }

      ctx.args[0] = selected;
      return handleSpecKitPlan(ctx);
    } catch {
      return {
        success: false,
        message: 'Spec-Kit not initialized. Run `/speckit.init` first.',
      };
    }
  }

  const featureName = normalizeFeatureName(featureNameRaw);
  const workspaceRoot = getWorkspaceRoot();

  try {
    // Check if specification exists
    const specPath = `${workspaceRoot}/${SPEC_KIT_PATHS.getSpecPath(featureName)}`;
    const specExists = await fileExists(specPath);

    if (!specExists) {
      return {
        success: false,
        message: `Specification for "${featureName}" not found. Create it first with \`/speckit.specify ${featureName}\`.`,
      };
    }

    // Read the specification
    const specContent = await readFile(specPath);

    // Check if plan already exists
    const planPath = `${workspaceRoot}/${SPEC_KIT_PATHS.getPlanPath(featureName)}`;
    const planExists = await fileExists(planPath);

    // Read constitution for context
    const constitutionPath = `${workspaceRoot}/${SPEC_KIT_PATHS.constitution}`;
    let constitutionContent = '';
    try {
      constitutionContent = await readFile(constitutionPath);
    } catch {
      // Constitution might not exist
    }

    // Create initial plan template if it doesn't exist
    if (!planExists) {
      const planTemplate = `# ${featureNameRaw.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} Implementation Plan

## Architecture Overview

_High-level architecture description_

## Technical Approach

### Component Design

_Key components and their responsibilities_

### Data Model

_Data structures and storage_

### API Design

_API endpoints or interfaces_

## Implementation Phases

### Phase 1: Foundation

_Core infrastructure and setup_

**Duration:** _estimated time_

### Phase 2: Core Features

_Main feature implementation_

**Duration:** _estimated time_

### Phase 3: Polish

_Edge cases, error handling, testing_

**Duration:** _estimated time_

## Technical Decisions

### Decision 1: [Topic]

**Context:** _Why this decision is needed_

**Decision:** _What was decided_

**Rationale:** _Why this approach was chosen_

### Decision 2: [Topic]

**Context:** _Why this decision is needed_

**Decision:** _What was decided_

**Rationale:** _Why this approach was chosen_

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Risk 1 | High/Medium/Low | High/Medium/Low | Mitigation strategy |

## Testing Strategy

### Unit Testing

_Unit test approach_

### Integration Testing

_Integration test approach_

### E2E Testing

_End-to-end test approach_

## Dependencies

### External Dependencies

_Third-party libraries or services_

### Internal Dependencies

_Other features or components_

---

*Created: ${new Date().toISOString().split('T')[0]}*
*Specification: [spec.md](./spec.md)*
*Status: Draft*
`;
      await writeFile(planPath, planTemplate);
    }

    const existingPlan = planExists ? await readFile(planPath) : '';

    // Send task to orchestrator to help develop the plan
    const task = `Help me ${planExists ? 'refine' : 'create'} an implementation plan for the "${featureName}" feature.

Feature Specification:
\`\`\`markdown
${specContent}
\`\`\`

${constitutionContent ? `Project Constitution (for context):
\`\`\`markdown
${constitutionContent.slice(0, 1500)}${constitutionContent.length > 1500 ? '\n...(truncated)' : ''}
\`\`\`

` : ''}${planExists ? `Current plan:
\`\`\`markdown
${existingPlan}
\`\`\`

` : ''}Please:
1. Analyze the specification requirements
2. Propose a technical architecture and component design
3. Define implementation phases with clear deliverables
4. Document key technical decisions with rationale
5. Identify risks and testing strategy
6. Update the plan file at: ${SPEC_KIT_PATHS.getPlanPath(featureName)}

Focus on creating a realistic, actionable implementation plan.`;

    await ctx.orchestrator.handleUserTask(task);

    return {
      success: true,
      message: `Starting implementation planning for "${featureName}".

The orchestrator will help you create a technical implementation plan.

Plan file: \`${SPEC_KIT_PATHS.getPlanPath(featureName)}\``,
      data: {
        featureName,
        specPath,
        planPath,
        isNew: !planExists,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to create plan: ${errorMessage}`,
    };
  }
}

// =============================================================================
// Handler: /speckit.tasks
// =============================================================================

/**
 * Break an implementation plan into executable tasks
 *
 * Reads the plan.md and creates tasks.md with specific work items
 */
export async function handleSpecKitTasks(ctx: SpecKitHandlerContext): Promise<SpecKitHandlerResult> {
  const featureNameRaw = ctx.args[0];

  if (!featureNameRaw) {
    // List available features for selection
    const workspaceRoot = getWorkspaceRoot();
    const specsPath = `${workspaceRoot}/${SPEC_KIT_PATHS.specs}`;

    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(specsPath));
      const features = entries
        .filter(([, type]) => type === vscode.FileType.Directory)
        .map(([name]) => name)
        .filter((name) => name !== '.git');

      if (features.length === 0) {
        return {
          success: false,
          message: 'No features found. Create a specification first.',
        };
      }

      const selected = await vscode.window.showQuickPick(features, {
        placeHolder: 'Select a feature to break into tasks',
      });

      if (!selected) {
        return { success: false, message: 'Task creation cancelled.' };
      }

      ctx.args[0] = selected;
      return handleSpecKitTasks(ctx);
    } catch {
      return {
        success: false,
        message: 'Spec-Kit not initialized. Run `/speckit.init` first.',
      };
    }
  }

  const featureName = normalizeFeatureName(featureNameRaw);
  const workspaceRoot = getWorkspaceRoot();

  try {
    // Check if plan exists
    const planPath = `${workspaceRoot}/${SPEC_KIT_PATHS.getPlanPath(featureName)}`;
    const planExists = await fileExists(planPath);

    if (!planExists) {
      return {
        success: false,
        message: `Implementation plan for "${featureName}" not found. Create it first with \`/speckit.plan ${featureName}\`.`,
      };
    }

    // Read the plan
    const planContent = await readFile(planPath);

    // Read the spec for context
    const specPath = `${workspaceRoot}/${SPEC_KIT_PATHS.getSpecPath(featureName)}`;
    let specContent = '';
    try {
      specContent = await readFile(specPath);
    } catch {
      // Spec might not exist
    }

    // Check if tasks already exist
    const tasksPath = `${workspaceRoot}/${SPEC_KIT_PATHS.getTasksPath(featureName)}`;
    const tasksExist = await fileExists(tasksPath);

    // Create initial tasks template if it doesn't exist
    if (!tasksExist) {
      const tasksTemplate = `# ${featureNameRaw.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} Tasks

## Overview

This document contains the executable task breakdown for implementing the feature.

## Task Status Legend

- [ ] Not started
- [x] Completed
- [~] In progress
- [!] Blocked

## Phase 1: Foundation

### Task 1.1: [Task Name]

**Description:** _What needs to be done_

**Acceptance Criteria:**
- [ ] Criteria 1
- [ ] Criteria 2

**Estimated Time:** _X hours_

**Dependencies:** _None / Task X.X_

---

### Task 1.2: [Task Name]

**Description:** _What needs to be done_

**Acceptance Criteria:**
- [ ] Criteria 1
- [ ] Criteria 2

**Estimated Time:** _X hours_

**Dependencies:** _None / Task X.X_

---

## Phase 2: Core Features

### Task 2.1: [Task Name]

**Description:** _What needs to be done_

**Acceptance Criteria:**
- [ ] Criteria 1
- [ ] Criteria 2

**Estimated Time:** _X hours_

**Dependencies:** _None / Task X.X_

---

## Phase 3: Polish

### Task 3.1: [Task Name]

**Description:** _What needs to be done_

**Acceptance Criteria:**
- [ ] Criteria 1
- [ ] Criteria 2

**Estimated Time:** _X hours_

**Dependencies:** _None / Task X.X_

---

## Progress Summary

| Phase | Total Tasks | Completed | In Progress | Blocked |
|-------|-------------|-----------|-------------|---------|
| Phase 1 | 0 | 0 | 0 | 0 |
| Phase 2 | 0 | 0 | 0 | 0 |
| Phase 3 | 0 | 0 | 0 | 0 |

---

*Created: ${new Date().toISOString().split('T')[0]}*
*Plan: [plan.md](./plan.md)*
*Specification: [spec.md](./spec.md)*
`;
      await writeFile(tasksPath, tasksTemplate);
    }

    const existingTasks = tasksExist ? await readFile(tasksPath) : '';

    // Send task to orchestrator to help develop tasks
    const task = `Help me ${tasksExist ? 'refine' : 'create'} an executable task breakdown for the "${featureName}" feature.

Implementation Plan:
\`\`\`markdown
${planContent}
\`\`\`

${specContent ? `Feature Specification (for context):
\`\`\`markdown
${specContent.slice(0, 1500)}${specContent.length > 1500 ? '\n...(truncated)' : ''}
\`\`\`

` : ''}${tasksExist ? `Current tasks:
\`\`\`markdown
${existingTasks}
\`\`\`

` : ''}Please:
1. Break down each implementation phase into specific, actionable tasks
2. Each task should be completable in 1-4 hours
3. Define clear acceptance criteria for each task
4. Identify dependencies between tasks
5. Estimate time for each task
6. Update the tasks file at: ${SPEC_KIT_PATHS.getTasksPath(featureName)}

Focus on creating tasks that can be executed by developers or AI agents.`;

    await ctx.orchestrator.handleUserTask(task);

    return {
      success: true,
      message: `Starting task breakdown for "${featureName}".

The orchestrator will help you create actionable tasks.

Tasks file: \`${SPEC_KIT_PATHS.getTasksPath(featureName)}\``,
      data: {
        featureName,
        planPath,
        tasksPath,
        isNew: !tasksExist,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to create tasks: ${errorMessage}`,
    };
  }
}

// =============================================================================
// Handler: /speckit.implement
// =============================================================================

/**
 * Execute tasks for a feature implementation
 *
 * Spawns agents to work through the tasks systematically
 */
export async function handleSpecKitImplement(ctx: SpecKitHandlerContext): Promise<SpecKitHandlerResult> {
  const featureNameRaw = ctx.args[0];

  if (!featureNameRaw) {
    // List available features for selection
    const workspaceRoot = getWorkspaceRoot();
    const specsPath = `${workspaceRoot}/${SPEC_KIT_PATHS.specs}`;

    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(specsPath));
      const features = entries
        .filter(([, type]) => type === vscode.FileType.Directory)
        .map(([name]) => name)
        .filter((name) => name !== '.git');

      if (features.length === 0) {
        return {
          success: false,
          message: 'No features found. Create a specification first.',
        };
      }

      const selected = await vscode.window.showQuickPick(features, {
        placeHolder: 'Select a feature to implement',
      });

      if (!selected) {
        return { success: false, message: 'Implementation cancelled.' };
      }

      ctx.args[0] = selected;
      return handleSpecKitImplement(ctx);
    } catch {
      return {
        success: false,
        message: 'Spec-Kit not initialized. Run `/speckit.init` first.',
      };
    }
  }

  const featureName = normalizeFeatureName(featureNameRaw);
  const workspaceRoot = getWorkspaceRoot();

  try {
    // Check if tasks exist
    const tasksPath = `${workspaceRoot}/${SPEC_KIT_PATHS.getTasksPath(featureName)}`;
    const tasksExist = await fileExists(tasksPath);

    if (!tasksExist) {
      return {
        success: false,
        message: `Tasks for "${featureName}" not found. Create them first with \`/speckit.tasks ${featureName}\`.`,
      };
    }

    // Read all relevant documents
    const tasksContent = await readFile(tasksPath);

    const specPath = `${workspaceRoot}/${SPEC_KIT_PATHS.getSpecPath(featureName)}`;
    let specContent = '';
    try {
      specContent = await readFile(specPath);
    } catch {
      // Spec might not exist
    }

    const planPath = `${workspaceRoot}/${SPEC_KIT_PATHS.getPlanPath(featureName)}`;
    let planContent = '';
    try {
      planContent = await readFile(planPath);
    } catch {
      // Plan might not exist
    }

    // Send task to orchestrator to coordinate implementation
    const task = `Implement the "${featureName}" feature by executing the defined tasks.

Tasks to execute:
\`\`\`markdown
${tasksContent}
\`\`\`

${planContent ? `Implementation Plan (for context):
\`\`\`markdown
${planContent.slice(0, 2000)}${planContent.length > 2000 ? '\n...(truncated)' : ''}
\`\`\`

` : ''}${specContent ? `Feature Specification (for context):
\`\`\`markdown
${specContent.slice(0, 1500)}${specContent.length > 1500 ? '\n...(truncated)' : ''}
\`\`\`

` : ''}Please:
1. Review the tasks and identify which are not yet completed
2. Create User Stories (work items) for each incomplete task
3. Spawn appropriate specialist agents to work on tasks in parallel where possible
4. Coordinate task execution respecting dependencies
5. Update the tasks file to mark progress: ${SPEC_KIT_PATHS.getTasksPath(featureName)}
6. Report progress and any blockers

Work through the tasks systematically, ensuring each meets its acceptance criteria.`;

    await ctx.orchestrator.handleUserTask(task);

    return {
      success: true,
      message: `Starting implementation of "${featureName}".

The orchestrator will coordinate task execution and spawn specialist agents.

Tasks file: \`${SPEC_KIT_PATHS.getTasksPath(featureName)}\`

Use \`/status\` to monitor agent progress.`,
      data: {
        featureName,
        tasksPath,
        specPath,
        planPath,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to start implementation: ${errorMessage}`,
    };
  }
}

// =============================================================================
// Handler: /speckit.clarify
// =============================================================================

/**
 * Structured requirement refinement for a feature
 *
 * Creates clarifications.md with answers to open questions
 */
export async function handleSpecKitClarify(ctx: SpecKitHandlerContext): Promise<SpecKitHandlerResult> {
  const featureNameRaw = ctx.args[0];

  if (!featureNameRaw) {
    // List available features for selection
    const workspaceRoot = getWorkspaceRoot();
    const specsPath = `${workspaceRoot}/${SPEC_KIT_PATHS.specs}`;

    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(specsPath));
      const features = entries
        .filter(([, type]) => type === vscode.FileType.Directory)
        .map(([name]) => name)
        .filter((name) => name !== '.git');

      if (features.length === 0) {
        return {
          success: false,
          message: 'No features found. Create a specification first.',
        };
      }

      const selected = await vscode.window.showQuickPick(features, {
        placeHolder: 'Select a feature to clarify',
      });

      if (!selected) {
        return { success: false, message: 'Clarification cancelled.' };
      }

      ctx.args[0] = selected;
      return handleSpecKitClarify(ctx);
    } catch {
      return {
        success: false,
        message: 'Spec-Kit not initialized. Run `/speckit.init` first.',
      };
    }
  }

  const featureName = normalizeFeatureName(featureNameRaw);
  const workspaceRoot = getWorkspaceRoot();

  try {
    // Check if spec exists
    const specPath = `${workspaceRoot}/${SPEC_KIT_PATHS.getSpecPath(featureName)}`;
    const specExists = await fileExists(specPath);

    if (!specExists) {
      return {
        success: false,
        message: `Specification for "${featureName}" not found. Create it first with \`/speckit.specify ${featureName}\`.`,
      };
    }

    // Read the specification
    const specContent = await readFile(specPath);

    // Read the plan if it exists
    const planPath = `${workspaceRoot}/${SPEC_KIT_PATHS.getPlanPath(featureName)}`;
    let planContent = '';
    try {
      planContent = await readFile(planPath);
    } catch {
      // Plan might not exist
    }

    // Check if clarifications already exist
    const clarificationsPath = `${workspaceRoot}/${SPEC_KIT_PATHS.getClarificationsPath(featureName)}`;
    const clarificationsExist = await fileExists(clarificationsPath);

    // Create initial clarifications template if it doesn't exist
    if (!clarificationsExist) {
      const clarificationsTemplate = `# ${featureNameRaw.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} Clarifications

## Purpose

This document captures requirement clarifications and answers to open questions.

## Clarifications

### Q1: [Question from specification]

**Date:** ${new Date().toISOString().split('T')[0]}

**Question:** _Original question_

**Answer:** _Clarified answer_

**Impact:** _How this affects the specification or plan_

---

### Q2: [Question from specification]

**Date:** ${new Date().toISOString().split('T')[0]}

**Question:** _Original question_

**Answer:** _Clarified answer_

**Impact:** _How this affects the specification or plan_

---

## Edge Cases

### Edge Case 1: [Scenario]

**Scenario:** _Description of the edge case_

**Expected Behavior:** _How the system should handle this_

**Rationale:** _Why this behavior was chosen_

---

## Assumptions

1. **Assumption 1:** _Statement_ - _Rationale_
2. **Assumption 2:** _Statement_ - _Rationale_

## Change Log

| Date | Change | Affected Documents |
|------|--------|-------------------|
| ${new Date().toISOString().split('T')[0]} | Initial clarifications | spec.md |

---

*Created: ${new Date().toISOString().split('T')[0]}*
*Specification: [spec.md](./spec.md)*
`;
      await writeFile(clarificationsPath, clarificationsTemplate);
    }

    const existingClarifications = clarificationsExist ? await readFile(clarificationsPath) : '';

    // Send task to orchestrator to help clarify requirements
    const task = `Help me clarify requirements for the "${featureName}" feature.

Feature Specification:
\`\`\`markdown
${specContent}
\`\`\`

${planContent ? `Implementation Plan:
\`\`\`markdown
${planContent.slice(0, 1500)}${planContent.length > 1500 ? '\n...(truncated)' : ''}
\`\`\`

` : ''}${clarificationsExist ? `Existing Clarifications:
\`\`\`markdown
${existingClarifications}
\`\`\`

` : ''}Please:
1. Identify open questions and ambiguities in the specification
2. Ask clarifying questions to resolve these ambiguities
3. Document edge cases and expected behaviors
4. Record assumptions and their rationale
5. Update the clarifications file at: ${SPEC_KIT_PATHS.getClarificationsPath(featureName)}
6. If clarifications impact the spec or plan, note what needs updating

Focus on resolving ambiguities that would block implementation.`;

    await ctx.orchestrator.handleUserTask(task);

    return {
      success: true,
      message: `Starting clarification session for "${featureName}".

The orchestrator will help you resolve ambiguities and edge cases.

Clarifications file: \`${SPEC_KIT_PATHS.getClarificationsPath(featureName)}\``,
      data: {
        featureName,
        specPath,
        clarificationsPath,
        isNew: !clarificationsExist,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to start clarification: ${errorMessage}`,
    };
  }
}

// =============================================================================
// Handler: /speckit.analyze
// =============================================================================

/**
 * Check cross-artifact consistency for a feature
 *
 * Analyzes spec, plan, and tasks for consistency issues
 */
export async function handleSpecKitAnalyze(ctx: SpecKitHandlerContext): Promise<SpecKitHandlerResult> {
  const featureNameRaw = ctx.args[0];

  if (!featureNameRaw) {
    // List available features for selection
    const workspaceRoot = getWorkspaceRoot();
    const specsPath = `${workspaceRoot}/${SPEC_KIT_PATHS.specs}`;

    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(specsPath));
      const features = entries
        .filter(([, type]) => type === vscode.FileType.Directory)
        .map(([name]) => name)
        .filter((name) => name !== '.git');

      if (features.length === 0) {
        return {
          success: false,
          message: 'No features found. Create a specification first.',
        };
      }

      const selected = await vscode.window.showQuickPick(features, {
        placeHolder: 'Select a feature to analyze',
      });

      if (!selected) {
        return { success: false, message: 'Analysis cancelled.' };
      }

      ctx.args[0] = selected;
      return handleSpecKitAnalyze(ctx);
    } catch {
      return {
        success: false,
        message: 'Spec-Kit not initialized. Run `/speckit.init` first.',
      };
    }
  }

  const featureName = normalizeFeatureName(featureNameRaw);
  const workspaceRoot = getWorkspaceRoot();

  try {
    // Check if spec exists
    const specPath = `${workspaceRoot}/${SPEC_KIT_PATHS.getSpecPath(featureName)}`;
    const specExists = await fileExists(specPath);

    if (!specExists) {
      return {
        success: false,
        message: `Specification for "${featureName}" not found. Create it first with \`/speckit.specify ${featureName}\`.`,
      };
    }

    // Read all documents
    const specContent = await readFile(specPath);

    const planPath = `${workspaceRoot}/${SPEC_KIT_PATHS.getPlanPath(featureName)}`;
    let planContent = '';
    try {
      planContent = await readFile(planPath);
    } catch {
      // Plan might not exist
    }

    const tasksPath = `${workspaceRoot}/${SPEC_KIT_PATHS.getTasksPath(featureName)}`;
    let tasksContent = '';
    try {
      tasksContent = await readFile(tasksPath);
    } catch {
      // Tasks might not exist
    }

    const clarificationsPath = `${workspaceRoot}/${SPEC_KIT_PATHS.getClarificationsPath(featureName)}`;
    let clarificationsContent = '';
    try {
      clarificationsContent = await readFile(clarificationsPath);
    } catch {
      // Clarifications might not exist
    }

    // Read constitution for context
    const constitutionPath = `${workspaceRoot}/${SPEC_KIT_PATHS.constitution}`;
    let constitutionContent = '';
    try {
      constitutionContent = await readFile(constitutionPath);
    } catch {
      // Constitution might not exist
    }

    // Check if analysis already exists
    const analysisPath = `${workspaceRoot}/${SPEC_KIT_PATHS.getAnalysisPath(featureName)}`;
    const analysisExists = await fileExists(analysisPath);

    // Create initial analysis template if it doesn't exist
    if (!analysisExists) {
      const analysisTemplate = `# ${featureNameRaw.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} Consistency Analysis

## Analysis Date

${new Date().toISOString().split('T')[0]}

## Documents Analyzed

- [x] Specification (spec.md)
- [${planContent ? 'x' : ' '}] Implementation Plan (plan.md)
- [${tasksContent ? 'x' : ' '}] Tasks (tasks.md)
- [${clarificationsContent ? 'x' : ' '}] Clarifications (clarifications.md)

## Consistency Issues

### Issue 1: [Title]

**Severity:** Critical / High / Medium / Low

**Description:** _What is inconsistent_

**Documents Affected:** _spec.md, plan.md_

**Recommendation:** _How to resolve_

---

### Issue 2: [Title]

**Severity:** Critical / High / Medium / Low

**Description:** _What is inconsistent_

**Documents Affected:** _spec.md, tasks.md_

**Recommendation:** _How to resolve_

---

## Coverage Analysis

### Requirements Coverage

| Requirement | In Plan | In Tasks | Status |
|-------------|---------|----------|--------|
| FR-1 | Yes/No | Yes/No | Covered/Missing |

### Missing Items

1. _Item 1_
2. _Item 2_

## Constitution Alignment

### Alignment Score: _X/10_

**Aligned:**
- _Principle 1: How this feature aligns_

**Potential Conflicts:**
- _Principle 2: Potential concern_

## Recommendations

1. **Priority 1:** _Recommendation_
2. **Priority 2:** _Recommendation_
3. **Priority 3:** _Recommendation_

## Summary

_Overall assessment of feature readiness and quality_

---

*Analysis by: AI Assistant*
*Date: ${new Date().toISOString().split('T')[0]}*
`;
      await writeFile(analysisPath, analysisTemplate);
    }

    // Send task to orchestrator to perform analysis
    const task = `Analyze the "${featureName}" feature for cross-artifact consistency.

${constitutionContent ? `Project Constitution:
\`\`\`markdown
${constitutionContent.slice(0, 1000)}${constitutionContent.length > 1000 ? '\n...(truncated)' : ''}
\`\`\`

` : ''}Feature Specification:
\`\`\`markdown
${specContent}
\`\`\`

${planContent ? `Implementation Plan:
\`\`\`markdown
${planContent}
\`\`\`

` : '*No implementation plan yet*\n\n'}${tasksContent ? `Tasks:
\`\`\`markdown
${tasksContent}
\`\`\`

` : '*No tasks yet*\n\n'}${clarificationsContent ? `Clarifications:
\`\`\`markdown
${clarificationsContent}
\`\`\`

` : ''}Please:
1. Check consistency between specification, plan, and tasks
2. Verify all requirements are covered in the plan and tasks
3. Identify any conflicts or gaps
4. Check alignment with project constitution
5. Provide specific recommendations for improvements
6. Update the analysis file at: ${SPEC_KIT_PATHS.getAnalysisPath(featureName)}

Focus on identifying issues that would cause implementation problems.`;

    await ctx.orchestrator.handleUserTask(task);

    return {
      success: true,
      message: `Starting consistency analysis for "${featureName}".

The orchestrator will analyze all documents for consistency issues.

Analysis file: \`${SPEC_KIT_PATHS.getAnalysisPath(featureName)}\``,
      data: {
        featureName,
        analysisPath,
        documentsAnalyzed: {
          spec: true,
          plan: !!planContent,
          tasks: !!tasksContent,
          clarifications: !!clarificationsContent,
          constitution: !!constitutionContent,
        },
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to start analysis: ${errorMessage}`,
    };
  }
}

// =============================================================================
// Handler Registry
// =============================================================================

/**
 * Registry of all Spec-Kit workflow handlers
 */
export const specKitHandlers = {
  'speckit.init': handleSpecKitInit,
  'speckit.constitution': handleSpecKitConstitution,
  'speckit.specify': handleSpecKitSpecify,
  'speckit.plan': handleSpecKitPlan,
  'speckit.tasks': handleSpecKitTasks,
  'speckit.implement': handleSpecKitImplement,
  'speckit.clarify': handleSpecKitClarify,
  'speckit.analyze': handleSpecKitAnalyze,
} as const;

export type SpecKitCommand = keyof typeof specKitHandlers;

/**
 * Execute a Spec-Kit workflow command
 */
export async function executeSpecKitCommand(
  command: SpecKitCommand,
  ctx: SpecKitHandlerContext
): Promise<SpecKitHandlerResult> {
  const handler = specKitHandlers[command];
  if (!handler) {
    return {
      success: false,
      message: `Unknown Spec-Kit command: ${command}`,
    };
  }
  return handler(ctx);
}

/**
 * Get all available Spec-Kit commands
 */
export function getSpecKitCommands(): Array<{
  command: string;
  description: string;
  usage: string;
}> {
  return [
    {
      command: '/speckit.init',
      description: 'Initialize GitHub Spec-Kit in this project',
      usage: '/speckit.init [project-name]',
    },
    {
      command: '/speckit.constitution',
      description: 'Establish project principles and guidelines',
      usage: '/speckit.constitution',
    },
    {
      command: '/speckit.specify',
      description: 'Create functional specification from requirements',
      usage: '/speckit.specify <feature-name>',
    },
    {
      command: '/speckit.plan',
      description: 'Generate technical implementation plan from spec',
      usage: '/speckit.plan <feature-name>',
    },
    {
      command: '/speckit.tasks',
      description: 'Break plan into executable tasks',
      usage: '/speckit.tasks <feature-name>',
    },
    {
      command: '/speckit.implement',
      description: 'Execute all tasks systematically',
      usage: '/speckit.implement <feature-name>',
    },
    {
      command: '/speckit.clarify',
      description: 'Structured requirement refinement',
      usage: '/speckit.clarify <feature-name>',
    },
    {
      command: '/speckit.analyze',
      description: 'Check cross-artifact consistency',
      usage: '/speckit.analyze <feature-name>',
    },
  ];
}
