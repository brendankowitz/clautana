import { describe, it, expect } from "vitest";
import { mapSdkMessage } from "../../src/backend/mapSdkMessage.js";

describe("mapSdkMessage", () => {
  it("maps an assistant text block to a text event", () => {
    const events = mapSdkMessage({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello" }] },
    });
    expect(events).toEqual([{ kind: "text", content: "hello" }]);
  });

  it("maps a tool_use block to a toolCall event", () => {
    const events = mapSdkMessage({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "t1", name: "Read", input: { path: "a.ts" } }],
      },
    });
    expect(events).toEqual([
      { kind: "toolCall", toolCallId: "t1", name: "Read", arguments: { path: "a.ts" } },
    ]);
  });

  it("maps every block in a multi-block message, in order", () => {
    const events = mapSdkMessage({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "first" },
          { type: "tool_use", id: "t1", name: "Read", input: {} },
          { type: "text", text: "second" },
        ],
      },
    });
    expect(events.map((e) => e.kind)).toEqual(["text", "toolCall", "text"]);
  });

  it("maps a result message to a result event", () => {
    const events = mapSdkMessage({
      type: "result",
      total_cost_usd: 0.0125,
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    expect(events).toEqual([{ kind: "result", costUsd: 0.0125, tokensUsed: 150 }]);
  });

  it("defaults missing cost and usage to zero", () => {
    const events = mapSdkMessage({ type: "result" });
    expect(events).toEqual([{ kind: "result", costUsd: 0, tokensUsed: 0 }]);
  });

  it("returns no events for message types we do not surface", () => {
    expect(mapSdkMessage({ type: "system" })).toEqual([]);
    expect(mapSdkMessage({ type: "user" })).toEqual([]);
  });

  it("skips an assistant message with no content", () => {
    expect(mapSdkMessage({ type: "assistant" })).toEqual([]);
    expect(mapSdkMessage({ type: "assistant", message: {} })).toEqual([]);
  });

  it("skips content blocks of unknown type without throwing", () => {
    const events = mapSdkMessage({
      type: "assistant",
      message: { content: [{ type: "thinking" }, { type: "text", text: "kept" }] },
    });
    expect(events).toEqual([{ kind: "text", content: "kept" }]);
  });

  it("skips a text block with no text and a tool_use with no name", () => {
    const events = mapSdkMessage({
      type: "assistant",
      message: { content: [{ type: "text" }, { type: "tool_use", id: "t1" }] },
    });
    expect(events).toEqual([]);
  });
});
