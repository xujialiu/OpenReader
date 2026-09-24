import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { DocumentId } from '../core/document';
import { AppearanceControls, FontList } from './appearance-sheet';
import { INK, useBorders } from './controls';
import { DownloadContent } from './download-sheet';
import { Icon } from './icon';
import { useShell } from './routes';
import { PROVIDER_LABELS, selectVoice, settingsForDocument } from './settings';
import { Sheet } from './sheet';
import { knownVoice } from './voice-catalog';

/**
 * A Document's actions, as one drawer wherever it is asked for.
 *
 * `onDelete` is optional because the caller, not this component, knows whether
 * deleting is on offer. The Library passes one; the reader does not, because the
 * document is on screen behind the drawer and a `Delete` row there would offer to
 * throw away the book being read. Asking the component to work that out itself
 * would mean teaching it which screen it is on, which the caller already knows.
 *
 * `appearance` is granted the same way and for the mirror reason (#22): only the
 * reader has a page behind the drawer, so only there does changing the font or
 * its size show anything. From the Library the row changed a setting the owner
 * could not see, and it is not the book's to begin with — it is the owner's, for
 * every Document (CONTEXT.md, **Appearance**).
 */
export function ReaderActions({ document, onClose, onDelete, appearance = false }: { document: DocumentId; onClose(): void; onDelete?(): void; appearance?: boolean }) {
  const { library, settings, setSettings } = useShell();
  const borders = useBorders();
  const entry = library.entries.find((e) => e.id === document);
  const [page, setPage] = useState<'menu' | 'appearance' | 'rename' | 'download' | 'fonts'>('menu');
  const [name, setName] = useState(entry?.title ?? '');
  const current = settingsForDocument(settings, entry?.voice ?? null);
  const voice = { provider: current.provider, voice: current.voice, label: current.voice ? knownVoice(current)?.label ?? `${PROVIDER_LABELS[current.provider]} · ${current.voice}` : '' };
  if (!entry) return null;
  const titles = { menu: entry.title, appearance: 'Appearance', rename: 'Rename', download: 'Download', fonts: 'Fonts' };
  const rows: readonly ('appearance' | 'rename' | 'download')[] = appearance ? ['appearance', 'rename', 'download'] : ['rename', 'download'];
  // Only Fonts goes back, because only Fonts is a page inside a page. The three
  // pages off the menu are dismissed rather than returned from, which is what
  // the drag on the handle already does.
  return <Sheet visible title={titles[page]} onClose={onClose} onBack={page === 'fonts' ? () => setPage('appearance') : undefined}>
    {page === 'menu' ? <View style={styles.menu}>
      {rows.map((action) => <Pressable key={action} accessibilityRole="button" accessibilityLabel={titles[action]}
        onPress={() => setPage(action)} style={({ pressed }) => [styles.row, { borderBottomColor: borders.line }, pressed && { opacity: 0.5 }]}>
        <Icon name={action} color={INK.text} size={26} />
        <Text style={styles.label}>{titles[action]}</Text>
      </Pressable>)}
      {onDelete ? <Pressable accessibilityRole="button" accessibilityLabel="Delete" onPress={onDelete}
        style={({ pressed }) => [styles.row, styles.last, pressed && { opacity: 0.5 }]}>
        <Icon name="trash" color={INK.attention} size={26} />
        <Text style={[styles.label, { color: INK.attention }]}>Delete</Text>
      </Pressable> : null}
    </View> : null}
    {page === 'appearance' ? <AppearanceControls appearance={settings.appearance} onFonts={() => setPage('fonts')}
      onChange={(appearance) => setSettings((was) => ({ ...was, appearance }))} /> : null}
    {page === 'fonts' ? <FontList appearance={settings.appearance} onChange={(appearance) => setSettings((was) => ({ ...was, appearance }))} /> : null}
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
  menu: { paddingHorizontal: 24 }, row: { flexDirection: 'row', alignItems: 'center', gap: 18, minHeight: 58, borderBottomWidth: StyleSheet.hairlineWidth },
  last: { borderBottomWidth: 0 }, label: { color: INK.text, fontSize: 16 }, rename: { padding: 20, gap: 24 },
  input: { color: INK.text, backgroundColor: INK.page, borderRadius: 12, padding: 14, fontSize: 16 }, buttons: { flexDirection: 'row', justifyContent: 'space-between', padding: 8 },
});
