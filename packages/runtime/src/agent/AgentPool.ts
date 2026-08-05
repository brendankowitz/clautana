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
