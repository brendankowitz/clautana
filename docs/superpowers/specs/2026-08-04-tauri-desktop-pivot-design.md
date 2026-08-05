# Clautana Desktop — Pivot from VS Code Extension to Tauri Application

**Date:** 2026-08-04
**Status:** Approved design
**Scope of this spec:** Slice 1 only — headless core + runtime shell. Later slices are listed for context and will each get their own spec.

---

## 1. Motivation

Clautana today is a VS Code extension (`src/multi-agent-harness`, v0.1.5) that orchestrates a pool of Claude agents inside the IDE. Three limits motivate the pivot:

1. **The IDE host constrains the product.** Automation that runs on a schedule — triage incoming bugs, triage an inbox via MCP — cannot depend on a VS Code window being open.
2. **Single-backend lock-in.** `@github/copilot-sdk` (v1.0.8, TypeScript over JSON-RPC to the Copilot CLI) makes a second agent backend viable, but the current code has no seam for one.
3. **No repeatable runs.** Orchestration is driven by ad-hoc commands; there is no way to define a workflow once and run it again.

The desktop app supersedes the extension. The extension is frozen at 0.1.5 and deleted from the tree once the port lands. There is no shared-core compatibility burden.

## 2. Current-state assessment

51 TypeScript files. 24 import `vscode`.

**Already host-agnostic (ports as-is):**
`coordinator/AgentSession.ts`, `coordinator/types.ts`, `clautana/MemoryManager.ts`, `clautana/interpolation.ts`, `clautana/validation.ts`, `clautana/types.ts`, `kanban/*`, `investigations/*`, and 7 of 11 MCP servers (`ClaimsMcpServer`, `ClaimsTracker`, `ExtensionMcpServer`, `MailMcpServer`, `MemoryMcpServer`, `TodoCaptureMcpServer`, `WorkItemsMcpServer`).

**VS Code-bound (rewritten or dropped):**
All of `providers/` (UI — replaced by the React desktop UI), `extension.ts`, `commands/*`, `workflows/*`, `mcp/LspMcpServer.ts`, and — lightly — `coordinator/AgentPool.ts`, `coordinator/OrchestratorAgent.ts`, `clautana/ConfigManager.ts`, `clautana/HooksManager.ts`, `clautana/AgentProfiles.ts`, `mcp/McpManager.ts`, `mcp/AgentMailClient.ts`.

`mcp/LspMcpServer.ts` is **dropped permanently**, not deferred. It exposed VS Code's language services to agents; outside an IDE there is no equivalent to port. If agents need language intelligence later it will be a new component built on a standalone LSP client, designed on its own merits.

**Relevant existing behaviour to preserve:**
`AgentPool.ts:139` resolves the Claude Agent SDK's own bundled `cli.js` and passes it as `pathToClaudeCodeExecutable`, so no global `claude` install is required.

**Superseded during execution.** That mechanism no longer exists. `@anthropic-ai/claude-agent-sdk` 0.3.x ships no `cli.js`; the package (4.2MB) contains `sdk.mjs`, `bridge.mjs`, `extractFromBunfs.js`, and a `manifest.json` of per-platform prebuilt binaries with checksums. `sdk.d.ts` documents `pathToClaudeCodeExecutable` as *"Uses the built-in executable if not specified."* The desktop app therefore **omits the option entirely** and lets the SDK resolve its own executable. The outcome the extension wanted — no global `claude` install — still holds, by a different route. See §9 for the packaging consequence.

**Dependency debt addressed in slice 1:** `@anthropic-ai/claude-agent-sdk` is pinned `^0.1.0`; current is `0.3.221`. The bump happens in slice 1, in isolation, before anything else depends on it.

## 3. Architecture

Three processes.

```
┌─ Tauri (Rust) ──────────────────────────────┐
│  window · tray · autostart · cron scheduler │
│  OS keychain (secrets) · file dialogs       │
│  supervises + restarts sidecar              │
└───────────┬─────────────────┬───────────────┘
            │ Tauri IPC       │ stdio JSON-RPC (line-delimited)
┌───────────▼──────┐  ┌───────▼──────────────────────────────┐
│ Webview (React)  │  │ Node sidecar — "clautana-runtime"    │
│ Vite, reused     │  │  AgentSession · AgentPool            │
│ from webview-ui  │  │  Orchestrator · Memory · Kanban      │
└──────────────────┘  │  Claims · in-process MCP servers     │
                      │  @anthropic-ai/claude-agent-sdk      │
                      └──────────────────────────────────────┘
```

