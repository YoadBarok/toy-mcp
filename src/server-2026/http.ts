import { createServer, type Server } from 'node:http';
import { handleRpc } from './handler.js';

export const createHttpServer = (log: (line: string) => void = () => {}): Server =>
  createServer(async (req, res) => {
    if (req.url !== '/mcp') return void res.writeHead(404).end();
    if (req.method !== 'POST') return void res.writeHead(405, { Allow: 'POST' }).end();

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const result = handleRpc(req.headers, Buffer.concat(chunks).toString('utf8'));

    const error = (result.body as { error?: { code: number; message: string } }).error;
    log(
      `${result.method ?? '(unparsed)'} -> ${result.status}${error ? ` ${error.code} ${error.message}` : ''}`,
    );

    res
      .writeHead(result.status, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(result.body));
  });
