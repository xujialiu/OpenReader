import { afterEach, expect, it, vi } from 'vitest';
import { createRechecks, orderedRechecks, RecheckInterrupted, type RecheckSection } from '../../src/offline/rechecks';

afterEach(() => vi.useRealTimers());
const sections = [{ document: 'b', section: 0 }, { document: 'a', section: 1 }, { document: 'a', section: 4 }, { document: 'a', section: 0 }];
it('checks the open book from the Reading onward, then its beginning, then Library order', () => {
  expect(orderedRechecks(sections, ['b', 'a'], { document: 'a', section: 1 })).toEqual([
    { document: 'a', section: 1 }, { document: 'a', section: 4 }, { document: 'a', section: 0 }, { document: 'b', section: 0 },
  ]);
});
it('yields a timer turn per section, takes priority changes between sections, and never runs when disallowed', async () => {
  vi.useFakeTimers();
  let allowed = false;
  let current: RecheckSection | null = null;
  const prepared: RecheckSection[] = [];
  const runner = createRechecks({ allowed: () => allowed, sections: async () => sections, order: () => ['b', 'a'], current: () => current,
    prepare: async (s) => { prepared.push(s); }, failed: () => {} });
  runner.wake(); await vi.advanceTimersByTimeAsync(100);
  expect(prepared).toEqual([]);
  allowed = true; runner.wake(); await vi.advanceTimersByTimeAsync(25);
  expect(prepared).toEqual([{ document: 'b', section: 0 }]);
  current = { document: 'a', section: 4 };
  await vi.advanceTimersByTimeAsync(25);
  expect(prepared[1]).toEqual(current);
  runner.stop(); await vi.advanceTimersByTimeAsync(100);
  expect(prepared).toHaveLength(2);
});
it('bounds real failures, retries interruption, and tolerates a queue invalidation during rendering', async () => {
  vi.useFakeTimers();
  let allowed = true;
  const failed = vi.fn();
  let release!: () => void;
  const prepare = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => { release = r; }))
    .mockRejectedValueOnce(new RecheckInterrupted()).mockRejectedValue(new Error('bad book'));
  const runner = createRechecks({ allowed: () => allowed, sections: async () => [sections[0]], order: () => [], current: () => null, prepare, failed });
  runner.wake(); await vi.advanceTimersByTimeAsync(25);
  runner.retry(); release(); await vi.advanceTimersByTimeAsync(25);
  expect(failed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(25);
  expect(failed).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(prepare).toHaveBeenCalledTimes(3);
  allowed = false; runner.retry(); await vi.advanceTimersByTimeAsync(100);
  expect(prepare).toHaveBeenCalledTimes(3);
  runner.stop();
});
