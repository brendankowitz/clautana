# Clautana Desktop — Slice 1: Headless Core + Runtime Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Tauri desktop app that launches, lives in the system tray, supervises a Node sidecar, and runs one Claude-backed agent to completion with output streaming into a window — with no VS Code involved.

**Architecture:** Three processes. A thin Rust shell (window, tray, sidecar supervision, process teardown) owns no agent concepts. A Node sidecar hosts all orchestration logic and the Claude Agent SDK, speaking line-delimited JSON-RPC over stdio. A React webview is just another client of that same event stream, free to detach and reattach.

**Tech Stack:** TypeScript 5.x (strict), Node 24, Tauri 2, Rust, React 18, Vite, vitest, esbuild, Node SEA.

**Spec:** [2026-08-04-tauri-desktop-pivot-design.md](../specs/2026-08-04-tauri-desktop-pivot-design.md)

## Global Constraints

- **Node 24.13.1** is the local version; the sidecar targets Node 24 and uses Node SEA for single-file packaging.
- **Rust/cargo is NOT installed on this machine.** Task 1 installs it. Nothing after Task 6 can build without it.
- Pinned tool versions: `@tauri-apps/cli@2.11.4`, `@tauri-apps/api@2.11.1`, `@tauri-apps/plugin-shell@2.3.5`, `@tauri-apps/plugin-dialog@2.7.2`, `vitest@4.1.10`, `esbuild@0.28.1`.
- `@anthropic-ai/claude-agent-sdk` must be **`^0.3.221`** — never `^0.1.0`.
- TypeScript `strict: true` in every package. No `any` in `packages/protocol`.
- `<project>/.clautana/` on-disk layout stays **byte-compatible** with the extension: `config.json`, `memory/`, `agents/`, `messages/`, `context/`. Slice 1 adds only `runs/`.
- **Windows MSI is the only supported bundle target.** macOS/Linux targets may be configured but are unsigned and untested.
- Every event carries a monotonic `seq`, unique and increasing within a run.
- Rust must not import, parse, or interpret any agent-domain type. It routes opaque JSON.
- `src/multi-agent-harness/` is frozen. Do not modify it until Task 12 deletes it.
- Commit after every task. Conventional-commit prefixes (`feat:`, `test:`, `chore:`, `refactor:`).

## Deferred from the spec

Four items appear in the spec's design but not in this plan, because the slice-1
definition of done (spec §10) does not require them. Each is called out so the
omission is a decision, not an oversight.

| Spec section | Item | Why deferred |
|---|---|---|
| §4 State model | App-tier state — persisted project list, window/tray prefs, MCP registry, schedules | Nothing in slice 1 needs state to survive a restart. The MCP registry serves slice 3 and schedules serve slice 5; both will define their own storage. Slice 1 reopens projects via the folder picker. |
| §4 State model | OS keychain for secrets | Slice 1 spawns no backend that needs a stored credential — the Claude SDK reads the user's existing CLI auth. The keychain lands with MCP server credentials in slice 3. |
| §7 Failure modes | Reloading in-flight runs from `events.jsonl` after a sidecar crash and marking mid-turn agents `interrupted` | The event log and `interrupted` status are both built here (Tasks 3 and 6), so the mechanism exists. Wiring reload-on-restart requires run-registry state that arrives with the run engine in slice 4. Until then a crash restarts the sidecar clean and the UI's `sinceSeq` resubscribe recovers the transcript. |
| §7 Failure modes | Child-PID lockfile reaping, and prompting on quit when agents are active | The Windows Job Object (Task 13) already gives a hard OS-level guarantee that no process outlives the app, which is what the DoD requires. Both of these are belt-and-braces on top of that guarantee, and the quit prompt needs an RPC method the slice-1 contract does not define. |

If any of these should be in slice 1 after all, say so before Task 1 — the first
two would change Task 8, and the last two would change Tasks 13 and 14.

---

## File Structure

```
package.json                          npm workspaces root
packages/protocol/
  src/index.ts                        re-exports
  src/version.ts                      PROTOCOL_VERSION
  src/events.ts                       RuntimeEvent union + payloads
  src/requests.ts                     JSON-RPC request/response types
  test/protocol.test.ts
packages/runtime/
  src/events/EventLog.ts              append-only seq'd log, jsonl-backed
  src/events/EventBus.ts              in-memory fan-out + replay
  src/backend/AgentBackend.ts         backend interface + BackendEvent
  src/backend/FakeBackend.ts          test double
  src/backend/ClaudeBackend.ts        wraps @anthropic-ai/claude-agent-sdk
  src/agent/types.ts                  ported from coordinator/types.ts
  src/agent/AgentSession.ts           ported, backend-injected
  src/agent/AgentPool.ts              ported, host-agnostic
  src/project/ConfigManager.ts        ported, root-injected
  src/project/AgentProfiles.ts        ported, root-injected
  src/project/ProjectRegistry.ts      open projects by id
  src/rpc/JsonRpcServer.ts            stdio framing + dispatch
  src/rpc/handlers.ts                 method implementations
  src/main.ts                         sidecar entrypoint
  test/...                            mirrors src/
apps/desktop/
  src-tauri/src/main.rs               Tauri entry
  src-tauri/src/sidecar.rs            spawn, supervise, restart, teardown
  src-tauri/src/job.rs                Windows Job Object
  src-tauri/src/tray.rs               tray + window lifecycle
  src-tauri/tauri.conf.json
  src/App.tsx                         React UI
  src/rpc.ts                          UI-side RPC client
  src/components/...
```

---

## Task 1: Monorepo scaffold + toolchain

**Files:**
- Create: `package.json`, `.gitignore` (append), `tsconfig.base.json`
- Create: `packages/protocol/package.json`, `packages/protocol/tsconfig.json`

**Interfaces:**
- Consumes: nothing
- Produces: npm workspaces rooted at repo root with `packages/*` and `apps/*`; `tsconfig.base.json` with `strict: true` extended by every package.

- [ ] **Step 1: Install Rust (prerequisite — cargo is not present)**

Download and run rustup from https://rustup.rs (Windows x64 installer `rustup-init.exe`), accepting defaults (MSVC toolchain).

Then verify in a **new** shell:

```bash
rustc --version && cargo --version
```

Expected: both print versions. If `cargo` is still not found, the PATH has not refreshed — open a new terminal.

- [ ] **Step 2: Verify Tauri's Windows prerequisites**

Tauri on Windows needs the WebView2 runtime (preinstalled on Windows 11) and MSVC build tools (installed with rustup's MSVC toolchain).

```bash
rustc --print sysroot
```

Expected: a path containing `msvc`. If it contains `gnu`, run `rustup default stable-x86_64-pc-windows-msvc`.

- [ ] **Step 3: Create the workspace root package.json**

```json
{
  "name": "clautana-monorepo",
  "private": true,
  "version": "0.0.0",
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "engines": {
    "node": ">=24.0.0"
  },
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 4: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 5: Append build outputs to .gitignore**

Append these lines to the existing `.gitignore`:

```
# Desktop pivot
node_modules/
dist/
apps/desktop/src-tauri/target/
apps/desktop/src-tauri/binaries/
packages/runtime/build/
```

- [ ] **Step 6: Create packages/protocol/package.json**

```json
{
  "name": "@clautana/protocol",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  }
}
```

- [ ] **Step 7: Create packages/protocol/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 8: Install and verify the workspace resolves**

```bash
npm install
```

Expected: completes, creates a root `node_modules`, and `node_modules/@clautana/protocol` is a symlink to `packages/protocol`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json .gitignore packages/protocol
git commit -m "chore: scaffold npm workspaces monorepo for desktop pivot"
```

---

## Task 2: Protocol types

**Files:**
- Create: `packages/protocol/src/version.ts`, `packages/protocol/src/events.ts`, `packages/protocol/src/requests.ts`, `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/protocol.test.ts`

**Interfaces:**
- Consumes: Task 1's workspace and tsconfig.
- Produces: `PROTOCOL_VERSION: string`; `AgentStatus`; `RuntimeEvent` (discriminated on `type`, every member has `seq: number`, `runId: string`, `timestamp: string`); `RpcRequest`/`RpcResponse`/`RpcNotification`; `isRuntimeEvent(value: unknown): value is RuntimeEvent`.

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/test/protocol.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PROTOCOL_VERSION,
  isRuntimeEvent,
  type RuntimeEvent,
} from "../src/index.js";

