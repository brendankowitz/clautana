import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Regenerates `src-tauri/resources/claude-agent-sdk/` from the workspace's
// installed copy of the SDK before every bundle. Not committed (see
// .gitignore) - it is entirely reproducible from package-lock.json via
// `npm install`, and committing a second copy of node_modules content would
// let the staged copy drift from the version actually resolved at build
// time without anything catching it.
//
// Where this lands matters as much as that it lands: tauri.conf.json's
// `bundle.resources` maps this directory to `node_modules/@anthropic-ai/claude-agent-sdk/`
// under the resource root, which `@tauri-apps/api`'s `resourceDir()` docs
// state resolves to the directory containing the main executable on
// Windows - i.e. the same install directory the sidecar binary itself is
// installed into (both are flat components under WiX's INSTALLDIR, per the
// generated .wxs). The packaged SEA binary resolves its dynamic
// `import("@anthropic-ai/claude-agent-sdk")` by walking up from
// `process.cwd()` looking for a `node_modules` directory (Task 12), not
// from its own directory. `apps/desktop/src-tauri/src/sidecar.rs` spawns the
// sidecar with `current_dir(resource_dir())` explicitly - it does NOT rely on
// the installed shortcuts' `WorkingDirectory="INSTALLDIR"` (that only covers
// launches that go through a WiX-generated shortcut; a Win+R launch by full
// path, a hand-made shortcut, or a copied exe would inherit some other cwd
// instead). Setting `current_dir` in Rust is what makes staging the SDK here
// sufficient regardless of how the app was launched: cwd = resource_dir() =
// the same directory this node_modules tree lands in.
//
// Because that pins the sidecar's cwd to the (often per-machine, read-only)
// install directory, its event log directory is passed separately via the
// `CLAUTANA_RUNS_DIR` environment variable (also set in sidecar.rs, pointed
// at Tauri's app-data directory) rather than left to default from cwd.
const here = dirname(fileURLToPath(import.meta.url));
const srcTauriRoot = resolve(here, "..");
const repoRoot = resolve(srcTauriRoot, "../../..");

const source = resolve(repoRoot, "node_modules/@anthropic-ai/claude-agent-sdk");
const dest = resolve(srcTauriRoot, "resources/claude-agent-sdk");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(source, dest, { recursive: true });

console.log(`staged SDK -> ${dest}`);
