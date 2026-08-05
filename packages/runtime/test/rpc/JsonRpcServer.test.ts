import { describe, it, expect } from "vitest";
import {
  RPC_ERROR_METHOD_NOT_FOUND,
  RPC_ERROR_INTERNAL,
  RPC_ERROR_INVALID_PARAMS,
} from "@clautana/protocol";
import { JsonRpcServer } from "../../src/rpc/JsonRpcServer.js";
import { InvalidParamsError } from "../../src/rpc/errors.js";

function server(): JsonRpcServer {
  return new JsonRpcServer({
    "runtime.ping": async () => ({ protocolVersion: "1.0.0", runtimeVersion: "0.0.0" }),
    "test.echo": async (params) => params,
    "test.boom": async () => {
      throw new Error("handler failed");
    },
    "test.badParams": async () => {
      throw new InvalidParamsError('Missing required string parameter "agentId"');
    },
  });
}

describe("JsonRpcServer", () => {
  it("dispatches a request and returns a success response", async () => {
    const out = await server().handleLine(
      JSON.stringify({ id: 1, method: "runtime.ping", params: {} }),
    );
    const parsed = JSON.parse(out!);
    expect(parsed.id).toBe(1);
    expect(parsed.result.protocolVersion).toBe("1.0.0");
  });

  it("passes params through to the handler", async () => {
    const out = await server().handleLine(
      JSON.stringify({ id: 2, method: "test.echo", params: { hello: "world" } }),
    );
    expect(JSON.parse(out!).result).toEqual({ hello: "world" });
  });

  it("returns method-not-found for an unknown method", async () => {
    const out = await server().handleLine(
      JSON.stringify({ id: 3, method: "nope.missing", params: {} }),
    );
    expect(JSON.parse(out!).error.code).toBe(RPC_ERROR_METHOD_NOT_FOUND);
  });

  it("converts a throwing handler into an error response, not a crash", async () => {
    const out = await server().handleLine(
      JSON.stringify({ id: 4, method: "test.boom", params: {} }),
    );
    const parsed = JSON.parse(out!);
    expect(parsed.error.code).toBe(RPC_ERROR_INTERNAL);
    expect(parsed.error.message).toContain("handler failed");
  });

  it("returns invalid-params for a handler that rejects with InvalidParamsError", async () => {
    const out = await server().handleLine(
      JSON.stringify({ id: 5, method: "test.badParams", params: {} }),
    );
    const parsed = JSON.parse(out!);
    expect(parsed.error.code).toBe(RPC_ERROR_INVALID_PARAMS);
    expect(parsed.error.message).toContain("agentId");
  });

  it("still returns internal error for a handler throwing a generic Error", async () => {
    const out = await server().handleLine(
      JSON.stringify({ id: 6, method: "test.boom", params: {} }),
    );
    const parsed = JSON.parse(out!);
    expect(parsed.error.code).toBe(RPC_ERROR_INTERNAL);
  });

  it("ignores blank lines", async () => {
    expect(await server().handleLine("   ")).toBeUndefined();
  });

  it("reports malformed JSON without an id as an error with id -1", async () => {
    const out = await server().handleLine("{ not json");
    const parsed = JSON.parse(out!);
    expect(parsed.id).toBe(-1);
    expect(parsed.error.code).toBe(RPC_ERROR_INTERNAL);
  });

  it("writes pushed events as notifications on the output stream", async () => {
    const { PassThrough } = await import("node:stream");
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));

    const rpc = server();
    rpc.attach(input, output);
    rpc.pushEvent({
      seq: 1,
      runId: "run-1",
      timestamp: "2026-08-04T00:00:00.000Z",
      type: "agent.status",
      agentId: "a",
      status: "idle",
    });

    await new Promise((resolve) => setImmediate(resolve));

    const notification = JSON.parse(chunks.join("").trim());
    expect(notification.method).toBe("event");
    expect(notification.params.seq).toBe(1);
  });

  it("responds to requests arriving on the attached input stream", async () => {
    const { PassThrough } = await import("node:stream");
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));

    server().attach(input, output);
    input.write(`${JSON.stringify({ id: 9, method: "runtime.ping", params: {} })}\n`);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(JSON.parse(chunks.join("").trim()).id).toBe(9);
  });
});
