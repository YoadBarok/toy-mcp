import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpServer } from '../../src/server-2026/http.js';

const server = createHttpServer();
let url = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});

afterAll(() => {
  server.close();
});

const discoverBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'server/discover',
  params: {
    _meta: {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  },
});

describe('HTTP transport', () => {
  it('serves server/discover as JSON over POST', async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'server/discover',
      },
      body: discoverBody,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('mcp-session-id')).toBeNull();
    const json = (await res.json()) as { result: { supportedVersions: string[] } };
    expect(json.result.supportedVersions).toEqual(['2026-07-28']);
  });

  it('rejects a request without the protocol headers with 400', async () => {
    const res = await fetch(url, { method: 'POST', body: discoverBody });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: number } };
    expect(json.error.code).toBe(-32020);
  });

  it('answers GET with 405 and an Allow header', async () => {
    const res = await fetch(url);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('answers an unknown path with 404', async () => {
    const res = await fetch(url.replace('/mcp', '/other'), { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
