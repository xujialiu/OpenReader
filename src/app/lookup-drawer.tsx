import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TranslationService } from '../translation/settings';
import { INK, useBorders, ValueRow } from './controls';
import { Icon } from './icon';
import { TRANSLATION_SERVICES } from './translation-screen';
import type { LookupHandle } from './use-lookup';

/** Nonmodal: the native selection handles in the document above remain reachable. */
export function LookupDrawer({ lookup, height, service, onService }: {
  lookup: LookupHandle; height: number; service: TranslationService; onService(service: TranslationService): void;
}) {
  const insets = useSafeAreaInsets();
  const border = useBorders();
  const [fraction, setFraction] = useState(0.46);
  const [copyError, setCopyError] = useState(false);
  const [copied, setCopied] = useState(false);
  const startHeight = useRef(0);
  const current = useRef({ fraction, height, close: lookup.close });
  useEffect(() => { current.current = { fraction, height, close: lookup.close }; }, [fraction, height, lookup.close]);
  // PanResponder stores these handlers; it never invokes them during construction.
  // eslint-disable-next-line react-hooks/refs
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 6,
    onPanResponderGrant: () => { startHeight.current = current.current.fraction * current.current.height; },
    onPanResponderMove: (_, gesture) => setFraction(Math.max(0.25, Math.min(0.88, (startHeight.current - gesture.dy) / current.current.height))),
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy > 100 && startHeight.current / current.current.height < 0.5) current.current.close();
      else setFraction((value) => value > 0.64 ? 0.88 : 0.46);
    },
  }), []);
  // A new network result has not been copied, even if the preceding result was.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setCopied(false); setCopyError(false); }, [lookup.result]);
  if (!lookup.selection) return null;
  const copy = async () => {
    if (!lookup.result) return;
    try { await Clipboard.setStringAsync(lookup.result.text); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  };
  return <View testID="lookup-drawer" style={[styles.drawer, { height: Math.min(height * fraction, height - 20), paddingBottom: Math.max(insets.bottom, 12), borderColor: border.line }]}>
    <View {...pan.panHandlers} style={styles.handle} accessible accessibilityRole="adjustable" accessibilityLabel="Lookup panel height"
      accessibilityActions={[{ name: 'increment', label: 'Expand' }, { name: 'decrement', label: 'Collapse' }]}
      onAccessibilityAction={(event) => setFraction(event.nativeEvent.actionName === 'increment' ? 0.88 : 0.46)}>
      <View style={styles.grip} />
    </View>
    <View style={styles.header}>
      <View style={styles.modes}>
        {(['dictionary', 'translation'] as const).map((mode) => <Pressable key={mode} accessibilityRole="button"
          accessibilityState={{ selected: lookup.selection?.mode === mode }} onPress={() => { setCopied(false); lookup.mode(mode); }}
          style={[styles.mode, lookup.selection?.mode === mode && styles.chosen]}>
          <Text style={styles.modeText}>{mode === 'dictionary' ? 'Dictionary' : 'Translation'}</Text>
        </Pressable>)}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Close lookup" onPress={() => lookup.close()} style={styles.icon}>
        <Icon name="down" color={INK.quiet} size={22} />
      </Pressable>
    </View>
    {lookup.selection.mode === 'translation' ? <ValueRow label="Service" choices={TRANSLATION_SERVICES} chosen={service} onChoose={(next) => { setCopied(false); onService(next); }} /> : null}
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Text style={styles.word} numberOfLines={lookup.selection.mode === 'dictionary' ? 3 : 2}>{lookup.selection.text}</Text>
      {lookup.result?.phonetic ? <Text style={styles.quiet}>{lookup.result.phonetic}</Text> : null}
      {lookup.result?.pronunciations.length ? <View style={styles.audioRow}>
        {lookup.result.pronunciations.map((audio) => <Pressable key={audio.url} accessibilityRole="button" accessibilityLabel={`Play ${audio.label} pronunciation`}
          onPress={() => lookup.pronounce(audio.url)} style={styles.audio}>
          <Icon name="play" color={INK.reading} size={18} /><Text style={styles.action}>{audio.label}</Text>
        </Pressable>)}
        {lookup.pronouncing ? <ActivityIndicator color={INK.reading} size="small" accessibilityLabel="Playing pronunciation" /> : null}
      </View> : null}
      {lookup.loading || lookup.selection.selecting ? <ActivityIndicator style={styles.loading} color={INK.reading} accessibilityLabel="Looking up selection" /> : null}
      {lookup.error ? <View><Text style={styles.error}>{lookup.error}</Text><Pressable accessibilityRole="button" onPress={lookup.retry} style={styles.retry}><Text style={styles.action}>Retry</Text></Pressable></View> : null}
      {lookup.result ? <>
        <Text selectable style={styles.definition}>{lookup.result.text}</Text>
        <View style={styles.footer}><Text style={styles.quiet}>{lookup.result.source}</Text>
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
  drawer: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: INK.panel, borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  handle: { height: 24, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 36, height: 5, borderRadius: 3, backgroundColor: INK.tertiary },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  modes: { flex: 1, flexDirection: 'row', backgroundColor: INK.line, borderRadius: 9, padding: 2 },
  mode: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 7 },
  chosen: { backgroundColor: INK.card }, modeText: { color: INK.text, fontSize: 14, fontWeight: '600' },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 12 },
  word: { fontSize: 22, fontWeight: '600', color: INK.text },
  definition: { fontSize: 17, lineHeight: 25, color: INK.text },
  quiet: { color: INK.quiet, fontSize: 14 }, action: { color: INK.reading, fontSize: 16 },
  error: { color: INK.attention, fontSize: 15, lineHeight: 21 },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 20 }, audio: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  retry: { alignSelf: 'flex-start', paddingVertical: 12 }, copy: { padding: 12 }, loading: { paddingVertical: 18 },
});