### 3.1 Rust owns no agent concepts

The Rust layer is a shell: window lifecycle, system tray, autostart, the cron scheduler, OS keychain access, and supervision of the sidecar process. It treats all JSON-RPC payloads as opaque and routes them; it needs no generated types.

This split is what makes tray-resident background runs work. The sidecar is headless by construction — the webview is one more JSON-RPC client that may or may not be attached, never a participant in execution.

**Rationale for the Node sidecar** (vs. a Rust-native rewrite driving the CLIs): both SDKs are TypeScript, and the existing orchestration core, memory model, and seven in-process MCP servers are TypeScript. A Rust rewrite means months of work before parity plus reimplementing the Copilot SDK's JSON-RPC layer. The cost of the sidecar is ~60–90MB of installer and one supervised child process.

### 3.2 Event flow

One direction per channel:

- **Commands:** UI → Rust → sidecar
- **Events:** sidecar → Rust → UI, as a single append-only stream

Every event carries a monotonic `seq`, persisted per run to `<project>/.clautana/runs/<runId>/events.jsonl`. The UI subscribes with its last seen `seq` and receives replay-then-live. One mechanism serves three needs: window reattach, sidecar-crash recovery, and the replayable run log the run inspector needs in slice 4.

This replaces the `EventEmitter` + `postMessage` pattern in `AgentSession` / `WebviewProvider`.

### 3.3 Repository layout

```
apps/desktop/              Tauri app
  src-tauri/               Rust shell
  src/                     React UI (ported from webview-ui)
packages/runtime/          Node sidecar: orchestration core + JSON-RPC server
packages/protocol/         Shared TS types for the JSON-RPC contract
src/multi-agent-harness/   frozen at 0.1.5; deleted once the port lands
```

`packages/protocol` is the single source of truth for the contract, consumed by both the UI and the sidecar so they cannot drift.

## 4. State model

The IDE implicitly supplied "the workspace." The desktop app makes it explicit: a `Project` is a directory the user has added.

| Tier | Location | Contents |
|---|---|---|
| App | Tauri app-data dir (`%APPDATA%/clautana/` on Windows) | project list, window/tray prefs, MCP server registry, schedules, secret *references* |
| Project | `<project>/.clautana/` | unchanged: `config.json`, `memory/`, `agents/`, `messages/`, `context/`, plus new `runs/` |

`.clautana/` stays byte-compatible with the extension's layout. `ConfigManager` and `MemoryManager` port with only their `vscode.workspace.workspaceFolders` lookup replaced by an injected project root, and existing users' project folders keep working.

**Secrets** (API tokens, MCP credentials) never enter either tier. Rust stores them in the OS keychain and passes them to the sidecar as environment variables at spawn time.

## 5. JSON-RPC contract (slice 1)

Deliberately minimal. An oversized contract is the main way this design could go wrong; it grows one slice at a time.

```
→ runtime.ping                            → { protocolVersion, runtimeVersion }
→ project.open      { path }              → { projectId }
→ agent.spawn       { projectId, profile }→ { agentId }
→ agent.prompt      { agentId, text }     → { ok }
→ agent.interrupt   { agentId }           → { ok }
→ agent.kill        { agentId }           → { ok }
→ events.subscribe  { sinceSeq }          → replay + live stream
← event             { seq, type, agentId, payload }
```

Slice-1 event types: `agent.spawned`, `agent.status`, `agent.output`, `agent.toolCall`, `agent.result`, `agent.error`, `run.started`, `run.ended`.

`profile` in `agent.spawn` is the existing agent-profile concept from `clautana/AgentProfiles.ts` (name, role, focus, system prompt, allowed tools), ported to the sidecar and loaded from `<project>/.clautana/agents/`.

## 6. Backend seam

Slice 1 defines one interface and implements it once.

```ts
interface AgentBackend {
  start(config: AgentConfig, signal: AbortSignal): AsyncIterable<BackendEvent>;
  prompt(text: string): Promise<void>;
  readonly capabilities: { mcp: boolean; interrupt: boolean; cost: boolean };
}
```

