import { cutText, shortId } from '../debug/debug-log';
import { fishModelOf } from './narration-voice';
import type { OfflineSummary } from './catalog';
import type { DownloadTask, OfflineVoice } from './model';

/** Bounded fields: no sentence text, credentials, headers or server addresses. */
export function voiceFacts(voice: OfflineVoice): string {
  return `${voice.provider} ${cutText(voice.label)} id=${cutText(voice.voice)}${voice.provider === 'fish' ? ` model=${cutText(fishModelOf(voice) ?? '')}` : ''}`;
}
export function offlineSummaryLine(document: string, title: string, voice: OfflineVoice, s: OfflineSummary): string {
  return `${shortId(document)} ${cutText(title)} ${voiceFacts(voice)}: ${s.downloaded} Downloaded, ${s.awaiting} awaiting Recheck, ${s.partial} partly saved, ${s.unprepared} not prepared; ${s.chapters} owned chapters, ${s.allSaved} all sentences saved; ${s.clips} ready Clips, ${s.orphans} unmatched`;
}
export function downloadActionLine(action: string, task: DownloadTask, title: string, source: string): string {
  return `${action} ${shortId(task.document)} ${cutText(title)} ${voiceFacts(task.voice)}: ${task.chapters.length} chapters, state=${task.state}, paused=${task.paused?.length ?? 0}, failed=${task.failed.length}, Recheck-held=${task.recheckHeld?.length ?? 0}; from ${source}`;
}
