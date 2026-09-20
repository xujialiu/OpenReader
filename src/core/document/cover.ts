/** Read only the container, package and cover members; never inflate a whole EPUB. */
import { DOMParser, type Document as XmlDocument, type Element as XmlElement } from '@xmldom/xmldom';
import { inflateSync, strFromU8 } from 'fflate';
import { readZipDirectory, type ArchiveBytes, type LocatedZipMember } from './zip';

export interface DocumentCover { bytes: Uint8Array; extension: 'jpg' | 'png' | 'webp' | 'gif'; }
const XML_LIMIT = 1024 * 1024;
const IMAGE_LIMIT = 8 * 1024 * 1024;
const elements = (doc: XmlDocument, local: string): XmlElement[] =>
  Array.from(doc.getElementsByTagName('*')).filter((node) => node.localName === local);

function xml(bytes: Uint8Array): XmlDocument {
  const text = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Cover metadata contains a document type.');
  return new DOMParser({ onError: (level, message) => { if (level !== 'warning') throw new Error(message); } })
    .parseFromString(text, 'application/xml');
}

/** EPUB paths are URI references relative to the package, not filesystem paths. */
function resolve(base: string, href: string): string {
  if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) throw new Error('A cover must be inside its document.');
  const path = decodeURIComponent(href.split(/[?#]/, 1)[0]);
  const parts: string[] = path.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) throw new Error('Cover path leaves the archive.'); parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/');
}

function memberBytes(archive: ArchiveBytes, member: LocatedZipMember, limit: number): Uint8Array {
  const { offset, compressedSize, uncompressedSize, method, flags } = member;
  if (flags & 1 || ![0, 8].includes(method) || compressedSize > limit || uncompressedSize > limit)
    throw new Error('Cover member is encrypted, unsupported or too large.');
  const read = (at: number, length: number) => {
    if (at < 0 || at + length > archive.size) throw new Error('Cover member is outside the archive.');
    const bytes = archive.read(at, length);
    if (bytes.length !== length) throw new Error('Cover member is truncated.');
    return bytes;
  };
  const header = read(offset, 30);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50) throw new Error('Cover member has no ZIP header.');
  const at = offset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
  const data = read(at, compressedSize);
  const result = method === 0 ? data : inflateSync(data, { out: new Uint8Array(uncompressedSize) });
  if (result.length !== uncompressedSize) throw new Error('Cover member has an invalid size.');
  return result;
}

export function readDocumentCover(archive: ArchiveBytes): DocumentCover | null {
  const members = new Map(readZipDirectory(archive).map((entry) => [strFromU8(entry.name), entry]));
  const read = (name: string, limit: number) => {
    const member = members.get(name);
    if (!member) throw new Error('Cover member is missing.');
    return memberBytes(archive, member, limit);
  };
  const container = xml(read('META-INF/container.xml', XML_LIMIT));
  const roots = elements(container, 'rootfile');
  const root = roots.find((item) => item.getAttribute('media-type') === 'application/oebps-package+xml') ?? roots[0];
  if (!root) return null;
  const packagePath = resolve('', root.getAttribute('full-path') ?? '');
  const pack = xml(read(packagePath, XML_LIMIT));
  const items = elements(pack, 'item');
  const coverId = elements(pack, 'meta').find((meta) => meta.getAttribute('name') === 'cover')?.getAttribute('content');
  const item = items.find((entry) => entry.getAttribute('properties')?.split(/\s+/).includes('cover-image')) ??
    items.find((entry) => coverId && entry.getAttribute('id') === coverId);
  if (!item) return null;
  const extensions: Record<string, DocumentCover['extension']> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  };
  const extension = extensions[item.getAttribute('media-type') ?? ''];
  const href = item.getAttribute('href');
  if (!extension || !href) return null;
  return { bytes: read(resolve(packagePath, href), IMAGE_LIMIT), extension };
}
