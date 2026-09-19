/**
 * The public surface of the renderer.
 *
 * One thing leaves this directory: the **bridge**, which a reader screen mounts
 * and which implements `ReaderClock` for the playback engine (ADR 0005). Everything
 * else is exported because the other half of the directory or a test needs it.
 *
 * `highlighter.ts` is deliberately not re-exported wholesale. Its source string
 * runs in Safari's JavaScript rather than in Hermes, nothing in the type system
 * says so, and the bridge is the only thing that should ever inject it.
 *
 * Nothing in `playback/` imports from here; the dependency points the other way
 * (`playback/index.ts` says so). Lint does not constrain the layers above `core/`
 * — that is deliberate, and it is not permission.
 */

export {
  useReaderBridge,
  type ReaderBridge,
  type ReaderBridgeOptions,
  type RenderedSection,
  type ReportedDocument,
} from './reader-bridge';

export { DEFAULT_HIGHLIGHT, UTTERANCE_HIGHLIGHT, WORD_HIGHLIGHT, type HighlightStyles } from './highlighter';

export {
  BLOCKS_MESSAGE,
  DOCUMENT_MESSAGE,
  PROBLEM_MESSAGE,
  TAP_MESSAGE,
  type AnchoredRange,
  type BlockRange,
  type BlocksMessage,
  type CorrectMessage,
  type DocumentMessage,
  type HighlightMessage,
  type InsetMessage,
  type ProblemMessage,
  type ReportedBlock,
  type SpeakMessage,
  type TapMessage,
  type WordCue,
} from './messages';

export { blockIds, EMPTY_BLOCKS, withSection, type BlockIndex } from './blocks';

export {
  anchoredRangesOf,
  clampElapsed,
  correctMessage,
  rangesOf,
  speakMessage,
  utteranceAt,
  utteranceRanges,
  wordCues,
  wordIndexAt,
  type SpeakOptions,
} from './cursor';
