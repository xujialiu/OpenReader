import { setImmediate } from 'node:timers';
import { expect, it, vi } from 'vitest';
import { segmentDocument } from '../../src/app/segment';
import { createOpenAIProvider } from '../../src/core/providers/openai';
import type { Block } from '../../src/core/segmenter';
import { type DownloadTask, sectionChapters } from '../../src/offline/model';
import { createScheduler } from '../../src/offline/scheduler';
import { createPlaybackEngine } from '../../src/playback/engine';

// Drive the actual engine through native buffer-end events; never play audio.
const audio = vi.hoisted(() => {
  type Ended = (event: { bufferId: string; isLastBufferInQueue: boolean }) => void;
  let nextId = 0;
  let consume = () => {};
  const module = {
    AudioManager: {
      setAudioSessionOptions() {}, async setAudioSessionActivity() {}, observeAudioInterruptions() {},
      addSystemEventListener: () => ({ remove() {} }),
    },
    AudioContext: class {
      readonly sampleRate: number;
      readonly destination = {};
      constructor({ sampleRate }: { sampleRate: number }) { this.sampleRate = sampleRate; }
      createBufferQueueSource() {
        const queue: string[] = [];
        let onBufferEnded: Ended | null = null;
        const source = {
          playbackRate: { value: 1 },
          set onBufferEnded(handler: Ended | null) { onBufferEnded = handler; },
          connect() {}, disconnect() {}, pause() {}, stop() { queue.length = 0; },
          enqueueBuffer() { const id = String(++nextId); queue.push(id); return id; },
          node: { start() {} },
        };
        consume = () => {
          const bufferId = queue.shift();
          if (bufferId) onBufferEnded?.({ bufferId, isLastBufferInQueue: queue.length === 0 });
        };
        return source;
      }
      createBuffer() { return { copyToChannel() {} }; }
      async resume() {}
      async suspend() {}
      async close() {}
    },
  };
  return { module, advance: () => consume() };
});
vi.mock('react-native-audio-api', () => audio.module);

// The OpenAI speech API's documented character limit; independent of how the
// app counts or chooses boundaries. No network or paid synthesis is involved.
function endpoint() {
  const accepted: string[] = [];
  const provider = createOpenAIProvider({ apiKey: 'test-key', model: 'tts-1' }, {
    fetch: async (_url, init) => {
      const input: string = JSON.parse(String(init?.body)).input;
      if ([...input].length > 4096) {
        return Response.json({ error: { message: "Invalid 'input': string too long (maximum 4096 characters)" } }, { status: 400 });
      }
      accepted.push(input);
      return new Response(new Uint8Array(4800), { headers: { 'Content-Type': 'audio/pcm' } });
    },
  });
  return { provider, accepted };
}

const closing = 'Read the next part.';
const examples = [
  { name: 'exactly 4096 characters', text: '字'.repeat(4096), language: 'zh' },
  { name: 'a 4097-character Block', text: '字'.repeat(4097), language: 'zh' },
  { name: 'a Chinese paragraph with commas but no stops', language: 'zh',
    text: Array.from({ length: 625 }, (_, i) => `第${String(i).padStart(3, '0')}句话没有句号`).join('，') },
  { name: 'a long Block made from lines of verse', language: 'en',
    text: Array.from({ length: 120 }, (_, i) => `Line ${i} of a long poem that never ends with a full stop`).join('\n') },
];
const passage = (text: string): Block[] => [{ text, role: 'paragraph' }, { text: closing, role: 'heading' }];
const unspaced = (text: string) => text.replace(/\s+/gu, '');

it.each(examples)('#290 reads all of $name and continues to the next Block', async ({ text, language }) => {
  const { provider, accepted } = endpoint();
  const utterances = segmentDocument(passage(text), language);
  const heard: string[] = [];
  const errors: unknown[] = [];
  let finished = false;
  const engine = createPlaybackEngine({
    provider, voice: 'alloy', gap: { sentenceMs: 0, paragraphMs: 0 },
    clock: { onClip: (clip) => { if (clip.duration > 0) heard.push(utterances[clip.utterance].text); }, onPosition() {} },
    onError: (error) => errors.push(String(error)),
    onOutOfText: () => { finished = true; },
  });
  try {
    engine.load(utterances, 0, { quiet: true });
    engine.play();
    for (let i = 0; i < 24 && !finished && !errors.length; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      audio.advance();
    }
    expect(errors).toEqual([]);
    expect(finished).toBe(true);
    expect(heard.at(-1)).toBe(closing);
    expect(unspaced(heard.join(''))).toBe(unspaced(text + closing));
    expect(accepted).toEqual(heard);
    if (text.length === 4096) expect(accepted).toEqual([text, closing]);
  } finally {
    await engine.dispose();
  }
});

it.each(examples)('#290 completes the Download containing $name', async ({ text, language }) => {
  const { provider, accepted } = endpoint();
  const chapters = sectionChapters(0, passage(text), [], language);
  const task: DownloadTask = { id: 'one', document: 'book', voice: { provider: provider.id, voice: 'alloy', label: 'Alloy' },
    chapters: chapters.map(chapter => chapter.id), state: 'queued', error: null, failed: [] };
  const saved = new Set<string>();
  const scheduler = createScheduler({
    tasks: () => [task], plan: () => ({ version: 2, chapters }), changed() {},
    connected: () => true, allowed: () => true, wait: async () => {},
    exists: (_, text) => saved.has(text),
    async fetch(task, text) {
      await provider.synthesize(text, { voice: task.voice.voice, signal: new AbortController().signal });
      saved.add(text);
    },
  });
  await scheduler.run();
  expect(task).toMatchObject({ state: 'done', error: null, failed: [] });
  expect(accepted.at(-1)).toBe(closing);
  expect(unspaced(accepted.join(''))).toBe(unspaced(text + closing));
  if (text.length === 4096) expect(accepted).toEqual([text, closing]);
});

it('#290 keeps complete graphemes and original Block coordinates when a rejoined sentence crosses the ceiling', () => {
  const prefix = 'A'.repeat(4095);
  const clustered = 'e\u0301';
  const first = prefix + clustered;
  const blocks: Block[] = [{ text: first, role: 'paragraph' }, { text: 'continues here.', role: 'paragraph' }];
  const utterances = segmentDocument(blocks, 'en');
  expect(utterances.map(u => u.text)).toEqual([prefix, `${clustered} continues here.`]);
  expect(utterances.map(u => u.spans)).toEqual([
    [{ block: 0, start: 0, end: prefix.length, textOffset: 0 }],
    [{ block: 0, start: prefix.length, end: first.length, textOffset: 0 },
      { block: 1, start: 0, end: blocks[1].text.length, textOffset: clustered.length + 1 }],
  ]);
  expect(sectionChapters(0, blocks, [], 'en').flatMap(c => c.texts)).toEqual(utterances.map(u => u.text));
});
