import { useState } from 'react';
import { StyleSheet, Text, type StyleProp, type TextLayoutEvent, type TextProps, type TextStyle } from 'react-native';

import { wordCuts } from './name-lines';

/** The cuts a name's layout offered, how many have been found not to fit, and the one that did. */
interface Cutting { name: string; cuts: readonly string[]; tried: number; shown: string | null }

/**
 * A Document's name on at most `lines` lines, cut after a whole word (design
 * 0060): the Library's rows and the reader's title.
 *
 * The phone can only cut after a letter. So an unseen copy of the name, laid
 * out at the same width with no line limit, says where the lines break, and
 * `wordCuts` turns that into the cuts to try, longest first. A second unseen
 * copy lays each out in turn, and the first that stays within `lines` is shown.
 * Until one has, and when none does, the phone's own cut stands. VoiceOver is
 * given the whole name, never the cut one.
 *
 * `width` is for a name whose own box shrinks to its words, as a centred title
 * does: the copies must be laid out at the width the name may take, not at the
 * width the cut name ended up taking, or each cut would move the next. Without
 * it, the copies fill the parent, which must then be as wide as the name may
 * be. Either way they are placed absolutely, in whatever the name sits in.
 */
export function NameText({ name, lines, style, width, allowFontScaling, ...rest }: {
  name: string; lines: number; style?: StyleProp<TextStyle>; width?: number;
} & Omit<TextProps, 'children' | 'numberOfLines' | 'style' | 'onTextLayout'>) {
  const [cutting, setCutting] = useState<Cutting | null>(null);
  const current = cutting?.name === name ? cutting : null;
  const trying = current && current.shown === null ? current.cuts[current.tried] : undefined;
  const copy = [style, styles.copy, width === undefined ? styles.fill : { width }];
  const laidOut = (event: TextLayoutEvent) => {
    const cuts = wordCuts(event.nativeEvent.lines.map((line) => line.text), lines);
    setCutting((was) => was?.name === name && same(was.cuts, cuts) ? was : { name, cuts, tried: 0, shown: null });
  };
  const tried = (cut: string) => (event: TextLayoutEvent) => {
    const fits = event.nativeEvent.lines.length <= lines;
    setCutting((was) => was?.name !== name || was.shown !== null || was.cuts[was.tried] !== cut ? was
      : fits ? { ...was, shown: cut } : { ...was, tried: was.tried + 1 });
  };
  return <>
    <Text accessibilityLabel={name} {...rest} allowFontScaling={allowFontScaling} numberOfLines={lines} style={style}>{current?.shown ?? name}</Text>
    <Text style={copy} allowFontScaling={allowFontScaling} pointerEvents="none" accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants" onTextLayout={laidOut}>{name}</Text>
    {trying === undefined ? null : <Text key={trying} style={copy} allowFontScaling={allowFontScaling} pointerEvents="none"
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onTextLayout={tried(trying)}>{trying}</Text>}
  </>;
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((cut, i) => cut === b[i]);
}

const styles = StyleSheet.create({
  copy: { left: 0, opacity: 0, position: 'absolute', top: 0 },
  fill: { right: 0 },
});
