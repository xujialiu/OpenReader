/**
 * The four screens of ADR 0019, and the one way back from each of them.
 *
 * ```
 * Library ──┬─→ Reader ──→ (Appearance, a sheet over it)
 *           └─→ Settings
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
 * one screen. They are still not stored anywhere (`settings.ts` says why for the
 * settings; the Library is a file, `library.ts`).
 */

import { ReaderProvider } from '@epubjs-react-native/core';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';

import { APP_NAME } from '../../app-name';

import { INK } from './controls';
import { LibraryScreen } from './library-screen';
import { useHandedOverDocuments, type HandedOverFile } from './opened-document';
import { ReaderScreen } from './reader-screen';
import { navigationRef, ShellContext, type RootStackParamList, type Shell } from './routes';
import { DEFAULT_SETTINGS, type AppSettings } from './settings';
import { SettingsScreen } from './settings-screen';
import { useLibrary } from './use-library';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function OpenReader() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const library = useLibrary();
  const shell = useMemo<Shell>(() => ({ settings, setSettings, library }), [settings, library]);

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
          if (navigationRef.isReady()) navigationRef.navigate('Reader', { id: entry.id });
        })
        .catch((problem: unknown) => {
          library.report(`That document could not be opened: ${problem instanceof Error ? problem.message : String(problem)}`);
        });
    },
    [library],
  );
  useHandedOverDocuments(arrived);

  return (
    <ShellContext.Provider value={shell}>
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
        <StatusBar style="dark" />
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator
            initialRouteName="Library"
            screenOptions={{
              headerStyle: { backgroundColor: INK.panel },
              headerTintColor: INK.text,
              headerTitleStyle: { color: INK.text },
              contentStyle: { backgroundColor: INK.page },
            }}
          >
            <Stack.Screen name="Library" component={LibraryScreen} options={{ title: APP_NAME }} />
            <Stack.Screen name="Reader" component={ReaderScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </ReaderProvider>
    </ShellContext.Provider>
  );
}
