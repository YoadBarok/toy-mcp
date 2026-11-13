/**
 * @file Registers the shared tools from src/catalog/tools.ts with the SDK: a minimal tool,
 * search followed by a generic call, the job tools, which show a server-minted handle with
 * idempotency and a cost cap, and a tool that asks the user a question (elicitation).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JobStore } from '../catalog/jobs.js';
import { buildTools } from '../catalog/tools.js';

/** How long a tool waits for the user's answer before the call fails, in milliseconds. */
const ANSWER_TIMEOUT_MS = 120_000;

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
 * Builds an MCP server with the shared tools registered.
 *
 * A tool must not keep state of its own: in stateless mode the HTTP layer builds a new server
 * for every request, and in session mode one per session. State that has to outlive a request
 * lives in the `JobStore` passed in.
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
      async (args, extra) => {
        let reply = tool.call(args);
        // A tool that needs the user gets its answer through elicitation: the server sends a
        // request of its own to the client, on the stream of the tool call that is still open,
        // and waits. The client's answer arrives as a separate POST, so it only finds this
        // waiting call if it reaches the same server object. That is what a session is for.
        while ('needsInput' in reply) {
          try {
            const answer = await server.server.elicitInput(reply.needsInput, {
              relatedRequestId: extra.requestId,
              timeout: ANSWER_TIMEOUT_MS,
            });
            reply = tool.call(args, answer);
          } catch (error) {
            // Without a session the server never saw `initialize`, so it does not know that the
            // client can answer questions, and the SDK refuses to ask.
            const reason = error instanceof Error ? error.message : 'unknown error';
            return textResult(`Could not ask the user: ${reason}`, true);
          }
        }
        return textResult(reply.text, reply.isError);
      },
    );
  }

  return server;
};
