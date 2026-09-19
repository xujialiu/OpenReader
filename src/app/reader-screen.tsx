/**
 * The app: one reader screen, one settings sheet.
 *
 * There is no library, no catalogue, no account and no store, and their absence
 * is the design rather than a stage of it (`docs/PHILOSOPHY.md`, "What stays
 * out"): this reads documents the owner already has, one at a time. So the screen
 * is a header with two actions, the document, and the player under it — and with
 * no document it is the same screen saying what it is waiting for.
 *
 * It never shows nothing. A blank screen and a crashed app look identical, which
 * is the reason the screen it replaces existed (ADR 0018's launch crash reports
 * itself as nothing at all), and it is worth the few lines at every stage: before
 * a document is picked, while the WebView lays one out, and when a Provider
 * refuses.
 */

import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Action, INK, Note } from './controls';
import { pickDocument, type OpenDocument } from './document';
import { ReadingView } from './reading-view';
import { DEFAULT_SETTINGS, PROVIDER_LABELS, readiness, readinessSentence, type AppSettings } from './settings';
import { SettingsSheet } from './settings-sheet';
import { useProviderKey } from './use-provider-key';

export function ReaderScreen() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [document, setDocument] = useState<OpenDocument | null>(null);
  const [picking, setPicking] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const key = useProviderKey(settings.provider);

  const open = useCallback(async () => {
    setPicking(true);
    setNote(null);
    try {
      const picked = await pickDocument();
      if (picked) setDocument(picked);
    } catch (problem) {
      setNote(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setPicking(false);
    }
  }, []);

  const setRate = useCallback((rate: number) => {
    setSettings((was) => ({ ...was, rate }));
  }, []);

  const ready = readiness(settings, key.presence.state === 'held');

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <Text style={styles.title}>OwnReader</Text>
        <View style={styles.actions}>
          <Action label={document ? 'Open another' : 'Open an EPUB'} onPress={() => void open()} disabled={picking} />
          <Action label="Settings" onPress={() => setSheetOpen(true)} />
        </View>
      </View>

      {document ? (
        /**
         * Keyed by the Document, so that another one arrives with a new bridge,
         * a new engine and none of the last book's Blocks — the renderer keeps
         * its section index outside React on purpose (`blocks.ts`), and a
         * remount is the honest way to be rid of it.
         */
        <ReadingView
          key={`${document.name}:${document.base64.length}`}
          document={document}
          settings={settings}
          keyPresence={key.presence}
          onRate={setRate}
        />
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No document open</Text>
          <Text style={styles.emptyWords}>
            OwnReader reads an EPUB aloud through a text-to-speech Provider you choose and pay for directly, and
            highlights the word being spoken. Pick a document from this device to start.
          </Text>
          {ready.ready ? (
            <Note>
              {PROVIDER_LABELS[settings.provider]} is ready, reading in {settings.voice} at {settings.rate}×.
            </Note>
          ) : (
            <Note attention>
              {readinessSentence(settings.provider, ready.missing)} There is no zero-key path: until Settings has what it
              asks for, a document can be read on screen and not aloud.
            </Note>
          )}
          {note ? <Note attention>{note}</Note> : null}
        </View>
      )}

      <SettingsSheet
        visible={sheetOpen}
        settings={settings}
        onDone={(next) => {
          setSettings(next);
          setSheetOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 10 },
  empty: { alignItems: 'flex-start', flex: 1, gap: 12, justifyContent: 'center', padding: 24 },
  emptyTitle: { color: INK.text, fontSize: 20, fontWeight: '700' },
  emptyWords: { color: INK.quiet, fontSize: 15, lineHeight: 22 },
  header: {
    alignItems: 'center',
    borderBottomColor: INK.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 10,
    paddingHorizontal: 16,
    paddingTop: 58,
  },
  screen: { backgroundColor: INK.page, flex: 1 },
  title: { color: INK.text, fontSize: 20, fontWeight: '700' },
});
