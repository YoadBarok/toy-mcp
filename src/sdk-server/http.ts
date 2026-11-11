import { createServer, type Server } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { JobStore } from '../catalog/jobs.js';
import { buildServer } from './server.js';

// Stateless mode: each request gets its own server and transport, and no session id is issued.
export const createHttpServer = (jobs: JobStore, log: (line: string) => void = () => {}): Server =>
  createServer(async (req, res) => {
    if (req.url !== '/mcp') return void res.writeHead(404).end();
    if (req.method !== 'POST') return void res.writeHead(405, { Allow: 'POST' }).end();

    let body: unknown;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return void res.writeHead(400).end('invalid JSON');
    }

    const rpc = body as { method?: string; id?: unknown };
    log(`${rpc.method ?? '(batch)'} id=${String(rpc.id ?? '-')}`);

    const server = buildServer(jobs);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });
