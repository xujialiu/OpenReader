import { useState } from 'react';
import { readLocator, type DocumentId, type ReadingPosition } from '../core/document';
import { spineIndexOf } from '../renderer';
import { AppearanceControls, FontList } from './appearance-sheet';
import { INK } from './controls';
import { Drawer, DrawerChevron, DrawerFooter, DrawerRow, DrawerRowText, DrawerScroll, type DrawerAction } from './drawer';
import { DownloadContent } from './download-sheet';
import { HighlightPage } from './highlight-section';
import { useHeldReading } from './reading-host';
import { RenameAlert } from './rename-alert';
import { MoveContent } from './folder-actions';
import { useShell } from './routes';
import { PROVIDER_LABELS, selectVoice, settingsForDocument } from './settings';
import { shareDocument } from './share-document';
import { knownVoice } from './voice-catalog';

/** The drawer's pages, and the page each goes back to. The menu is the first, and goes back to nothing. */
const BACK = { menu: null, appearance: 'menu', fonts: 'appearance', highlight: 'appearance', download: 'menu', manage: 'download', move: 'menu' } as const;
type Page = keyof typeof BACK;
const TITLES: Record<Exclude<Page, 'menu'>, string> = { appearance: 'Appearance', fonts: 'Fonts', highlight: 'Highlight', download: 'Download', manage: 'Manage', move: 'Move to…' };

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
 * here, under the rows, because this is where the owner is looking.
 *
 * **Pages** (#117). The menu's rows are the drawer's plain list; a row that
 * opens a page has a chevron. Every page has a back button to the page it was
 * opened from (`BACK`), and a swipe down closes the drawer from any of them.
 * Rename is not a page but the phone's alert over the menu (`RenameAlert`).
 */
export function ReaderActions({ document, onClose, onDelete, appearance = false, movable = false }: { document: DocumentId; onClose(): void; onDelete?(): void; appearance?: boolean; movable?: boolean }) {
  const { library, settings, setSettings } = useShell();
  const entry = library.entries.find((e) => e.id === document);
  const held = useHeldReading().current;
  /**
   * Where Download marks and opens (#88): where this Document's Reading has its
   * contents list mark, when there is one and it has said, so the two drawers
   * agree; otherwise the section of the place it was left at.
   */
  const section = (held?.id === document ? held.section : null) ?? sectionOf(entry?.position ?? null);
  const [page, setPage] = useState<Page>('menu');
  const [renaming, setRenaming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [unshared, setUnshared] = useState<string | null>(null);
  // Download's Select all, which only Download knows the rows for.
  const [selectAll, setSelectAll] = useState<DrawerAction | null>(null);
  const current = settingsForDocument(settings, entry?.voice ?? null);
  const voice = { provider: current.provider, voice: current.voice, label: current.voice ? knownVoice(current)?.label ?? `${PROVIDER_LABELS[current.provider]} · ${current.voice}` : '' };
  if (!entry) return null;
  const share = () => {
    setSharing(true);
    setUnshared(null);
    shareDocument(entry).catch((problem: unknown) => setUnshared(problem instanceof Error ? problem.message : String(problem))).finally(() => setSharing(false));
  };
  const back = BACK[page];
  const onAppearance = (next: typeof settings.appearance) => setSettings((was) => ({ ...was, appearance: next }));
  const header = page === 'menu'
    ? { titleLeft: true as const, title: entry.title, action: { icon: 'share' as const, label: 'Share', onPress: share, disabled: sharing } }
    : { title: TITLES[page], onBack: back ? () => setPage(back) : undefined, action: (page === 'download' || page === 'manage') && selectAll ? selectAll : undefined };
  return <Drawer visible onClose={onClose} {...header}>
    {page === 'menu' ? <DrawerScroll>
      {appearance ? <DrawerRow icon="appearance" onPress={() => setPage('appearance')} accessory={<DrawerChevron />}>
        <DrawerRowText>Appearance</DrawerRowText>
      </DrawerRow> : null}
      <DrawerRow icon="rename" onPress={() => setRenaming(true)}><DrawerRowText>Rename</DrawerRowText></DrawerRow>
      {movable ? <DrawerRow icon="folder" onPress={() => setPage('move')} accessory={<DrawerChevron />}>
        <DrawerRowText>Move to…</DrawerRowText>
      </DrawerRow> : null}
      <DrawerRow icon="download" onPress={() => setPage('download')} accessory={<DrawerChevron />}>
        <DrawerRowText>Download</DrawerRowText>
      </DrawerRow>
      {onDelete ? <DrawerRow icon="trash" iconColour={INK.attention} onPress={onDelete}>
        <DrawerRowText style={{ color: INK.attention }}>Delete</DrawerRowText>
      </DrawerRow> : null}
      {unshared ? <DrawerFooter attention>{unshared}</DrawerFooter> : null}
    </DrawerScroll> : null}
    {page === 'move' ? <MoveContent target={{ kind: 'document', id: document }} onMoved={onClose} /> : null}
    {page === 'appearance' ? <AppearanceControls appearance={settings.appearance} onFonts={() => setPage('fonts')}
      onHighlight={() => setPage('highlight')} onChange={onAppearance} /> : null}
    {page === 'fonts' ? <FontList appearance={settings.appearance} onChange={onAppearance} /> : null}
    {page === 'highlight' ? <HighlightPage appearance={settings.appearance} onChange={onAppearance} /> : null}
    {/* One element for both pages, so the selection and the list's place survive going to Manage and back. */}
    {page === 'download' || page === 'manage' ? <DownloadContent document={document} title={entry.title} voice={voice} section={section}
      manage={page === 'manage'} onManage={(open) => setPage(open ? 'manage' : 'download')} onSelectAll={setSelectAll}
      onStart={() => { if (!entry.voice) library.voiced(document, voice); }} onVoice={(next) => {
        library.voiced(document, next); setSettings((was) => selectVoice(was, next.provider, next.voice));
      }} /> : null}
    {renaming ? <RenameAlert name={entry.title} onCancel={() => setRenaming(false)}
      onSave={(name) => { setRenaming(false); library.rename(document, name); onClose(); }} /> : null}
  </Drawer>;
}
/** The spine item a stored Reading Position is in, read off its locator (`spineIndexOf`), or null for none. */
function sectionOf(position: ReadingPosition | null): number | null {
  const cfi = position ? readLocator(position.locator, 'epub') : null;
  return cfi ? spineIndexOf(cfi) : null;
}
