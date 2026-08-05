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
