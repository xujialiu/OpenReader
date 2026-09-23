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

export {
  appearanceCss,
  DEFAULT_APPEARANCE,
  DEFAULT_HIGHLIGHT,
  READING_FONTS,
  themeCss,
  UTTERANCE_HIGHLIGHT,
  WORD_HIGHLIGHT,
  type Appearance,
  type HighlightStyles,
  type ReadingFont,
  type ReadingScheme,
} from './highlighter';

export {
  BLOCKS_MESSAGE,
  DOCUMENT_MESSAGE,
  PROBLEM_MESSAGE,
  TAP_MESSAGE,
  type AnchoredRange,
  type AppearanceMessage,
  type BlockRange,
  type BlocksMessage,
  type CorrectMessage,
  type DocumentMessage,
  type HighlightMessage,
  type InsetMessage,
  type MeasuredMessage,
  type ProblemMessage,
  type ReportedBlock,
  type SpeakMessage,
  type TapMessage,
  type ThemeMessage,
  type WordCue,
} from './messages';

export { blockIds, EMPTY_BLOCKS, withSection, type BlockIndex } from './blocks';

export {
  anchoredRangesOf,
  canonicalCfi,
  clampElapsed,
  correctMessage,
  rangesOf,
  reportedPlaces,
  resolveResume,
  resumeSentence,
  speakMessage,
  spineIndexOf,
  utteranceAt,
  utteranceRanges,
  wordCues,
  wordIndexAt,
  type RenderedSections,
  type Resume,
  type ResumeFailure,
  type SpeakOptions,
} from './cursor';
