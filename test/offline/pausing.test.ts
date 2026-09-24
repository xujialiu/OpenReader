import { describe, expect, it } from 'vitest';
import type { DownloadTask } from '../../src/offline/model';
import { goesOn, pauseAll, resumeAll, tapChapter } from '../../src/offline/pausing';

const task = (state: DownloadTask['state'], extra: Partial<DownloadTask> = {}): DownloadTask =>
  ({ id: 't', document: 'book', voice: { provider: 'fish', voice: 'A', label: 'A' }, chapters: ['a', 'b', 'c'], state, error: null, failed: [], ...extra });
const none = new Set<string>();

describe('a tap on one chapter’s ring (#56)', () => {
  it('pauses that chapter alone while the others go on', () => {
    for (const state of ['queued', 'preparing', 'downloading', 'waiting'] as const) {
      const t = task(state);
      tapChapter(t, 'a', none);
      expect(t).toMatchObject({ state, paused: ['a'] });
    }
  });
  it('resumes a chapter it paused without touching the others', () => {
    const t = task('downloading', { paused: ['a', 'c'] });
    tapChapter(t, 'a', none);
    expect(t).toMatchObject({ state: 'downloading', paused: ['c'] });
  });
  it('pauses the download when the last chapter going on is paused, counting neither complete nor failed ones', () => {
    const t = task('downloading', { paused: ['b'], failed: ['c'], error: 'An old failure' });
    tapChapter(t, 'a', none);
    expect(t).toMatchObject({ state: 'paused', error: null });
    const u = task('queued', { paused: ['b'] });
    tapChapter(u, 'c', new Set(['a']));
    expect(u.state).toBe('paused');
  });
  it('resumes a paused download with the tapped chapter alone, however the others were paused', () => {
    const one = task('paused', { paused: ['a', 'b', 'c'] });
    tapChapter(one, 'b', none);
    expect(one).toMatchObject({ state: 'queued', paused: ['a', 'c'] });
    // A download paused before chapters were paused one by one had no list of them: the others stay paused all the same.
    const all = task('paused');
    tapChapter(all, 'b', none);
    expect(all).toMatchObject({ state: 'queued', paused: ['a', 'c'] });
  });
  it('continues a download that stopped by itself as a whole, and the tapped chapter with it, leaving the other paused ones paused', () => {
    for (const state of ['blocked', 'interrupted'] as const) {
      const t = task(state, { paused: ['a', 'c'], error: 'Quota exceeded', failed: ['b'] });
      tapChapter(t, 'a', none);
      expect(t).toMatchObject({ state: 'queued', paused: ['c'], error: null, failed: [] });
      const u = task(state, { paused: ['a'] });
      tapChapter(u, 'b', none);
      expect(u).toMatchObject({ state: 'queued', paused: ['a'] });
    }
  });
  it('does nothing to a finished download', () => {
    const t = task('done');
    tapChapter(t, 'a', none);
    expect(t.state).toBe('done');
    expect(t.paused).toBeUndefined();
  });
});

describe('Pause all and Resume all (#56)', () => {
  it('offers Pause all while any chapter would go on by itself, including when some are paused', () => {
    for (const state of ['queued', 'preparing', 'downloading', 'waiting'] as const) expect(goesOn(task(state), none)).toBe(true);
    expect(goesOn(task('downloading', { paused: ['a', 'b'] }), none)).toBe(true);
  });
  it('offers Resume all once nothing goes on by itself', () => {
    for (const state of ['paused', 'blocked', 'interrupted', 'done'] as const) expect(goesOn(task(state), none)).toBe(false);
    expect(goesOn(task('queued', { paused: ['a', 'b', 'c'] }), none)).toBe(false);
    expect(goesOn(task('queued', { paused: ['a', 'b'], failed: ['c'] }), none)).toBe(false);
    expect(goesOn(task('queued', { paused: ['a', 'b'] }), new Set(['c']))).toBe(false);
  });
  it('Pause all pauses every chapter that has not failed', () => {
    const t = task('waiting', { paused: ['b'], failed: ['c'], error: 'No network connection, waiting to reconnect' });
    pauseAll(t);
    expect(t).toMatchObject({ state: 'paused', paused: ['a', 'b'], error: null });
  });
  it('Resume all resumes every chapter, including those paused one by one, and retries the failed ones', () => {
    const t = task('paused', { paused: ['a', 'b'], failed: ['c'] });
    resumeAll(t);
    expect(t).toMatchObject({ state: 'queued', paused: [], failed: [], error: null });
  });
});
