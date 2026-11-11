// Job store behavior: idempotency, the cost cap, and the running-to-succeeded transition. Fake
// timers stand in for the job's delay, so these tests do not wait.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobStore } from '../../src/catalog/jobs.js';

const request = (overrides: Partial<Parameters<JobStore['start']>[0]> = {}) => ({
  item: 'demo/slow-report',
  input: { topic: 'mcp' },
  idempotencyKey: 'key-1',
  maxCostUsd: 0.05,
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('JobStore', () => {
  it('starts a job that is running, then succeeds once the full delay has passed', () => {
    const store = new JobStore(3000);
    const started = store.start(request());
    if (!started.ok) throw new Error(started.message);

    vi.advanceTimersByTime(2999);
    expect(store.get(started.jobId)).toEqual({ state: 'running', item: 'demo/slow-report' });
    vi.advanceTimersByTime(1);
    expect(store.get(started.jobId)).toEqual({
      state: 'succeeded',
      item: 'demo/slow-report',
      result: 'report for {"topic":"mcp","depth":2}',
    });
  });

  it('returns the same job for a repeated idempotency key', () => {
    const store = new JobStore();
    const first = store.start(request());
    const second = store.start(request());

    expect(first).toMatchObject({ ok: true, deduplicated: false });
    expect(second).toMatchObject({ ok: true, deduplicated: true });
    if (first.ok && second.ok) expect(second.jobId).toBe(first.jobId);
  });

  it('refuses an item that costs more than the cap, without creating a job', () => {
    const store = new JobStore();
    const result = store.start(request({ maxCostUsd: 0.001 }));

    expect(result).toEqual({
      ok: false,
      message: 'Refused: demo/slow-report costs 0.01 USD, above the cap of 0.001 USD.',
    });
  });

  it('does not remember a key whose request was refused', () => {
    const store = new JobStore();
    store.start(request({ maxCostUsd: 0.001 }));
    expect(store.start(request())).toMatchObject({ ok: true, deduplicated: false });
  });

  it('rejects an unknown item', () => {
    const result = new JobStore().start(request({ item: 'demo/nope' }));
    expect(result).toEqual({ ok: false, message: 'Unknown item "demo/nope".' });
  });

  it('rejects invalid input and names the failing field', () => {
    const result = new JobStore().start(request({ input: { topic: '' } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('input.topic:');
  });

  it('returns the first job for a reused key, even when the other arguments differ', () => {
    const store = new JobStore();
    const first = store.start(request());
    const second = store.start(request({ item: 'demo/nope', maxCostUsd: 0.000001 }));

    if (!first.ok) throw new Error(first.message);
    expect(second).toEqual({ ok: true, jobId: first.jobId, deduplicated: true });
  });

  it('accepts an item whose price equals the cap', () => {
    const result = new JobStore().start(request({ maxCostUsd: 0.01 }));
    expect(result).toMatchObject({ ok: true, deduplicated: false });
  });

  it('checks the cost before the input', () => {
    const result = new JobStore().start(request({ maxCostUsd: 0.001, input: { topic: '' } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Refused:');
  });

  it('does not remember a key whose input was invalid', () => {
    const store = new JobStore();
    store.start(request({ input: { topic: '' } }));
    expect(store.start(request())).toMatchObject({ ok: true, deduplicated: false });
  });

  it('returns undefined for an unknown job id', () => {
    expect(new JobStore().get('missing')).toBeUndefined();
  });
});
