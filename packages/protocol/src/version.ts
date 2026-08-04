/**
 * Bumped whenever the shape of RuntimeEvent or the RPC method set changes.
 * The sidecar reports this from `runtime.ping`; clients refuse to proceed on
 * a major mismatch rather than failing mysteriously later.
 */
export const PROTOCOL_VERSION = "1.0.0";
