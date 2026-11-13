/**
 * @file The two methods that expose the hand-written server's tools, `tools/list` and
 * `tools/call`. Implements the "Tools" section of docs/spec-2026-07-28.md. The tools themselves
 * are defined in src/catalog/tools.ts and shared with the SDK server; this file only turns them
 * into the wire format of this revision.
 */
import { z } from 'zod';
import type { ToolDefinition, ToolOutcome } from '../catalog/tools.js';
import { ErrorCode } from '../protocol/errors.js';
import { isRecord } from '../protocol/jsonrpc.js';
import { complete, type CompleteResult } from '../protocol/result.js';
import type { Failure } from '../protocol/validate.js';

/** The payload of a `tools/call` result: typed content blocks, flagged when the tool failed. */
export type ToolOutput = {
  /** The tool's output as content blocks. */
  content: { type: 'text'; text: string }[];
  /** Present and `true` when the tool failed. Absent on success. */
  isError?: true;
};

/**
 * Turns a tool's outcome into the payload of a `tools/call` result.
 *
 * @param outcome - What the tool produced.
 * @returns One text block, with `isError: true` if the tool failed.
 */
const toOutput = ({ text, isError }: ToolOutcome): ToolOutput => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true as const } : {}),
});

/**
 * Builds the result of a `tools/list` request.
 *
 * Each tool's zod schema is published as JSON Schema, the form the spec requires. The list fits
 * in one page, so there is no `nextCursor`. It is the same for every caller and changes only when
 * the server is redeployed, so a shared cache may keep it (`cacheScope`) for `ttlMs` milliseconds.
 *
 * @param tools - The server's tools.
 * @returns The `result` member for a `tools/list` reply.
 */
export const listToolsResult = (tools: ToolDefinition[]) =>
  complete(
    {
      tools: tools.map(({ name, description, input }) => ({
        name,
        description,
        // `io: 'input'` describes what a caller sends, so a field with a default is optional.
        inputSchema: z.toJSONSchema(input, { io: 'input' }),
      })),
    },
    { ttlMs: 300_000, cacheScope: 'public' },
  );

/** The outcome of a `tools/call`: a result to send, or a protocol failure. */
export type CallOutcome =
  { ok: true; result: CompleteResult<ToolOutput> } | ({ ok: false } & Failure);

/**
 * Runs a `tools/call` request.
 *
 * Two kinds of failure are kept apart. A request the protocol cannot accept (an unknown tool,
 * `arguments` that is not an object) is a JSON-RPC error with `-32602`. A tool that ran and
 * failed, or was given arguments its schema rejects, is a normal result with `isError: true`,
 * which the model sees and can act on.
 *
 * @param tools - The server's tools, by name. A `Map`, not a plain object, so a tool name such
 * as `constructor` cannot reach a built-in member.
 * @param params - The request's `params`, still untrusted.
 * @returns The tool's result, or the failure to send as a JSON-RPC error.
 */
export const callTool = (tools: Map<string, ToolDefinition>, params: unknown): CallOutcome => {
  const invalid = (message: string): CallOutcome => ({
    ok: false,
    status: 400,
    code: ErrorCode.InvalidParams,
    message,
  });

  const name = isRecord(params) ? params.name : undefined;
  const tool = typeof name === 'string' ? tools.get(name) : undefined;
  if (!tool) return invalid(`Unknown tool: ${JSON.stringify(name)}`);

  // `arguments` may be left out when a tool needs none. Anything else that is not an object
  // breaks the shape of the request itself, so it is a protocol error, not a tool error.
  const args = isRecord(params) && params.arguments !== undefined ? params.arguments : {};
  if (!isRecord(args)) return invalid('params.arguments must be an object');

  // A tool call is never cached: it may charge, and its outcome belongs to this caller.
  return { ok: true, result: complete(toOutput(tool.call(args))) };
};