describe("protocol", () => {
  it("exposes a semver protocol version", () => {
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("accepts a well-formed event", () => {
    const event: RuntimeEvent = {
      seq: 1,
      runId: "run-1",
      timestamp: "2026-08-04T00:00:00.000Z",
      type: "agent.output",
      agentId: "agent-1",
      payload: { kind: "text", content: "hello" },
    };
    expect(isRuntimeEvent(event)).toBe(true);
  });

  it("rejects an object missing seq", () => {
    expect(
      isRuntimeEvent({
        runId: "run-1",
        timestamp: "2026-08-04T00:00:00.000Z",
        type: "agent.output",
      }),
    ).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(isRuntimeEvent(null)).toBe(false);
    expect(isRuntimeEvent("agent.output")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm -w @clautana/protocol test
```

Expected: FAIL — cannot resolve `../src/index.js`.

- [ ] **Step 3: Write packages/protocol/src/version.ts**

```ts
/**
 * Bumped whenever the shape of RuntimeEvent or the RPC method set changes.
 * The sidecar reports this from `runtime.ping`; clients refuse to proceed on
 * a major mismatch rather than failing mysteriously later.
 */
export const PROTOCOL_VERSION = "1.0.0";
```

- [ ] **Step 4: Write packages/protocol/src/events.ts**

```ts
export type AgentStatus =
  | "initializing"
  | "idle"
  | "processing"
  | "paused"
  | "error"
  | "waiting"
  | "interrupted"
  | "complete";

export interface ToolCallPayload {
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface OutputPayload {
  kind: "text" | "system" | "stderr";
  content: string;
}

export interface EventBase {
  seq: number;
  runId: string;
  timestamp: string;
}

export interface RunStartedEvent extends EventBase {
  type: "run.started";
  projectId: string;
}

export interface RunEndedEvent extends EventBase {
  type: "run.ended";
  projectId: string;
  reason: "completed" | "aborted" | "error";
}

export interface AgentSpawnedEvent extends EventBase {
  type: "agent.spawned";
  agentId: string;
  name: string;
  profile: string;
}

export interface AgentStatusEvent extends EventBase {
  type: "agent.status";
  agentId: string;
  status: AgentStatus;
}

export interface AgentOutputEvent extends EventBase {
  type: "agent.output";
  agentId: string;
  payload: OutputPayload;
}

export interface AgentToolCallEvent extends EventBase {
  type: "agent.toolCall";
  agentId: string;
  payload: ToolCallPayload;
}

export interface AgentResultEvent extends EventBase {
  type: "agent.result";
  agentId: string;
  costUsd: number;
  tokensUsed: number;
}

export interface AgentErrorEvent extends EventBase {
  type: "agent.error";
  agentId: string;
  message: string;
}

export type RuntimeEvent =
  | RunStartedEvent
  | RunEndedEvent
  | AgentSpawnedEvent
  | AgentStatusEvent
  | AgentOutputEvent
  | AgentToolCallEvent
  | AgentResultEvent
  | AgentErrorEvent;

export const RUNTIME_EVENT_TYPES: readonly RuntimeEvent["type"][] = [
  "run.started",
  "run.ended",
  "agent.spawned",
  "agent.status",
  "agent.output",
  "agent.toolCall",
  "agent.result",
  "agent.error",
];

export function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["seq"] === "number" &&
    typeof candidate["runId"] === "string" &&
    typeof candidate["timestamp"] === "string" &&
    RUNTIME_EVENT_TYPES.includes(candidate["type"] as RuntimeEvent["type"])
  );
}
```

- [ ] **Step 5: Write packages/protocol/src/requests.ts**

```ts
export interface PingResult {
  protocolVersion: string;
  runtimeVersion: string;
}

export interface OpenProjectParams {
  path: string;
}
export interface OpenProjectResult {
  projectId: string;
}

export interface SpawnAgentParams {
  projectId: string;
  profile: string;
}
export interface SpawnAgentResult {
  agentId: string;
  runId: string;
}

export interface PromptAgentParams {
  agentId: string;
  text: string;
}

export interface AgentIdParams {
  agentId: string;
}

export interface SubscribeParams {
  sinceSeq: number;
}

export interface RpcMethods {
  "runtime.ping": { params: Record<string, never>; result: PingResult };
  "project.open": { params: OpenProjectParams; result: OpenProjectResult };
  "agent.spawn": { params: SpawnAgentParams; result: SpawnAgentResult };
  "agent.prompt": { params: PromptAgentParams; result: { ok: true } };
  "agent.interrupt": { params: AgentIdParams; result: { ok: true } };
  "agent.kill": { params: AgentIdParams; result: { ok: true } };
  "events.subscribe": { params: SubscribeParams; result: { ok: true } };
}

export type RpcMethodName = keyof RpcMethods;

export interface RpcRequest<M extends RpcMethodName = RpcMethodName> {
  id: number;
  method: M;
  params: RpcMethods[M]["params"];
}

export interface RpcSuccess<M extends RpcMethodName = RpcMethodName> {
  id: number;
  result: RpcMethods[M]["result"];
}

export interface RpcError {
  id: number;
  error: { code: number; message: string };
}

export type RpcResponse = RpcSuccess | RpcError;

/** Server-pushed event, correlates to no request id. */
export interface RpcNotification {
  method: "event";
  params: import("./events.js").RuntimeEvent;
}

export const RPC_ERROR_METHOD_NOT_FOUND = -32601;
export const RPC_ERROR_INVALID_PARAMS = -32602;
export const RPC_ERROR_INTERNAL = -32603;
```

- [ ] **Step 6: Write packages/protocol/src/index.ts**

```ts
export * from "./version.js";
export * from "./events.js";
export * from "./requests.js";
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
npm -w @clautana/protocol test
```

Expected: PASS, 4 tests.

- [ ] **Step 8: Verify it typechecks and builds**

```bash
npm -w @clautana/protocol run typecheck && npm -w @clautana/protocol run build
```

Expected: no output, exit 0; `packages/protocol/dist/index.d.ts` exists.

- [ ] **Step 9: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): define runtime event and JSON-RPC contract types"
```

---

## Task 3: Event log with monotonic seq and replay

**Files:**
- Create: `packages/runtime/package.json`, `packages/runtime/tsconfig.json`, `packages/runtime/src/events/EventLog.ts`
- Test: `packages/runtime/test/events/EventLog.test.ts`

**Interfaces:**
- Consumes: `RuntimeEvent`, `isRuntimeEvent` from `@clautana/protocol`.
- Produces: `type EventDraft = Omit<RuntimeEvent, "seq" | "runId" | "timestamp">`; `class EventLog` with `static async open(runsDir: string, runId: string): Promise<EventLog>`, `append(draft: EventDraft): Promise<RuntimeEvent>`, `replay(sinceSeq: number): Promise<RuntimeEvent[]>`, `get lastSeq(): number`, `close(): Promise<void>`.

- [ ] **Step 1: Create packages/runtime/package.json**

```json
{
  "name": "@clautana/runtime",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@clautana/protocol": "*",
    "@anthropic-ai/claude-agent-sdk": "^0.3.221",
    "js-yaml": "^4.1.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^24.0.0"
  }
}
```

- [ ] **Step 2: Create packages/runtime/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "lib": ["ES2023"],
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "references": [{ "path": "../protocol" }]
}
```

Then install:

```bash
npm install
```

- [ ] **Step 3: Write the failing test**

Create `packages/runtime/test/events/EventLog.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/events/EventLog.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clautana-eventlog-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("EventLog", () => {
  it("assigns monotonically increasing seq starting at 1", async () => {
    const log = await EventLog.open(dir, "run-1");
    const first = await log.append({ type: "agent.status", agentId: "a", status: "idle" });
    const second = await log.append({ type: "agent.status", agentId: "a", status: "processing" });
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(log.lastSeq).toBe(2);
    await log.close();
  });

  it("stamps runId and an ISO timestamp", async () => {
    const log = await EventLog.open(dir, "run-1");
    const event = await log.append({ type: "agent.status", agentId: "a", status: "idle" });
    expect(event.runId).toBe("run-1");
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    await log.close();
  });

  it("persists one JSON object per line", async () => {
    const log = await EventLog.open(dir, "run-1");
    await log.append({ type: "agent.status", agentId: "a", status: "idle" });
    await log.append({ type: "agent.status", agentId: "a", status: "processing" });
    await log.close();

    const raw = await readFile(join(dir, "run-1", "events.jsonl"), "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).seq).toBe(1);
    expect(JSON.parse(lines[1]!).seq).toBe(2);
  });

  it("replays only events after sinceSeq", async () => {
    const log = await EventLog.open(dir, "run-1");
    await log.append({ type: "agent.status", agentId: "a", status: "idle" });
    await log.append({ type: "agent.status", agentId: "a", status: "processing" });
    await log.append({ type: "agent.status", agentId: "a", status: "complete" });

    const replayed = await log.replay(1);
    expect(replayed.map((e) => e.seq)).toEqual([2, 3]);
    await log.close();
  });

  it("resumes seq from an existing log on reopen", async () => {
    const first = await EventLog.open(dir, "run-1");
    await first.append({ type: "agent.status", agentId: "a", status: "idle" });
    await first.append({ type: "agent.status", agentId: "a", status: "processing" });
    await first.close();

    const reopened = await EventLog.open(dir, "run-1");
    expect(reopened.lastSeq).toBe(2);
    const next = await reopened.append({ type: "agent.status", agentId: "a", status: "complete" });
    expect(next.seq).toBe(3);
    await reopened.close();
  });

  it("skips corrupt trailing lines when resuming", async () => {
    const log = await EventLog.open(dir, "run-1");
    await log.append({ type: "agent.status", agentId: "a", status: "idle" });
    await log.close();

    const { appendFile } = await import("node:fs/promises");
    await appendFile(join(dir, "run-1", "events.jsonl"), '{"seq":2,"broken\n', "utf8");

    const reopened = await EventLog.open(dir, "run-1");
    expect(reopened.lastSeq).toBe(1);
    await reopened.close();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
npm -w @clautana/runtime test
```

Expected: FAIL — cannot resolve `../../src/events/EventLog.js`.

- [ ] **Step 5: Write the implementation**

Create `packages/runtime/src/events/EventLog.ts`:

```ts
import { mkdir, readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { isRuntimeEvent, type RuntimeEvent } from "@clautana/protocol";

/** An event as supplied by callers, before the log stamps identity onto it. */
export type EventDraft = Omit<RuntimeEvent, "seq" | "runId" | "timestamp">;

/**
 * Append-only, crash-tolerant event log for a single run.
 *
 * Writes are serialised through a promise chain so concurrent append() calls
 * cannot interleave partial lines or duplicate a seq.
 */
export class EventLog {
  private _lastSeq: number;
  private _writeQueue: Promise<unknown> = Promise.resolve();
  private _closed = false;

  private constructor(
    private readonly filePath: string,
    private readonly runId: string,
    lastSeq: number,
  ) {
    this._lastSeq = lastSeq;
  }

  static async open(runsDir: string, runId: string): Promise<EventLog> {
    const runDir = join(runsDir, runId);
    await mkdir(runDir, { recursive: true });
    const filePath = join(runDir, "events.jsonl");
    const lastSeq = await EventLog.readLastSeq(filePath);
    return new EventLog(filePath, runId, lastSeq);
  }

  get lastSeq(): number {
    return this._lastSeq;
  }

  async append(draft: EventDraft): Promise<RuntimeEvent> {
    if (this._closed) {
      throw new Error("EventLog is closed");
    }
    const event = {
      ...draft,
      seq: ++this._lastSeq,
      runId: this.runId,
      timestamp: new Date().toISOString(),
    } as RuntimeEvent;

    this._writeQueue = this._writeQueue.then(() =>
      appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8"),
    );
    await this._writeQueue;
    return event;
  }

  async replay(sinceSeq: number): Promise<RuntimeEvent[]> {
    const events = await EventLog.readAll(this.filePath);
    return events.filter((event) => event.seq > sinceSeq);
  }

  async close(): Promise<void> {
    await this._writeQueue;
    this._closed = true;
  }

  private static async readAll(filePath: string): Promise<RuntimeEvent[]> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const events: RuntimeEvent[] = [];
    for (const line of raw.split("\n")) {
      if (line.trim() === "") {
        continue;
      }
      // A crash can truncate the final line. Stop at the first unparseable
      // record rather than discarding the valid history before it.
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        break;
      }
      if (!isRuntimeEvent(parsed)) {
        break;
      }
      events.push(parsed);
    }
    return events;
  }

  private static async readLastSeq(filePath: string): Promise<number> {
    const events = await EventLog.readAll(filePath);
    return events.length === 0 ? 0 : events[events.length - 1]!.seq;
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npm -w @clautana/runtime test
```

Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime package-lock.json
git commit -m "feat(runtime): add append-only event log with seq and replay"
```

---

## Task 4: Event bus (fan-out with replay-then-live)

**Files:**
- Create: `packages/runtime/src/events/EventBus.ts`
- Test: `packages/runtime/test/events/EventBus.test.ts`

**Interfaces:**
- Consumes: `EventLog`, `EventDraft` from Task 3.
- Produces: `class EventBus` with `constructor(log: EventLog)`, `publish(draft: EventDraft): Promise<RuntimeEvent>`, `subscribe(sinceSeq: number, listener: (event: RuntimeEvent) => void): Promise<() => void>` (returns an unsubscribe function; replays history before attaching live).

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/test/events/EventBus.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeEvent } from "@clautana/protocol";
import { EventLog } from "../../src/events/EventLog.js";
import { EventBus } from "../../src/events/EventBus.js";

let dir: string;
let log: EventLog;
let bus: EventBus;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clautana-eventbus-"));
  log = await EventLog.open(dir, "run-1");
  bus = new EventBus(log);
});

afterEach(async () => {
  await log.close();
  await rm(dir, { recursive: true, force: true });
});

describe("EventBus", () => {
  it("delivers live events to a subscriber", async () => {
    const seen: RuntimeEvent[] = [];
    await bus.subscribe(0, (event) => seen.push(event));

    await bus.publish({ type: "agent.status", agentId: "a", status: "idle" });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.type).toBe("agent.status");
  });

  it("replays missed events before live ones, in seq order", async () => {
    await bus.publish({ type: "agent.status", agentId: "a", status: "idle" });
    await bus.publish({ type: "agent.status", agentId: "a", status: "processing" });

    const seen: RuntimeEvent[] = [];
    await bus.subscribe(0, (event) => seen.push(event));

    await bus.publish({ type: "agent.status", agentId: "a", status: "complete" });

    expect(seen.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("honours sinceSeq so a reattaching client skips what it has", async () => {
    await bus.publish({ type: "agent.status", agentId: "a", status: "idle" });
    await bus.publish({ type: "agent.status", agentId: "a", status: "processing" });

    const seen: RuntimeEvent[] = [];
    await bus.subscribe(1, (event) => seen.push(event));

    expect(seen.map((e) => e.seq)).toEqual([2]);
  });

  it("stops delivering after unsubscribe", async () => {
    const seen: RuntimeEvent[] = [];
    const unsubscribe = await bus.subscribe(0, (event) => seen.push(event));

    await bus.publish({ type: "agent.status", agentId: "a", status: "idle" });
    unsubscribe();
    await bus.publish({ type: "agent.status", agentId: "a", status: "processing" });

    expect(seen).toHaveLength(1);
  });

  it("isolates subscribers from each other's failures", async () => {
    const seen: RuntimeEvent[] = [];
    await bus.subscribe(0, () => {
      throw new Error("bad subscriber");
    });
    await bus.subscribe(0, (event) => seen.push(event));

    await bus.publish({ type: "agent.status", agentId: "a", status: "idle" });

    expect(seen).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm -w @clautana/runtime test EventBus
```

Expected: FAIL — cannot resolve `../../src/events/EventBus.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/runtime/src/events/EventBus.ts`:

```ts
import type { RuntimeEvent } from "@clautana/protocol";
import type { EventDraft, EventLog } from "./EventLog.js";

export type EventListener = (event: RuntimeEvent) => void;

/**
 * Fans persisted events out to live subscribers.
 *
 * Subscribing replays history from the log first, then attaches for live
 * delivery. Because publish() awaits the log write before notifying, a
 * subscriber can never observe an event that is not yet durable.
 */
export class EventBus {
  private readonly listeners = new Set<EventListener>();

  constructor(private readonly log: EventLog) {}

  async publish(draft: EventDraft): Promise<RuntimeEvent> {
    const event = await this.log.append(draft);
    for (const listener of this.listeners) {
      this.deliver(listener, event);
    }
    return event;
  }

  async subscribe(sinceSeq: number, listener: EventListener): Promise<() => void> {
    const history = await this.log.replay(sinceSeq);
    for (const event of history) {
      this.deliver(listener, event);
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private deliver(listener: EventListener, event: RuntimeEvent): void {
    // One broken subscriber must not stall the run or starve its peers.
    try {
      listener(event);
    } catch (error) {
      console.error("[EventBus] subscriber threw", error);
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm -w @clautana/runtime test EventBus
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): add event bus with replay-then-live subscription"
```

---

## Task 5: AgentBackend interface + FakeBackend

**Files:**
- Create: `packages/runtime/src/backend/AgentBackend.ts`, `packages/runtime/src/backend/FakeBackend.ts`
- Test: `packages/runtime/test/backend/FakeBackend.test.ts`

**Interfaces:**
- Consumes: `AgentStatus` from `@clautana/protocol`.
- Produces:
  - `interface AgentBackendConfig { name: string; role?: string; focus?: string; workingDirectory: string; systemPrompt?: string; allowedTools?: string[]; mcpServers?: Record<string, unknown>; pathToClaudeCodeExecutable?: string }`
  - `type BackendEvent` — union of `{ kind: "text"; content: string }`, `{ kind: "system"; content: string }`, `{ kind: "stderr"; content: string }`, `{ kind: "toolCall"; toolCallId: string; name: string; arguments: Record<string, unknown> }`, `{ kind: "result"; costUsd: number; tokensUsed: number; sessionId?: string }`
  - `interface BackendCapabilities { mcp: boolean; interrupt: boolean; cost: boolean }`
  - `interface AgentBackend { readonly capabilities: BackendCapabilities; run(prompt: string, signal: AbortSignal): AsyncIterable<BackendEvent>; dispose(): Promise<void> }`
  - `class FakeBackend implements AgentBackend` with `constructor(script: BackendEvent[][], failure?: Error)` — each `run()` call yields the next array in `script`; static factory `FakeBackend.failing(message: string): FakeBackend`; `readonly prompts: string[]` records every prompt received.

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/test/backend/FakeBackend.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FakeBackend } from "../../src/backend/FakeBackend.js";
import type { BackendEvent } from "../../src/backend/AgentBackend.js";

async function drain(iterable: AsyncIterable<BackendEvent>): Promise<BackendEvent[]> {
  const out: BackendEvent[] = [];
  for await (const event of iterable) {
    out.push(event);
  }
  return out;
}

describe("FakeBackend", () => {
  it("yields the scripted events for a run", async () => {
    const backend = new FakeBackend([
      [
        { kind: "text", content: "hello" },
        { kind: "result", costUsd: 0.01, tokensUsed: 42 },
      ],
    ]);

    const events = await drain(backend.run("hi", new AbortController().signal));

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ kind: "text", content: "hello" });
  });

  it("advances through the script across successive runs", async () => {
    const backend = new FakeBackend([
      [{ kind: "text", content: "first" }],
      [{ kind: "text", content: "second" }],
    ]);

    const one = await drain(backend.run("a", new AbortController().signal));
    const two = await drain(backend.run("b", new AbortController().signal));

    expect((one[0] as { content: string }).content).toBe("first");
    expect((two[0] as { content: string }).content).toBe("second");
  });

  it("records the prompts it received", async () => {
    const backend = new FakeBackend([[], []]);
    await drain(backend.run("first prompt", new AbortController().signal));
    await drain(backend.run("second prompt", new AbortController().signal));
    expect(backend.prompts).toEqual(["first prompt", "second prompt"]);
  });

  it("stops yielding once the signal aborts", async () => {
    const backend = new FakeBackend([
      [
        { kind: "text", content: "one" },
        { kind: "text", content: "two" },
      ],
    ]);
    const controller = new AbortController();

    const events: BackendEvent[] = [];
    for await (const event of backend.run("hi", controller.signal)) {
      events.push(event);
      controller.abort();
    }

    expect(events).toHaveLength(1);
  });

  it("throws the configured failure", async () => {
    const backend = FakeBackend.failing("backend exploded");
    await expect(drain(backend.run("hi", new AbortController().signal))).rejects.toThrow(
      "backend exploded",
    );
  });

  it("reports capabilities", () => {
    const backend = new FakeBackend([]);
    expect(backend.capabilities).toEqual({ mcp: true, interrupt: true, cost: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm -w @clautana/runtime test FakeBackend
```

Expected: FAIL — cannot resolve `../../src/backend/FakeBackend.js`.

- [ ] **Step 3: Write packages/runtime/src/backend/AgentBackend.ts**

```ts
export interface AgentBackendConfig {
  name: string;
  role?: string;
  focus?: string;
  workingDirectory: string;
  systemPrompt?: string;
  allowedTools?: string[];
  mcpServers?: Record<string, unknown>;
  pathToClaudeCodeExecutable?: string;
}

export type BackendEvent =
  | { kind: "text"; content: string }
  | { kind: "system"; content: string }
  | { kind: "stderr"; content: string }
  | {
      kind: "toolCall";
      toolCallId: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  | { kind: "result"; costUsd: number; tokensUsed: number; sessionId?: string };

/**
 * What a backend can actually do. Backends differ — the UI asks rather than
 * assuming, so a capability gap degrades visibly instead of failing at runtime.
 */
export interface BackendCapabilities {
  mcp: boolean;
  interrupt: boolean;
  cost: boolean;
}

export interface AgentBackend {
  readonly capabilities: BackendCapabilities;
  run(prompt: string, signal: AbortSignal): AsyncIterable<BackendEvent>;
  dispose(): Promise<void>;
}
```

- [ ] **Step 4: Write packages/runtime/src/backend/FakeBackend.ts**

```ts
import type {
  AgentBackend,
  BackendCapabilities,
  BackendEvent,
} from "./AgentBackend.js";

/** Deterministic backend for tests. Never touches the network or a subprocess. */
export class FakeBackend implements AgentBackend {
  readonly capabilities: BackendCapabilities = { mcp: true, interrupt: true, cost: true };
  readonly prompts: string[] = [];

  private runIndex = 0;

  constructor(
    private readonly script: BackendEvent[][],
    private readonly failure?: Error,
  ) {}

  static failing(message: string): FakeBackend {
    return new FakeBackend([], new Error(message));
  }

  async *run(prompt: string, signal: AbortSignal): AsyncIterable<BackendEvent> {
    this.prompts.push(prompt);

    if (this.failure) {
      throw this.failure;
    }

    const events = this.script[this.runIndex++] ?? [];
    for (const event of events) {
      if (signal.aborted) {
        return;
      }
      yield event;
    }
  }

  async dispose(): Promise<void> {
    // Nothing to release.
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm -w @clautana/runtime test FakeBackend
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): define AgentBackend seam with a fake implementation"
```

---

## Task 6: Port AgentSession onto the backend seam

**Files:**
- Create: `packages/runtime/src/agent/AgentSession.ts`
- Test: `packages/runtime/test/agent/AgentSession.test.ts`
- Reference (read-only): `src/multi-agent-harness/src/coordinator/AgentSession.ts`

**Interfaces:**
- Consumes: `AgentBackend`, `BackendEvent`, `FakeBackend` (Task 5); `EventBus` (Task 4); `AgentStatus` from `@clautana/protocol`.
- Produces: `class AgentSession` with `constructor(options: { agentId: string; name: string; profile: string; backend: AgentBackend; bus: EventBus })`, `sendPrompt(text: string): Promise<void>`, `interrupt(): void`, `kill(): Promise<void>`, `get status(): AgentStatus`, `get costUsd(): number`, `get tokensUsed(): number`.

The port drops the `EventEmitter` base class and the `vscode.OutputChannel`: everything the old class emitted now goes to the `EventBus`. It also drops `pause`/`resume`/`injectNotification`, which existed for the IDE's multi-agent choreography and are not needed until the orchestrator lands.

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/test/agent/AgentSession.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeEvent } from "@clautana/protocol";
import { EventLog } from "../../src/events/EventLog.js";
import { EventBus } from "../../src/events/EventBus.js";
import { FakeBackend } from "../../src/backend/FakeBackend.js";
import { AgentSession } from "../../src/agent/AgentSession.js";

let dir: string;
let log: EventLog;
let bus: EventBus;
let seen: RuntimeEvent[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clautana-session-"));
  log = await EventLog.open(dir, "run-1");
  bus = new EventBus(log);
  seen = [];
  await bus.subscribe(0, (event) => seen.push(event));
});

afterEach(async () => {
  await log.close();
  await rm(dir, { recursive: true, force: true });
});

function makeSession(backend: FakeBackend): AgentSession {
  return new AgentSession({
    agentId: "agent-1",
    name: "Coder",
    profile: "coder",
    backend,
    bus,
  });
}

describe("AgentSession", () => {
  it("starts idle", () => {
    const session = makeSession(new FakeBackend([]));
    expect(session.status).toBe("idle");
  });

  it("publishes status transitions around a prompt", async () => {
    const session = makeSession(new FakeBackend([[{ kind: "text", content: "hi" }]]));
    await session.sendPrompt("hello");

    const statuses = seen
      .filter((e) => e.type === "agent.status")
      .map((e) => (e as { status: string }).status);
    expect(statuses).toEqual(["processing", "idle"]);
  });

  it("publishes text output as an agent.output event", async () => {
    const session = makeSession(new FakeBackend([[{ kind: "text", content: "hi there" }]]));
    await session.sendPrompt("hello");

    const output = seen.find((e) => e.type === "agent.output");
    expect(output).toBeDefined();
    expect((output as { payload: { content: string } }).payload.content).toBe("hi there");
  });

  it("publishes tool calls", async () => {
    const backend = new FakeBackend([
      [{ kind: "toolCall", toolCallId: "t1", name: "Read", arguments: { path: "a.ts" } }],
    ]);
    const session = makeSession(backend);
    await session.sendPrompt("read it");

    const toolCall = seen.find((e) => e.type === "agent.toolCall");
    expect((toolCall as { payload: { name: string } }).payload.name).toBe("Read");
  });

  it("accumulates cost and tokens across runs", async () => {
    const backend = new FakeBackend([
      [{ kind: "result", costUsd: 0.01, tokensUsed: 10 }],
      [{ kind: "result", costUsd: 0.02, tokensUsed: 5 }],
    ]);
    const session = makeSession(backend);

    await session.sendPrompt("one");
    await session.sendPrompt("two");

    expect(session.costUsd).toBeCloseTo(0.03);
    expect(session.tokensUsed).toBe(15);
  });

  it("publishes agent.error and goes to error status when the backend throws", async () => {
    const session = makeSession(FakeBackend.failing("boom"));
    await session.sendPrompt("hello");

    const error = seen.find((e) => e.type === "agent.error");
    expect((error as { message: string }).message).toContain("boom");
    expect(session.status).toBe("error");
  });

  it("rejects a concurrent prompt while processing", async () => {
    const backend = new FakeBackend([[{ kind: "text", content: "slow" }]]);
    const session = makeSession(backend);

    const first = session.sendPrompt("one");
    await expect(session.sendPrompt("two")).rejects.toThrow(/already processing/i);
    await first;
  });

  it("interrupt() moves the session to interrupted", async () => {
    const backend = new FakeBackend([
      [
        { kind: "text", content: "one" },
        { kind: "text", content: "two" },
      ],
    ]);
    const session = makeSession(backend);

    const running = session.sendPrompt("go");
    session.interrupt();
    await running;

    expect(session.status).toBe("interrupted");
  });

  it("kill() disposes the backend", async () => {
    let disposed = false;
    const backend = new FakeBackend([]);
    backend.dispose = async () => {
      disposed = true;
    };
    const session = makeSession(backend);

    await session.kill();

    expect(disposed).toBe(true);
    expect(session.status).toBe("complete");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm -w @clautana/runtime test AgentSession
```

Expected: FAIL — cannot resolve `../../src/agent/AgentSession.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/runtime/src/agent/AgentSession.ts`:

```ts
import type { AgentStatus } from "@clautana/protocol";
import type { AgentBackend } from "../backend/AgentBackend.js";
import type { EventBus } from "../events/EventBus.js";

export interface AgentSessionOptions {
  agentId: string;
  name: string;
  profile: string;
  backend: AgentBackend;
  bus: EventBus;
}

/**
 * Drives one agent's conversation against a backend, projecting everything it
 * observes onto the event bus. Holds no transport and no UI concerns, so it is
 * identical whether a window is attached or the run is scheduled and headless.
 */
export class AgentSession {
  private _status: AgentStatus = "idle";
  private _costUsd = 0;
  private _tokensUsed = 0;
  private _controller?: AbortController;

  constructor(private readonly options: AgentSessionOptions) {}

  get status(): AgentStatus {
    return this._status;
  }

  get costUsd(): number {
    return this._costUsd;
  }

  get tokensUsed(): number {
    return this._tokensUsed;
  }

  async sendPrompt(text: string): Promise<void> {
    if (this._status === "processing") {
      throw new Error(`Agent ${this.options.name} is already processing a prompt`);
    }

    const controller = new AbortController();
    this._controller = controller;
    await this.setStatus("processing");

    try {
      for await (const event of this.options.backend.run(text, controller.signal)) {
        switch (event.kind) {
          case "text":
          case "system":
          case "stderr":
            await this.publish({
              type: "agent.output",
              agentId: this.options.agentId,
              payload: { kind: event.kind, content: event.content },
            });
            break;
          case "toolCall":
            await this.publish({
              type: "agent.toolCall",
              agentId: this.options.agentId,
              payload: {
                toolCallId: event.toolCallId,
                name: event.name,
                arguments: event.arguments,
              },
            });
            break;
          case "result":
            this._costUsd += event.costUsd;
            this._tokensUsed += event.tokensUsed;
            await this.publish({
              type: "agent.result",
              agentId: this.options.agentId,
              costUsd: event.costUsd,
              tokensUsed: event.tokensUsed,
            });
            break;
        }
      }

      // An aborted turn is reported as interrupted, never silently resumed:
      // a half-finished tool call must not look like a completed one.
      await this.setStatus(controller.signal.aborted ? "interrupted" : "idle");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.publish({
        type: "agent.error",
        agentId: this.options.agentId,
        message,
      });
      await this.setStatus("error");
    } finally {
      this._controller = undefined;
    }
  }

  interrupt(): void {
    this._controller?.abort();
  }

  async kill(): Promise<void> {
    this._controller?.abort();
    await this.options.backend.dispose();
    await this.setStatus("complete");
  }

  private async setStatus(status: AgentStatus): Promise<void> {
    this._status = status;
    await this.publish({
      type: "agent.status",
      agentId: this.options.agentId,
      status,
    });
  }

  private async publish(
    draft: Parameters<EventBus["publish"]>[0],
  ): Promise<void> {
    await this.options.bus.publish(draft);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm -w @clautana/runtime test AgentSession
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): port AgentSession onto the backend seam and event bus"
```

---

## Task 7: ClaudeBackend

**Files:**
- Create: `packages/runtime/src/backend/mapSdkMessage.ts`, `packages/runtime/src/backend/ClaudeBackend.ts`
- Test: `packages/runtime/test/backend/mapSdkMessage.test.ts`

**Interfaces:**
- Consumes: `AgentBackend`, `AgentBackendConfig`, `BackendEvent`, `BackendCapabilities` (Task 5).
- Produces: `interface SdkMessage` (a structural subset of what the SDK yields); `function mapSdkMessage(message: SdkMessage): BackendEvent[]` — pure, total, returns `[]` for message types we ignore; `class ClaudeBackend implements AgentBackend` with `constructor(config: AgentBackendConfig)`.

> **Plan revision (discovered during execution).** The original Task 7 built a
> `resolveClaudeCli()` helper to point the SDK at its own bundled `cli.js`,
> carrying forward what `AgentPool.ts:139` did in the extension. **That file does
> not exist in `@anthropic-ai/claude-agent-sdk` 0.3.x.** The package now ships
> `sdk.mjs`, `bridge.mjs`, `extractFromBunfs.js`, and a `manifest.json` listing
> per-platform prebuilt `claude` binaries; `sdk.d.ts` documents
> `pathToClaudeCodeExecutable` as *"Path to the Claude Code executable. Uses the
> built-in executable if not specified."*
>
> The correct integration is therefore to **omit `pathToClaudeCodeExecutable`
> entirely** and let the SDK resolve its own executable. `resolveClaudeCli` is
> deleted, not ported. An env-var escape hatch is kept for the rare case of
> pointing at a specific build.
>
> This removes the task's only pure unit under test, so the seam moves to
> `mapSdkMessage` — a total function from SDK message to `BackendEvent[]`. That
> is the part with real branching logic and the part most likely to break on an
> SDK upgrade, so it is the better test target regardless.

`ClaudeBackend` itself is exercised by the stdio contract test in Task 11, not by unit tests — it is a thin adapter around a network-bound SDK.

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/test/backend/mapSdkMessage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapSdkMessage } from "../../src/backend/mapSdkMessage.js";

describe("mapSdkMessage", () => {
  it("maps an assistant text block to a text event", () => {
    const events = mapSdkMessage({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello" }] },
    });
    expect(events).toEqual([{ kind: "text", content: "hello" }]);
  });

  it("maps a tool_use block to a toolCall event", () => {
    const events = mapSdkMessage({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "t1", name: "Read", input: { path: "a.ts" } }],
      },
    });
    expect(events).toEqual([
      { kind: "toolCall", toolCallId: "t1", name: "Read", arguments: { path: "a.ts" } },
    ]);
  });

  it("maps every block in a multi-block message, in order", () => {
    const events = mapSdkMessage({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "first" },
          { type: "tool_use", id: "t1", name: "Read", input: {} },
          { type: "text", text: "second" },
        ],
      },
    });
    expect(events.map((e) => e.kind)).toEqual(["text", "toolCall", "text"]);
  });

  it("maps a result message to a result event", () => {
    const events = mapSdkMessage({
      type: "result",
      total_cost_usd: 0.0125,
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    expect(events).toEqual([{ kind: "result", costUsd: 0.0125, tokensUsed: 150 }]);
  });

  it("defaults missing cost and usage to zero", () => {
    const events = mapSdkMessage({ type: "result" });
    expect(events).toEqual([{ kind: "result", costUsd: 0, tokensUsed: 0 }]);
  });

  it("returns no events for message types we do not surface", () => {
    expect(mapSdkMessage({ type: "system" })).toEqual([]);
    expect(mapSdkMessage({ type: "user" })).toEqual([]);
  });

  it("skips an assistant message with no content", () => {
    expect(mapSdkMessage({ type: "assistant" })).toEqual([]);
    expect(mapSdkMessage({ type: "assistant", message: {} })).toEqual([]);
  });

  it("skips content blocks of unknown type without throwing", () => {
    const events = mapSdkMessage({
      type: "assistant",
      message: { content: [{ type: "thinking" }, { type: "text", text: "kept" }] },
    });
    expect(events).toEqual([{ kind: "text", content: "kept" }]);
  });

  it("skips a text block with no text and a tool_use with no name", () => {
    const events = mapSdkMessage({
      type: "assistant",
      message: { content: [{ type: "text" }, { type: "tool_use", id: "t1" }] },
    });
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm -w @clautana/runtime test mapSdkMessage
```

Expected: FAIL — cannot resolve `../../src/backend/mapSdkMessage.js`.

- [ ] **Step 3: Write packages/runtime/src/backend/mapSdkMessage.ts**

```ts
import type { BackendEvent } from "./AgentBackend.js";

export interface SdkContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/** Structural subset of the SDK's message stream that this backend consumes. */
export interface SdkMessage {
  type: string;
  message?: { content?: SdkContentBlock[] };
  session_id?: string;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Total mapping from one SDK message to zero or more backend events.
 *
 * Unknown message types and unknown content blocks yield nothing rather than
 * throwing: the SDK adds block types over time, and an unrecognised one must
 * not abort a run in progress.
 */
export function mapSdkMessage(message: SdkMessage): BackendEvent[] {
  if (message.type === "assistant") {
    const events: BackendEvent[] = [];
    for (const block of message.message?.content ?? []) {
      if (block.type === "text" && block.text !== undefined) {
        events.push({ kind: "text", content: block.text });
      } else if (block.type === "tool_use" && block.name !== undefined) {
        events.push({
          kind: "toolCall",
          toolCallId: block.id ?? "",
          name: block.name,
          arguments: block.input ?? {},
        });
      }
    }
    return events;
  }

  if (message.type === "result") {
    const usage = message.usage ?? {};
    return [
      {
        kind: "result",
        costUsd: message.total_cost_usd ?? 0,
        tokensUsed: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      },
    ];
  }

  return [];
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm -w @clautana/runtime test mapSdkMessage
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Write packages/runtime/src/backend/ClaudeBackend.ts**

```ts
import type {
  AgentBackend,
  AgentBackendConfig,
  BackendCapabilities,
  BackendEvent,
} from "./AgentBackend.js";
import { mapSdkMessage, type SdkMessage } from "./mapSdkMessage.js";

export class ClaudeBackend implements AgentBackend {
  readonly capabilities: BackendCapabilities = { mcp: true, interrupt: true, cost: true };

  private sessionId?: string;

  constructor(private readonly config: AgentBackendConfig) {}

  async *run(prompt: string, signal: AbortSignal): AsyncIterable<BackendEvent> {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");

    const controller = new AbortController();
    signal.addEventListener("abort", () => controller.abort(), { once: true });

    const stderrChunks: string[] = [];

    // pathToClaudeCodeExecutable is deliberately omitted: SDK 0.3.x resolves its
    // own built-in executable. Set CLAUTANA_CLAUDE_EXECUTABLE only to override.
    const override = process.env["CLAUTANA_CLAUDE_EXECUTABLE"];

    const result = query({
      prompt,
      options: {
        cwd: this.config.workingDirectory,
        allowedTools: this.config.allowedTools ?? [],
        mcpServers: (this.config.mcpServers ?? {}) as Record<string, never>,
        settingSources: ["user", "project", "local"],
        permissionMode: "acceptEdits",
        systemPrompt: this.config.systemPrompt,
        abortController: controller,
        resume: this.sessionId,
        ...(override ? { pathToClaudeCodeExecutable: override } : {}),
        stderr: (data: string) => stderrChunks.push(data),
      },
    });

    for await (const raw of result) {
      const message = raw as SdkMessage;
      if (message.session_id) {
        this.sessionId = message.session_id;
      }
      for (const event of mapSdkMessage(message)) {
        yield event;
      }
    }

    // Surfaced after the stream so stderr noise cannot interleave with output.
    for (const chunk of stderrChunks) {
      yield { kind: "stderr", content: chunk };
    }
  }

  async dispose(): Promise<void> {
    this.sessionId = undefined;
  }
}
```

- [ ] **Step 6: Verify the whole runtime package typechecks and all tests pass**

```bash
npm -w @clautana/runtime run typecheck && npm -w @clautana/runtime test
```

Expected: typecheck clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): add ClaudeBackend on claude-agent-sdk 0.3"
```

---


## Task 8: Project registry and config

**Files:**
- Create: `packages/runtime/src/project/ConfigManager.ts`, `packages/runtime/src/project/AgentProfiles.ts`, `packages/runtime/src/project/ProjectRegistry.ts`
- Test: `packages/runtime/test/project/ProjectRegistry.test.ts`
- Reference (read-only): `src/multi-agent-harness/src/clautana/ConfigManager.ts`, `src/multi-agent-harness/src/clautana/AgentProfiles.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface AgentProfile { name: string; role: string; focus: string; systemPrompt?: string; allowedTools?: string[] }`
  - `class ConfigManager` with `constructor(projectRoot: string)`, `async initialize(): Promise<void>` (creates `.clautana/{memory,agents,messages,context,runs}`), `get clautanaDir(): string`, `get runsDir(): string`, `async loadProfiles(): Promise<Map<string, AgentProfile>>`
  - `class ProjectRegistry` with `async open(path: string): Promise<{ projectId: string; config: ConfigManager }>`, `get(projectId: string): ConfigManager | undefined`

The port replaces `vscode.workspace.workspaceFolders` with the injected `projectRoot` and keeps every path identical to the extension's.

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/test/project/ProjectRegistry.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectRegistry } from "../../src/project/ProjectRegistry.js";

let root: string;
let registry: ProjectRegistry;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "clautana-project-"));
  registry = new ProjectRegistry();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("ProjectRegistry", () => {
  it("creates the .clautana layout on open", async () => {
    await registry.open(root);

    for (const sub of ["memory", "agents", "messages", "context", "runs"]) {
      const info = await stat(join(root, ".clautana", sub));
      expect(info.isDirectory()).toBe(true);
    }
  });

  it("returns a stable projectId for the same path", async () => {
    const first = await registry.open(root);
    const second = await registry.open(root);
    expect(second.projectId).toBe(first.projectId);
  });

  it("returns different ids for different paths", async () => {
    const other = await mkdtemp(join(tmpdir(), "clautana-project-b-"));
    const a = await registry.open(root);
    const b = await registry.open(other);
    expect(a.projectId).not.toBe(b.projectId);
    await rm(other, { recursive: true, force: true });
  });

  it("resolves an opened project by id", async () => {
    const { projectId } = await registry.open(root);
    expect(registry.get(projectId)).toBeDefined();
  });

  it("returns undefined for an unknown id", () => {
    expect(registry.get("nope")).toBeUndefined();
  });

  it("rejects a path that is not a directory", async () => {
    const file = join(root, "a-file.txt");
    await writeFile(file, "x", "utf8");
    await expect(registry.open(file)).rejects.toThrow(/not a directory/i);
  });

  it("loads agent profiles from .clautana/agents", async () => {
    const agentsDir = join(root, ".clautana", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, "coder.json"),
      JSON.stringify({ name: "Coder", role: "engineer", focus: "implementation" }),
      "utf8",
    );

    const { config } = await registry.open(root);
    const profiles = await config.loadProfiles();

    expect(profiles.get("coder")?.name).toBe("Coder");
  });

  it("returns a default profile set when the agents dir is empty", async () => {
    const { config } = await registry.open(root);
    const profiles = await config.loadProfiles();
    expect(profiles.has("default")).toBe(true);
  });

  it("ignores malformed profile files rather than failing the open", async () => {
    const agentsDir = join(root, ".clautana", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, "broken.json"), "{ not json", "utf8");

    const { config } = await registry.open(root);
    const profiles = await config.loadProfiles();

    expect(profiles.has("broken")).toBe(false);
    expect(profiles.has("default")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm -w @clautana/runtime test ProjectRegistry
```

Expected: FAIL — cannot resolve `../../src/project/ProjectRegistry.js`.

- [ ] **Step 3: Write packages/runtime/src/project/AgentProfiles.ts**

```ts
export interface AgentProfile {
  name: string;
  role: string;
  focus: string;
  systemPrompt?: string;
  allowedTools?: string[];
}

export const DEFAULT_PROFILE: AgentProfile = {
  name: "Assistant",
  role: "general",
  focus: "general-purpose assistance",
};

export function parseAgentProfile(value: unknown): AgentProfile | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate["name"] !== "string") {
    return undefined;
  }
  return {
    name: candidate["name"],
    role: typeof candidate["role"] === "string" ? candidate["role"] : "general",
    focus: typeof candidate["focus"] === "string" ? candidate["focus"] : "",
    systemPrompt:
      typeof candidate["systemPrompt"] === "string" ? candidate["systemPrompt"] : undefined,
    allowedTools: Array.isArray(candidate["allowedTools"])
      ? candidate["allowedTools"].filter((t): t is string => typeof t === "string")
      : undefined,
  };
}
```

- [ ] **Step 4: Write packages/runtime/src/project/ConfigManager.ts**

```ts
import { mkdir, readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
  DEFAULT_PROFILE,
  parseAgentProfile,
  type AgentProfile,
} from "./AgentProfiles.js";

const CLAUTANA_DIR = ".clautana";
const SUBDIRS = ["memory", "agents", "messages", "context", "runs"] as const;

/**
 * Owns the on-disk `.clautana/` layout for one project. The layout is
 * byte-compatible with the VS Code extension's, so existing project folders
 * keep working after the pivot.
 */
export class ConfigManager {
  constructor(readonly projectRoot: string) {}

  get clautanaDir(): string {
    return join(this.projectRoot, CLAUTANA_DIR);
  }

  get runsDir(): string {
    return join(this.clautanaDir, "runs");
  }

  get agentsDir(): string {
    return join(this.clautanaDir, "agents");
  }

  async initialize(): Promise<void> {
    for (const sub of SUBDIRS) {
      await mkdir(join(this.clautanaDir, sub), { recursive: true });
    }
  }

  async loadProfiles(): Promise<Map<string, AgentProfile>> {
    const profiles = new Map<string, AgentProfile>();

    let entries: string[];
    try {
      entries = await readdir(this.agentsDir);
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (extname(entry) !== ".json") {
        continue;
      }
      // A single malformed profile must not prevent the project opening.
      try {
        const raw = await readFile(join(this.agentsDir, entry), "utf8");
        const profile = parseAgentProfile(JSON.parse(raw));
        if (profile) {
          profiles.set(basename(entry, ".json"), profile);
        }
      } catch {
        continue;
      }
    }

    if (!profiles.has("default")) {
      profiles.set("default", DEFAULT_PROFILE);
    }
    return profiles;
  }
}
```

- [ ] **Step 5: Write packages/runtime/src/project/ProjectRegistry.ts**

```ts
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { ConfigManager } from "./ConfigManager.js";

export interface OpenedProject {
  projectId: string;
  config: ConfigManager;
}

/** Tracks the projects the runtime currently has open. */
export class ProjectRegistry {
  private readonly projects = new Map<string, ConfigManager>();

  async open(path: string): Promise<OpenedProject> {
    const root = resolve(path);

    const info = await stat(root).catch(() => undefined);
    if (!info) {
      throw new Error(`Project path does not exist: ${root}`);
    }
    if (!info.isDirectory()) {
      throw new Error(`Project path is not a directory: ${root}`);
    }

    // Path-derived so reopening the same folder yields the same id across restarts.
    const projectId = createHash("sha256").update(root).digest("hex").slice(0, 16);

    const existing = this.projects.get(projectId);
    if (existing) {
      return { projectId, config: existing };
    }

    const config = new ConfigManager(root);
    await config.initialize();
    this.projects.set(projectId, config);
    return { projectId, config };
  }

  get(projectId: string): ConfigManager | undefined {
    return this.projects.get(projectId);
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npm -w @clautana/runtime test ProjectRegistry
```

Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): add project registry and .clautana config layout"
```

---

## Task 9: AgentPool

**Files:**
- Create: `packages/runtime/src/agent/AgentPool.ts`
- Test: `packages/runtime/test/agent/AgentPool.test.ts`

**Interfaces:**
- Consumes: `AgentSession` (Task 6), `AgentBackend` (Task 5), `EventBus` (Task 4), `ConfigManager` (Task 8).
- Produces: `type BackendFactory = (config: AgentBackendConfig) => AgentBackend`; `class AgentPool` with `constructor(options: { bus: EventBus; backendFactory: BackendFactory })`, `async spawn(params: { projectId: string; config: ConfigManager; profile: string }): Promise<string>` returning `agentId`, `get(agentId: string): AgentSession | undefined`, `async killAll(): Promise<void>`, `get activeCount(): number`.

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/test/agent/AgentPool.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeEvent } from "@clautana/protocol";
import { EventLog } from "../../src/events/EventLog.js";
import { EventBus } from "../../src/events/EventBus.js";
import { FakeBackend } from "../../src/backend/FakeBackend.js";
import { ConfigManager } from "../../src/project/ConfigManager.js";
import { AgentPool } from "../../src/agent/AgentPool.js";

let dir: string;
let log: EventLog;
let bus: EventBus;
let config: ConfigManager;
let seen: RuntimeEvent[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clautana-pool-"));
  log = await EventLog.open(dir, "run-1");
  bus = new EventBus(log);
  config = new ConfigManager(dir);
  await config.initialize();
  seen = [];
  await bus.subscribe(0, (event) => seen.push(event));
});

afterEach(async () => {
  await log.close();
  await rm(dir, { recursive: true, force: true });
});

function makePool(): AgentPool {
  return new AgentPool({ bus, backendFactory: () => new FakeBackend([]) });
}

describe("AgentPool", () => {
  it("spawns an agent and returns its id", async () => {
    const pool = makePool();
    const agentId = await pool.spawn({ projectId: "p1", config, profile: "default" });
    expect(agentId).toMatch(/\S/);
    expect(pool.get(agentId)).toBeDefined();
  });

  it("publishes agent.spawned", async () => {
    const pool = makePool();
    await pool.spawn({ projectId: "p1", config, profile: "default" });

    const spawned = seen.find((e) => e.type === "agent.spawned");
    expect(spawned).toBeDefined();
    expect((spawned as { profile: string }).profile).toBe("default");
  });

  it("gives each agent a distinct id", async () => {
    const pool = makePool();
    const a = await pool.spawn({ projectId: "p1", config, profile: "default" });
    const b = await pool.spawn({ projectId: "p1", config, profile: "default" });
    expect(a).not.toBe(b);
    expect(pool.activeCount).toBe(2);
  });

  it("rejects an unknown profile", async () => {
    const pool = makePool();
    await expect(
      pool.spawn({ projectId: "p1", config, profile: "does-not-exist" }),
    ).rejects.toThrow(/unknown profile/i);
  });

  it("passes the project root as the backend working directory", async () => {
    let received: string | undefined;
    const pool = new AgentPool({
      bus,
      backendFactory: (backendConfig) => {
        received = backendConfig.workingDirectory;
        return new FakeBackend([]);
      },
    });
    await pool.spawn({ projectId: "p1", config, profile: "default" });
    expect(received).toBe(dir);
  });

  it("killAll empties the pool", async () => {
    const pool = makePool();
    await pool.spawn({ projectId: "p1", config, profile: "default" });
    await pool.spawn({ projectId: "p1", config, profile: "default" });

    await pool.killAll();

    expect(pool.activeCount).toBe(0);
  });

  it("returns undefined for an unknown agent id", () => {
    expect(makePool().get("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm -w @clautana/runtime test AgentPool
```

Expected: FAIL — cannot resolve `../../src/agent/AgentPool.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/runtime/src/agent/AgentPool.ts`:

```ts
import { randomUUID } from "node:crypto";
import type {
  AgentBackend,
  AgentBackendConfig,
} from "../backend/AgentBackend.js";
import type { EventBus } from "../events/EventBus.js";
import type { ConfigManager } from "../project/ConfigManager.js";
import { AgentSession } from "./AgentSession.js";

export type BackendFactory = (config: AgentBackendConfig) => AgentBackend;

export interface AgentPoolOptions {
  bus: EventBus;
  backendFactory: BackendFactory;
}

export interface SpawnParams {
  projectId: string;
  config: ConfigManager;
  profile: string;
}

/** Owns the live agent sessions and their lifecycle. */
export class AgentPool {
  private readonly sessions = new Map<string, AgentSession>();

  constructor(private readonly options: AgentPoolOptions) {}

  get activeCount(): number {
    return this.sessions.size;
  }

  async spawn(params: SpawnParams): Promise<string> {
    const profiles = await params.config.loadProfiles();
    const profile = profiles.get(params.profile);
    if (!profile) {
      throw new Error(
        `Unknown profile "${params.profile}". Available: ${[...profiles.keys()].join(", ")}`,
      );
    }

    const agentId = randomUUID();
    const backend = this.options.backendFactory({
      name: profile.name,
      role: profile.role,
      focus: profile.focus,
      workingDirectory: params.config.projectRoot,
      systemPrompt: profile.systemPrompt,
      allowedTools: profile.allowedTools,
    });

    const session = new AgentSession({
      agentId,
      name: profile.name,
      profile: params.profile,
      backend,
      bus: this.options.bus,
    });
    this.sessions.set(agentId, session);

    await this.options.bus.publish({
      type: "agent.spawned",
      agentId,
      name: profile.name,
      profile: params.profile,
    });

    return agentId;
  }

  get(agentId: string): AgentSession | undefined {
    return this.sessions.get(agentId);
  }

  async killAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map((session) => session.kill()));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm -w @clautana/runtime test AgentPool
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): add agent pool with profile-driven spawn"
```

---

## Task 10: JSON-RPC server over stdio

**Files:**
- Create: `packages/runtime/src/rpc/JsonRpcServer.ts`, `packages/runtime/src/rpc/handlers.ts`
- Test: `packages/runtime/test/rpc/JsonRpcServer.test.ts`

**Interfaces:**
- Consumes: `RpcRequest`, `RpcResponse`, `PROTOCOL_VERSION`, RPC error codes from `@clautana/protocol`; `AgentPool` (Task 9); `ProjectRegistry` (Task 8); `EventBus` (Task 4).
- Produces: `type RpcHandler = (params: unknown) => Promise<unknown>`; `class JsonRpcServer` with `constructor(handlers: Record<string, RpcHandler>)`, `handleLine(line: string): Promise<string | undefined>`, `attach(input: Readable, output: Writable): void`, `pushEvent(event: RuntimeEvent): void`; `interface HandlerDeps { registry: ProjectRegistry; pool: AgentPool; runtimeVersion: string; runId: string; onSubscribe: (sinceSeq: number) => Promise<void> }` and `function createHandlers(deps: HandlerDeps): Record<string, RpcHandler>`.

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/test/rpc/JsonRpcServer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  RPC_ERROR_METHOD_NOT_FOUND,
  RPC_ERROR_INTERNAL,
} from "@clautana/protocol";
import { JsonRpcServer } from "../../src/rpc/JsonRpcServer.js";

function server(): JsonRpcServer {
  return new JsonRpcServer({
    "runtime.ping": async () => ({ protocolVersion: "1.0.0", runtimeVersion: "0.0.0" }),
    "test.echo": async (params) => params,
    "test.boom": async () => {
      throw new Error("handler failed");
    },
  });
}

describe("JsonRpcServer", () => {
  it("dispatches a request and returns a success response", async () => {
    const out = await server().handleLine(
      JSON.stringify({ id: 1, method: "runtime.ping", params: {} }),
    );
    const parsed = JSON.parse(out!);
    expect(parsed.id).toBe(1);
    expect(parsed.result.protocolVersion).toBe("1.0.0");
  });

  it("passes params through to the handler", async () => {
    const out = await server().handleLine(
      JSON.stringify({ id: 2, method: "test.echo", params: { hello: "world" } }),
    );
    expect(JSON.parse(out!).result).toEqual({ hello: "world" });
  });

  it("returns method-not-found for an unknown method", async () => {
    const out = await server().handleLine(
      JSON.stringify({ id: 3, method: "nope.missing", params: {} }),
    );
    expect(JSON.parse(out!).error.code).toBe(RPC_ERROR_METHOD_NOT_FOUND);
  });

  it("converts a throwing handler into an error response, not a crash", async () => {
    const out = await server().handleLine(
      JSON.stringify({ id: 4, method: "test.boom", params: {} }),
    );
    const parsed = JSON.parse(out!);
    expect(parsed.error.code).toBe(RPC_ERROR_INTERNAL);
    expect(parsed.error.message).toContain("handler failed");
  });

  it("ignores blank lines", async () => {
    expect(await server().handleLine("   ")).toBeUndefined();
  });

  it("reports malformed JSON without an id as an error with id -1", async () => {
    const out = await server().handleLine("{ not json");
    const parsed = JSON.parse(out!);
    expect(parsed.id).toBe(-1);
    expect(parsed.error.code).toBe(RPC_ERROR_INTERNAL);
  });

  it("writes pushed events as notifications on the output stream", async () => {
    const { PassThrough } = await import("node:stream");
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));

    const rpc = server();
    rpc.attach(input, output);
    rpc.pushEvent({
      seq: 1,
      runId: "run-1",
      timestamp: "2026-08-04T00:00:00.000Z",
      type: "agent.status",
      agentId: "a",
      status: "idle",
    });

    await new Promise((resolve) => setImmediate(resolve));

    const notification = JSON.parse(chunks.join("").trim());
    expect(notification.method).toBe("event");
    expect(notification.params.seq).toBe(1);
  });

  it("responds to requests arriving on the attached input stream", async () => {
    const { PassThrough } = await import("node:stream");
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));

    server().attach(input, output);
    input.write(`${JSON.stringify({ id: 9, method: "runtime.ping", params: {} })}\n`);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(JSON.parse(chunks.join("").trim()).id).toBe(9);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm -w @clautana/runtime test JsonRpcServer
```

Expected: FAIL — cannot resolve `../../src/rpc/JsonRpcServer.js`.

- [ ] **Step 3: Write packages/runtime/src/rpc/JsonRpcServer.ts**

```ts
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { RuntimeEvent } from "@clautana/protocol";
import {
  RPC_ERROR_INTERNAL,
  RPC_ERROR_METHOD_NOT_FOUND,
} from "@clautana/protocol";

export type RpcHandler = (params: unknown) => Promise<unknown>;

/**
 * Line-delimited JSON-RPC over a stdio pair.
 *
 * A handler failure must never kill the runtime: everything is converted into
 * an error response so the supervising shell sees a live process with a failed
 * call rather than a dead sidecar.
 */
export class JsonRpcServer {
  private output?: Writable;

  constructor(private readonly handlers: Record<string, RpcHandler>) {}

  attach(input: Readable, output: Writable): void {
    this.output = output;
    const lines = createInterface({ input, crlfDelay: Infinity });
    lines.on("line", (line) => {
      void this.handleLine(line).then((response) => {
        if (response !== undefined) {
          this.write(response);
        }
      });
    });
  }

  pushEvent(event: RuntimeEvent): void {
    this.write(JSON.stringify({ method: "event", params: event }));
  }

  async handleLine(line: string): Promise<string | undefined> {
    if (line.trim() === "") {
      return undefined;
    }

    let request: { id?: unknown; method?: unknown; params?: unknown };
    try {
      request = JSON.parse(line);
    } catch (error) {
      return JsonRpcServer.errorResponse(-1, RPC_ERROR_INTERNAL, `Malformed request: ${String(error)}`);
    }

    const id = typeof request.id === "number" ? request.id : -1;
    const method = typeof request.method === "string" ? request.method : "";
    const handler = this.handlers[method];

    if (!handler) {
      return JsonRpcServer.errorResponse(id, RPC_ERROR_METHOD_NOT_FOUND, `Unknown method: ${method}`);
    }

    try {
      const result = await handler(request.params);
      return JSON.stringify({ id, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return JsonRpcServer.errorResponse(id, RPC_ERROR_INTERNAL, message);
    }
  }

  private write(payload: string): void {
    this.output?.write(`${payload}\n`);
  }

  private static errorResponse(id: number, code: number, message: string): string {
    return JSON.stringify({ id, error: { code, message } });
  }
}
```

- [ ] **Step 4: Write packages/runtime/src/rpc/handlers.ts**

```ts
import { PROTOCOL_VERSION } from "@clautana/protocol";
import type { AgentPool } from "../agent/AgentPool.js";
import type { ProjectRegistry } from "../project/ProjectRegistry.js";
import type { RpcHandler } from "./JsonRpcServer.js";

export interface HandlerDeps {
  registry: ProjectRegistry;
  pool: AgentPool;
  runtimeVersion: string;
  runId: string;
  onSubscribe: (sinceSeq: number) => Promise<void>;
}

function requireString(params: unknown, key: string): string {
  const value = (params as Record<string, unknown> | undefined)?.[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`Missing required string parameter "${key}"`);
  }
  return value;
}

export function createHandlers(deps: HandlerDeps): Record<string, RpcHandler> {
  return {
    "runtime.ping": async () => ({
      protocolVersion: PROTOCOL_VERSION,
      runtimeVersion: deps.runtimeVersion,
    }),

    "project.open": async (params) => {
      const path = requireString(params, "path");
      const { projectId } = await deps.registry.open(path);
      return { projectId };
    },

    "agent.spawn": async (params) => {
      const projectId = requireString(params, "projectId");
      const profile = requireString(params, "profile");
      const config = deps.registry.get(projectId);
      if (!config) {
        throw new Error(`Unknown projectId: ${projectId}`);
      }
      const agentId = await deps.pool.spawn({ projectId, config, profile });
      return { agentId, runId: deps.runId };
    },

    "agent.prompt": async (params) => {
      const agentId = requireString(params, "agentId");
      const text = requireString(params, "text");
      const session = deps.pool.get(agentId);
      if (!session) {
        throw new Error(`Unknown agentId: ${agentId}`);
      }
      // Deliberately not awaited: the caller gets an immediate ack and follows
      // progress on the event stream.
      void session.sendPrompt(text);
      return { ok: true };
    },

    "agent.interrupt": async (params) => {
      const agentId = requireString(params, "agentId");
      const session = deps.pool.get(agentId);
      if (!session) {
        throw new Error(`Unknown agentId: ${agentId}`);
      }
      session.interrupt();
      return { ok: true };
    },

    "agent.kill": async (params) => {
      const agentId = requireString(params, "agentId");
      const session = deps.pool.get(agentId);
      if (!session) {
        throw new Error(`Unknown agentId: ${agentId}`);
      }
      await session.kill();
      return { ok: true };
    },

    "events.subscribe": async (params) => {
      const raw = (params as Record<string, unknown> | undefined)?.["sinceSeq"];
      const sinceSeq = typeof raw === "number" ? raw : 0;
      await deps.onSubscribe(sinceSeq);
      return { ok: true };
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm -w @clautana/runtime test JsonRpcServer
```

Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): add stdio JSON-RPC server and method handlers"
```

---

## Task 11: Sidecar entrypoint + contract test

**Files:**
- Create: `packages/runtime/src/main.ts`
- Test: `packages/runtime/test/contract/sidecar.contract.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–10.
- Produces: an executable entrypoint. Reads `CLAUTANA_RUNS_DIR` (defaults to `<cwd>/.clautana/runs`) and `CLAUTANA_FAKE_BACKEND` (when `"1"`, uses `FakeBackend` so the contract test needs no API key). Writes `{"method":"runtime.ready"}` to stdout once listening.

This is the primary integration test: it drives the real sidecar as a subprocess over real stdio, which is exactly the shape a scheduled headless run takes in slice 5.

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/test/contract/sidecar.contract.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { PROTOCOL_VERSION } from "@clautana/protocol";

// import.meta.dirname (Node 20.11+) — __dirname does not exist in ESM.
const ENTRY = resolve(import.meta.dirname, "../../dist/main.js");

let child: ChildProcessWithoutNullStreams;
let dir: string;
let nextId = 1;
const events: Record<string, unknown>[] = [];
const pending = new Map<number, (value: Record<string, unknown>) => void>();

beforeAll(() => {
  execFileSync("npm", ["-w", "@clautana/runtime", "run", "build"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}, 120_000);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clautana-contract-"));
  events.length = 0;
  pending.clear();
  nextId = 1;

  child = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, CLAUTANA_FAKE_BACKEND: "1", CLAUTANA_RUNS_DIR: join(dir, "runs") },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (line.trim() === "") return;
    const message = JSON.parse(line) as Record<string, unknown>;
    if (message["method"] === "event") {
      events.push(message["params"] as Record<string, unknown>);
      return;
    }
    if (typeof message["id"] === "number") {
      pending.get(message["id"] as number)?.(message);
      pending.delete(message["id"] as number);
    }
  });

  await waitFor(() => events.length >= 0, 50);
});

afterEach(async () => {
  child.kill();
  await rm(dir, { recursive: true, force: true });
});

function call(method: string, params: unknown): Promise<Record<string, unknown>> {
  const id = nextId++;
  return new Promise((resolvePromise) => {
    pending.set(id, resolvePromise);
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("Timed out waiting for condition");
}

describe("sidecar contract", () => {
  it("answers runtime.ping with the protocol version", async () => {
    const response = await call("runtime.ping", {});
    const result = response["result"] as { protocolVersion: string };
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it("opens a project and returns a projectId", async () => {
    const response = await call("project.open", { path: dir });
    expect((response["result"] as { projectId: string }).projectId).toMatch(/\S/);
  });

  it("errors on project.open with a missing path parameter", async () => {
    const response = await call("project.open", {});
    expect((response["error"] as { message: string }).message).toMatch(/path/i);
  });

  it("spawns an agent and emits agent.spawned", async () => {
    const { result: opened } = (await call("project.open", { path: dir })) as {
      result: { projectId: string };
    };
    await call("events.subscribe", { sinceSeq: 0 });
    await call("agent.spawn", { projectId: opened.projectId, profile: "default" });

    await waitFor(() => events.some((e) => e["type"] === "agent.spawned"));
    expect(events.some((e) => e["type"] === "agent.spawned")).toBe(true);
  });

  it("streams status and output events for a prompt", async () => {
    const { result: opened } = (await call("project.open", { path: dir })) as {
      result: { projectId: string };
    };
    await call("events.subscribe", { sinceSeq: 0 });
    const { result: spawned } = (await call("agent.spawn", {
      projectId: opened.projectId,
      profile: "default",
    })) as { result: { agentId: string } };

    await call("agent.prompt", { agentId: spawned.agentId, text: "hello" });

    await waitFor(() => events.some((e) => e["type"] === "agent.output"));
    const statuses = events.filter((e) => e["type"] === "agent.status").map((e) => e["status"]);
    expect(statuses).toContain("processing");
  });

  it("delivers events with strictly increasing seq", async () => {
    const { result: opened } = (await call("project.open", { path: dir })) as {
      result: { projectId: string };
    };
    await call("events.subscribe", { sinceSeq: 0 });
    const { result: spawned } = (await call("agent.spawn", {
      projectId: opened.projectId,
      profile: "default",
    })) as { result: { agentId: string } };
    await call("agent.prompt", { agentId: spawned.agentId, text: "hello" });

    await waitFor(() => events.length >= 3);

    const seqs = events.map((e) => e["seq"] as number);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("replays from sinceSeq for a reattaching subscriber", async () => {
    const { result: opened } = (await call("project.open", { path: dir })) as {
      result: { projectId: string };
    };
    await call("agent.spawn", { projectId: opened.projectId, profile: "default" });

    // Subscribe only after the spawn: the missed event must still arrive.
    await call("events.subscribe", { sinceSeq: 0 });

    await waitFor(() => events.some((e) => e["type"] === "agent.spawned"));
    expect(events[0]!["seq"]).toBe(1);
  });

  it("returns an error for an unknown agentId rather than dying", async () => {
    const response = await call("agent.prompt", { agentId: "nope", text: "hi" });
    expect((response["error"] as { message: string }).message).toMatch(/unknown agentid/i);

    const ping = await call("runtime.ping", {});
    expect(ping["result"]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm -w @clautana/runtime test sidecar.contract
```

Expected: FAIL — build produces no `dist/main.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/runtime/src/main.ts`:

```ts
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { RuntimeEvent } from "@clautana/protocol";
import { EventLog } from "./events/EventLog.js";
import { EventBus } from "./events/EventBus.js";
import { AgentPool } from "./agent/AgentPool.js";
import { ProjectRegistry } from "./project/ProjectRegistry.js";
import { JsonRpcServer } from "./rpc/JsonRpcServer.js";
import { createHandlers } from "./rpc/handlers.js";
import { ClaudeBackend } from "./backend/ClaudeBackend.js";
import { FakeBackend } from "./backend/FakeBackend.js";
import type { AgentBackend, AgentBackendConfig } from "./backend/AgentBackend.js";

const RUNTIME_VERSION = "0.1.0";

function backendFactory(config: AgentBackendConfig): AgentBackend {
  if (process.env["CLAUTANA_FAKE_BACKEND"] === "1") {
    return new FakeBackend([
      [
        { kind: "text", content: "fake backend response" },
        { kind: "result", costUsd: 0, tokensUsed: 0 },
      ],
    ]);
  }
  return new ClaudeBackend(config);
}

async function main(): Promise<void> {
  const runsDir = process.env["CLAUTANA_RUNS_DIR"] ?? join(process.cwd(), ".clautana", "runs");
  const runId = process.env["CLAUTANA_RUN_ID"] ?? randomUUID();

  const log = await EventLog.open(runsDir, runId);
  const bus = new EventBus(log);
  const registry = new ProjectRegistry();
  const pool = new AgentPool({ bus, backendFactory });

  let rpc: JsonRpcServer;

  const handlers = createHandlers({
    registry,
    pool,
    runtimeVersion: RUNTIME_VERSION,
    runId,
    onSubscribe: async (sinceSeq) => {
      await bus.subscribe(sinceSeq, (event: RuntimeEvent) => rpc.pushEvent(event));
    },
  });

  rpc = new JsonRpcServer(handlers);
  rpc.attach(process.stdin, process.stdout);

  await bus.publish({ type: "run.started", projectId: "" });

  process.stdout.write(`${JSON.stringify({ method: "runtime.ready" })}\n`);

  const shutdown = async (): Promise<void> => {
    await pool.killAll();
    await log.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((error: unknown) => {
  process.stderr.write(`[clautana-runtime] fatal: ${String(error)}\n`);
  process.exit(1);
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm -w @clautana/runtime test sidecar.contract
```

Expected: PASS, 8 tests. (First run builds the package; allow up to two minutes.)

- [ ] **Step 5: Run the whole runtime suite**

```bash
npm -w @clautana/runtime test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): add sidecar entrypoint with stdio contract tests"
```

---

## Task 12: Package the sidecar as a single-file binary

**Files:**
- Create: `packages/runtime/build.mjs`, `packages/runtime/sea-config.json`, `packages/runtime/scripts/make-sea.mjs`
- Modify: `packages/runtime/package.json` (add `bundle` and `package:sea` scripts)

**Interfaces:**
- Consumes: Task 11's `dist/main.js`.
- Produces: `apps/desktop/src-tauri/binaries/clautana-runtime-x86_64-pc-windows-msvc.exe`, the Tauri sidecar naming convention (`<name>-<target-triple><ext>`).

- [ ] **Step 1: Write the esbuild bundle script**

Create `packages/runtime/build.mjs`:

```js
import { build } from "esbuild";

// The Claude SDK resolves and spawns its own platform executable at runtime and
// carries non-JS assets (manifest.json, manifest.zst.json), so it must stay
// external rather than being inlined into the bundle.
await build({
  entryPoints: ["dist/main.js"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  outfile: "build/bundle.cjs",
  external: ["@anthropic-ai/claude-agent-sdk"],
  banner: {
    js: "const require = require;",
  },
});

console.log("bundled -> packages/runtime/build/bundle.cjs");
```

- [ ] **Step 2: Add the SEA config**

Create `packages/runtime/sea-config.json`:

```json
{
  "main": "build/bundle.cjs",
  "output": "build/sea-prep.blob",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": false,
  "useCodeCache": true
}
```

- [ ] **Step 3: Add the packaging scripts to packages/runtime/package.json**

Add to the `scripts` block:

```json
"bundle": "npm run build && node build.mjs",
"package:sea": "node scripts/make-sea.mjs"
```

- [ ] **Step 4: Write the SEA assembly script**

Create `packages/runtime/scripts/make-sea.mjs`:

```js
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
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

copyFileSync(process.execPath, outFile);

execFileSync(
  "npx",
  [
    "postject",
    outFile,
    "NODE_SEA_BLOB",
    join(pkgRoot, "build", "sea-prep.blob"),
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ],
  { cwd: pkgRoot, stdio: "inherit", shell: isWindows },
);

console.log(`sidecar -> ${outFile}`);
```

- [ ] **Step 5: Build the sidecar binary and verify it runs**

```bash
npm -w @clautana/runtime run package:sea
```

Expected: prints `sidecar -> ...clautana-runtime-x86_64-pc-windows-msvc.exe`.

- [ ] **Step 6: Smoke-test the binary answers ping**

```bash
echo '{"id":1,"method":"runtime.ping","params":{}}' | ./apps/desktop/src-tauri/binaries/clautana-runtime-x86_64-pc-windows-msvc.exe
```

Expected: a line containing `"protocolVersion":"1.0.0"`.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime
git commit -m "build(runtime): package sidecar as a Node SEA single-file binary"
```

---

## Task 13: Tauri shell — sidecar supervision and process teardown

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/tauri.conf.json` (at `apps/desktop/src-tauri/tauri.conf.json`), `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/src/main.rs`, `apps/desktop/src-tauri/src/sidecar.rs`, `apps/desktop/src-tauri/src/job.rs`
- Test: `apps/desktop/src-tauri/src/sidecar.rs` (inline `#[cfg(test)]` module)

**Interfaces:**
- Consumes: the sidecar binary from Task 12.
- Produces: Tauri command `rpc_call(payload: String) -> Result<String, String>`; a Tauri event channel named `runtime-event` carrying opaque JSON strings to the webview; `pub fn backoff_delay_ms(attempt: u32) -> u64`.

Rust treats every payload as an opaque `String`. It must not deserialise agent-domain types.

- [ ] **Step 1: Scaffold the Tauri app**

```bash
npm create tauri-app@latest -- --template react-ts --manager npm --yes desktop
```

Run this from `apps/`. When it completes, verify `apps/desktop/src-tauri/Cargo.toml` exists.

- [ ] **Step 2: Add the Rust dependencies**

```bash
cd apps/desktop/src-tauri && cargo add tokio --features full && cargo add serde_json && cargo add tauri-plugin-shell && cargo add tauri-plugin-dialog && cargo add --target 'cfg(windows)' win32job
```

Expected: `Cargo.toml` gains `tokio`, `serde_json`, `tauri-plugin-shell`, `tauri-plugin-dialog`, and a `[target."cfg(windows)".dependencies]` section with `win32job`.

- [ ] **Step 3: Declare the sidecar in tauri.conf.json**

In `apps/desktop/src-tauri/tauri.conf.json`, set `bundle.externalBin` and restrict targets to Windows:

```json
{
  "bundle": {
    "active": true,
    "targets": ["msi"],
    "externalBin": ["binaries/clautana-runtime"],
    "resources": ["resources/claude-agent-sdk/**/*"]
  }
}
```

- [ ] **Step 4: Write the failing test for restart backoff**

Add to `apps/desktop/src-tauri/src/sidecar.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::backoff_delay_ms;

    #[test]
    fn backoff_grows_exponentially_from_250ms() {
        assert_eq!(backoff_delay_ms(0), 250);
        assert_eq!(backoff_delay_ms(1), 500);
        assert_eq!(backoff_delay_ms(2), 1000);
    }

    #[test]
    fn backoff_is_capped_at_thirty_seconds() {
        assert_eq!(backoff_delay_ms(20), 30_000);
    }
}
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
cd apps/desktop/src-tauri && cargo test
```

Expected: FAIL — `backoff_delay_ms` not found.

- [ ] **Step 6: Write apps/desktop/src-tauri/src/job.rs**

```rust
//! Guarantees the sidecar and every process it spawns die with the app.
//!
//! The Claude SDK spawns a `claude` executable as a child; without containment a
//! force-quit can strand them, burning tokens with no UI to stop them.

#[cfg(windows)]
pub struct ProcessGuard {
    job: win32job::Job,
}

#[cfg(windows)]
impl ProcessGuard {
    pub fn new() -> Result<Self, String> {
        let job = win32job::Job::create().map_err(|e| e.to_string())?;
        let mut info = job.query_extended_limit_info().map_err(|e| e.to_string())?;
        info.limit_kill_on_job_close();
        job.set_extended_limit_info(&info).map_err(|e| e.to_string())?;
        Ok(Self { job })
    }

    pub fn assign(&self, pid: u32) -> Result<(), String> {
        self.job.assign_process(pid as _).map_err(|e| e.to_string())
    }
}

#[cfg(not(windows))]
pub struct ProcessGuard;

#[cfg(not(windows))]
impl ProcessGuard {
    pub fn new() -> Result<Self, String> {
        Ok(Self)
    }

    pub fn assign(&self, _pid: u32) -> Result<(), String> {
        Ok(())
    }
}
```

- [ ] **Step 7: Write apps/desktop/src-tauri/src/sidecar.rs**

```rust
use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::oneshot;

use crate::job::ProcessGuard;

const MAX_BACKOFF_MS: u64 = 30_000;

pub fn backoff_delay_ms(attempt: u32) -> u64 {
    let delay = 250u64.saturating_mul(1u64 << attempt.min(20));
    delay.min(MAX_BACKOFF_MS)
}

type Pending = Arc<Mutex<HashMap<i64, oneshot::Sender<String>>>>;

pub struct Runtime {
    child: Mutex<Option<CommandChild>>,
    pending: Pending,
    next_id: AtomicI64,
    guard: ProcessGuard,
}

impl Runtime {
    pub fn spawn(app: &AppHandle) -> Result<Arc<Self>, String> {
        let guard = ProcessGuard::new()?;
        let runtime = Arc::new(Self {
            child: Mutex::new(None),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicI64::new(1),
            guard,
        });
        runtime.clone().start(app.clone())?;
        Ok(runtime)
    }

    fn start(self: Arc<Self>, app: AppHandle) -> Result<(), String> {
        let (mut rx, child) = app
            .shell()
            .sidecar("clautana-runtime")
            .map_err(|e| e.to_string())?
            .spawn()
            .map_err(|e| e.to_string())?;

        self.guard.assign(child.pid())?;
        *self.child.lock().unwrap() = Some(child);

        let pending = self.pending.clone();
        let this = self.clone();

        tauri::async_runtime::spawn(async move {
            let mut attempt = 0u32;
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        let line = String::from_utf8_lossy(&bytes).to_string();
                        for part in line.lines() {
                            route_line(part, &pending, &app);
                        }
                    }
                    CommandEvent::Stderr(bytes) => {
                        eprintln!("[runtime] {}", String::from_utf8_lossy(&bytes));
                    }
                    CommandEvent::Terminated(_) => {
                        let delay = backoff_delay_ms(attempt);
                        attempt = attempt.saturating_add(1);
                        let _ = app.emit("runtime-status", "restarting");
                        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                        let _ = this.clone().start(app.clone());
                        return;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    pub async fn call(&self, payload: String) -> Result<String, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        // The UI sends a bodyless method+params object; Rust owns id assignment
        // so responses can be correlated without inspecting the payload.
        let framed = inject_id(&payload, id)?;

        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        self.write(&framed)?;
        rx.await.map_err(|_| "runtime closed before responding".to_string())
    }

    pub fn write(&self, payload: &str) -> Result<(), String> {
        let mut slot = self.child.lock().unwrap();
        let child = slot.as_mut().ok_or("runtime is not running")?;
        child
            .write(format!("{payload}\n").as_bytes())
            .map_err(|e| e.to_string())
    }
}

fn inject_id(payload: &str, id: i64) -> Result<String, String> {
    let mut value: serde_json::Value = serde_json::from_str(payload).map_err(|e| e.to_string())?;
    value["id"] = serde_json::Value::from(id);
    serde_json::to_string(&value).map_err(|e| e.to_string())
}

fn route_line(line: &str, pending: &Pending, app: &AppHandle) {
    if line.trim().is_empty() {
        return;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return;
    };

    if value.get("method").is_some() {
        let _ = app.emit("runtime-event", line.to_string());
        return;
    }

    if let Some(id) = value.get("id").and_then(|v| v.as_i64()) {
        if let Some(tx) = pending.lock().unwrap().remove(&id) {
            let _ = tx.send(line.to_string());
        }
    }
}

#[tauri::command]
pub async fn rpc_call(app: AppHandle, payload: String) -> Result<String, String> {
    let runtime = app.state::<Arc<Runtime>>();
    runtime.call(payload).await
}

#[cfg(test)]
mod tests {
    use super::backoff_delay_ms;

    #[test]
    fn backoff_grows_exponentially_from_250ms() {
        assert_eq!(backoff_delay_ms(0), 250);
        assert_eq!(backoff_delay_ms(1), 500);
        assert_eq!(backoff_delay_ms(2), 1000);
    }

    #[test]
    fn backoff_is_capped_at_thirty_seconds() {
        assert_eq!(backoff_delay_ms(20), 30_000);
    }
}
```

- [ ] **Step 8: Wire it into main.rs**

Replace `apps/desktop/src-tauri/src/main.rs` with:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod job;
mod sidecar;
mod tray;

use std::sync::Arc;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let runtime = sidecar::Runtime::spawn(&app.handle())?;
            app.manage(Arc::clone(&runtime));
            tray::setup(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![sidecar::rpc_call])
        .run(tauri::generate_context!())
        .expect("error while running Clautana");
}
```

- [ ] **Step 9: Run the Rust tests to verify they pass**

```bash
cd apps/desktop/src-tauri && cargo test
```

Expected: PASS, 2 tests. (`tray` must exist — Task 14 creates it; if the build fails on the missing module, complete Task 14's Step 1 first, then re-run.)

- [ ] **Step 10: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): supervise the runtime sidecar with job-object teardown"
```

---

## Task 14: Tray, window lifecycle, and quit safety

**Files:**
- Create: `apps/desktop/src-tauri/src/tray.rs`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: `Runtime` (Task 13).
- Produces: `pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>>` — installs a tray icon with `Show` and `Quit` items, and makes window-close hide instead of exit.

- [ ] **Step 1: Write apps/desktop/src-tauri/src/tray.rs**

```rust
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, Manager, WindowEvent};

pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Show Clautana", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    if let Some(window) = app.get_webview_window("main") {
        let handle = window.clone();
        window.on_window_event(move |event| {
            // Closing the window hides it. Runs continue: that is the whole
            // point of being tray-resident.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = handle.hide();
            }
        });
    }

    Ok(())
}
```

- [ ] **Step 2: Enable the tray feature in Cargo.toml**

```bash
cd apps/desktop/src-tauri && cargo add tauri --features tray-icon
```

- [ ] **Step 3: Build the app to verify it compiles**

```bash
cd apps/desktop && npm run tauri build -- --debug
```

Expected: compiles and produces a debug executable under `src-tauri/target/debug/`.

- [ ] **Step 4: Manually verify tray behaviour**

Run the debug executable. Confirm:
1. A window appears.
2. Closing the window hides it and the app stays in the tray.
3. Tray → "Show Clautana" restores it.
4. Tray → "Quit" exits.
5. After quitting, Task Manager shows no `clautana-runtime` process.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): add system tray with hide-on-close window lifecycle"
```

---

## Task 15: React UI — project, agent, and streaming output

**Files:**
- Create: `apps/desktop/src/styles/tokens.css`, `apps/desktop/src/rpc.ts`, `apps/desktop/src/App.tsx`, `apps/desktop/src/components/OutputStream.tsx`
- Test: `apps/desktop/test/rpc.test.ts`

> **Visual design (added during execution).** Read
> [docs/desktop/design-reference.md](../../desktop/design-reference.md) before writing any
> markup. It captures the adopted design language — Windows 11 Fluent, dark,
> information-dense — imported from the "Workbench workflow automation platform"
> design project, whose mockup covers this product's own later slices (steps,
> triggers, cron, MCP servers, token budgets, live log).
>
> Create `apps/desktop/src/styles/tokens.css` from the token block in that
> document verbatim, import it once at the app entry, and reference only
> `var(--…)` in components — no hard-coded hex values anywhere in `src/`.
>
> Three things are easy to get wrong and matter: the type scale is small on
> purpose (11–13.5px body — do not inflate it to web defaults); text on a filled
> accent surface is `--accent-fg` (`#001a26`), never white; and agent output must
> use `--font-mono`. Map status events to colour as that document specifies.
>
> The functional requirements below are unchanged — styling is additive, not a
> licence to alter behaviour or the RPC contract.

> **Verify the UI over the DevTools protocol, not with desktop automation.**
> This machine's desktop is the operator's real one, with personal files on it.
> WebView2 exposes CDP, so the running app can be driven headlessly:
>
> ```bash
> WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" ./desktop.exe
> curl -s http://127.0.0.1:9222/json/list
> ```
>
> Then attach to the page's WebSocket and use `Runtime.evaluate` to read
> `document.body.innerText` for real rendered state, `Log.entryAdded` and
> `Runtime.consoleAPICalled` for console output, and synthesized clicks to drive
> the flow. Node 22+ has a global `WebSocket`, so this needs no dependency — a
> ~40-line script is enough.
>
> This reads what actually rendered rather than what a screenshot appears to show,
> and it touches nothing outside the app. Prefer it over computer-use for every
> UI check in this task.
>
> **Consume all three channels the shell emits**, not just the one the original
> plan named: `runtime-event` (the JSON-RPC event stream), `runtime-ready`
> (readiness gate — the sidecar's `{"method":"runtime.ready"}` is deliberately
> *not* forwarded as an event), and `runtime-status` (supervision state, including
> `fatal: restart failed: …`). Surfacing `runtime-status` is what gives a user any
> signal when the sidecar dies permanently.

**Interfaces:**
- Consumes: Tauri command `rpc_call`; Tauri event `runtime-event`; `RuntimeEvent`, `isRuntimeEvent` from `@clautana/protocol`.
- Produces: `class RpcClient` with `constructor(invoke: (cmd: string, args: Record<string, unknown>) => Promise<string>)`, `async call<T>(method: string, params: unknown): Promise<T>` (throws on an error response), `handleNotification(line: string): RuntimeEvent | undefined`.

- [ ] **Step 1: Add the protocol dependency and vitest to the desktop app**

In `apps/desktop/package.json`, add to `dependencies`: `"@clautana/protocol": "*"`, `"@tauri-apps/api": "2.11.1"`, `"@tauri-apps/plugin-dialog": "2.7.2"`; add to `devDependencies`: `"vitest": "^4.1.10"`; add to `scripts`: `"test": "vitest run"`. Then:

```bash
npm install
```

- [ ] **Step 2: Write the failing test**

Create `apps/desktop/test/rpc.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RpcClient } from "../src/rpc.js";

describe("RpcClient", () => {
  it("returns the result of a successful call", async () => {
    const client = new RpcClient(async () =>
      JSON.stringify({ id: 1, result: { protocolVersion: "1.0.0" } }),
    );
    const result = await client.call<{ protocolVersion: string }>("runtime.ping", {});
    expect(result.protocolVersion).toBe("1.0.0");
  });

  it("sends method and params to the invoker", async () => {
    let sent = "";
    const client = new RpcClient(async (_cmd, args) => {
      sent = args["payload"] as string;
      return JSON.stringify({ id: 1, result: {} });
    });
    await client.call("project.open", { path: "C:/tmp" });

    const parsed = JSON.parse(sent);
    expect(parsed.method).toBe("project.open");
    expect(parsed.params.path).toBe("C:/tmp");
  });

  it("throws with the server message on an error response", async () => {
    const client = new RpcClient(async () =>
      JSON.stringify({ id: 1, error: { code: -32603, message: "Unknown projectId: x" } }),
    );
    await expect(client.call("agent.spawn", {})).rejects.toThrow("Unknown projectId: x");
  });

  it("parses a valid event notification", () => {
    const client = new RpcClient(async () => "{}");
    const event = client.handleNotification(
      JSON.stringify({
        method: "event",
        params: {
          seq: 3,
          runId: "r",
          timestamp: "2026-08-04T00:00:00.000Z",
          type: "agent.output",
          agentId: "a",
          payload: { kind: "text", content: "hi" },
        },
      }),
    );
    expect(event?.seq).toBe(3);
  });

  it("ignores non-event notifications", () => {
    const client = new RpcClient(async () => "{}");
    expect(client.handleNotification(JSON.stringify({ method: "runtime.ready" }))).toBeUndefined();
  });

  it("ignores malformed notification lines", () => {
    const client = new RpcClient(async () => "{}");
    expect(client.handleNotification("{ not json")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm -w desktop test
```

Expected: FAIL — cannot resolve `../src/rpc.js`.

- [ ] **Step 4: Write apps/desktop/src/rpc.ts**

```ts
import { isRuntimeEvent, type RuntimeEvent } from "@clautana/protocol";

export type Invoker = (
  command: string,
  args: Record<string, unknown>,
) => Promise<string>;

/**
 * UI-side JSON-RPC client. Rust assigns request ids and correlates responses,
 * so this only shapes the payload and unwraps the result.
 */
export class RpcClient {
  constructor(private readonly invoke: Invoker) {}

  async call<T>(method: string, params: unknown): Promise<T> {
    const raw = await this.invoke("rpc_call", {
      payload: JSON.stringify({ method, params }),
    });
    const response = JSON.parse(raw) as {
      result?: T;
      error?: { code: number; message: string };
    };
    if (response.error) {
      throw new Error(response.error.message);
    }
    return response.result as T;
  }

  handleNotification(line: string): RuntimeEvent | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return undefined;
    }
    const message = parsed as { method?: unknown; params?: unknown };
    if (message.method !== "event" || !isRuntimeEvent(message.params)) {
      return undefined;
    }
    return message.params;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm -w desktop test
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Write apps/desktop/src/components/OutputStream.tsx**

```tsx
import type { RuntimeEvent } from "@clautana/protocol";

export function OutputStream({ events }: { events: RuntimeEvent[] }) {
  return (
    <div className="output-stream">
      {events.map((event) => (
        <div key={event.seq} className={`event event-${event.type.replace(".", "-")}`}>
          {renderEvent(event)}
        </div>
      ))}
    </div>
  );
}

function renderEvent(event: RuntimeEvent): string {
  switch (event.type) {
    case "agent.output":
      return event.payload.content;
    case "agent.toolCall":
      return `→ ${event.payload.name}`;
    case "agent.status":
      return `[${event.status}]`;
    case "agent.error":
      return `error: ${event.message}`;
    case "agent.result":
      return `done — $${event.costUsd.toFixed(4)}, ${event.tokensUsed} tokens`;
    case "agent.spawned":
      return `spawned ${event.name}`;
    default:
      return event.type;
  }
}
```

- [ ] **Step 7: Write apps/desktop/src/App.tsx**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { RuntimeEvent } from "@clautana/protocol";
import { RpcClient } from "./rpc.js";
import { OutputStream } from "./components/OutputStream.js";

const rpc = new RpcClient((command, args) => invoke<string>(command, args));

export default function App() {
  const [projectId, setProjectId] = useState<string>();
  const [agentId, setAgentId] = useState<string>();
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string>();
  const lastSeq = useRef(0);

  useEffect(() => {
    const unlisten = listen<string>("runtime-event", (message) => {
      const event = rpc.handleNotification(message.payload);
      if (!event || event.seq <= lastSeq.current) {
        return;
      }
      lastSeq.current = event.seq;
      setEvents((current) => [...current, event]);
    });

    // Resubscribing from the last seen seq is what makes closing and reopening
    // the window lossless.
    void rpc.call("events.subscribe", { sinceSeq: lastSeq.current }).catch((e: Error) =>
      setError(e.message),
    );

    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  const openProject = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") {
      return;
    }
    try {
      const result = await rpc.call<{ projectId: string }>("project.open", { path: selected });
      setProjectId(result.projectId);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const spawnAgent = useCallback(async () => {
    if (!projectId) return;
    try {
      const result = await rpc.call<{ agentId: string }>("agent.spawn", {
        projectId,
        profile: "default",
      });
      setAgentId(result.agentId);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  const send = useCallback(async () => {
    if (!agentId || prompt.trim() === "") return;
    try {
      await rpc.call("agent.prompt", { agentId, text: prompt });
      setPrompt("");
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [agentId, prompt]);

  return (
    <main className="app">
      <header>
        <button onClick={() => void openProject()}>Open project…</button>
        <button onClick={() => void spawnAgent()} disabled={!projectId}>
          Spawn agent
        </button>
        {agentId && (
          <button onClick={() => void rpc.call("agent.interrupt", { agentId })}>Interrupt</button>
        )}
      </header>

      {error && <div className="error">{error}</div>}

      <OutputStream events={events} />

      <footer>
        <input
          value={prompt}
          placeholder="Send a prompt…"
          disabled={!agentId}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
        />
        <button onClick={() => void send()} disabled={!agentId}>
          Send
        </button>
      </footer>
    </main>
  );
}
```

- [ ] **Step 8: Verify the app builds**

```bash
cd apps/desktop && npm run build
```

Expected: Vite build succeeds with no TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): add React UI for project, agent, and output stream"
```

---

## Task 16: End-to-end smoke test, docs, and retire the extension

**Files:**
- Create: `docs/desktop/README.md`
- Modify: `README.md`
- Delete: `src/multi-agent-harness/`

**Interfaces:**
- Consumes: everything.
- Produces: a documented, buildable app and a repository with the extension removed.

- [ ] **Step 1: Stage the Claude Agent SDK next to the sidecar binary**

> **Plan revision (discovered during execution).** This step originally copied
> `node_modules/@anthropic-ai/claude-agent-sdk/cli.js`. **That file does not exist
> in SDK 0.3.x** — the package ships `sdk.mjs`, `bridge.mjs`,
> `extractFromBunfs.js`, and `manifest.json`/`manifest.zst.json`, and resolves its
> own platform executable at runtime. The SDK is marked `external` in the esbuild
> bundle (Task 12), so its whole package directory must ship alongside the sidecar
> binary instead.

```bash
mkdir -p apps/desktop/src-tauri/resources/claude-agent-sdk && cp -r node_modules/@anthropic-ai/claude-agent-sdk/. apps/desktop/src-tauri/resources/claude-agent-sdk/
```

Expected: `apps/desktop/src-tauri/resources/claude-agent-sdk/sdk.mjs` and `manifest.json` exist.

Then confirm the sidecar binary can actually load the SDK from that location — an
`external` import that cannot resolve at runtime is the failure mode this step
exists to prevent:

```bash
node -e "process.chdir('apps/desktop/src-tauri/resources/claude-agent-sdk'); import('./sdk.mjs').then(m => console.log('SDK loads, query present:', typeof m.query === 'function')).catch(e => { console.error('SDK FAILED TO LOAD:', e.message); process.exit(1); })"
```

Expected: `SDK loads, query present: true`. If it fails, resolve the loading problem before continuing — Task 16's smoke test cannot pass without it.

> **Resolution constraint (measured in Task 12).** The packaged SEA binary resolves
> the SDK's dynamic `import()` by walking up from **`process.cwd()`** looking for
> `node_modules` — **not** from the binary's own directory. Staging the SDK beside
> the exe is therefore not sufficient on its own.
>
> Two workable options; pick one and verify it end-to-end rather than assuming:
> 1. Have the Rust shell spawn the sidecar with a working directory that is (or is
>    an ancestor of) a `node_modules` tree containing `@anthropic-ai/claude-agent-sdk`.
> 2. Place a real `node_modules/@anthropic-ai/claude-agent-sdk/` next to the exe and
>    always launch the sidecar with that directory as cwd.
>
> Whichever is chosen, prove it by running the PACKAGED binary — not `node dist/main.js` —
> and confirming a real (non-fake) backend can load the SDK. This is the single most
> likely way the installed app fails while every test still passes.

- [ ] **Step 2: Build the full app**

```bash
npm run build && npm -w @clautana/runtime run package:sea && cd apps/desktop && npm run tauri build
```

Expected: an MSI under `apps/desktop/src-tauri/target/release/bundle/msi/`.

- [ ] **Step 3: Run the manual smoke path**

Install and run the MSI. Confirm every step:

1. App launches and shows a window.
2. "Open project…" picks a folder; a `.clautana/` directory appears inside it with `memory/`, `agents/`, `messages/`, `context/`, `runs/`.
3. "Spawn agent" produces a `spawned` line in the output stream.
4. Sending a prompt streams `[processing]`, then text output, then `[idle]`.
5. Closing the window hides to tray; reopening from the tray shows the full prior output with no gaps and no duplicates.
6. "Interrupt" during a run yields `[interrupted]`.
7. Tray → Quit exits. No `clautana-runtime.exe` and no stray `node.exe` from the SDK remain.

Use process forensics rather than eyeballing Task Manager — parentage is the part
that actually proves the tree came up correctly, and absence is easier to assert
in a script than to read off a list:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -match 'desktop|clautana-runtime|claude|node' } |
  Select-Object ProcessId, ParentProcessId, Name, CommandLine | Format-Table -Auto
```

While the app is running this should show `desktop.exe` → `clautana-runtime.exe`,
and — once an agent is actually running — the SDK's `claude` executable beneath the
sidecar. That parentage is what distinguishes "the sidecar spawned and is hosting
the agent" from "the sidecar spawned but the agent never started", which are
indistinguishable from output alone. After Quit, the same command must return
nothing.

8. Force-quit the app (`Stop-Process -Force`) rather than using Quit, and re-run
   the same query. It must also return nothing — that is the Job Object guarantee,
   and it is the one that matters when the app crashes rather than exits.

9. **Check the diagnostics log** (Task 18). Force a sidecar failure — e.g. point
   `CLAUTANA_CLAUDE_EXECUTABLE` at a nonexistent path, or corrupt the sidecar
   binary — and confirm the reason appears in the log file under the app-data
   directory. If the app cannot explain its own failure here, Task 18 did not
   land, regardless of what its unit tests say.

Record any failures and fix before continuing.

- [ ] **Step 4: Write docs/desktop/README.md**

````markdown
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

## Testing

- `npm test` — unit tests across all packages
- `npm -w @clautana/runtime test sidecar.contract` — drives the built sidecar over real stdio; the primary integration test

## On-disk state

Per project, in `<project>/.clautana/`: `config.json`, `memory/`, `agents/`, `messages/`, `context/`, `runs/`. This layout is byte-compatible with the retired VS Code extension.
````

- [ ] **Step 5: Update the root README**

Replace the "Installation & Setup" section of `README.md` with a pointer to `docs/desktop/README.md`, and add this note directly under the top-level heading:

```markdown
> **Note:** Clautana has moved from a VS Code extension to a standalone desktop
> application. The extension is retired at v0.1.5. See
> [docs/desktop/README.md](docs/desktop/README.md).
```

- [ ] **Step 6: Delete the extension**

```bash
git rm -r --quiet src/multi-agent-harness && git status --short
```

Expected: deletions staged; no unexpected modifications.

- [ ] **Step 7: Verify nothing referenced the deleted tree**

```bash
grep -rn "multi-agent-harness" --include="*.json" --include="*.ts" --include="*.tsx" --include="*.md" --include="*.yml" . | grep -v "^./docs/superpowers/"
```

Expected: no output. Fix any hits before committing.

- [ ] **Step 8: Run the full suite one last time**

```bash
npm test && cd apps/desktop/src-tauri && cargo test
```

Expected: all TypeScript and Rust tests pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: retire VS Code extension in favour of the desktop app

The desktop app now covers slice 1: tray-resident shell, supervised Node
sidecar, and a Claude-backed agent running headless with streaming output."
```

---

## Verification Checklist

Slice 1 is done when all of these hold:

- [ ] `npm test` passes at the repo root.
- [ ] `cd apps/desktop/src-tauri && cargo test` passes.
- [ ] `npm -w @clautana/runtime test sidecar.contract` passes against the built sidecar.
- [ ] An MSI builds and installs.
- [ ] The manual smoke path in Task 16 Step 3 passes in full, including no orphaned processes after quit.
- [ ] `src/multi-agent-harness/` no longer exists and nothing references it.

---

## Task 17: Per-profile model and effort configuration

> **Added during execution.** Executes after Task 12, before Task 13. Numbered 17
> to avoid renumbering tasks already complete.
>
> **Why:** an audit found no model ID anywhere in the codebase — every agent
> silently inherits the Claude CLI's default model at its default effort. The
> Agent SDK's `Options` exposes `model`, `effort`, and `thinking`; we set none of
> them. For a product whose whole purpose is running *differentiated* agents
> (a cheap triage agent and a hard-refactor agent are not the same job), that is
> a functional gap, not a stylistic one.
>
> Doing it now rather than in slice 2 because `AgentProfile` is **written to disk**
> in `<project>/.clautana/agents/*.json`. Adding fields after users have profile
> files means a migration; adding them now costs nothing.

**Files:**
- Modify: `packages/runtime/src/project/AgentProfiles.ts`, `packages/runtime/src/backend/AgentBackend.ts`, `packages/runtime/src/backend/ClaudeBackend.ts`, `packages/runtime/src/agent/AgentPool.ts`
- Test: the existing test files for each

**Interfaces:**
- Consumes: `EffortLevel` from `@anthropic-ai/claude-agent-sdk` (exported: `'low' | 'medium' | 'high' | 'xhigh' | 'max'`).
- Produces: `AgentProfile` and `AgentBackendConfig` each gain `model?: string` and `effort?: EffortLevel`; `ClaudeBackend` forwards both to `query()` options.

**Verified SDK facts** (checked against the installed `sdk.d.ts` — do not re-derive):
- `Options.model?: string` — *"Claude model to use. Defaults to the CLI default model."*
- `Options.effort?: EffortLevel`, and `EffortLevel` is exported at `sdk.d.ts:553`.
- `Options.thinking?: ThinkingConfig` also exists but is **out of scope** for this task.

**Design decisions (already made — implement as stated):**
- Both fields are **optional**. Omitted → the SDK/CLI default applies, exactly as today. Existing profile files on disk stay valid with no migration.
- `DEFAULT_PROFILE` gets an explicit `effort: "high"` — the documented API default, made explicit rather than inherited. It deliberately does **not** set `model`: hard-coding a model ID into the default would date the product and override the user's CLI configuration.
- `xhigh` is the documented best setting for coding and agentic work (and Claude Code's own default). Do not make it the default here — it is the setting a *coding* profile should opt into, and the default profile is general-purpose.
- Do NOT add `thinking`. Its correct value is model-dependent, and no slice-1 requirement needs it.

- [ ] **Step 1: Write the failing tests**

Extend the existing suites rather than adding new files:
- `test/project/ProjectRegistry.test.ts` — a profile JSON carrying `model` and `effort` round-trips through `loadProfiles()`; a profile with an **invalid** `effort` value (e.g. `"turbo"`) has that field dropped rather than failing the whole profile; `DEFAULT_PROFILE` exposes `effort: "high"`.
- `test/agent/AgentPool.test.ts` — a profile's `model` and `effort` reach the `backendFactory`'s `AgentBackendConfig`.

- [ ] **Step 2: Run them and confirm they fail**

```bash
npm -w @clautana/runtime test
```

- [ ] **Step 3: Add the fields to `AgentProfiles.ts`**

Add `model?: string` and `effort?: EffortLevel` to `AgentProfile`, importing `EffortLevel` as a type from `@anthropic-ai/claude-agent-sdk`. Set `effort: "high"` on `DEFAULT_PROFILE`.

Extend `parseAgentProfile` to read both. Validate `effort` against the five legal values and **drop an invalid one rather than rejecting the profile** — this matches the existing resilience contract, where one bad field must not stop a project opening. `model` is a free-form string (the SDK accepts any model ID); accept any non-empty string and drop anything else.

- [ ] **Step 4: Thread through `AgentBackendConfig` and `AgentPool`**

Add the same two optional fields to `AgentBackendConfig`, and pass `profile.model` / `profile.effort` when `AgentPool.spawn()` builds the backend config.

- [ ] **Step 5: Forward to `query()` in `ClaudeBackend`**

Add `model` and `effort` to the options object, **omitting each key entirely when undefined** so the SDK default still applies — use the same conditional-spread pattern already used for `pathToClaudeCodeExecutable`. Do not pass `undefined` explicitly.

- [ ] **Step 6: Verify**

```bash
npm -w @clautana/runtime test
```

Plus `typecheck`, `typecheck:test`, `build`, and the `any` grep.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime
git commit -m "feat(runtime): make model and effort configurable per agent profile"
```

---

## Task 18: Durable sidecar diagnostics

> **Added during execution**, from a debugging pattern the human partner shared:
> *"the supervisor logged 'worker stderr emitted' and threw the content away, and
> the worker deliberately redacts errors to a constructor name. So the app could
> only ever tell me `Error`."* We have the same bug in a different shape.

**The gap:** `main.rs:2` sets `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`,
so a release build has **no console**. `sidecar.rs:124` captures the sidecar's
stderr and `eprintln!`s it — into a handle that goes nowhere. The diagnostic is
captured and then discarded. In a shipped app, an agent failure is unexplainable.

This matters most in Task 16: when the smoke test fails on an installed MSI,
there is currently nothing to read.

**Files:**
- Modify: `apps/desktop/src-tauri/src/sidecar.rs`
- Create: a small log-writing module (e.g. `src-tauri/src/logfile.rs`)

**Requirements:**
- Sidecar stderr, plus the shell's own supervision events (spawn, restart with
  attempt number, assign failure, shutdown path taken, fatal restart), append to a
  file under the Tauri **app-data** directory — resolve it via Tauri's path API,
  do not hard-code `%APPDATA%`.
- Keep `eprintln!` as well, so `cargo run` still shows it inline.
- Timestamp each line and tag its source (`[sidecar]` vs `[shell]`) — an
  undifferentiated blob is barely better than nothing.
- **Cap the file.** An agent looping on an error could otherwise fill the disk.
  Simplest sufficient approach: truncate at startup and stop appending past a size
  ceiling, logging once that the cap was hit. Do not build rotation.
- A failure to open or write the log must **never** take down the app or the
  supervisor. Degrade to `eprintln!` only.
- Print the resolved log path once at startup so a user can be told where to look.

**Testing:** the path-resolution and cap logic should be pure enough to unit-test
without a running Tauri app. The end-to-end check belongs in Task 16: force a
sidecar failure and confirm the reason appears in the log file.
