import { Directory, File, Paths } from 'expo-file-system';
import { strToU8, gzipSync, gunzipSync } from 'fflate';
import { offlineNative } from '../../modules/open-reader-offline';
import { sha256Hex } from '../core/document/sha256';
import type { SynthesisResult } from '../core/providers/types';
import { clipCacheKey } from '../playback/clip-cache';
import type { NarrationPlan, OfflineVoice } from './model';

let directory: Directory | null = null;
const root = () => {
  if (directory) return directory;
  const dir = new Directory(Paths.document, 'offline-narration');
  dir.create({ intermediates: true, idempotent: true });
  offlineNative?.excludeFromBackup(dir.uri);
  directory = dir;
  return dir;
};
const digest = (value: string) => sha256Hex(strToU8(value));
const docDir = (id: string) => new Directory(root(), digest(id));
const voiceDir = (id: string, voice: OfflineVoice) => new Directory(docDir(id), digest(JSON.stringify([voice.provider, voice.voice])));
const clipId = (voice: OfflineVoice, text: string) => digest(clipCacheKey(voice.provider, voice.voice, text));

/** Commit a small manifest only after its payload exists; a crash never marks a
 * half-written clip complete. Temporary files are scoped to this store. */
export function writeJson(file: File, value: unknown): void {
  if (offlineNative) { offlineNative.writeJson(file.uri, JSON.stringify(value)); return; }
  const temp = new File(`${file.uri}.pending`);
  temp.write(JSON.stringify(value));
  temp.move(file, { overwrite: true });
}
export function readState<T>(name: string, initial: T): T {
  const file = new File(root(), name);
  return file.exists ? JSON.parse(file.textSync()) as T : initial;
}
export function writeState(name: string, value: unknown): void { writeJson(new File(root(), name), value); }
export function readPlan(id: string): NarrationPlan | null {
  const file = new File(docDir(id), 'plan.json');
  if (!file.exists) return null;
  const plan = JSON.parse(file.textSync()) as NarrationPlan;
  if (plan.version !== 1 || !Array.isArray(plan.chapters)) throw new Error('Update the app to read these downloads.');
  return plan;
}
export function savePlan(id: string, plan: NarrationPlan): void {
  docDir(id).create({ intermediates: true, idempotent: true });
  writeJson(new File(docDir(id), 'plan.json'), plan);
}
interface ClipMeta {
  format: 'alac' | 'gzip-pcm' | 'encoded'; size: number; sampleRate?: number;
  mediaType?: string; timestamps?: SynthesisResult['timestamps'];
}
const metaFile = (id: string, voice: OfflineVoice, text: string) => new File(voiceDir(id, voice), `${clipId(voice, text)}.json`);
const audioFile = (id: string, voice: OfflineVoice, text: string, format: ClipMeta['format']) =>
  new File(voiceDir(id, voice), `${clipId(voice, text)}.${format === 'alac' ? 'm4a' : 'audio'}`);
export function clipSize(id: string, voice: OfflineVoice, text: string): number | null {
  const meta = metaFile(id, voice, text);
  if (!meta.exists) return null;
  const info = JSON.parse(meta.textSync()) as ClipMeta;
  const audio = audioFile(id, voice, text, info.format);
  return audio.exists && audio.size === info.size ? info.size : null;
}
export async function readClip(id: string, voice: OfflineVoice, text: string): Promise<SynthesisResult | null> {
  const meta = metaFile(id, voice, text);
  if (!meta.exists) return null;
  const info = JSON.parse(meta.textSync()) as ClipMeta;
  const audio = audioFile(id, voice, text, info.format);
  if (!audio.exists || audio.size !== info.size) return null;
  const bytes = await audio.bytes();
  if (info.format === 'gzip-pcm') return { audio: 'pcm', samples: new Uint8Array(gunzipSync(bytes)),
    sampleRate: info.sampleRate!, timestamps: info.timestamps };
  return { audio: 'encoded', bytes, mediaType: info.format === 'alac' ? 'audio/mp4' : info.mediaType!, timestamps: info.timestamps };
}
export async function saveClip(id: string, voice: OfflineVoice, text: string, clip: SynthesisResult, stillWanted = () => true): Promise<boolean> {
  const dir = voiceDir(id, voice);
  dir.create({ intermediates: true, idempotent: true });
  const bytes = clip.audio === 'pcm' ? clip.samples : clip.bytes;
  if (!bytes.length) throw new Error('The provider returned empty audio.');
  if (Paths.availableDiskSpace < bytes.length * 3 + 1024 * 1024) throw new Error('Not enough storage. Free space and continue.');
  const format: ClipMeta['format'] = clip.audio === 'encoded' ? 'encoded' : offlineNative ? 'alac' : 'gzip-pcm';
  const target = audioFile(id, voice, text, format);
  const temp = new File(dir, `${clipId(voice, text)}.pending.${format === 'alac' ? 'm4a' : 'audio'}`);
  const tempUri = temp.uri;
  const raw = new File(dir, `${clipId(voice, text)}.pending.pcm`);
  try {
    if (clip.audio === 'pcm' && offlineNative) {
      raw.write(bytes);
      await offlineNative.compress(raw.uri, temp.uri, clip.sampleRate);
    } else temp.write(clip.audio === 'pcm' ? gzipSync(bytes) : bytes);
    if (!stillWanted()) return false;
    temp.move(target, { overwrite: true });
    writeJson(metaFile(id, voice, text), { format, size: target.size, timestamps: clip.timestamps,
      ...(clip.audio === 'pcm' ? { sampleRate: clip.sampleRate } : { mediaType: clip.mediaType }) } satisfies ClipMeta);
    return true;
  } finally {
    if (raw.exists) raw.delete();
    const unfinished = new File(tempUri);
    if (unfinished.exists) unfinished.delete();
  }
}
export function deleteClips(id: string, voice: OfflineVoice, texts: string[]): void {
  for (const text of new Set(texts)) {
    const meta = metaFile(id, voice, text);
    if (!meta.exists) continue;
    const info = JSON.parse(meta.textSync()) as ClipMeta;
    meta.delete();
    const audio = audioFile(id, voice, text, info.format);
    if (audio.exists) audio.delete();
  }
}
export function removeDocumentAudio(id: string): void {
  const dir = docDir(id);
  if (dir.exists) dir.delete();
}
