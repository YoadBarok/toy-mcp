/**
 * @file The JSON-RPC 2.0 envelope: the shape of an incoming request, the checks that turn
 * untrusted JSON into one, and builders for the two kinds of reply. Nothing here knows about HTTP
 * or about any specific MCP method.
 */

/** A JSON-RPC request id. `null` is used in an error reply when the request's id was unreadable. */
export type RpcId = string | number | null;

/**
 * An incoming JSON-RPC request whose envelope has passed `isRpcRequest`. `params` stays `unknown`
 * because it is still untrusted input: each rule narrows the part it reads before using it.
 */
export type RpcRequest = {
  /** The JSON-RPC version marker. */
  jsonrpc: '2.0';
  /** Echoed back in the reply so the caller can match it to the request. */
  id?: RpcId;
  /** The method being called, such as `server/discover`. */
  method: string;
  /** The method's parameters, including the per-request `_meta`. Not validated by the envelope. */
  params?: unknown;
};

/**
 * A JSON-RPC reply together with the HTTP status to send it with. Handlers return this instead of
 * writing to a socket, which keeps the protocol logic testable without a network.
 */
export type RpcResponse = {
  /** The HTTP status code. */
  status: number;
  /** The JSON-RPC message to serialize as the response body. */
  body: unknown;
  /** The request's method name, set once the envelope was accepted; used for logging. */
  method?: string;
};

/**
 * Tells whether a parsed JSON value is a JSON object, as opposed to `null`, an array or a
 * primitive.
 *
 * @param value - Any value, typically the output of `JSON.parse`.
 * @returns `true` if `value` is an object whose members can be read by name.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Tells whether a parsed JSON value is a JSON-RPC 2.0 request: an object with `jsonrpc: "2.0"`, a
 * string `method`, and an `id` that is a string, a number, `null` or absent.
 *
 * @param value - Any value, typically the output of `JSON.parse`.
 * @returns `true` if the envelope is valid. `params` is not inspected.
 */
export const isRpcRequest = (value: unknown): value is RpcRequest =>
  isRecord(value) &&
  value.jsonrpc === '2.0' &&
  typeof value.method === 'string' &&
  (value.id === undefined ||
    value.id === null ||
    typeof value.id === 'string' ||
    typeof value.id === 'number');

/**
 * Builds a successful JSON-RPC reply.
 *
 * @param id - The id of the request being answered.
 * @param result - The value for the `result` member.
 * @returns A reply with HTTP status 200.
 */
export const ok = (id: RpcId, result: unknown): RpcResponse => ({
  status: 200,
  body: { jsonrpc: '2.0', id, result },
});

/**
 * Builds a JSON-RPC error reply.
 *
 * @param status - The HTTP status to send. The spec ties some error codes to a status.
 * @param id - The id of the request being answered, or `null` if it could not be read.
 * @param code - The JSON-RPC error code; see `ErrorCode`.
 * @param message - A short human-readable description.
 * @param data - Optional structured detail, omitted from the reply when `undefined`.
 * @returns A reply carrying an `error` member instead of a `result`.
 */
export const fail = (
  status: number,
  id: RpcId,
  code: number,
  message: string,
  data?: unknown,
): RpcResponse => ({
  status,
  body: {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  },
});
