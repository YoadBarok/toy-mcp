import { ErrorCode } from './errors.js';
import type { RpcBody } from './jsonrpc.js';
import { META_CAPABILITIES_KEY, META_VERSION_KEY, SUPPORTED_VERSIONS } from './version.js';

export type HeaderBag = Record<string, string | string[] | undefined>;

export type Failure = {
  status: number;
  code: number;
  message: string;
  data?: unknown;
};

const NAME_REQUIRED = new Set(['tools/call', 'resources/read', 'prompts/get']);

const headerMismatch = (message: string): Failure => ({
  status: 400,
  code: ErrorCode.HeaderMismatch,
  message: `Header mismatch: ${message}`,
});

// The order of checks is this implementation's choice; the spec lists the rules, not a sequence.
export const validateRequest = (headers: HeaderBag, body: RpcBody): Failure | null => {
  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return { status: 400, code: ErrorCode.InvalidRequest, message: 'Invalid Request' };
  }

  const headerVersion = headers['mcp-protocol-version'];
  if (typeof headerVersion !== 'string') {
    return headerMismatch('MCP-Protocol-Version header is missing');
  }

  const headerMethod = headers['mcp-method'];
  if (headerMethod !== body.method) {
    return headerMismatch(
      `Mcp-Method header '${String(headerMethod)}' does not match body '${body.method}'`,
    );
  }

  if (NAME_REQUIRED.has(body.method)) {
    const headerName = headers['mcp-name'];
    const bodyName = body.params?.name ?? body.params?.uri;
    if (headerName !== bodyName) {
      return headerMismatch(
        `Mcp-Name header '${String(headerName)}' does not match body '${String(bodyName)}'`,
      );
    }
  }

  const meta = body.params?._meta;
  const metaVersion = meta?.[META_VERSION_KEY];
  const metaCapabilities = meta?.[META_CAPABILITIES_KEY];
  if (
    typeof metaVersion !== 'string' ||
    typeof metaCapabilities !== 'object' ||
    metaCapabilities === null
  ) {
    return {
      status: 400,
      code: ErrorCode.InvalidParams,
      message: `Invalid params: _meta must carry ${META_VERSION_KEY} and ${META_CAPABILITIES_KEY}`,
    };
  }

  if (headerVersion !== metaVersion) {
    return headerMismatch(
      `MCP-Protocol-Version header '${headerVersion}' does not match _meta '${metaVersion}'`,
    );
  }

  if (!SUPPORTED_VERSIONS.includes(metaVersion)) {
    return {
      status: 400,
      code: ErrorCode.UnsupportedProtocolVersion,
      message: 'Unsupported protocol version',
      data: { supported: SUPPORTED_VERSIONS, requested: metaVersion },
    };
  }

  return null;
};
