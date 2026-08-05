import { isRuntimeEvent, type RuntimeEvent } from "@clautana/protocol";

export type Invoker = (
  command: string,
  args: Record<string, unknown>,
) => Promise<string>;

/**
 * Thrown by `RpcClient.call` on an error response, carrying the JSON-RPC
 * error code alongside the message. `RPC_ERROR_INVALID_PARAMS` means the
 * caller sent something wrong (bad params, unknown id); `RPC_ERROR_INTERNAL`
 * means the server broke. Callers are expected to handle the two
 * differently, so the code must survive past `call()` rather than being
 * flattened into a plain `Error`.
 */
export class RpcCallError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "RpcCallError";
  }
}

/**
 * UI-side JSON-RPC client. Rust assigns request ids and correlates responses,
 * so this only shapes the payload and unwraps the result.
 */
export class RpcClient {
  constructor(private readonly invoke: Invoker) {}

  async call<T>(method: string, params: unknown): Promise<T> {
    const raw = await this.invoke("rpc_call", {
      payload: JSON.stringify({ method, params }),
    });
    const response = JSON.parse(raw) as {
      result?: T;
      error?: { code: number; message: string };
    };
    if (response.error) {
      throw new RpcCallError(response.error.code, response.error.message);
    }
    return response.result as T;
  }

  handleNotification(line: string): RuntimeEvent | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return undefined;
    }
    const message = parsed as { method?: unknown; params?: unknown };
    if (message.method !== "event" || !isRuntimeEvent(message.params)) {
      return undefined;
    }
    return message.params;
  }
}
