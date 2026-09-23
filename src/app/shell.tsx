/**
 * The screens of ADR 0019, and the one way back from each of them.
 *
 * ```
 * Library ──┬─→ Reader ──→ (Appearance, a sheet over it)
 *           └─→ Settings ──┬─→ General
 *                          └─→ Providers ──→ one Provider
 * ```
 *
 * `Library` is the initial route. The route list and the shell's own context are
 * in `routes.ts`, which imports no screen, so this file can import every screen
 * without a cycle.
 *
 * ## Why a real stack and not a `useState<Screen>` switch
 *
 * ADR 0019 rejected the switch on three counts, and the middle one is the reason
 * this file exists at all: **the reader must not be rebuilt.** Going to Settings
 * and back must not remount the WebView, reparse the EPUB or lose the highlight.
 * A stack keeps the screen below mounted; a switch unmounts it by construction.
 * The other two are the platform's back gesture, which `native-stack` gets by
 * rendering a real `UINavigationController`, and Android, where a back *button*
 * is not optional (ADR 0001).
 *
 * The **settings** and the **Library** are held here because both outlive any
 * one screen. Both are persisted locally; credentials have their own Keychain store.
 */

// WALKTHROUGH-HARNESS
import { File as HxFile, Paths as HxPaths } from 'expo-file-system';
import { hlog, useHarnessCommands, breakFetch, unbreakFetch, watchFetch, type HarnessCommand } from './walkthrough-harness';
import { asDocumentId } from '../core/document';
import { readProviderKey, saveProviderKey } from '../keys/store';

import { ReaderProvider } from '@epubjs-react-native/core';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Appearance, AppState, useColorScheme } from 'react-native';


