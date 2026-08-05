import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";

const EFFORT_LEVELS: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value);
}

export interface AgentProfile {
  name: string;
  role: string;
  focus: string;
  systemPrompt?: string;
  allowedTools?: string[];
  model?: string;
  effort?: EffortLevel;
}

export const DEFAULT_PROFILE: AgentProfile = {
  name: "Assistant",
  role: "general",
  focus: "general-purpose assistance",
  effort: "high",
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
    model:
      typeof candidate["model"] === "string" && candidate["model"].length > 0
        ? candidate["model"]
        : undefined,
    effort: isEffortLevel(candidate["effort"]) ? candidate["effort"] : undefined,
  };
}
