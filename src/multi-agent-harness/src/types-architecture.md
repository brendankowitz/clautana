# Type Architecture Documentation

## Current State

The extension has **two separate type definition files** that serve different purposes:

### 1. `src/types/index.ts`
- **Purpose**: Comprehensive type definitions for the entire extension
- **Based on**: The multi-agent-vscode-extension-spec.md design document
- **Used by**: Providers, MCP servers, and UI components
- **Contains**: ExtensionConfig, AgentState, FileClaim, AgentMessage, WebviewMessages, etc.

### 2. `src/coordinator/types.ts`
- **Purpose**: Runtime types used by the coordinator and agent pool
- **Based on**: Actual SDK integration and runtime needs
- **Used by**: OrchestratorAgent, AgentPool, AgentSession
- **Contains**: SpawnConfig, AgentPoolStatus, OrchestratorMessage, SDK message types

## Why Two Files?

This separation exists because:

1. **Design vs Implementation**: `types/index.ts` represents the ideal design, while `coordinator/types.ts` represents the actual implementation
2. **SDK Integration**: The coordinator types are tightly coupled to the Claude Agent SDK's actual API
3. **Evolution**: The implementation evolved from the spec but didn't consolidate types

## Recommended Future Action

**Option A (Keep Separate - Current Approach)**
- Maintain both files for their specific purposes
- Add cross-references and re-exports where needed
- Document which file to use for new code

**Option B (Consolidate - Future Refactor)**
- Merge both into `src/types/index.ts`
- Remove `src/coordinator/types.ts`
- Update all imports to use the central types file
- Ensure all types align with both spec and SDK reality

## Current Usage Guideline

- **For new UI/Provider code**: Use `src/types/index.ts`
- **For coordinator/agent code**: Use `src/coordinator/types.ts`
- **For shared types**: Check both files and use the appropriate one
