import { randomUUID } from 'node:crypto';
import { findItem, validateInput } from './items.js';

export type Job = {
  state: 'running' | 'succeeded';
  item: string;
  result?: string;
};

export type StartRequest = {
  item: string;
  input: Record<string, unknown>;
  idempotencyKey: string;
  maxCostUsd: number;
};

export type StartResult =
  { ok: true; jobId: string; deduplicated: boolean } | { ok: false; message: string };

// In-memory on purpose: a multi-process deployment needs a shared store behind this interface.
export class JobStore {
  private readonly jobs = new Map<string, Job>();
  private readonly jobIdByKey = new Map<string, string>();
  private readonly completeAfterMs: number;

  constructor(completeAfterMs = 3000) {
    this.completeAfterMs = completeAfterMs;
  }

  start({ item, input, idempotencyKey, maxCostUsd }: StartRequest): StartResult {
    const existing = this.jobIdByKey.get(idempotencyKey);
    if (existing) return { ok: true, jobId: existing, deduplicated: true };

    const found = findItem(item);
    if (!found) return { ok: false, message: `Unknown item "${item}".` };
    if (found.priceUsd > maxCostUsd) {
      return {
        ok: false,
        message: `Refused: ${item} costs ${found.priceUsd} USD, above the cap of ${maxCostUsd} USD.`,
      };
    }

    const validated = validateInput(found, input);
    if (!validated.ok) return validated;

    const jobId = randomUUID();
    this.jobs.set(jobId, { state: 'running', item });
    this.jobIdByKey.set(idempotencyKey, jobId);
    setTimeout(() => {
      this.jobs.set(jobId, {
        state: 'succeeded',
        item,
        result: `report for ${JSON.stringify(validated.data)}`,
      });
    }, this.completeAfterMs).unref();

    return { ok: true, jobId, deduplicated: false };
  }

  get(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }
}
