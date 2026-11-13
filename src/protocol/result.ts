/**
 * @file The fields every result shares in the 2026-07-28 revision: `resultType`, and the optional
 * cache hint (`ttlMs` and `cacheScope`). Each method builds only its own payload and passes it
 * through a builder here, so the shared fields are written in one place. See the result shapes
 * in docs/spec-2026-07-28.md.
 */

/**
 * The values of `resultType`. `complete` is a final answer. `input_required` belongs to multi
 * round-trip requests: the server needs something from the client before it can finish.
 */
export type ResultType = 'complete' | 'input_required';

/**
 * How long a client may reuse a result, and who may store it. Only `public` (a shared cache may
 * keep it) is used so far, because nothing the server returns yet depends on the caller.
 */
export type CacheHint = {
  /** How long the result stays fresh, in milliseconds. */
  ttlMs: number;
  /** Who may store the result. */
  cacheScope: 'public';
};

/** A method's payload with the shared fields of a final result added. */
export type CompleteResult<T extends object> = { resultType: 'complete' } & T & Partial<CacheHint>;

/**
 * Builds a final result from a method's payload.
 *
 * @param payload - The method's own members, such as `tools` or `content`.
 * @param cache - The cache hint to attach. Leave it out for a result that must not be reused,
 * such as the outcome of a tool call.
 * @returns The payload with `resultType: "complete"`, plus `ttlMs` and `cacheScope` if a hint
 * was given.
 */
export const complete = <T extends object>(payload: T, cache?: CacheHint): CompleteResult<T> => ({
  resultType: 'complete',
  ...payload,
  ...cache,
});
