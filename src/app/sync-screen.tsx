/**
 * **Sync**: the Sync Folder, and the switch that proves it (issue #20).
 *
 * Off, the address, the username and the password can be typed. On, they are
 * frozen and the place follows the owner between devices. Turning it on runs
 * the connection check and it stays on only if the check passed — the same
 * shape a Provider's Enable has, for the same reason: the way to edit a thing
 * that is in use is to stop using it first, and the moment of turning it on is
 * the one place a check can run once rather than on every keystroke.
 *
 * The password goes to the Keychain as it is typed, the way a Provider's key
 * does, and never into the settings file. The Device Name is not here: it is a
 * fact about the device, not a choice (`library.ts`).
 *
 * One status line under the switch's card: what the last sync did, or why the
 * switch would not go on. It carries a fact each time — a time, a count, a
 * refusal — which is what a line has to do to be here at all. What is happening
 * now (`Checking the folder…`, or `Turn off to edit.` while it is on) is the line
 * under the switch's own label, and the switch comes before the folder, as a
 * Provider's comes before its fields (design 0041). A password the Keychain
 * would not keep is said under the Folder card, beside the field it is about.
 */

import { useEffect, useState } from 'react';

import { forgetSyncPassword, readSyncPassword, saveSyncPassword } from '../keys/store';
import type { SyncOutcome } from '../core/sync/transport';

import { FieldRow, Footnote, SettingsGroup, SettingsPage, SwitchRow } from './controls';
import { useShell } from './routes';

/** The status line: the last sync in one sentence, or the reason the switch went back off. */
function statusLine(last: SyncOutcome | null, refused: string | null, folderMissing: boolean): string | null {
  if (refused) return refused;
  if (folderMissing) return 'The folder is not there yet. It is created at the first sync.';
  if (!last) return null;
  const when = new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (last.result === 'ok') {
    const moved = last.adopted.length;
    return `Synced at ${when}${moved ? `, ${moved} place${moved === 1 ? '' : 's'} taken from other devices` : ''}.`;
  }
  return `Sync at ${when} failed: ${last.error}`;
}

export function SyncScreen() {
  const { settings, setSettings, sync, syncLast } = useShell();
  const [password, setPassword] = useState('');
  const [passwordReady, setPasswordReady] = useState(false);
  const [checking, setChecking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  /** What the Keychain said about the password, said under the Folder card rather than as the switch's refusal. */
  const [keychain, setKeychain] = useState<string | null>(null);
  /**
   * What the check found about the folder, and which run was the last one
   * when it found it. The folder line is true only until a run completes after
   * the check — the first sync creates the folder — so it is shown while
   * `syncLast` is still the outcome the check saw, and derived rather than
   * cleared, because the run's completion is the fact and not an event to
   * chase.
   */
  const [folderCheck, setFolderCheck] = useState<{ missing: boolean; before: SyncOutcome | null } | null>(null);
  const folderMissing = folderCheck !== null && folderCheck.missing && syncLast === folderCheck.before;

  useEffect(() => {
    let mounted = true;
    void readSyncPassword().then((lookup) => {
      if (!mounted) return;
      if (lookup.outcome === 'found') setPassword(lookup.secret);
      if (lookup.outcome === 'refused') setKeychain(`The Keychain would not say whether a password is saved: ${lookup.refusal.message}`);
      setPasswordReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const locked = settings.sync.enabled || checking;

  const changePassword = (next: string) => {
    setPassword(next);
    void (next ? saveSyncPassword(next) : forgetSyncPassword()).then((change) => {
      setKeychain(change.outcome === 'refused' ? `The password could not be saved: ${change.refusal.message}` : null);
    });
  };

  /**
   * On is a claim that the folder answers, so the claim is checked before it is
   * made. Off is always allowed: it stops the next run and unfreezes the fields,
   * and the values stay where they are.
   */
  const toggle = async (on: boolean) => {
    setRefused(null);
    if (!on) {
      setFolderCheck(null);
      setSettings((was) => ({ ...was, sync: { ...was.sync, enabled: false } }));
      return;
    }
    setChecking(true);
    const checked = await sync.check(settings.sync.url, settings.sync.username, password);
    setChecking(false);
    if (!checked.ok) {
      setRefused(checked.reason);
      return;
    }
    setFolderCheck({ missing: checked.folderMissing, before: syncLast });
    // The first sync is the switch's own doing, and it runs from `use-sync.ts`
    // once these settings are in force — a poke from here would run before
    // they are, read the switch as off, and do nothing.
    setSettings((was) => ({ ...was, sync: { ...was.sync, enabled: true } }));
  };

  const line = statusLine(syncLast, refused, folderMissing);

  return (
    <SettingsPage>
      <SettingsGroup footer={line
        ? <Footnote attention={!!refused || syncLast?.result === 'error' || syncLast?.result === 'frozen'}>{line}</Footnote> : undefined}>
        <SwitchRow label="Keep my place across devices" value={settings.sync.enabled} disabled={checking}
          onChange={(on) => void toggle(on)}
          note={checking ? 'Checking the folder…' : settings.sync.enabled ? 'Turn off to edit.' : undefined} />
      </SettingsGroup>

      <SettingsGroup title="Folder" footer={keychain ? <Footnote attention>{keychain}</Footnote> : undefined}>
        <FieldRow
          label="Address"
          value={settings.sync.url}
          editable={!locked}
          keyboard="url"
          placeholder="https://"
          onChangeText={(url) => setSettings((was) => ({ ...was, sync: { ...was.sync, url } }))}
        />
        <FieldRow
          label="Username"
          value={settings.sync.username}
          editable={!locked}
          onChangeText={(username) => setSettings((was) => ({ ...was, sync: { ...was.sync, username } }))}
        />
        <FieldRow label="Password" value={password} editable={passwordReady && !locked} secure onChangeText={changePassword} placeholder="Not set" />
      </SettingsGroup>
    </SettingsPage>
  );
}
