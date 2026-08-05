import { describe, it, expect } from "vitest";
import {
  PROTOCOL_VERSION,
  isRuntimeEvent,
  RUNTIME_EVENT_TYPES,
  type RuntimeEvent,
} from "../src/index.js";

describe("protocol", () => {
  it("exposes a semver protocol version", () => {
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("accepts a well-formed event", () => {
    const event: RuntimeEvent = {
      seq: 1,
      runId: "run-1",
      timestamp: "2026-08-04T00:00:00.000Z",
      type: "agent.output",
      agentId: "agent-1",
      payload: { kind: "text", content: "hello" },
    };
    expect(isRuntimeEvent(event)).toBe(true);
  });

  it("rejects an object missing seq", () => {
    expect(
      isRuntimeEvent({
        runId: "run-1",
        timestamp: "2026-08-04T00:00:00.000Z",
        type: "agent.output",
      }),
    ).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(isRuntimeEvent(null)).toBe(false);
    expect(isRuntimeEvent("agent.output")).toBe(false);
  });

  it("pins RUNTIME_EVENT_TYPES to the expected eight event types", () => {
    const expectedTypes: RuntimeEvent["type"][] = [
      "run.started",
      "run.ended",
      "agent.spawned",
      "agent.status",
      "agent.output",
      "agent.toolCall",
      "agent.result",
      "agent.error",
    ];
    expect(RUNTIME_EVENT_TYPES).toEqual(expectedTypes);
  });
});
