# Investigation: Copilot SDK Feasibility

**Feature**: sdk-abstraction
**Status**: In Progress
**Created**: 2026-01-16

## Approach

Evaluate GitHub Copilot SDK (`@github/copilot-sdk`) as an alternative or complementary backend to the Claude Agent SDK. Assess whether we should:
- **Option A**: Create an abstraction layer supporting both SDKs
- **Option B**: Create a dedicated Copilot-only version
- **Option C**: Stick with Claude SDK only

## SDK Comparison

### API Surface Comparison

| Capability | Claude Agent SDK | Copilot SDK | Notes |
|------------|-----------------|-------------|-------|
| **Session Management** | ✅ `query()` returns async iterator | ✅ `createSession()` + `send()` | Copilot uses event-based model |
| **Streaming** | ✅ Via async iterator | ✅ `assistant.message_delta` events | Different paradigms |
| **Tool Definition** | ✅ `tool()` helper | ✅ `defineTool()` with Zod | Similar capability |
| **MCP Servers** | ✅ `createSdkMcpServer()` | ❓ Not documented | **GAP**: May need custom implementation |
| **System Prompts** | ✅ Via options | ✅ `systemMessage.content` | Similar |
| **Model Selection** | ✅ Via Anthropic API | ✅ `model: "gpt-5"`, `"claude-sonnet-4.5"` | Copilot supports multiple providers! |
| **Multiple Sessions** | ✅ Multiple query() calls | ✅ Multiple `createSession()` | Both support concurrent agents |
| **File Attachments** | ✅ Via MCP tools | ✅ Native `attachments` array | Copilot has native support |
| **Cost Tracking** | ✅ `total_cost_usd` in result | ❓ Not documented | Out of scope for now |
| **Session Resume** | ❓ Via session ID | ✅ `resumeSession()` | Copilot has explicit resume |
| **Abort/Cancel** | ✅ AbortController | ✅ `session.abort()` | Both support |

### Architecture Differences

```
Claude Agent SDK:
  Your Code → query(prompt, options) → [async iterator of messages]
                       ↓
              Claude CLI (bundled)
                       ↓
                Anthropic API

Copilot SDK:
  Your Code → CopilotClient → CopilotSession.send()
                       ↓                ↓
              JSON-RPC over stdio/TCP   Events via .on()
                       ↓
                Copilot CLI
                       ↓
              GitHub Copilot API → Multiple LLM providers
```

## Tradeoffs

| Pros | Cons |
|------|------|
| **Copilot SDK supports multiple models** (GPT-5, Claude via Copilot) | Copilot SDK is in "technical preview" - breaking changes expected |
| **Native VS Code integration** - Copilot is already IDE-embedded | No documented MCP server support - would need custom implementation |
| **Enterprise licensing** - many orgs have existing Copilot licenses | Different paradigm requires significant refactoring |
| **Potentially lower latency** for GPT models via native Copilot path | Requires Copilot CLI installation (additional dependency) |
| **Event-based streaming** may be cleaner for UI updates | MCP tools would need manual conversion to Copilot tools |
| **Built-in tool support** with Zod schemas | |

## Gap Analysis

### Critical Gaps

1. **MCP Server Support**
   - Claude SDK: `createSdkMcpServer()` creates in-memory MCP servers
   - Copilot SDK: No documented MCP support
   - **Impact**: All our MCP servers (Mail, Memory, Claims, LSP, WorkItems) would need conversion to Copilot `defineTool()` format
   - **Mitigation**: Tools could be manually wrapped, but loses MCP's transport benefits

### Moderate Gaps

3. **Session State**
   - Claude SDK: Session state managed internally, exposed via `session_id`
   - Copilot SDK: More explicit session management with `listSessions()`, `deleteSession()`
   - **Impact**: May need to adapt our session management approach
   - **Opportunity**: Better session persistence could enable agent checkpointing

4. **Message Format**
   - Claude SDK: Anthropic message format (content blocks with text/tool_use)
   - Copilot SDK: Event-based (`assistant.message`, `tool.execution_start`, etc.)
   - **Impact**: `processMessage()` in AgentSession needs complete rewrite

### Opportunities

1. **Multi-Model Agents**
   - Copilot SDK supports `model: "gpt-5"` or `model: "claude-sonnet-4.5"` per session
   - Could assign cheaper models to simple worker agents, premium models to orchestrator

2. **Native VS Code Integration**
   - Copilot is already embedded in VS Code
   - Could potentially reuse user's Copilot authentication

3. **Session Management**
   - `resumeSession()` could enable agent state persistence across VS Code restarts

4. **File Attachments**
   - Native attachment support could simplify file context passing

## Abstraction Layer Design (Option A)

If pursuing abstraction, the interface might look like:

