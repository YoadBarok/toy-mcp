/**
 * @file The tools of the SDK-based server. Each tool demonstrates one MCP idea: a minimal tool,
 * search followed by a generic call, and a server-minted handle with idempotency and a cost cap.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { findItem, searchCatalog, validateInput } from '../catalog/items.js';
import type { JobStore } from '../catalog/jobs.js';

/**
 * Wraps text in the shape MCP expects from a tool: an array of typed content blocks.
 *
 * @param text - The text to return.
 * @param isError - Marks the result as a tool failure. A failed call is still a normal result
 * with `isError: true`; a JSON-RPC error is reserved for problems with the protocol itself.
 * @returns A tool result.
 */
const textResult = (text: string, isError = false) => ({
  content: [{ type: 'text' as const, text }],
  ...(isError ? { isError: true } : {}),
});

/**
 * Builds an MCP server with the five tools registered.
 *
 * The HTTP layer builds a new one for every request, so a tool must not keep state of its own.
 * State that has to outlive a request lives in the `JobStore` passed in.
 *
 * @param jobs - The store behind `start_job` and `get_result`.
 * @returns A server ready to be connected to a transport.
 */
export const buildServer = (jobs: JobStore): McpServer => {
  const server = new McpServer({ name: 'toy-marketplace', version: '0.1.0' });

  // The smallest possible tool: a name, a description, a typed input and a content result.
  server.registerTool(
    'echo',
    { description: 'Return the given text unchanged', inputSchema: { text: z.string() } },
    async ({ text }) => textResult(text),
  );

  // Marketplace pattern, step one: let the caller discover what exists and what each item needs.
  server.registerTool(
    'search_catalog',
    {
      description: 'Search the catalog of callable items; returns names, prices and input fields',
      inputSchema: { query: z.string().default('') },
    },
    async ({ query }) => textResult(JSON.stringify(searchCatalog(query), null, 2)),
  );

  // Marketplace pattern, step two: one generic tool runs any item. The SDK checks that `input` is
  // an object; the per-item contract is checked here so every failing field can be named.
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

  // A long-running call returns a handle instead of holding a session open. The idempotency key
  // makes a retry safe, and `maxCostUsd` lets the caller cap what a run may cost.
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

  // The other half of the handle: any process that can reach the store can answer this.
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
