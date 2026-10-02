import { describe, expect, it } from 'vitest';
import { editHighlight, type HighlightComponent } from '../../src/app/highlight-editor';
import { channels, HIGHLIGHT_PRESETS, presetOf } from '../../src/renderer/highlight-colours';

const blue = HIGHLIGHT_PRESETS.blue;

describe('inline Highlight edits', () => {
  it.each(['sentence', 'word'] as const)('changes only %s, keeping its opacity and the other mark', (target) => {
    const next = editHighlight(blue, target, 'red', 240);
    expect(next[target]).toEqual({ ...blue[target], color: target === 'sentence' ? '#f04665' : '#f056de' });
    expect(next[target === 'sentence' ? 'word' : 'sentence']).toBe(blue[target === 'sentence' ? 'word' : 'sentence']);
    expect(blue).toEqual({ sentence: { color: '#434665', opacity: 22 }, word: { color: '#4456de', opacity: 62 } });
    expect(presetOf(next)).toBeNull();
  });

  it.each(['red', 'green', 'blue'] as const)('reaches all 256 %s values without changing other channels', (component) => {
    const index = { red: 0, green: 1, blue: 2 }[component];
    for (let value = 0; value <= 255; value++) {
      const expected = channels(blue.word.color);
      expected[index] = value;
      const next = editHighlight(blue, 'word', component, value);
      expect(channels(next.word.color)).toEqual(expected);
      expect(next.word.opacity).toBe(62);
      expect(next.sentence).toBe(blue.sentence);
    }
  });

  it.each(['sentence', 'word'] as const)('allows every whole opacity including zero for %s', (target) => {
    for (let opacity = 0; opacity <= 100; opacity++) {
      const next = editHighlight(blue, target, 'opacity', opacity);
      expect(next[target]).toEqual({ color: blue[target].color, opacity });
      expect(next[target === 'sentence' ? 'word' : 'sentence']).toBe(blue[target === 'sentence' ? 'word' : 'sentence']);
    }
  });

  it('keeps the colour at zero opacity so making it visible again restores it', () => {
    const hidden = editHighlight(blue, 'word', 'opacity', 0);
    const restored = editHighlight(hidden, 'word', 'opacity', 62);
    expect(restored).toEqual(blue);
    expect(presetOf(restored)).toBe('blue');
  });

  it('preserves successive channel edits and re-identifies a restored preset', () => {
    const red = editHighlight(blue, 'sentence', 'red', 255);
    const green = editHighlight(red, 'sentence', 'green', 0);
    const custom = editHighlight(green, 'sentence', 'blue', 128);
    expect(custom.sentence).toEqual({ color: '#ff0080', opacity: 22 });
    const restored = editHighlight(editHighlight(editHighlight(custom, 'sentence', 'red', 67), 'sentence', 'green', 70), 'sentence', 'blue', 101);
    expect(presetOf(restored)).toBe('blue');
  });

  it.each<HighlightComponent>(['red', 'green', 'blue', 'opacity'])('clamps and rounds %s; ignores non-finite events', (component) => {
    const value = (raw: number) => {
      const next = editHighlight(blue, 'sentence', component, raw).sentence;
      return component === 'opacity' ? next.opacity : channels(next.color)[{ red: 0, green: 1, blue: 2 }[component]];
    };
    expect(value(-3)).toBe(0);
    expect(value(300)).toBe(component === 'opacity' ? 100 : 255);
    expect(value(18.6)).toBe(19);
    for (const invalid of [NaN, Infinity, -Infinity]) expect(editHighlight(blue, 'word', component, invalid)).toBe(blue);
  });

  it('does not emit an unchanged value', () => {
    expect(editHighlight(blue, 'word', 'red', 68)).toBe(blue);
    expect(editHighlight(blue, 'word', 'opacity', 62)).toBe(blue);
  });
});
