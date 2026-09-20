/**
 * The public surface of the audio graph.
 *
 * Two things leave this directory: **the engine**, which a player screen drives,
 * and **the clock**, which the renderer (ADR 0005) and the lock screen
 * (ADR 0016) read. Everything else here is how those two are built and is
 * exported only because it is tested.
 *
 * Nothing in `playback/` imports from `renderer/`, and nothing should. The
 * renderer does not exist yet; when it does, it implements `ReaderClock` and is
 * handed to `createPlaybackEngine`, so the dependency points this way. Lint does
 * not constrain the layers above `core/` — that is deliberate, and it is not
 * permission.
 */

export {
  createPlaybackEngine,
  type OutOfTextReport,
  type PlaybackEngine,
  type PlaybackEngineDeps,
  type PlaybackSnapshot,
} from './engine';

export {
  POSITION_INTERVAL_MS,
  type ClipCue,
  type PositionCorrection,
  type ReaderClock,
} from './reader-clock';

export { DEFAULT_GAP, UNSPEAKABLE_MS, type GapSettings } from './gap';

/**
 * The four skip targets (ADR 0020). They are here rather than only in
 * `navigation.ts` because the player screen is their caller: six controls are six
 * ways of naming one Utterance, and each of these answers with the index to hand
 * to `engine.seek`.
 */
export { nextParagraph, nextSentence, paragraphStart, previousParagraph, previousSentence, startsParagraph } from './navigation';

export {
  MAX_PLAYBACK_RATE,
  MAX_STEPPER_RATE,
  MIN_PLAYBACK_RATE,
  MIN_STEPPER_RATE,
  NATURAL_PACE,
  RATE_STEP,
  clampRate,
  snapRate,
  stepRate,
} from './rate';
export { CONCURRENT_FETCHES, READ_AHEAD_UTTERANCES } from './read-ahead';
export { clipCacheKey, type ClipCache, type StoredClip } from './clip-cache';
