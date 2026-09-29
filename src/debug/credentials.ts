/**
 * What keeps a credential out of the Debug Log (ADR 0054; design 0054: API keys,
 * Gateway Headers, the WebDAV password and the Translator key never go in it).
 *
 * The first guard is the call sites: every line the app writes is built from
 * named, typed facts (a Provider id, a status, a duration, a cut text), and the
 * request lines take a method and an address, never a request's headers, query
 * or body (`requests.ts`). This file is the second, for the lines the app does
 * not build itself: the harness's `HX` answers, `console.warn`/`console.error`
 * and uncaught errors, which carry whatever text they were given.
 *
 * `src/keys/store.ts` is the one place a secret is read from or written to the
 * Keychain, and it hands each one here as it passes, with the name of the
 * entry it belongs to (`forbidCredential`, `forbidGatewayHeaders`), and says
 * when an entry is removed (`forgetCredential`). Every Debug Log line is then
 * written with each held value replaced by `[credential]`, so a secret this run
 * has touched cannot be written, whatever line it turns up in. A secret this
 * run has not touched was never in the app's memory to be logged. The values
 * are held only in Debug Mode, in memory, and are never written anywhere.
 *
 * **One value per entry.** An entry holds only the latest value written or
 * read for it: a new one replaces the entry's earlier spellings, and removing
 * the entry drops them. A Provider's key and Extra headers fields and the Sync
 * screen's password save on every keystroke, so holding every value ever
 * written held each typed prefix for the rest of the run, and a key starting
 * with `s` blanked every `s` in the log (measured 2026-09-29, ADR 0054).
 *
 * The third is three patterns for what no value lookup can see: a token after
 * `Bearer` or `Basic` (the WebDAV request's header is the username and the
 * password in Base64, which is neither of the values held), the value of a
 * header whose name says it carries a key, and the `name:password@` of an
 * address typed with one.
 */
import { DEBUG_MODE } from './mode';

export const REDACTED = '[credential]';

/**
 * No value shorter than this is held, on its own or as a Gateway Header's part,
 * so that no few characters are ever searched for: a typed prefix, before the
 * next keystroke replaces it, or a header flag such as `X-Debug: 1`, would
 * blank every place those characters occur. A Provider's key, the Translator
 * key and a gateway's service token are tens of characters, so none of them
 * falls under it. A WebDAV password may be shorter, and is kept out by the
 * call sites, which never log it, and by the patterns below: a request carries
 * it only as `Basic <Base64>`, and a typed address only as `name:password@`.
 */
const SHORTEST_HELD = 8;

/** The spellings held for each Keychain entry, by the entry's name: its latest value's, and nothing else. */
const heldByEntry = new Map<string, readonly string[]>();

/** Every entry's spellings, longest first, so a value that contains another is replaced whole. */
let held: readonly string[] = [];

/** The value itself, and the two spellings a line carries it in: inside a JSON string, and in a URL. None for a value too short to hold. */
function spellings(value: string): string[] {
  if (value.trim().length < SHORTEST_HELD) return [];
  const out = [value, value.trim(), JSON.stringify(value).slice(1, -1)];
  try {
    out.push(encodeURIComponent(value));
  } catch {
    // A lone surrogate cannot be URL-encoded, and so cannot be in a URL either.
  }
  return out;
}

/** Hold `values` for `entry`, in place of whatever the entry held before. */
function holdFor(entry: string, values: readonly string[]): void {
  if (values.length) heldByEntry.set(entry, values);
  else heldByEntry.delete(entry);
  held = [...new Set([...heldByEntry.values()].flat())].sort((a, b) => b.length - a.length);
}

/** An API key, the WebDAV password or the Translator key, as the Keychain entry `entry` holds it. */
export function forbidCredential(entry: string, secret: string): void {
  if (!DEBUG_MODE) return;
  holdFor(entry, spellings(secret));
}

/**
 * A Provider's Gateway Headers as the owner typed them, in the Keychain entry
 * `entry`: the whole text, each value, and a value's last word, which is the
 * token of `Bearer <token>`.
 */
export function forbidGatewayHeaders(entry: string, text: string): void {
  if (!DEBUG_MODE) return;
  const values = [text];
  // `core/headers.ts`'s split, spelled out: `src/keys/store.ts` imports this
  // file, and `src/keys/` imports nothing from `src/core/` (ADR 0002).
  for (const pair of text.split(/[;\n]/)) {
    const value = pair.slice(pair.indexOf(':') + 1).trim();
    values.push(value, value.split(/\s+/).pop() ?? '');
  }
  holdFor(entry, values.flatMap(spellings));
}

/** Stop holding the Keychain entry `entry`'s value: the entry has been removed. */
export function forgetCredential(entry: string): void {
  holdFor(entry, []);
}

/** Case-sensitive and eight characters long, as the header writes them, so that `Basic English` in a title survives. */
const TOKEN_AFTER_SCHEME = /\b(Bearer|Basic) +[A-Za-z0-9._~+/=-]{8,}/g;
const KEY_HEADER = /\b(authorization|x-api-key|api-key|xi-api-key|ocp-apim-subscription-key)(["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi;
/** `https://name:password@host`, as an address the owner typed may carry it. */
const USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]+@/gi;

/** `text` with every held credential, and whatever the three patterns find, replaced by `[credential]`. */
export function withoutCredentials(text: string): string {
  let out = text;
  for (const value of held) if (out.includes(value)) out = out.split(value).join(REDACTED);
  return out
    .replace(TOKEN_AFTER_SCHEME, `$1 ${REDACTED}`)
    .replace(KEY_HEADER, `$1$2${REDACTED}`)
    .replace(USERINFO, `$1${REDACTED}@`);
}

/** Forget every held value. For the suite, which runs many owners' worth of secrets in one process. */
export function forgetCredentials(): void {
  heldByEntry.clear();
  held = [];
}