import { PALETTE, SETTINGS_SURFACE } from './controls';
import { GeneralScreen } from './general-screen';
import { LibraryScreen } from './library-screen';
import { useHandedOverDocuments, type HandedOverFile } from './opened-document';
import { ProviderScreen } from './provider-screen';
import { ProvidersScreen } from './providers-screen';
import { ReaderScreen } from './reader-screen';
import { navigationRef, ShellContext, type RootStackParamList, type Shell } from './routes';
import { DEFAULT_SETTINGS, resolveTheme, type AppSettings } from './settings';
import { readSettings, writeSettings } from './settings-storage';
import { SettingsScreen } from './settings-screen';
import { SyncScreen } from './sync-screen';
import { useLibrary } from './use-library';
import { voiceLists } from './use-voices';
import { useSync } from './use-sync';
import { configureDownloads, startDownloads } from '../offline/runtime';
import { DownloadIndexer } from '../offline/indexer';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function OpenReader() {
  const [settings, updateSettings] = useState<AppSettings>(() => {
    try { return readSettings(); } catch {
      Alert.alert('Settings could not be loaded', 'Your saved file has been kept. Check device storage before editing settings.');
      return DEFAULT_SETTINGS;
    }
  });
  const settingsRef = useRef(settings);
  const setSettings = useCallback<Shell['setSettings']>((next) => {
    const value = typeof next === 'function' ? next(settingsRef.current) : next;
    try { writeSettings(value); } catch {
      Alert.alert('Settings could not be saved', 'Check device storage and try again.');
      return;
    }
    settingsRef.current = value;
    updateSettings(value);
  }, []);
  const library = useLibrary();
  const { sync, last: syncLast } = useSync(settings, library);
  /**
   * The moments the whole app syncs at (issue #20): once the Library has been
   * read at launch, and whenever the app comes to the foreground or goes to the
   * background. The Reader and the Library screen add theirs — opening a book,
   * pausing, leaving, adding — and nothing runs on a timer.
   *
   * Both effects depend on `sync`, which is stable for the app's life; `syncLast`
   * changes on every completed run and must never be in a dependency list here,
   * or each completion pokes the next run for ever (`use-sync.ts`).
   */
  const libraryLoading = library.loading;
  useEffect(() => {
    if (!libraryLoading) sync.poke('launch');
  }, [libraryLoading, sync]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync.poke('foreground');
      else if (state === 'background') sync.poke('background');
    });
    return () => subscription.remove();
  }, [sync]);
  useEffect(() => { configureDownloads(settings); }, [settings]);
  useEffect(() => startDownloads(), []);
  /**
   * Every enabled Provider's Voices, asked for in the background as the app
   * starts (#24), so the voice list is already there on the first tap. Once per
   * start: the lists stay in memory for the run, so coming back from the
   * background has nothing to fetch, and a failure here stays silent — the sheet
   * asks again, and reports, when it is opened.
   */
  useEffect(() => { voiceLists.prefetch(settingsRef.current); }, []);
  /**
   * How many credentials have been written this session. `routes.ts` says what
   * it is for; what it is *not* is a credential, or even whether there is one —
   * a number that only ever goes up, held here because the screen that writes
   * and the screens that have to notice are never the same screen.
   */
  const [secretsWritten, setSecretsWritten] = useState(0);
  const [secretRevisions, setSecretRevisions] = useState<Shell['secretRevisions']>({});
  const noteSecretWritten = useCallback<Shell['noteSecretWritten']>((provider) => {
    setSecretsWritten((was) => was + 1);
    if (provider) setSecretRevisions((was) => ({ ...was, [provider]: (was[provider] ?? 0) + 1 }));
  }, []);
  const shell = useMemo<Shell>(
    () => ({ settings, setSettings, library, secretsWritten, secretRevisions, noteSecretWritten, sync, syncLast }),
    [settings, setSettings, library, secretsWritten, secretRevisions, noteSecretWritten, sync, syncLast],
  );

  // WALKTHROUGH-HARNESS
  useHarnessCommands((command: HarnessCommand) => {
    const what = String(command.do);
    if (what === 'add') {
      void library.add(new HxFile(HxPaths.document, 'Inbox', String(command.file)), { move: false }).then(
        (entry) => hlog(`added ${entry.id} "${entry.title}"`),
        (problem: unknown) => hlog(`add refused: ${String(problem)}`),
      );
      return;
    }
    if (what === 'shelf') {
      hlog(`shelf loading=${library.loading} note=${JSON.stringify(library.note)}`);
      for (const entry of library.entries) {
        hlog(
          `shelf ${entry.id.slice(7, 15)} "${entry.title}" voice=${entry.voice ? `${entry.voice.provider}/${entry.voice.voice}` : 'null'} ` +
            `place=${entry.position ? JSON.stringify(entry.position.anchor.exact.slice(0, 40)) : 'null'} stamp=${entry.stamp.at}`,
        );
      }
      return;
    }
    if (what === 'file') {
      try {
        hlog(`file ${String(command.name)} = ${new HxFile(HxPaths.document, String(command.name)).textSync()}`);
      } catch (problem) {
        hlog(`file ${String(command.name)} threw ${String(problem)}`);
      }
      return;
    }
    if (what === 'settings') {
      setSettings((was) => ({ ...was, ...(command.patch as Partial<AppSettings>) }));
      hlog(`settings patched ${JSON.stringify(command.patch)}`);
      return;
    }
    if (what === 'saysettings') {
      hlog(`settings ${JSON.stringify(settings)} secretsWritten=${secretsWritten}`);
      return;
    }
    if (what === 'open') {
      const id = asDocumentId(String(command.id));
      if (!id) return hlog(`open: ${String(command.id)} is not a Document Id`);
      if (navigationRef.isReady()) navigationRef.navigate('Reader', { id });
      return;
    }
    if (what === 'navstate') {
      hlog(`navstate ${JSON.stringify(navigationRef.isReady() ? navigationRef.getRootState() : null)}`);
      return;
    }
    if (what === 'shut') {
      // The back arrow, which is `goBack` — React Navigation 7's `navigate`
      // pushes rather than popping, and using it here stacked four screens.
      if (navigationRef.isReady() && navigationRef.canGoBack()) navigationRef.goBack();
      return;
    }
    if (what === 'go') {
      if (navigationRef.isReady()) {
        const route = String(command.route) as 'Settings';
        if (command.params) navigationRef.navigate(route, command.params as never);
        else navigationRef.navigate(route);
      }
      return;
    }
    if (what === 'back') {
      if (navigationRef.isReady()) navigationRef.goBack();
      return;
    }
    if (what === 'resave') {
      // The same two calls, in the same order, that `use-provider-secrets.ts`
      // makes when Save is pressed: write the Keychain, then tell the shell.
      void readProviderKey(String(command.provider)).then((found) => {
        if (found.outcome !== 'found') return hlog(`resave: no key held (${found.outcome})`);
        void saveProviderKey(String(command.provider), found.secret).then((change) => {
          noteSecretWritten(String(command.provider) as AppSettings['provider']);
          hlog(`resave ${String(command.provider)} ${change.outcome}`);
        });
      });
      return;
    }
    if (what === 'breakfetch') return breakFetch(String(command.host), Number(command.from));
    if (what === 'unbreakfetch') return unbreakFetch();
    if (what === 'watchfetch') return watchFetch(String(command.host));
  });

  /**
   * A book arriving from Files, Mail or a messaging app: into the Library, and
   * open it.
   *
   * `navigate` rather than `push`, so a second tap on the same book while its
   * Reader is already on screen does not stack a second copy of a 34 MB document
   * — the route params are compared and the screen already there is kept.
   */
  const arrived = useCallback(
    (handed: HandedOverFile) => {
      void library
        .add(handed.file, { move: handed.move })
        .then((entry) => {
          // A book the desktop has read opens at the desktop's place (issue #20).
          sync.poke('add');
          if (navigationRef.isReady()) navigationRef.navigate('Reader', { id: entry.id });
        })
        .catch((problem: unknown) => {
          library.report(`That document could not be opened: ${problem instanceof Error ? problem.message : String(problem)}`);
        });
    },
    [library, sync],
  );
  useHandedOverDocuments(arrived);

  /**
   * The theme, resolved once for the whole app (ADR 0022).
   *
   * `useColorScheme()` is only consulted for `'system'` — `resolveTheme` decides —
   * so an owner who chose Light keeps it whatever the phone does at sunset.
   */
  const scheme = resolveTheme(settings.theme, useColorScheme());
  const navigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background: PALETTE[scheme].page,
      card: PALETTE[scheme].page, text: PALETTE[scheme].text, border: PALETTE[scheme].line } };
  }, [scheme]);
  /**
   * The settings screens sit on the settings page's grey rather than on the
   * white the Library and the reader have, header included, so the header and
   * the page under it are one surface as on the phone's own Settings (design
   * 0041). Plain strings, for the reason `screenOptions` gives below.
   */
  const settingsScreen = useMemo(() => ({
    headerStyle: { backgroundColor: SETTINGS_SURFACE[scheme].page },
    contentStyle: { backgroundColor: SETTINGS_SURFACE[scheme].page },
  }), [scheme]);

  /**
   * Tell UIKit, which is what actually repaints.
   *
   * `INK`'s colours are iOS dynamic colours, and a dynamic colour is resolved from
   * the trait collection of the view it is drawn in — so forcing a theme is
   * forcing the **window's** `overrideUserInterfaceStyle`, which is exactly what
   * this call does (`RCTAppearance.mm` walks `connectedScenes`, which is why it
   * still works under the UIScene life cycle of ADR 0018). Nothing re-renders;
   * every screen repaints itself.
   *
   * `'unspecified'` gives the window back to the system rather than pinning it to
   * whatever the system happened to be when Follow was chosen — it is the value
   * `RCTConvert` maps to `UIUserInterfaceStyleUnspecified`, and the one
   * `useColorScheme()` then reports until the system answers.
   */
  useEffect(() => {
    Appearance.setColorScheme(settings.theme === 'system' ? 'unspecified' : settings.theme);
  }, [settings.theme]);

  return (
    <ShellContext.Provider value={shell}>
      <DownloadIndexer />
      {/*
       * `ReaderProvider` is `@epubjs-react-native/core`'s own context and has to
       * sit above both `<Reader>` and `useReaderBridge`, which reads
       * `injectJavascript` and `goToLocation` out of it (ADR 0011). It is above
       * the navigator rather than inside the Reader route because it builds its
       * value with hooks of its own, and a context created and destroyed per
       * push is one more thing that can be half-torn-down while a WebView is
       * still talking to it.
       */}
      <ReaderProvider>
        {/* The clock and the battery, over `PALETTE[scheme].panel`. Stated rather
            than left to `auto`, which reads the system's scheme and would be the
            one thing still light when the owner has chosen Dark on a light phone. */}
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <NavigationContainer ref={navigationRef} theme={navigationTheme}>
          <Stack.Navigator
            initialRouteName="Library"
            screenOptions={{
              // Plain strings and not `INK`: the navigation library types these as
              // `string` and will not take a dynamic colour, so this is the one
              // place the theme is resolved in JavaScript rather than by UIKit.
              headerStyle: { backgroundColor: PALETTE[scheme].page },
              headerShadowVisible: false,
              // The way back is the arrow alone, as on the phone's own Settings,
              // which no longer names the screen behind it (#48). VoiceOver calls
              // it `Back` (measured), where the phone's own Settings says the
              // screen's name; minimal mode offers no label of its own. The
              // screens keep their `headerBackTitle` for the back button's
              // long-press menu, which still lists it.
              headerBackButtonDisplayMode: 'minimal',
              headerTintColor: PALETTE[scheme].text,
              headerTitleStyle: { color: PALETTE[scheme].text },
              contentStyle: { backgroundColor: PALETTE[scheme].page },
            }}
          >
            <Stack.Screen name="Library" component={LibraryScreen} options={{ title: 'Library' }} />
            <Stack.Screen name="Reader" component={ReaderScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings', ...settingsScreen }} />
            <Stack.Screen name="General" component={GeneralScreen} options={{ title: 'General', headerBackTitle: 'Settings', ...settingsScreen }} />
            <Stack.Screen name="Providers" component={ProvidersScreen} options={{ title: 'Providers', headerBackTitle: 'Settings', ...settingsScreen }} />
            {/* Its title is the Provider's own name and is set by the screen, which is the one place that knows the route's id. */}
            <Stack.Screen name="Provider" component={ProviderScreen} options={settingsScreen} />
            <Stack.Screen name="Sync" component={SyncScreen} options={{ title: 'Sync', headerBackTitle: 'Settings', ...settingsScreen }} />
          </Stack.Navigator>
        </NavigationContainer>
      </ReaderProvider>
    </ShellContext.Provider>
  );
}
