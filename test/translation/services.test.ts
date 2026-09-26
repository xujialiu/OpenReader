import { describe, expect, it, vi } from 'vitest';
import { lookup, parseFreeDictionary, parseTranslation, parseYoudaoDictionary, type LookupRequest } from '../../src/translation/services';
import { DEFAULT_LOOKUP, parseLookupSettings } from '../../src/translation/settings';

const request: LookupRequest = { ...DEFAULT_LOOKUP, text: 'hello', mode: 'translation' };
describe('lookup adapters', () => {
  it('keeps usage labels and decodes entities in a malformed Chinese/English page without executing it', () => {
    const page = `<div id="phrsListTab"><span class="phonetic">[test]</span><a data-rel="hello&type=1"></a>
      <div class="trans-container"><ul><li>v. <非正式> first &amp; second<li>n. greeting</ul></div></div>
      <div id="bilingual"><ul><li><p>hello there</p><p>你好</p><p>Example source</p></li></ul></div>`;
    const result = parseYoudaoDictionary(page, 'hello', 'en-zh');
    expect(result.text).toContain('<非正式> first & second');
    expect(result.text).toContain('n. greeting');
    expect(result.text).toContain('Example source');
    expect(result.pronunciations).toEqual([{ label: 'UK', url: 'https://dict.youdao.com/dictvoice?audio=hello&type=1' }]);
    const chinese = parseYoudaoDictionary('<div id="phrsListTab"><div class="trans-container"><ul><p class="wordGroup"><span><a class="search-js">hello</a></span></p></ul></div></div>', '你好', 'zh-en');
    expect(chinese.text).toBe('hello');
    expect(chinese.pronunciations).toEqual([]);
  });
  it('refuses changed/error HTML rather than showing unrelated website text', () => {
    expect(() => parseYoudaoDictionary('<h1>Sign in</h1>', 'hello', 'en-zh')).toThrow('no dictionary entry');
  });
  it('keeps all senses, optional examples and real HTTPS pronunciation only', () => {
    const result = parseFreeDictionary([{ phonetics: [{ audio: '' }, { text: '/x/', audio: '//host/word-us.mp3' }, { audio: 'javascript:bad()' }], meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'one', example: 'example' }, { definition: 'two' }] }] }]);
    expect(result.text).toContain('noun\none\n“example”\ntwo');
    expect(result.pronunciations).toEqual([{ label: 'US', url: 'https://host/word-us.mp3' }]);
    expect(() => parseFreeDictionary({ title: 'No Definitions Found' })).toThrow();
  });
  it('joins translated sentences and rejects success-shaped empty replies', () => {
    expect(parseTranslation([[['一', 'one'], ['二', 'two']]], 'google').text).toBe('一二');
    expect(parseTranslation({ errorCode: '0', translation: ['one', 'two'] }, 'youdao').text).toBe('one\ntwo');
    expect(() => parseTranslation({ errorCode: '50' }, 'youdao')).toThrow();
    expect(() => parseTranslation([], 'microsoft')).toThrow();
  });
  it('sends only selected text and automatic source with fixed target to Youdao', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ errorCode: '0', translation: ['你好'] })));
    await lookup({ ...request, microsoftKey: 'must-not-leak' }, { fetch: fetcher });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://aidemo.youdao.com/trans');
    expect(init?.body).toBe('from=auto&to=zh-CHS&q=hello');
    expect(JSON.stringify(init)).not.toContain('must-not-leak');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps Microsoft credentials on its own request, never in the URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([{ translations: [{ text: '你好' }] }])));
    await lookup({ ...request, service: 'microsoft', microsoftKey: 'test-only', microsoftRegion: 'eastasia' }, { fetch: fetcher });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain('api.cognitive.microsofttranslator.com/translate');
    expect(String(url)).not.toContain('test-only');
    expect(init?.headers).toMatchObject({ 'Ocp-Apim-Subscription-Key': 'test-only', 'Ocp-Apim-Subscription-Region': 'eastasia' });
    expect(JSON.parse(String(init?.body))).toEqual([{ Text: 'hello' }]);
  });
  it('does not retry or fall back after rate limiting', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 }));
    await expect(lookup({ ...request, service: 'google' }, { fetch: fetcher })).rejects.toThrow('Too many requests');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('cancels in-flight requests when the selection is replaced', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const pending = lookup(request, { fetch: fetcher, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
  });
  it('rejects oversized selections before making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(lookup({ ...request, text: 'a'.repeat(5001) }, { fetch: fetcher })).rejects.toThrow('5,000');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('projects persisted settings without keys and repairs unknown enum values', () => {
    expect(parseLookupSettings({ enabled: true, pauseReading: false, direction: 'xx', target: 'en', service: 'google', microsoftKey: 'secret' }))
      .toEqual({ ...DEFAULT_LOOKUP, enabled: true, pauseReading: false, target: 'en', service: 'google' });
  });
});
