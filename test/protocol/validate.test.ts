// The per-request rules, each exercised directly through validateRequest. The JSON-RPC envelope
// is taken as valid here; handler.test.ts covers how the rules combine with parsing and dispatch.
import { describe, expect, it } from 'vitest';
import type { RpcRequest } from '../../src/protocol/jsonrpc.js';
import { validateRequest } from '../../src/protocol/validate.js';

const VERSION = '2026-07-28';
const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';
const META = { [VERSION_KEY]: VERSION, [CAPABILITIES_KEY]: {} };

const request = (method: string, params: unknown = { _meta: META }): RpcRequest => ({
  jsonrpc: '2.0',
  id: 1,
  method,
  params,
});

// Node lowercases incoming header names, so the rules are given lowercase keys.
const headers = (method: string, name?: string) => ({
  'mcp-protocol-version': VERSION,
  'mcp-method': method,
  ...(name === undefined ? {} : { 'mcp-name': name }),
});

describe('a request that satisfies every rule', () => {
  it('is accepted', () => {
    expect(validateRequest(headers('server/discover'), request('server/discover'))).toBeNull();
  });

  it.each([
    ['tools/call', 'name'],
    ['prompts/get', 'name'],
    ['resources/read', 'uri'],
  ])('is accepted for %s when Mcp-Name equals params.%s', (method, key) => {
    const params = { [key]: 'the-thing', _meta: META };
    expect(validateRequest(headers(method, 'the-thing'), request(method, params))).toBeNull();
  });
});

describe('required headers', () => {
  it('rejects a missing MCP-Protocol-Version header with -32020', () => {
    const failure = validateRequest(
      { 'mcp-method': 'server/discover' },
      request('server/discover'),
    );
    expect(failure).toMatchObject({ status: 400, code: -32020 });
    expect(failure?.message).toContain('MCP-Protocol-Version header is missing');
  });

  it('rejects a missing Mcp-Method header with -32020', () => {
    const failure = validateRequest(
      { 'mcp-protocol-version': VERSION },
      request('server/discover'),
    );
    expect(failure).toMatchObject({ status: 400, code: -32020 });
    expect(failure?.message).toContain('Mcp-Method header is missing');
  });

  it('rejects an Mcp-Method header that differs from the body, naming both values', () => {
    const failure = validateRequest(headers('tools/list'), request('server/discover'));
    expect(failure).toMatchObject({ status: 400, code: -32020 });
    expect(failure?.message).toContain('"tools/list"');
    expect(failure?.message).toContain('"server/discover"');
  });
});

describe('Mcp-Name', () => {
  it.each([['tools/call'], ['prompts/get'], ['resources/read']])('is required on %s', (method) => {
    const params = { name: 'x', uri: 'x', _meta: META };
    const failure = validateRequest(headers(method), request(method, params));
    expect(failure).toMatchObject({ status: 400, code: -32020 });
    expect(failure?.message).toContain('Mcp-Name header is missing');
  });

  it('must equal params.name on tools/call', () => {
    const params = { name: 'bar', arguments: {}, _meta: META };
    const failure = validateRequest(headers('tools/call', 'foo'), request('tools/call', params));
    expect(failure).toMatchObject({ status: 400, code: -32020 });
    expect(failure?.message).toContain('"foo"');
    expect(failure?.message).toContain('"bar"');
  });

  it('is compared with params.uri on resources/read, even when params.name is also present', () => {
    const params = { name: 'the-name', uri: 'file:///the-uri', _meta: META };
    const read = (name: string) =>
      validateRequest(headers('resources/read', name), request('resources/read', params));

    expect(read('the-name')).toMatchObject({ code: -32020 });
    expect(read('file:///the-uri')).toBeNull();
  });

  it('is a mismatch when the body carries no name at all', () => {
    const failure = validateRequest(
      headers('tools/call', 'foo'),
      request('tools/call', { _meta: META }),
    );
    expect(failure).toMatchObject({ status: 400, code: -32020 });
  });

  it.each([
    ['an object', { toString: 1 }],
    ['an array', ['foo']],
    ['a number', 7],
    ['null', null],
  ])('is a mismatch, not a crash, when params.name is %s', (_, name) => {
    const failure = validateRequest(
      headers('tools/call', 'foo'),
      request('tools/call', { name, _meta: META }),
    );
    expect(failure).toMatchObject({ status: 400, code: -32020 });
  });

  it.each([['constructor'], ['__proto__'], ['toString'], ['hasOwnProperty']])(
    'is not required on a method that is called %s',
    (method) => {
      expect(validateRequest(headers(method), request(method))).toBeNull();
    },
  );
});

describe('_meta', () => {
  it.each([
    ['params are missing', undefined],
    ['params are null', null],
    ['params are an array', [{ _meta: META }]],
    ['params are a string', 'text'],
    ['_meta is missing', {}],
    ['_meta is not an object', { _meta: 'text' }],
    ['the version is missing', { _meta: { [CAPABILITIES_KEY]: {} } }],
    ['the version is not a string', { _meta: { ...META, [VERSION_KEY]: 20260728 } }],
    ['the capabilities are missing', { _meta: { [VERSION_KEY]: VERSION } }],
    ['the capabilities are null', { _meta: { ...META, [CAPABILITIES_KEY]: null } }],
    ['the capabilities are an array', { _meta: { ...META, [CAPABILITIES_KEY]: [] } }],
    ['the capabilities are a string', { _meta: { ...META, [CAPABILITIES_KEY]: 'none' } }],
  ])('is rejected with -32602 when %s', (_, params) => {
    const failure = validateRequest(
      headers('server/discover'),
      // Built by hand so that `params` can be left out entirely.
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'server/discover',
        ...(params === undefined ? {} : { params }),
      },
    );
    expect(failure).toMatchObject({ status: 400, code: -32602 });
  });
});

describe('protocol version', () => {
  it('rejects a header version that differs from _meta with -32020', () => {
    const failure = validateRequest(
      { ...headers('server/discover'), 'mcp-protocol-version': '2025-11-25' },
      request('server/discover'),
    );
    expect(failure).toMatchObject({ status: 400, code: -32020 });
    expect(failure?.message).toContain('"2025-11-25"');
    expect(failure?.message).toContain(`"${VERSION}"`);
  });

  it('rejects a version the server does not speak with -32022 and lists the ones it does', () => {
    const old = '1900-01-01';
    const failure = validateRequest(
      { ...headers('server/discover'), 'mcp-protocol-version': old },
      request('server/discover', { _meta: { ...META, [VERSION_KEY]: old } }),
    );
    expect(failure).toEqual({
      status: 400,
      code: -32022,
      message: 'Unsupported protocol version',
      data: { supported: [VERSION], requested: old },
    });
  });
});

describe('rule order', () => {
  it('reports a missing header before a missing _meta', () => {
    const failure = validateRequest({}, request('server/discover', {}));
    expect(failure).toMatchObject({ code: -32020 });
  });

  it('reports a missing _meta before an unsupported version', () => {
    const failure = validateRequest(
      { ...headers('server/discover'), 'mcp-protocol-version': '1900-01-01' },
      request('server/discover', {}),
    );
    expect(failure).toMatchObject({ code: -32602 });
  });
});
