import { parseDocument, DomUtils } from 'htmlparser2';
import { type LookupDirection, type LookupMode, type TranslationService, type TranslationTarget, SERVICE_NAMES } from './settings';
type Element = ReturnType<typeof DomUtils.findAll>[number];

export interface Pronunciation { label: string; url: string }
export interface LookupResult { source: string; text: string; phonetic?: string; pronunciations: Pronunciation[] }
export interface LookupRequest {
  text: string; mode: LookupMode; direction: LookupDirection; target: TranslationTarget;
  service: TranslationService; microsoftRegion: string; microsoftKey?: string;
}
export const MAX_LOOKUP_LENGTH = 5000;
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const string = (v: unknown): string => typeof v === 'string' ? v : '';
const nonempty = (v: string): boolean => Boolean(v.trim());

function audioURL(value: unknown): string | null {
  const raw = string(value);
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function parseFreeDictionary(value: unknown): LookupResult {
  const entries = list(value);
  const paragraphs: string[] = [], phonetics: string[] = [];
  const pronunciations: Pronunciation[] = [];
  for (const entry of entries) {
    const e = record(entry);
    if (string(e.phonetic)) phonetics.push(string(e.phonetic));
    for (const item of list(e.phonetics)) {
      const p = record(item);
      if (string(p.text)) phonetics.push(string(p.text));
      const url = audioURL(p.audio);
      if (url && !pronunciations.some((p) => p.url === url)) {
        const accent = /-uk\./i.test(url) ? 'UK' : /-us\./i.test(url) ? 'US' : 'Pronunciation';
        pronunciations.push({ label: accent, url });
      }
    }
    for (const meaning of list(e.meanings)) {
      const m = record(meaning);
      const definitions = list(m.definitions).map((item) => {
        const d = record(item);
        if (!string(d.definition)) return '';
        return [string(d.definition), string(d.example) ? `“${string(d.example)}”` : ''].filter(nonempty).join('\n');
      }).filter(nonempty);
      if (definitions.length) paragraphs.push([string(m.partOfSpeech), ...definitions].filter(nonempty).join('\n'));
    }
  }
  if (!paragraphs.length) throw new Error('No dictionary entry found.');
  return { source: 'Free Dictionary API', text: paragraphs.join('\n\n'), phonetic: [...new Set(phonetics)].join(' · '), pronunciations };
}

const descendants = (el: Element): Element[] => DomUtils.findAll(() => true, el.children);
const hasClass = (el: Element, name: string): boolean => (el.attribs.class ?? '').split(/\s+/).includes(name);
const content = (el: Element): string => DomUtils.textContent(el).replace(/\s+/g, ' ').trim();
/** Parse inert text only. In particular, <非正式> in Youdao's HTML is a usage label, not a tag. */
export function parseYoudaoDictionary(html: string, word: string, direction: LookupDirection): LookupResult {
  const protectedHTML = html.replace(/<([^\x00-\x7f][^<>]*)>/g, '&lt;$1&gt;');
  const doc = parseDocument(protectedHTML);
  const all = DomUtils.findAll(() => true, doc.children);
  const root = all.find((el) => el.attribs.id === 'phrsListTab');
  if (!root) throw new Error('Youdao returned no dictionary entry.');
  const nodes = descendants(root);
  const container = nodes.find((el) => hasClass(el, 'trans-container'));
  if (!container) throw new Error('Youdao returned no dictionary entry.');
  const definitions = direction === 'zh-en'
    ? descendants(container).filter((el) => el.name === 'a' && hasClass(el, 'search-js')).map(content)
    : descendants(container).filter((el) => el.name === 'li').map(content);
  if (!definitions.some(nonempty)) throw new Error('No dictionary entry found for this direction.');
  const phonetic = [...new Set(nodes.filter((el) => hasClass(el, 'phonetic')).map(content))].join(' · ');
  const pronunciations: Pronunciation[] = [];
  for (const type of [1, 2]) {
    if (nodes.some((el) => (el.attribs['data-rel'] ?? '').includes(`type=${type}`))) {
      pronunciations.push({ label: type === 1 ? 'UK' : 'US', url: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}` });
    }
  }
  const examplesRoot = all.find((el) => el.attribs.id === 'bilingual');
  const examples = examplesRoot ? descendants(examplesRoot).filter((el) => el.name === 'li').slice(0, 3).map((li) =>
    descendants(li).filter((el) => el.name === 'p').map(content).filter(nonempty).join('\n')) : [];
  return { source: 'Youdao', text: [...new Set(definitions.filter(nonempty)), ...examples.filter(nonempty)].join('\n\n'), phonetic, pronunciations };
}

export function parseTranslation(value: unknown, service: TranslationService): LookupResult {
  let text = '';
  if (service === 'youdao') {
    const data = record(value);
    if (data.errorCode !== '0' && data.errorCode !== 0) throw new Error('Youdao could not translate this text. Try again.');
    text = list(data.translation).map(string).filter(nonempty).join('\n');
  } else if (service === 'google') {
    text = list(list(value)[0]).map((row) => string(list(row)[0])).filter(nonempty).join('');
  } else {
    text = list(record(list(value)[0]).translations).map((v) => string(record(v).text)).filter(nonempty).join('\n');
  }
  if (!text.trim()) throw new Error(`${SERVICE_NAMES[service]} returned no translation.`);
  return { source: SERVICE_NAMES[service], text, pronunciations: [] };
}

/** One explicitly chosen service per request. No fallback, persistent cache, or document context. */
export async function lookup(request: LookupRequest, deps: { fetch: typeof fetch; signal?: AbortSignal }): Promise<LookupResult> {
  const text = request.text.trim();
  if (!text) throw new Error('Select some text first.');
  if (text.length > MAX_LOOKUP_LENGTH) throw new Error(`Select at most ${MAX_LOOKUP_LENGTH.toLocaleString()} characters.`);
  const abort = new AbortController();
  const cancel = () => abort.abort();
  deps.signal?.addEventListener('abort', cancel);
  if (deps.signal?.aborted) cancel();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; cancel(); }, 15000);
  try {
    let url: string, init: RequestInit = { signal: abort.signal };
    if (request.mode === 'dictionary') {
      url = request.direction === 'en-en'
        ? `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text)}`
        : `https://www.youdao.com/w/${encodeURIComponent(text)}/`;
    } else if (request.service === 'youdao') {
      url = 'https://aidemo.youdao.com/trans';
      init = { ...init, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `from=auto&to=${request.target === 'en' ? 'en' : 'zh-CHS'}&q=${encodeURIComponent(text)}` };
    } else if (request.service === 'google') {
      url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${request.target}&dt=t&q=${encodeURIComponent(text)}`;
    } else {
      if (!request.microsoftKey?.trim()) throw new Error('Add a Microsoft Translator key in Settings.');
      url = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${request.target === 'en' ? 'en' : 'zh-Hans'}`;
      init = { ...init, method: 'POST', headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': request.microsoftKey.trim(),
        ...(request.microsoftRegion.trim() ? { 'Ocp-Apim-Subscription-Region': request.microsoftRegion.trim() } : {}) }, body: JSON.stringify([{ Text: text }]) };
    }
    const response = await deps.fetch(url, init);
    if (!response.ok) {
      if (response.status === 429) throw new Error('Too many requests. Wait a moment and retry.');
      if (response.status === 404 && request.mode === 'dictionary') throw new Error('No dictionary entry found.');
      throw new Error(`The service refused the request (${response.status}).`);
    }
    if (request.mode === 'dictionary' && request.direction !== 'en-en') return parseYoudaoDictionary(await response.text(), text, request.direction);
    const data: unknown = await response.json();
    return request.mode === 'dictionary' ? parseFreeDictionary(data) : parseTranslation(data, request.service);
  } catch (error) {
    if (timedOut) throw new Error('The service took too long. Try again.');
    if (error instanceof TypeError) throw new Error('Could not reach the service. Check your connection and retry.');
    if (error instanceof SyntaxError) throw new Error('The service returned an unreadable reply.');
    throw error;
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener('abort', cancel);
  }
}
