import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { readLocator, type DocumentId, type ReadingPosition } from '../core/document';
import { spineIndexOf } from '../renderer';
import { AppearanceControls, FontList } from './appearance-sheet';
import { INK, useBorders } from './controls';
import { DownloadContent } from './download-sheet';
import { Icon } from './icon';
import { useHeldReading } from './reading-host';
import { useShell } from './routes';
import { PROVIDER_LABELS, selectVoice, settingsForDocument } from './settings';
import { shareDocument } from './share-document';
import { Sheet, SheetNote } from './sheet';
import { knownVoice } from './voice-catalog';
import { TEXT } from './text-styles';

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
 *
 * **Share** (#95) is the icon beside the Document's name (#97), on the menu
 * page only: the other pages are titled with their own names, and the button
 * shares the book the title names. It is offered wherever the drawer is, since
 * the file is the same from the Library and from the reader. The drawer stays
 * open under the share sheet, so cancelling comes back to it; a failure is said
 * here, above the rows, because this is where the owner is looking.
 */
export function ReaderActions({ document, onClose, onDelete, appearance = false }: { document: DocumentId; onClose(): void; onDelete?(): void; appearance?: boolean }) {
  const { library, settings, setSettings } = useShell();
  const borders = useBorders();
  const entry = library.entries.find((e) => e.id === document);
  const held = useHeldReading().current;
  /**
   * Where Download marks and opens (#88): where this Document's Reading has its
   * contents list mark, when there is one and it has said, so the two drawers
   * agree; otherwise the section of the place it was left at.
   */
  const section = (held?.id === document ? held.section : null) ?? sectionOf(entry?.position ?? null);
  const [page, setPage] = useState<'menu' | 'appearance' | 'rename' | 'download' | 'fonts'>('menu');
  const [name, setName] = useState(entry?.title ?? '');
  const [sharing, setSharing] = useState(false);
  const [unshared, setUnshared] = useState<string | null>(null);
  const current = settingsForDocument(settings, entry?.voice ?? null);
  const voice = { provider: current.provider, voice: current.voice, label: current.voice ? knownVoice(current)?.label ?? `${PROVIDER_LABELS[current.provider]} · ${current.voice}` : '' };
  if (!entry) return null;
  const titles = { menu: entry.title, appearance: 'Appearance', rename: 'Rename', download: 'Download', fonts: 'Fonts' };
  const rows: readonly ('appearance' | 'rename' | 'download')[] = appearance ? ['appearance', 'rename', 'download'] : ['rename', 'download'];
  const share = () => {
    setSharing(true);
    setUnshared(null);
    shareDocument(entry).catch((problem: unknown) => setUnshared(problem instanceof Error ? problem.message : String(problem))).finally(() => setSharing(false));
  };
  // Only Fonts goes back, because only Fonts is a page inside a page. The three
  // pages off the menu are dismissed rather than returned from, which is what
  // the drag on the handle already does.
  return <Sheet visible title={titles[page]} onClose={onClose} onBack={page === 'fonts' ? () => setPage('appearance') : undefined}
    action={page === 'menu' ? { icon: 'share', label: 'Share', onPress: share, disabled: sharing } : undefined}>
    {page === 'menu' && unshared ? <SheetNote attention>{unshared}</SheetNote> : null}
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
    {page === 'download' ? <DownloadContent document={document} title={entry.title} voice={voice} section={section}
      onStart={() => { if (!entry.voice) library.voiced(document, voice); }} onVoice={(next) => {
      library.voiced(document, next); setSettings((was) => selectVoice(was, next.provider, next.voice));
    }} /> : null}
  </Sheet>;
}
/** The spine item a stored Reading Position is in, read off its locator (`spineIndexOf`), or null for none. */
function sectionOf(position: ReadingPosition | null): number | null {
  const cfi = position ? readLocator(position.locator, 'epub') : null;
  return cfi ? spineIndexOf(cfi) : null;
}

const styles = StyleSheet.create({
  menu: { paddingHorizontal: 24 }, row: { flexDirection: 'row', alignItems: 'center', gap: 18, minHeight: 58, borderBottomWidth: StyleSheet.hairlineWidth },
  last: { borderBottomWidth: 0 }, label: { ...TEXT.body, color: INK.text }, rename: { padding: 20, gap: 24 },
  input: { ...TEXT.body, color: INK.text, backgroundColor: INK.page, borderRadius: 12, padding: 14 }, buttons: { flexDirection: 'row', justifyContent: 'space-between', padding: 8 },
});
