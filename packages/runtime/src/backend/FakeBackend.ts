import type {
  AgentBackend,
  BackendCapabilities,
  BackendEvent,
} from "./AgentBackend.js";

/** Deterministic backend for tests. Never touches the network or a subprocess. */
export class FakeBackend implements AgentBackend {
  readonly capabilities: BackendCapabilities = { mcp: true, interrupt: true, cost: true };
  readonly prompts: string[] = [];

  private runIndex = 0;

  constructor(
    private readonly script: BackendEvent[][],
    private readonly failure?: Error,
  ) {}

  static failing(message: string): FakeBackend {
    return new FakeBackend([], new Error(message));
  }

  async *run(prompt: string, signal: AbortSignal): AsyncIterable<BackendEvent> {
    this.prompts.push(prompt);

    if (this.failure) {
      throw this.failure;
    }

    const events = this.script[this.runIndex++] ?? [];
    for (const event of events) {
      if (signal.aborted) {
        return;
      }
      yield event;
    }
  }

  async dispose(): Promise<void> {
    // Nothing to release.
  }
}
