# Clautana Desktop

A Tauri desktop application that runs Claude-backed agents outside any IDE.

## Architecture

Three processes:

- **Rust shell** (`apps/desktop/src-tauri`) — window, system tray, sidecar supervision, OS-level process teardown. Owns no agent concepts and routes JSON-RPC payloads opaquely.
- **Node sidecar** (`packages/runtime`) — all orchestration: agent sessions, the agent pool, project config, the event log, and the Claude Agent SDK. Runs headless; the window is optional.
- **React webview** (`apps/desktop/src`) — one client of the sidecar's event stream.

`packages/protocol` holds the shared JSON-RPC and event types consumed by both the UI and the sidecar.

## Prerequisites

- Node 24+
- Rust (MSVC toolchain on Windows)
- Windows 11 (the only supported bundle target)

## Development

```bash
npm install
npm test
npm -w @clautana/runtime run package:sea   # chains bundle → tsc → esbuild → SEA
cd apps/desktop && npm run tauri dev
```

## Building an installer

```bash
npm run build
npm -w @clautana/runtime run package:sea
cd apps/desktop && npm run tauri build
```

This produces `apps/desktop/src-tauri/target/release/bundle/msi/desktop_<version>_x64_en-US.msi`.

### The Claude Agent SDK is staged at build time, not committed

The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) is marked external in the
sidecar's esbuild bundle (it resolves and spawns its own platform executable at
runtime, and carries non-JS assets), so its whole package directory has to ship
alongside the sidecar binary rather than being inlined.

The packaged sidecar resolves its dynamic `import("@anthropic-ai/claude-agent-sdk")`
by walking up from **`process.cwd()`** looking for a `node_modules` directory —
not from its own directory. Staging the SDK merely *beside* the exe is not
sufficient on its own. What makes it resolve:

- `apps/desktop/src-tauri/scripts/stage-sdk.mjs` copies the workspace's
  installed `node_modules/@anthropic-ai/claude-agent-sdk/` into
  `src-tauri/resources/claude-agent-sdk/` before every bundle (wired via
  `tauri.conf.json`'s `build.beforeBundleCommand`).
- `tauri.conf.json`'s `bundle.resources` maps that directory to
  `node_modules/@anthropic-ai/claude-agent-sdk/` under the bundle's resource
  root, which resolves to the same directory as the installed executable on
  Windows.
- Both the Desktop and Start Menu shortcuts WiX generates set
  `WorkingDirectory="INSTALLDIR"`, and the Rust shell spawns the sidecar
  without overriding its working directory — so the sidecar's `process.cwd()`
  at runtime is `INSTALLDIR`, the same directory the staged `node_modules`
  tree lands in.

`src-tauri/resources/` is **generated, not committed** (see `.gitignore`) — it
is fully reproducible from `package-lock.json` via `npm install`, and
committing a second copy of `node_modules` content would let it drift from
the version actually resolved at build time with nothing to catch it.

## Testing

- `npm test` — unit tests across all packages
- `npm -w @clautana/runtime test sidecar.contract` — drives the built sidecar over real stdio; the primary integration test
- `cd apps/desktop/src-tauri && cargo test` — Rust-side sidecar supervision, job object, and tray/window lifecycle tests

## Diagnostics

The Rust shell keeps a durable log of its own supervision events and the
sidecar's stderr at `<app data dir>/clautana-runtime.log` (on Windows,
`%APPDATA%\com.brend.desktop\clautana-runtime.log`). This is what explains a
sidecar failure in a release build, which has no console attached.

## On-disk state

Per project, in `<project>/.clautana/`: `config.json`, `memory/`, `agents/`, `messages/`, `context/`, `runs/`. This layout is byte-compatible with the retired VS Code extension.
