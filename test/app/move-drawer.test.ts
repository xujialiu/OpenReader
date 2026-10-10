import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { pin } from '../structural';

/**
 * The move drawer as Files draws its Move sheet (#151, notes 2026-10-10
 * 13:42), as tripwires over the source text, the shape
 * `reader-actions-drawer.test.ts` explains: the drawer is React Native on a
 * SwiftUI sheet, which this suite does not render. What `Move` may do in each
 * folder is `moveChoice`'s, tested in `test/core/folders.test.ts`.
 */

const SOURCE = new URL('../../src/app/', import.meta.url).pathname;

/** The code without its comments, which name the rules in the words they guard. */
function code(name: string): string {
  return readFileSync(SOURCE + name, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the move drawer (#151)', () => {
  it("puts Move in the header's right end, as the page's prominent action, and nowhere in the list", () => {
    const actions = code('folder-actions.tsx');
    pin(actions, "action: { label: 'Move', prominent: true, disabled: !canMove || busy || !!problem, onPress: move },", 'folder-actions.tsx Move');
    expect(actions).not.toContain('Move here');
  });

  it('goes up a folder with the header back button, and leaves the page at the root only through onLeave', () => {
    const actions = code('folder-actions.tsx');
    pin(actions, 'onBack: current !== null ? () => setDestination(parent) : onLeave,', 'folder-actions.tsx back');
    expect(actions).not.toMatch(/icon="previous"/);
  });

  it('lists every Folder moveChoice gives, a Folder being moved included', () => {
    const actions = code('folder-actions.tsx');
    pin(actions, '{folders.map((folder) =>', 'folder-actions.tsx list');
    expect(actions).not.toMatch(/forbidden/);
  });

  it("says a refusal in the phone's alert, not under the list", () => {
    pin(code('folder-actions.tsx'), "catch (error) { Alert.alert('Could not move', describe(error)); }", 'folder-actions.tsx refusal');
  });

  it('opens at the entries\u2019 own folder from each of its three ways in', () => {
    pin(code('folder-actions.tsx'), 'onPress={() => { move.restart(); setMoving(true); }}', 'Folder actions');
    pin(code('reader-actions.tsx'), "onPress={() => { move.restart(); setPage('move'); }}", 'Document actions');
    pin(code('library-screen.tsx'), 'onPress={() => { move.restart(); selection.openMove(); }}', 'selection');
  });
});

describe('another entry touched behind the open drawer (#151)', () => {
  it("starts that entry's actions at their menu, with the move page's place forgotten", () => {
    pin(code('reader-actions.tsx'), "setShown(document); setPage('menu'); setRenaming(false); setUnshared(null); setSelectAll(null); move.restart();", 'reader-actions.tsx subject');
    pin(code('folder-actions.tsx'), 'setShown(id); setMoving(false); setNaming(false); setFailure(null); move.restart();', 'folder-actions.tsx subject');
  });
});

describe("the header's prominent capsule and a disabled row (#151)", () => {
  it("sets the word in the App Colour on the plain capsule while it can act, and draws Files' grey capsule with a white word, unfaded, while it cannot", () => {
    const drawer = code('drawer.tsx');
    pin(drawer, 'inactive ? { backgroundColor: colours.inactive, borderColor: colours.inactive } : { backgroundColor: colours.button, borderColor: colours.rim },', 'drawer.tsx capsule');
    pin(drawer, '(pressed || (disabled && !prominent)) && styles.dimmed]}>', 'drawer.tsx capsule fade');
    pin(drawer, '{ color: inactive ? colours.inactiveText : accent.onMark }', 'drawer.tsx capsule word');
    pin(drawer, "inactive: '#d6d6d6', inactiveText: '#ffffff',", 'drawer.tsx light inactive');
    pin(drawer, "inactive: '#505052', inactiveText: '#ffffff',", 'drawer.tsx dark inactive');
    expect(drawer).not.toContain('accent.reading, borderColor: accent.reading');
  });

  it("draws a disabled row as the phone does, at the tertiary label's 30 %", () => {
    const drawer = code('drawer.tsx');
    pin(drawer, '<View style={[styles.rowLine, disabled && styles.rowDisabled]}>', 'drawer.tsx disabled row');
    pin(drawer, 'rowDisabled: { opacity: 0.3 },', 'drawer.tsx rowDisabled');
    expect(code('contents-sheet.tsx')).not.toContain('unreachable &&');
  });
});
