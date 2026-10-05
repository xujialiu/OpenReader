import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HIGHLIGHT_COLOURS,
  fromPicker,
  HIGHLIGHT_PRESETS,
  HIGHLIGHT_PRESET_ORDER,
  presetOf,
  readHighlightColours,
  rgba,
  toPicker,
} from '../../src/renderer/highlight-colours';

describe('Highlight Colours (#118)', () => {
  it('offers balanced Blue and Amber for both themes, Blue first and by default', () => {
    expect(HIGHLIGHT_PRESETS.amber).toEqual({ sentence: { color: '#e4ad38', opacity: 18 }, word: { color: '#d99324', opacity: 38 } });
    expect(HIGHLIGHT_PRESETS.blue).toEqual({ sentence: { color: '#727bfa', opacity: 22 }, word: { color: '#727efa', opacity: 38 } });
    expect(HIGHLIGHT_PRESET_ORDER).toEqual(['blue', 'amber']);
    expect(DEFAULT_HIGHLIGHT_COLOURS).toEqual(HIGHLIGHT_PRESETS.blue);
  });

  it('paints a level as rgba, its opacity a fraction', () => {
    expect(rgba(HIGHLIGHT_PRESETS.amber.sentence)).toBe('rgba(228, 173, 56, 0.18)');
    expect(rgba(HIGHLIGHT_PRESETS.blue.word)).toBe('rgba(114, 126, 250, 0.38)');
    expect(rgba({ color: '#000000', opacity: 0 })).toBe('rgba(0, 0, 0, 0)');
  });

  it('reads the picker\'s #RRGGBBAA as a colour and a whole percent, and gives it back', () => {
    expect(fromPicker('#4456DE9E')).toEqual({ color: '#4456de', opacity: 62 });
    expect(fromPicker('#FFD60AD1')).toEqual({ color: '#ffd60a', opacity: 82 });
    expect(fromPicker('#ffffff')).toEqual({ color: '#ffffff', opacity: 100 });
    expect(fromPicker('red')).toBeNull();
    expect(toPicker({ color: '#4456de', opacity: 62 })).toBe('#4456de9e');
    expect(fromPicker(toPicker({ color: '#ffc400', opacity: 22 }))).toEqual({ color: '#ffc400', opacity: 22 });
  });

  it('keeps every whole opacity through the native RGBA bridge, including invisible and opaque', () => {
    for (let opacity = 0; opacity <= 100; opacity++) {
      const level = { color: '#4456de', opacity };
      expect(fromPicker(toPicker(level))).toEqual(level);
    }
  });

  it.each([
    { sentence: { color: '#5965a8', opacity: 22 }, word: { color: '#5c73e6', opacity: 44 } },
    { sentence: { color: '#434665', opacity: 22 }, word: { color: '#4456de', opacity: 62 } },
    { sentence: { color: '#434665', opacity: 60 }, word: { color: '#4456de', opacity: 50 } },
    { sentence: { color: '#ffc400', opacity: 22 }, word: { color: '#ffa800', opacity: 62 } },
  ])('keeps saved historical presets unchanged rather than silently adopting revised values', (original) => {
    expect(readHighlightColours(original)).toEqual(original);
    expect(presetOf(original)).toBeNull();
  });

  it('names a preset only when all four values are it', () => {
    expect(presetOf(HIGHLIGHT_PRESETS.amber)).toBe('amber');
    expect(presetOf(HIGHLIGHT_PRESETS.blue)).toBe('blue');
    expect(presetOf({ ...HIGHLIGHT_PRESETS.blue, word: { color: '#4456de', opacity: 61 } })).toBeNull();
    expect(presetOf({ sentence: HIGHLIGHT_PRESETS.amber.sentence, word: HIGHLIGHT_PRESETS.blue.word })).toBeNull();
  });

  it('reads a settings file: Blue for nothing, each half on its own, 0 kept, nothing malformed let through', () => {
    expect(readHighlightColours(undefined)).toEqual(DEFAULT_HIGHLIGHT_COLOURS);
    expect(readHighlightColours({ word: { color: '#FF0000', opacity: 0 } })).toEqual({
      sentence: DEFAULT_HIGHLIGHT_COLOURS.sentence, word: { color: '#ff0000', opacity: 0 },
    });
    expect(readHighlightColours({ sentence: { color: 'red; } body {', opacity: 140 }, word: { color: '#12345', opacity: '50' } })).toEqual({
      sentence: { color: DEFAULT_HIGHLIGHT_COLOURS.sentence.color, opacity: 100 },
      word: DEFAULT_HIGHLIGHT_COLOURS.word,
    });
  });

});
