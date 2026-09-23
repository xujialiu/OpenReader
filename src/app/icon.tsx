import type { ColorValue } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

// One stroke weight and coordinate system. Transport follows Zotero-TTS's
// single/double chevrons and outlined play/pause, without font-dependent glyphs.
const paths = {
  play: 'M7 4.5 20 12 7 19.5Z',
  pause: 'M6 5h4v14H6z M14 5h4v14h-4z',
  previous: 'm15 6-6 6 6 6',
  next: 'm9 6 6 6-6 6',
  previousParagraph: 'm12 6-6 6 6 6 M19 6l-6 6 6 6',
  nextParagraph: 'm5 6 6 6-6 6 M12 6l6 6-6 6',
  down: 'm6 9 6 6 6-6',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  download: 'M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5',
  rename: 'm15 4 5 5 M4 20l5-1L21 7l-5-5L4 14v6Z',
  more: '',
  contents: 'M9 6h11 M9 12h11 M9 18h11',
  settings: 'M4 6h8 M16 6h4 M4 12h3 M11 12h9 M4 18h9 M17 18h3 M12 3v6 M7 9v6 M17 15v6',
  book: 'M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1v14',
  // A large A beside a small a, on one baseline. Drawn rather than set in
  // type: at 24 units the letters keep their proportions to each other at
  // every size, and nothing here can wrap.
  appearance: 'm3 16 4.5-9 4.5 9 M4 14h7 M21 14h-5 M16 16v-3.5a2.5 2.5 0 0 1 5 0V16',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  // Two chevrons, one up one down: what iOS puts on a row that opens a menu.
  menu: 'm8 10 4-4 4 4 M8 14l4 4 4-4',
  check: 'm5 12 4 4L19 6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  eyeOff: 'm3 3 18 18 M10.6 5.1 12 5c6.5 0 10 7 10 7a20 20 0 0 1-3 3.8 M6.2 6.2A22 22 0 0 0 2 12s3.5 7 10 7c1.7 0 3.3-.5 4.6-1.2 M9.9 9.9a3 3 0 0 0 4.2 4.2',
} as const;
export type IconName = keyof typeof paths;
/** `strokeWidth` is in the icon's own 24 units; the speed drawer's minus and plus are drawn heavier (#48). */
export function Icon({ name, color, size = 24, strokeWidth = 1.7 }: { name: IconName; color: ColorValue; size?: number; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" accessible={false}>
      <Path d={paths[name]} />
      {name === 'contents' ? [6, 12, 18].map((y) => <Circle key={y} cx={4} cy={y} r={1} fill={color} stroke="none" />) : null}
      {/* Three dots with a radius of their own. They used to be zero-length
          segments whose only width was the stroke, which made them 1.7 across
          inside a 22-point icon and the control read as faint rather than as
          three dots. */}
      {name === 'more' ? [5, 12, 19].map((x) => <Circle key={x} cx={x} cy={12} r={1.6} fill={color} stroke="none" />) : null}
    </Svg>
  );
}
