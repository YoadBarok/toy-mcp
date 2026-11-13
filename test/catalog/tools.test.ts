// The shared tool definitions: the single source for what both servers expose.
import { describe, expect, it } from 'vitest';
import { JobStore } from '../../src/catalog/jobs.js';
import { buildTools, type Answer, type ToolOutcome } from '../../src/catalog/tools.js';

const TOOLS = buildTools(new JobStore(60_000));

const tool = (name: string) => {
  const found = TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

// Calls a tool that is expected to finish, and fails the test if it asks a question instead.
const run = (name: string, args: unknown, answer?: Answer): ToolOutcome => {
  const reply = tool(name).call(args, answer);
  if ('needsInput' in reply) throw new Error(`${name} asked a question`);
  return reply;
};

describe('shared tool definitions', () => {
  it('defines each tool once, under a unique name', () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toEqual([
      'echo',
      'search_catalog',
      'call_item',
      'start_job',
      'get_result',
      'confirm_purchase',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('runs a tool on valid arguments and applies schema defaults', () => {
    expect(run('echo', { text: 'hi' })).toEqual({ text: 'hi', isError: false });
    expect(JSON.parse(run('search_catalog', {}).text)).toHaveLength(3);
  });

  it('turns arguments the schema rejects into a failed outcome that names each field', () => {
    const outcome = run('call_item', { item: 5 });
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('arguments.item');
    expect(outcome.text).toContain('arguments.input');
  });

  it('starts a job in the given store and reads it back', () => {
    const args = {
      item: 'demo/slow-report',
      input: { topic: 'x' },
      idempotencyKey: 't-1',
      maxCostUsd: 1,
    };
    const started = run('start_job', args);
    expect(started.isError).toBe(false);
    const { jobId } = JSON.parse(started.text);
    expect(JSON.parse(run('get_result', { jobId }).text).state).toBe('running');
    expect(run('get_result', { jobId: 'nope' })).toEqual({
      text: 'No job nope',
      isError: true,
    });
  });

  it('never throws, whatever the arguments are', () => {
    for (const args of [null, undefined, 5, 'x', [], { text: { toString: 1 } }]) {
      expect(run('echo', args).isError).toBe(true);
    }
  });

  describe('a tool that asks the user', () => {
    const args = { item: 'demo/hn-top' };

    it('returns a question when called without an answer', () => {
      expect(tool('confirm_purchase').call(args)).toEqual({
        needsInput: {
          message: 'Buy demo/hn-top for 0.0002 USD?',
          requestedSchema: {
            type: 'object',
            properties: { confirm: { type: 'boolean', title: 'Confirm' } },
            required: ['confirm'],
          },
        },
      });
    });

    it('charges only on an explicit yes', () => {
      const yes = run('confirm_purchase', args, { action: 'accept', content: { confirm: true } });
      expect(JSON.parse(yes.text)).toEqual({
        item: 'demo/hn-top',
        purchased: true,
        chargedUsd: 0.0002,
      });

      const refusals: Answer[] = [
        { action: 'accept', content: { confirm: false } },
        { action: 'accept' },
        { action: 'decline' },
        { action: 'cancel' },
      ];
      for (const answer of refusals) {
        expect(JSON.parse(run('confirm_purchase', args, answer).text)).toEqual({
          item: 'demo/hn-top',
          purchased: false,
        });
      }
    });

    it('fails without asking when the item does not exist', () => {
      expect(run('confirm_purchase', { item: 'demo/nope' }).isError).toBe(true);
    });
  });
});
