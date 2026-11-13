/**
 * @file Registers the shared tools from src/catalog/tools.ts with the SDK: a minimal tool,
 * search followed by a generic call, and the job tools, which show a server-minted handle with
 * idempotency and a cost cap.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JobStore } from '../catalog/jobs.js';
import { buildTools } from '../catalog/tools.js';

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

  // Every tool is defined once, in src/catalog/tools.ts. The SDK takes the zod shape, publishes it
  // as JSON Schema in `tools/list` and validates arguments before the handler runs.
  for (const tool of buildTools(jobs)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input.shape },
      async (args) => {
        const { text, isError } = tool.call(args);
        return textResult(text, isError);
      },
    );
  }

  return server;
};
