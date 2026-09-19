export type SynthesisErrorKind =
  | 'no-key'
  /** The server answered 401/403: the key is wrong, expired, or not authorised. */
  | 'auth'
  | 'network'
  | 'local-server-down'
  | 'rate-limit'
  | 'quota'
  | 'decode-failed'
  | 'unknown';

const RETRIABLE: ReadonlySet<SynthesisErrorKind> = new Set([
  'network',
  'rate-limit',
  'local-server-down',
]);

/**
 * Every failure a provider reports, with a kind the caller can act on: retry a
 * `network` one, send the owner to the key field for a `no-key` one, and say
 * "the server is not running" rather than "network error" for a
 * `local-server-down` one. Philosophy rule 1: network calls time out and
 * report; they never hang and they never fail namelessly.
 *
 * The plugin also had `toZoteroError`, which collapsed these down to the three
 * strings native Zotero's Read Aloud UI recognises. That UI does not exist
 * here, so it has not come across.
 */
export class SynthesisError extends Error {
  readonly kind: SynthesisErrorKind;
  readonly retriable: boolean;

  constructor(kind: SynthesisErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'SynthesisError';
    this.kind = kind;
    this.retriable = RETRIABLE.has(kind);
  }
}
