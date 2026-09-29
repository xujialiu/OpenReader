import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pin } from '../structural';

/**
 * ADR 0054, design 0054: API keys, Gateway Headers, the WebDAV password and the
 * Translator key never reach the Debug Log. Three guards, each tested here:
 *
 * 1. the lines the app builds take named facts, and no call passes anything
 *    credential-bearing (the source rule at the end);
 * 2. the request lines take a method and an address and never read a request's
 *    headers, query or body (`loggedFetch`);
 * 3. every secret `src/keys/store.ts` reads or writes is held by the guard,
 *    the latest per Keychain entry and none shorter than eight characters, and
 *    written as `[credential]` wherever a line would carry it — which is what
 *    covers the lines the app does not build: `HX`, `console.warn`/`error`,
 *    uncaught errors.
 */

const keychain = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  getItemAsync: async (name: string) => keychain.get(name) ?? null,
  setItemAsync: async (name: string, value: string) => void keychain.set(name, value),
  deleteItemAsync: async (name: string) => void keychain.delete(name),
}));
vi.mock('../../src/debug/mode', () => ({ DEBUG_MODE: true }));

const { REDACTED, forbidCredential, forbidGatewayHeaders, forgetCredentials, withoutCredentials } = await import('../../src/debug/credentials');
const { createDebugLog } = await import('../../src/debug/debug-log');
const { setDebugLogWriter } = await import('../../src/debug/debug-log');
const { loggedFetch } = await import('../../src/debug/requests');
const store = await import('../../src/keys/store');
const { SYNC_PASSWORD_ENTRY_NAME } = await import('../../src/keys/entry-name');

/** Everything a writer would put in the file and in the system log, for one line. */
function logged(message: string): string {
  const out: string[] = [];
  const log = createDebugLog({
    files: { list: () => [], size: () => 0, append: (_name, text) => void out.push(text), remove: () => {} },
    now: () => 0,
    systemLog: (line) => void out.push(line),
  });
  log.write('hx', message);
  log.flush();
  return out.join('\n');
}

beforeEach(() => {
  forgetCredentials();
  keychain.clear();
});

