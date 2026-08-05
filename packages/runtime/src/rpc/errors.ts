/**
 * Thrown by handler param validation (e.g. `requireString`) to signal that the
 * request itself was malformed - the caller's bug, not the runtime's. The
 * dispatcher in `JsonRpcServer` maps this to `RPC_ERROR_INVALID_PARAMS` rather
 * than `RPC_ERROR_INTERNAL`, so a client can tell "retrying won't help, fix
 * your request" apart from "the runtime broke, maybe transient".
 *
 * Lives in its own module, separate from both `handlers.ts` and
 * `JsonRpcServer.ts`, so each can import it without creating a cycle:
 * `handlers.ts` already imports `RpcHandler` from `JsonRpcServer.ts`.
 */
export class InvalidParamsError extends Error {}
