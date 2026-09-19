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
 * one screen. They are still not stored anywhere (`settings.ts` says why for the
 * settings; the Library is a file, `library.ts`).
 */

import { ReaderProvider } from '@epubjs-react-native/core';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { APP_NAME } from '../../app-name';

import { PALETTE } from './controls';
import { GeneralScreen } from './general-screen';
import { LibraryScreen } from './library-screen';
import { useHandedOverDocuments, type HandedOverFile } from './opened-document';
import { ProviderScreen } from './provider-screen';
import { ProvidersScreen } from './providers-screen';
import { ReaderScreen } from './reader-screen';
import { navigationRef, ShellContext, type RootStackParamList, type Shell } from './routes';
import { DEFAULT_SETTINGS, resolveTheme, type AppSettings } from './settings';
import { SettingsScreen } from './settings-screen';
import { useLibrary } from './use-library';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function OpenReader() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const library = useLibrary();
  /**
   * How many credentials have been written this session. `routes.ts` says what
   * it is for; what it is *not* is a credential, or even whether there is one —
   * a number that only ever goes up, held here because the screen that writes
   * and the screens that have to notice are never the same screen.
   */
  const [secretsWritten, setSecretsWritten] = useState(0);
  const noteSecretWritten = useCallback(() => setSecretsWritten((was) => was + 1), []);
  const shell = useMemo<Shell>(
    () => ({ settings, setSettings, library, secretsWritten, noteSecretWritten }),
    [settings, library, secretsWritten, noteSecretWritten],
  );

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

  /**
   * The theme, resolved once for the whole app (ADR 0022).
   *
   * `useColorScheme()` is only consulted for `'system'` — `resolveTheme` decides —
   * so an owner who chose Light keeps it whatever the phone does at sunset.
   */
  const scheme = resolveTheme(settings.theme, useColorScheme());

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
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator
            initialRouteName="Library"
            screenOptions={{
              // Plain strings and not `INK`: the navigation library types these as
              // `string` and will not take a dynamic colour, so this is the one
              // place the theme is resolved in JavaScript rather than by UIKit.
              headerStyle: { backgroundColor: PALETTE[scheme].panel },
              headerTintColor: PALETTE[scheme].text,
              headerTitleStyle: { color: PALETTE[scheme].text },
              contentStyle: { backgroundColor: PALETTE[scheme].page },
            }}
          >
            <Stack.Screen name="Library" component={LibraryScreen} options={{ title: APP_NAME }} />
            <Stack.Screen name="Reader" component={ReaderScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
            <Stack.Screen name="General" component={GeneralScreen} options={{ title: 'General', headerBackTitle: 'Settings' }} />
            <Stack.Screen name="Providers" component={ProvidersScreen} options={{ title: 'Providers', headerBackTitle: 'Settings' }} />
            {/* Its title is the Provider's own name and is set by the screen, which is the one place that knows the route's id. */}
            <Stack.Screen name="Provider" component={ProviderScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </ReaderProvider>
    </ShellContext.Provider>
  );
}
