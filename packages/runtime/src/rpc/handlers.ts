import { PROTOCOL_VERSION } from "@clautana/protocol";
import type { AgentPool } from "../agent/AgentPool.js";
import type { ProjectRegistry } from "../project/ProjectRegistry.js";
import { InvalidParamsError } from "./errors.js";
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
    throw new InvalidParamsError(`Missing required string parameter "${key}"`);
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
        throw new InvalidParamsError(`Unknown projectId: ${projectId}`);
      }
      const agentId = await deps.pool.spawn({ projectId, config, profile });
      return { agentId, runId: deps.runId };
    },

    "agent.prompt": async (params) => {
      const agentId = requireString(params, "agentId");
      const text = requireString(params, "text");
      const session = deps.pool.get(agentId);
      if (!session) {
        throw new InvalidParamsError(`Unknown agentId: ${agentId}`);
      }
      // Deliberately not awaited: the caller gets an immediate ack and follows
      // progress on the event stream. A prompt can run for minutes, so
      // blocking the RPC response on it would stall the whole stdio channel.
      //
      // sendPrompt() is an async function whose FIRST statement can throw
      // (when the agent is already mid-turn) - a synchronous throw inside an
      // async function becomes a rejected promise, not a synchronous
      // exception. Without this .catch, that rejection would be unhandled
      // and Node (>=15) terminates the whole process on an unhandled
      // rejection, taking the sidecar down over what should be a routine
      // "you double-clicked Send" case. The failure is only logged, not
      // surfaced as an agent.error event: HandlerDeps deliberately has no
      // EventBus reference (only the onSubscribe callback), and widening it
      // just for this one rejection path would be a bigger design change
      // than this fix warrants.
      void session.sendPrompt(text).catch((error: unknown) => {
        console.error(`[rpc] agent.prompt failed for agent ${agentId}:`, error);
      });
      return { ok: true };
    },

    "agent.interrupt": async (params) => {
      const agentId = requireString(params, "agentId");
      const session = deps.pool.get(agentId);
      if (!session) {
        throw new InvalidParamsError(`Unknown agentId: ${agentId}`);
      }
      session.interrupt();
      return { ok: true };
    },

    "agent.kill": async (params) => {
      const agentId = requireString(params, "agentId");
      const session = deps.pool.get(agentId);
      if (!session) {
        throw new InvalidParamsError(`Unknown agentId: ${agentId}`);
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
