import { createElement, type ReactNode } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';

import { APP_VERSION } from '../../app-version';
import { DEFAULT_SETTINGS } from '../../src/app/settings';

/**
 * Settings' version line (#30) says when a build has Debug Mode (#82, design
 * 0054): `0.0.2-beta51-debug`, read aloud as `Version 0.0.2-beta51-debug`, and
 * the beta alone in a build without it. Nothing else on the screen changes.
 * The real screen, with the settings controls replaced by probes that keep
 * what they were handed.
 */
const footnotes = vi.hoisted(() => [] as { label: string | undefined; text: ReactNode }[]);
const rows = vi.hoisted(() => [] as string[]);
const links = vi.hoisted(() => new Map<string, () => void>());
const openPrivacyPolicy = vi.hoisted(() => vi.fn());
const presses = vi.hoisted(() => new Map<string, () => void>());
const navigate = vi.hoisted(() => vi.fn());
vi.mock('../../src/app/own-site', () => ({ openPrivacyPolicy }));
vi.mock('../../src/app/controls', () => ({
  SettingsPage: ({ children }: { children: ReactNode }) => children,
  SettingsGroup: ({ footer, children }: { footer: ReactNode; children: ReactNode }) => [footer, children],
  Footnote: ({ children, accessibilityLabel }: { children: ReactNode; accessibilityLabel?: string }) => {
    footnotes.push({ label: accessibilityLabel, text: children });
    return null;
  },
  NavigationRow: ({ label, value, onPress }: { label: string; value?: string; onPress(): void }) => {
    rows.push(value ? `${label}: ${value}` : label);
    presses.set(label, onPress);
    return null;
  },
  ActionRow: ({ label, onPress }: { label: string; onPress(): void }) => {
    rows.push(`link: ${label}`);
    links.set(label, onPress);
    return null;
  },
}));
vi.mock('../../src/app/routes', () => ({ useShell: () => ({ settings: DEFAULT_SETTINGS }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

async function shown(debugMode: boolean) {
  vi.resetModules();
  // The build's answer, as `DEBUG_MODE` would be fixed in it; `shownVersion` is the real one.
  vi.doMock('../../src/debug/mode', async (original) => {
    const real = await original<typeof import('../../src/debug/mode')>();
    return { DEBUG_MODE: debugMode, shownVersion: (version: string) => real.shownVersion(version, debugMode) };
  });
  footnotes.length = 0;
  rows.length = 0;
  const { SettingsScreen } = await import('../../src/app/settings-screen');
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(createElement(SettingsScreen, { navigation: { navigate }, route: {} } as never));
  });
  await act(async () => tree!.unmount());
  return { footnote: footnotes.at(-1)!, rows: [...new Set(rows)] };
}

afterEach(() => vi.doUnmock('../../src/debug/mode'));

it('shows the version and reads it aloud with -debug in Debug Mode', async () => {
  const { footnote } = await shown(true);
  expect(footnote.text).toBe(`${APP_VERSION}-debug`);
  expect(footnote.label).toBe(`Version ${APP_VERSION}-debug`);
});

it('shows the beta alone in a build without Debug Mode, and the rows above it are the same either way', async () => {
  const off = await shown(false);
  expect(off.footnote.text).toBe(APP_VERSION);
  expect(off.footnote.label).toBe(`Version ${APP_VERSION}`);
  const on = await shown(true);
  expect(on.rows).toEqual(off.rows);
  expect(off.rows).toEqual(['General', 'Word Lookup & Translation', 'Providers: 0 enabled', 'Sync: Off', 'link: Privacy Policy', 'Acknowledgements']);
});

it('opens the privacy policy from its own row, under the settings and above the version (#110)', async () => {
  await shown(false);
  openPrivacyPolicy.mockClear();
  links.get('Privacy Policy')!();
  expect(openPrivacyPolicy).toHaveBeenCalledTimes(1);
});

it('opens the acknowledgements from the row under the privacy policy (#111)', async () => {
  await shown(false);
  navigate.mockClear();
  presses.get('Acknowledgements')!();
  expect(navigate).toHaveBeenCalledWith('Acknowledgements');
});
