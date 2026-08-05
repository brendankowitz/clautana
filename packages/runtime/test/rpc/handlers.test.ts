import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RPC_ERROR_INVALID_PARAMS } from "@clautana/protocol";
import { EventLog } from "../../src/events/EventLog.js";
import { EventBus } from "../../src/events/EventBus.js";
import { FakeBackend } from "../../src/backend/FakeBackend.js";
import { ProjectRegistry } from "../../src/project/ProjectRegistry.js";
import { AgentPool } from "../../src/agent/AgentPool.js";
import { JsonRpcServer } from "../../src/rpc/JsonRpcServer.js";
import { createHandlers, type HandlerDeps } from "../../src/rpc/handlers.js";

let dir: string;
let log: EventLog;
let bus: EventBus;
let registry: ProjectRegistry;
let pool: AgentPool;
let deps: HandlerDeps;
let rpc: JsonRpcServer;
let projectId: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clautana-handlers-"));
  registry = new ProjectRegistry();
  const opened = await registry.open(dir);
  projectId = opened.projectId;
  log = await EventLog.open(opened.config.runsDir, "run-1");
  bus = new EventBus(log);
  // A script-less FakeBackend.run() never yields, so a spawned agent's turn
  // stays "processing" for as long as the test needs it to.
  pool = new AgentPool({ bus, backendFactory: () => new FakeBackend([[]]) });
  deps = {
    registry,
    pool,
    runtimeVersion: "0.0.0",
    runId: "run-1",
    onSubscribe: async () => {},
  };
  rpc = new JsonRpcServer(createHandlers(deps));
});

afterEach(async () => {
  await log.close();
  await rm(dir, { recursive: true, force: true });
});

async function spawnAgent(): Promise<string> {
  const out = await rpc.handleLine(
    JSON.stringify({ id: 1, method: "agent.spawn", params: { projectId, profile: "default" } }),
  );
  const parsed = JSON.parse(out!) as { result?: { agentId: string }; error?: unknown };
  if (!parsed.result) {
    throw new Error(`agent.spawn failed: ${JSON.stringify(parsed.error)}`);
  }
  return parsed.result.agentId;
}

describe("createHandlers", () => {
  describe("agent.prompt double-fire crash immunity", () => {
    it("survives a second agent.prompt arriving while the first is still processing", async () => {
      const agentId = await spawnAgent();

      let unhandledRejection: unknown;
      const onUnhandledRejection = (reason: unknown): void => {
        unhandledRejection = reason;
      };
      process.on("unhandledRejection", onUnhandledRejection);

      try {
        // Fired back-to-back with no await on the underlying sendPrompt: the
        // first call's synchronous prefix flips AgentSession's status to
        // "processing" before this function returns, so the second call
        // observes "processing" and its sendPrompt() rejects. Without a
        // .catch on that rejection in the handler, this would be an
        // unhandled rejection and Node would terminate the process.
        const first = await rpc.handleLine(
          JSON.stringify({ id: 2, method: "agent.prompt", params: { agentId, text: "first" } }),
        );
        const second = await rpc.handleLine(
          JSON.stringify({ id: 3, method: "agent.prompt", params: { agentId, text: "second" } }),
        );

        expect(JSON.parse(first!).result).toEqual({ ok: true });
        expect(JSON.parse(second!).result).toEqual({ ok: true });

        // Give the rejected sendPrompt() promise's .catch a turn to run.
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));

        expect(unhandledRejection).toBeUndefined();

        // Prove the runtime is still alive and serving requests.
        const ping = await rpc.handleLine(
          JSON.stringify({ id: 4, method: "runtime.ping", params: {} }),
        );
        expect(JSON.parse(ping!).result.protocolVersion).toBeDefined();
      } finally {
        process.off("unhandledRejection", onUnhandledRejection);
      }
    });
  });

  describe("unknown id parameters", () => {
    it("returns RPC_ERROR_INVALID_PARAMS for an unknown agentId on agent.prompt", async () => {
      const out = await rpc.handleLine(
        JSON.stringify({ id: 5, method: "agent.prompt", params: { agentId: "nope", text: "hi" } }),
      );
      const parsed = JSON.parse(out!);
      expect(parsed.error.code).toBe(RPC_ERROR_INVALID_PARAMS);
      expect(parsed.error.message).toContain("nope");
    });

    it("returns RPC_ERROR_INVALID_PARAMS for an unknown agentId on agent.interrupt", async () => {
      const out = await rpc.handleLine(
        JSON.stringify({ id: 6, method: "agent.interrupt", params: { agentId: "nope" } }),
      );
      expect(JSON.parse(out!).error.code).toBe(RPC_ERROR_INVALID_PARAMS);
    });

    it("returns RPC_ERROR_INVALID_PARAMS for an unknown agentId on agent.kill", async () => {
      const out = await rpc.handleLine(
        JSON.stringify({ id: 7, method: "agent.kill", params: { agentId: "nope" } }),
      );
      expect(JSON.parse(out!).error.code).toBe(RPC_ERROR_INVALID_PARAMS);
    });

    it("returns RPC_ERROR_INVALID_PARAMS for an unknown projectId on agent.spawn", async () => {
      const out = await rpc.handleLine(
        JSON.stringify({ id: 8, method: "agent.spawn", params: { projectId: "nope", profile: "default" } }),
      );
      expect(JSON.parse(out!).error.code).toBe(RPC_ERROR_INVALID_PARAMS);
    });
  });
});
