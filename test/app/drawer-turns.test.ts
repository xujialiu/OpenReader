import { describe, expect, it } from 'vitest';

import { createDrawerTurns } from '../../src/app/drawer-turns';

/**
 * One drawer at a time (#117, Q43): a drawer asked for while another is up
 * closes that one and is presented once its dismissal has finished.
 */
function setUp() {
  const turns = createDrawerTurns();
  const closed: string[] = [];
  let changes = 0;
  turns.subscribe(() => { changes += 1; });
  /** What an owner's `onClose` does: the drawer leaves. */
  const ask = (id: string) => turns.ask(id, () => { closed.push(id); turns.leave(id); });
  return { turns, closed, ask, changes: () => changes };
}

describe('one drawer at a time (#117)', () => {
  it('lets the first drawer up at once', () => {
    const { turns, ask, changes } = setUp();
    ask('contents');
    expect(turns.isUp('contents')).toBe(true);
    expect(changes()).toBe(1);
  });

  it('closes the drawer that is up, and presents the next only once that one is gone', () => {
    const { turns, ask, closed } = setUp();
    ask('contents');
    ask('actions');
    expect(closed).toEqual(['contents']);
    expect(turns.isUp('contents')).toBe(false);
    expect(turns.isUp('actions')).toBe(false);
    turns.gone('contents');
    expect(turns.isUp('actions')).toBe(true);
  });

  it('frees the turn when the drawer up is closed and gone, so the next asks straight up (the stuck More actions)', () => {
    const { turns, ask } = setUp();
    ask('contents');
    turns.leave('contents');
    turns.gone('contents');
    ask('actions');
    expect(turns.isUp('actions')).toBe(true);
  });

  it('takes a dismissal reported before the owner closes it, and waits for the close', () => {
    // A swipe: BottomSheet's onDismiss comes before onIsPresentedChange(false).
    const { turns, ask } = setUp();
    ask('contents');
    turns.gone('contents');
    expect(turns.isUp('contents')).toBe(true);
    turns.leave('contents');
    turns.gone('contents');
    ask('actions');
    expect(turns.isUp('actions')).toBe(true);
  });

  it('ignores a second report of the same dismissal', () => {
    const { turns, ask } = setUp();
    ask('contents');
    ask('actions');
    turns.gone('contents');
    turns.gone('contents');
    expect(turns.isUp('actions')).toBe(true);
  });

  it('brings back a drawer asked for again while it is still going down', () => {
    const { turns, ask } = setUp();
    ask('contents');
    turns.leave('contents');
    ask('contents');
    expect(turns.isUp('contents')).toBe(false);
    turns.gone('contents');
    expect(turns.isUp('contents')).toBe(true);
    turns.gone('contents');
    expect(turns.isUp('contents')).toBe(true);
  });

  it('keeps only the latest drawer waiting, closing the one that waited before it', () => {
    const { turns, ask, closed } = setUp();
    ask('contents');
    ask('actions');
    ask('voice');
    expect(closed).toEqual(['contents', 'actions']);
    turns.gone('contents');
    expect(turns.isUp('actions')).toBe(false);
    expect(turns.isUp('voice')).toBe(true);
  });

  it('forgets a waiting drawer whose owner gave up on it', () => {
    const { turns, ask } = setUp();
    ask('contents');
    ask('actions');
    turns.leave('actions');
    turns.gone('contents');
    expect(turns.isUp('actions')).toBe(false);
    ask('voice');
    expect(turns.isUp('voice')).toBe(true);
  });

  it('frees the turn of a drawer unmounted while it was up (the reader left with a drawer open)', () => {
    const { turns, ask } = setUp();
    ask('contents');
    turns.leave('contents');
    turns.gone('contents');
    ask('actions');
    expect(turns.isUp('actions')).toBe(true);
  });

  it('does not close a drawer that asks again while it is up', () => {
    const { turns, ask, closed } = setUp();
    ask('contents');
    ask('contents');
    expect(closed).toEqual([]);
    expect(turns.isUp('contents')).toBe(true);
  });
});
