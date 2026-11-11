/**
 * @file The JSON-RPC and MCP error codes the hand-written server returns. See
 * docs/spec-2026-07-28.md for when each one applies.
 */

/**
 * Error codes returned in the `error.code` member of a JSON-RPC reply. `-32700`, `-32600`,
 * `-32601` and `-32602` are standard JSON-RPC; `-32020` and `-32022` are defined by MCP, which
 * reserves the range `-32020` to `-32099` for the specification.
 */
export const ErrorCode = {
  /** The request body is not valid JSON. */
  ParseError: -32700,
  /** The body is JSON but not a JSON-RPC request. */
  InvalidRequest: -32600,
  /** The method is unknown, or was removed in this revision. */
  MethodNotFound: -32601,
  /** A required field is missing, such as a required `_meta` key. */
  InvalidParams: -32602,
  /** An HTTP header is missing or contradicts the request body. */
  HeaderMismatch: -32020,
  /** The request is well-formed but names a protocol revision the server does not speak. */
  UnsupportedProtocolVersion: -32022,
} as const;
