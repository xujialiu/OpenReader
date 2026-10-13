import { describe, expect, it } from 'vitest';

import { FOLLOWING_STATE_MESSAGE, TAP_MESSAGE } from '../../src/renderer/messages';

import { standInPage, type Section, type StandInPage } from './stand-in-page';

/**
 * **A link in a Document is Browsing (#191).**
 *
 * One tap on a link used to be answered twice: epub.js followed it, and the
 * page also reported a tap on the link's text, so the Reading moved to the
 * link's sentence and the page came straight back from the link's target. The
 * owner's rule: a link moves the page and nothing else, as a Contents row does
 * (ADR 0044, ADR 0063). With the Player collapsed the page only follows and
 * nothing can start Browsing, so there the link is not followed and the tap
 * reads from its sentence like a tap on any other text.
 *
 * Run over the real page program and epub.js's own link handler; see
 * `stand-in-page.ts` for what is doubled.
 */

const BODY = '<p id="plain">Before the list.</p><p id="line"><a id="link" href="ch7.xhtml#x">Chapter Seven</a></p>';

function open(): { page: StandInPage; section: Section } {
  const page = standInPage();
  const section = page.addSection(5, BODY);
  page.sweep();
  return { page, section };
}

const taps = (page: StandInPage) => page.posted.filter((m) => m.type === TAP_MESSAGE);
const following = (page: StandInPage) => page.posted.filter((m) => m.type === FOLLOWING_STATE_MESSAGE).map((m) => m.following);

/** The Reading on the section's first sentence, as Play's first cue puts it there. */
function play(page: StandInPage, section: Section) {
  const block = page.blocks(section)[0];
  page.send({ kind: 'speak', utterance: 0, utteranceRanges: [{ block: block.id, start: 0, end: block.text.length, text: block.text }], words: null, durationMs: 60000, reveal: true });
}

/** The next sentence of a playing Reading begins, in the same section: a cue with `recover`, as use-reading sends every cue after Play's first. */
function nextSentence(page: StandInPage, section: Section) {
  const block = page.blocks(section)[0];
  page.send({ kind: 'speak', utterance: 1, utteranceRanges: [{ block: block.id, start: 0, end: 7, text: block.text.slice(0, 7) }], words: null, durationMs: 60000, recover: true });
}

describe('a tap in a section of the Document', () => {
  it('on plain text is a tap, and no link is followed', () => {
    const { page, section } = open();
    const event = page.click(section, section.document.getElementById('plain'));
    expect({ followed: page.followed, taps: taps(page), defaultPrevented: event.defaultPrevented, following: following(page) })
      .toEqual({ followed: [], taps: [{ type: TAP_MESSAGE, block: '5.0', offset: 1 }], defaultPrevented: false, following: [] });
  });

  it('on a link follows the link, posts no tap, and tells the Player it is Browsing', () => {
    const { page, section } = open();
    page.click(section, section.document.getElementById('link'));
    expect({ followed: page.followed, taps: taps(page), following: following(page) })
      .toEqual({ followed: ['/OEBPS/ch7.xhtml#x'], taps: [], following: [false] });
  });

  it('on a link while the Reading plays leaves the page at the link when the next sentence begins', () => {
    const { page, section } = open();
    play(page, section);
    page.click(section, section.document.getElementById('link'));
    // epub.js's display of the link's target replaces the section the Reading is in.
    page.destroy(section);
    const shown = page.displays.length;
    nextSentence(page, section);
    expect({ taps: taps(page), pulledBack: page.displays.slice(shown) }).toEqual({ taps: [], pulledBack: [] });
  });

  it('on a link is Browsing that the next revealed sentence ends, as after a Contents row', () => {
    const { page, section } = open();
    page.click(section, section.document.getElementById('link'));
    play(page, section);
    expect(following(page)).toEqual([false, true]);
  });

  it('on a link during a lookup leaves the page at the link when the lookup closes', () => {
    const { page, section } = open();
    play(page, section);
    page.send({ kind: 'lookup', enabled: true });
    page.select(section, 'Before');
    page.click(section, section.document.getElementById('link'));
    page.destroy(section);
    const shown = page.displays.length;
    page.send({ kind: 'lookup', close: true, resumeFollow: true });
    expect({ followed: page.followed, taps: taps(page), pulledBack: page.displays.slice(shown), following: following(page) })
      .toEqual({ followed: ['/OEBPS/ch7.xhtml#x'], taps: [], pulledBack: [], following: [false] });
  });

  it('on a link with the Player collapsed is not followed, and reads from the link’s sentence', () => {
    const { page, section } = open();
    page.send({ kind: 'followOnly', on: true });
    const event = page.click(section, section.document.getElementById('link'));
    expect({ followed: page.followed, taps: taps(page), defaultPrevented: event.defaultPrevented, following: following(page) })
      .toEqual({ followed: [], taps: [{ type: TAP_MESSAGE, block: '5.1', offset: 1 }], defaultPrevented: true, following: [] });
  });

  it('on a link with the Player opened again is followed as Browsing', () => {
    const { page, section } = open();
    page.send({ kind: 'followOnly', on: true });
    page.send({ kind: 'followOnly', on: false });
    page.click(section, section.document.getElementById('link'));
    expect({ followed: page.followed, taps: taps(page), following: following(page) })
      .toEqual({ followed: ['/OEBPS/ch7.xhtml#x'], taps: [], following: [false] });
  });
});
