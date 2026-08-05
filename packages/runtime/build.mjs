import { build } from "esbuild";

// The Claude SDK resolves and spawns its own platform executable at runtime and
// carries non-JS assets (manifest.json, manifest.zst.json), so it must stay
// external rather than being inlined into the bundle. The SDK package is
// ESM-only ("type": "module", main "sdk.mjs") and ClaudeBackend loads it via a
// dynamic `import()`. esbuild's CJS output preserves a dynamic `import()` of an
// external module verbatim (it does not rewrite it to `require`, since target
// node24 supports dynamic import natively) - this is the standard CJS->ESM
// interop path, and it's what lets a CJS-bundled entrypoint load the ESM-only
// SDK at runtime. Verified by inspecting build/bundle.cjs after a build: the
// `await import("@anthropic-ai/claude-agent-sdk")` line is untouched.
//
// No `require` banner/shim is needed: every other external in this bundle is a
// Node builtin (node:crypto, node:path, ...), and esbuild's CJS output calls
// `require("node:...")` directly. Node provides a real `require` in scope for
// any module executed as CommonJS - including a Node SEA blob, which runs as
// CommonJS by default - so there is nothing to shim. (The brief's proposed
// `banner: { js: "const require = require;" }` would in fact throw a
// ReferenceError: Cannot access 'require' before initialization, a TDZ error
// from a self-referential `const` declaration - it was removed rather than
// fixed, because the shim it was trying to provide isn't needed here.)
await build({
  entryPoints: ["dist/main.js"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  outfile: "build/bundle.cjs",
  external: ["@anthropic-ai/claude-agent-sdk"],
});

console.log("bundled -> packages/runtime/build/bundle.cjs");
