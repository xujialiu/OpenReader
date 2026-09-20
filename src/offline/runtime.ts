import { AppState, Platform } from 'react-native';
import { useSyncExternalStore } from 'react';
import { offlineNative } from '../../modules/open-reader-offline';
import { createMemoryCache } from '../core/memory-cache';
import { createProvider } from '../core/providers/factory';
import { SynthesisError } from '../core/providers/errors';
import type { ProviderId, SynthesisResult, TTSProvider } from '../core/providers/types';
import { withTimeout } from '../core/timeout';
import { readGatewayHeaders, readProviderKey } from '../keys/store';
import { clipCacheKey, toStored, type StoredClip } from '../playback/clip-cache';
import { headersAreOffered, keyIsOffered, providerDeps, providerSettings, readiness, readinessSentence, type AppSettings } from '../app/settings';
import type { DownloadTask, NarrationPlan, OfflineVoice } from './model';
import { createScheduler } from './scheduler';
import * as disk from './storage';

let revision = 0;
let tasks: DownloadTask[] = [];
let settings: AppSettings;
let loaded = false;
let online = true;
let foreground = AppState.currentState === 'active';
let expired = false;
let playing = false;
let storeError: string | null = null;
const plans = new Map<string, NarrationPlan>();
const listeners = new Set<() => void>();
const sizes = new Map<string, number | null>();
const flights = new Map<string, Promise<SynthesisResult>>();
const memory = createMemoryCache<StoredClip>({ maxBytes: 96 * 1024 * 1024 });
const indexing = new Map<string, { title: string; state: 'queued' | 'preparing' | 'failed'; error?: string; count: number }>();
const keyOf = (document: string, voice: OfflineVoice, text: string) => JSON.stringify([document, clipCacheKey(voice.provider, voice.voice, text)]);
const emit = () => { revision++; listeners.forEach((listener) => listener()); };
function persist() {
  try { disk.writeState('tasks.json', { version: 1, tasks }); storeError = null; }
  catch (error) { storeError = `Downloads could not be saved: ${String(error)}`; tasks.forEach((t) => { if (t.state === 'downloading') t.state = 'blocked'; }); }
  emit();
}
export function useDownloads(): number { return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => revision); }
export const downloadError = () => storeError;
export const downloadTasks = (document: string) => tasks.filter((t) => t.document === document);
export function planOf(document: string): NarrationPlan | null {
  const held = plans.get(document);
  if (held) return held;
  const saved = disk.readPlan(document);
  if (saved) plans.set(document, saved);
  return saved;
}
export function savedSize(document: string, voice: OfflineVoice, text: string): number | null {
  const key = keyOf(document, voice, text);
  if (!sizes.has(key)) sizes.set(key, disk.clipSize(document, voice, text));
  return sizes.get(key) ?? null;
}
export const sameVoice = (a: OfflineVoice, b: OfflineVoice) => a.provider === b.provider && a.voice === b.voice;
export function hasSavedVoice(document: string, provider: ProviderId, voice: string): boolean {
  const choice = { provider, voice, label: voice };
  return !!planOf(document)?.chapters.some((c) => c.texts.some((text) => savedSize(document, choice, text) !== null));
}
export function savedVoices(document: string): OfflineVoice[] {
  return downloadTasks(document).map((t) => t.voice).filter((v, i, all) => all.findIndex((other) => sameVoice(v, other)) === i);
}
export function occupied(document: string, voice?: OfflineVoice): number {
  const texts = new Set(planOf(document)?.chapters.flatMap((c) => c.texts) ?? []);
  return (voice ? [voice] : savedVoices(document)).reduce((sum, v) => sum + [...texts].reduce((n, text) => n + (savedSize(document, v, text) ?? 0), 0), 0);
}
export const formatBytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Credentials are read only on a miss, so saved audio works without a key or enabled provider. */
async function synthesize(document: string, voice: OfflineVoice, text: string, current: AppSettings): Promise<SynthesisResult> {
  const saved = await disk.readClip(document, voice, text);
  if (saved) return saved;
  const key = keyOf(document, voice, text);
  let flight = flights.get(key);
  if (!flight) {
    flight = (async () => {
      const cached = await memory.match(key);
      if (cached) return cached.clip;
      if (!online) throw new SynthesisError('network', 'No network connection');
      const keyResult = keyIsOffered(voice.provider) ? await readProviderKey(voice.provider) : null;
      const headers = headersAreOffered(voice.provider) ? await readGatewayHeaders(voice.provider) : null;
      if (keyResult?.outcome === 'refused' || headers?.outcome === 'refused') throw new SynthesisError('auth', 'Credentials could not be read. Unlock the device and continue.');
      const configured = { ...current, provider: voice.provider, voice: voice.voice };
      const ready = readiness(configured, keyResult?.outcome === 'found');
      if (!ready.ready) throw new SynthesisError('no-key', readinessSentence(voice.provider, ready.missing));
      const provider = createProvider(voice.provider, providerSettings(configured, {
        key: keyResult?.outcome === 'found' ? keyResult.secret : '', headers: headers?.outcome === 'found' ? headers.secret : '',
      }), providerDeps);
      const controller = new AbortController();
      const result = await withTimeout(provider.synthesize(text, { voice: voice.voice, signal: controller.signal }),
        60_000, () => new SynthesisError('network', 'The speech service did not respond within 60 seconds.'), () => controller.abort());
      await memory.put(key, toStored(result));
      return result;
    })();
    flights.set(key, flight);
    void flight.catch(() => {}).finally(() => flights.delete(key));
  }
  return flight;
}
export function offlineProvider(document: string, current: AppSettings): TTSProvider {
  return {
    id: current.provider,
    capabilities: { wordTimestamps: ['fish', 'speechify', 'local'].includes(current.provider) },
    listVoices: async () => [],
    synthesize: (text, options) => synthesize(document, { provider: current.provider, voice: options.voice, label: options.voice }, text, current),
  };
}

