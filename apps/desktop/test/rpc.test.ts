import { describe, it, expect } from "vitest";
import { RpcClient } from "../src/rpc.js";

describe("RpcClient", () => {
  it("returns the result of a successful call", async () => {
    const client = new RpcClient(async () =>
      JSON.stringify({ id: 1, result: { protocolVersion: "1.0.0" } }),
    );
    const result = await client.call<{ protocolVersion: string }>("runtime.ping", {});
    expect(result.protocolVersion).toBe("1.0.0");
  });

  it("sends method and params to the invoker", async () => {
    let sent = "";
    const client = new RpcClient(async (_cmd, args) => {
      sent = args["payload"] as string;
      return JSON.stringify({ id: 1, result: {} });
    });
    await client.call("project.open", { path: "C:/tmp" });

    const parsed = JSON.parse(sent);
    expect(parsed.method).toBe("project.open");
    expect(parsed.params.path).toBe("C:/tmp");
  });

  it("throws with the server message on an error response", async () => {
    const client = new RpcClient(async () =>
      JSON.stringify({ id: 1, error: { code: -32603, message: "Unknown projectId: x" } }),
    );
    await expect(client.call("agent.spawn", {})).rejects.toThrow("Unknown projectId: x");
  });

  it("parses a valid event notification", () => {
    const client = new RpcClient(async () => "{}");
    const event = client.handleNotification(
      JSON.stringify({
        method: "event",
        params: {
          seq: 3,
          runId: "r",
          timestamp: "2026-08-04T00:00:00.000Z",
          type: "agent.output",
          agentId: "a",
          payload: { kind: "text", content: "hi" },
        },
      }),
    );
    expect(event?.seq).toBe(3);
  });

  it("ignores non-event notifications", () => {
    const client = new RpcClient(async () => "{}");
    expect(client.handleNotification(JSON.stringify({ method: "runtime.ready" }))).toBeUndefined();
  });

  it("ignores malformed notification lines", () => {
    const client = new RpcClient(async () => "{}");
    expect(client.handleNotification("{ not json")).toBeUndefined();
  });
});
