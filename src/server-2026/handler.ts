import { discoverResult } from '../protocol/discover.js';
import { ErrorCode } from '../protocol/errors.js';
import { fail, ok, type RpcBody, type RpcResponse } from '../protocol/jsonrpc.js';
import { validateRequest, type HeaderBag } from '../protocol/validate.js';
import { SUPPORTED_VERSIONS } from '../protocol/version.js';

export const handleRpc = (headers: HeaderBag, rawBody: string): RpcResponse => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return fail(400, null, ErrorCode.ParseError, 'Parse error');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail(400, null, ErrorCode.InvalidRequest, 'Invalid Request');
  }

  const body = parsed as RpcBody;
  const id = body.id ?? null;
  const withMethod = (response: RpcResponse): RpcResponse => ({ ...response, method: body.method });

  if (body.method === 'initialize') {
    return withMethod(
      fail(400, id, ErrorCode.UnsupportedProtocolVersion, 'Unsupported protocol version', {
        supported: SUPPORTED_VERSIONS,
        requested: body.params?.protocolVersion ?? null,
      }),
    );
  }

  const failure = validateRequest(headers, body);
  if (failure) {
    return withMethod(fail(failure.status, id, failure.code, failure.message, failure.data));
  }

  switch (body.method) {
    case 'server/discover':
      return withMethod(ok(id, discoverResult()));
    default:
      return withMethod(
        fail(404, id, ErrorCode.MethodNotFound, `Method not found: ${body.method}`),
      );
  }
};
