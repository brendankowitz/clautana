import type {
  AgentBackend,
  AgentBackendConfig,
  BackendCapabilities,
  BackendEvent,
} from "./AgentBackend.js";
import { mapSdkMessage, type SdkMessage } from "./mapSdkMessage.js";
import type { Options as SdkOptions } from "@anthropic-ai/claude-agent-sdk";

/**
 * The slice of the SDK's `query` function ClaudeBackend depends on: given a
 * prompt and options, produce an async iterable of SDK messages.
 *
 * Injectable (defaulting to the real SDK, imported lazily) so tests can
 * drive the stream — including throwing mid-stream — with a stub, without
 * invoking the real SDK, which would attempt a large binary download and
 * require credentials.
 */
export type SdkQueryFn = (params: {
  prompt: string;
  options: SdkOptions;
}) => AsyncIterable<unknown>;

async function* defaultSdkQuery(params: {
  prompt: string;
  options: SdkOptions;
}): AsyncGenerator<unknown> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  yield* query(params);
}

export class ClaudeBackend implements AgentBackend {
  readonly capabilities: BackendCapabilities = { mcp: true, interrupt: true, cost: true };

  private sessionId?: string;

  constructor(
    private readonly config: AgentBackendConfig,
    private readonly queryFn: SdkQueryFn = defaultSdkQuery,
  ) {}

  async *run(prompt: string, signal: AbortSignal): AsyncIterable<BackendEvent> {
    const controller = new AbortController();
    signal.addEventListener("abort", () => controller.abort(), { once: true });

    const stderrChunks: string[] = [];

    // pathToClaudeCodeExecutable is deliberately omitted: SDK 0.3.x resolves its
    // own built-in executable. Set CLAUTANA_CLAUDE_EXECUTABLE only to override.
    const override = process.env["CLAUTANA_CLAUDE_EXECUTABLE"];

    const options: SdkOptions = {
      cwd: this.config.workingDirectory,
      allowedTools: this.config.allowedTools ?? [],
      // Placeholder cast pending a real McpServerConfig-shaped type on
      // AgentBackendConfig; MCP server management belongs to a later slice.
      mcpServers: (this.config.mcpServers ?? {}) as Record<string, never>,
      settingSources: ["user", "project", "local"],
      permissionMode: "acceptEdits",
      systemPrompt: this.config.systemPrompt,
      abortController: controller,
      resume: this.sessionId,
      ...(override ? { pathToClaudeCodeExecutable: override } : {}),
      stderr: (data: string) => stderrChunks.push(data),
    };

    const result = this.queryFn({ prompt, options });

    try {
      for await (const raw of result) {
        const message = raw as SdkMessage;
        if (message.session_id) {
          this.sessionId = message.session_id;
        }
        for (const event of mapSdkMessage(message)) {
          yield event;
        }
      }
    } finally {
      // Surfaced after the stream — on both the happy path and the throw
      // path — so stderr noise cannot interleave with output, and so a
      // mid-stream failure still carries its diagnostic stderr with it
      // rather than losing it before the exception propagates.
      for (const chunk of stderrChunks) {
        yield { kind: "stderr", content: chunk };
      }
    }
  }

  async dispose(): Promise<void> {
    this.sessionId = undefined;
  }
}