describe('what the Keychain hands over is never written', () => {
  it('an API key, read or saved', async () => {
    keychain.set('provider-key.fish', 'fish-KEY-0123456789abcdef');
    await store.readProviderKey('fish');
    await store.saveProviderKey('openai-official', 'sk-proj-SAVED-0123456789');
    const line = logged('HX settings fish-KEY-0123456789abcdef and sk-proj-SAVED-0123456789');
    expect(line).not.toContain('KEY-0123');
    expect(line).not.toContain('SAVED');
    expect(line).toContain(`HX settings ${REDACTED} and ${REDACTED}`);
  });

  it('Gateway Headers, whole, value by value, and a Bearer token on its own', async () => {
    const typed = 'CF-Access-Client-Id: 0a1b2c3d.access; CF-Access-Client-Secret: 9f8e7d6c5b4a39281706\nAuthorization: Bearer gw-tok-55555555';
    await store.saveGatewayHeaders('local', typed);
    keychain.set('gateway-headers.compatible', 'X-Token: compat-777777');
    await store.readGatewayHeaders('compatible');
    const line = logged(`asked with ${JSON.stringify(typed)} then 0a1b2c3d.access then 9f8e7d6c5b4a39281706 then gw-tok-55555555 then compat-777777`);
    for (const secret of ['0a1b2c3d', '9f8e7d6c5b4a39281706', 'gw-tok-55555555', 'compat-777777']) expect(line).not.toContain(secret);
  });

  it('the WebDAV password, read, saved, and typed into the Sync screen\'s check before it is saved', async () => {
    keychain.set(SYNC_PASSWORD_ENTRY_NAME, 'correct horse battery staple');
    await store.readSyncPassword();
    expect(logged('PROPFIND correct horse battery staple')).not.toContain('horse');
    await store.saveSyncPassword('p@ss:w0rd;semi');
    expect(logged('PROPFIND p@ss:w0rd;semi')).not.toContain('w0rd');
    forbidCredential(SYNC_PASSWORD_ENTRY_NAME, 'typed-but-not-saved');
    expect(logged('PROPFIND typed-but-not-saved')).not.toContain('typed-but');
  });

  it('the Microsoft Translator key, saved and read', async () => {
    await store.saveTranslationKey('  ms-translator-KEY-42424242  ');
    expect(logged('Ocp key ms-translator-KEY-42424242')).not.toContain('KEY-4242');
    keychain.set('openreader.translation.microsoft', 'ms-translator-OTHER-1313');
    await store.readTranslationKey();
    expect(logged('Ocp key ms-translator-OTHER-1313')).not.toContain('OTHER');
  });

  it('in the spellings a line carries it in: inside JSON, and in a URL', () => {
    forbidCredential('provider-key.fish', 'a"b\\c d/e');
    const line = logged(`${JSON.stringify({ key: 'a"b\\c d/e' })} https://x.test/?k=${encodeURIComponent('a"b\\c d/e')}`);
    expect(line).not.toContain('b\\\\c');
    expect(line).not.toContain('d%2Fe');
  });

  it('leaves a short header flag readable rather than every `1` in the log', () => {
    forbidGatewayHeaders('gateway-headers.local', 'X-Debug: 1; X-Client-Secret: long-enough-secret');
    expect(withoutCredentials('utterance 1 of 12, long-enough-secret')).toBe(`utterance 1 of 12, ${REDACTED}`);
  });

  it('and what no held value covers, by the three patterns: a Bearer or Basic token, a key header, an address\'s name:password@', () => {
    expect(withoutCredentials('Authorization: Basic dXNlcjpodW50ZXIy')).not.toContain('dXNlcjpodW50ZXIy');
    expect(withoutCredentials('Bearer eyJhbGciOiJIUzI1NiJ9.x.y')).toBe(`Bearer ${REDACTED}`);
    expect(withoutCredentials('{"xi-api-key":"abc123","Ocp-Apim-Subscription-Key": "def456"}')).not.toMatch(/abc123|def456/);
    expect(withoutCredentials('https://owner:hunter22@dav.example.com/dav/')).toBe(`https://${REDACTED}@dav.example.com/dav/`);
    // A title is not a credential.
    expect(withoutCredentials('Basic English Grammar')).toBe('Basic English Grammar');
  });
});

