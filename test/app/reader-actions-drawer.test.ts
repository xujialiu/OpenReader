import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { pin } from '../structural';

/**
 * A Document's actions drawer on the phone's sheet (#117 batch 2), as
 * tripwires over the source text, the shape `player-rules.test.ts` explains:
 * the drawer is React Native and SwiftUI, which this suite does not render
 * (`test/README.md`), and each rule below is one line whose loss fails
 * silently. The evidence is `notes/NOTES_2026-10-01.md`, 20:30 and 22:20.
 */

const SOURCE = new URL('../../src/app/', import.meta.url).pathname;

/** The code without its comments, which name the rules in the words they guard. */
function code(name: string): string {
  return readFileSync(SOURCE + name, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe("a Document's actions drawer (#117)", () => {
  it('goes back from every page to the page it was opened from: Fonts to Appearance, Manage to Download, the rest to the menu', () => {
    pin(code('reader-actions.tsx'),
      "const BACK = { menu: null, appearance: 'menu', fonts: 'appearance', download: 'menu', manage: 'download', move: 'menu' } as const;",
      'reader-actions.tsx BACK');
  });

  it('keeps the name on the left with Share on the menu only', () => {
    const actions = code('reader-actions.tsx');
    pin(actions, "{ titleLeft: true as const, title: entry.title, action: { icon: 'share' as const, label: 'Share'", 'reader-actions.tsx menu header');
  });

  it('cannot save a blank name: Save is disabled while it is blank, which Alert.prompt cannot do', () => {
    const alert = code('rename-alert.tsx');
    pin(alert, 'modifiers={[disabled(!typed.trim() || !!problem)]}', 'rename-alert.tsx Save');
    expect(alert).not.toMatch(/Alert\.prompt/);
  });

  it("puts Download's Select all in the header, and has no Back to downloads link now that Manage is a page", () => {
    const download = code('download-sheet.tsx');
    pin(download, 'onSelectAll({ label: allLabel, onPress: pressAll, disabled: noneEligible });', 'download-sheet.tsx Select all');
    expect(download).not.toContain('Back to downloads');
    pin(code('reader-actions.tsx'), "action: (page === 'download' || page === 'manage') && selectAll ? selectAll : undefined", 'reader-actions.tsx header action');
  });

  it('opens Download at the chapter being read, through the same list Contents opens with', () => {
    pin(code('download-sheet.tsx'), 'openAt={hereIndex > 0 ? hereIndex : null}', 'download-sheet.tsx openAt');
  });
});

describe('a list that ends the drawer runs on to the sheet’s bottom edge (#117, notes 20:30)', () => {
  it('lets the sheet’s content reach the edge, and pads the body and such a list by the safe area and DRAWER.bottom', () => {
    const drawer = code('drawer.tsx');
    pin(drawer, "ignoreSafeArea({ regions: 'container', edges: 'bottom' }),", 'drawer.tsx sheet content');
    pin(drawer, 'const bottom = insets.bottom + DRAWER.bottom;', 'drawer.tsx bottom');
    pin(drawer, "contentContainerStyle={[contentContainerStyle, ends && { paddingBottom: bottom }]}", 'drawer.tsx DrawerList');
  });
});
