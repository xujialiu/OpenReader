import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HIGHLIGHT_COLOURS,
  fromPicker,
  HIGHLIGHT_PRESETS,
  presetOf,
  readHighlightColours,
  rgba,
  toPicker,
} from '../../src/renderer/highlight-colours';

describe('Highlight Colours (#118)', () => {
  it('offers the two looks the app has had, Blue at amber\'s opacities, and starts on Blue', () => {
    expect(HIGHLIGHT_PRESETS.amber).toEqual({ sentence: { color: '#ffc400', opacity: 22 }, word: { color: '#ffa800', opacity: 62 } });
    expect(HIGHLIGHT_PRESETS.blue).toEqual({ sentence: { color: '#434665', opacity: 22 }, word: { color: '#4456de', opacity: 62 } });
    expect(DEFAULT_HIGHLIGHT_COLOURS).toEqual(HIGHLIGHT_PRESETS.blue);
  });

  it('paints a level as rgba, its opacity a fraction', () => {
    expect(rgba(HIGHLIGHT_PRESETS.amber.sentence)).toBe('rgba(255, 196, 0, 0.22)');
    expect(rgba(HIGHLIGHT_PRESETS.blue.word)).toBe('rgba(68, 86, 222, 0.62)');
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
