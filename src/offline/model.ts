import type { ProviderId } from '../core/providers/types';
import type { Block } from '../core/segmenter';
import { segmentBlocks } from '../core/segmenter';
import { splitWithSentencex } from '../core/segmenter/sentencex';
import type { DocumentNavigation } from '../core/document/navigation';

export interface Chapter {
  id: string; title: string; depth: number; parent: string | null; texts: string[];
  section?: number | null; fragment?: string;
  /** False means text has not been read. */
  prepared?: boolean;
  /** Metadata queries omit text. Only the scheduler loads a selected chapter. */
  textCount?: number;
  textsLoaded?: boolean;
}
export interface NarrationPlan {
  version: 2; chapters: Chapter[];
  sections?: DocumentNavigation['sections']; preparedSections?: number[];
}
export interface OfflineVoice { provider: ProviderId; voice: string; label: string }
export type TaskState = 'queued' | 'preparing' | 'downloading' | 'paused' | 'waiting' | 'blocked' | 'interrupted' | 'done';
export interface DownloadTask {
  id: string; document: string; voice: OfflineVoice; chapters: string[];
  state: TaskState; error: string | null; failed: string[];
  /** The chapter the scheduler is preparing or fetching right now; null between passes. Read only while the task runs (ADR 0027). */
  current?: string | null;
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
  return chapters.filter((chapter) => ids.has(chapter.id) && (chapter.prepared === false || chapterTextCount(chapter) > 0));
}
export const chapterTextCount=(chapter:Chapter)=>chapter.textCount??chapter.texts.length;

export function navigationPlan(navigation: DocumentNavigation): NarrationPlan {
  const chapters: Chapter[] = navigation.chapters.map((chapter) => ({ ...chapter, texts: [], prepared: chapter.section === null }));
  // Every unlisted file is selectable. A leading fragment may leave a preface
  // before its first chapter, so retain that possible coverage until rendered.
  navigation.sections.forEach((_, section) => {
    const entries = chapters.filter((chapter) => chapter.section === section);
    if (entries.some((chapter) => !chapter.fragment)) return;
    const extra: Chapter = { id: `section-${section}`, title: `Part ${section + 1}`, parent: null, depth: 0, section, texts: [], prepared: false, fragment: '' };
    const at = chapters.findIndex((chapter) => chapter.section !== null && chapter.section !== undefined && chapter.section >= section);
    chapters.splice(at < 0 ? chapters.length : at, 0, extra);
  });
  return { version: 2, chapters, sections: navigation.sections, preparedSections: [] };
}

export function withPreparedSection(plan: NarrationPlan, section: number, prepared: Chapter[]): NarrationPlan {
  const found = new Map(prepared.map((chapter) => [chapter.id, chapter]));
  const chapters = plan.chapters.map((chapter) => {
    if (chapter.section !== section) return chapter;
    const content = found.get(chapter.id);
    return { ...chapter, texts: content?.texts ?? [], prepared: true,
      title: chapter.id.startsWith('section-') && content ? content.title : chapter.title };
  });
  return { ...plan, chapters, preparedSections: [...new Set([...(plan.preparedSections ?? []), section])].sort((a, b) => a - b) };
}
export const fullyPrepared = (plan: NarrationPlan) => !!plan.sections && plan.preparedSections?.length === plan.sections.length;
