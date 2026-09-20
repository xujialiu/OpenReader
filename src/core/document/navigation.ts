import { DOMParser, type Element, type Document } from '@xmldom/xmldom';
import { strFromU8 } from 'fflate';
import { readArchiveMember, resolveArchivePath } from './cover';
import { readZipDirectory, type ArchiveBytes } from './zip';

export interface ChapterMetadata {
  id: string; title: string; parent: string | null; depth: number;
  section: number | null; fragment: string;
}
export interface DocumentNavigation {
  sections: { href: string; path: string }[];
  chapters: ChapterMetadata[];
}
const children = (node: Element, tag?: string): Element[] => Array.from(node.childNodes)
  .filter((n): n is Element => n.nodeType === 1 && (!tag || (n as Element).localName === tag));
const elements = (doc: Document | Element, local: string): Element[] =>
  Array.from(doc.getElementsByTagName('*')).filter((node) => node.localName === local);
const label = (node?: Element) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** Inflate only container, package and navigation. Chapter body bytes are never read. */
export function readDocumentNavigation(archive: ArchiveBytes): DocumentNavigation {
  const members = new Map(readZipDirectory(archive).map((entry) => [strFromU8(entry.name), entry]));
  const read = (path: string) => {
    const member = members.get(path);
    if (!member) throw new Error(`Document metadata is missing: ${path}`);
    const text = strFromU8(readArchiveMember(archive, member, 8 * 1024 * 1024));
    if (/<!ENTITY/i.test(text)) throw new Error('Document metadata contains an entity declaration.');
    return new DOMParser({ onError: (level, message) => { if (level !== 'warning') throw new Error(message); } })
      .parseFromString(text, 'application/xml');
  };
  const container = read('META-INF/container.xml');
  const root = elements(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!root) throw new Error('The EPUB does not name its package.');
  const packPath = resolveArchivePath('', root);
  const pack = read(packPath);
  const manifest = new Map(elements(pack, 'item').map((item) => [item.getAttribute('id'), item]));
  const sections = elements(pack, 'itemref').map((ref) => {
    const href = manifest.get(ref.getAttribute('idref'))?.getAttribute('href');
    if (!href) throw new Error('A document spine entry has no content file.');
    return { href, path: resolveArchivePath(packPath, href) };
  });
  const byPath = new Map(sections.map((section, index) => [section.path, index]));
  const chapters: ChapterMetadata[] = [];
  function target(base: string, href: string) {
    if (!href || /^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) return { section: null, fragment: '' };
    const bare = href.split('#')[0];
    const path = bare ? resolveArchivePath(base, bare) : base;
    return { section: byPath.get(path) ?? null, fragment: decodeURIComponent(href.split('#')[1] ?? '') };
  }
  const nav = [...manifest.values()].find((item) => item.getAttribute('properties')?.split(/\s+/).includes('nav'));
  if (nav?.getAttribute('href')) {
    const path = resolveArchivePath(packPath, nav.getAttribute('href')!);
    const doc = read(path);
    const toc = elements(doc, 'nav').find((item) => (item.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? item.getAttribute('epub:type') ?? '').split(/\s+/).includes('toc'));
    const walk = (list: Element | undefined, parent: string | null, depth: number, prefix: string) => {
      if (!list) return;
      children(list, 'li').forEach((li, index) => {
        const id = `${prefix}.${index}`;
        const link = children(li).find((child) => ['a', 'span'].includes(child.localName ?? ''));
        chapters.push({ id, parent, depth, title: label(link) || 'Untitled chapter', ...target(path, link?.getAttribute('href') ?? '') });
        walk(children(li, 'ol')[0], id, depth + 1, id);
      });
    };
    walk(toc ? children(toc, 'ol')[0] : undefined, null, 0, 'nav');
  } else {
    const tocId = elements(pack, 'spine')[0]?.getAttribute('toc');
    const ncx = manifest.get(tocId ?? '') ?? [...manifest.values()].find((item) => item.getAttribute('media-type') === 'application/x-dtbncx+xml');
    if (ncx?.getAttribute('href')) {
      const path = resolveArchivePath(packPath, ncx.getAttribute('href')!);
      const doc = read(path);
      const walk = (nodes: Element[], parent: string | null, depth: number, prefix: string) => nodes.forEach((point, index) => {
        const id = `${prefix}.${index}`;
        chapters.push({ id, parent, depth, title: label(children(point, 'navLabel')[0]) || 'Untitled chapter',
          ...target(path, children(point, 'content')[0]?.getAttribute('src') ?? '') });
        walk(children(point, 'navPoint'), id, depth + 1, id);
      });
      const map = elements(doc, 'navMap')[0];
      if (map) walk(children(map, 'navPoint'), null, 0, 'nav');
    }
  }
  return { sections, chapters };
}
