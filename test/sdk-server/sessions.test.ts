// End-to-end tests of the SDK server's session route, on a random port. They pin down what a
// session is for: the server asks the client a question in the middle of a tool call, and the
// answer finds the waiting call only when it carries the session id.
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobStore } from '../../src/catalog/jobs.js';
import { createHttpServer } from '../../src/sdk-server/http.js';

const server = createHttpServer(new JobStore(60_000));
let origin = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const post = (path: string, body: unknown, sessionId?: string) =>
  fetch(origin + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  });

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    // Declares that this client can show a form and send back the answer.
    capabilities: { elicitation: { form: {} } },
    clientInfo: { name: 'test', version: '0' },
  },
};

const confirmPurchase = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name: 'confirm_purchase', arguments: { item: 'demo/hn-top' } },
};

// Opens a session and returns its id.
const openSession = async () => {
  const res = await post('/mcp-session', initialize);
  await res.text();
  const sessionId = res.headers.get('mcp-session-id');
  if (!sessionId) throw new Error('no session id');
  return sessionId;
};

type Message = {
  id?: number;
  method?: string;
  params?: { message: string };
  result?: { content: { text: string }[]; isError?: boolean };
};

// Reads the next JSON-RPC message from an SSE stream that stays open between messages.
const messageReader = (res: Response) => {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  return async (): Promise<Message> => {
    for (;;) {
      const match = /^data: (\{.*\})$/m.exec(buffered);
      if (match) {
        buffered = buffered.slice(match.index + match[0].length);
        return JSON.parse(match[1]!) as Message;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error(`stream ended; left over: ${buffered}`);
      buffered += decoder.decode(value, { stream: true });
    }
  };
};

const answer = (id: number | undefined, content: { confirm: boolean }) => ({
  jsonrpc: '2.0',
  id,
  result: { action: 'accept', content },
});

describe('opening and ending a session', () => {
  it('issues a session id on initialize', async () => {
    expect(await openSession()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses a request without a session id with 400', async () => {
    const res = await post('/mcp-session', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Mcp-Session-Id header is required' },
      id: null,
    });
  });

  it('refuses an unknown session id with 404', async () => {
    const res = await post(
      '/mcp-session',
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      'no-such-session',
    );
    expect(res.status).toBe(404);
  });

  it('serves a request that carries the session id', async () => {
    const sessionId = await openSession();
    const res = await post(
      '/mcp-session',
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      sessionId,
    );
    expect(await res.text()).toContain('"confirm_purchase"');
  });

  it('ends the session on DELETE, after which its id gets 404', async () => {
    const sessionId = await openSession();
    const ended = await fetch(`${origin}/mcp-session`, {
      method: 'DELETE',
      headers: { 'Mcp-Session-Id': sessionId },
    });
    expect(ended.status).toBe(200);

    const res = await post(
      '/mcp-session',
      { jsonrpc: '2.0', id: 3, method: 'tools/list' },
      sessionId,
    );
    expect(res.status).toBe(404);
  });

  it('answers GET with 405 and the methods the route allows', async () => {
    const res = await fetch(`${origin}/mcp-session`);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST, DELETE');
  });
});

describe('asking the user in the middle of a tool call', () => {
  it('sends the question on the open stream and finishes when the answer arrives', async () => {
    const sessionId = await openSession();
    const next = messageReader(await post('/mcp-session', confirmPurchase, sessionId));

    const question = await next();
    expect(question.method).toBe('elicitation/create');
    expect(question.params?.message).toBe('Buy demo/hn-top for 0.0002 USD?');

    const accepted = await post('/mcp-session', answer(question.id, { confirm: true }), sessionId);
    expect(accepted.status).toBe(202);

    const result = await next();
    expect(result.id).toBe(confirmPurchase.id);
    expect(JSON.parse(result.result!.content[0]!.text)).toEqual({
      item: 'demo/hn-top',
      purchased: true,
      chargedUsd: 0.0002,
    });
  });

  it('does not charge when the user says no', async () => {
    const sessionId = await openSession();
    const next = messageReader(await post('/mcp-session', confirmPurchase, sessionId));
    const question = await next();
    await post('/mcp-session', answer(question.id, { confirm: false }), sessionId);

    expect(JSON.parse((await next()).result!.content[0]!.text)).toEqual({
      item: 'demo/hn-top',
      purchased: false,
    });
  });

  // The point of the session: the answer is a separate HTTP request, and only the session id
  // connects it to the tool call that is waiting.
  it('loses an answer that does not carry the session id', async () => {
    const sessionId = await openSession();
    const next = messageReader(await post('/mcp-session', confirmPurchase, sessionId));
    const question = await next();
    const reply = answer(question.id, { confirm: true });

    // Without the id the session route refuses it.
    expect((await post('/mcp-session', reply)).status).toBe(400);
    // The stateless route accepts it, but its fresh server has no call waiting, so it is dropped.
    expect((await post('/mcp', reply)).status).toBe(202);

    // The call was still waiting all along: the same answer with the id completes it.
    expect((await post('/mcp-session', reply, sessionId)).status).toBe(202);
    expect(JSON.parse((await next()).result!.content[0]!.text).purchased).toBe(true);
  });

  it('cannot ask on the stateless route, so the tool fails', async () => {
    const next = messageReader(await post('/mcp', confirmPurchase));
    const result = await next();
    expect(result.result?.isError).toBe(true);
    expect(result.result?.content[0]?.text).toBe(
      'Could not ask the user: Client does not support form elicitation.',
    );
  });
});
