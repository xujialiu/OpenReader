/**
 * Appearance's **Highlight Colours** (#118, CONTEXT.md), as rows of the
 * drawer's plain list under Alignment: a header, a sample of the page with
 * its sentence and word marked, the two presets, and a colour well for each
 * level.
 *
 * Everything here is drawn on the page's own colours (`HIGHLIGHT_PAGE`), not
 * the drawer's, because the owner chooses the colours for the page: the
 * light page under the light theme, the dark page under the dark one. The
 * colours themselves are the same under both.
 */

import { ColorPicker, Host } from '@expo/ui/swift-ui';
import { labelsHidden } from '@expo/ui/swift-ui/modifiers';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import {
  fromPicker, HIGHLIGHT_PRESET_LABELS, HIGHLIGHT_PRESET_ORDER, HIGHLIGHT_PRESETS, presetOf, readHex, readOpacity, toPicker,
  type HighlightColour, type HighlightColours,
} from '../renderer/highlight-colours';
import { READING_FONTS, type Appearance } from '../renderer/highlighter';
import { INK } from './controls';
import { DRAWER, DrawerRow, DrawerRowText, useDrawerColours } from './drawer';
import { HIGHLIGHT_PAGE, paintOver, sentencePaint, wordPaint } from './highlight-paint';
import { TEXT } from './text-styles';

/**
 * A preset's tile, copied from the owner's reference, another reader's theme
 * tiles five to a row (notes, 2026-10-02 10:05): five tiles and their four
 * gaps span the row's words, so a tile is about a fifth of it, 60 × 30 pt on
 * a 402-pt phone. The reference's were 62–63 × 30.5 with a 12.7-pt gap, and
 * its ring 2.3 pt wide and 1.6 pt off the tile.
 */
const TILE = { across: 5, gap: 13, height: 30, radius: 6, ring: 2, ringGap: 1.5 } as const;

/** The sample's two sentences: the first already read, the second being read, and in it the word being spoken. */
const SAMPLE = { read: 'The rain had stopped by morning. ', before: 'She opened the ', word: 'window', after: ' and listened to the birds.' } as const;

export function HighlightSection({ appearance, onChange }: { appearance: Appearance; onChange(next: Appearance): void }) {
  const colours = useDrawerColours();
  const page = HIGHLIGHT_PAGE[colours.scheme];
  const highlight = appearance.highlight;
  // The Appearance font, or the interface font for System and for Original Book Font (owner's Q17).
  const fontFamily = READING_FONTS.find((font) => font.id === appearance.font)?.preview ?? undefined;
  const set = (next: HighlightColours) => onChange({ ...appearance, highlight: next });
  return <>
    <Text style={styles.header} accessibilityRole="header">Highlight</Text>
    <DrawerRow>
      <View style={[styles.sample, { backgroundColor: page.page }]}>
        <Text style={[styles.sampleText, { color: page.text, fontFamily }]}>
          {SAMPLE.read}
          <Text style={{ backgroundColor: sentencePaint(page.page, highlight) }}>
            {SAMPLE.before}
            <Text style={{ backgroundColor: wordPaint(page.page, highlight) }}>{SAMPLE.word}</Text>
            {SAMPLE.after}
          </Text>
        </Text>
      </View>
    </DrawerRow>
    <PresetTiles highlight={highlight} page={page} fontFamily={fontFamily} onChoose={set} />
    <LevelRow label="Sentence" level={highlight.sentence} scheme={colours.scheme}
      onChange={(sentence) => set({ ...highlight, sentence })} />
    <LevelRow label="Word" level={highlight.word} scheme={colours.scheme}
      onChange={(word) => set({ ...highlight, word })} />
  </>;
}

/**
 * Amber and Blue, each drawn as its word would look on the page, with the
 * one in force ringed in its word's colour. They carry no names: VoiceOver
 * reads them.
 */
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
        const selected = chosen === id;
        return <Pressable key={id} accessibilityRole="button" accessibilityLabel={HIGHLIGHT_PRESET_LABELS[id]}
          accessibilityState={{ selected }} onPress={() => onChoose(preset)}
          style={[styles.ring, { borderColor: selected ? preset.word.color : 'transparent' }]}>
          <View style={[styles.tile, { width, backgroundColor: paintOver(page.page, preset.word) }]}>
            <Text style={[styles.tileText, { color: page.text, fontFamily }]}>Aa</Text>
          </View>
        </Pressable>;
      })}
    </View>
  </DrawerRow>;
}

/**
 * Sentence or Word: its name, and at the row's right the phone's own colour
 * well, which opens the phone's picker with its opacity slider. Each change
 * is saved as it is made, so the page behind follows the slider.
 *
 * The well's host is the well's size: a SwiftUI control in a host as wide as
 * the drawer took the drawer off the screen while what it opened was up
 * (#117, `DrawerMenuRow`).
 */
function LevelRow({ label, level, scheme, onChange }: {
  label: string; level: HighlightColour; scheme: 'light' | 'dark'; onChange(next: HighlightColour): void;
}) {
  return <DrawerRow accessory={<Host matchContents colorScheme={scheme}>
    <ColorPicker label={label} selection={toPicker(level)} supportsOpacity modifiers={[labelsHidden()]}
      onSelectionChange={(value) => {
        const next = fromPicker(value);
        if (next && (next.color !== readHex(level.color) || next.opacity !== readOpacity(level.opacity))) onChange(next);
      }} />
  </Host>}>
    {/* The well carries the name for VoiceOver, so the words are not read twice. */}
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <DrawerRowText>{label}</DrawerRowText>
    </View>
  </DrawerRow>;
}

const styles = StyleSheet.create({
  // The phone's section header, as the settings pages set theirs (`SettingsGroup`), in to the rows' words.
  header: {
    ...TEXT.headline, color: INK.secondary, paddingBottom: 6, paddingLeft: DRAWER.row.textInset,
    paddingRight: DRAWER.row.inset, paddingTop: 32,
  },
  sample: { borderCurve: 'continuous', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  // Body's size, not the page's own: 26 would not fit a drawer.
  sampleText: { ...TEXT.body },
  // The ring's room is kept around every tile, so the chosen one does not move the others.
  tiles: { flexDirection: 'row', gap: TILE.gap - 2 * (TILE.ring + TILE.ringGap), marginLeft: -(TILE.ring + TILE.ringGap) },
  ring: {
    borderCurve: 'continuous', borderRadius: TILE.radius + TILE.ring + TILE.ringGap, borderWidth: TILE.ring,
    padding: TILE.ringGap,
  },
  tile: { alignItems: 'center', borderCurve: 'continuous', borderRadius: TILE.radius, height: TILE.height, justifyContent: 'center' },
  tileText: { ...TEXT.body },
});
