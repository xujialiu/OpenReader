/**
 * The four screens by name, and the two things every one of them can reach.
 *
 * Split out of `shell.tsx` for one reason: the shell imports every screen and
 * every screen needs the route list and the shell's own context. Left in one
 * file that is a cycle — it would work, because nothing calls `useShell()`
 * before both halves have loaded, and it would be a cycle that works by
 * accident. This file imports no screen, so there is no cycle to reason about.
 *
 * `Reader` takes a **Document Id** and nothing else. A native stack serialises
 * its route params, and a Document Id is already the content hash (ADR 0004), so
 * the route survives a state restore while a path would go stale the moment a
 * file moved (ADR 0019).
 */

import { createNavigationContainerRef } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createContext, useContext } from 'react';

import { APP_NAME } from '../../app-name';
import type { DocumentId } from '../core/document';

import type { AppSettings } from './settings';
import type { Library } from './use-library';

export type RootStackParamList = {
  Library: undefined;
  Reader: { id: DocumentId };
  Settings: undefined;
};

export type ScreenProps<Route extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Route>;

/**
 * The navigator, reachable from outside a screen.
 *
 * It exists for one caller: a Document handed over by another app has to open
 * its Reader, and that happens in a subscription above every screen, which
 * therefore has no `navigation` prop. Nothing else should use it — a screen that
 * navigates has the prop.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * What outlives any one screen: the Library, because the Reader writes a Reading
 * Position into the list the Library screen is showing, and the settings,
 * because the Settings screen changes what the Reader reads with.
 *
 * A context rather than route params, because a route param is serialised and
 * neither of these is data — one of them is a set of callbacks that write a file.
 */
export interface Shell {
  settings: AppSettings;
  setSettings(next: AppSettings): void;
  library: Library;
}

export const ShellContext = createContext<Shell | null>(null);

/** The settings and the Library, from any screen. Throws rather than handing back a plausible empty shell. */
export function useShell(): Shell {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error(`useShell() was called outside ${APP_NAME}. The shell holds the Library and the settings, and there is exactly one.`);
  return shell;
}
