import { graphemeSegments } from 'unicode-segmenter/grapheme';

import type { DocumentFormat } from '../core/document';

/**
 * The name a shared Document's file carries (#95, ADR 0059).
 *
 * The file is kept as `library/sha256-<hex>.epub` (`library.ts`), and iOS names
 * a shared file after the last part of its path. The recipient would see a
 * hash. So the file is shared under the name the Library shows for the Document,
 * rename included, cleaned so that the recipient's file system takes it:
 *
 * - A slash cannot be in a file name at all, and a colon is shown as a slash
 *   by Finder and the Files app (`library.ts`, `fileNameOf`). A backslash is
 *   a separator on Windows. Each becomes a dash. Around spaces it becomes
 *   ` - `, because `Volume Three: The Long Road` is how most such names arrive,
 *   and `Volume Three- The Long Road` reads as a typo.
 * - A document's own title can carry line breaks and tabs. They become one
 *   space.
 * - A leading dot hides the file on the recipient's Mac.
 * - APFS takes 255 bytes of UTF-8 per name. A cut falls between grapheme
 *   clusters, not inside one, the rule `core/segmenter/graphemes.ts` explains.
 */
export function sharedFileName(title: string, format: DocumentFormat): string {
  const extension = `.${format}`;
  const cleaned = title
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s*[/\\:]\s*/g, (found) => (found.length > 1 ? ' - ' : '-'))
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+/, '')
    .trim();
  const room = NAME_BYTES - utf8Length(extension);
  let kept = '';
  let used = 0;
  for (const { segment } of graphemeSegments(cleaned || UNTITLED)) {
    const size = utf8Length(segment);
    if (used + size > room) break;
    kept += segment;
    used += size;
  }
  return `${kept.trimEnd() || UNTITLED}${extension}`;
}

/** The longest name APFS, and Android's ext4 and f2fs, accept for one file. */
const NAME_BYTES = 255;

/** For a name with nothing left in it once cleaned. A title never arrives empty, but one of dots or control characters can. */
const UNTITLED = 'Untitled';

/** UTF-8 length without `TextEncoder`, so the rule is the same under Node and on Hermes. */
function utf8Length(text: string): number {
  let length = 0;
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    length += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return length;
}