const scheduler = createScheduler({
  tasks: () => tasks, plan: planOf, connected: () => online,
  allowed: () => loaded && !storeError && !playing && (foreground || !expired),
  changed: persist,
  exists: (task, text) => savedSize(task.document, task.voice, text) !== null,
  fetch: async (task, text) => {
    const clip = await synthesize(task.document, task.voice, text, settings);
    // A paused task can keep its paid in-flight result; a removed chapter cannot.
    const wanted = () => tasks.includes(task) && task.chapters.some((id) => planOf(task.document)?.chapters.find((c) => c.id === id)?.texts.includes(text));
    if (!wanted()) return;
    if (!await disk.saveClip(task.document, task.voice, text, clip, wanted)) return;
    sizes.set(keyOf(task.document, task.voice, text), disk.clipSize(task.document, task.voice, text));
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
const kick = () => { void scheduler.run().catch((error) => { storeError = String(error); emit(); }).finally(() => {
  if (!tasks.some((task) => ['queued', 'downloading'].includes(task.state))) void offlineNative?.endBackground();
}); };
export function configureDownloads(next: AppSettings): void { settings = next; }
export function startDownloads(): () => void {
  if (!loaded) {
    try {
      const file = disk.readState<{ version: number; tasks: DownloadTask[] }>('tasks.json', { version: 1, tasks: [] });
      if (file.version !== 1 || !Array.isArray(file.tasks)) throw new Error('Unsupported download manifest. Update the app.');
      tasks = file.tasks;
      for (const task of tasks) if (['downloading', 'interrupted', 'waiting'].includes(task.state)) task.state = 'queued';
      loaded = true; persist();
    } catch (error) { storeError = String(error); emit(); }
  }
  const network = offlineNative?.addListener('connectivity', ({ connected }) => {
    online = connected;
    if (connected) for (const task of tasks) if (task.state === 'waiting') task.state = 'queued';
    emit(); kick();
  });
  const expiration = offlineNative?.addListener('expired', () => {
    expired = true;
    for (const task of tasks) if (task.state === 'downloading') task.state = 'interrupted';
    persist();
  });
  const state = AppState.addEventListener('change', (value) => {
    foreground = value === 'active';
    if (foreground) {
      expired = false; void offlineNative?.endBackground();
      for (const task of tasks) if (task.state === 'interrupted') task.state = 'queued';
      persist(); kick();
    } else if (tasks.some((task) => ['downloading', 'queued'].includes(task.state))) {
      if (offlineNative) void offlineNative.beginBackground().then((allowed) => { expired = !allowed; emit(); });
      else { expired = true; emit(); }
    }
  });
  // Without a platform connectivity observer, periodically retry only connectivity failures.
  const timer = Platform.OS !== 'ios' ? setInterval(kick, 5000) : null;
  kick();
  return () => { network?.remove(); expiration?.remove(); state.remove(); if (timer) clearInterval(timer); };
}
export function playbackActive(active: boolean): void {
  playing = active;
  if (!active) { for (const task of tasks) if (task.state === 'interrupted' && foreground) task.state = 'queued'; kick(); }
}
export function enqueue(document: string, voice: OfflineVoice, chapters: string[]): void {
  if (!chapters.length) return;
  const task = tasks.find((t) => t.document === document && sameVoice(t.voice, voice));
  if (task) { task.chapters = [...new Set([...task.chapters, ...chapters])]; task.failed = []; task.state = 'queued'; task.error = null; }
  else tasks.push({ id: `${Date.now()}-${Math.random()}`, document, voice, chapters, state: 'queued', error: null, failed: [] });
  persist(); kick();
}
export function toggleTask(task: DownloadTask): void {
  if (['queued', 'downloading', 'waiting'].includes(task.state)) task.state = 'paused';
  else { task.state = 'queued'; task.failed = []; task.error = null; }
  persist(); kick();
}
export function deleteDownloaded(document: string, voice: OfflineVoice, chapters: string[]): void {
  const plan = planOf(document);
  if (!plan) return;
  const selected = new Set(chapters);
  for (const task of tasks) if (task.document === document && sameVoice(task.voice, voice)) {
    task.chapters = task.chapters.filter((id) => !selected.has(id));
    task.failed = task.failed.filter((id) => !selected.has(id));
    if (!task.chapters.length) task.state = 'done';
  }
  tasks = tasks.filter((task) => task.chapters.length > 0);
  persist();
  const remaining = new Set(tasks.filter((t) => t.document === document && sameVoice(t.voice, voice)).flatMap((t) => t.chapters));
  const keep = new Set(plan.chapters.filter((c) => remaining.has(c.id)).flatMap((c) => c.texts));
  const texts = plan.chapters.filter((c) => selected.has(c.id)).flatMap((c) => c.texts).filter((text) => !keep.has(text));
  disk.deleteClips(document, voice, texts);
  for (const text of texts) sizes.delete(keyOf(document, voice, text));
  emit();
}
export function removeDownloads(document: string): void {
  tasks = tasks.filter((task) => task.document !== document); persist();
  disk.removeDocumentAudio(document); plans.delete(document); sizes.clear(); indexing.delete(document); emit(); kick();
}
export function requestPlan(document: string, title: string): void {
  try { if (planOf(document)) return; } catch (error) { storeError = String(error); emit(); return; }
  if (!indexing.has(document) || indexing.get(document)?.state === 'failed') { indexing.set(document, { title, state: 'queued', count: 0 }); emit(); }
}
export const indexingState = (document: string) => indexing.get(document);
export const nextIndex = () => [...indexing].find(([, value]) => value.state !== 'failed');
export function indexProgress(document: string, count: number): void { const entry = indexing.get(document); if (entry) { entry.state = 'preparing'; entry.count = count; emit(); } }
export function finishIndex(document: string, plan: NarrationPlan): void { disk.savePlan(document, plan); plans.set(document, plan); indexing.delete(document); emit(); kick(); }
export function failIndex(document: string, error: string): void { const entry = indexing.get(document); if (entry) { entry.state = 'failed'; entry.error = error; emit(); } }
