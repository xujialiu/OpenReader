import { expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../../src/app/settings';
import { readDocumentNavigation } from '../../src/core/document/navigation';
import { bytesAsArchive } from '../../src/core/document/zip';
import { navigationPlan, sectionChapters, withPreparedSection, type Chapter, type DownloadTask } from '../../src/offline/model';
import { BLOCK_WALK } from '../../src/renderer/highlighter';
import { SEGMENTATION } from '../../src/core/segmenter/revision';
import { utf8, zip } from '../core/document/zip-fixture';
import { standInPage } from '../renderer/stand-in-page';

/**
 * #167, end to end: a Contents entry whose anchor the Document lacks stopped a
 * Download at that entry's file, at the first pass, at Resume all and at a tap
 * on a later chapter's ring, so the chapters after it were never written.
 *
 * The real `readDocumentNavigation`, `navigationPlan`, runtime, scheduler and
 * `sectionChapters`, and the page program's own preparation run on the stand-in
 * page (`test/renderer/stand-in-page.ts`). Doubled: the repository, the
 * Provider and the platform. The Document has files a, b and c and four
 * Contents entries: A, B one (`b.xhtml`), B two (`b.xhtml#gone`, which b.xhtml
 * does not hold) and C. Written from the repro in the issue.
 */
const mock = vi.hoisted(() => ({ open: vi.fn<() => Promise<unknown>>() }));
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  Platform: { OS: 'ios' },
}));
vi.mock('expo-file-system', () => ({ FileMode: { ReadOnly: 'r' } }));
vi.mock('../../modules/open-reader-offline', () => ({
  offlineNative: { addListener: () => ({ remove() {} }), beginBackground: async () => true, endBackground: async () => {} },
}));
vi.mock('../../src/app/library', () => ({ documentFile: () => { throw new Error('not read'); } }));
vi.mock('../../src/keys/store', () => ({
  readProviderKey: async () => ({ outcome: 'found', secret: 'k' }),
  readGatewayHeaders: async () => ({ outcome: 'found', secret: '' }),
}));
vi.mock('../../src/core/providers/factory', () => ({
  createProvider: () => ({ id: 'openai-official', capabilities: { wordTimestamps: false }, listVoices: async () => [],
    synthesize: async () => ({ audio: 'encoded', bytes: new Uint8Array([1]), mediaType: 'audio/mp4' }) }),
}));
vi.mock('../../src/offline/database', () => ({ offlineRepository: () => mock.open() }));

const rt = await import('../../src/offline/runtime');
(await import('../../src/app/consent')).configureConsent({ kept: () => true, keep: () => {}, ask: async () => true });

const bodies = ['<h1>A</h1><p>Text of A.</p>', '<h1>B one</h1><p>Text of B one.</p><h2>B two</h2><p>Text of B two.</p>', '<h1>C</h1><p>Text of C.</p>'];
const names = ['a.xhtml', 'b.xhtml', 'c.xhtml'];
const epub = zip([
  { name: 'META-INF/container.xml', data: utf8('<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>') },
  { name: 'OPS/package.opf', data: utf8(`<package><manifest><item id="nav" href="nav.xhtml" properties="nav"/>${
    names.map((name, i) => `<item id="f${i}" href="${name}"/>`).join('')}</manifest><spine>${names.map((_, i) => `<itemref idref="f${i}"/>`).join('')}</spine></package>`) },
  { name: 'OPS/nav.xhtml', data: utf8('<html xmlns:epub="http://www.idpf.org/2007/ops"><nav epub:type="toc"><ol><li><a href="a.xhtml">A</a></li>'
    + '<li><a href="b.xhtml">B one</a></li><li><a href="b.xhtml#gone">B two</a></li><li><a href="c.xhtml">C</a></li></ol></nav></html>') },
  ...names.map((name, i) => ({ name: `OPS/${name}`, data: utf8(`<html xmlns="http://www.w3.org/1999/xhtml"><body>${bodies[i]}</body></html>`) })),
]);

it('writes the chapters after a file whose Contents has an entry with a missing anchor', async () => {
  let plan = navigationPlan(readDocumentNavigation(bytesAsArchive(epub)));
  expect(plan.chapters.map((c) => `${c.title} = file ${c.section}${c.fragment ? '#' + c.fragment : ''}`))
    .toEqual(['A = file 0', 'B one = file 1', 'B two = file 1#gone', 'C = file 2']);
  const page = standInPage();
  bodies.forEach((body, index) => page.addSection(index, body));
  const saved = new Set<string>();
  const voice = { provider: 'openai-official' as const, voice: 'alloy', label: 'alloy' };
  const task: DownloadTask = { id: 't', document: 'book', voice, chapters: plan.chapters.map((c) => c.id), state: 'queued', error: null, failed: [] };
  mock.open.mockResolvedValue({
    tasks: async () => [task],
    catalog: { saveTasks: async () => {}, speechKeying: async () => null, preparedWalk: async () => BLOCK_WALK, preparedSegmentation: async () => SEGMENTATION, prepareAgain: async () => {} },
    rekey: async () => {},
    plan: async () => plan,
    progress: async () => plan.chapters.map((c) => ({ id: c.id, count: c.texts.filter((t) => saved.has(t)).length,
      complete: c.prepared !== false && c.texts.length > 0 && c.texts.every((t) => saved.has(t)) })),
    saveSection: async (_d: string, section: number, prepared: Chapter[]) => { plan = withPreparedSection(plan, section, prepared); },
    chapter: async (_d: string, id: string) => ({ ...plan.chapters.find((c) => c.id === id)!, textsLoaded: true }),
    hasClip: async (_d: string, _v: unknown, text: string) => saved.has(text),
    readClip: async () => ({ clip: null, dropped: false }),
    saveClip: async (_d: string, _v: unknown, text: string) => { saved.add(text); return true; },
    inventory: async () => [], savedVoices: async () => [], rememberVoice: async () => {},
  });
  rt.configureDownloads({ ...DEFAULT_SETTINGS, provider: 'openai-official', enabledProviders: ['openai-official'], openai: { model: 'tts-1' }, voice: 'alloy' });
  const stop = rt.startDownloads();
  // What src/offline/indexer.tsx does with each request and each answer.
  const asked = new Set<number>();
  const answer = setInterval(() => {
    const request = rt.preparationRequest();
    if (!request || asked.has(request.token)) return;
    asked.add(request.token);
    void page.prepare(request.section, request.points as unknown[], request.token).then((message) => {
      if (message.type === 'openreader:offline-error') rt.failPreparation(message.token, message.detail);
      else rt.finishPreparation(message.token, sectionChapters(message.index, message.blocks, message.points, message.language));
    });
  }, 1);
  try {
    await vi.waitFor(() => expect(['blocked', 'done']).toContain(task.state), { timeout: 3000 });
    expect(task.error).toBeNull();
    expect(task.state).toBe('done');
    expect([...saved]).toEqual(expect.arrayContaining(['Text of A.', 'Text of B one.', 'B two', 'Text of B two.', 'Text of C.']));
    // B two's text is B one's: the entry has nothing of its own, and is not listed, as a cover page is not.
    expect(plan.chapters.find((c) => c.title === 'B one')!.texts).toEqual(['B one', 'Text of B one.', 'B two', 'Text of B two.']);
    expect(plan.chapters.find((c) => c.title === 'B two')!.texts).toEqual([]);
  } finally {
    clearInterval(answer);
    stop();
  }
});
