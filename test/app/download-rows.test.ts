import { describe, expect, it } from 'vitest';
import { listedInManage, marker, type Marker } from '../../src/app/download-rows';
import type { Chapter, DownloadTask } from '../../src/offline/model';

const chapter = (id: string, textCount = 17, prepared = true): Chapter => ({ id, title: id, depth: 0, parent: null, texts: [], textCount, prepared });
const task = (state: DownloadTask['state'], chapters: string[], extra: Partial<DownloadTask> = {}): DownloadTask =>
  ({ id: 't', document: 'book', voice: { provider: 'fish', voice: 'A', label: 'A' }, chapters, state, error: null, failed: [], ...extra });
const saved = (count: number, complete = false) => ({ id: 'x', count, complete });

describe('what a chapter row shows in Downloads', () => {
  it('an untouched chapter is a checkbox and a complete one a check', () => {
    expect(marker(chapter('a'), undefined, undefined, false)).toEqual({ kind: 'checkbox' });
    expect(marker(chapter('a'), saved(17, true), undefined, false)).toEqual({ kind: 'check' });
  });
  it('a chapter of a running download is a ring with its saved fraction, empty while it waits its turn', () => {
    const t = task('downloading', ['a', 'b'], { current: 'a' });
    expect(marker(chapter('a'), saved(3), t, false)).toEqual({ kind: 'ring', fraction: 3 / 17, spinning: false, halted: false });
    expect(marker(chapter('b'), undefined, t, false)).toEqual({ kind: 'ring', fraction: 0, spinning: false, halted: false });
    expect(marker(chapter('b', 0, false), undefined, t, false)).toMatchObject({ kind: 'ring', fraction: 0, spinning: false });
  });
  it('spins only on the chapter whose text is being counted', () => {
    const t = task('preparing', ['a', 'b'], { current: 'a' });
    expect(marker(chapter('a', 0, false), undefined, t, false)).toMatchObject({ kind: 'ring', spinning: true });
    expect(marker(chapter('b', 0, false), undefined, t, false)).toMatchObject({ kind: 'ring', spinning: false });
  });
  it('holds the triangle while the download waits for the owner and the square while it goes on by itself', () => {
    for (const state of ['paused', 'blocked', 'interrupted'] as const)
      expect(marker(chapter('a'), saved(3), task(state, ['a']), false)).toMatchObject({ kind: 'ring', halted: true });
    for (const state of ['queued', 'preparing', 'downloading', 'waiting'] as const)
      expect(marker(chapter('a'), saved(3), task(state, ['a']), false)).toMatchObject({ kind: 'ring', halted: false });
  });
  it('a failed chapter and a finished download go back to the checkbox', () => {
    expect(marker(chapter('a'), saved(3), task('downloading', ['a', 'b'], { failed: ['a'], current: 'b' }), false)).toEqual({ kind: 'checkbox' });
    expect(marker(chapter('a'), saved(3), task('done', ['a']), false)).toEqual({ kind: 'checkbox' });
  });
  it('a complete chapter is a check even inside a running download', () => {
    expect(marker(chapter('a'), saved(17, true), task('downloading', ['a', 'b'], { current: 'b' }), false)).toEqual({ kind: 'check' });
  });
});

describe('what Manage downloads lists', () => {
  it('lists saved audio, complete or partial, as a checkbox and nothing else', () => {
    expect(marker(chapter('a'), saved(17, true), undefined, true)).toEqual({ kind: 'checkbox' });
    expect(marker(chapter('a'), saved(3), undefined, true)).toEqual({ kind: 'checkbox' });
    expect(marker(chapter('a'), saved(0), undefined, true)).toBeNull();
    expect(marker(chapter('a'), undefined, undefined, true)).toBeNull();
  });
  it('shows the ring only on the chapter being written; the rest of the download is a checkbox with audio and absent without', () => {
    const t = task('downloading', ['a', 'b', 'c'], { current: 'a' });
    expect(marker(chapter('a'), saved(3), t, true)).toMatchObject({ kind: 'ring', fraction: 3 / 17, halted: false });
    expect(marker(chapter('b'), saved(5), t, true)).toEqual({ kind: 'checkbox' });
    expect(marker(chapter('c'), undefined, t, true)).toBeNull();
  });
  it('shows no ring while nothing is being written, even on the chapter a restored download still names', () => {
    for (const state of ['queued', 'waiting'] as const)
      expect(marker(chapter('a'), saved(3), task(state, ['a', 'b'], { current: 'a' }), true)).toEqual({ kind: 'checkbox' });
    expect(marker(chapter('b'), undefined, task('queued', ['a', 'b'], { current: 'b' }), true)).toBeNull();
  });
  it('a paused download leaves its partial chapters deletable and its untouched ones unlisted', () => {
    const t = task('paused', ['a', 'b'], { current: null });
    expect(marker(chapter('a'), saved(3), t, true)).toEqual({ kind: 'checkbox' });
    expect(marker(chapter('b'), undefined, t, true)).toBeNull();
  });
  it('the chapter being counted is listed by its spinning ring although nothing is saved yet', () => {
    expect(marker(chapter('a', 0, false), undefined, task('preparing', ['a'], { current: 'a' }), true)).toMatchObject({ kind: 'ring', spinning: true });
  });
});

describe('which rows Manage downloads lists', () => {
  const heading = (id: string, parent: string | null = null): Chapter => ({ id, title: id, depth: parent ? 1 : 0, parent, texts: [], textCount: 0 });
  const under = (id: string, parent: string): Chapter => ({ ...chapter(id), depth: 1, parent });
  const plan = [heading('Volume 1'), under('c1', 'Volume 1'), under('c2', 'Volume 1'), heading('Volume 2'), under('c3', 'Volume 2')];
  const markers = (of: Record<string, Marker | null>) => new Map(plan.map((c) => [c.id, of[c.id] ?? null]));
  it('lists a heading only above a listed chapter, and never an untouched sibling', () => {
    expect([...listedInManage(plan, markers({ c1: { kind: 'checkbox' } }))]).toEqual(['c1', 'Volume 1']);
  });
  it('lists nothing when nothing has a marker', () => {
    expect(listedInManage(plan, markers({})).size).toBe(0);
  });
  it('lists a nested heading chain once, up to the top', () => {
    const deep = [...plan, heading('Part A', 'Volume 2'), under('c4', 'Part A')];
    const seen = listedInManage(deep, new Map(deep.map((c) => [c.id, c.id === 'c4' ? { kind: 'ring', fraction: 0.5, spinning: false, halted: false } as Marker : null])));
    expect([...seen].sort()).toEqual(['Part A', 'Volume 2', 'c4']);
  });
});
