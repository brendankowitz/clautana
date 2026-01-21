# Feature: SDK Abstraction Layer

**Status**: Discovery
**Created**: 2026-01-16

## Problem Statement

Clautana currently has a hard dependency on the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). This limits:
1. Model flexibility - users are locked to Claude/Anthropic models
3. Enterprise adoption - organizations may have existing GitHub Copilot licenses
4. Resilience - single point of failure if Anthropic services have issues

## Goals

1. Enable Clautana to work with multiple AI backends (Claude, Copilot, potentially others)
2. Maintain feature parity for core multi-agent orchestration
3. Allow per-agent or per-task model selection
4. Preserve existing Claude SDK functionality for users who prefer it

## Current SDK Usage

The codebase uses `@anthropic-ai/claude-agent-sdk` in several key areas:

| File | Usage |
|------|-------|
| `AgentSession.ts` | `query()` function for agent conversations |
| `OrchestratorAgent.ts` | `query()` and `createSdkMcpServer()` for orchestrator |
| `ExtensionMcpServer.ts` | `createSdkMcpServer()` for MCP tool servers |
| `*McpServer.ts` files | `tool()` function for defining MCP tools |

## Investigations

| Investigation | Status | Verdict |
|--------------|--------|---------|
| [Copilot SDK Feasibility](./investigations/copilot-sdk-feasibility.md) | In Progress | Pending |

## Key Decisions

*Pending investigation completion*
