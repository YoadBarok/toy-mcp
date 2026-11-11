import { JobStore } from '../catalog/jobs.js';
import { createHttpServer } from './http.js';

const PORT = Number(process.env.PORT ?? 3333);

createHttpServer(new JobStore(), console.log).listen(PORT, '127.0.0.1', () => {
  console.log(`SDK server on http://127.0.0.1:${PORT}/mcp`);
});
