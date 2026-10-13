import { describe, expect, it } from 'vitest';

import { FOLLOWING_STATE_MESSAGE } from '../../src/renderer/messages';

import { standInPage, type Section, type StandInPage } from './stand-in-page';

/**
 * **epub.js keeping the text still under a finger is not a drag (#198).**
 *
 * `dragged()` measures how far a finger has travelled on the screen as its
 * `clientY` in the section document less the page's scroll since its first
 * move. epub.js scrolls the page itself in two places to keep the text where it
 * is: erasing a section above the page scrolls back by its height, and a
 * section prepended above scrolls on by its height once it has laid out. The
 * text and the finger then have not moved, `clientY` is unchanged, and the
 * scroll alone used to read as a drag of thousands of pixels: the next tremble
 * of a resting finger turned the Player's A to M.
 *
 * Run over the real page program, through the manager's own `erase` and
 * `counter` as the program wraps them; see `stand-in-page.ts` for what is
 * doubled. The section height is the 3,782 px ADR 0050 measured erased during a
 * Reading.
 */

function open(): { page: StandInPage; section: Section } {
  const page = standInPage();
  const section = page.addSection(5, '<p>A paragraph to rest a finger on.</p>');
  page.sweep();
  return { page, section };
}

const browsing = (page: StandInPage) => page.posted.filter((m) => m.type === FOLLOWING_STATE_MESSAGE).map((m) => m.following);

const sectionAbove = { bounds: () => ({ height: 3782 }) };

describe('a finger on the page while epub.js keeps the text still', () => {
  it('resting across an erase above the page starts no Browsing', () => {
    const { page, section } = open();
    page.touch(section, 'touchstart', [7, 300]);
    page.touch(section, 'touchmove', [7, 300]);
    page.touch(section, 'touchmove', [7, 301]);
    page.manager.erase(sectionAbove, [sectionAbove]);
    page.touch(section, 'touchmove', [7, 301]);
    page.touch(section, 'touchmove', [7, 302]);
    expect({ scrollTop: page.stage.scrollTop, browsing: browsing(page) }).toEqual({ scrollTop: 9000 - 3782, browsing: [] });
  });

  it('resting across a prepended section’s correction starts no Browsing', () => {
    const { page, section } = open();
    page.touch(section, 'touchstart', [7, 300]);
    page.touch(section, 'touchmove', [7, 300]);
    page.manager.counter({ heightDelta: 5000 });
    page.touch(section, 'touchmove', [7, 301]);
    expect({ scrollTop: page.stage.scrollTop, browsing: browsing(page) }).toEqual({ scrollTop: 9000 + 5000, browsing: [] });
  });

  it('dragging across an erase is still Browsing, by the distance the finger travelled', () => {
    const { page, section } = open();
    page.touch(section, 'touchstart', [7, 300]);
    page.touch(section, 'touchmove', [7, 300]);
    page.touch(section, 'touchmove', [7, 306]);
    page.manager.erase(sectionAbove, [sectionAbove]);
    page.touch(section, 'touchmove', [7, 309]);
    expect(browsing(page)).toEqual([]);
    page.touch(section, 'touchmove', [7, 340]);
    expect(browsing(page)).toEqual([false]);
  });

  it('erasing a section below the page scrolls nothing and changes nothing', () => {
    const { page, section } = open();
    page.touch(section, 'touchstart', [7, 300]);
    page.touch(section, 'touchmove', [7, 300]);
    page.manager.erase(sectionAbove);
    page.touch(section, 'touchmove', [7, 340]);
    expect({ scrollTop: page.stage.scrollTop, browsing: browsing(page) }).toEqual({ scrollTop: 9000, browsing: [false] });
  });

  it('a scroll that is not epub.js keeping the text still is measured as before: a glide under a held finger is no drag', () => {
    const { page, section } = open();
    page.touch(section, 'touchstart', [7, 300]);
    page.touch(section, 'touchmove', [7, 300]);
    page.stage.scrollTop += 36;
    page.touch(section, 'touchmove', [7, 336]);
    expect(browsing(page)).toEqual([]);
  });
});
