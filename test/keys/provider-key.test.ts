import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { providerKeyEntryName, SYNC_PASSWORD_ENTRY_NAME } from '../../src/keys/entry-name';
import { keychainRefusal } from '../../src/keys/refusal';

/**
 * `src/keys/store.ts` is not imported here and cannot be: `expo-secure-store`
 * resolves its native module at import time, and test/README.md says native
 * modules are not tested in this suite by design. Faking the module would only
 * assert that the fake was called the way the fake was written.
 *
 * What is left is genuinely testable, and it is the part that can be quietly
 * wrong:
 *
 * - **entry-name.ts** decides which entry holds which Provider's key, and those
 *   entries survive an app uninstall (ADR 0002). A derivation that changes, or
 *   that two Provider ids collide in, abandons a key on a device where nothing
 *   the app can do will reach it again.
 * - **refusal.ts** is the whole of PHILOSOPHY rule 1 in this module: whether "no
 *   key stored" and "the Keychain would not answer" stay distinguishable.
 *
 * The last block below reads `store.ts` as text. That is the same tool
 * test/app-config.test.ts uses on `app.config.ts`, for the same reason: the two
 * decisions it checks live in one line each, their values come from a native
 * module so nothing here can evaluate them, and undoing either produces an app
 * that works on a desk and fails in a pocket.
 */

const KEYS = new URL('../../src/keys/', import.meta.url);

/** Every TypeScript file in `src/keys/`, as `[name, source]`. */
const sources = readdirSync(KEYS)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => [name, readFileSync(new URL(name, KEYS), 'utf8')] as const);

function sourceOf(name: string): string {
  const found = sources.find(([file]) => file === name);
  if (found === undefined) throw new Error(`src/keys/${name} does not exist`);
  return found[1];
}

/**
 * The Provider ids ADR 0013's copied layer uses. Used as data rather than
 * imported from `src/core/providers/`: `src/keys/` deliberately imports nothing
 * from `src/core/` (ADR 0002), so this list is a copy on purpose and not a
 * shortcut waiting to be tidied.
 */
const PROVIDER_IDS = [
  'openai-official',
  'mimo',
  'compatible',
  'azure',
  'cloudflare',
  'speechify',
  'fish',
  'fishspeech',
  'local',
  'system',
];

describe('ADR 0002: one key per Keychain entry, keyed by Provider', () => {
  it('gives every Provider its own entry, so no entry ever holds a combined blob', () => {
    // Not a style preference. Keychain values have historically been refused
    // above roughly 2 KB, which no single API key approaches and a JSON object
    // holding every Provider's key eventually would.
    const names = PROVIDER_IDS.map(providerKeyEntryName);
    expect(new Set(names).size).toBe(PROVIDER_IDS.length);
  });

  it('derives a name that is stable, because the entry outlives the app that wrote it', () => {
    // These entries survive an app uninstall. Changing the derivation is not a
    // rename, it is an abandonment: the old entry stays on the device holding
    // the owner's key, and nothing in the app can name it any more.
    expect(providerKeyEntryName('azure')).toBe('provider-key.azure');
    expect(providerKeyEntryName('openai-official')).toBe('provider-key.openai-official');
  });

  it('produces names expo-secure-store will accept', () => {
    // Its own isValidKey, from node_modules/expo-secure-store/src/SecureStore.ts.
    // A name it rejects never reaches the Keychain — ensureValidKey throws first
    // — so it would arrive as a rejected promise indistinguishable from the
    // Keychain refusing, which is exactly the confusion this module avoids.
    const isValidKey = /^[\w.-]+$/;
    for (const id of PROVIDER_IDS) {
      expect(isValidKey.test(providerKeyEntryName(id)), id).toBe(true);
    }
  });

  it('names the Sync Folder password entry so expo-secure-store accepts it, apart from every Provider entry', () => {
    // One folder, one entry (issue #20). It shares nothing with a Provider's
    // prefix, so a Keychain viewer can tell whose it is.
    expect(/^[\w.-]+$/.test(SYNC_PASSWORD_ENTRY_NAME)).toBe(true);
    expect(PROVIDER_IDS.map(providerKeyEntryName)).not.toContain(SYNC_PASSWORD_ENTRY_NAME);
    expect(SYNC_PASSWORD_ENTRY_NAME.startsWith('provider-key.')).toBe(false);
  });

  it('refuses an empty Provider id, which that same rule would let through', () => {
    // The trap: the prefix on its own is a perfectly valid entry name, so
    // without this check every caller that lost its id would share one key.
    expect(/^[\w.-]+$/.test('provider-key.')).toBe(true);
    expect(() => providerKeyEntryName('')).toThrow(/Provider id/);
  });

  it('refuses a Provider id that cannot appear in an entry name', () => {
    for (const id of ['openai official', 'openai/official', 'azure:eastus', 'fishspeech!', 'café', ' azure']) {
      expect(() => providerKeyEntryName(id), id).toThrow(/cannot have one/);
    }
  });
});

