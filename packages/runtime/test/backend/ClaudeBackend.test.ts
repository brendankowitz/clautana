import { describe, it, expect } from "vitest";
import { ClaudeBackend, type SdkQueryFn } from "../../src/backend/ClaudeBackend.js";
import type { AgentBackendConfig, BackendEvent } from "../../src/backend/AgentBackend.js";

const config: AgentBackendConfig = {
  name: "test-agent",
  workingDirectory: "/tmp/test",
};

describe("ClaudeBackend", () => {
  it("yields stderr after the main stream, not interleaved, on the happy path", async () => {
    const stubQuery: SdkQueryFn = async function* (params) {
      params.options.stderr?.("only chunk");
      yield { type: "assistant", message: { content: [{ type: "text", text: "one" }] } };
      yield { type: "assistant", message: { content: [{ type: "text", text: "two" }] } };
    };

    const backend = new ClaudeBackend(config, stubQuery);
    const controller = new AbortController();

    const events: BackendEvent[] = [];
    for await (const event of backend.run("do something", controller.signal)) {
      events.push(event);
    }

    expect(events).toEqual([
      { kind: "text", content: "one" },
      { kind: "text", content: "two" },
      { kind: "stderr", content: "only chunk" },
    ]);
  });

  it("yields buffered stderr and still propagates the error when the stream throws mid-run", async () => {
    const stubQuery: SdkQueryFn = async function* (params) {
      params.options.stderr?.("first stderr chunk");
      yield { type: "assistant", message: { content: [{ type: "text", text: "partial" }] } };
      params.options.stderr?.("second stderr chunk");
      throw new Error("sdk stream failed");
    };

    const backend = new ClaudeBackend(config, stubQuery);
    const controller = new AbortController();

    const events: BackendEvent[] = [];
    let caught: unknown;
    try {
      for await (const event of backend.run("do something", controller.signal)) {
        events.push(event);
      }
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("sdk stream failed");

    expect(events).toEqual([
      { kind: "text", content: "partial" },
      { kind: "stderr", content: "first stderr chunk" },
      { kind: "stderr", content: "second stderr chunk" },
    ]);
  });
});
