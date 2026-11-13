/**
 * @file The HTTP transport of the hand-written server: route guards, body reading, and writing
 * the reply. The protocol rules live in handler.ts; this file only moves bytes.
 */
import { createServer, type Server } from 'node:http';
import type { JobStore } from '../catalog/jobs.js';
import { createHandler } from './handler.js';

/**
 * Creates the HTTP server for the hand-written MCP server. The caller decides when and where it
 * listens, so tests can bind a random port.
 *
 * Only `POST /mcp` reaches the handler. `GET` returns `405` because the 2026-07-28 revision
 * removed the standalone GET stream, and any other path returns `404`.
 *
 * @param jobs - The job store shared by every request.
 * @param log - Called with one line per handled request. Defaults to doing nothing.
 * @returns A server that has not started listening.
 */
export const createHttpServer = (
  jobs: JobStore,
  log: (line: string) => void = () => {},
): Server => {
  const handleRpc = createHandler(jobs);
  return createServer(async (req, res) => {
    if (req.url !== '/mcp') return void res.writeHead(404).end();
    if (req.method !== 'POST') return void res.writeHead(405, { Allow: 'POST' }).end();

    // Reading the body throws if the client drops the connection mid-upload. An error escaping
    // this async listener would be an unhandled rejection, which ends the process, so it is
    // caught here. There is nobody left to answer.
    let rawBody: string;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      rawBody = Buffer.concat(chunks).toString('utf8');
    } catch {
      return void res.destroy();
    }
    const result = handleRpc(req.headers, rawBody);

    // One log line per request: the method, the HTTP status, and the error if there was one.
    const error = (result.body as { error?: { code: number; message: string } }).error;
    log(
      `${result.method ?? '(unparsed)'} -> ${result.status}${error ? ` ${error.code} ${error.message}` : ''}`,
    );

    res
      .writeHead(result.status, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(result.body));
  });
};
