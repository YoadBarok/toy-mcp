/**
 * @file The tools of the SDK-based server: the shared catalog tools from src/catalog/tools.ts
 * (a minimal tool, then search followed by a generic call), plus the job tools, which show a
 * server-minted handle with idempotency and a cost cap.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { JobStore } from '../catalog/jobs.js';
import { CATALOG_TOOLS } from '../catalog/tools.js';

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

  // The tools both servers share are defined once, in src/catalog/tools.ts. The SDK takes the zod
  // shape, publishes it as JSON Schema in `tools/list` and validates arguments before the handler
  // runs.
  for (const tool of CATALOG_TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input.shape },
      async (args) => {
        const { text, isError } = tool.call(args);
        return textResult(text, isError);
      },
    );
  }

  // The job tools need the job store, which only this server has so far.
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
