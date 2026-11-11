/**
 * @file The `server/discover` result. In this revision it replaces the `initialize` handshake:
 * a client asks once what the server supports instead of negotiating a session.
 */
import { META_SERVER_INFO_KEY, SUPPORTED_VERSIONS } from './version.js';

/**
 * Builds the result of a `server/discover` request.
 *
 * `capabilities` is empty because the server implements no capability yet. `ttlMs` and
 * `cacheScope` tell a client how long it may reuse this answer, and whether a shared cache may
 * store it.
 *
 * @returns The `result` member for a `server/discover` reply.
 */
export const discoverResult = () => ({
  resultType: 'complete',
  supportedVersions: SUPPORTED_VERSIONS,
  capabilities: {},
  _meta: {
    [META_SERVER_INFO_KEY]: { name: 'toy-marketplace-2026', version: '0.1.0' },
  },
  instructions: 'Hand-written MCP server for the 2026-07-28 revision.',
  ttlMs: 3_600_000,
  cacheScope: 'public',
});
