import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { findItem, searchCatalog, validateInput } from '../catalog/items.js';
import type { JobStore } from '../catalog/jobs.js';

const textResult = (text: string, isError = false) => ({
  content: [{ type: 'text' as const, text }],
  ...(isError ? { isError: true } : {}),
});

export const buildServer = (jobs: JobStore): McpServer => {
  const server = new McpServer({ name: 'toy-marketplace', version: '0.1.0' });

  server.registerTool(
    'echo',
    { description: 'Return the given text unchanged', inputSchema: { text: z.string() } },
    async ({ text }) => textResult(text),
  );

  server.registerTool(
    'search_catalog',
    {
      description: 'Search the catalog of callable items; returns names, prices and input fields',
      inputSchema: { query: z.string().default('') },
    },
    async ({ query }) => textResult(JSON.stringify(searchCatalog(query), null, 2)),
  );

  server.registerTool(
    'call_item',
    {
      description: 'Run a catalog item synchronously with the given input',
      inputSchema: { item: z.string(), input: z.record(z.string(), z.unknown()) },
    },
    async ({ item, input }) => {
      const found = findItem(item);
      if (!found) return textResult(`Unknown item "${item}". Use search_catalog first.`, true);
      const validated = validateInput(found, input);
      if (!validated.ok) return textResult(validated.message, true);
      return textResult(
        JSON.stringify({ item, ranWith: validated.data, chargedUsd: found.priceUsd }),
      );
    },
  );

  server.registerTool(
    'start_job',
    {
      description:
        'Start a long-running item. Returns a jobId handle; poll get_result. Retries with the same idempotencyKey return the same job.',
      inputSchema: {
        item: z.string(),
        input: z.record(z.string(), z.unknown()),
        idempotencyKey: z.string().min(1),
        maxCostUsd: z.number().positive(),
      },
    },
    async (args) => {
      const started = jobs.start(args);
      return started.ok
        ? textResult(JSON.stringify({ jobId: started.jobId, deduplicated: started.deduplicated }))
        : textResult(started.message, true);
    },
  );

  server.registerTool(
    'get_result',
    {
      description: 'Read the state of a job by its jobId handle',
      inputSchema: { jobId: z.string() },
    },
    async ({ jobId }) => {
      const job = jobs.get(jobId);
      return job ? textResult(JSON.stringify(job)) : textResult(`No job ${jobId}`, true);
    },
  );

  return server;
};
