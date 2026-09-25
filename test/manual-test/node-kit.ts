/**
 * What the Node probes share: a book's Utterances as the app would find them,
 * and the owner's credentials.
 *
 * The Blocks approximate the renderer's walk (`src/renderer/highlighter.ts`)
 * without a browser: an element in BLOCK starts a Block, anything else —
 * `<br>` included — is inline. The real walk asks each element's computed
 * `display`, so a book that styles a `<div>` inline is split differently here.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { DOMParser, type Document as XDocument, type Element as XElement, type Node as XNode, type Text as XText } from '@xmldom/xmldom';

import type { ProviderSettings } from '../../src/core/providers/factory';
import type { HeaderWebSocket } from '../../src/core/providers/azure';
import type { SynthesisResult } from '../../src/core/providers/types';
import { segmentBlocks, type Block, type Utterance } from '../../src/core/segmenter';
import { splitWithSentencex } from '../../src/core/segmenter/sentencex';

// ---------- EPUB → Blocks ----------

const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'link', 'meta', 'title', 'rt', 'rp']);
const HEADING = /^h[1-6]$/;

export type Section = { href: string; blocks: Block[] };

export function readEpub(path: string): { title: string; sections: Section[] } {
  const files = unzipSync(new Uint8Array(readFileSync(path)));
  const text = (name: string) => strFromU8(files[name]!);
  const xml = (name: string) => new DOMParser({ onError: () => {} }).parseFromString(text(name), 'text/xml');
  const opfPath = xml('META-INF/container.xml').getElementsByTagNameNS('*', 'rootfile')[0]!.getAttribute('full-path')!;
  const opf = xml(opfPath);
  const base = posix.dirname(opfPath);
  const manifest = new Map<string, string>();
  const items = opf.getElementsByTagNameNS('*', 'item');
  for (let i = 0; i < items.length; i++) manifest.set(items[i]!.getAttribute('id')!, items[i]!.getAttribute('href')!);
  const title = opf.getElementsByTagNameNS('*', 'title')[0]?.textContent ?? path;
  const refs = opf.getElementsByTagNameNS('*', 'itemref');
  const sections: Section[] = [];
  for (let i = 0; i < refs.length; i++) {
    const href = manifest.get(refs[i]!.getAttribute('idref')!);
    if (!href) continue;
    const name = posix.normalize(posix.join(base, decodeURIComponent(href)));
    if (!files[name]) continue;
    // A cover page with an unclosed <img> is fatal even as text/html; it has no text to lose.
    try {
      const doc = new DOMParser({ onError: () => {} }).parseFromString(text(name), 'text/html');
      sections.push({ href: name, blocks: walk(doc, name) });
    } catch { /* skipped */ }
  }
  return { title, sections };
}

function walk(doc: XDocument, section: string): Block[] {
  const found: Block[] = [];
  let open: { text: string; role: Block['role'] } | null = null;
  const close = () => { if (open && /\S/.test(open.text)) found.push({ text: open.text, role: open.role, section }); open = null; };
  const roleOf = (tag: string): Block['role'] => (HEADING.test(tag) ? 'heading' : ['p', 'li', 'dd', 'dt', 'blockquote', 'div', 'td', 'th', 'pre', 'figcaption'].includes(tag) ? 'paragraph' : 'other');
  const visit = (node: XNode, owner: string) => {
    if (node.nodeType === 3) {
      const data = (node as XText).data;
      if (!data.length) return;
      if (!open) open = { text: '', role: roleOf(owner) };
      open.text += data;
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = (node as XElement).tagName.toLowerCase().replace(/^.*:/, '');
    if (SKIP.has(tag)) return;
    if (!BLOCK.has(tag)) { for (let c = node.firstChild; c; c = c.nextSibling) visit(c, owner); return; }
    close();
    for (let c = node.firstChild; c; c = c.nextSibling) visit(c, tag);
    close();
  };
  const body = doc.getElementsByTagName('body')[0];
  if (body) visit(body, 'body');
  close();
  return found;
}

/** A section's Utterances, segmented exactly as `src/app/segment.ts` does. */
export function utterancesOf(blocks: Block[]): Utterance[] {
  return segmentBlocks(blocks, 'en', { splitSentences: splitWithSentencex });
}

// ---------- credentials and audio ----------

/** The owner's desktop settings export: the plugin's flat `section.key` map, the same credentials the app is configured with. */
export function loadSettings(): ProviderSettings {
  const flat = JSON.parse(readFileSync(join(homedir(), '.secrets/openreader/zotero-tts-settings.json'), 'utf8')).settings as Record<string, unknown>;
  const get = (key: string) => (flat[key] ?? '') as string;
  return {
    'openai-official': { apiKey: get('openai-official.apiKey'), model: get('openai-official.model') },
    compatible: { baseURL: get('compatible.baseURL'), apiKey: get('compatible.apiKey'), model: get('compatible.model'), headers: get('compatible.headers') },
    azure: { apiKey: get('azure.apiKey'), region: get('azure.region') },
    speechify: { apiKey: get('speechify.apiKey') },
    fish: { apiKey: get('fish.apiKey'), freeOnly: flat['fish.freeOnly'] !== false, voices: get('fish.voices'), includeOfficial: true, includeOwn: false, includeManual: true },
    local: { engine: get('local.engine') || 'kokoro', baseURL: get('local.baseURL'), headers: get('local.headers') },
  };
}

/**
 * Node's `WebSocket` sends no upgrade headers, so the ones Azure is given go in
 * the query instead — where the desktop plugin puts its key for the same reason.
 */
export const QueryHeaderWebSocket = class extends WebSocket {
  constructor(url: string, protocols: string | string[] | undefined, options: { headers: Record<string, string> }) {
    const at = new URL(url);
    for (const [name, value] of Object.entries(options.headers)) at.searchParams.set(name, value);
    super(at.toString(), protocols);
  }
} as unknown as HeaderWebSocket;

/** The voice each provider is measured with: the owner's own where they chose one. */
export const VOICE_MATCH: Record<string, (id: string, label: string, locale: string) => boolean> = {
  azure: (id) => id.includes('en-US-AvaMultilingualNeural'),
  fish: (id) => id.includes('179b5cc736974d96913c7849d0bb68c5'),
  speechify: (_, label, locale) => locale.startsWith('en-US') && /^george\b/i.test(label),
  local: (id) => id.includes('af_bella'),
};

export type Pcm = { samples: Int16Array; rate: number };

/** A Clip as 16-bit mono samples. MP3 goes through ffmpeg, which drops the encoder delay its LAME header declares. */
export function toPcm(result: SynthesisResult): Pcm {
  if (result.audio === 'pcm') return { samples: new Int16Array(result.samples.buffer.slice(result.samples.byteOffset, result.samples.byteOffset + result.samples.byteLength)), rate: result.sampleRate };
  const rate = 24_000;
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', String(rate), 'pipe:1'], { input: result.bytes, maxBuffer: 1 << 28 });
  return { samples: new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)), rate };
}
