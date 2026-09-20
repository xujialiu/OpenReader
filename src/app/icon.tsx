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
  contents: 'M9 6h11 M9 12h11 M9 18h11',
  settings: 'M4 6h8 M16 6h4 M4 12h3 M11 12h9 M4 18h9 M17 18h3 M12 3v6 M7 9v6 M17 15v6',
  book: 'M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1v14',
  check: 'm5 12 4 4L19 6',
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, color, size = 24 }: { name: IconName; color: ColorValue; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" accessible={false}>
      <Path d={paths[name]} />
      {name === 'contents' ? [6, 12, 18].map((y) => <Circle key={y} cx={4} cy={y} r={1} fill={color} stroke="none" />) : null}
    </Svg>
  );
}
