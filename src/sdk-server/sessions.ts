/**
 * @file Session mode for the SDK-based server. A session is one server and one transport kept
 * alive between requests, found again through the `Mcp-Session-Id` header. It is what lets the
 * server ask the client something in the middle of a tool call and receive the answer.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { JobStore } from '../catalog/jobs.js';
import { buildServer } from './server.js';

/** Handles one request on the session route. `body` is the parsed JSON body, if there was one. */
export type SessionHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  body?: unknown,
) => Promise<void>;

/**
 * Writes a refusal that never reached a session, in the shape the SDK's transport uses for its
 * own refusals.
 *
 * @param res - The response to write.
 * @param status - The HTTP status.
 * @param message - What was wrong with the request.
 */
const refuse = (res: ServerResponse, status: number, message: string): void => {
  res
    .writeHead(status, { 'Content-Type': 'application/json' })
    .end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
};

/**
 * Creates the handler for the session route.
 *
 * An `initialize` request without a session id opens a session: a new server and transport, and
 * an id returned in the `Mcp-Session-Id` response header. Every later request must carry that id
 * and is passed to the same transport. `DELETE` ends the session.
 *
 * The sessions live in a map in this process. That is the cost of the design: a second process
 * behind a load balancer does not have the map, so every request of a session must be routed to
 * the process that opened it, and a restart ends every session. Nothing expires a session
 * either; a real server would drop idle ones.
 *
 * @param jobs - The job store shared by every session.
 * @returns The handler.
 */
export const createSessionHandler = (jobs: JobStore): SessionHandler => {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  return async (req, res, body) => {
    const sessionId = req.headers['mcp-session-id'];
    if (typeof sessionId === 'string') {
      const transport = transports.get(sessionId);
      // 404 tells the client that the session is gone and it must start again with `initialize`.
      if (!transport) return refuse(res, 404, 'Session not found');
      return transport.handleRequest(req, res, body);
    }

    if (!isInitializeRequest(body)) return refuse(res, 400, 'Mcp-Session-Id header is required');

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id) => {
        transports.set(id, transport);
      },
    });
    // Runs when the client ends the session with DELETE. Set before `connect`, which chains it.
    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };
    await buildServer(jobs).connect(transport);
    await transport.handleRequest(req, res, body);
  };
};
