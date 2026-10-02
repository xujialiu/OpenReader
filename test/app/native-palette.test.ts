import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pin } from '../structural';

const native = readFileSync(new URL('../../modules/open-reader-palette/ios/OpenReaderPaletteModule.swift', import.meta.url), 'utf8')
  .replace(/\/\/[^\n]*/g, '');
const page = readFileSync(new URL('../../src/app/highlight-section.tsx', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

// Native containment and presentation are not rendered by Vitest. These
// tripwires protect the boundary; real palette gestures are tested on iOS.
describe('the inline native Highlight palette (#122)', () => {
  it('uses the real system picker without a second presentation or private view manipulation', () => {
    pin(native, 'let picker = UIColorPickerViewController()', 'native palette');
    pin(native, 'picker.title = ""', 'native palette title');
    pin(native, 'picker.supportsEyedropper = false', 'native palette eyedropper');
    expect(native).not.toMatch(/\.present\(|\.subviews|value\(forKey|NSSelectorFromString/);
  });
  it('attaches and detaches the controller and delegate with the native view', () => {
    pin(native, 'parent.addChild(picker)', 'palette attach');
    pin(native, 'picker.didMove(toParent: parent)', 'palette attach completion');
    pin(native, 'picker.delegate = nil', 'palette detach callback');
    pin(native, 'picker.willMove(toParent: nil)', 'palette detach');
    pin(native, 'picker.removeFromParent()', 'palette detach completion');
  });
  it('refuses stale echoes rather than rewinding the native drag', () => {
    pin(native, 'guard selection.eventCount >= eventCount,', 'palette event acknowledgement');
    pin(native, 'eventCount += 1', 'palette native sequence');
    pin(native, 'onSelectionChange(["color": hex, "eventCount": eventCount])', 'palette native event');
    pin(page, 'selection={{ color: toPicker(level), eventCount }}', 'palette JS acknowledgement');
  });
  it('starts a fresh event sequence on a target switch and bounds the preview to one line', () => {
    pin(page, '<PaletteEditor key={target}', 'palette target lifetime');
    pin(page, 'testID="highlight-preview" numberOfLines={1}', 'palette preview');
    expect(page).not.toContain('adjustsFontSizeToFit');
    const scroll = page.indexOf('<DrawerScroll>');
    expect(page.indexOf('<PresetTiles')).toBeLessThan(scroll);
    expect(page.indexOf('testID="highlight-preview"')).toBeLessThan(scroll);
  });
});
