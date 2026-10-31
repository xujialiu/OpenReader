import { describe, expect, it } from 'vitest';

import { segmentDocument } from '../../src/app/segment';
import { createMemoryCache } from '../../src/core/memory-cache';
import type { SynthesisResult, TTSProvider } from '../../src/core/providers/types';
import { sectionChapters } from '../../src/offline/model';
import { downloadSpeech } from '../../src/offline/speech';
import type { StoredClip } from '../../src/playback/clip-cache';
import { createClipFetcher } from '../../src/playback/clips';

/**
 * #183: a bracket group with a sentence end inside it, such as a game novel's
 * `<Level Up!>`, reaches the Provider without its brackets in Play and in a
 * Download. The brackets are stripped one Utterance at a time, so this holds
 * only while the splitter keeps the group in one Utterance.
 */
async function played(text: string, pairs: string, language: string): Promise<string[]> {
  const asked: string[] = [];
  const provider: TTSProvider = {
    id: 'speechify',
    capabilities: { wordTimestamps: false },
    listVoices: async () => [],
    synthesize: async (t) => {
      asked.push(t);
      return { audio: 'pcm', samples: new Uint8Array(48), sampleRate: 24_000 } as SynthesisResult;
    },
  };
  const fetcher = createClipFetcher({ provider, voice: 'ava', cache: createMemoryCache<StoredClip>({ maxBytes: 1_000_000 }), brackets: { strip: true, pairs } });
  const utterances = segmentDocument([{ text }], language);
  for (let i = 0; i < utterances.length; i++) await fetcher.fetch(i, utterances[i].text, utterances[i].speakable);
  return asked;
}

function downloaded(text: string, pairs: string, language: string): string[] {
  const texts = sectionChapters(0, [{ text, role: 'paragraph' }], [], language).flatMap((chapter) => chapter.texts);
  return texts.map((t) => downloadSpeech(t, { stripBrackets: true, bracketPairs: pairs }));
}

const CASES: [text: string, pairs: string, language: string, sent: string[]][] = [
  ['<Level Up!>', '<> []', 'en', ['Level Up!']],
  ['<You have absorbed enough Qi for a breakthrough!>', '<> []', 'en', ['You have absorbed enough Qi for a breakthrough!']],
  ['<Quest complete!> <Reward: 100 gold.>', '<> []', 'en', ['Quest complete! Reward: 100 gold.']],
  ['[Unique Ability(2): Requires level 3 to activate. Deals more damage.]', '<> []', 'en', ['Unique Ability(2): Requires level 3 to activate. Deals more damage.']],
  ['[10 points spent. [Haste] obtained.]', '<> []', 'en', ['10 points spent. Haste obtained.']],
  ['【恭喜你升级了。】', '【】', 'zh', ['恭喜你升级了。']],
];

describe('a bracket group with a sentence end inside it (#183)', () => {
  it.each(CASES)('Play sends %j without its brackets', async (text, pairs, language, sent) => {
    expect(await played(text, pairs, language)).toEqual(sent);
  });

  it.each(CASES)('a Download sends %j without its brackets', (text, pairs, language, sent) => {
    expect(downloaded(text, pairs, language)).toEqual(sent);
  });
});
