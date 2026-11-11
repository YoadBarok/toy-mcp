// The JSON-RPC envelope: which parsed values count as a request, and the shape of the two kinds
// of reply.
import { describe, expect, it } from 'vitest';
import { fail, isRecord, isRpcRequest, ok } from '../../src/protocol/jsonrpc.js';

describe('isRecord', () => {
  it('accepts a JSON object', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', [{ a: 1 }]],
    ['a string', 'text'],
    ['a number', 42],
    ['a boolean', true],
    ['undefined', undefined],
  ])('rejects %s', (_, value) => {
    expect(isRecord(value)).toBe(false);
  });
});

describe('isRpcRequest', () => {
  const request = { jsonrpc: '2.0', id: 1, method: 'server/discover' };

  it.each([
    ['a string', 'abc'],
    ['a number', 7],
    ['null', null],
  ])('accepts an id that is %s', (_, id) => {
    expect(isRpcRequest({ ...request, id })).toBe(true);
  });

  it('accepts a request without an id', () => {
    expect(isRpcRequest({ jsonrpc: '2.0', method: 'server/discover' })).toBe(true);
  });

  it('does not inspect params', () => {
    expect(isRpcRequest({ ...request, params: 'anything' })).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array of requests', [request]],
    ['a string', 'server/discover'],
    ['a number', 42],
    ['an empty object', {}],
    ['a missing jsonrpc', { id: 1, method: 'server/discover' }],
    ['a jsonrpc other than "2.0"', { ...request, jsonrpc: '1.0' }],
    ['a missing method', { jsonrpc: '2.0', id: 1 }],
    ['a method that is an object', { ...request, method: { toString: 1 } }],
    ['an id that is an object', { ...request, id: { toString: 1 } }],
    ['an id that is an array', { ...request, id: [1] }],
    ['an id that is a boolean', { ...request, id: true }],
  ])('rejects %s', (_, value) => {
    expect(isRpcRequest(value)).toBe(false);
  });
});

describe('reply builders', () => {
  it('ok builds a result reply with status 200', () => {
    expect(ok('a', { x: 1 })).toEqual({
      status: 200,
      body: { jsonrpc: '2.0', id: 'a', result: { x: 1 } },
    });
  });

  it('fail builds an error reply and leaves data out when there is none', () => {
    expect(fail(400, null, -32600, 'Invalid Request')).toEqual({
      status: 400,
      body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } },
    });
  });

  it('fail includes data when it is given', () => {
    const reply = fail(400, 1, -32022, 'Unsupported protocol version', { supported: ['x'] });
    expect(reply.body).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['x'] } },
    });
  });
});
