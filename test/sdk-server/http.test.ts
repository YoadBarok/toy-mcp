import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobStore } from '../../src/catalog/jobs.js';
import { createHttpServer } from '../../src/sdk-server/http.js';

const server = createHttpServer(new JobStore());
let url = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});

afterAll(() => {
  server.close();
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

  it('names every failing field when call_item input is invalid', async () => {
    const reply = await rpc(
      toolCall('call_item', { item: 'demo/hn-top', input: { mode: 'trending', maxResults: 500 } }),
    );

    expect(reply.result?.isError).toBe(true);
    const text = reply.result?.content?.[0]?.text ?? '';
    expect(text).toContain('input.mode:');
    expect(text).toContain('input.maxResults:');
  });

  it('returns schema failures as a tool error that names the field', async () => {
    const reply = await rpc(toolCall('echo', { text: 5 }));
    expect(reply.result?.isError).toBe(true);
    expect(reply.result?.content?.[0]?.text).toContain('at text');
  });

  it('deduplicates start_job on the idempotency key', async () => {
    const args = {
      item: 'demo/slow-report',
      input: { topic: 'mcp' },
      idempotencyKey: 'http-test',
      maxCostUsd: 0.05,
    };
    const first = JSON.parse(
      (await rpc(toolCall('start_job', args))).result?.content?.[0]?.text ?? '',
    );
    const second = JSON.parse(
      (await rpc(toolCall('start_job', args))).result?.content?.[0]?.text ?? '',
    );

    expect(first.deduplicated).toBe(false);
    expect(second).toEqual({ jobId: first.jobId, deduplicated: true });
  });

  it('answers server/discover with a JSON-RPC -32601, because it predates that revision', async () => {
    const reply = await rpc({ jsonrpc: '2.0', id: 3, method: 'server/discover' });
    expect(reply.error?.code).toBe(-32601);
  });
});
