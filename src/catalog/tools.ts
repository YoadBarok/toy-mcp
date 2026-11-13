/**
 * @file The tools both servers expose, defined once: name, description, argument schema and
 * behavior. Nothing here knows about MCP. Each server turns a definition into its own wire
 * format, so the two cannot drift apart in what a tool is called, accepts or does.
 */
import { z } from 'zod';
import { findItem, searchCatalog, validateInput } from './items.js';

/** What a tool produces, before a server wraps it in a protocol result. */
export type ToolOutcome = {
  /** The tool's output, or the reason it failed. */
  text: string;
  /** `true` when the tool failed. The caller sees `text` either way. */
  isError: boolean;
};

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
   */
  call: (args: unknown) => ToolOutcome;
};

const success = (text: string): ToolOutcome => ({ text, isError: false });
const failure = (text: string): ToolOutcome => ({ text, isError: true });

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
  run: (args: z.infer<T>) => ToolOutcome;
}): ToolDefinition => ({
  name: def.name,
  description: def.description,
  input: def.input,
  call: (args) => {
    const parsed = def.input.safeParse(args);
    if (parsed.success) return def.run(parsed.data);
    const lines = parsed.error.issues.map(
      (i) => `arguments.${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    return failure(`Invalid arguments for ${def.name}:\n${lines.join('\n')}`);
  },
});

/** The tools that need nothing but the catalog. Both servers expose all of them. */
export const CATALOG_TOOLS: ToolDefinition[] = [
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
];
