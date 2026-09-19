import segment from 'sentencex';

import type { SplitSentences } from './sentences';

/**
 * Upstream `sentencex`, bound to this directory's `SplitSentences` seam
 * (ADR 0006). This is the only file that names the package.
 *
 * ## Why the pin is at 0.4.2
 *
 * `package.json` says `^0.4.2`, and the caret is bounded by the major: 0.4.2 is
 * the last 0.x, and 1.0.0 is where the project became Node bindings to a Rust
 * library. That cutover is why the pin exists. Read from 1.0.31 as installed,
 * none of which its README mentions:
 *
 * - `index.cjs` is `module.exports = require('sentencex-' + process.platform +
 *   '-' + process.arch)`, and `node_modules/sentencex-darwin-arm64/index.node`
 *   is a 3.4 MB `Mach-O 64-bit dynamically linked shared library arm64`. The
 *   five published binaries are darwin, linux and win32; there is no iOS or
 *   Android one to resolve.
 * - `index.mjs` imports `node:module` and `node:url` to do the same thing.
 * - Hermes cannot load a native addon and Metro cannot bundle a `.node`, so the
 *   1.x line cannot run in the app at all. It runs under vitest on a developer's
 *   macOS and nowhere the book is read.
 *
 * ADR 0006's decision — upstream `sentencex` rather than a copy of SDT — is
 * untouched by which release is loadable, which is why the answer was a pin
 * rather than a port.
 *
 * ## What the pin costs
 *
 * Fixes made upstream after 0.4.2 do not arrive. The abbreviation and
 * sentence-starter lists are the part of `sentencex` that improves with time and
 * they are frozen here at 0.4.2's, and the 1.x line will keep moving without us.
 * 0.4.2 also knows 29 languages where 1.0.31 claimed ~244; everything else falls
 * back through the package's `fallbacks.json` and finally to English, so a
 * Chinese or Romanian book is split by the English rules over a terminator list
 * that does include `。` and its relatives. That is a real reduction in quality
 * and it is the open half of notes/NOTES.md item 7.
 *
 * ## What it gives
 *
 * A default export, `segment(language, text) => string[]` — no named export and
 * no types; see `sentencex-module.d.ts` for the shape read out of the
 * package. Its pieces do **not** concatenate back to the input: the whitespace between
 * sentences is dropped, so `segment('en', 'One. Two.').join('')` is
 * `'One.Two.'`. `sentences.ts` locates each piece from a forward-only cursor
 * instead of trusting concatenation, which is what makes that harmless — and is
 * also what made the 1.x offsets unnecessary, since they were Unicode scalar
 * indices rather than UTF-16 code units (`A \u{1F600} emoji. ` ended at their 11
 * and at our 12).
 */
export const splitWithSentencex: SplitSentences = (language, text) => segment(language, text);
