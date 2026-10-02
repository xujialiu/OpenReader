import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const source = (name: string) => readFileSync(new URL(`../../src/app/${name}`, import.meta.url), 'utf8');

// Wiring tripwires only. Native layout and visible glyphs are checked on device;
// full accessibility labels alone passed even when the pixels were clipped.
it('settings navigation and menu rows share complete, wrapping words (#62, #114)', () => {
  const controls = source('controls.tsx');
  const rows = controls.slice(controls.indexOf('export function ValueRow'), controls.indexOf('export function FieldRow'));
  expect(rows).not.toContain('numberOfLines={1}');
  expect(rows.match(/<RowWords /g)).toHaveLength(2);
  expect(source('drawer.tsx')).toContain('<RowWords ');
});
it('native menus get their height from laid-out content rather than a fixed row (#62)', () => {
  const controls = source('controls.tsx');
  const menu = controls.slice(controls.indexOf('export function ChoiceMenu'), controls.indexOf('export function Note'));
  expect(menu).toContain('onLayout');
  expect(menu).not.toContain('height: number');
  expect(controls).not.toContain('height={SETTINGS.rowHeight}');
});
it('the player can reflow and does not pin scaled text inside its old boxes (#101)', () => {
  const player = source('player.tsx');
  expect(player).toContain('playerLayout(');
  expect(player).not.toContain('height: 26');
  expect(player).not.toContain('style={styles.voiceLabel} numberOfLines={1}');
});
