# Clautana Project Context

## Project Overview

**Clautana** (Claude + Cortana) is a Tauri desktop application that runs
Claude-backed agents outside any IDE. It previously shipped as a VS Code
extension; that extension is retired as of v0.1.5 in favour of this
standalone app (see [docs/desktop/README.md](docs/desktop/README.md)).

### Core Architecture

Three processes:

*   **Rust shell (`apps/desktop/src-tauri`):** Window, system tray, sidecar
    supervision (spawn, restart with backoff, Job Object-based teardown),
    and a durable diagnostics log. Owns no agent concepts — it routes
    JSON-RPC payloads to and from the sidecar opaquely.
*   **Node sidecar (`packages/runtime`):** All orchestration — agent
    sessions (`AgentSession.ts`), the agent pool (`AgentPool.ts`), project
    config, the durable event log, and the Claude Agent SDK integration
    (`ClaudeBackend.ts`). Runs headless over stdio; the window is optional.
    Packaged as a Node single-executable-application (SEA) binary.
*   **React webview (`apps/desktop/src`):** One client of the sidecar's
    event stream (`runtime-event`, `runtime-ready`, `runtime-status`).

`packages/protocol` holds the shared JSON-RPC and event types consumed by
both the UI and the sidecar.

## Key Directories

*   `apps/desktop/src-tauri/`: The Rust shell (window, tray, sidecar
    supervision).
*   `apps/desktop/src/`: The React webview.
*   `packages/runtime/`: The Node sidecar — agent sessions, agent pool,
    project registry, event log, Claude Agent SDK backend.
*   `packages/protocol/`: Shared JSON-RPC and event types.
*   `docs/`: Project documentation and architectural decision records
    (ADRs); see `docs/desktop/README.md` for the desktop app specifically.
*   `<project>/.clautana/`: Per-project runtime directory for agent state,
    memory, and messages, created by "Open project…" — byte-compatible
    with the retired extension's layout.

## Development & Build

### Prerequisites
*   Node 24+
*   Rust (MSVC toolchain on Windows)
*   Windows 11 (the only supported bundle target)

### Build Commands
Run these from the repo root unless noted:

*   **Install:** `npm install`
*   **Test:** `npm test` (all workspaces)
*   **Build:** `npm run build`
*   **Package the sidecar:** `npm -w @clautana/runtime run package:sea`
*   **Dev (from `apps/desktop/`):** `npm run tauri dev`
*   **Build the installer (from `apps/desktop/`):** `npm run tauri build`

## Conventions

*   **File-Based State:** Each project's `.clautana/` directory is used for
    persistence (config, memory, agents, messages, context, runs). Do not
    rely on in-memory state for long-term data.
*   **Sidecar owns orchestration:** Agent sessions, prompts, and the event
    log all live in `packages/runtime`. The Rust shell and React webview
    are both clients of it, not owners of agent state.
*   **React UI:** The webview is built with React and Vite, communicating
    with the Rust shell via a single `rpc_call` Tauri command and three
    Tauri events.
