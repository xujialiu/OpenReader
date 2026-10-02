/** Highlight's page (#122): a pinned sample, presets and target above the system palette. */
import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { NativePalette } from '../../modules/open-reader-palette';
import {
  fromPicker, HIGHLIGHT_PRESET_LABELS, HIGHLIGHT_PRESET_ORDER, HIGHLIGHT_PRESETS, presetOf, toPicker,
  type HighlightColour, type HighlightColours,
} from '../renderer/highlight-colours';
import { READING_FONTS, type Appearance } from '../renderer/highlighter';
import { DRAWER, DrawerScroll, useDrawerColours } from './drawer';
import { HIGHLIGHT_PAGE, paintOver, sentencePaint, wordPaint } from './highlight-paint';
import { TEXT } from './text-styles';

/** The owner's original Aa tiles, measured for #118 (notes, 2026-10-02 10:05). */
const TILE = { gap: 13, height: 30, width: 60, radius: 6, ring: 2, ringGap: 1.5 } as const;

export function HighlightPage({ appearance, onChange }: { appearance: Appearance; onChange(next: Appearance): void }) {
  const colours = useDrawerColours();
  const { fontScale } = useWindowDimensions();
  const page = HIGHLIGHT_PAGE[colours.scheme];
  const highlight = appearance.highlight;
  const [target, setTarget] = useState<keyof HighlightColours>('sentence');
  const [width, setWidth] = useState(0);
  const fontFamily = READING_FONTS.find((font) => font.id === appearance.font)?.preview ?? undefined;
  const set = (next: HighlightColours) => onChange({ ...appearance, highlight: next });
  // Shorten the words, never the font: retain an unmarked sentence, a marked
  // sentence and a word inside it, even at accessibility text sizes.
  const short = fontScale > 1.5 || (width > 0 && width < 340);
  const sample = short ? { read: 'Go. ', sentence: 'We ', word: 'run' }
    : { read: 'Rain fell. ', sentence: 'Birds ', word: 'sang' };
  return <View style={styles.page} testID="highlight-page" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    <View style={styles.pinned}>
      <View style={[styles.sample, { backgroundColor: page.page }]}>
        <Text testID="highlight-preview" numberOfLines={1} style={[styles.sampleText, { color: page.text, fontFamily }]}>
          {sample.read}<Text style={{ backgroundColor: sentencePaint(page.page, highlight) }}>
            {sample.sentence}<Text style={{ backgroundColor: wordPaint(page.page, highlight) }}>{sample.word}</Text>.
          </Text>
        </Text>
      </View>
      <PresetTiles highlight={highlight} page={page} fontFamily={fontFamily} onChoose={set} />
      <Host matchContents={{ vertical: true }} colorScheme={colours.scheme} style={styles.modes}>
        <Picker label="Highlight" selection={target} onSelectionChange={(next) => {
          if (next === 'sentence' || next === 'word') setTarget(next);
        }} modifiers={[pickerStyle('segmented')]}>
          <SwiftText modifiers={[tag('sentence')]}>Sentence</SwiftText>
          <SwiftText modifiers={[tag('word')]}>Word</SwiftText>
        </Picker>
      </Host>
    </View>
    <DrawerScroll>
      {/* Give the native grid its full height, even when this drawer is short.
          The palette scrolls here; the sample and shortcuts never scroll away. */}
      {width > 0 ? <PaletteEditor key={target} level={highlight[target]} scheme={colours.scheme}
        height={Math.max(520, (width - 32) * 10 / 12 + 248)}
        onChange={(level) => set({ ...highlight, [target]: level })} /> : null}
    </DrawerScroll>
  </View>;
}

/** A target's native event sequence lives exactly as long as that native picker. */
function PaletteEditor({ level, scheme, height, onChange }: {
  level: HighlightColour; scheme: 'light' | 'dark'; height: number; onChange(next: HighlightColour): void;
}) {
  const [eventCount, acknowledge] = useState(0);
  return <NativePalette style={{ height, alignSelf: 'stretch' }} scheme={scheme}
    selection={{ color: toPicker(level), eventCount }} onSelectionChange={({ nativeEvent }) => {
      acknowledge(nativeEvent.eventCount);
      const next = fromPicker(nativeEvent.color);
      if (next && (next.color !== level.color || next.opacity !== level.opacity)) onChange(next);
    }} />;
}

/** A preset always replaces both marks, independent of the editing target. */
function PresetTiles({ highlight, page, fontFamily, onChoose }: {
  highlight: HighlightColours;
  page: (typeof HIGHLIGHT_PAGE)[keyof typeof HIGHLIGHT_PAGE];
  fontFamily: string | undefined;
  onChoose(next: HighlightColours): void;
}) {
  const chosen = presetOf(highlight);
  return <View style={styles.tiles}>
    {HIGHLIGHT_PRESET_ORDER.map((id) => {
      const preset = HIGHLIGHT_PRESETS[id];
      return <Pressable key={id} accessibilityRole="button" accessibilityLabel={HIGHLIGHT_PRESET_LABELS[id]}
        accessibilityState={{ selected: chosen === id }} onPress={() => onChoose(preset)}
        style={[styles.ring, { borderColor: chosen === id ? preset.word.color : 'transparent' }]}>
        <View style={[styles.tile, { backgroundColor: paintOver(page.page, preset.word) }]}>
          <Text style={[styles.tileText, { color: page.text, fontFamily }]}>Aa</Text>
        </View>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  pinned: { paddingLeft: DRAWER.row.textInset, paddingRight: DRAWER.row.inset, paddingBottom: 8, gap: 10 },
  sample: { borderCurve: 'continuous', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  sampleText: { ...TEXT.body },
  modes: { alignSelf: 'stretch' },
  tiles: { flexDirection: 'row', gap: TILE.gap - 2 * (TILE.ring + TILE.ringGap), marginLeft: -(TILE.ring + TILE.ringGap) },
  ring: { borderCurve: 'continuous', borderRadius: TILE.radius + TILE.ring + TILE.ringGap, borderWidth: TILE.ring, padding: TILE.ringGap },
  tile: { alignItems: 'center', borderCurve: 'continuous', borderRadius: TILE.radius, width: TILE.width, minHeight: TILE.height, justifyContent: 'center' },
  tileText: { ...TEXT.body },
});
