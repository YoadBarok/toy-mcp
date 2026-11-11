/**
 * @file The HTTP transport of the SDK-based server. It runs the SDK's Streamable HTTP transport
 * in stateless mode: every request gets its own server and transport, and no session is kept.
 */
import { createServer, type Server } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { JobStore } from '../catalog/jobs.js';
import { buildServer } from './server.js';

/**
 * Summarizes a request body for the log.
 *
 * The body is untrusted JSON, so it can be any value and its members can be of any type. Only a
 * string method and a string or number id are printed; anything else becomes a placeholder.
 *
 * @param body - The parsed request body.
 * @returns One log line, such as `tools/list id=1`.
 */
const describeRequest = (body: unknown): string => {
  if (Array.isArray(body)) return '(batch)';
  const { method, id } = (typeof body === 'object' && body !== null ? body : {}) as {
    method?: unknown;
    id?: unknown;
  };
  const shownMethod = typeof method === 'string' ? method : '(no method)';
  const shownId = typeof id === 'string' || typeof id === 'number' ? id : '-';
  return `${shownMethod} id=${shownId}`;
};

/**
 * Creates the HTTP server for the SDK-based MCP server. The caller decides when and where it
 * listens, so tests can bind a random port.
 *
 * Stateless mode: each request builds a fresh server and transport and no session id is issued,
 * so a request can be handled by any process. State that must persist lives in `jobs`.
 *
 * @param jobs - The job store shared by every request.
 * @param log - Called with one line per request. Defaults to doing nothing.
 * @returns A server that has not started listening.
 */
export const createHttpServer = (jobs: JobStore, log: (line: string) => void = () => {}): Server =>
  createServer(async (req, res) => {
    if (req.url !== '/mcp') return void res.writeHead(404).end();
    if (req.method !== 'POST') return void res.writeHead(405, { Allow: 'POST' }).end();

    // The body is parsed here, not by the SDK, so malformed JSON gets a plain 400 before any MCP
    // handling.
    let body: unknown;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return void res.writeHead(400).end('invalid JSON');
    }

    log(describeRequest(body));

    const server = buildServer(jobs);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    // Release the per-request server and transport once the response has ended.
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });
