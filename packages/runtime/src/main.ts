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
