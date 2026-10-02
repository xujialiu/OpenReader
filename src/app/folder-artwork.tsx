import { useId } from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { LIBRARY_ROW } from './library-row-layout';

/** The Library illustration, not the small action glyph: tab, back, paper edges and front face. */
export function FolderArtwork() {
  const id = useId().replace(/:/g, '');
  return <Svg width={LIBRARY_ROW.folder.width} height={LIBRARY_ROW.folder.height} viewBox="0 0 64 54" accessible={false}>
    <Defs>
      <LinearGradient id={`${id}-back`} x1="0%" y1="0%" x2="0%" y2="100%">
        <Stop offset="0" stopColor="#65c6ee" /><Stop offset="1" stopColor="#2698ca" />
      </LinearGradient>
      <LinearGradient id={`${id}-front`} x1="0%" y1="0%" x2="0%" y2="100%">
        <Stop offset="0" stopColor="#64cdf3" /><Stop offset="0.25" stopColor="#4bbde9" /><Stop offset="1" stopColor="#26a4d7" />
      </LinearGradient>
      <LinearGradient id={`${id}-paper`} x1="0%" y1="0%" x2="0%" y2="100%">
        <Stop offset="0" stopColor="#ffffff" /><Stop offset="1" stopColor="#c9e8f4" />
      </LinearGradient>
    </Defs>
    <Path d="M3 8Q3 4 7 4H22Q24 4 26 7L29 10H57Q61 10 61 14V45Q61 49 57 49H7Q3 49 3 45Z" fill={`url(#${id}-back)`} stroke="#157fac" strokeWidth={0.5} />
    <Path d="M5 15Q5 12 8 12H55Q58 12 58 15V39H5Z" fill="#dbf0f7" />
    <Path d="M6 17Q6 14 9 14H57Q59 14 59 17V42H6Z" fill={`url(#${id}-paper)`} />
    <Path d="M3 20Q3 17 7 17H57Q61 17 61 21V46Q61 50 57 50H7Q3 50 3 46Z" fill={`url(#${id}-front)`} stroke="#168cc0" strokeWidth={0.5} />
    <Path d="M7 18H57Q60 18 60 21" fill="none" stroke="#b5ecff" strokeWidth={1} opacity={0.8} />
    <Path d="M7 49H57" stroke="#167ca7" strokeWidth={0.6} opacity={0.4} />
  </Svg>;
}
