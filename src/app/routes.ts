/**
 * The screens by name, and the things every one of them can reach.
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
import type { ProviderId } from '../core/providers/types';

import type { AppSettings } from './settings';
import type { Library } from './use-library';

/**
 * `Settings` is a list of two, and `Providers` opens **one Provider at a time**
 * (ADR 0019). A route per Provider rather than one screen with a picker at the
 * top, because the picker is what the split exists to remove: the fields that do
 * not apply are not clutter, they are questions the owner cannot answer and
 * cannot tell are not being asked of them (`docs/design/0019`).
 *
 * `Provider` takes the Provider's **id** and nothing else, for the same reason
 * `Reader` takes a Document Id: a native stack serialises its route params, so
 * what crosses has to be a name that still means the same thing after a state
 * restore.
 */
export type RootStackParamList = {
  Library: undefined;
  Reader: { id: DocumentId };
  Settings: undefined;
  General: undefined;
  Providers: undefined;
  Provider: { id: ProviderId };
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
  /**
   * How many times a credential has been written to the Keychain this session.
   *
   * A counter and not the credential, and not even whether there is one: what it
   * carries is that the Keychain changed, which is the one fact every screen
   * needs and none of them can observe. The Library, the Reader beneath the
   * stack and the Provider screen being typed into are all mounted at once, and
   * only the last of them writes — so without this the first two go on showing
   * what was true when they mounted, and the Reader's Play button stays disabled
   * for a key that is now saved.
   *
   * `use-reading.ts` reads it too, and for a stronger reason: an engine built
   * around a credential that has since been replaced will keep using the old one
   * until something else rebuilds it. Pasting the right gateway token and still
   * getting a 403 is exactly the invisible failure this project's rules forbid.
   */
  secretsWritten: number;
  /** Called by `use-provider-secrets.ts` after a save or a forget, and by nothing else. */
  noteSecretWritten(): void;
}

export const ShellContext = createContext<Shell | null>(null);

/** The settings and the Library, from any screen. Throws rather than handing back a plausible empty shell. */
export function useShell(): Shell {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error(`useShell() was called outside ${APP_NAME}. The shell holds the Library and the settings, and there is exactly one.`);
  return shell;
}
