/** Inline RGB/opacity edits for Highlight (#122), without changing the other mark. */
import { channels, type HighlightColours } from '../renderer/highlight-colours';

export type HighlightTarget = keyof HighlightColours;
export type HighlightComponent = 'red' | 'green' | 'blue' | 'opacity';

/** Native sliders can report fractions; storage uses bytes and whole percentages. */
export function editHighlight(colours: HighlightColours, target: HighlightTarget, component: HighlightComponent, value: number): HighlightColours {
  if (!Number.isFinite(value)) return colours;
  const level = colours[target];
  const bounded = Math.round(Math.max(0, Math.min(component === 'opacity' ? 100 : 255, value)));
  if (component === 'opacity') {
    return bounded === level.opacity ? colours : { ...colours, [target]: { ...level, opacity: bounded } };
  }
  const rgb = channels(level.color);
  const index = { red: 0, green: 1, blue: 2 }[component];
  if (rgb[index] === bounded) return colours;
  rgb[index] = bounded;
  const color = '#' + rgb.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return { ...colours, [target]: { ...level, color } };
}
