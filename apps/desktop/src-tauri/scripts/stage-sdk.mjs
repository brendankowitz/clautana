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
// from its own directory. The installed app's shortcuts (Desktop and Start
// Menu, both WiX-generated) set `WorkingDirectory="INSTALLDIR"`, so the
// sidecar - spawned by Rust without an explicit working directory override,
// and therefore inheriting the shell's actual process cwd - starts with
// cwd = INSTALLDIR = the same directory this node_modules tree lands in.
// That is what makes staging the SDK here sufficient: it is not "next to"
// the exe in name only, it is resolvable from the exe's own runtime cwd.
const here = dirname(fileURLToPath(import.meta.url));
const srcTauriRoot = resolve(here, "..");
const repoRoot = resolve(srcTauriRoot, "../../..");

const source = resolve(repoRoot, "node_modules/@anthropic-ai/claude-agent-sdk");
const dest = resolve(srcTauriRoot, "resources/claude-agent-sdk");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(source, dest, { recursive: true });

console.log(`staged SDK -> ${dest}`);
