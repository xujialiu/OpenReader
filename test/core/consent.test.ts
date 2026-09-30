import { describe, expect, it, vi } from 'vitest';

import { createConsentGate, type ConsentRecipient } from '../../src/core/consent';

/**
 * #109, ADR 0064: nothing is sent to a service until the person has said yes to
 * it, once. The question is asked once per recipient however many requests wait
 * on it. A yes is kept. A no keeps nothing and holds until the person asks for
 * something again.
 */

/** A gate over an in-memory store, with the question answered by the test. */
function fixture() {
  const kept = new Set<string>();
  const answers: ((yes: boolean) => void)[] = [];
  const ask = vi.fn((_recipient: ConsentRecipient) => new Promise<boolean>((resolve) => { answers.push(resolve); }));
  const keep = vi.fn((key: string) => { kept.add(key); });
  const gate = createConsentGate({ kept: (key) => kept.has(key), keep, ask });
  /** Answer the question on screen, as the person would. */
  const answer = async (yes: boolean) => {
    await vi.waitFor(() => expect(answers.length).toBeGreaterThan(0));
    answers.shift()!(yes);
  };
  return { gate, ask, keep, kept, answer };
}

const fish = { key: 'provider:fish' };
const youdao = { key: 'lookup:youdao' };

describe('the consent gate', () => {
  it('asks once for every request waiting on the same recipient, and lets them all through on a yes', async () => {
    const f = fixture();
    const waiting = [f.gate.ensure(fish), f.gate.ensure(fish), f.gate.ensure(fish)];
    await f.answer(true);
    expect(await Promise.all(waiting)).toEqual([true, true, true]);
    expect(f.ask).toHaveBeenCalledTimes(1);
  });

  it('keeps a yes, and does not ask again', async () => {
    const f = fixture();
    const first = f.gate.ensure(fish);
    await f.answer(true);
    expect(await first).toBe(true);
    expect(f.keep).toHaveBeenCalledWith('provider:fish');
    expect(await f.gate.ensure(fish)).toBe(true);
    f.gate.again();
    expect(await f.gate.ensure(fish)).toBe(true);
    expect(f.ask).toHaveBeenCalledTimes(1);
  });

  it('lets a recipient through without asking when a yes was kept before, as on the next launch', async () => {
    const f = fixture();
    f.kept.add('provider:fish');
    expect(await f.gate.ensure(fish)).toBe(true);
    expect(f.ask).not.toHaveBeenCalled();
  });

  it('keeps nothing on a no, and holds it without asking until the person asks for something again', async () => {
    const f = fixture();
    const first = f.gate.ensure(fish);
    await f.answer(false);
    expect(await first).toBe(false);
    expect(f.keep).not.toHaveBeenCalled();
    // The read-ahead asking for the next sentences: no second alert.
    expect(await f.gate.ensure(fish)).toBe(false);
    expect(await f.gate.ensure(fish)).toBe(false);
    expect(f.ask).toHaveBeenCalledTimes(1);
    // Play pressed again: the question comes back.
    f.gate.again();
    const second = f.gate.ensure(fish);
    await f.answer(true);
    expect(await second).toBe(true);
    expect(f.ask).toHaveBeenCalledTimes(2);
  });

  it('lifts one refusal and leaves the others standing', async () => {
    const f = fixture();
    const a = f.gate.ensure(fish);
    await f.answer(false);
    const b = f.gate.ensure(youdao);
    await f.answer(false);
    expect([await a, await b]).toEqual([false, false]);
    f.gate.again('lookup:youdao');
    expect(await f.gate.ensure(fish)).toBe(false);
    const c = f.gate.ensure(youdao);
    await f.answer(true);
    expect(await c).toBe(true);
    expect(f.ask).toHaveBeenCalledTimes(3);
  });

  it('asks about each recipient on its own', async () => {
    const f = fixture();
    const a = f.gate.ensure(fish);
    const b = f.gate.ensure(youdao);
    await f.answer(true);
    await f.answer(false);
    expect([await a, await b]).toEqual([true, false]);
    expect(f.ask.mock.calls.map(([recipient]) => recipient.key)).toEqual(['provider:fish', 'lookup:youdao']);
  });

  it('takes a question that failed to be asked as a no', async () => {
    const kept = new Set<string>();
    const gate = createConsentGate({ kept: (key) => kept.has(key), keep: (key) => { kept.add(key); }, ask: async () => { throw new Error('no window'); } });
    expect(await gate.ensure(fish)).toBe(false);
    expect(kept.size).toBe(0);
  });
});
