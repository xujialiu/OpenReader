import type { ProviderId } from '../core/providers/types';
import type { Block } from '../core/segmenter';
import { segmentBlocks } from '../core/segmenter';
import { splitWithSentencex } from '../core/segmenter/sentencex';

export interface Chapter { id: string; title: string; depth: number; parent: string | null; texts: string[] }
export interface NarrationPlan { version: 1; chapters: Chapter[] }
export interface OfflineVoice { provider: ProviderId; voice: string; label: string }
export type TaskState = 'queued' | 'downloading' | 'paused' | 'waiting' | 'blocked' | 'interrupted' | 'done';
export interface DownloadTask {
  id: string; document: string; voice: OfflineVoice; chapters: string[];
  state: TaskState; error: string | null; failed: string[];
}
export interface NavPoint { id: string; title: string; depth: number; parent: string | null; block: number }

/** Segment the section once, exactly as playback does; chapter boundaries never
 * change synthesis text, even when a sentence crosses a navigation anchor. */
export function sectionChapters(section: number, blocks: Block[], points: NavPoint[], language: string): Chapter[] {
  const ordered = [...points].sort((a, b) => a.block - b.block);
  if (!ordered.length || ordered[0].block > 0) ordered.unshift({
    id: `section-${section}`, title: blocks.slice(0, ordered[0]?.block ?? blocks.length).find((b) => b.role === 'heading')?.text.trim().replace(/\s+/g, ' ') || `Part ${section + 1}`,
    depth: 0, parent: null, block: 0,
  });
  const chapters: Chapter[] = ordered.map(({ block: _, ...point }) => ({ ...point, texts: [] }));
  for (const utterance of segmentBlocks(blocks, language, { splitSentences: splitWithSentencex })) {
    if (!utterance.speakable) continue;
    const block = utterance.spans[0].block;
    let at = 0;
    while (at + 1 < ordered.length && ordered[at + 1].block <= block) at++;
    chapters[at].texts.push(utterance.text);
  }
  return chapters;
}

export function descendants(chapters: Chapter[], id: string): Chapter[] {
  const ids = new Set([id]);
  // The navigation is parent-before-child, including empty volume headings.
  for (const chapter of chapters) if (chapter.parent && ids.has(chapter.parent)) ids.add(chapter.id);
  return chapters.filter((chapter) => ids.has(chapter.id) && chapter.texts.length > 0);
}
