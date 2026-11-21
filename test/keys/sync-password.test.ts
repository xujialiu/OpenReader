import { expect, it, vi } from 'vitest';

import { forgetSyncPassword, readSyncPassword, saveSyncPassword } from '../../src/keys/store';

const keychain = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (name: string) => keychain.get(name) ?? null,
  deleteItemAsync: async (name: string) => { keychain.delete(name); },
  setItemAsync: async (name: string, value: string) => { keychain.set(name, value); },
}));

it('clearing during an autosave leaves the password absent for the next Sync screen and WebDAV read', async () => {
  await saveSyncPassword('previous');
  const saving = saveSyncPassword('replacement');
  const clearing = forgetSyncPassword();
  const reopening = readSyncPassword();
  await Promise.all([saving, clearing]);
  expect(await reopening).toEqual({ outcome: 'absent' });
  expect(await readSyncPassword()).toEqual({ outcome: 'absent' });
});

it('a password typed after clearing is available to a read requested during the edit', async () => {
  const clearing = forgetSyncPassword();
  const saving = saveSyncPassword('replacement');
  const reading = readSyncPassword();
  await Promise.all([clearing, saving]);
  expect(await reading).toEqual({ outcome: 'found', secret: 'replacement' });
});
