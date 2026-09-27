/**
 * How the page moves when it follows the line being spoken (ADR 0050).
 *
 * **Source, not functions.** What is exported is the text of five small
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
 *
 * And for **Continuous** (#71), where the page moves all the while:
 *
 * - **`lineLead(left, from, to, pitch)`** — how far past the line position the
 *   line being spoken is carried: the spoken word's share of the way along its
 *   line, `(left − from) / (to − from)`, times the distance to the next line.
 *   Nought at the start of a line and nearly a whole line at its end, so the next
 *   line arrives where this one was as the voice reaches it, and nothing jumps
 *   from one line to the next.
 * - **`driftVelocity(error, velocity, dt)`** — the page's speed, in px per ms,
 *   one frame on. A critically damped follower with a time constant of
 *   `DRIFT_TAU_MS`: the words move the target a word at a time, a few pixels
 *   each, and this turns that staircase into one steady motion with no step in
 *   its speed and no overshoot, lagging a ramp by `2 × DRIFT_TAU_MS` of it.
 */

/** How long one glide lasts, whatever its distance. Speechify measured 220–290 ms, typically 250. */
export const GLIDE_MS = 250;

/**
 * The Line Position the program is built with, as a share: the middle. The
 * owner's own arrives as a `FollowingMessage` (#71), and the bridge sends it
 * again when the program installs only if it is not this.
 */
export const BAKED_LINE_POSITION = 0.5;

/**
 * The way of following the program is built with: a line at a time, the
 * default. The owner's own arrives in the same `FollowingMessage`, and the
 * bridge sends it again when the program installs only if it is not this.
 */
export const BAKED_SCROLLING = 'line' as const;

/**
 * How quickly a Continuous page closes on where the words say it should be: the
 * time constant of its critically damped follower, in ms.
 *
 * 200 ms against words that move the target every 250–400 ms: long enough that
 * the page is still moving when the next word lands, so the steps run together
 * into one motion, and short enough that it lags a steady reading by only
 * `2 × 200 ms` of it — about 4 px at the 9 px a second measured on a 36 px line
 * (notes/NOTES_2026-09-25.md, 23:00, a line every 1.0–1.5 s at 1.4×). After the
 * last word it has come to rest within a second.
 */
export const DRIFT_TAU_MS = 200;

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
  '}\n' +
  'var DRIFT_TAU_MS = ' + DRIFT_TAU_MS + ';\n' +
  'function lineLead(left, from, to, pitch) {\n' +
  '  if (!(to > from) || !(pitch > 0)) return 0;\n' +
  '  var along = (left - from) / (to - from);\n' +
  '  if (!(along > 0)) return 0;\n' +
  '  if (along > 1) along = 1;\n' +
  '  return along * pitch;\n' +
  '}\n' +
  'function driftVelocity(error, velocity, dt) {\n' +
  '  var w = 1 / DRIFT_TAU_MS;\n' +
  '  return velocity + (w * w * error - 2 * w * velocity) * dt;\n' +
  '}\n';
