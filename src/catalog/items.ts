import { z } from 'zod';

export type CatalogItem = {
  name: string;
  description: string;
  priceUsd: number;
  input: z.ZodObject<z.ZodRawShape>;
};

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

export const findItem = (name: string): CatalogItem | undefined =>
  CATALOG.find((c) => c.name === name);

export const searchCatalog = (query: string) => {
  const q = query.toLowerCase();
  return CATALOG.filter((c) => (c.name + c.description).toLowerCase().includes(q)).map((c) => ({
    name: c.name,
    description: c.description,
    priceUsd: c.priceUsd,
    inputFields: Object.keys(c.input.shape),
  }));
};

export type ValidationResult =
  { ok: true; data: Record<string, unknown> } | { ok: false; message: string };

// Names every failing field, so a caller can correct the input in one retry.
export const validateInput = (item: CatalogItem, input: unknown): ValidationResult => {
  const parsed = item.input.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const lines = parsed.error.issues.map(
    (i) => `input.${i.path.join('.') || '(root)'}: ${i.message}`,
  );
  return { ok: false, message: `Invalid input for ${item.name}:\n${lines.join('\n')}` };
};
