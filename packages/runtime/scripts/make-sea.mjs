import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const require = createRequire(import.meta.url);
const isWindows = process.platform === "win32";
const triple = isWindows ? "x86_64-pc-windows-msvc" : "x86_64-unknown-linux-gnu";
const ext = isWindows ? ".exe" : "";

const outDir = resolve(pkgRoot, "../../apps/desktop/src-tauri/binaries");
const outFile = join(outDir, `clautana-runtime-${triple}${ext}`);

mkdirSync(outDir, { recursive: true });

execFileSync(process.execPath, ["--experimental-sea-config", "sea-config.json"], {
  cwd: pkgRoot,
  stdio: "inherit",
});

// Windows Defender / antivirus can hold a lock on a just-deleted/replaced .exe
// for a moment; removing first (rather than letting copyFileSync overwrite in
// place) avoids postject writing into a file that's still mapped from a
// previous run of the binary.
rmSync(outFile, { force: true });
copyFileSync(process.execPath, outFile);

// postject injects the SEA blob as a resource/section into the copied node
// binary. On Windows this invalidates node.exe's Authenticode signature
// (postject prints "warning: The signature seems corrupted!") - expected and
// harmless for a locally-built dev/CI binary; codesigning the final artifact,
// if ever required, is a packaging concern for Task 16+, not this step.
// Invoke postject's CLI script directly with the current node binary rather
// than shelling out through `npx`. Two problems with npx on Windows ruled it
// out: `shell: true` with an argument array is deprecated (DEP0190, args
// aren't shell-escaped), and calling `npx.cmd` without a shell fails with
// EINVAL (a .cmd is a shell script, not a real executable - Windows can only
// run it through cmd.exe). Resolving the postject CLI's own entry point
// sidesteps both: it's plain JS, run directly by node, argv escaped by
// execFileSync itself, no shell involved.
const postjectCli = require.resolve("postject/dist/cli.js");
execFileSync(
  process.execPath,
  [
    postjectCli,
    outFile,
    "NODE_SEA_BLOB",
    join(pkgRoot, "build", "sea-prep.blob"),
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ],
  { cwd: pkgRoot, stdio: "inherit" },
);

console.log(`sidecar -> ${outFile}`);
