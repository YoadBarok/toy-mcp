// HTTP-level behavior of the hand-written server (status codes, headers, content type, the request
// log, and surviving bad clients), over a real socket on a random port. The protocol rules
// themselves are covered in handler.test.ts.
import { connect, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobStore } from '../../src/catalog/jobs.js';
import { createHttpServer } from '../../src/server-2026/http.js';

const logLines: string[] = [];
const server = createHttpServer(new JobStore(60_000), (line) => logLines.push(line));
let url = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  logLines.length = 0;
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

const discoverHeaders = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  'MCP-Protocol-Version': '2026-07-28',
  'Mcp-Method': 'server/discover',
};

const discover = () => fetch(url, { method: 'POST', headers: discoverHeaders, body: discoverBody });

describe('HTTP transport', () => {
  it('serves server/discover as JSON over POST', async () => {
    const res = await discover();

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

describe('request log', () => {
  it('writes one line per request: the method, the status, and the error if there was one', async () => {
    await discover();
    await fetch(url, { method: 'POST', body: discoverBody });
    await fetch(url, { method: 'POST', body: 'not json' });

    expect(logLines).toEqual([
      'server/discover -> 200',
      'server/discover -> 400 -32020 Header mismatch: MCP-Protocol-Version header is missing',
      '(unparsed) -> 400 -32700 Parse error',
    ]);
  });
});

// An error that escapes the async request listener is an unhandled rejection, which ends a Node
// process. These cases each used to be one, so every test also checks that none was raised.
describe('bad clients', () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);

  beforeEach(() => {
    rejections.length = 0;
    process.on('unhandledRejection', onRejection);
    return () => {
      process.off('unhandledRejection', onRejection);
    };
  });

  it('answers a method that is not a string with 400 and -32600', async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: discoverHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: { toString: 1 } }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { id: unknown; error: { code: number } };
    expect(json).toMatchObject({ id: null, error: { code: -32600 } });
    expect(logLines).toEqual(['(unparsed) -> 400 -32600 Invalid Request']);
    expect(rejections).toEqual([]);
  });

  it('keeps serving after a client disconnects in the middle of the body', async () => {
    const { port } = server.address() as AddressInfo;
    const serverSideClosed = new Promise<void>((resolve) => {
      server.once('request', (req) => req.socket.once('close', () => resolve()));
    });

    // Announce 500 bytes, send 11, and drop the connection once the server has the request.
    const client = connect(port, '127.0.0.1', () => {
      client.write(
        'POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n' +
          'Content-Length: 500\r\n\r\n{"jsonrpc":',
      );
    });
    client.on('error', () => {});
    server.once('request', () => client.destroy());
    await serverSideClosed;

    expect((await discover()).status).toBe(200);
    expect(rejections).toEqual([]);
    // Nobody was left to answer, so the dropped request is not logged.
    expect(logLines).toEqual(['server/discover -> 200']);
  });
});
