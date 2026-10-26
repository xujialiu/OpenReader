import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentId, LibraryEntry } from '../../src/core/document';
import { ReadingHost, readerSlot, useHeldReading, type ReadingHandle } from '../../src/app/reading-host';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';

/**
 * When the Reading ends (#68, ADR 0049): the real shell-level host, with the
 * page replaced by a probe that records its mounts and unmounts and can say it
 * is playing, and a probe screen that holds the handle.
 *
 * An ending is the view's unmount, which is what writes the Reading Position
 * and pokes sync (`reading-view.tsx`), so "ended" here is "the view unmounted".
 */

const views = vi.hoisted(() => ({ shown: false, mounted: [] as string[], unmounted: [] as string[], state: null as null | ((playing: boolean, buffering: boolean) => void),
  section: null as null | ((place: { sectionIndex: number } | null) => void), reached: null as null | ((place: unknown) => void),
  /** What reached the view's own handover, the one its Voice drawer uses (#327). */
  chosen: [] as [string, string][] }));
/** What the host told the Library that orders it (#228). */
const told = vi.hoisted(() => ({ heard: [] as string[], opened: [] as string[], reached: [] as string[] }));
const portal = vi.hoisted(() => ({ hostName: undefined as string | undefined }));
const shell = vi.hoisted(() => ({ current: null as unknown }));
/** What the offline runtime was last told about the Reading playing (#75). */
const downloads = vi.hoisted(() => ({ readingPlays: false }));

