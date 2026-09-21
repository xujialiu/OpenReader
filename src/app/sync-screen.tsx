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
 * One status line, and nothing else on the screen: what the last sync did, or
 * why the switch would not go on. It carries a fact each time — a time, a
 * count, a refusal — which is what a line has to do to be here at all.
 */

import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { forgetSyncPassword, readSyncPassword, saveSyncPassword } from '../keys/store';
import type { SyncOutcome } from '../core/sync/transport';

import { Field, INK, Note, SettingsGroup, SwitchRow } from './controls';
import { useShell } from './routes';

/** The status line: the last sync in one sentence, or the reason the switch went back off. */
function statusLine(last: SyncOutcome | null, refused: string | null, checking: boolean, folderMissing: boolean): string | null {
  if (checking) return 'Checking the folder…';
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
      if (lookup.outcome === 'refused') setRefused(`The Keychain would not say whether a password is saved: ${lookup.refusal.message}`);
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
      if (change.outcome === 'refused') setRefused(`The password could not be saved: ${change.refusal.message}`);
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

  const line = statusLine(syncLast, refused, checking, folderMissing);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <SettingsGroup title="Folder" footer="Turn sync off to change the folder.">
        <Field
          label="Address"
          value={settings.sync.url}
          editable={!locked}
          keyboard="url"
          placeholder="https://"
          onChangeText={(url) => setSettings((was) => ({ ...was, sync: { ...was.sync, url } }))}
        />
        <Field
          label="Username"
          value={settings.sync.username}
          editable={!locked}
          onChangeText={(username) => setSettings((was) => ({ ...was, sync: { ...was.sync, username } }))}
        />
        <Field label="Password" value={password} editable={passwordReady && !locked} secure onChangeText={changePassword} placeholder="Not set" />
      </SettingsGroup>

      <SettingsGroup title="Sync">
        <SwitchRow label="Keep my place across devices" value={settings.sync.enabled} disabled={checking} onChange={(on) => void toggle(on)} />
      </SettingsGroup>

      {line ? (
        <View style={styles.status}>
          <Note attention={!!refused || syncLast?.result === 'error' || syncLast?.result === 'frozen'}>{line}</Note>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { gap: 26, paddingBottom: 64, paddingHorizontal: 16, paddingTop: 16 },
  screen: { backgroundColor: INK.page, flex: 1 },
  status: { paddingHorizontal: 16 },
});
