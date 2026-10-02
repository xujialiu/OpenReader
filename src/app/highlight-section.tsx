/**
 * Highlight's own drawer page (#122, design 0068). The sample and target stay
 * above the scrolling controls, so editing never covers what it changes.
 * Native inline sliders replace ColorPicker's presenting well: no second sheet.
 */
import { Host, Picker, Slider, Text as SwiftText } from '@expo/ui/swift-ui';
import { accessibilityLabel, pickerStyle, tag, tint } from '@expo/ui/swift-ui/modifiers';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import {
  channels, HIGHLIGHT_PRESET_LABELS, HIGHLIGHT_PRESET_ORDER, HIGHLIGHT_PRESETS, presetOf,
  type HighlightColours,
} from '../renderer/highlight-colours';
import { READING_FONTS, type Appearance } from '../renderer/highlighter';
import { INK, useAccent } from './controls';
import { DRAWER, DrawerRow, DrawerScroll, useDrawerColours } from './drawer';
import { editHighlight, type HighlightComponent, type HighlightTarget } from './highlight-editor';
import { HIGHLIGHT_PAGE, paintOver, sentencePaint, wordPaint } from './highlight-paint';
import { TEXT } from './text-styles';

/** The owner's reference tiles, measured for #118 (notes, 2026-10-02 10:05). */
const TILE = { across: 5, gap: 13, height: 30, radius: 6, ring: 2, ringGap: 1.5 } as const;
const COMPONENTS: readonly { component: HighlightComponent; label: string; max: number }[] = [
  { component: 'red', label: 'Red', max: 255 },
  { component: 'green', label: 'Green', max: 255 },
  { component: 'blue', label: 'Blue', max: 255 },
  { component: 'opacity', label: 'Opacity', max: 100 },
];

export function HighlightPage({ appearance, onChange }: { appearance: Appearance; onChange(next: Appearance): void }) {
  const colours = useDrawerColours();
  const accent = useAccent();
  const page = HIGHLIGHT_PAGE[colours.scheme];
  const highlight = appearance.highlight;
  const [target, setTarget] = useState<HighlightTarget>('sentence');
  const fontFamily = READING_FONTS.find((font) => font.id === appearance.font)?.preview ?? undefined;
  const set = (next: HighlightColours) => { if (next !== highlight) onChange({ ...appearance, highlight: next }); };
  const [red, green, blue] = channels(highlight[target].color);
  const values = { red, green, blue, opacity: highlight[target].opacity };
  const targetLabel = target === 'sentence' ? 'Sentence' : 'Word';
  return <View style={styles.page} testID="highlight-page">
    <View style={styles.pinned}>
      <View style={[styles.sample, { backgroundColor: page.page }]}>
        {/* Short enough for one ordinary line; two at larger text sizes. Never shrink the letters. */}
        <Text testID="highlight-preview" numberOfLines={2} style={[styles.sampleText, { color: page.text, fontFamily }]}>
          <Text style={{ backgroundColor: sentencePaint(page.page, highlight) }}>
            Read this <Text style={{ backgroundColor: wordPaint(page.page, highlight) }}>word.</Text>
          </Text>
        </Text>
      </View>
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
      {/* A target switch mounts fresh native sliders rather than reusing a thumb mid-drag. */}
      <View key={target}>
        {COMPONENTS.map(({ component, label, max }) => <DrawerRow key={component}>
          <View style={styles.sliderLabel} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value}>{values[component]}{component === 'opacity' ? '%' : ''}</Text>
          </View>
          <Host matchContents={{ vertical: true }} colorScheme={colours.scheme} style={styles.slider}>
            <Slider min={0} max={max} step={1} value={values[component]}
              modifiers={[accessibilityLabel(`${targetLabel} ${label}`), tint(accent.reading)]}
              onValueChange={(value) => set(editHighlight(highlight, target, component, value))} />
          </Host>
        </DrawerRow>)}
      </View>
      <PresetTiles highlight={highlight} page={page} fontFamily={fontFamily} onChoose={set} />
    </DrawerScroll>
  </View>;
}

/** Both marks are replaced by a preset, regardless of the selected editing target. */
function PresetTiles({ highlight, page, fontFamily, onChoose }: {
  highlight: HighlightColours;
  page: (typeof HIGHLIGHT_PAGE)[keyof typeof HIGHLIGHT_PAGE];
  fontFamily: string | undefined;
  onChoose(next: HighlightColours): void;
}) {
  const window = useWindowDimensions();
  const width = (window.width - DRAWER.row.textInset - DRAWER.row.inset - (TILE.across - 1) * TILE.gap) / TILE.across;
  const chosen = presetOf(highlight);
  return <DrawerRow>
    <View style={styles.tiles}>
      {HIGHLIGHT_PRESET_ORDER.map((id) => {
        const preset = HIGHLIGHT_PRESETS[id];
        return <Pressable key={id} accessibilityRole="button" accessibilityLabel={HIGHLIGHT_PRESET_LABELS[id]}
          accessibilityState={{ selected: chosen === id }} onPress={() => onChoose(preset)}
          style={[styles.ring, { borderColor: chosen === id ? preset.word.color : 'transparent' }]}>
          <View style={[styles.tile, { width, backgroundColor: paintOver(page.page, preset.word) }]}>
            <Text style={[styles.tileText, { color: page.text, fontFamily }]}>Aa</Text>
          </View>
        </Pressable>;
      })}
    </View>
  </DrawerRow>;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  pinned: { paddingLeft: DRAWER.row.textInset, paddingRight: DRAWER.row.inset, paddingBottom: 8, gap: 12 },
  sample: { borderCurve: 'continuous', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  // As before, the chosen face at Body size: the full document size is not a drawer's size.
  sampleText: { ...TEXT.body },
  modes: { alignSelf: 'stretch' },
  sliderLabel: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  label: { ...TEXT.body, color: INK.text },
  value: { ...TEXT.body, color: INK.secondary, fontVariant: ['tabular-nums'] },
  // Slider has no intrinsic width: the host stretches to the drawer row's words.
  slider: { alignSelf: 'stretch' },
  tiles: { flexDirection: 'row', gap: TILE.gap - 2 * (TILE.ring + TILE.ringGap), marginLeft: -(TILE.ring + TILE.ringGap) },
  ring: { borderCurve: 'continuous', borderRadius: TILE.radius + TILE.ring + TILE.ringGap, borderWidth: TILE.ring, padding: TILE.ringGap },
  tile: { alignItems: 'center', borderCurve: 'continuous', borderRadius: TILE.radius, height: TILE.height, justifyContent: 'center' },
  tileText: { ...TEXT.body },
});
