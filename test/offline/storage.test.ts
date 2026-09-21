import { beforeEach, expect, it, vi } from 'vitest';
import type { SynthesisResult } from '../../src/core/providers/types';
import { audioFiles } from '../../src/offline/audio-files';
import { audioKey,documentKey,voiceKey } from '../../src/offline/catalog-keys';

const fake = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), compress: vi.fn(), excluded: vi.fn(), hasNative: true }));
vi.mock('expo-file-system', () => {
  const uriOf = (parts: ({ uri: string } | string)[]) => parts.map((p) => typeof p === 'string' ? p : p.uri).join('/');
  class File {
    uri: string;
    constructor(...parts: ({ uri: string } | string)[]) { this.uri = uriOf(parts); }
    get exists() { return fake.files.has(this.uri); }
    get size() { return fake.files.get(this.uri)?.length ?? 0; }
    write(value: string | Uint8Array) { fake.files.set(this.uri, typeof value === 'string' ? new TextEncoder().encode(value) : value); }
    textSync() { return new TextDecoder().decode(fake.files.get(this.uri)); }
    async text() {return this.textSync();}
    async bytes() { return fake.files.get(this.uri); }
    delete() { fake.files.delete(this.uri); }
    moveSync(target: File) {
      const bytes = fake.files.get(this.uri);
      if (!bytes) throw new Error(`Nothing to move at ${this.uri}`);
      fake.files.set(target.uri, bytes); fake.files.delete(this.uri); this.uri = target.uri;
    }
    // As installed (57.0.7): the native move runs off the JS thread, so until the promise settles nothing has moved (#15).
    move(target: File) { return new Promise((resolve) => setTimeout(resolve)).then(() => this.moveSync(target)); }
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
vi.mock('../../modules/open-reader-offline', () => {
  const native = {
    excludeFromBackup: fake.excluded,
    writeJson: (uri: string, value: string) => fake.files.set(uri, new TextEncoder().encode(value)),
    compress: (...args: unknown[]) => fake.compress(...args),
  };
  return { get offlineNative() { return fake.hasNative ? native : null; } };
});
const voice = { provider: 'fish' as const, voice: 'A', label: 'A' };
const address=(v=voice)=>({document:documentKey('book'),voice:voiceKey(v),key:audioKey('Hi')});
const clip: SynthesisResult = { audio: 'pcm', samples: new Uint8Array([0, 1, 0, 2]), sampleRate: 24000,
  timestamps: [{ start: 0, end: 0.2, charStart: 0, charEnd: 2 }] };
beforeEach(() => {
  fake.files.clear();
  fake.hasNative = true;
  fake.compress.mockReset().mockImplementation(async (_input: string, output: string) => fake.files.set(output, new Uint8Array([7, 8, 9])));
});
it('commits audio before metadata and does not delete the target when the move rewrites its URI', async () => {
  await audioFiles.write('book', voice, 'Hi', clip,()=>true);
  const saved=await audioFiles.lookup(address());
  expect(saved?.size).toBe(3);
  expect(await audioFiles.read(saved!)).toEqual({ audio: 'encoded', bytes: new Uint8Array([7, 8, 9]), mediaType: 'audio/mp4', timestamps: clip.timestamps });
  expect([...fake.files.keys()].some((key) => key.includes('.pending'))).toBe(false);
  expect(fake.excluded).toHaveBeenCalled();
});
it('never publishes a clip after its selection was deleted during compression', async () => {
  let wanted = true;
  fake.compress.mockImplementation(async (_input: string, output: string) => { fake.files.set(output, new Uint8Array([7])); wanted = false; });
  expect(await audioFiles.write('book', voice, 'Hi', clip, () => wanted)).toBe(false);
  expect(await audioFiles.lookup(address())).toBeNull();
  expect(fake.files.size).toBe(0);
});
it('does not report a truncated payload as downloaded and deletes only the selected voice', async () => {
  const other = { ...voice, voice: 'B' };
  await audioFiles.write('book', voice, 'Hi', clip,()=>true); await audioFiles.write('book', other, 'Hi', clip,()=>true);
  await audioFiles.remove(address());
  expect(await audioFiles.lookup(address())).toBeNull();
  expect((await audioFiles.lookup(address(other)))?.size).toBe(3);
  const audio = [...fake.files.keys()].find((key) => key.endsWith('.m4a'))!;
  fake.files.set(audio, new Uint8Array([1]));
  expect(await audioFiles.lookup(address(other))).toBeNull();
});
it('without the native module, a saved clip is found and reads back as the samples it was given', async () => {
  fake.hasNative = false;
  await audioFiles.write('book', voice, 'Hi', clip, () => true);
  const saved = await audioFiles.lookup(address());
  expect(saved?.format).toBe('gzip-pcm');
  expect(await audioFiles.read(saved!)).toEqual({ audio: 'pcm', samples: new Uint8Array([0, 1, 0, 2]), sampleRate: 24000, timestamps: clip.timestamps });
  expect([...fake.files.keys()].some((key) => key.includes('.pending'))).toBe(false);
});
