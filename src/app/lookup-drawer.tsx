import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TranslationService } from '../translation/settings';
import { INK } from './controls';
import { DRAWER, Drawer, DrawerMenuRow } from './drawer';
import { Icon } from './icon';
import { TRANSLATION_SERVICES } from './translation-screen';
import type { LookupHandle } from './use-lookup';
import { TEXT, TEXT_EMPHASIZED } from './text-styles';

/**
 * The result of a Word Lookup or a Text Translation, on the shared drawer
 * since #117 (ADR 0066, revising ADR 0051's own 0.46 / 0.88 view and its pan
 * handler).
 *
 * Nonmodal at the Drawer Height: the page above is neither dimmed nor locked
 * (`presentationBackgroundInteraction`), so the selection's handles in the
 * document stay reachable and a drag of them looks the new selection up. A
 * swipe down closes the drawer, and with it the lookup (`lookup.close`); the
 * down-arrow that did that is gone. Its turn among the drawers is the
 * `Drawer`'s, so a selection made while another drawer is up closes that one
 * first.
 */
export function LookupDrawer({ lookup, service, onService }: {
  lookup: LookupHandle; service: TranslationService; onService(service: TranslationService): void;
}) {
  return (
    <Drawer visible={Boolean(lookup.selection)} title="Lookup" onClose={() => lookup.close()}>
      {lookup.selection ? <LookupResult lookup={lookup} service={service} onService={onService} /> : null}
    </Drawer>
  );
}

function LookupResult({ lookup, service, onService }: {
  lookup: LookupHandle; service: TranslationService; onService(service: TranslationService): void;
}) {
  const [copyError, setCopyError] = useState(false);
  const [copied, setCopied] = useState(false);
  // A new network result has not been copied, even if the preceding result was.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setCopied(false); setCopyError(false); }, [lookup.result]);
  const selection = lookup.selection;
  if (!selection) return null;
  const copy = async () => {
    if (!lookup.result) return;
    try { await Clipboard.setStringAsync(lookup.result.text); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  };
  return <View testID="lookup-drawer" style={styles.drawer}>
    <View style={styles.modes}>
      {(['dictionary', 'translation'] as const).map((mode) => <Pressable key={mode} accessibilityRole="button"
        accessibilityState={{ selected: selection.mode === mode }} onPress={() => { setCopied(false); lookup.mode(mode); }}
        style={[styles.mode, selection.mode === mode && styles.chosen]}>
        <Text style={styles.modeText}>{mode === 'dictionary' ? 'Dictionary' : 'Translation'}</Text>
      </Pressable>)}
    </View>
    {selection.mode === 'translation' ? <DrawerMenuRow label="Service" choices={TRANSLATION_SERVICES} chosen={service}
      onChoose={(next) => { setCopied(false); onService(next); }} /> : null}
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Text style={styles.word} numberOfLines={selection.mode === 'dictionary' ? 3 : 2}>{selection.text}</Text>
      {lookup.result?.phonetic ? <Text style={styles.phonetic}>{lookup.result.phonetic}</Text> : null}
      {lookup.result?.pronunciations.length ? <View style={styles.audioRow}>
        {lookup.result.pronunciations.map((audio) => <Pressable key={audio.url} accessibilityRole="button" accessibilityLabel={`Play ${audio.label} pronunciation`}
          onPress={() => lookup.pronounce(audio.url)} style={styles.audio}>
          <Icon name="play" color={INK.reading} size={18} /><Text style={styles.action}>{audio.label}</Text>
        </Pressable>)}
        {lookup.pronouncing ? <ActivityIndicator color={INK.reading} size="small" accessibilityLabel="Playing pronunciation" /> : null}
      </View> : null}
      {lookup.loading || selection.selecting ? <ActivityIndicator style={styles.loading} color={INK.reading} accessibilityLabel="Looking up selection" /> : null}
      {lookup.error ? <View><Text style={styles.error}>{lookup.error}</Text><Pressable accessibilityRole="button" onPress={lookup.retry} style={styles.retry}><Text style={styles.action}>Retry</Text></Pressable></View> : null}
      {lookup.result ? <>
        <Text selectable style={styles.definition}>{lookup.result.text}</Text>
        <View style={styles.footer}><Text style={styles.source}>{lookup.result.source}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Copy result" onPress={() => { void copy(); }} style={styles.copy}>
            <Text style={styles.action}>{copied ? 'Copied' : 'Copy'}</Text>
          </Pressable>
        </View>
      </> : null}
      {lookup.audioError ? <Text style={styles.error}>{lookup.audioError}</Text> : null}
      {copyError ? <Text style={styles.error}>Could not copy. Try again.</Text> : null}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  drawer: { flex: 1 },
  modes: { flexDirection: 'row', backgroundColor: INK.line, borderRadius: 9, padding: 2, marginLeft: DRAWER.row.textInset, marginRight: DRAWER.row.inset },
  mode: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 7 },
  chosen: { backgroundColor: INK.card }, modeText: { ...TEXT_EMPHASIZED.subhead, color: INK.text },
  scroll: { flex: 1 },
  // Set in as far as a row's words, so the result lines up with the Service row above it.
  body: { paddingLeft: DRAWER.row.textInset, paddingRight: DRAWER.row.inset, paddingTop: 8, paddingBottom: 16, gap: 12 },
  // Until it follows Appearance (#98).
  word: { ...TEXT_EMPHASIZED.title2, color: INK.text },
  definition: { ...TEXT.body, color: INK.text },
  phonetic: { ...TEXT.subhead, color: INK.quiet }, source: { ...TEXT.footnote, color: INK.quiet },
  action: { ...TEXT.body, color: INK.reading },
  error: { ...TEXT.subhead, color: INK.attention },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 20 }, audio: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  retry: { alignSelf: 'flex-start', paddingVertical: 12 }, copy: { padding: 12 }, loading: { paddingVertical: 18 },
});
