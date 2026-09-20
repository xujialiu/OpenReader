import { beforeEach, expect, it, vi } from 'vitest';
import type { SynthesisResult } from '../../src/core/providers/types';
import { clipSize, deleteClips, readClip, saveClip, savePlan, readPlan, saveSection } from '../../src/offline/storage';
import { navigationPlan, withPreparedSection } from '../../src/offline/model';

const fake = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), compress: vi.fn(), excluded: vi.fn() }));
vi.mock('expo-file-system', () => {
  const uriOf = (parts: ({ uri: string } | string)[]) => parts.map((p) => typeof p === 'string' ? p : p.uri).join('/');
  class File {
    uri: string;
    constructor(...parts: ({ uri: string } | string)[]) { this.uri = uriOf(parts); }
    get exists() { return fake.files.has(this.uri); }
    get size() { return fake.files.get(this.uri)?.length ?? 0; }
    write(value: string | Uint8Array) { fake.files.set(this.uri, typeof value === 'string' ? new TextEncoder().encode(value) : value); }
    textSync() { return new TextDecoder().decode(fake.files.get(this.uri)); }
    async bytes() { return fake.files.get(this.uri); }
    delete() { fake.files.delete(this.uri); }
    move(target: File) { fake.files.set(target.uri, fake.files.get(this.uri)!); fake.files.delete(this.uri); this.uri = target.uri; }
  }
  class Directory {
    uri: string;
    constructor(...parts: ({ uri: string } | string)[]) { this.uri = uriOf(parts); }
    create() {}
    get exists() { return true; }
    delete() { for (const key of fake.files.keys()) if (key.startsWith(this.uri + '/')) fake.files.delete(key); }
  }
  return { File, Directory, Paths: { document: 'file://documents', availableDiskSpace: 1e9 } };
});
vi.mock('../../modules/open-reader-offline', () => ({ offlineNative: {
  excludeFromBackup: fake.excluded,
  writeJson: (uri: string, value: string) => fake.files.set(uri, new TextEncoder().encode(value)),
  compress: (...args: unknown[]) => fake.compress(...args),
} }));
const voice = { provider: 'fish' as const, voice: 'A', label: 'A' };
const clip: SynthesisResult = { audio: 'pcm', samples: new Uint8Array([0, 1, 0, 2]), sampleRate: 24000,
  timestamps: [{ start: 0, end: 0.2, charStart: 0, charEnd: 2 }] };
beforeEach(() => {
  fake.files.clear();
  fake.compress.mockReset().mockImplementation(async (_input: string, output: string) => fake.files.set(output, new Uint8Array([7, 8, 9])));
});
it('commits audio before metadata and does not delete the target when File.move rewrites its URI', async () => {
  await saveClip('book', voice, 'Hi', clip);
  expect(clipSize('book', voice, 'Hi')).toBe(3);
  expect(await readClip('book', voice, 'Hi')).toEqual({ audio: 'encoded', bytes: new Uint8Array([7, 8, 9]), mediaType: 'audio/mp4', timestamps: clip.timestamps });
  expect([...fake.files.keys()].some((key) => key.includes('.pending'))).toBe(false);
  expect(fake.excluded).toHaveBeenCalled();
});
it('never publishes a clip after its selection was deleted during compression', async () => {
  let wanted = true;
  fake.compress.mockImplementation(async (_input: string, output: string) => { fake.files.set(output, new Uint8Array([7])); wanted = false; });
  expect(await saveClip('book', voice, 'Hi', clip, () => wanted)).toBe(false);
  expect(clipSize('book', voice, 'Hi')).toBeNull();
  expect(fake.files.size).toBe(0);
});
it('does not report a truncated payload as downloaded and deletes only the selected voice', async () => {
  const other = { ...voice, voice: 'B' };
  await saveClip('book', voice, 'Hi', clip); await saveClip('book', other, 'Hi', clip);
  deleteClips('book', voice, ['Hi']);
  expect(await readClip('book', voice, 'Hi')).toBeNull();
  expect(clipSize('book', other, 'Hi')).toBe(3);
  const audio = [...fake.files.keys()].find((key) => key.endsWith('.m4a'))!;
  fake.files.set(audio, new Uint8Array([1]));
  expect(clipSize('book', other, 'Hi')).toBeNull();
});
it('round-trips a durable plan independently of audio and playback', () => {
  const plan = { version: 1 as const, chapters: [{ id: 'c', title: 'Chapter', parent: null, depth: 0, texts: ['Hi'] }] };
  savePlan('book', plan); expect(readPlan('book')).toEqual(plan);
});

it('persists selected section text independently and restores partial preparation without declaring the rest ready', () => {
  const plan = navigationPlan({ sections: [{ href: 'one.xhtml', path: 'one.xhtml' }, { href: 'two.xhtml', path: 'two.xhtml' }], chapters: [] });
  savePlan('book', plan);
  const content = [{ id: 'section-1', title: 'Two', parent: null, depth: 0, texts: ['Second chapter text.'] }];
  const next = withPreparedSection(plan, 1, content);
  saveSection('book', 1, content, next);
  const manifest = [...fake.files].find(([path]) => path.endsWith('/plan.json'))![1];
  expect(new TextDecoder().decode(manifest)).not.toContain('Second chapter text.');
  const restored = readPlan('book')!;
  expect(restored.preparedSections).toEqual([1]);
  expect(restored.chapters[0]).toMatchObject({ prepared: false, texts: [] });
  expect(restored.chapters[1]).toMatchObject({ prepared: true, texts: ['Second chapter text.'] });
});