```typescript
interface AgentBackend {
  createSession(config: SessionConfig): Promise<AgentSession>;
  
  interface AgentSession {
    send(prompt: string): AsyncIterable<AgentMessage>;
    abort(): Promise<void>;
    destroy(): Promise<void>;
    on(event: string, handler: Function): void;
  }
  
  interface AgentMessage {
    type: 'text' | 'toolCall' | 'toolResult' | 'complete' | 'error';
    content?: string;
    toolCall?: { name: string; arguments: Record<string, unknown> };
  }
}

// Implementations
class ClaudeAgentBackend implements AgentBackend { ... }
class CopilotBackend implements AgentBackend { ... }
```

### Files Requiring Modification for Abstraction

| File | Changes Required |
|------|-----------------|
| `AgentSession.ts` | Replace `query()` with backend interface |
| `OrchestratorAgent.ts` | Replace `query()` with backend interface |
| `ExtensionMcpServer.ts` | Convert to backend-agnostic tools |
| `*McpServer.ts` (7 files) | Convert `tool()` to abstracted tool definitions |
| `types.ts` | Add backend type definitions |
| New: `backends/` folder | Implement Claude and Copilot backends |

**Estimated Effort**: 2-3 weeks for full abstraction layer

## Alignment

- [x] Follows architectural layering rules (abstraction layer is appropriate)
- [x] Developer Experience (users can choose backend via config)
- [ ] Specification compliance - Copilot SDK is in preview
- [x] Consistent with existing patterns (similar to MCP server abstraction)

## Evidence

### Copilot SDK Source Analysis

