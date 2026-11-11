// End-to-end tests of the SDK-based server over HTTP, on a random port. They pin down the
// behaviors the documentation describes: protocol ceiling, stateless mode, the five tools, tool
// errors, the transport's guards and the request log.
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobStore } from '../../src/catalog/jobs.js';
import { createHttpServer } from '../../src/sdk-server/http.js';

const logLines: string[] = [];
// A job stays `running` for a minute here, so its state is predictable for the whole run.
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

const post = (body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });

// The SDK answers with an SSE frame; the JSON-RPC message is on the `data:` line.
const rpc = async (body: unknown) => {
  const text = await (await post(body)).text();
  const line = text.split('\n').find((l) => l.startsWith('data: '));
  if (!line) throw new Error(`no data line in: ${text}`);
  return JSON.parse(line.slice('data: '.length)) as {
    result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] };
    error?: { code: number };
  };
};

const toolCall = (name: string, args: unknown, id = 1) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args },
});

// Calls a tool and returns the text of its result, plus whether it was flagged as an error.
const callTool = async (name: string, args: unknown) => {
  const reply = await rpc(toolCall(name, args));
  return {
    text: reply.result?.content?.[0]?.text ?? '',
    isError: reply.result?.isError === true,
  };
};

describe('SDK server', () => {
  it('negotiates the 2025-11-25 protocol and issues no session id', async () => {
    const res = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      },
    });

    expect(res.headers.get('mcp-session-id')).toBeNull();
    expect(await res.text()).toContain('"protocolVersion":"2025-11-25"');
  });

  it('lists its five tools without a prior initialize', async () => {
    const reply = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(reply.result?.tools?.map((t) => t.name)).toEqual([
      'echo',
      'search_catalog',
      'call_item',
      'start_job',
      'get_result',
    ]);
  });

  it('answers server/discover with -32601, because v1 of the SDK does not implement it', async () => {
    const reply = await rpc({ jsonrpc: '2.0', id: 3, method: 'server/discover' });
    expect(reply.error?.code).toBe(-32601);
  });
});

describe('tools', () => {
  it('echo returns the text unchanged', async () => {
    expect(await callTool('echo', { text: 'hello' })).toEqual({ text: 'hello', isError: false });
  });

  it('echo with a wrong type is a tool error that names the field', async () => {
    const { text, isError } = await callTool('echo', { text: 5 });
    expect(isError).toBe(true);
    expect(text).toContain('at text');
  });

  it('an unknown tool is a tool error, not a JSON-RPC error', async () => {
    const { text, isError } = await callTool('nope', {});
    expect(isError).toBe(true);
    expect(text).toContain('Tool nope not found');
  });

  it('search_catalog returns the matching items with price and input fields', async () => {
    const { text, isError } = await callTool('search_catalog', { query: 'hacker' });
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual([
      {
        name: 'demo/hn-top',
        description: 'Top Hacker News stories',
        priceUsd: 0.0002,
        inputFields: ['mode', 'maxResults'],
      },
    ]);
  });

  it('call_item runs an item with defaults applied and reports the charge', async () => {
    const { text, isError } = await callTool('call_item', {
      item: 'demo/hn-top',
      input: { mode: 'top' },
    });
    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual({
      item: 'demo/hn-top',
      ranWith: { mode: 'top', maxResults: 10 },
      chargedUsd: 0.0002,
    });
  });

  it('call_item names every failing field when the input is invalid', async () => {
    const { text, isError } = await callTool('call_item', {
      item: 'demo/hn-top',
      input: { mode: 'trending', maxResults: 500 },
    });
    expect(isError).toBe(true);
    expect(text).toContain('input.mode:');
    expect(text).toContain('input.maxResults:');
  });

  it('call_item with an unknown item is a tool error', async () => {
    expect(await callTool('call_item', { item: 'demo/nope', input: {} })).toEqual({
      text: 'Unknown item "demo/nope". Use search_catalog first.',
      isError: true,
    });
  });

  const job = (overrides: Record<string, unknown> = {}) => ({
    item: 'demo/slow-report',
    input: { topic: 'mcp' },
    idempotencyKey: 'http-test',
    maxCostUsd: 0.05,
    ...overrides,
  });

  it('start_job deduplicates on the idempotency key, and get_result reads the job', async () => {
    const first = JSON.parse((await callTool('start_job', job())).text);
    const second = JSON.parse((await callTool('start_job', job())).text);

    expect(first.deduplicated).toBe(false);
    expect(second).toEqual({ jobId: first.jobId, deduplicated: true });

    const result = await callTool('get_result', { jobId: first.jobId });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual({ state: 'running', item: 'demo/slow-report' });
  });

  it('start_job over the cost cap is a tool error', async () => {
    const { text, isError } = await callTool(
      'start_job',
      job({ idempotencyKey: 'over-budget', maxCostUsd: 0.001 }),
    );
    expect(isError).toBe(true);
    expect(text).toBe('Refused: demo/slow-report costs 0.01 USD, above the cap of 0.001 USD.');
  });

  it('get_result with an unknown id is a tool error', async () => {
    expect(await callTool('get_result', { jobId: 'missing' })).toEqual({
      text: 'No job missing',
      isError: true,
    });
  });
});

describe('transport guards', () => {
  it('answers an unknown path with 404', async () => {
    const res = await fetch(url.replace('/mcp', '/other'), { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('answers GET with 405 and an Allow header', async () => {
    const res = await fetch(url);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('answers a body that is not JSON with a plain 400', async () => {
    const res = await fetch(url, { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('invalid JSON');
  });

  // The request log reads `method` and `id` from the body before the SDK sees it. A body that is
  // not an object, or whose members have unexpected types, used to end the process there. The
  // SDK refuses each of these as an invalid JSON-RPC message.
  it.each([
    ['null', null, '(no method) id=-'],
    ['a number', 5, '(no method) id=-'],
    [
      'a request whose id is an object',
      { jsonrpc: '2.0', id: { toString: 1 }, method: 'tools/list' },
      'tools/list id=-',
    ],
    [
      'a request whose method is an object',
      { jsonrpc: '2.0', id: 1, method: { toString: 1 } },
      '(no method) id=1',
    ],
  ])('answers a body that is %s with 400 and keeps serving', async (_, body, logged) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32700);
    expect(logLines).toEqual([logged]);

    const reply = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(reply.result?.tools).toHaveLength(5);
  });
});

describe('request log', () => {
  it('writes one line per request: the method and the request id', async () => {
    await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
    await rpc(toolCall('echo', { text: 'x' }, 8));
    await post([]);

    expect(logLines).toEqual(['tools/list id=7', 'tools/call id=8', '(batch)']);
  });
});