describe('one value held per Keychain entry, and none too short to be a secret', () => {
  // Measured 2026-09-29 on the simulator (notes 12:14): the key field saves on
  // every keystroke, every value written was held for the rest of the run, and
  // the key's first character `s` was one of them.
  const ordinary = 'fish GET https://api.fish.audio/model -> 200 in 823 ms';

  it('a key typed one character at a time leaves ordinary text alone, and still redacts the whole key', async () => {
    const key = 'sk-fish-0123456789abcdef';
    for (let end = 1; end <= key.length; end++) await store.saveProviderKey('fish', key.slice(0, end));
    expect(logged(ordinary)).toContain(`[hx] ${ordinary}`);
    expect(logged(`asked with ${key}`)).toContain(`[hx] asked with ${REDACTED}`);
  });

  it('Gateway Headers typed one character at a time leave ordinary text alone, and still redact the token', async () => {
    const typed = 'Authorization: Bearer gw-tok-55555555';
    for (let end = 1; end <= typed.length; end++) await store.saveGatewayHeaders('local', typed.slice(0, end));
    expect(withoutCredentials(`${ordinary} Authorization`)).toBe(`${ordinary} Authorization`);
    expect(withoutCredentials('then gw-tok-55555555')).toBe(`then ${REDACTED}`);
  });

  it('a second value written or read for the same entry replaces the first', async () => {
    await store.saveProviderKey('fish', 'fish-FIRST-0123456789');
    await store.saveProviderKey('fish', 'fish-SECOND-9876543210');
    expect(withoutCredentials('fish-FIRST-0123456789 fish-SECOND-9876543210')).toBe(`fish-FIRST-0123456789 ${REDACTED}`);
    keychain.set('provider-key.fish', 'fish-THIRD-1122334455');
    await store.readProviderKey('fish');
    expect(withoutCredentials('fish-SECOND-9876543210 fish-THIRD-1122334455')).toBe(`fish-SECOND-9876543210 ${REDACTED}`);

    await store.saveGatewayHeaders('local', 'X-Token: first-token-1111; X-Other: other-value-1111');
    await store.saveGatewayHeaders('local', 'X-Token: second-token-2222');
    expect(withoutCredentials('first-token-1111 other-value-1111 second-token-2222')).toBe(`first-token-1111 other-value-1111 ${REDACTED}`);
  });

  it('forgetting an entry\'s secret stops holding it, and holds on to every other entry\'s', async () => {
    await store.saveProviderKey('fish', 'fish-FORGOTTEN-0123456789');
    await store.saveGatewayHeaders('fish', 'X-Token: kept-token-3333');
    await store.forgetProviderKey('fish');
    expect(withoutCredentials('fish-FORGOTTEN-0123456789 kept-token-3333')).toBe(`fish-FORGOTTEN-0123456789 ${REDACTED}`);
    await store.forgetGatewayHeaders('fish');
    expect(withoutCredentials('kept-token-3333')).toBe('kept-token-3333');
  });

  it('holds no value shorter than eight characters, and one of eight', async () => {
    await store.saveProviderKey('fish', 'Seven77');
    await store.saveProviderKey('openai-official', 'Eight888');
    await store.saveTranslationKey('  Short7  ');
    await store.saveSyncPassword('Sync777');
    expect(withoutCredentials('Seven77 Short7 Sync777 Eight888')).toBe(`Seven77 Short7 Sync777 ${REDACTED}`);
    await store.saveGatewayHeaders('local', 'X-Token: Head777; X-Other: Head8888');
    expect(withoutCredentials('Head777 Head8888')).toBe(`Head777 ${REDACTED}`);
  });

  it('holds the values of different entries side by side', async () => {
    await store.saveProviderKey('fish', 'fish-KEY-0123456789');
    await store.saveProviderKey('openai-official', 'sk-proj-KEY-0123456789');
    await store.saveGatewayHeaders('fish', 'X-Token: fish-gateway-4444');
    await store.saveSyncPassword('webdav-password-5555');
    await store.saveTranslationKey('ms-translator-KEY-6666');
    const line = withoutCredentials('fish-KEY-0123456789 sk-proj-KEY-0123456789 fish-gateway-4444 webdav-password-5555 ms-translator-KEY-6666');
    expect(line).toBe(Array(5).fill(REDACTED).join(' '));
  });
});

describe('a request line', () => {
  it('says who asked, the method, the address, the status and the time, and never the headers, query, body or userinfo', async () => {
    const lines: string[] = [];
    setDebugLogWriter({ write: (_category, message) => void lines.push(message), flush: () => {} });
    const fetch = loggedFetch('provider', 'fish', (async () => ({ status: 401 }) as Response) as typeof globalThis.fetch);
    await fetch('https://user:pw-in-url@api.fish.audio/v1/tts?key=QUERY-SECRET#frag', {
      method: 'POST',
      headers: { Authorization: 'Bearer HEADER-SECRET', 'X-Api-Key': 'OTHER-HEADER-SECRET' },
      body: JSON.stringify({ text: 'Hello.', key: 'BODY-SECRET' }),
    });
    const failing = loggedFetch('lookup', 'translation', (async () => { throw new TypeError('Network request failed'); }) as typeof globalThis.fetch);
    await expect(failing('https://translate.example/t?q=SELECTED', { headers: { 'Ocp-Apim-Subscription-Key': 'MS-SECRET' } })).rejects.toThrow();
    setDebugLogWriter(null);
    expect(lines[0]).toMatch(/^fish POST https:\/\/api\.fish\.audio\/v1\/tts -> 401 in \d+ ms$/);
    expect(lines[1]).toMatch(/^translation GET https:\/\/translate\.example\/t failed after \d+ ms: TypeError: Network request failed$/);
    expect(lines.join('\n')).not.toMatch(/SECRET|pw-in-url|SELECTED/);
  });

  it('reads nothing of a request but its address and method', () => {
    const code = readFileSync(new URL('../../src/debug/requests.ts', import.meta.url), 'utf8').replace(/\/\*\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/\.headers|\.body|\binit\?\.(?!method)/);
    pin(code, 'init?.method', 'src/debug/requests.ts');
  });
});

