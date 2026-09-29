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
 * 3. every secret `src/keys/store.ts` reads or writes is held by the guard, and
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

  it('the WebDAV password, and one typed into the Sync screen before it is saved', async () => {
    keychain.set(SYNC_PASSWORD_ENTRY_NAME, 'correct horse battery staple');
    await store.readSyncPassword();
    await store.saveSyncPassword('p@ss:w0rd;semi');
    forbidCredential('typed-but-not-saved');
    const line = logged('PROPFIND correct horse battery staple p@ss:w0rd;semi typed-but-not-saved');
    expect(line).not.toContain('horse');
    expect(line).not.toContain('w0rd');
    expect(line).not.toContain('typed-but');
  });

  it('the Microsoft Translator key', async () => {
    await store.saveTranslationKey('  ms-translator-KEY-42424242  ');
    keychain.set('openreader.translation.microsoft', 'ms-translator-OTHER-1313');
    await store.readTranslationKey();
    const line = logged('Ocp key ms-translator-KEY-42424242 ms-translator-OTHER-1313');
    expect(line).not.toContain('KEY-4242');
    expect(line).not.toContain('OTHER');
  });

  it('in the spellings a line carries it in: inside JSON, and in a URL', () => {
    forbidCredential('a"b\\c d/e');
    const line = logged(`${JSON.stringify({ key: 'a"b\\c d/e' })} https://x.test/?k=${encodeURIComponent('a"b\\c d/e')}`);
    expect(line).not.toContain('b\\\\c');
    expect(line).not.toContain('d%2Fe');
  });

  it('leaves a short header flag readable rather than every `1` in the log', () => {
    forbidGatewayHeaders('X-Debug: 1; X-Client-Secret: long-enough-secret');
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

  it('holds every secret the Keychain module reads and writes', () => {
    const keys = readFileSync(new URL('../../src/keys/store.ts', import.meta.url), 'utf8');
    pin(keys, "    if (secret === null) return { outcome: 'absent' };\n    forbid(secret);", 'src/keys/store.ts readSecret');
    pin(keys, 'Promise<SecretChange> {\n  forbid(secret);', 'src/keys/store.ts writeSecret');
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
    off.forbidCredential('never-held-0000');
    off.forbidGatewayHeaders('X-Secret: never-held-1111');
    expect(off.withoutCredentials('never-held-0000 never-held-1111')).toBe('never-held-0000 never-held-1111');
    vi.doUnmock('../../src/debug/mode');
  });
});
