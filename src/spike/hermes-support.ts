/**
 * The day-one spike from notes/NOTES.md, items 1 and 2, and from the two
 * unresolved paragraphs at the end of ADR 0001.
 *
 * Neither question can be answered by reading anything. `normalize('NFKC')`
 * has a history of crashing on Hermes and is not mentioned in recent release
 * notes; `TextDecoder` is claimed to ship with the engine by the Hermes
 * release notes of 2026-06-05 and claimed not to by an older issue. What is
 * true of the Hermes actually bundled in React Native 0.86 is what matters,
 * and only running on it says.
 *
 * So this file probes rather than asserts. Each probe returns what it found —
 * including the exception, if it threw — and never throws itself, because a
 * probe that crashes the app it is diagnosing has told you nothing. The app's
 * first screen renders the report (App.tsx); a run under Node answers for V8
 * and answers nothing about Hermes.
 *
 * It imports nothing. That is deliberate: it must be safe to run as the very
 * first thing the bundle does.
 */

/** What one probe found. `ok` means the engine did the thing we need. */
export type Probe = {
  /** Stable id, so a result can be quoted in a dated note in notes/. */
  id: string;
  /** What is being asked, in the words the note asks it in. */
  question: string;
  /** Where the answer is owed: the note item, the ADR. */
  source: string;
  /** True only when every case passed. */
  ok: boolean;
  /** One line a human can read off a screen. */
  detail: string;
};

export type EngineReport = {
  /** 'Hermes', or the engine name we could work out. Only Hermes counts. */
  engine: string;
  /** True when running on Hermes, i.e. when these answers are the real ones. */
  isHermes: boolean;
  probes: Probe[];
  /** False if any probe failed. */
  ok: boolean;
};

/** Run `body`, and turn any throw into a failed probe rather than a crash. */
function probe(id: string, question: string, source: string, body: () => string | null): Probe {
  try {
    const failure = body();
    return failure === null
      ? { id, question, source, ok: true, detail: 'yes' }
      : { id, question, source, ok: false, detail: failure };
  } catch (error) {
    const name = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { id, question, source, ok: false, detail: `threw ${name}` };
  }
}

/** A case that must hold, or the reason it did not. */
function expect(label: string, actual: unknown, wanted: unknown): string | null {
  return actual === wanted ? null : `${label}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)}`;
}

function first(...results: (string | null)[]): string | null {
  return results.find((r) => r !== null) ?? null;
}

/**
 * notes/NOTES.md item 1. NFKC is load-bearing in the word aligner and in the
 * bracket-stripping code, so the cases are the ones that code relies on:
 * fullwidth Latin folding to ASCII, a circled digit becoming a digit, and the
 * fi ligature splitting — an EPUB typeset from print is full of the last one.
 */
export function nfkcProbe(): Probe {
  return probe('nfkc', "String.prototype.normalize('NFKC')", 'notes/NOTES.md item 1, ADR 0001', () =>
    first(
      expect('fullwidth Latin', 'ｅｎ'.normalize('NFKC'), 'en'),
      expect('circled digit', '①'.normalize('NFKC'), '1'),
      expect('fi ligature', 'ﬁ'.normalize('NFKC'), 'fi'),
      expect('CJK compatibility', '㍿'.normalize('NFKC'), '株式会社'),
      expect('no-break space', ' '.normalize('NFKC'), ' '),
    ),
  );
}

/**
 * ADR 0008: a text anchor is compared against the text a document actually
 * displays, and Zotero normalises EPUB text to NFC. An exact comparison
 * against a document that happens to be NFD fails silently, and the desktop
 * plugin has been bitten by this once already — so NFC and NFD are as
 * load-bearing as NFKC and cost one more line to check.
 */
export function nfcProbe(): Probe {
  return probe('nfc', "normalize('NFC') and normalize('NFD')", 'ADR 0008', () =>
    first(
      expect('NFC composes', 'é'.normalize('NFC'), 'é'),
      expect('NFD decomposes', 'é'.normalize('NFD'), 'é'),
      // Romanian s-comma, one of the fixture cases in the plugin's test/fixtures/
      expect('NFC ș', 'ș'.normalize('NFC'), 'ș'),
    ),
  );
}

/**
 * notes/NOTES.md item 2. Existence is not the question — a decode that
 * mangles multi-byte UTF-8 is worse than a missing global, because it fails
 * quietly. An EPUB's XHTML arrives as bytes, so this is the path every
 * document takes.
 */
