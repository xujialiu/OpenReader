import { compareMatches, matchAnchor, type AnchorMatch, type TextAnchor } from '../core/document';
import type { ReportedBlock } from './messages';

/** The desktop includes inline image descriptions in its quotation. Speech and DOM offsets omit them. */
export function matchImageAnchor(anchor: TextAnchor, text: string, images: NonNullable<ReportedBlock['images']>): AnchorMatch | null {
  const plain = matchAnchor(anchor, text);
  let expanded = '';
  let at = 0;
  for (const image of images) {
    expanded += text.slice(at, image.at) + image.text;
    at = image.at;
  }
  const desktop = matchAnchor(anchor, expanded + text.slice(at));
  if (!desktop) return plain;

  function spokenOffset(offset: number): number {
    for (const image of images) {
      if (offset <= image.at) break;
      offset -= Math.min(offset - image.at, image.text.length);
    }
    return offset;
  }
  const mapped = { ...desktop, start: spokenOffset(desktop.start), end: spokenOffset(desktop.end) };
  // A leading image can collapse onto the space between two sentences. Start
  // at the first surviving character so the gap cannot select the prior one.
  const firstText = text.slice(mapped.start, mapped.end).search(/\S/u);
  if (firstText < 0) return plain;
  mapped.start += firstText;
  if (!plain) return mapped;

  const order = compareMatches(plain, mapped);
  if (order < 0) return plain;
  if (order > 0) return mapped;
  const ambiguous = plain.ambiguous || mapped.ambiguous || plain.start !== mapped.start || plain.end !== mapped.end;
  return { ...plain, ambiguous };
}
