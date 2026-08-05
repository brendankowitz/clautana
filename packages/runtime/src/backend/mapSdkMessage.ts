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
