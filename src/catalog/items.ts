/**
 * @file The toy marketplace both servers share: a small catalog of fake items, each with a price
 * and a typed input, plus search and input validation over it. It stands in for a marketplace
 * of tools whose inputs must be checked before anything runs.
 */
import { z } from 'zod';

/** One callable item in the catalog. */
export type CatalogItem = {
  /** The identifier callers use, in `namespace/name` form. */
  name: string;
  /** What the item does, shown in search results. */
  description: string;
  /** The price of one run, in US dollars. Compared against a caller's cost cap. */
  priceUsd: number;
  /**
   * The item's input contract, as a zod object. Also the source of the field names shown to
   * callers.
   */
  input: z.ZodObject<z.ZodRawShape>;
};

/**
 * The catalog. Items differ in price and input shape, so validation and cost caps have something
 * to act on.
 */
export const CATALOG: CatalogItem[] = [
  {
    name: 'demo/hn-top',
    description: 'Top Hacker News stories',
    priceUsd: 0.0002,
    input: z.object({
      mode: z.enum(['top', 'new', 'best']),
      maxResults: z.number().int().min(1).max(100).default(10),
    }),
  },
  {
    name: 'demo/web-page',
    description: 'Fetch one web page as markdown or text',
    priceUsd: 0.001,
    input: z.object({
      url: z.url(),
      format: z.enum(['markdown', 'text']).default('markdown'),
    }),
  },
  {
    name: 'demo/slow-report',
    description: 'Long-running research report on a topic',
    priceUsd: 0.01,
    input: z.object({
      topic: z.string().min(1),
      depth: z.number().int().min(1).max(5).default(2),
    }),
  },
];

/**
 * Looks up an item by its exact name.
 *
 * @param name - The item's `namespace/name` identifier.
 * @returns The item, or `undefined` if the catalog has no such item.
 */
export const findItem = (name: string): CatalogItem | undefined =>
  CATALOG.find((c) => c.name === name);

/**
 * Searches the catalog by substring.
 *
 * @param query - Text to look for in an item's name or description, ignoring case. An empty
 * query matches every item.
 * @returns A summary of each match: name, description, price and the names of its input fields.
 */
export const searchCatalog = (query: string) => {
  const q = query.toLowerCase();
  return CATALOG.filter((c) => (c.name + c.description).toLowerCase().includes(q)).map((c) => ({
    name: c.name,
    description: c.description,
    priceUsd: c.priceUsd,
    inputFields: Object.keys(c.input.shape),
  }));
};

/** The outcome of checking a caller's input against an item's contract. */
export type ValidationResult =
  /** The input is valid; `data` is the parsed input with defaults applied. */
  | { ok: true; data: Record<string, unknown> }
  /** The input is invalid; `message` names every failing field. */
  | { ok: false; message: string };

/**
 * Checks a caller's input against an item's contract.
 *
 * Every failing field is named in the message, so a caller can correct the whole input in one
 * retry instead of discovering one problem per attempt.
 *
 * @param item - The item the input is for.
 * @param input - The caller's input, of unknown shape.
 * @returns The parsed input with defaults applied, or a message listing each problem as
 * `input.<field>: <reason>`.
 */
export const validateInput = (item: CatalogItem, input: unknown): ValidationResult => {
  const parsed = item.input.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const lines = parsed.error.issues.map(
    (i) => `input.${i.path.join('.') || '(root)'}: ${i.message}`,
  );
  return { ok: false, message: `Invalid input for ${item.name}:\n${lines.join('\n')}` };
};