export function textDecoderProbe(): Probe {
  return probe('text-decoder', 'TextDecoder on the bundled Hermes', 'notes/NOTES.md item 2, ADR 0001', () => {
    if (typeof TextDecoder === 'undefined') return 'TextDecoder is not defined';
    const utf8 = new TextDecoder();
    const bytes = new Uint8Array([0xe4, 0xbd, 0xa0, 0xe5, 0xa5, 0xbd]); // 你好
    return first(
      expect('label', utf8.encoding, 'utf-8'),
      expect('three-byte UTF-8', utf8.decode(bytes), '你好'),
      expect('named utf-8', new TextDecoder('utf-8').decode(bytes), '你好'),
      // A four-byte code point, i.e. one that is a surrogate pair in JS.
      expect('astral plane', new TextDecoder().decode(new Uint8Array([0xf0, 0x9f, 0x93, 0x96])), '📖'),
      // Streaming: providers and file reads both hand over chunks that cut
      // mid-character, and a decoder that cannot hold state across them is
      // not usable for either.
      (() => {
        const streaming = new TextDecoder('utf-8');
        const head = streaming.decode(bytes.slice(0, 2), { stream: true });
        const tail = streaming.decode(bytes.slice(2), { stream: true });
        return expect('split mid-character', head + tail, '你好');
      })(),
    );
  });
}

/**
 * ADR 0001 states these are supported, and `align.ts` and `speech-text.ts`
 * both require them. Recorded here so the claim is measured on the device
 * rather than carried forward on trust.
 */
export function unicodePropertyEscapeProbe(): Probe {
  return probe('property-escapes', '\\p{L} and \\p{Script=Han} in a RegExp', 'ADR 0001', () =>
    first(
      expect('\\p{L} matches a letter', /\p{L}/u.test('é'), true),
      expect('\\p{L} rejects punctuation', /\p{L}/u.test('—'), false),
      expect('\\p{Script=Han}', /\p{Script=Han}/u.test('好'), true),
      expect('\\p{Nd}', /\p{Nd}/u.test('7'), true),
    ),
  );
}

/**
 * Why `unicode-segmenter` is a dependency. notes/NOTES.md item 7 wants to
 * judge `Intl.Segmenter`'s sentence quality on real books, which presumes it
 * exists — Hermes ships a cut-down Intl, so this records whether the
 * polyfill is required or merely available. Not a blocker either way: the
 * sentence splitter is `sentencex` (ADR 0006), and Intl.Segmenter is wanted
 * for words and graphemes.
 */
export function intlSegmenterProbe(): Probe {
  return probe('intl-segmenter', 'Intl.Segmenter without a polyfill', 'notes/NOTES.md item 7, ADR 0006', () => {
    const intl = Intl as typeof Intl & { Segmenter?: unknown };
    if (typeof intl.Segmenter !== 'function') return 'Intl.Segmenter is not a function — the polyfill is required';
    const words = [...new Intl.Segmenter('en', { granularity: 'word' }).segment('a book, read aloud')]
      .filter((s) => s.isWordLike)
      .map((s) => s.segment);
    return expect('word granularity', words.join('|'), 'a|book|read|aloud');
  });
}

/**
 * Hermes announces itself with a `HermesInternal` global. Anything else and
 * the answers below are about some other engine and settle nothing.
 */
export function engineName(): string {
  const scope = globalThis as { HermesInternal?: { getRuntimeProperties?: () => Record<string, string> } };
  if (!scope.HermesInternal) return typeof process !== 'undefined' && process.versions?.v8 ? 'V8 (not Hermes)' : 'unknown';
  const properties = scope.HermesInternal.getRuntimeProperties?.() ?? {};
  const version = properties['OSS Release Version'] ?? properties['Build'] ?? '';
  return version ? `Hermes ${version}` : 'Hermes';
}

/** Every probe, in the order the screen shows them. */
export function engineReport(): EngineReport {
  const probes = [
    nfkcProbe(),
    textDecoderProbe(),
    nfcProbe(),
    unicodePropertyEscapeProbe(),
    intlSegmenterProbe(),
  ];
  const engine = engineName();
  return {
    engine,
    isHermes: engine.startsWith('Hermes'),
    probes,
    ok: probes.every((p) => p.ok),
  };
}
