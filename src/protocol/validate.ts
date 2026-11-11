/**
 * @file The per-request rules of the 2026-07-28 revision: required HTTP headers, required `_meta`
 * keys, and protocol-version support. Pure functions with no HTTP dependency, so every rule can
 * be tested directly. See docs/spec-2026-07-28.md for the source of each rule.
 */
import { ErrorCode } from './errors.js';
import { isRecord, type RpcRequest } from './jsonrpc.js';
import { META_CAPABILITIES_KEY, META_VERSION_KEY, SUPPORTED_VERSIONS } from './version.js';

/**
 * Incoming HTTP headers. Names must be lowercase, which is how Node's `IncomingMessage` exposes
 * them.
 */
export type HeaderBag = Record<string, string | string[] | undefined>;

/** Why a request was rejected: the HTTP status and JSON-RPC error to reply with. */
export type Failure = {
  /** The HTTP status code. */
  status: number;
  /** The JSON-RPC error code; see `ErrorCode`. */
  code: number;
  /** A short human-readable description. */
  message: string;
  /** Optional structured detail for the client. */
  data?: unknown;
};

/**
 * The methods that address one named thing, each mapped to the `params` member that names it.
 * Their requests must repeat that name in an `Mcp-Name` header. This is a `Map` rather than an
 * object so that a method called `constructor` or `toString` is not found on a prototype.
 */
const NAME_PARAM = new Map([
  ['tools/call', 'name'],
  ['prompts/get', 'name'],
  ['resources/read', 'uri'],
]);

/**
 * Builds the rejection for a header that is missing or contradicts the body.
 *
 * @param message - What is missing or what disagreed, without the common prefix.
 * @returns A `Failure` with HTTP 400 and the `HeaderMismatch` code.
 */
const headerMismatch = (message: string): Failure => ({
  status: 400,
  code: ErrorCode.HeaderMismatch,
  message: `Header mismatch: ${message}`,
});

/**
 * Checks a request against the per-request rules and reports the first one it breaks.
 *
 * The rules, in the order they are checked: the `MCP-Protocol-Version` header is present; the
 * `Mcp-Method` header is present and equals the body's method; for a method that addresses a
 * named thing, the `Mcp-Name` header is present and equals the name in the body; `_meta` carries
 * a version and capabilities; the header version equals the `_meta` version; and that version is
 * supported. The order is this implementation's choice, because the spec lists the rules without
 * a sequence.
 *
 * Values taken from the body are shown JSON-encoded in messages, because they are untrusted and
 * can be of any type.
 *
 * @param headers - The request's HTTP headers, with lowercase names.
 * @param request - The request, with its JSON-RPC envelope already checked.
 * @returns The first violation found, or `null` when the request is acceptable.
 */
export const validateRequest = (headers: HeaderBag, request: RpcRequest): Failure | null => {
  // params is untrusted: anything that is not a JSON object is treated as having no members.
  const params = isRecord(request.params) ? request.params : {};

  // The version header is required on every POST so a gateway can route without parsing the body.
  const headerVersion = headers['mcp-protocol-version'];
  if (typeof headerVersion !== 'string') {
    return headerMismatch('MCP-Protocol-Version header is missing');
  }

  // The method header must mirror the body, so the two cannot be made to disagree.
  const headerMethod = headers['mcp-method'];
  if (typeof headerMethod !== 'string') {
    return headerMismatch('Mcp-Method header is missing');
  }
  if (headerMethod !== request.method) {
    return headerMismatch(
      `Mcp-Method header ${JSON.stringify(headerMethod)} does not match body method ${JSON.stringify(request.method)}`,
    );
  }

  // A method that addresses a named tool, prompt or resource must repeat the name in a header.
  const nameParam = NAME_PARAM.get(request.method);
  if (nameParam !== undefined) {
    const headerName = headers['mcp-name'];
    if (typeof headerName !== 'string') {
      return headerMismatch('Mcp-Name header is missing');
    }
    const bodyName = params[nameParam];
    if (headerName !== bodyName) {
      return headerMismatch(
        `Mcp-Name header ${JSON.stringify(headerName)} does not match params.${nameParam} ${JSON.stringify(bodyName)}`,
      );
    }
  }

  // Both _meta keys are required. A missing one is a malformed request, not a version problem.
  const meta = isRecord(params._meta) ? params._meta : {};
  const metaVersion = meta[META_VERSION_KEY];
  const metaCapabilities = meta[META_CAPABILITIES_KEY];
  if (typeof metaVersion !== 'string' || !isRecord(metaCapabilities)) {
    return {
      status: 400,
      code: ErrorCode.InvalidParams,
      message: `Invalid params: _meta must carry ${META_VERSION_KEY} and ${META_CAPABILITIES_KEY}`,
    };
  }

  // The header and _meta state the same version twice; they must agree.
  if (headerVersion !== metaVersion) {
    return headerMismatch(
      `MCP-Protocol-Version header ${JSON.stringify(headerVersion)} does not match _meta ${JSON.stringify(metaVersion)}`,
    );
  }

  // Well-formed, but a version this server does not speak. The reply lists the ones it does.
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
