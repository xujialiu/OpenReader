import { Button, Capsule, Host } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonBorderShape, buttonStyle, controlSize, disabled as nativeDisabled, foregroundStyle, glassEffect, labelStyle } from '@expo/ui/swift-ui/modifiers';
import { useContext, type RefObject } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { INK, SchemeContext, useAccent } from './controls';
import { Icon } from './icon';
import { TEXT } from './text-styles';

/** iOS 26's glass. Before it the phone drew a search field as a grey fill, which the capsule falls back to. */
const GLASS = Number.parseInt(String(Platform.Version), 10) >= 26;

/**
 * Library Search's field, drawn by the app under the page's title while search
 * is open (#339, design 0090). It copies the field the phone stacked under the
 * title before, as measured from the phone (iPhone 17, iOS 27.0, notes
 * 2026-11-01): a 44-point capsule 16 points in from each edge, its magnifying
 * glass 14 points in, the words 10 points after it in Body, and a 44-point round
 * close control 10 points to its right. The phone draws the capsule's glass and
 * the close control (`@expo/ui`); the field and the magnifying glass are the
 * app's.
 *
 * It takes the keyboard as it appears (`autoFocus`, which the text input acts
 * on when it reaches the window, so it cannot run before the field exists) and
 * never takes it again by itself. While results are selected it is `locked`:
 * greyed, with the query showing and neither the field nor the close control
 * answering.
 */
export function LibrarySearchField({ field, query, locked, onChangeText, onClose }: {
  field: RefObject<TextInput | null>; query: string; locked: boolean; onChangeText(text: string): void; onClose(): void;
}) {
  const scheme = useContext(SchemeContext);
  const accent = useAccent();
  return <View style={styles.bar}>
    <Pressable style={[styles.field, locked && styles.locked]} disabled={locked} accessible={false}
      onPress={() => field.current?.focus()}>
      <Host style={StyleSheet.absoluteFill} colorScheme={scheme ?? undefined} pointerEvents="none">
        <Capsule modifiers={GLASS
          ? [foregroundStyle('#00000000'), glassEffect({ glass: { variant: 'regular' }, shape: 'capsule' })]
          : [foregroundStyle({ type: 'hierarchical', style: 'quaternary' })]} />
      </Host>
      <View style={styles.magnifier} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon name="search" color={INK.text} size={MAGNIFIER.box} strokeWidth={MAGNIFIER.stroke} />
      </View>
      <TextInput ref={field} style={styles.input} value={query} onChangeText={onChangeText} editable={!locked}
        autoFocus placeholder="Search Library" placeholderTextColor={INK.searchPrompt} selectionColor={accent.reading}
        accessibilityLabel="Search Library" testID="library-search-field"
        autoCapitalize="none" autoCorrect={false} spellCheck={false} clearButtonMode="while-editing"
        returnKeyType="search" enablesReturnKeyAutomatically onSubmitEditing={() => field.current?.blur()} />
    </Pressable>
    <Host matchContents colorScheme={scheme ?? undefined}>
      <Button label="Close" systemImage="xmark" onPress={onClose} modifiers={[
        labelStyle('iconOnly'), buttonStyle(GLASS ? 'glass' : 'bordered'), buttonBorderShape('circle'), controlSize('large'),
        nativeDisabled(locked), accessibilityLabel('Close'),
      ]} />
    </Host>
  </View>;
}

/**
 * The measured magnifying glass: 16 points across, 2 thick. `Icon`'s search path
 * fills 19 of its 24 units, so a 20-point box draws it 16 across.
 */
const MAGNIFIER = { box: 20, stroke: 2.2, inset: 12 } as const;

const styles = StyleSheet.create({
  // The capsule's top is a point below the title bar's, its bottom 15 above the list, as the phone left them.
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 1, paddingBottom: 15 },
  field: { flex: 1, minHeight: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', paddingLeft: MAGNIFIER.inset, paddingRight: 6 },
  magnifier: { width: MAGNIFIER.box, height: MAGNIFIER.box },
  input: { ...TEXT.body, color: INK.text, flex: 1, alignSelf: 'stretch', marginLeft: 10, paddingVertical: 0 },
  locked: { opacity: 0.5 },
});
