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
 * Drives one agent's conversation against a backend, projecting everything it
 * observes onto the event bus. Holds no transport and no UI concerns, so it is
 * identical whether a window is attached or the run is scheduled and headless.
 */
export class AgentSession {
  private _status: AgentStatus = "idle";
  private _costUsd = 0;
  private _tokensUsed = 0;
  private _controller?: AbortController;

  // Tracks the in-flight turn so kill() can sequence its own terminal write
  // after the turn's, rather than racing it. Set when a turn starts, cleared
  // once sendPrompt() has finished awaiting it.
  private _turnPromise?: Promise<void>;

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

    const turn = this.runTurn(text);
    this._turnPromise = turn;
    try {
      await turn;
    } finally {
      if (this._turnPromise === turn) {
        this._turnPromise = undefined;
      }
    }
  }

  private async runTurn(text: string): Promise<void> {
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
    // Abort first so the in-flight turn actually stops producing events,
    // then wait for its own tail write (interrupted/idle/error) to land
    // before publishing ours. Racing the two lets the turn's status write
    // land AFTER "complete", which is incoherent for anything replaying
    // the durable stream. The turn's own error, if any, is not kill()'s
    // to surface, so its rejection is swallowed here.
    this._controller?.abort();
    const turn = this._turnPromise;
    if (turn) {
      await turn.catch(() => {});
    }
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

  private async publish(draft: EventDraft): Promise<void> {
    await this.options.bus.publish(draft);
  }
}