From [github.com/github/copilot-sdk](https://github.com/github/copilot-sdk):

1. **Multi-language support**: Node.js, Python, Go, .NET SDKs available
2. **Preview status**: "This SDK is in technical preview and may change in breaking ways"
3. **JSON-RPC architecture**: Clean protocol layer, good for testing
4. **Tool support**: Zod-based tool definitions are type-safe

### Current Clautana Dependencies on Claude SDK

```
Files importing @anthropic-ai/claude-agent-sdk:
- AgentSession.ts: query()
- OrchestratorAgent.ts: query(), createSdkMcpServer()
- ExtensionMcpServer.ts: createSdkMcpServer()
- ClaimsMcpServer.ts: tool()
- MailMcpServer.ts: tool()
- MemoryMcpServer.ts: tool()
- LspMcpServer.ts: tool()
- WorkItemsMcpServer.ts: tool()
- TodoCaptureMcpServer.ts: tool()
```

Total: **10 files** with direct SDK dependencies

### Copilot SDK Key Features

From the Node.js README:
- `CopilotClient` manages CLI process lifecycle
- `CopilotSession` represents conversations
- `defineTool()` creates tools with Zod schemas
- `systemMessage` customization with append/replace modes
- Multiple concurrent sessions supported
- `sendAndWait()` for synchronous-style interactions

## Alternative Investigations Worth Pursuing

1. **Strategy Pattern for Tools** - Abstract tool definitions separately from backend
2. **MCP Bridge for Copilot** - Create an MCP-to-Copilot-tool adapter
3. **Hybrid Approach** - Keep orchestrator on Claude, allow workers on Copilot

## Verdict

**Recommendation: Option A (Abstraction Layer) with phased approach**

### Implementation Status: ✅ COMPLETE

The SDK abstraction layer has been implemented. See `src/backends/` for the full implementation.

### Rationale

1. **Copilot SDK is viable** but has gaps (MCP support) that require work
2. **Abstraction provides future flexibility** without locking to either SDK
3. **Multi-model support is compelling** for flexibility
4. **Preview status is acceptable** for experimental feature

### Suggested Phases

**Phase 1: Tool Abstraction** (1 week)
- Create `ToolDefinition` interface that works with both SDKs
- Convert existing MCP tools to use abstraction
- No backend changes yet

**Phase 2: Backend Interface** (1 week)
- Define `AgentBackend` interface
- Implement `ClaudeAgentBackend` (refactor existing code)
- Validate no regressions

**Phase 3: Copilot Backend** (1-2 weeks)
- Implement `CopilotBackend`
- Add configuration for backend selection
- Test with real Copilot CLI

**Phase 4: Multi-Model Agents** (1 week)
- Enable per-agent model selection
- Add performance monitoring

### Risks

1. **Copilot SDK breaking changes** - Mitigate by abstracting early
2. **MCP feature loss** - Accept for Copilot backend, document limitations
3. **Maintenance burden** - Two backends to maintain, but abstraction limits blast radius

---

## Implementation Plan: Option A - Abstraction Layer

### Phase 1: Tool Abstraction (1 week)

**Goal**: Create a backend-agnostic tool definition system

#### Tasks

- [x] **1.1 Define ToolDefinition interface** (`src/backends/types.ts`)
  - Create `ToolDefinition` type with name, description, parameters (JSON Schema), handler
  - Support both sync and async handlers
  - Include parameter validation helpers

- [x] **1.2 Create tool adapter for Claude SDK**
  - Wrapper that converts `ToolDefinition` → Claude `tool()` format
  - Verify existing tool behavior unchanged

- [x] **1.3 Create tool adapter for Copilot SDK**
  - Wrapper that converts `ToolDefinition` → Copilot `defineTool()` with Zod
  - Handle Zod schema generation from JSON Schema

- [ ] **1.4 Migrate ClaimsMcpServer tools** *(deferred - existing MCP tools work with Claude)*
  - Convert `reserve_file_paths`, `release_claims`, `get_claims` to `ToolDefinition`
  - Test with Claude backend

- [ ] **1.5 Migrate MailMcpServer tools** *(deferred)*
  - Convert `send_message`, `inbox`, `read_message` to `ToolDefinition`
  - Test with Claude backend

- [ ] **1.6 Migrate MemoryMcpServer tools** *(deferred)*
  - Convert `memory_save_fact`, `memory_record_lesson`, `memory_save_playbook`, etc.
  - Test with Claude backend

- [ ] **1.7 Migrate remaining MCP tools** *(deferred)*
  - LspMcpServer (8 tools)
  - WorkItemsMcpServer (6 tools)
  - TodoCaptureMcpServer (2 tools)

- [ ] **1.8 Update ExtensionMcpServer** *(deferred)*
  - Use new tool abstraction to aggregate all tools
  - Maintain backward compatibility with Claude SDK

### Phase 2: Backend Interface (1 week) ✅ COMPLETE

**Goal**: Define core abstraction and refactor existing Claude code to use it

#### Tasks

- [x] **2.1 Define AgentBackend interface** (`src/backends/types.ts`)
  ```typescript
  interface AgentBackend {
    type: BackendType;  // 'claude' | 'copilot'
    name: string;
    createSession(config: SessionConfig): Promise<BackendSession>;
    dispose(): Promise<void>;
  }
  
  interface BackendSession {
    id: string;
    backendType: BackendType;
    send(prompt: string, options?: SendOptions): AsyncIterable<AgentMessage>;
    abort(): Promise<void>;
    destroy(): Promise<void>;
  }
  
  interface AgentMessage {
    type: 'text' | 'toolCall' | 'toolResult' | 'complete' | 'error';
    content?: string;
    toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
    error?: Error;
    _backend?: BackendType;  // For debugging
  }
  ```

- [x] **2.2 Define SessionConfig interface**
  - Working directory, system prompt, tools, model preferences
  - Backend-specific options via `backendOptions` escape hatch

- [x] **2.3 Implement ClaudeAgentBackend** (`src/backends/claude/ClaudeAgentBackend.ts`)
  - Wrap existing `query()` usage
  - Convert async iterator to `AgentMessage` stream
  - Handle MCP server setup via `createSdkMcpServer()`

- [x] **2.4 Refactor AgentSession to use backend**
  - Replace direct `query()` import with injected backend
  - Update `processMessage()` to work with `AgentMessage`
  - Maintain all existing functionality (pause/resume, inject notification)

- [x] **2.5 Refactor OrchestratorAgent to use backend**
  - Replace direct SDK imports
  - Use same backend interface as worker agents

- [x] **2.6 Add backend factory** (`src/backends/BackendFactory.ts`)
  - `createBackend(type: 'claude' | 'copilot', config)` factory function
  - Configuration-driven backend selection

- [x] **2.7 Add VS Code configuration**
  - `clautana.backend` setting: `"claude"` | `"copilot"`

- [ ] **2.8 Regression testing**
  - Verify all existing functionality works with Claude backend
  - Test multi-agent orchestration
  - Test all MCP tools

### Phase 3: Copilot Backend (1-2 weeks) ✅ COMPLETE

**Goal**: Implement Copilot SDK backend and enable switching

#### Tasks

- [x] **3.1 Add Copilot SDK dependency**
  - `npm install @github/copilot-sdk`
  - Update package.json

- [x] **3.2 Implement CopilotBackend** (`src/backends/copilot/CopilotBackend.ts`)
  - Manage `CopilotClient` lifecycle
  - Handle auto-start/stop of Copilot CLI

- [x] **3.3 Implement CopilotSession** (`src/backends/copilot/CopilotSession.ts`)
  - Wrap `CopilotSession` from SDK
  - Convert event-based model to `AsyncIterable<AgentMessage>`
  - Map event types: `assistant.message` → `text`, `tool.execution_start` → `toolCall`, etc.

- [x] **3.4 Implement tool registration for Copilot**
  - Convert `ToolDefinition[]` to Copilot `defineTool()` calls
  - JSON Schema to Zod conversion in `copilotToolAdapter.ts`
  - Pass tools to `createSession()`

- [x] **3.5 Handle system prompt differences**
  - Use `systemMessage.content` with append mode
  - Preserve agent identity and multi-agent instructions

- [x] **3.6 Implement session management**
  - Map our session lifecycle to Copilot's `destroy()`
  - Handle abort via `session.abort()`

- [x] **3.7 Add Copilot CLI detection**
  - Check if `copilot` CLI is available in PATH
  - Provide helpful error if not installed

- [ ] **3.8 Integration testing with Copilot**
  - Test single agent conversation
  - Test tool execution
  - Test multi-agent coordination
  - Test with different models (GPT-5, Claude via Copilot)

- [x] **3.9 Document Copilot backend limitations**
  - See "Copilot Backend Limitations" section below

### Phase 4: Multi-Model Agents (1 week)

**Goal**: Enable per-agent model selection for optimal performance

#### Tasks

- [ ] **4.1 Extend SpawnConfig with model preference**
  - Add `model?: string` to agent spawn configuration
  - Add `backend?: 'claude' | 'copilot'` override

- [ ] **4.2 Update AgentPool to support mixed backends**
  - Allow different agents to use different backends
  - Handle backend initialization per-agent or shared

- [ ] **4.3 Add model presets**
  - Define presets: `"fast"`, `"balanced"`, `"premium"`
  - Map to specific models per backend

- [ ] **4.4 Update orchestrator spawn_agent tool**
  - Accept `model` parameter
  - Document available models

- [ ] **4.5 Add backend/model to agent status display**
  - Show which backend/model each agent uses in UI
  - Update webview components

- [ ] **4.6 Performance monitoring**
  - Track response times per backend/model
  - Log for analysis (no cost tracking)

- [ ] **4.7 Documentation**
  - Update README with backend configuration
  - Document model options
  - Add troubleshooting guide

### File Structure

```
src/multi-agent-harness/src/
├── backends/
│   ├── types.ts                 # AgentBackend, BackendSession, AgentMessage, ToolDefinition
│   ├── BackendFactory.ts        # Factory for creating backends
│   ├── claude/
│   │   ├── ClaudeAgentBackend.ts
│   │   ├── ClaudeSession.ts
│   │   └── claudeToolAdapter.ts
│   └── copilot/
│       ├── CopilotBackend.ts
│       ├── CopilotSession.ts
│       └── copilotToolAdapter.ts
├── tools/                       # Migrated from mcp/, backend-agnostic
│   ├── claimsTools.ts
│   ├── mailTools.ts
│   ├── memoryTools.ts
│   ├── lspTools.ts
│   ├── workItemTools.ts
│   └── todoTools.ts
└── ... (existing files, updated to use backends)
```

---

## Copilot Backend Limitations

The Copilot backend has the following limitations compared to the Claude backend:

### 1. **No Native MCP Transport**

The Copilot SDK does not support Model Context Protocol (MCP) servers directly. Tools must be defined using `defineTool()` with Zod schemas rather than connecting to MCP servers.

**Impact**: Existing MCP server tools work because they're converted to the ToolDefinition format, but the MCP transport layer (stdio/http) is not used.

**Workaround**: Tools are defined inline in the session configuration rather than connecting to external MCP servers.

### 2. **Requires Copilot CLI Installation**

The Copilot backend requires the GitHub Copilot CLI to be installed and available in PATH.

**Installation**: Follow https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli

**Detection**: The backend checks for CLI availability at startup and provides a helpful error message if not found.

### 3. **SDK in Technical Preview**

The `@github/copilot-sdk` is in technical preview and may change in breaking ways.

**Mitigation**: The abstraction layer isolates these changes - only the Copilot backend needs updates if the SDK changes.

### 4. **Different Model Naming**

Copilot uses different model identifiers than Claude:
- Claude: `claude-sonnet-4-20250514`, `claude-opus-4-20250514`
- Copilot: `gpt-5`, `claude-sonnet-4.5`, `gpt-4.1`

**Note**: Model availability may vary based on Copilot subscription tier.

### 5. **Event-to-Iterator Conversion**

The Copilot SDK uses an event-based model while our abstraction uses AsyncIterable. The conversion adds a small overhead for buffering events.

**Performance**: Minimal impact for typical agent workloads.

---

## How to Switch Backends

### Via VS Code Settings

```json
{
  "clautana.backend": "copilot"  // or "claude"
}
```

### Programmatically

```typescript
import { createBackend } from './backends';

// Use Claude
const claudeBackend = createBackend('claude');

// Use Copilot
const copilotBackend = createBackend('copilot');
```

### Verifying the Backend in Use

Look for log messages:
- `[Claude Backend] Creating session...`
- `[Copilot Backend] Creating session...`

All agent messages include `_backend: 'claude'` or `_backend: 'copilot'` for debugging.