`ClaudeBackend` wraps the existing `AgentSession` close to verbatim.

`capabilities` exists because the Copilot SDK will not match Claude's surface feature-for-feature; the honest handling is for the UI to ask rather than assume.

`CopilotBackend` is **not** designed now. Slice 6 will reshape this interface once a second real implementation exists. That reshaping is expected, not a failure of this design — designing a two-backend abstraction before either backend runs headless is guesswork.

## 7. Failure modes

The risks here are process-lifecycle, not logic.

**Sidecar dies mid-run.** Rust restarts it with backoff. On restart the sidecar reloads in-flight runs from `events.jsonl` and marks any agent that was mid-turn as `interrupted` rather than resuming — resuming a half-finished tool call is worse than stopping. The UI resubscribes from its last `seq`.

**Orphaned agent processes.** The SDK spawns a native `claude` executable as a child process, so a hard kill of the sidecar can leave Claude processes running and consuming tokens. Rust tracks the sidecar in a Windows Job Object (process group on Unix) so OS-level teardown is guaranteed even on force-quit. Additionally the sidecar records child PIDs to a lockfile and reaps strays on next start.

**Quit with work in flight.** Closing the window hides to tray and does not stop runs. Quitting prompts if any agent is active, and always tears down the job object.

**Protocol drift.** `runtime.ping` returns a protocol version; a mismatch surfaces as a visible error rather than silent misbehaviour. Primarily a development-time safeguard against a stale sidecar bundle.

## 8. Testing

The extension has no test suite. This is net-new, and is a main reason to port rather than lift-and-shift. Putting all logic in the sidecar makes nearly all of it testable without Tauri.

- **Unit (vitest)** — ported core with `AgentBackend` faked. No SDK, no network.
- **Contract** — drive the built sidecar as a subprocess over real stdio JSON-RPC and assert the event stream. This is the primary integration test, needs no window, and is exactly the shape a scheduled headless run takes — so slice 5 inherits the harness.
- **Rust** — thin by design; sidecar supervision/restart and job-object teardown are the only parts worth testing.
- **Manual smoke** — launch → open project → spawn agent → prompt → minimize to tray → reattach → quit. No WebDriver harness in slice 1.

## 9. Packaging

- Sidecar bundled with `esbuild`, then compiled to a single-file executable (Node SEA, or `bun build --compile`), registered via Tauri `bundle.externalBin`.
- `@anthropic-ai/claude-agent-sdk`'s `cli.js` ships as a Tauri resource and is resolved the way `AgentPool.ts:139` does today. No global CLI install required.
- Expected installer size: ~60–90MB.
- **Windows MSI is the only supported target in slice 1.** macOS and Linux bundle targets are configured but unsigned and untested — a known, accepted gap.

## 10. Slice 1 definition of done

The app launches, minimizes to and restores from the system tray, spawns and supervises the sidecar, opens a project folder, and runs one Claude-backed agent to completion with output streaming into a minimal window. Closing and reopening the window loses no output. Force-quitting leaves no orphaned processes.

**Explicitly out of slice 1:** Kanban, workflows, the scheduler UI, the Copilot backend, multi-agent messaging, file claims, external MCP server management, and `LspMcpServer`.

Multi-agent messaging, file claims, and Kanban are already host-agnostic and therefore cheap to move later; they are excluded because they are not needed to prove an agent runs headless, and including them would inflate the slice-1 contract.

## 11. Roadmap

Each slice gets its own spec, plan, and implementation cycle.

| # | Slice | Depends on |
|---|---|---|
| 1 | Headless core + runtime shell (this spec) | — |
| 2 | Desktop UI — agent view, activity stream, Kanban, memory/investigation browsers | 1 |
| 3 | MCP server management — user-configured external servers plus the ported in-process ones | 1 |
| 4 | Workflow authoring + run engine — define, save, run, inspect | 1–3 |
| 5 | Scheduler + automation — cron triggers, background runs, notifications | 4 |
| 6 | Copilot backend — second `AgentBackend` implementation | 1 (reshapes the interface) |

Copilot is intentionally last: slice 1 defines the interface, slice 6 proves it.
