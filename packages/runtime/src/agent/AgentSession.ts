import type { AgentStatus } from "@clautana/protocol";
import type { AgentBackend } from "../backend/AgentBackend.js";
import type { EventBus } from "../events/EventBus.js";
import type { EventDraft } from "../events/EventLog.js";

export interface AgentSessionOptions {
  agentId: string;
  name: string;
  profile: string;
  backend: AgentBackend;
  bus: EventBus;
}

/**
 * The drafts AgentSession actually produces, kept as a real discriminated
 * union so each call site is checked against its own variant's fields.
 *
 * `EventDraft` (from EventLog) is `Omit<RuntimeEvent, "seq"|"runId"|"timestamp">`,
 * but `Omit` is not distributive over a union: it collapses to the keys common
 * to every RuntimeEvent variant, which is just `type`. That flattened shape
 * can't type-check a literal like `{ type: "agent.status", agentId, status }`,
 * so drafts are built against this union instead and widened to `EventDraft`
 * only at the point they're handed to the bus.
 */
type AgentSessionDraft =
  | { type: "agent.status"; agentId: string; status: AgentStatus }
  | {
      type: "agent.output";
      agentId: string;
      payload: { kind: "text" | "system" | "stderr"; content: string };
    }
  | {
      type: "agent.toolCall";
      agentId: string;
      payload: {
        toolCallId: string;
        name: string;
        arguments: Record<string, unknown>;
      };
    }
  | { type: "agent.result"; agentId: string; costUsd: number; tokensUsed: number }
  | { type: "agent.error"; agentId: string; message: string };

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

  private async publish(draft: AgentSessionDraft): Promise<void> {
    await this.options.bus.publish(draft as EventDraft);
  }
}