describe('the source rule: no Debug Log line is built from a credential', () => {
  const SRC = new URL('../../src/', import.meta.url).pathname;
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
    });
  /** The text of every `debugLog(…)` call in `src/`, with the file it is in. */
  const calls = files(SRC).flatMap((path) => {
    const text = readFileSync(path, 'utf8');
    const found: { where: string; call: string }[] = [];
    for (let at = text.indexOf('debugLog('); at >= 0; at = text.indexOf('debugLog(', at + 1)) {
      if (/function\s+$/.test(text.slice(Math.max(0, at - 12), at))) continue;
      let depth = 0;
      let end = at + 'debugLog'.length;
      for (; end < text.length; end++) {
        if (text[end] === '(') depth++;
        else if (text[end] === ')' && --depth === 0) break;
      }
      found.push({ where: `${relative(SRC, path)}:${text.slice(0, at).split('\n').length}`, call: text.slice(at, end + 1) });
    }
    return found;
  });

  it('finds the calls it reads', () => {
    // The sites of ADR 0054's list: the Reading, a Document, providers, downloads, sync, lookups, the harness and the launch.
    expect(calls.length).toBeGreaterThan(30);
    for (const file of ['app/use-reading.ts', 'app/reading-host.tsx', 'offline/runtime.ts', 'app/use-sync.ts', 'app/use-lookup.ts', 'app/walkthrough-harness.ts', 'debug/install.ts']) {
      expect(calls.some(({ where }) => where.startsWith(file)), file).toBe(true);
    }
  });

  it('passes none of them a secret, a password, a key, headers or a token', () => {
    const credential = /secret|password|apiKey|microsoftKey|headers|authorization|keyResult|token|credential/i;
    const offending = calls.filter(({ call }) => credential.test(call)).map(({ where, call }) => `${where}: ${call}`);
    expect(offending).toEqual([]);
  });

  it('holds every secret the Keychain module reads and writes, and stops holding what it removes', () => {
    const keys = readFileSync(new URL('../../src/keys/store.ts', import.meta.url), 'utf8');
    pin(keys, "    if (secret === null) return { outcome: 'absent' };\n    forbid(name, secret);", 'src/keys/store.ts readSecret');
    pin(keys, 'Promise<SecretChange> {\n  forbid(name, secret);', 'src/keys/store.ts writeSecret');
    pin(keys, '    await SecureStore.deleteItemAsync(name, KEYCHAIN);\n    forgetCredential(name);', 'src/keys/store.ts removeSecret');
    pin(keys, 'return writeSecret(name, headers, forbidGatewayHeaders);', 'src/keys/store.ts saveGatewayHeaders');
    pin(keys, 'return readSecret(gatewayHeadersEntryName(provider), forbidGatewayHeaders);', 'src/keys/store.ts readGatewayHeaders');
    // No other way to the Keychain: every SecureStore call is inside those three helpers.
    expect(keys.match(/SecureStore\.(get|set|delete)ItemAsync/g)).toHaveLength(4);
  });
});

describe('a build without Debug Mode', () => {
  it('holds nothing', async () => {
    vi.resetModules();
    vi.doMock('../../src/debug/mode', () => ({ DEBUG_MODE: false }));
    const off = await import('../../src/debug/credentials');
    off.forbidCredential('provider-key.fish', 'never-held-0000');
    off.forbidGatewayHeaders('gateway-headers.fish', 'X-Secret: never-held-1111');
    expect(off.withoutCredentials('never-held-0000 never-held-1111')).toBe('never-held-0000 never-held-1111');
    vi.doUnmock('../../src/debug/mode');
  });
});
