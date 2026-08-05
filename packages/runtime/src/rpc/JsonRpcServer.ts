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

    // An unhandled 'error' event on an EventEmitter throws by default and
    // kills the process - exactly the failure mode this layer exists to
    // prevent. A broken pipe (the Rust shell dying, stdout closing) fires
    // this on stdio streams, so both ends need a listener that just logs.
    input.on("error", (error: unknown) => {
      console.error("[rpc] input stream error:", error);
    });
    output.on("error", (error: unknown) => {
      console.error("[rpc] output stream error:", error);
    });

    const lines = createInterface({ input, crlfDelay: Infinity });
    // readline's Interface proxies its input stream's 'error' event onto
    // itself (`input.on('error', ...)` internally re-emits on `lines`), so
    // without this listener an input error throws twice: once caught above,
    // and once more - unhandled - from `lines` itself.
    lines.on("error", (error: unknown) => {
      console.error("[rpc] readline interface error:", error);
    });
    lines.on("line", (line) => {
      void this.handleLine(line)
        .then((response) => {
          if (response !== undefined) {
            this.write(response);
          }
        })
        .catch((error: unknown) => {
          // handleLine() already converts handler failures into error
          // responses, so this only fires for something outside that
          // contract - e.g. write() throwing synchronously because the
          // output stream has already ended. Without this .catch, that
          // becomes an unhandled rejection and takes the process down.
          console.error("[rpc] failed to handle request line:", error);
        });
    });
  }

  /**
   * Precondition: has no effect until attach() has been called at least
   * once, since there is nowhere to write to before then. Pushing an event
   * before attach() silently no-ops rather than buffering or throwing.
   */
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
