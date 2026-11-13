/**
 * @file The request handler of the hand-written 2026-07-28 server: parse the body, check the
 * JSON-RPC envelope, apply the per-request rules, dispatch by method. It returns an `RpcResponse`
 * instead of writing to a socket, so the whole flow can be exercised without a network (see
 * http.ts for the transport).
 */
import { discoverResult } from '../protocol/discover.js';
import { ErrorCode } from '../protocol/errors.js';
import { fail, isRecord, isRpcRequest, ok, type RpcResponse } from '../protocol/jsonrpc.js';
import { validateRequest, type HeaderBag } from '../protocol/validate.js';
import { SUPPORTED_VERSIONS } from '../protocol/version.js';
import { callTool, listToolsResult } from './tools.js';

/**
 * Handles one POST to the MCP endpoint.
 *
 * `server/discover`, `tools/list` and `tools/call` are implemented. `initialize` gets a version
 * error that lists the supported versions, and every other method gets `404` with `-32601`.
 *
 * @param headers - The request's HTTP headers, with lowercase names.
 * @param rawBody - The request body, unparsed.
 * @returns The reply and the HTTP status to send it with.
 */
export const handleRpc = (headers: HeaderBag, rawBody: string): RpcResponse => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return fail(400, null, ErrorCode.ParseError, 'Parse error');
  }
  // Only a single JSON-RPC 2.0 request is accepted: no batch, no bare value, no broken envelope.
  // The reply carries a null id, because a body that failed this check cannot be trusted to have
  // a usable one.
  if (!isRpcRequest(parsed)) {
    return fail(400, null, ErrorCode.InvalidRequest, 'Invalid Request');
  }

  const { method, params } = parsed;
  const id = parsed.id ?? null;
  // Attach the method name so the transport can log it.
  const withMethod = (response: RpcResponse): RpcResponse => ({ ...response, method });

  // The handshake was removed in this revision. Answer an old client with the versions this
  // server speaks, since the spec says a modern-only server SHOULD name them in errors to it.
  // This comes before the per-request rules because an old client sends none of the new headers.
  if (method === 'initialize') {
    const requested =
      isRecord(params) && typeof params.protocolVersion === 'string'
        ? params.protocolVersion
        : null;
    return withMethod(
      fail(400, id, ErrorCode.UnsupportedProtocolVersion, 'Unsupported protocol version', {
        supported: SUPPORTED_VERSIONS,
        requested,
      }),
    );
  }

  const failure = validateRequest(headers, parsed);
  if (failure) {
    return withMethod(fail(failure.status, id, failure.code, failure.message, failure.data));
  }

  // Every method not listed here is unknown, including ones the spec removed.
  switch (method) {
    case 'server/discover':
      return withMethod(ok(id, discoverResult()));
    case 'tools/list':
      return withMethod(ok(id, listToolsResult()));
    case 'tools/call': {
      const outcome = callTool(params);
      return withMethod(
        outcome.ok
          ? ok(id, outcome.result)
          : fail(outcome.status, id, outcome.code, outcome.message, outcome.data),
      );
    }
    default:
      return withMethod(fail(404, id, ErrorCode.MethodNotFound, `Method not found: ${method}`));
  }
};
