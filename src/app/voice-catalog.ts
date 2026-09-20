/** Names already returned by a Provider, independent of any Reader's lifetime. */
import { File, Paths } from 'expo-file-system';
import type { ProviderId, VoiceInfo } from '../core/providers/types';
import type { AppSettings } from './settings';

type Snapshot = Readonly<Record<string, readonly VoiceInfo[]>>;
let lists: Snapshot = {};
let names: Snapshot = {};
let loaded = false;
const listeners = new Set<() => void>();
const file = () => new File(Paths.document, 'voice-names.json');

// A self-hosted server's ids are only meaningful at that server.
function scope(settings: AppSettings, provider: ProviderId): string {
  return JSON.stringify([provider, provider === 'compatible' ? settings.compatible.baseURL.trim() :
    provider === 'local' ? `${settings.local.engine}:${settings.local.baseURL.trim()}` : '']);
}

function loadNames(): void {
  if (loaded) return;
  loaded = true;
  try {
    const source = file();
    if (!source.exists) return;
    const parsed: unknown = JSON.parse(source.textSync());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const valid: Record<string, VoiceInfo[]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      valid[key] = value.filter((v): v is VoiceInfo => v && typeof v.id === 'string' &&
        typeof v.label === 'string' && typeof v.locale === 'string')
        .map(({ id, label, locale }) => ({ id, label, locale }));
    }
    names = valid;
  } catch { /* Optional display metadata: never stop reading on a corrupt cache. */ }
}

export const subscribeVoiceCatalog = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const voiceCatalogSnapshot = (): Snapshot => lists;
export function catalogVoices(snapshot: Snapshot, settings: AppSettings, provider: ProviderId): readonly VoiceInfo[] | null {
  return snapshot[scope(settings, provider)] ?? null;
}
export function knownVoice(settings: AppSettings): VoiceInfo | null {
  loadNames();
  const key = scope(settings, settings.provider);
  return lists[key]?.find((voice) => voice.id === settings.voice) ??
    names[key]?.find((voice) => voice.id === settings.voice) ?? null;
}
export function rememberVoices(settings: AppSettings, provider: ProviderId, voices: readonly VoiceInfo[]): void {
  loadNames();
  const key = scope(settings, provider);
  const clean = voices.map(({ id, label, locale }) => ({ id, label, locale }));
  lists = { ...lists, [key]: clean };
  // Keep names of previously selected voices even if a later list omits them.
  const merged = new Map((names[key] ?? []).map((voice) => [voice.id, voice]));
  for (const voice of clean) merged.set(voice.id, voice);
  names = { ...names, [key]: [...merged.values()] };
  try { file().write(JSON.stringify(names)); } catch { /* The session still knows the name. */ }
  for (const listener of listeners) listener();
}
