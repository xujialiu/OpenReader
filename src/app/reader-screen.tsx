/**
 * The **Reader**: a screen you arrive at and leave (ADR 0019).
 *
 * It takes a **Document Id** and nothing else, which is what makes the route
 * survivable: a route param is serialised, a content hash still names the same
 * book tomorrow, and a path does not (ADR 0004).
 *
 * It does not own the Reading any more (#68, ADR 0049). The shell does
 * (`reading-host.tsx`), and this screen is where the Reading is shown: it asks
 * for this Document's Reading when it arrives, gives the page a slot to be
 * moved into, and says it has gone when it leaves. Leaving while the reading
 * plays keeps it going, and the Library then offers the Reading Button back to
 * it; leaving while it is paused ends it, as leaving always did, and the place
 * is kept.
 *
 * The navigation bar is the platform's: a back arrow that is also the edge
 * swipe, the Document's own name, and More actions on the right. The name is
 * the one part drawn by the app, on up to two lines (`reader-title.tsx`, #85).
 * The bar floats over the page and goes when the player collapses (#67, ADR
 * 0048); the edge swipe works either way.
 *
 * It never shows nothing. A blank screen and a crashed app look identical, which
 * is the reason the screen this replaces existed (ADR 0018's launch crash
 * reports itself as nothing at all), and it is worth the few lines at every
 * stage: while the file is read, while the WebView lays it out, and when the
 * file turns out not to be there at all.
 */

import { useHeaderHeight } from '@react-navigation/elements';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PortalHost } from 'react-native-teleport';

// WALKTHROUGH-HARNESS
import { useHarnessCommands, type HarnessCommand } from './walkthrough-harness';

import { AppearanceSheet } from './appearance-sheet';
import { ReaderActions } from './reader-actions';
import { ReaderTitle } from './reader-title';
import { HeaderButton, INK, Note } from './controls';
import { readerSlot, useHeldReading } from './reading-host';
import { useShell, type ScreenProps } from './routes';
import { TEXT } from './text-styles';

export function ReaderScreen({ route, navigation }: ScreenProps<'Reader'>) {
  const { id } = route.params;
  const { settings, setSettings, library } = useShell();
  const reading = useHeldReading();
  const entry = useMemo(() => library.entries.find((one) => one.id === id) ?? null, [library.entries, id]);
  const [appearance, setAppearance] = useState(false);
  const [actions, setActions] = useState(false);

  /**
   * The title the header shows, held here rather than read from `entry`.
   *
   * `entry` changes every time a Reading Position is written, and
   * `navigation.setOptions` with a new title on every Clip would repaint the
   * navigation bar once per sentence.
   */
  const title = entry?.title ?? 'Reading';

  /**
   * This Document's Reading, asked for as the screen arrives and let go as it
   * leaves. The shell decides what that means: the one it holds already, kept;
   * another, ended first; and on the way out, kept if it is playing.
   *
   * A route that names no entry asks for nothing, and what is rendered says so.
   */
  const { show, left } = reading;
  const present = entry !== null;
  useEffect(() => {
    if (!present) return;
    show(id);
    return () => left(id);
  }, [id, present, show, left]);

  useLayoutEffect(() => {
    navigation.setOptions({
      // Still set: the back button's long-press menu names the screen by it.
      title,
      headerTitle: () => <ReaderTitle title={title} />,
      headerRight: () => <HeaderButton label="More actions" icon="more" onPress={() => setActions(true)} />,
    });
  }, [navigation, title]);

  const mine = reading.current?.id === id ? reading.current : null;

  /**
   * The navigation bar comes and goes with the player (#67, ADR 0048), and it
   * **floats over the page** to do it, as the player does.
   *
   * An opaque bar takes its height out of the page, so hiding it would give the
   * page that height back: the WebView would resize, the text would move by the
   * bar's height, and epub.js destroys every view on a resize (`highlighter.ts`,
   * "the blank open"). A transparent bar with the page's own colour looks the
   * same while it is shown, and the page under it is the same size either way.
   * The page starts below the status bar, which stays: the clock is the owner's,
   * and the text never runs under it.
   *
   * Whether the player is shown in full is the Reading's, so a Reading returned
   * to from the Library comes back collapsed if it was left collapsed (#68).
   */
  const chrome = mine?.chrome ?? true;
  useLayoutEffect(() => {
    navigation.setOptions({ headerTransparent: true, headerShown: chrome });
  }, [navigation, chrome]);
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  /**
   * How tall the bar is, remembered while it is hidden: the header height is
   * zero then, and the space the page keeps for the bar must not go with it, or
   * every hide and show would move the text by that much.
   */
  const shownBar = headerHeight - insets.top;
  const { setBarHeight } = reading;
  useEffect(() => {
    if (shownBar > 0) setBarHeight(shownBar);
  }, [shownBar, setBarHeight]);

  // WALKTHROUGH-HARNESS
  useHarnessCommands((command: HarnessCommand) => {
    if (String(command.do) === 'appearsheet') setAppearance(Boolean(command.on));
  });

  const waiting = !entry || !mine?.opened;
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Where the page is moved to while this screen shows it (`reading-host.tsx`). */}
      <PortalHost name={readerSlot(id)} style={styles.slot} />
      {waiting ? (
        <View style={[StyleSheet.absoluteFill, styles.waiting]}>
          <Text style={styles.waitingWords}>{entry && !mine?.note ? `Reading ${title}…` : `${title} would not open.`}</Text>
          {entry ? null : (
            <Note attention>
              That book is not in the Library. It may have been opened by a version of the app that has since been
              replaced, or the Library file may be one this build will not rewrite — the Library screen says which.
            </Note>
          )}
          {mine?.note ? <Note attention>{mine.note}</Note> : null}
        </View>
      ) : null}

      {/*
        * The Appearance is the app's and not this book's (`settings.ts`), so it is
        * written back into the same settings every other screen edits — and it
        * reaches the page through the bridge rather than by remounting anything,
        * which is what keeps the text behind the sheet visible while it changes.
        */}
      <AppearanceSheet
        visible={appearance}
        onClose={() => setAppearance(false)}
        document={title}
        appearance={settings.appearance}
        onChange={(next) => setSettings({ ...settings, appearance: next })}
      />
      {actions ? <ReaderActions document={id} appearance onClose={() => setActions(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: INK.page, flex: 1 },
  slot: { flex: 1 },
  waiting: { alignItems: 'flex-start', backgroundColor: INK.page, gap: 12, justifyContent: 'center', padding: 24 },
  waitingWords: { ...TEXT.subhead, color: INK.quiet },
});
