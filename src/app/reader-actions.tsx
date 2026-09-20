import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { DocumentId } from '../core/document';
import { AppearanceControls } from './appearance-sheet';
import { INK } from './controls';
import { DownloadContent } from './download-sheet';
import { Icon } from './icon';
import { useShell } from './routes';
import { PROVIDER_LABELS, selectVoice, settingsForDocument } from './settings';
import { Sheet } from './sheet';
import { knownVoice } from './voice-catalog';

export function ReaderActions({ document, onClose, initial = 'menu' }: { document: DocumentId; onClose(): void; initial?: 'menu' | 'download' }) {
  const { library, settings, setSettings } = useShell();
  const entry = library.entries.find((e) => e.id === document);
  const [page, setPage] = useState<'menu' | 'appearance' | 'rename' | 'download'>(initial);
  const [name, setName] = useState(entry?.title ?? '');
  const current = settingsForDocument(settings, entry?.voice ?? null);
  const voice = { provider: current.provider, voice: current.voice, label: current.voice ? knownVoice(current)?.label ?? `${PROVIDER_LABELS[current.provider]} · ${current.voice}` : '' };
  if (!entry) return null;
  const titles = { menu: entry.title, appearance: 'Appearance', rename: 'Rename', download: 'Download' };
  return <Sheet visible title={titles[page]} onClose={onClose}>
    {page === 'menu' ? <View style={styles.menu}>
      {(['appearance', 'rename', 'download'] as const).map((action) => <Pressable key={action} accessibilityRole="button" accessibilityLabel={titles[action]}
        onPress={() => setPage(action)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.5 }]}>
        {action === 'appearance' ? <Text style={styles.aa}>Aa</Text> : <Icon name={action} color={INK.text} size={26} />}
        <Text style={styles.label}>{titles[action]}</Text>
      </Pressable>)}
    </View> : null}
    {page === 'appearance' ? <AppearanceControls appearance={settings.appearance} onChange={(appearance) => setSettings((was) => ({ ...was, appearance }))} /> : null}
    {page === 'rename' ? <View style={styles.rename}>
      <TextInput accessibilityLabel="Display name" value={name} onChangeText={setName} autoFocus selectTextOnFocus clearButtonMode="while-editing" style={styles.input} returnKeyType="done"
        onSubmitEditing={() => { if (name.trim()) { library.rename(document, name); onClose(); } }} />
      <View style={styles.buttons}><Pressable onPress={onClose}><Text style={styles.label}>Cancel</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={!name.trim()} onPress={() => { library.rename(document, name); onClose(); }}><Text style={[styles.label, { color: INK.reading, opacity: name.trim() ? 1 : 0.3 }]}>Save</Text></Pressable></View>
    </View> : null}
    {page === 'download' ? <DownloadContent document={document} title={entry.title} voice={voice}
      onStart={() => { if (!entry.voice) library.voiced(document, voice); }} onVoice={(next) => {
      library.voiced(document, next); setSettings((was) => selectVoice(was, next.provider, next.voice));
    }} /> : null}
  </Sheet>;
}
const styles = StyleSheet.create({
  menu: { paddingHorizontal: 24 }, row: { flexDirection: 'row', alignItems: 'center', gap: 20, minHeight: 66, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: INK.line },
  aa: { color: INK.text, fontSize: 24, width: 26 }, label: { color: INK.text, fontSize: 19 }, rename: { padding: 20, gap: 24 },
  input: { color: INK.text, backgroundColor: INK.page, borderRadius: 12, padding: 14, fontSize: 18 }, buttons: { flexDirection: 'row', justifyContent: 'space-between', padding: 8 },
});
