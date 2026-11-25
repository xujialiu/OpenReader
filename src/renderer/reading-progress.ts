import { Parser } from 'htmlparser2';
import { strFromU8 } from 'fflate';
import { matchAnchor, readLocator, type ReadingPlace } from '../core/document';
import { readArchiveMember } from '../core/document/cover';
import { readDocumentPackage } from '../core/document/navigation';
import { readZipDirectory, type ArchiveBytes, type LocatedZipMember } from '../core/document/zip';
import { canonicalCfi, spineIndexOf } from './cursor';
import { matchImageAnchor } from './image-anchor';

const excluded = new Set(['head', 'script', 'style', 'noscript', 'template', 'rt', 'rp', 'title']);
const weight = (text: string) => text.replace(/\s/gu, '').length;
export type SectionLength = { path: string; length: number };

function markup(archive: ArchiveBytes, member?: LocatedZipMember): string {
  if (!member) throw new Error('Missing spine section.');
  return strFromU8(readArchiveMember(archive, member, 32 * 1024 * 1024));
}

/** Count body text without retaining a DOM. For a saved CFI retain only its element's text. */
async function measure(source: string, steps: number[], yieldIfBusy: () => Promise<void>) {
  const stack: { children: number; visible: boolean; onPath: boolean }[] = [];
  let length = 0;
  let start: number | null = null;
  let inside = false;
  const parts: string[] = [];
  let textOffset = 0;
  const images: { at: number; text: string }[] = [];
  const parser = new Parser({
    onopentag(name, attributes) {
      const parent = stack.at(-1);
      const step = parent ? 2 * ++parent.children : 0;
      // epub.js paths start at the document element's children.
      const onPath = parent ? parent.onPath && step === steps[stack.length - 1] : name === 'html';
      const visible = (name === 'body' || !!parent?.visible) && !excluded.has(name)
        && attributes.hidden === undefined && !/\bdisplay\s*:\s*none\b/i.test(attributes.style ?? '');
      stack.push({ children: 0, visible, onPath });
      if (visible && onPath && stack.length === steps.length + 1) {
        start = length;
        inside = true;
      }
      if (!visible || !inside) return;
      if (name === 'br') { parts.push('\n'); textOffset++; }
      if (name === 'img') {
        const description = attributes['aria-label'] || attributes.alt;
        if (description) images.push({ at: textOffset, text: description });
      }
    },
    ontext(text) {
      if (!stack.at(-1)?.visible) return;
      length += weight(text);
      if (inside) { parts.push(text); textOffset += text.length; }
    },
    onclosetag() {
      stack.pop();
      if (stack.length <= steps.length) inside = false;
    },
  }, { recognizeSelfClosing: true });
  for (let at = 0; at < source.length; at += 32768) {
    await yieldIfBusy();
    parser.write(source.slice(at, at + 32768));
  }
  parser.end();
  return { length, start, text: parts.join(''), images };
}

export async function indexReadingText(archive: ArchiveBytes, yieldIfBusy: () => Promise<void>): Promise<SectionLength[]> {
  const { sections, members } = readDocumentPackage(archive);
  const lengths: SectionLength[] = [];
  for (const section of sections) {
    await yieldIfBusy();
    if (!section) throw new Error('Missing spine reference.');
    const result = await measure(markup(archive, members.get(section.path)), [], yieldIfBusy);
    lengths.push({ path: section.path, length: result.length });
  }
  return lengths;
}

export async function readingPercentage(archive: ArchiveBytes, sections: SectionLength[], place: ReadingPlace, yieldIfBusy: () => Promise<void>): Promise<number | null> {
  const cfi = canonicalCfi(readLocator(place.locator, 'epub') ?? '');
  const section = spineIndexOf(cfi);
  const path = /!((?:\/\d+)+)\)$/.exec(cfi);
  if (section === null || !sections[section] || !path) return null;
  const total = sections.reduce((sum, item) => sum + item.length, 0);
  if (!total) return null;
  const member = readZipDirectory(archive).find((item) => strFromU8(item.name) === sections[section].path);
  const steps = path[1].slice(1).split('/').map(Number);
  const { length, start, text, images } = await measure(markup(archive, member), steps, yieldIfBusy);
  if (start === null || length !== sections[section].length) return null;
  const match = images.length ? matchImageAnchor(place.anchor, text, images) : matchAnchor(place.anchor, text);
  if (!match || match.ambiguous) return null;
  const before = sections.slice(0, section).reduce((sum, item) => sum + item.length, 0);
  return Math.round(100 * (before + start + weight(text.slice(0, match.start))) / total);
}
