/**
 * How the page moves when it follows the line being spoken (ADR 0050).
 *
 * **Source, not functions.** What is exported is the text of three small
 * functions in the WebView program's own dialect — `var`, no arrow functions, no
 * template literals — which `highlighter.ts` splices into that program as it is.
 * The tests evaluate the same text with `node:vm`, so the curve they check is the
 * curve Safari runs. A TypeScript function handed over with `toString()` would
 * not do: Hermes keeps no source for a function and answers `[bytecode]`.
 *
 * - **`glideLeft(from, elapsed)`** — how much of a move of `from` pixels is
 *   still to go `elapsed` ms after it began. Ease-out, quadratic, over
 *   `GLIDE_MS`: half the time in, three quarters of the way there, and the last
 *   frames a pixel or two, which is the shape measured on Speechify
 *   (notes/NOTES_2026-09-25.md, 23:00). The time does not depend on the
 *   distance, as there: a line and a line with a paragraph gap after it both take
 *   `GLIDE_MS`.
 * - **`sameLine(a, b)`** — whether two measured lines are the same line: the same
 *   section document, and tops closer than half a line. Tops are in the section
 *   document's own coordinates, which scrolling the page does not change, so a
 *   line keeps its identity while the page moves under it.
 * - **`glides(move, visible)`** — whether a move is made as a glide or at once.
 *   Within one visible page it glides. Further than that it jumps: a glide would
 *   only pull a page of text the owner has not read past their eye.
 */

/** How long one glide lasts, whatever its distance. Speechify measured 220–290 ms, typically 250. */
export const GLIDE_MS = 250;

export const GLIDE_SOURCE =
  'var GLIDE_MS = ' + GLIDE_MS + ';\n' +
  'function glideLeft(from, elapsed) {\n' +
  '  var t = elapsed / GLIDE_MS;\n' +
  '  if (!(t > 0)) return from;\n' +
  '  if (t >= 1) return 0;\n' +
  '  return from * (1 - t) * (1 - t);\n' +
  '}\n' +
  'function sameLine(a, b) {\n' +
  '  if (!a || !b || a.doc !== b.doc) return false;\n' +
  '  return Math.abs(a.top - b.top) < Math.min(a.height, b.height) / 2;\n' +
  '}\n' +
  'function glides(move, visible) {\n' +
  '  return Math.abs(move) <= visible;\n' +
  '}\n';
