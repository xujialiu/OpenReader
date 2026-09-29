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
 * Keychain, and it hands each one here as it passes (`forbidCredential`,
 * `forbidGatewayHeaders`). Every Debug Log line is then written with each held
 * value replaced by `[credential]`, so a secret this run has touched cannot be
 * written, whatever line it turns up in. A secret this run has not touched was
 * never in the app's memory to be logged. The values are held only in Debug
 * Mode, in memory, and are never written anywhere.
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
 * A Gateway Header's value shorter than this is not searched for on its own:
 * the owner's header list may carry a flag such as `X-Debug: 1`, and replacing
 * every `1` would leave nothing readable. The whole text as typed is always
 * held, and a service token is tens of characters.
 */
const SHORTEST_HEADER_VALUE = 4;

/** Every value held, longest first, so a value that contains another is replaced whole. */
let held: string[] = [];

function hold(value: string): void {
  if (!value.trim() || held.includes(value)) return;
  held = [...held, value].sort((a, b) => b.length - a.length);
}

/** The value itself, and the two spellings a line carries it in: inside a JSON string, and in a URL. */
function holdSpellings(value: string): void {
  hold(value);
  hold(value.trim());
  hold(JSON.stringify(value).slice(1, -1));
  try {
    hold(encodeURIComponent(value));
  } catch {
    // A lone surrogate cannot be URL-encoded, and so cannot be in a URL either.
  }
}

/** An API key, the WebDAV password or the Translator key, as the Keychain holds it. */
export function forbidCredential(secret: string): void {
  if (!DEBUG_MODE) return;
  holdSpellings(secret);
}

/**
 * A Provider's Gateway Headers as the owner typed them: the whole text, each
 * value, and a value's last word, which is the token of `Bearer <token>`.
 */
export function forbidGatewayHeaders(text: string): void {
  if (!DEBUG_MODE) return;
  holdSpellings(text);
  // `core/headers.ts`'s split, spelled out: `src/keys/store.ts` imports this
  // file, and `src/keys/` imports nothing from `src/core/` (ADR 0002).
  for (const pair of text.split(/[;\n]/)) {
    const value = pair.slice(pair.indexOf(':') + 1).trim();
    for (const part of [value, value.split(/\s+/).pop() ?? '']) {
      if (part.length >= SHORTEST_HEADER_VALUE) holdSpellings(part);
    }
  }
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
  held = [];
}
