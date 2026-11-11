import { describe, expect, it } from 'vitest';
import { findItem, searchCatalog, validateInput } from '../../src/catalog/items.js';

const hnTop = findItem('demo/hn-top');
if (!hnTop) throw new Error('catalog item demo/hn-top is missing');

describe('validateInput', () => {
  it('applies defaults to a valid input', () => {
    const result = validateInput(hnTop, { mode: 'top' });
    expect(result).toEqual({ ok: true, data: { mode: 'top', maxResults: 10 } });
  });

  it('names every failing field in one message', () => {
    const result = validateInput(hnTop, { mode: 'trending', maxResults: 500 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('Invalid input for demo/hn-top');
      expect(result.message).toContain('input.mode:');
      expect(result.message).toContain('input.maxResults:');
    }
  });

  it('reports a non-object input against the root', () => {
    const result = validateInput(hnTop, 'nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('input.(root):');
  });
});

describe('searchCatalog', () => {
  it('matches on name or description, case-insensitively', () => {
    expect(searchCatalog('HACKER').map((i) => i.name)).toEqual(['demo/hn-top']);
  });

  it('returns every item for an empty query, with price and input fields', () => {
    const all = searchCatalog('');
    expect(all).toHaveLength(3);
    expect(all[0]).toMatchObject({ priceUsd: 0.0002, inputFields: ['mode', 'maxResults'] });
  });

  it('returns nothing when nothing matches', () => {
    expect(searchCatalog('zzz')).toEqual([]);
  });
});
