/**
 * @file Entry point for the hand-written 2026-07-28 server. Reads `PORT` (default 3334) and
 * listens on the loopback interface only.
 */
import { createHttpServer } from './http.js';

const PORT = Number(process.env.PORT ?? 3334);

createHttpServer(console.log).listen(PORT, '127.0.0.1', () => {
  console.log(`2026-07-28 server on http://127.0.0.1:${PORT}/mcp`);
});