vi.mock('react-native', () => ({ StyleSheet: { create: <T,>(styles: T) => styles }, Text: 'Text', View: 'View' }));
vi.mock('../../src/offline/runtime', () => ({ prioritizeRecheck: () => {}, setReadingPlays: (plays: boolean) => { downloads.readingPlays = plays; } }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }) }));
vi.mock('react-native-teleport', () => ({
  Portal: ({ hostName, children }: { hostName?: string; children: unknown }) => {
    portal.hostName = hostName;
    return children;
  },
  PortalHost: () => null,
}));
vi.mock('../../src/app/reading-view', async () => {
  const { useEffect } = await vi.importActual<typeof import('react')>('react');
  return {
    ReadingView: (props: { shown: boolean; document: { identity: { id: string } }; onState(playing: boolean, buffering: boolean): void; onSection(place: { sectionIndex: number } | null): void; onReached(place: unknown): void;
      onVoiceChooser?(choose: ((provider: string, voice: string) => void) | null): void }) => {
      const id = props.document.identity.id;
      views.state = props.onState;
      views.reached = props.onReached;
      views.section = props.onSection;
      views.shown = props.shown;
      useEffect(() => {
        views.mounted.push(id);
        return () => { views.unmounted.push(id); };
      }, [id]);
      const { onVoiceChooser } = props;
      useEffect(() => {
        onVoiceChooser?.((provider, voice) => { views.chosen.push([provider, voice]); });
        return () => onVoiceChooser?.(null);
      }, [onVoiceChooser]);
      return null;
    },
  };
});
vi.mock('../../src/app/document', () => ({
  openDocument: async (entry: { id: string; format: string; title: string }) => ({ identity: { id: entry.id, format: entry.format }, title: entry.title, base64: '' }),
}));
vi.mock('../../src/app/routes', () => ({ useShell: () => shell.current }));
vi.mock('../../src/app/use-provider-secrets', () => ({ useProviderKey: () => ({ presence: { state: 'held' } }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const A = ('sha256:' + 'a'.repeat(64)) as DocumentId;
const B = ('sha256:' + 'b'.repeat(64)) as DocumentId;

function entry(id: DocumentId): LibraryEntry {
  return {
    id, format: 'epub', publicationId: null, publicationIdSource: 'none', title: id === A ? 'Book A' : 'Book B',
    position: null, stamp: { at: 1, device: 'iPhone-test' },
  };
}

const entries = [entry(A), entry(B)];
shell.current = {
  settings: DEFAULT_SETTINGS,
  setSettings: () => {},
  secretRevisions: {},
  sync: { poke: () => {}, wait: async () => null },
  library: {
    entries, adoptedAt: {}, current: (id: DocumentId) => entries.find((one) => one.id === id) ?? null,
    opened: (id: string) => { told.opened.push(id); },
    heard: (id: string) => { told.heard.push(id); },
    reached: (id: string) => { told.reached.push(id); },
  },
};

async function host() {
  const handle: { current: ReadingHandle | null } = { current: null };
  function Probe() {
    handle.current = useHeldReading();
    return null;
  }
  let tree: ReactTestRenderer | null = null;
  await act(async () => { tree = create(createElement(ReadingHost, null, createElement(Probe))); });
  views.mounted.length = 0;
  views.unmounted.length = 0;
  told.heard.length = 0;
  told.opened.length = 0;
  told.reached.length = 0;
  const run = async (step: (reading: ReadingHandle) => void) => { await act(async () => { step(handle.current!); }); };
  return { handle, run, close: async () => { await act(async () => { tree!.unmount(); }); } };
}

describe('the Reading outlives the Reader while it plays (#68)', () => {
  it('moves the page into the Reader’s slot while the Reader shows it, and out when it goes', async () => {
    const h = await host();
    await h.run((r) => r.show(A));
    expect(portal.hostName).toBe(readerSlot(A));
    expect(views.shown).toBe(true);
    await h.run(() => views.state!(true, false));
    await h.run((r) => r.left(A));
    expect(portal.hostName).toBeUndefined();
    expect(views.shown).toBe(false);
    expect(views.unmounted).toEqual([]);
    expect(h.handle.current!.current).toMatchObject({ id: A, playing: true });
    await h.close();
  });

  it('keeps it through a pause in the Library, and gives it back to the Reader without a new open', async () => {
    const h = await host();
    await h.run((r) => r.show(A));
    await h.run(() => views.state!(true, false));
    await h.run((r) => r.left(A));
    // The lock screen's Pause, while the Library is on screen.
    await h.run(() => views.state!(false, false));
    expect(h.handle.current!.current).toMatchObject({ id: A, playing: false });
    await h.run((r) => r.show(A));
    expect(portal.hostName).toBe(readerSlot(A));
    expect(views.shown).toBe(true);
    expect(views.mounted).toEqual([A]);
    expect(views.unmounted).toEqual([]);
    await h.close();
  });

  it('ends it when the Reader goes while it is paused, as leaving always did', async () => {
    const h = await host();
    await h.run((r) => r.show(A));
    await h.run(() => views.state!(false, false));
    await h.run((r) => r.left(A));
    expect(views.unmounted).toEqual([A]);
    expect(h.handle.current!.current).toBeNull();
    await h.close();
  });

  it('ends it first when another Document is opened', async () => {
    const h = await host();
    await h.run((r) => r.show(A));
    await h.run(() => views.state!(true, false));
    await h.run((r) => r.left(A));
    await h.run((r) => r.show(B));
    expect(views.unmounted).toEqual([A]);
    expect(views.mounted).toEqual([A, B]);
    // B has said nothing yet: A's playing is not carried over.
    expect(h.handle.current!.current).toMatchObject({ id: B, playing: false });
    await h.close();
  });

  // Its audio keeps the app running away from the screen, and a download with it (#75).
  it('tells the downloads the Reading plays for as long as it plays, in the Reader and in the Library', async () => {
    const h = await host();
    await h.run((r) => r.show(A));
    expect(downloads.readingPlays).toBe(false);
    await h.run(() => views.state!(true, false));
    expect(downloads.readingPlays).toBe(true);
    await h.run((r) => r.left(A));
    expect(downloads.readingPlays).toBe(true);
    // The lock screen's Pause and Play, while the Library is on screen.
    await h.run(() => views.state!(false, false));
    expect(downloads.readingPlays).toBe(false);
    await h.run(() => views.state!(true, true));
    expect(downloads.readingPlays).toBe(true);
    // Another Document ends it, and says nothing yet.
    await h.run((r) => r.show(B));
    expect(downloads.readingPlays).toBe(false);
    await h.run(() => views.state!(true, false));
    expect(downloads.readingPlays).toBe(true);
    // Deleted while it plays.
    await h.run((r) => r.end(B));
    expect(downloads.readingPlays).toBe(false);
    await h.close();
  });

  // Where the download drawer marks and opens, in the Reader and in the Library (#88).
  it('carries the place its contents list marks, and not into another Document', async () => {
    const h = await host();
    await h.run((r) => r.show(A));
    expect(h.handle.current!.current).toMatchObject({ id: A, place: null });
    await h.run(() => views.section!({ sectionIndex: 12 }));
    await h.run(() => views.state!(true, false));
    await h.run((r) => r.left(A));
    expect(h.handle.current!.current).toMatchObject({ id: A, place: { sectionIndex: 12 } });
    await h.run((r) => r.show(B));
    expect(h.handle.current!.current).toMatchObject({ id: B, place: null });
    await h.close();
  });

  it('ends it when its Document is deleted, and leaves another one alone', async () => {
    const h = await host();
    await h.run((r) => r.show(A));
    await h.run(() => views.state!(true, false));
    await h.run((r) => r.left(A));
    await h.run((r) => r.end(B));
    expect(views.unmounted).toEqual([]);
    await h.run((r) => r.end(A));
    expect(views.unmounted).toEqual([A]);
    expect(h.handle.current!.current).toBeNull();
    await h.close();
  });
});

describe('what the Reading tells the Library about its order (#228)', () => {
  const place = { locator: 'epubcfi(/6/8!/4/2/4)', anchor: { exact: 'A sentence.', prefix: '', suffix: '' } };

  it('moves nothing for a Document opened and left without Play', async () => {
    const h = await host();
    await h.run((r) => r.show(A));
    expect(views.mounted).toEqual([A]);
    await h.run(() => views.state!(false, false));
    await h.run((r) => r.left(A));
    expect(told.opened).toEqual([]);
    expect(told.heard).toEqual([]);
    await h.close();
  });

  it('moves it up when speech starts, and not while Play is still waiting or was refused', async () => {
    const h = await host();
    await h.run((r) => r.show(A));
    // Play pressed: building, asking for Consent, fetching the first Clip.
    await h.run(() => views.state!(true, true));
    expect(told.heard).toEqual([]);
    // Refused, as a declined Consent or a missing key is.
    await h.run(() => views.state!(false, false));
    expect(told.heard).toEqual([]);
    await h.run(() => views.state!(true, true));
    await h.run(() => views.state!(true, false));
    expect(told.heard).toEqual([A]);
    await h.close();
  });

  it('moves it up again with each place written while it speaks, and not with one written while paused (#96)', async () => {
    const h = await host();
    await h.run((r) => r.show(A));
    // A tapped sentence, written while paused.
    await h.run(() => views.reached!(place));
    expect(told.reached).toEqual([A]);
    expect(told.heard).toEqual([]);
    await h.run(() => views.state!(true, false));
    expect(told.heard).toEqual([A]);
    // The ten-second write while it speaks, and the one its own pause makes.
    await h.run(() => views.reached!(place));
    expect(told.heard).toEqual([A, A]);
    // Waiting for a late Clip is not speech.
    await h.run(() => views.state!(true, true));
    await h.run(() => views.reached!(place));
    expect(told.heard).toEqual([A, A]);
    await h.close();
  });

  it('keeps moving it up while it speaks in the Library', async () => {
    const h = await host();
    await h.run((r) => r.show(A));
    await h.run(() => views.state!(true, false));
    await h.run((r) => r.left(A));
    await h.run(() => views.reached!(place));
    expect(told.heard).toEqual([A, A]);
    await h.close();
  });
});

/**
 * One Voice for the app (#327, ADR 0089): Switch voice (#329) in any
 * Document's Download drawer changes the Voice a held Reading is read in.
 */
describe('a Voice chosen from the Download drawer', () => {
  const written: AppSettings[] = [];
  const was = shell.current as { settings: AppSettings; setSettings: unknown };
  const fishOnly: AppSettings = { ...DEFAULT_SETTINGS, enabledProviders: ['fish'], provider: 'fish', voice: 'one' };
  beforeEach(() => {
    written.length = 0;
    views.chosen.length = 0;
    shell.current = { ...was, settings: fishOnly, setSettings: (how: (previous: AppSettings) => AppSettings) => { written.push(how(fishOnly)); } };
  });
  afterEach(() => { shell.current = was; });

  it('goes through the held view’s handover when its Provider is enabled, as the Voice drawer’s does', async () => {
    const h = await host();
    await h.run((r) => r.show(A));
    await h.run(() => views.state!(true, false));
    await h.run((r) => r.left(A));
    await h.run((r) => r.chooseVoice('fish', 'two'));
    expect(views.chosen).toEqual([['fish', 'two']]);
    expect(written).toEqual([]);
    await h.close();
  });

  it('is taken at once when its Provider is disabled, which is what stops a playing Reading', async () => {
    const h = await host();
    await h.run((r) => r.show(A));
    await h.run(() => views.state!(true, false));
    await h.run((r) => r.chooseVoice('local', 'af_bella'));
    expect(views.chosen).toEqual([]);
    expect(written).toEqual([{ ...fishOnly, provider: 'local', voice: 'af_bella' }]);
    await h.close();
  });

  it('is written to the settings when no Reading is held', async () => {
    const h = await host();
    await h.run((r) => r.chooseVoice('fish', 'two'));
    expect(views.chosen).toEqual([]);
    expect(written).toEqual([{ ...fishOnly, voice: 'two' }]);
    await h.close();
  });
});
