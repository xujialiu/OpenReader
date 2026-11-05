import { expect, it } from 'vitest';
import { emptyChapters, finishSelection, selectionComplete } from '../../src/offline/completion';
import type { DownloadTask, NarrationPlan } from '../../src/offline/model';

const task: DownloadTask = { id: 't', document: 'book', voice: { provider: 'fish', voice: 'v', label: 'V' }, state: 'paused', chapters: ['one'], failed: [], error: null };
const plan: NarrationPlan = { version: 2, chapters: [
  { id: 'one', title: 'One', depth: 0, parent: null, prepared: true, texts: [], textCount: 1 },
  { id: 'empty', title: 'Empty', depth: 0, parent: null, prepared: true, texts: [], textCount: 0 },
  { id: 'unknown', title: 'Unknown', depth: 0, parent: null, prepared: false, texts: [], textCount: 0 },
] };

it('treats only inspected parts with no text as empty', () => {
  expect([...emptyChapters(plan)]).toEqual(['empty']);
  expect([...emptyChapters(null)]).toEqual([]);
});
it('requires all selected chapters, not merely those present in the progress response', () => {
  expect(selectionComplete(task, plan, new Set())).toBe(false);
  expect(selectionComplete(task, plan, new Set(['one']))).toBe(true);
  expect(selectionComplete({ ...task, chapters: ['one', 'empty'] }, plan, new Set(['one']))).toBe(true);
  expect(selectionComplete({ ...task, chapters: ['one', 'unknown'] }, plan, new Set(['one']))).toBe(false);
  expect(selectionComplete({ ...task, chapters: ['one', 'missing'] }, plan, new Set(['one']))).toBe(false);
  expect(selectionComplete(task, null, new Set())).toBe(false);
});
it('does not turn a Recheck hold or a failure into evidence of saved audio', () => {
  expect(selectionComplete({ ...task, recheckHeld: ['one'] }, plan, new Set())).toBe(false);
  expect(selectionComplete({ ...task, failed: ['one'] }, plan, new Set())).toBe(false);
});
it('finishes without changing audio ownership or releasing Recheck holds', () => {
  const finished: DownloadTask = { ...task, paused: ['one'], failed: ['one'], error: 'Old failure', recheckHeld: ['one'] };
  finishSelection(finished);
  expect(finished).toMatchObject({ state: 'done', paused: [], failed: [], error: null, chapters: ['one'], recheckHeld: ['one'] });
});
