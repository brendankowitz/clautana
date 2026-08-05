# Clautana

> **Note:** Clautana has moved from a VS Code extension to a standalone desktop
> application. The extension is retired at v0.1.5. Everything below describes
> the current desktop app.

<div align="center">

![Clautana Logo](https://raw.githubusercontent.com/brendankowitz/clautana/main/icon.png)

### A tray-resident desktop app for Claude-backed agents

**Clautana** runs Claude-backed agents against a project folder, outside any
IDE. It stays in the system tray, supervises the agent runtime as a
background process, and streams agent output to a window you can open and
close at will.

</div>

---

## Architecture

Clautana is three processes: a Rust shell (window, system tray, and process
supervision), a Node sidecar (agent sessions, project state, and the Claude
Agent SDK integration), and a React webview (a client of the sidecar's event
stream). The Rust shell and webview don't own any agent state themselves —
the sidecar does, so it keeps running (and keeps agents running) whether or
not a window is open.

See [docs/desktop/README.md](docs/desktop/README.md) for the full breakdown.

## Prerequisites

- Windows 11 (the only supported bundle target)
- Node 24+
- Rust (MSVC toolchain)

## Building and running

```bash
npm install
npm test
npm -w @clautana/runtime run package:sea   # builds the sidecar
cd apps/desktop && npm run tauri dev       # run in development
# or:
cd apps/desktop && npm run tauri build     # build an installer (MSI)
```

See [docs/desktop/README.md](docs/desktop/README.md) for prerequisites in
more detail, testing, and how the Claude Agent SDK is staged into the
installer.

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to submit pull requests, report issues, and request features.

## 📄 License

This project is licensed under the [BSD 3-Clause License](LICENSE).
