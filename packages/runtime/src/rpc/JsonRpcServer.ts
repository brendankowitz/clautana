import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { RuntimeEvent } from "@clautana/protocol";
import {
  RPC_ERROR_INTERNAL,
  RPC_ERROR_INVALID_PARAMS,
  RPC_ERROR_METHOD_NOT_FOUND,
} from "@clautana/protocol";
import { InvalidParamsError } from "./errors.js";

export type RpcHandler = (params: unknown) => Promise<unknown>;

/**
 * Line-delimited JSON-RPC over a stdio pair.
 *
 * A handler failure must never kill the runtime: everything is converted into
 * an error response so the supervising shell sees a live process with a failed
 * call rather than a dead sidecar.
 */
export class JsonRpcServer {
  private output?: Writable;

  constructor(private readonly handlers: Record<string, RpcHandler>) {}

  attach(input: Readable, output: Writable): void {
    this.output = output;
    const lines = createInterface({ input, crlfDelay: Infinity });
    lines.on("line", (line) => {
      void this.handleLine(line).then((response) => {
        if (response !== undefined) {
          this.write(response);
        }
      });
    });
  }

  pushEvent(event: RuntimeEvent): void {
    this.write(JSON.stringify({ method: "event", params: event }));
  }

  async handleLine(line: string): Promise<string | undefined> {
    if (line.trim() === "") {
      return undefined;
    }

    let request: { id?: unknown; method?: unknown; params?: unknown };
    try {
      request = JSON.parse(line) as { id?: unknown; method?: unknown; params?: unknown };
    } catch (error) {
      return JsonRpcServer.errorResponse(-1, RPC_ERROR_INTERNAL, `Malformed request: ${String(error)}`);
    }

    const id = typeof request.id === "number" ? request.id : -1;
    const method = typeof request.method === "string" ? request.method : "";
    const handler = this.handlers[method];

    if (!handler) {
      return JsonRpcServer.errorResponse(id, RPC_ERROR_METHOD_NOT_FOUND, `Unknown method: ${method}`);
    }

    try {
      const result = await handler(request.params);
      return JSON.stringify({ id, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof InvalidParamsError ? RPC_ERROR_INVALID_PARAMS : RPC_ERROR_INTERNAL;
      return JsonRpcServer.errorResponse(id, code, message);
    }
  }

  private write(payload: string): void {
    this.output?.write(`${payload}\n`);
  }

  private static errorResponse(id: number, code: number, message: string): string {
    return JSON.stringify({ id, error: { code, message } });
  }
}
