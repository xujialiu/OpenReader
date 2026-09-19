/**
 * `sentencex` 0.4.2 ships no types, so this is the package's real shape written
 * out by hand. Read from the installed files rather than guessed at:
 *
 * - `dist/esm/index.js` ends `export{et as default}` and `src/index.js` is
 *   `export default function segment (language, text)`. There is **no named
 *   `segment` export** — `import { segment } from 'sentencex'` type-checks
 *   against nothing and is `undefined` at runtime.
 * - `dist/cjs/index.cjs` ends `return rt`, so the CommonJS shape is
 *   `module.exports = <the function>` with no members either.
 * - The return is `new LanguageClass().segment(text)`, a `string[]` of the
 *   sentences. Unlike 1.0.31 there is no boundary-object form, and nothing
 *   reports offsets — which costs us nothing, because 1.0.31's offsets were
 *   Unicode scalar indices and were never read (see sentencex.ts).
 *
 * The name is not `sentencex.d.ts` because TypeScript takes a `.d.ts` beside a
 * `.ts` of the same basename for that file's own declaration output and leaves
 * it out of the program — silently, with the TS7016 it was written to fix still
 * reported.
 *
 * A hand-written declaration for a third-party module is a liability: it is
 * believed by the compiler and checked by nothing. It is confined to this one
 * function and this one signature for that reason, and the runtime shape is
 * asserted in `test/core/segmenter/offsets.test.ts` so a version bump that
 * changes it fails a test rather than type-checking quietly.
 */
declare module 'sentencex' {
  /**
   * The sentences of `text`, in order. An unknown `language` falls back through
   * the package's own `fallbacks.json` and finally to `en`; it never throws.
   *
   * The pieces do **not** concatenate back to the input: the whitespace between
   * sentences is dropped. `sentences.ts` recovers exact offsets anyway.
   */
  const segment: (language: string, text: string) => string[];
  export default segment;
}
