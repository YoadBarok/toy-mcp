/**
 * @file The tools both servers expose, defined once: name, description, argument schema and
 * behavior. Nothing here knows about MCP. Each server turns a definition into its own wire
 * format, so the two cannot drift apart in what a tool is called, accepts or does.
 */
import { z } from 'zod';
import { findItem, searchCatalog, validateInput } from './items.js';
import type { JobStore } from './jobs.js';

/** What a tool produces, before a server wraps it in a protocol result. */
export type ToolOutcome = {
  /** The tool's output, or the reason it failed. */
  text: string;
  /** `true` when the tool failed. The caller sees `text` either way. */
  isError: boolean;
};

/**
 * A question a tool needs the user to answer before it can finish. The shape follows MCP
 * elicitation, which both revisions use: a message plus a flat schema for the answer. Only
 * boolean fields exist so far, because that is all the tools ask for.
 */
export type Question = {
  /** What to ask, in words the user can act on. */
  message: string;
  /** The form the answer must fill in. */
  requestedSchema: {
    type: 'object';
    properties: Record<string, { type: 'boolean'; title?: string; description?: string }>;
    required?: string[];
  };
};

/** The user's reply to a `Question`. `content` is present only when the action is `accept`. */
export type Answer = {
  /** `accept` submits the form, `decline` refuses, `cancel` dismisses without choosing. */
  action: 'accept' | 'decline' | 'cancel';
  /** The submitted form, keyed by the field names of `requestedSchema`. */
  content?: Record<string, unknown>;
};

/** Returned by a tool that cannot finish until the user answers a question. */
export type NeedsInput = { needsInput: Question };

/** What a call returns: a finished outcome, or a question to bring back an answer for. */
export type ToolReply = ToolOutcome | NeedsInput;

/** A tool as both servers see it. */
export type ToolDefinition = {
  /** The name a caller uses to call the tool. */
  name: string;
  /** What the tool does, written for the model that will choose it. */
  description: string;
  /** The tool's arguments. A server publishes this as JSON Schema. */
  input: z.ZodObject;
  /**
   * Checks the arguments against `input`, then runs the tool. Never throws: arguments that fail
   * the schema produce a failed outcome that names every failing field.
   *
   * A tool that needs the user returns `NeedsInput` when called without an `answer`. The server
   * gets the answer in whatever way its protocol revision offers, then calls again with the same
   * arguments plus the answer. The tool keeps nothing between the two calls.
   */
  call: (args: unknown, answer?: Answer) => ToolReply;
};

const success = (text: string): ToolOutcome => ({ text, isError: false });
const failure = (text: string): ToolOutcome => ({ text, isError: true });

/** The one-field form behind every yes-or-no question. */
const CONFIRM_FORM: Question['requestedSchema'] = {
  type: 'object',
  properties: { confirm: { type: 'boolean', title: 'Confirm' } },
  required: ['confirm'],
};

/**
 * Builds a tool definition from a zod schema and a handler that receives the parsed arguments.
 *
 * @param def - The tool's name, description, argument schema and handler.
 * @returns The definition, with argument checking built into `call`.
 */
const defineTool = <T extends z.ZodObject>(def: {
  name: string;
  description: string;
  input: T;
  run: (args: z.infer<T>, answer?: Answer) => ToolReply;
}): ToolDefinition => ({
  name: def.name,
  description: def.description,
  input: def.input,
  call: (args, answer) => {
    const parsed = def.input.safeParse(args);
    if (parsed.success) return def.run(parsed.data, answer);
    const lines = parsed.error.issues.map(
      (i) => `arguments.${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    return failure(`Invalid arguments for ${def.name}:\n${lines.join('\n')}`);
  },
});

/**
 * Builds every tool a server exposes. Both servers call this, so they expose the same ones.
 *
 * It is a function, not a constant, because the job tools need the store: a job outlives the
 * request that started it, so its state cannot live in a tool.
 *
 * @param jobs - The store behind `start_job` and `get_result`. A server creates one and shares
 * it across all its requests.
 * @returns The tool definitions, in the order `tools/list` shows them.
 */
export const buildTools = (jobs: JobStore): ToolDefinition[] => [
  // The smallest possible tool: a name, a description, a typed input and a text result.
  defineTool({
    name: 'echo',
    description: 'Return the given text unchanged',
    input: z.object({ text: z.string() }),
    run: ({ text }) => success(text),
  }),
  // Marketplace pattern, step one: let the caller discover what exists and what each item needs.
  defineTool({
    name: 'search_catalog',
    description: 'Search the catalog of callable items; returns names, prices and input fields',
    input: z.object({ query: z.string().default('') }),
    run: ({ query }) => success(JSON.stringify(searchCatalog(query), null, 2)),
  }),
  // Marketplace pattern, step two: one generic tool runs any item. The schema only says that
  // `input` is an object; the per-item contract is checked here so every failing field is named.
  defineTool({
    name: 'call_item',
    description: 'Run a catalog item synchronously with the given input',
    input: z.object({ item: z.string(), input: z.record(z.string(), z.unknown()) }),
    run: ({ item, input }) => {
      const found = findItem(item);
      if (!found) return failure(`Unknown item ${JSON.stringify(item)}. Use search_catalog first.`);
      const validated = validateInput(found, input);
      if (!validated.ok) return failure(validated.message);
      return success(JSON.stringify({ item, ranWith: validated.data, chargedUsd: found.priceUsd }));
    },
  }),
  // A long-running call returns a handle instead of holding a connection open. The idempotency
  // key makes a retry safe, and `maxCostUsd` lets the caller cap what a run may cost.
  defineTool({
    name: 'start_job',
    description:
      'Start a long-running item. Returns a jobId handle; poll get_result. Retries with the same idempotencyKey return the same job.',
    input: z.object({
      item: z.string(),
      input: z.record(z.string(), z.unknown()),
      idempotencyKey: z.string().min(1),
      maxCostUsd: z.number().positive(),
    }),
    run: (args) => {
      const started = jobs.start(args);
      return started.ok
        ? success(JSON.stringify({ jobId: started.jobId, deduplicated: started.deduplicated }))
        : failure(started.message);
    },
  }),
  // The other half of the handle: any process that can reach the store can answer this.
  defineTool({
    name: 'get_result',
    description: 'Read the state of a job by its jobId handle',
    input: z.object({ jobId: z.string() }),
    run: ({ jobId }) => {
      const job = jobs.get(jobId);
      return job ? success(JSON.stringify(job)) : failure(`No job ${jobId}`);
    },
  }),
  // A tool that stops in the middle to ask the user. It is a pure function of its arguments and
  // the answer, so how the question travels (a session, or a retried request) is the server's
  // business. Anything but an explicit yes leaves the user uncharged.
  defineTool({
    name: 'confirm_purchase',
    description: 'Buy a catalog item after asking the user to confirm the price',
    input: z.object({ item: z.string() }),
    run: ({ item }, answer) => {
      const found = findItem(item);
      if (!found) return failure(`Unknown item ${JSON.stringify(item)}. Use search_catalog first.`);
      if (!answer) {
        return {
          needsInput: {
            message: `Buy ${item} for ${found.priceUsd} USD?`,
            requestedSchema: CONFIRM_FORM,
          },
        };
      }
      const confirmed = answer.action === 'accept' && answer.content?.confirm === true;
      return success(
        JSON.stringify(
          confirmed
            ? { item, purchased: true, chargedUsd: found.priceUsd }
            : { item, purchased: false },
        ),
      );
    },
  }),
];
