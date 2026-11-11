/**
 * @file Long-running jobs over the catalog. A job is addressed by a handle (`jobId`) that the
 * server mints, so no session is needed to look it up later. Starting a job is idempotent on a
 * caller-supplied key, and is refused up front when the item costs more than the caller allows.
 */
import { randomUUID } from 'node:crypto';
import { findItem, validateInput } from './items.js';

/** A job's state as seen by a caller polling for it. */
export type Job = {
  /** `running` until the work finishes, then `succeeded`. */
  state: 'running' | 'succeeded';
  /** The catalog item the job runs. */
  item: string;
  /** The output, present once the job has succeeded. */
  result?: string;
};

/** What a caller supplies to start a job. */
export type StartRequest = {
  /** The catalog item to run. */
  item: string;
  /** The input for the item; validated against the item's contract. */
  input: Record<string, unknown>;
  /** Identifies this logical request. Repeating a key returns the original job. */
  idempotencyKey: string;
  /** The most the caller will pay for one run, in US dollars. */
  maxCostUsd: number;
};

/** The outcome of trying to start a job. */
export type StartResult =
  /** A job exists for the request. `deduplicated` is true when the key had been seen before. */
  | { ok: true; jobId: string; deduplicated: boolean }
  /** The request was refused; nothing was started. */
  | { ok: false; message: string };

/**
 * Holds jobs in memory and starts them.
 *
 * In-memory on purpose: a deployment with several processes needs a shared store behind this
 * interface, because a `jobId` is only useful if whichever process receives it can find the job.
 */
export class JobStore {
  private readonly jobs = new Map<string, Job>();
  private readonly jobIdByKey = new Map<string, string>();
  private readonly completeAfterMs: number;

  /**
   * Creates an empty store.
   *
   * @param completeAfterMs - How long a job stays `running` before it succeeds. This delay
   * stands in for real work.
   */
  constructor(completeAfterMs = 3000) {
    this.completeAfterMs = completeAfterMs;
  }

  /**
   * Starts a job, or returns the one already started for the same idempotency key.
   *
   * The checks run in this order: key already seen, item exists, cost within the cap, input
   * valid. A refused request is not remembered, so it can be retried with the same key.
   *
   * @param request - The item, its input, the idempotency key and the cost cap.
   * @returns The job's id, or the reason the request was refused.
   */
  start({ item, input, idempotencyKey, maxCostUsd }: StartRequest): StartResult {
    // A retry carrying a key already seen gets the original job, so a re-issued request cannot
    // start a second run.
    const existing = this.jobIdByKey.get(idempotencyKey);
    if (existing) return { ok: true, jobId: existing, deduplicated: true };

    const found = findItem(item);
    if (!found) return { ok: false, message: `Unknown item "${item}".` };

    // The cap is checked before validation: refuse on price without doing any other work.
    if (found.priceUsd > maxCostUsd) {
      return {
        ok: false,
        message: `Refused: ${item} costs ${found.priceUsd} USD, above the cap of ${maxCostUsd} USD.`,
      };
    }

    const validated = validateInput(found, input);
    if (!validated.ok) return validated;

    // The key is stored only now that the job exists, so refusals leave nothing behind.
    const jobId = randomUUID();
    this.jobs.set(jobId, { state: 'running', item });
    this.jobIdByKey.set(idempotencyKey, jobId);

    // The timer stands in for real work. unref() keeps it from holding the process open.
    setTimeout(() => {
      this.jobs.set(jobId, {
        state: 'succeeded',
        item,
        result: `report for ${JSON.stringify(validated.data)}`,
      });
    }, this.completeAfterMs).unref();

    return { ok: true, jobId, deduplicated: false };
  }

  /**
   * Looks up a job by its handle.
   *
   * @param jobId - The handle returned by `start`.
   * @returns The job, or `undefined` if no job has that id.
   */
  get(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }
}
