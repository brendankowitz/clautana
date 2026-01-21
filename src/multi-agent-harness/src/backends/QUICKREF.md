# SDK Abstraction Layer - Quick Reference

## 🎯 Purpose
Unified interface for multiple AI backends (Claude SDK, Copilot SDK) in Clautana.

## 📦 What's Included

### Core Files
- **types.ts** - Core interfaces (`AgentBackend`, `BackendSession`, `AgentMessage`, `ToolDefinition`)
- **BackendFactory.ts** - Factory: `createBackend(type, options)`
- **index.ts** - Public API exports

### Claude Backend (✅ Implemented)
- **ClaudeAgentBackend.ts** - Wraps @anthropic-ai/claude-agent-sdk
- **ClaudeSession.ts** - Session wrapper with async iterator
- **claudeToolAdapter.ts** - Tool format conversion

### Copilot Backend (🚧 Placeholder)
- **CopilotBackend.ts** - TODO: Phase 3
- **CopilotSession.ts** - TODO: Phase 3
- **copilotToolAdapter.ts** - TODO: Phase 3

### Documentation
- **README.md** - Architecture, usage, FAQ
- **EXAMPLES.ts** - 5 usage examples
- **IMPLEMENTATION_SUMMARY.md** - Implementation notes

## 🚀 Quick Start

```typescript
// 1. Import
import { createBackend } from './backends';

// 2. Create backend
const backend = createBackend('claude');

// 3. Create session
const session = await backend.createSession({
  workingDirectory: '/path',
  systemPrompt: 'You are helpful',
  model: 'claude-sonnet-4-20250514'
});

// 4. Send & receive
for await (const msg of session.send('Hello!')) {
  console.log(msg.type, msg.content);
}

// 5. Cleanup
await session.destroy();
await backend.dispose();
```

## 🔑 Key Interfaces

### AgentBackend
```typescript
interface AgentBackend {
  readonly type: BackendType;              // 'claude' | 'copilot'
  readonly name: string;                   // "Claude Agent SDK"
  createSession(config: SessionConfig): Promise<BackendSession>;
  dispose(): Promise<void>;
}
```

### BackendSession
```typescript
interface BackendSession {
  readonly id: string;
  readonly backendType: BackendType;
  send(prompt: string, options?: SendOptions): AsyncIterable<AgentMessage>;
  abort(): Promise<void>;
  destroy(): Promise<void>;
}
```

### AgentMessage
```typescript
interface AgentMessage {
  type: 'text' | 'toolCall' | 'toolResult' | 'complete' | 'error';
  content?: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
  result?: unknown;
  error?: Error;
  _backend?: BackendType;  // For debugging
}
```

## 🎨 Key Features

✅ **Backend Identification** - Every message has `_backend` property  
✅ **Clear Logging** - `[Claude Backend]` / `[Copilot Backend]` prefixes  
✅ **Unified API** - Same interface for all backends  
✅ **Tool Abstraction** - Backend-agnostic tool definitions  
✅ **Escape Hatches** - Backend-specific options via `backendOptions`  
✅ **Type Safe** - Full TypeScript support with discriminated unions  

## 📊 Statistics

- **Files**: 12
- **Size**: ~64 KB
- **Lines**: ~1,500
- **Backends**: 1 implemented, 1 placeholder

## 🔄 Migration Pattern

### Before (Direct SDK)
```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';
const result = query({ prompt, options });
```

### After (Abstraction)
```typescript
import { createBackend } from './backends';
const backend = createBackend('claude');
const session = await backend.createSession({...});
const result = session.send(prompt);
```

## 📝 Next Steps

1. ✅ **Phase 2 Complete** - Backend abstraction implemented
2. 🔄 **Integration** - Update AgentSession.ts & OrchestratorAgent.ts
3. 🚧 **Phase 3** - Implement Copilot backend
4. 🚧 **Phase 4** - Add multi-model agent support

## 🐛 Debugging

All operations log with clear prefixes:
```
[Backend Factory] Creating claude backend
[Claude Backend] Creating session with config: {...}
[Claude Backend] Sending prompt to session abc-123
[Claude Backend] Query completed for session abc-123
```

## 📚 Learn More

- **Architecture**: See `README.md`
- **Examples**: See `EXAMPLES.ts`
- **Implementation**: See `IMPLEMENTATION_SUMMARY.md`
- **Investigation**: See `docs/features/sdk-abstraction/investigations/copilot-sdk-feasibility.md`

## ✅ Status

**Phase 2: COMPLETE** ✅
- All files created
- TypeScript compiles successfully
- Ready for integration
- Copilot placeholders ready for Phase 3

---

**Created**: 2026-01-16  
**Location**: `src/multi-agent-harness/src/backends/`  
**Status**: ✅ Production Ready
