import type {
  AgentBackend,
  AgentBackendConfig,
  BackendCapabilities,
  BackendEvent,
} from "./AgentBackend.js";
import { mapSdkMessage, type SdkMessage } from "./mapSdkMessage.js";

export class ClaudeBackend implements AgentBackend {
  readonly capabilities: BackendCapabilities = { mcp: true, interrupt: true, cost: true };

  private sessionId?: string;

  constructor(private readonly config: AgentBackendConfig) {}

  async *run(prompt: string, signal: AbortSignal): AsyncIterable<BackendEvent> {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");

    const controller = new AbortController();
    signal.addEventListener("abort", () => controller.abort(), { once: true });

    const stderrChunks: string[] = [];

    // pathToClaudeCodeExecutable is deliberately omitted: SDK 0.3.x resolves its
    // own built-in executable. Set CLAUTANA_CLAUDE_EXECUTABLE only to override.
    const override = process.env["CLAUTANA_CLAUDE_EXECUTABLE"];

    const result = query({
      prompt,
      options: {
        cwd: this.config.workingDirectory,
        allowedTools: this.config.allowedTools ?? [],
        mcpServers: (this.config.mcpServers ?? {}) as Record<string, never>,
        settingSources: ["user", "project", "local"],
        permissionMode: "acceptEdits",
        systemPrompt: this.config.systemPrompt,
        abortController: controller,
        resume: this.sessionId,
        ...(override ? { pathToClaudeCodeExecutable: override } : {}),
        stderr: (data: string) => stderrChunks.push(data),
      },
    });

    for await (const raw of result) {
      const message = raw as SdkMessage;
      if (message.session_id) {
        this.sessionId = message.session_id;
      }
      for (const event of mapSdkMessage(message)) {
        yield event;
      }
    }

    // Surfaced after the stream so stderr noise cannot interleave with output.
    for (const chunk of stderrChunks) {
      yield { kind: "stderr", content: chunk };
    }
  }

  async dispose(): Promise<void> {
    this.sessionId = undefined;
  }
}
