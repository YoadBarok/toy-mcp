// The shared tool definitions: the single source for what both servers expose.
import { describe, expect, it } from 'vitest';
import { CATALOG_TOOLS } from '../../src/catalog/tools.js';

const tool = (name: string) => {
  const found = CATALOG_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

describe('shared tool definitions', () => {
  it('defines each tool once, under a unique name', () => {
    const names = CATALOG_TOOLS.map((t) => t.name);
    expect(names).toEqual(['echo', 'search_catalog', 'call_item']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('runs a tool on valid arguments and applies schema defaults', () => {
    expect(tool('echo').call({ text: 'hi' })).toEqual({ text: 'hi', isError: false });
    expect(JSON.parse(tool('search_catalog').call({}).text)).toHaveLength(3);
  });

  it('turns arguments the schema rejects into a failed outcome that names each field', () => {
    const outcome = tool('call_item').call({ item: 5 });
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('arguments.item');
    expect(outcome.text).toContain('arguments.input');
  });

  it('never throws, whatever the arguments are', () => {
    for (const args of [null, undefined, 5, 'x', [], { text: { toString: 1 } }]) {
      expect(tool('echo').call(args).isError).toBe(true);
    }
  });
});
