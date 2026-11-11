// Every rule the hand-written server enforces, exercised through handleRpc directly: no HTTP, no
// sockets. Each rejection case names the error code it must produce.
import { describe, expect, it } from 'vitest';
import type { RpcResponse } from '../../src/protocol/jsonrpc.js';
import { handleRpc } from '../../src/server-2026/handler.js';

const VERSION = '2026-07-28';

const meta = (version = VERSION) => ({
  _meta: {
    'io.modelcontextprotocol/protocolVersion': version,
    'io.modelcontextprotocol/clientCapabilities': {},
  },
});

// Node lowercases incoming header names, so the handler is given lowercase keys.
const headers = (method: string, version = VERSION, name?: string) => ({
  'mcp-protocol-version': version,
  'mcp-method': method,
  ...(name === undefined ? {} : { 'mcp-name': name }),
});

const send = (body: unknown, h: Record<string, string> = {}): RpcResponse =>
  handleRpc(h, JSON.stringify(body));

const errorOf = (r: RpcResponse) =>
  (r.body as { error: { code: number; message: string; data?: unknown } }).error;

const discover = (id: string | number, params?: unknown) => ({
  jsonrpc: '2.0',
  id,
  method: 'server/discover',
  ...(params === undefined ? {} : { params }),
});

describe('server/discover', () => {
  it('answers a valid request with versions, capabilities and cache fields', () => {
    const r = send(discover('d1', meta()), headers('server/discover'));

    expect(r.status).toBe(200);
    const result = (r.body as { result: Record<string, unknown> }).result;
    expect(result).toMatchObject({
      resultType: 'complete',
      supportedVersions: [VERSION],
      cacheScope: 'public',
    });
    expect(typeof result.ttlMs).toBe('number');
  });

  it('echoes the request id', () => {
    const r = send(discover('abc-123', meta()), headers('server/discover'));
    expect((r.body as { id: string }).id).toBe('abc-123');
  });
});

describe('malformed input', () => {
  it('rejects a body that is not JSON with -32700', () => {
    const r = handleRpc({}, 'not json');
    expect(r.status).toBe(400);
    expect(errorOf(r).code).toBe(-32700);
  });

  it.each([['null'], ['[]'], ['42'], ['"text"'], ['{}']])('rejects %s with -32600', (raw) => {
    const r = handleRpc({}, raw);
    expect(r.status).toBe(400);
    expect(errorOf(r).code).toBe(-32600);
  });

  it('rejects a request without jsonrpc "2.0" with -32600', () => {
    const r = send({ id: 1, method: 'server/discover' }, headers('server/discover'));
    expect(errorOf(r).code).toBe(-32600);
  });

  it('rejects a batch with -32600, because only a single request is accepted', () => {
    const r = send([discover(1, meta())], headers('server/discover'));
    expect(r.status).toBe(400);
    expect(errorOf(r).code).toBe(-32600);
  });

  // JSON can put any value where the envelope expects a string or a number. Such a request is
  // refused before any of its members is used, and the reply does not echo the id.
  it.each([
    ['a method that is an object', { jsonrpc: '2.0', id: 1, method: { toString: 1 } }],
    ['an id that is an object', { ...discover(1, meta()), id: { toString: 1 } }],
    ['an id that is a boolean', { ...discover(1, meta()), id: true }],
  ])('rejects %s with -32600 and a null id', (_, body) => {
    const r = send(body, headers('server/discover'));
    expect(r.status).toBe(400);
    expect(errorOf(r).code).toBe(-32600);
    expect((r.body as { id: unknown }).id).toBeNull();
    expect(r.method).toBeUndefined();
  });

  it('checks the envelope before anything else, so a broken initialize is -32600 too', () => {
    const r = send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
    expect(errorOf(r).code).toBe(-32600);
  });
});

