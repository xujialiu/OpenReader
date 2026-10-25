/**
 * The **Sleep Timer** (CONTEXT.md, #326, design and ADR 0088): its choices,
 * the words the Player shows for them, and where the current chapter ends.
 *
 * Pure, so a test can reach every rule; `use-sleep-timer.ts` keeps the state
 * and `use-reading.ts` hands the line to the engine (`stopAfter`).
 */

import { anchoredStart, rowOfPlace, type ContentsRow } from '../core/document/contents';

/** The end of the Contents row the Reading is in, or a length of listening in minutes. */
export type SleepChoice = 'chapter' | number;

/** The lengths the menu offers, in minutes, shortest first (owner's Q5). */
export const SLEEP_MINUTES: readonly number[] = [5, 10, 15, 30, 45, 60];

/**
 * The menu's entries, in its order: the chapter first, then the lengths. The
 * chapter only for a Document whose Contents names somewhere to go: without a
 * row, there is no chapter to end (owner's Q6).
 */
export function sleepChoices(chapterOffered: boolean): SleepChoice[] {
  return chapterOffered ? ['chapter', ...SLEEP_MINUTES] : [...SLEEP_MINUTES];
}

/** What a choice is called in the menu. */
export function sleepLabel(choice: SleepChoice): string {
  if (choice === 'chapter') return 'When Current Chapter Ends';
  if (choice === 60) return '1 Hour';
  return `${choice} Minutes`;
}

/**
 * The time left, as the button shows it: minutes and seconds, `29:41`, an
 * hour as `60:00`. Rounded up, so it reads `0:01` until the length has run out
 * and starts on the length chosen rather than a second under it.
 */
export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** What `chapterEnd` walks: the Reading's text from where it is, and the Contents it is measured against. */
export interface ChapterWalk {
  /** The Utterance being spoken, or where Play starts. */
  from: number;
  /** The exclusive end of the text laid out without a gap after `from` (`readingExtent`). */
  through: number;
  /** That text reaches the end of the Document. */
  ended: boolean;
  /** The spine item an Utterance is in, and its Block's ordinal there (`use-reading.ts`'s `placeOf`). */
  placeOf(utterance: number): { section: number | null; block: number | null };
  /** Where each Contents fragment starts, by spine item, as Block ordinals (`ReadingStatus.anchors`). */
  anchors: ReadonlyMap<number, ReadonlyMap<string, number>>;
  rows: readonly ContentsRow[];
}

/**
 * The last Utterance of the Contents row `from` is in: the one after which
 * the Reading would go on into another row by itself. Null while the text laid
 * out so far does not reach the end of that row; the caller asks again as more
 * arrives.
 *
 * The row is the one the Contents marks, by `currentRow`'s own rule
 * (`rowOfPlace`, each Block moved back to the start of its stretch), so the
 * chapter the timer ends is the chapter the owner sees marked. A page the
 * Contents does not list is part of the row before it, and text before the
 * first row is a stretch of its own. At the end of the Document the row ends
 * with the text.
 */
export function chapterEnd(walk: ChapterWalk): number | null {
  const { from, through, ended, placeOf, anchors, rows } = walk;
  const known = new Map<string, number>();
  const rowAt = (utterance: number): number | null => {
    const { section, block } = placeOf(utterance);
    if (section === null) return null;
    const inSection = anchors.get(section) ?? null;
    const start = inSection && block !== null ? anchoredStart(inSection, block) : null;
    const key = `${section}:${start}`;
    let row = known.get(key);
    if (row === undefined) {
      row = rowOfPlace(rows, (one) => one.target, (one) => one.fragment, { sectionIndex: section, block: start, anchors: inSection })?.row ?? -1;
      known.set(key, row);
    }
    return row;
  };
  const here = rowAt(from);
  if (here === null) return null;
  for (let at = from + 1; at < through; at++) {
    const row = rowAt(at);
    if (row === null) return null;
    if (row !== here) return at - 1;
  }
  return ended && through > from ? through - 1 : null;
}
