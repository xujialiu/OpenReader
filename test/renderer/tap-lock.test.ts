import { describe, expect, it } from 'vitest';

import { FOLLOWING_STATE_MESSAGE, SELECTION_MESSAGE, TAP_MESSAGE } from '../../src/renderer/messages';

import { standInPage, type Section, type StandInPage } from './stand-in-page';

/**
 * **The Tap Lock (#325).** While it is on, a tap on the page does nothing: a
 * tap on text posts no tap, so the Reading does not move, and a tap on a link
 * is stopped before epub.js's own handler can follow it, with the Player open
 * or collapsed. A finger dragging the page is still Browsing, and the long
 * press of Word Lookup still selects.
 *
 * Run over the real page program and epub.js's own link handler; see
 * `stand-in-page.ts` for what is doubled.
 */

const BODY = '<p id="plain">A line of plain words to tap on.</p><p id="line"><a id="link" href="ch7.xhtml#x">Chapter Seven</a></p>';

function open(): { page: StandInPage; section: Section } {
  const page = standInPage();
  const section = page.addSection(5, BODY);
  page.sweep();
  return { page, section };
}

const taps = (page: StandInPage) => page.posted.filter((m) => m.type === TAP_MESSAGE);
const following = (page: StandInPage) => page.posted.filter((m) => m.type === FOLLOWING_STATE_MESSAGE).map((m) => m.following);

describe('with the Tap Lock on', () => {
  it('a tap on text does nothing', () => {
    const { page, section } = open();
    page.send({ kind: 'tapLock', on: true });
    page.click(section, section.document.getElementById('plain'));
    expect({ taps: taps(page), following: following(page) }).toEqual({ taps: [], following: [] });
  });

  it('a tap on a link is not followed and reads nothing', () => {
    const { page, section } = open();
    page.send({ kind: 'tapLock', on: true });
    const event = page.click(section, section.document.getElementById('link'));
    expect({ followed: page.followed, taps: taps(page), following: following(page), defaultPrevented: event.defaultPrevented })
      .toEqual({ followed: [], taps: [], following: [], defaultPrevented: true });
  });

  it('with the Player collapsed, neither a tap on text nor one on a link does anything', () => {
    const { page, section } = open();
    page.send({ kind: 'followOnly', on: true });
    page.send({ kind: 'tapLock', on: true });
    page.click(section, section.document.getElementById('plain'));
    page.click(section, section.document.getElementById('link'));
    expect({ followed: page.followed, taps: taps(page) }).toEqual({ followed: [], taps: [] });
  });

  it('a finger dragging the page is still Browsing', () => {
    const { page, section } = open();
    page.send({ kind: 'tapLock', on: true });
    page.touch(section, 'touchstart', [7, 300]);
    page.touch(section, 'touchmove', [7, 300]);
    page.touch(section, 'touchmove', [7, 360]);
    expect(following(page)).toEqual([false]);
  });

  it('a long press still selects a word to look up', () => {
    const { page, section } = open();
    page.send({ kind: 'lookup', enabled: true });
    page.send({ kind: 'tapLock', on: true });
    page.select(section, 'plain');
    expect(page.posted.filter((m) => m.type === SELECTION_MESSAGE).map((m) => m.text)).toContain('plain');
  });
});

describe('with the Tap Lock off again', () => {
  it('a tap on text reads from there, and a link is followed', () => {
    const { page, section } = open();
    page.send({ kind: 'tapLock', on: true });
    page.send({ kind: 'tapLock', on: false });
    page.click(section, section.document.getElementById('plain'));
    page.click(section, section.document.getElementById('link'));
    expect({ followed: page.followed, taps: taps(page) })
      .toEqual({ followed: ['/OEBPS/ch7.xhtml#x'], taps: [{ type: TAP_MESSAGE, block: '5.0', offset: 1 }] });
  });
});