describe('per-request rules', () => {
  it('rejects a missing MCP-Protocol-Version header with -32020', () => {
    const r = send(discover(2));
    expect(r.status).toBe(400);
    expect(errorOf(r)).toMatchObject({ code: -32020 });
    expect(errorOf(r).message).toContain('MCP-Protocol-Version header is missing');
  });

  it('rejects a missing _meta with -32602', () => {
    const r = send(discover(3), headers('server/discover'));
    expect(r.status).toBe(400);
    expect(errorOf(r).code).toBe(-32602);
  });

  it('rejects a header version that differs from _meta with -32020', () => {
    const r = send(discover(4, meta()), headers('server/discover', '2025-11-25'));
    expect(r.status).toBe(400);
    expect(errorOf(r).code).toBe(-32020);
  });

  it('rejects an unsupported version with -32022 and lists the supported ones', () => {
    const r = send(discover(5, meta('1900-01-01')), headers('server/discover', '1900-01-01'));
    expect(r.status).toBe(400);
    expect(errorOf(r)).toMatchObject({
      code: -32022,
      data: { supported: [VERSION], requested: '1900-01-01' },
    });
  });

  it('rejects a missing Mcp-Method header with -32020', () => {
    const r = send(discover(6, meta()), { 'mcp-protocol-version': VERSION });
    expect(r.status).toBe(400);
    expect(errorOf(r).code).toBe(-32020);
    expect(errorOf(r).message).toContain('Mcp-Method header is missing');
  });

  it('rejects an Mcp-Method header that differs from the body with -32020', () => {
    const r = send(discover(6, meta()), headers('tools/list'));
    expect(errorOf(r).code).toBe(-32020);
  });

  const toolCall = (name: unknown) => ({
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: { name, arguments: {}, ...meta() },
  });

  it('rejects tools/call without an Mcp-Name header with -32020', () => {
    const r = send(toolCall('bar'), headers('tools/call'));
    expect(r.status).toBe(400);
    expect(errorOf(r).code).toBe(-32020);
    expect(errorOf(r).message).toContain('Mcp-Name header is missing');
  });

  it('rejects an Mcp-Name header that differs from params.name with -32020', () => {
    const r = send(toolCall('bar'), headers('tools/call', VERSION, 'foo'));
    expect(errorOf(r).code).toBe(-32020);
  });

  it('rejects a params.name that is not a string with -32020', () => {
    const r = send(toolCall({ toString: 1 }), headers('tools/call', VERSION, 'foo'));
    expect(r.status).toBe(400);
    expect(errorOf(r).code).toBe(-32020);
  });

  it('rejects client capabilities that are not an object with -32602', () => {
    const params = {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': VERSION,
        'io.modelcontextprotocol/clientCapabilities': [],
      },
    };
    const r = send(discover(8, params), headers('server/discover'));
    expect(r.status).toBe(400);
    expect(errorOf(r).code).toBe(-32602);
  });

  it('attaches the method name to the reply, for the request log', () => {
    expect(send(discover(9, meta()), headers('server/discover')).method).toBe('server/discover');
    expect(send(discover(9)).method).toBe('server/discover');
    expect(handleRpc({}, 'not json').method).toBeUndefined();
  });
});

describe('removed and unknown methods', () => {
  it('answers initialize with -32022 and the supported versions', () => {
    const r = send({
      jsonrpc: '2.0',
      id: 9,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {} },
    });
    expect(r.status).toBe(400);
    expect(errorOf(r)).toMatchObject({
      code: -32022,
      data: { supported: [VERSION], requested: '2025-11-25' },
    });
  });

  it.each([
    ['no params', undefined],
    ['params that are not an object', 'text'],
    ['a version that is not a string', { protocolVersion: 20251125 }],
  ])('answers initialize with %s by reporting the requested version as null', (_, params) => {
    const r = send({
      jsonrpc: '2.0',
      id: 9,
      method: 'initialize',
      ...(params === undefined ? {} : { params }),
    });
    expect(errorOf(r)).toMatchObject({
      code: -32022,
      data: { supported: [VERSION], requested: null },
    });
  });

  it('answers an unknown method with 404 and -32601', () => {
    const body = { jsonrpc: '2.0', id: 8, method: 'does/not/exist', params: meta() };
    const r = send(body, headers('does/not/exist'));
    expect(r.status).toBe(404);
    expect(errorOf(r).code).toBe(-32601);
  });

  it('answers a method the spec defines but this server lacks with 404, once its headers are valid', () => {
    const body = {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'echo', arguments: {}, ...meta() },
    };
    const r = send(body, headers('tools/call', VERSION, 'echo'));
    expect(r.status).toBe(404);
    expect(errorOf(r).code).toBe(-32601);
  });
});
