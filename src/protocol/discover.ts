import { META_SERVER_INFO_KEY, SUPPORTED_VERSIONS } from './version.js';

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
