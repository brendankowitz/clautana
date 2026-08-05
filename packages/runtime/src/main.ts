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

  // One stdio channel serves one live subscriber at a time. A reattaching
  // client (e.g. the desktop UI resubscribing on window reopen, Task 15)
  // sends another events.subscribe rather than starting a fresh process, so
  // without explicitly retiring the previous listener, EventBus - which
  // keys listeners by reference in a Set - would happily keep both
  // registered, and every future event would be written to stdout twice,
  // compounding with each reconnect.
  let unsubscribe: (() => void) | undefined;

  const handlers = createHandlers({
    registry,
    pool,
    runtimeVersion: RUNTIME_VERSION,
    runId,
    onSubscribe: async (sinceSeq) => {
      unsubscribe?.();
      unsubscribe = await bus.subscribe(sinceSeq, (event: RuntimeEvent) => rpc.pushEvent(event));
    },
  });

  rpc = new JsonRpcServer(handlers);
  rpc.attach(process.stdin, process.stdout);

  process.stdout.write(`${JSON.stringify({ method: "runtime.ready" })}\n`);

  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    let exitCode = 0;
    try {
      // AgentPool.killAll() (frozen Task 9 state) swallows every session's
      // kill() failure internally via Promise.allSettled and always
      // resolves - by design it exposes no per-session failure detail to
      // callers. This try/catch is therefore defensive against an
      // unexpected throw from killAll()/log.close() rather than a way to
      // observe individual agent-kill failures, which AgentPool's API does
      // not surface.
      await pool.killAll();
      await log.close();
    } catch (error) {
      exitCode = 1;
      process.stderr.write(`[clautana-runtime] shutdown error: ${String(error)}\n`);
    }

    // EventLog.close() guarantees the JSONL file is durable; it guarantees
    // nothing about process.stdout. JsonRpcServer.write() is fire-and-forget
    // (output?.write(data), no callback awaited), and process.exit() does
    // not wait for pending writes on a piped stdout - worse on Windows,
    // where child stdio uses async named pipes. Without this drain, the
    // agent.status events pool.killAll() just published above are durable
    // on disk but can vanish from the live stream the instant we exit.
    // Writable streams flush queued writes in order, so waiting on this
    // trailing empty write's callback also waits on everything queued
    // ahead of it.
    await new Promise<void>((resolveFlush) => {
      process.stdout.write("", () => resolveFlush());
    });

    process.exit(exitCode);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  // The parent closing its end of the pipe (the Tauri shell tearing down,
  // or a test harness calling child.stdin.end()) is the one shutdown
  // trigger that behaves identically on every platform. Signals do not: on
  // Windows, child_process#kill() terminates the process unconditionally
  // regardless of the signal name, so it never reaches a SIGTERM/SIGINT
  // handler here, making that path untestable and unreliable there.
  process.stdin.on("end", () => void shutdown());
}

main().catch((error: unknown) => {
  process.stderr.write(`[clautana-runtime] fatal: ${String(error)}\n`);
  process.exit(1);
});
