import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * #29, ADR 0046: **a border never takes a dynamic colour.**
 *
 * React Native's view resolves a dynamic colour against the view's own traits
 * for its background and not for its border, which answers for whatever the
 * process's traits are when it is repainted — the phone's, not the theme the
 * owner chose. So `borderTopColor: INK.line` is right or wrong depending on
 * which repaint came last: measured on 2026-09-24, the same drawer came out in
 * the light theme's grey on a dark drawer when opened by the `...` and in the
 * dark one when opened by a long press. A border takes `useBorders()`'s plain
 * string instead.
 *
 * Source text and not a type, because both spellings type-check: `ColorValue`
 * takes a dynamic colour and a string alike, and the wrong one only shows on a
 * phone whose appearance differs from the app's theme.
 */

const SOURCE = join(__dirname, '..', '..', 'src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Without comments, which explain the rule in the words it forbids. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every border or outline colour written in `text`, as `property: value`. */
function borderColours(text: string): string[] {
  return [...code(text).matchAll(/\b(border\w*Color|outlineColor)\s*:\s*([^,}\n]+)/g)].map((m) => `${m[1]}: ${m[2].trim()}`);
}

/** The ones that are a dynamic colour: an `INK` entry, or one made on the spot. */
const dynamic = (text: string): string[] =>
  borderColours(text).filter((found) => /\bINK\.|\bink\(|DynamicColorIOS|PlatformColor/.test(found));

describe('#29: no border takes a dynamic colour', () => {
  const files = sourceFiles(SOURCE);

  it('finds the borders it checks, so a pattern that matches nothing cannot pass for a clean tree', () => {
    const found = files.flatMap((path) => borderColours(readFileSync(path, 'utf8')));
    // Fewer than there were: #117's drawers draw their lines as filled views, not borders.
    // The player's outline and the drawer's round buttons' rim are borders still.
    expect(found.length).toBeGreaterThanOrEqual(2);
  });

  it('fires on the spellings #29 was drawn with', () => {
    expect(dynamic("sheet: { backgroundColor: INK.panel, borderTopColor: INK.line, borderTopWidth: 1 }")).toEqual(['borderTopColor: INK.line']);
    expect(dynamic('style={[styles.chip, { borderColor: chosen ? INK.text : INK.line }]}')).toHaveLength(1);
    expect(dynamic("{ borderBottomColor: DynamicColorIOS({ light: '#fff', dark: '#000' }) }")).toHaveLength(1);
    expect(dynamic('{ borderBottomColor: borders.line }')).toEqual([]);
  });

  it('holds every border under src/ to useBorders()', () => {
    const offenders = files.flatMap((path) =>
      dynamic(readFileSync(path, 'utf8')).map((found) => `${path.slice(SOURCE.length + 1)}: ${found}`),
    );
    expect(offenders).toEqual([]);
  });
});
