// The builder for the fields every 2026-07-28 result shares.
import { describe, expect, it } from 'vitest';
import { complete } from '../../src/protocol/result.js';

describe('complete', () => {
  it('adds resultType to the payload and no cache fields by default', () => {
    expect(complete({ content: [] })).toEqual({ resultType: 'complete', content: [] });
  });

  it('adds the cache hint when one is given', () => {
    expect(complete({ tools: [] }, { ttlMs: 1000, cacheScope: 'public' })).toEqual({
      resultType: 'complete',
      tools: [],
      ttlMs: 1000,
      cacheScope: 'public',
    });
  });

  it('puts resultType first, so a reply reads the same for every method', () => {
    expect(Object.keys(complete({ tools: [] }))[0]).toBe('resultType');
  });
});