describe('PHILOSOPHY rule 1: a Keychain refusal is a value, not a swallowed null', () => {
  it('passes on what the native module reported, rather than a sentence of our own', () => {
    const refusal = keychainRefusal(new Error('No keychain is available. You may need to restart your computer.'));
    expect(refusal.message).toBe('No keychain is available. You may need to restart your computer.');
  });

  it('keeps the cause, so a refusal that is really a bug is still debuggable', () => {
    const thrown = new Error('I/O error.');
    expect(keychainRefusal(thrown).cause).toBe(thrown);
  });

  it('recognises the locked-out failure, including inside the wrapper ExpoModulesCore adds', () => {
    // errSecInteractionNotAllowed: the entry is there and its accessibility will
    // not allow a read in the device's current state. It is the 2 a.m. failure
    // AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY exists to prevent, and it means the
    // entry on the device was created at a stricter accessibility than the one
    // asked for now — which saving the key again over it does not fix.
    expect(keychainRefusal(new Error('User interaction is not allowed.')).interactionNotAllowed).toBe(true);
    expect(
      keychainRefusal(
        new Error(
          "Call to function 'ExpoSecureStore.getValueWithKeyAsync' has been rejected.\n" +
            '→ Caused by: User interaction is not allowed.',
        ),
      ).interactionNotAllowed,
    ).toBe(true);
  });

  it('does not claim it for a different Keychain failure', () => {
    expect(keychainRefusal(new Error('The specified item could not be found in the keychain.')).interactionNotAllowed).toBe(false);
  });

  it('never throws, whatever it is handed', () => {
    // It runs inside every catch block in store.ts. One that can fail is a
    // failure with no report at all.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const causes: [string, unknown][] = [
      ['undefined', undefined],
      ['null', null],
      ['the empty string', ''],
      ['a plain string', 'the Keychain said no'],
      ['a number', 0],
      ['a circular object', circular],
      ['an Error with no message', new Error('')],
      ['a symbol', Symbol('nope')],
      ['a bigint', 1n],
    ];

    for (const [label, cause] of causes) {
      const refusal = keychainRefusal(cause);
      expect(refusal.message.length, label).toBeGreaterThan(0);
      expect(refusal.cause, label).toBe(cause);
      expect(refusal.interactionNotAllowed, label).toBe(false);
    }
  });
});

describe('the two ADR decisions that live in one line each of src/keys/store.ts', () => {
  it('stores the key at AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, and at nothing else', () => {
    // The default, WHEN_UNLOCKED, cannot be read while the screen is locked,
    // which is when a backgrounded reader needs the key to synthesize the next
    // Utterance (ADR 0002). Nothing else in this repo would notice this line
    // changing; the person who notices is the one whose book stops in a pocket.
    const chosen = [...sourceOf('store.ts').matchAll(/keychainAccessible:\s*([\w.]+)/g)].map((match) => match[1]);
    expect(chosen).toEqual(['SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY']);
  });

  it('puts no biometric gate in front of the key', () => {
    // app.config.ts already sets faceIDPermission: false, and
    // test/app-config.test.ts guards that; this is the same decision from the
    // other side. The option's name appears in store.ts's prose explaining why
    // it is never used, so what is checked for is the option being set.
    for (const [file, text] of sources) {
      expect(text, file).not.toMatch(/requireAuthentication\s*:/);
      expect(text, file).not.toMatch(/authenticationPrompt/);
    }
  });

  it('carries no route to a provider (ADR 0017)', () => {
    // The one rejection in this category with a documented resolution turned on
    // exactly this: remove the link from the binary. The key field, the save
    // action and the provider picker were never the problem.
    for (const [file, text] of sources) {
      expect(text, file).not.toMatch(/https?:\/\//);
      expect(text, file).not.toMatch(/\bwww\./);
    }
  });
});
