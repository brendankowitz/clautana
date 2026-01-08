# Feature: Kanban Work Items

**Status**: Investigation
**Created**: 2026-01-01

## Problem Statement

The Clautana multi-agent orchestrator needs a structured way to manage work items that agents can pick up, work on, and transition through a workflow. Currently, the orchestrator receives ad-hoc tasks from users but has no persistent backlog or visual representation of work in progress.

Users need:
- A way to queue up multiple tasks for agents to work through
- Visibility into what agents are working on
- A code review workflow where completed work gets reviewed before being marked done
- Persistent work items that survive extension restarts

## Proposed Solution

A file-based Kanban board system integrated into Clautana:

1. **File-based persistence**: Work items stored as Markdown files in `.clautana/workitems/{status}/`
2. **Coordinator-driven workflow**: Coordinator **always** breaks tasks into work items first
3. **Automatic agent spawning**: Coordinator creates work items, spawns agents, and assigns them
4. **Built-in MCP tools**: Agents can manipulate the board via MCP server
5. **Visual Kanban UI**: WebviewPanel showing columns with drag-drop support
6. **Code review workflow**: Auto-spawn reviewer when items move to `code-review`

## Coordinator Workflow

When the coordinator receives a user task, it should **always** work through the Kanban board:

```
User Task → Coordinator breaks down → Creates Work Items → Spawns Agents → Assigns to Items
                                              ↓
                                         todo column
                                              ↓
                                    Agent starts working
                                              ↓
                                        doing column
                                              ↓
                                    Agent completes work
                                              ↓
                                      code-review column
                                              ↓
                              Coordinator spawns ReviewerAgent
                                              ↓
                                    Review approved/rejected
                                              ↓
                                    done column (or back to doing)
```

**Key Principle**: The coordinator should never do ad-hoc work. All work flows through the Kanban board, providing:
- Full visibility into what's happening
- Persistent record of all work
- Ability for users to cancel/reprioritize
- Structured code review process

## Folder Structure

```
.clautana/
  workitems/
    todo/           # Queued work items
    doing/          # Work in progress (assigned to agents)
    code-review/    # Awaiting review
    done/           # Completed work
    cancelled/      # Cancelled/abandoned items (archived)
```

## Work Item Format

```markdown
---
id: WI-001
title: "Implement user authentication"
priority: high
assignee: null
reviewer: null
tags: [security, backend]
created: 2026-01-01T10:00:00Z
started: null
completed: null
---

## Description
Add JWT-based authentication to the API endpoints.

## Acceptance Criteria
- [ ] Login endpoint returns JWT token
- [ ] Protected routes require valid token
- [ ] Token refresh mechanism

## Notes
Agent notes and progress updates go here.
```

## Investigations

| Investigation | Status | Verdict |
|--------------|--------|---------|
| [File-Based Kanban](investigations/file-based-kanban.md) | In Progress | Pending |

## Alternative Approaches to Investigate

- **Database-backed**: SQLite storage instead of files
- **VS Code Tasks Integration**: Leverage VS Code's built-in task system
- **GitHub Issues Sync**: Sync with GitHub Issues for distributed teams

## Dependencies

- FileSystemWatcher for real-time updates
- WebviewPanel for Kanban UI
- MCP server for agent access
- OrchestratorAgent for auto-assignment

## Success Criteria

1. Work items persist across extension restarts
2. **Coordinator always creates work items** when receiving user tasks (no ad-hoc work)
3. Coordinator spawns agents and assigns them to work items
4. Agents can move and update their assigned work items
5. Code review agents are automatically spawned when items enter review
6. Kanban UI updates in real-time as agents work
7. Users can cancel/delete items, which stops associated agents
8. Double-clicking a work item opens its `.md` file in VS Code
