import { AppState, Platform } from "react-native";
import { useSyncExternalStore } from "react";
import { FileMode } from "expo-file-system";
import { asDocumentId } from "../core/document";
import {
  readDocumentNavigation,
  type ChapterMetadata,
} from "../core/document/navigation";
import { documentFile } from "../app/library";
import { offlineNative, type ContinuedEnded } from "../../modules/open-reader-offline";
import { createMemoryCache } from "../core/memory-cache";
import { createProvider } from "../core/providers/factory";
import { SynthesisError } from "../core/providers/errors";
import type {
  ProviderId,
  SynthesisResult,
} from "../core/providers/types";
import { withTimeout } from "../core/timeout";
import { readGatewayHeaders, readProviderKey } from "../keys/store";
import {
  toStored,
  type StoredClip,
} from "../playback/clip-cache";
import type { ClipProvider } from "../playback/clips";
import {
  headersAreOffered,
  keepWarm,
  keyIsOffered,
  providerDeps,
  providerDepsFor,
  providerSettings,
  readiness,
  readinessSentence,
  synthesisOrigin,
  type AppSettings,
} from "../app/settings";
import {
  navigationPlan,
  type Chapter,
  type DownloadTask,
  type NarrationPlan,
  type OfflineVoice,
} from "./model";
import { createScheduler, PreparationInterrupted } from "./scheduler";
import * as pausing from "./pausing";
import {
  continuedShown,
  createContinuedProcessing,
  type ContinuedNative,
  type ContinuedShown,
} from "./continued-processing";
import { consent, declinedSentence, providerRecipient, type Recipient } from "../app/consent";
import { purchases } from "../app/purchase";
import { cutText, debugLog, describeProblem, shortId } from "../debug/debug-log";
import { DEBUG_MODE } from "../debug/mode";
import { onDebugNote } from '../debug/debug-note';
import { downloadActionLine, offlineSummaryLine, voiceFacts } from './diagnostics';
import { offlineRepository } from "./database";
import { audioKey, voiceKey, documentKey } from "./catalog-keys";
import { createRechecks, RecheckInterrupted, type RecheckSection } from "./rechecks";
import { fishModelOf, inFishModel, narrationIdentity, withFishModel } from "./narration-voice";
import { DEFAULT_FISH_MODEL } from "../core/providers/fish-models";
import { downloadSpeech, speechKeying } from "./speech";
import type { ChapterProgress, VoiceInventory } from "./catalog";
import { BLOCK_WALK } from "../renderer/highlighter";
import { SEGMENTATION } from "../core/segmenter/revision";

let revision = 0;
let tasks: DownloadTask[] = [];
let settings: AppSettings;
let loaded = false;
// Lifecycle callbacks may kick the scheduler while launch awaits the store.
// Neither they nor an unrelated successful persist can bypass this check.
let preparationCurrent = false;
let fishModelChangedBeforeLoad = false;
let online = true;
let foreground = AppState.currentState === "active";
let expired = false;
/** A Reading is playing: its audio keeps the app running away from the screen, and a download with it (#75). */
let readingPlays = false;
let storeError: string | null = null;
const plans = new Map<string, NarrationPlan>();
const listeners = new Set<() => void>();
const inventories = new Map<string, VoiceInventory[]>();
const inventoryJobs = new Map<string, Promise<void>>();
const inventoryErrors = new Map<string, string>();
const voiceHashes = new Map<string, string>();
const savedVoiceSnapshots = new Map<string, OfflineVoice[]>();
const progressSnapshots = new Map<string, Map<string, ChapterProgress>>();
const progressVoices = new Map<
  string,
  { document: string; voice: OfflineVoice }
>();
const progressJobs = new Map<string, Promise<void>>();
const progressDirty = new Set<string>();
const planJobs = new Map<string, Promise<NarrationPlan | null>>();
const deletionEpochs = new Map<string, number>();
let starting: Promise<void> | null = null;
const flights = new Map<string, Promise<SynthesisResult>>();
const memory = createMemoryCache<StoredClip>({ maxBytes: 96 * 1024 * 1024 });
const indexing = new Map<
  string,
  {
    title: string;
    state: "queued" | "preparing" | "failed";
    error?: string;
    count: number;
  }
>();
export interface PreparationRequest {
  token: number;
  document: string;
  section: number;
  points: ChapterMetadata[];
}
let preparation:
  | (PreparationRequest & {
      task: DownloadTask | null;
      settled: Promise<void>;
      saving?: boolean;
      resolve(): void;
      reject(error: Error): void;
    })
  | null = null;
let rendererDocument: string | null = null;
let preparationSerial = 0;
export const preparationRequest = (): PreparationRequest | null => preparation;
export const indexDocument = () =>
  preparation?.document ??
  (tasks.some(
    (task) =>
      task.document === rendererDocument &&
      ["preparing", "downloading"].includes(task.state),
  )
    ? rendererDocument
    : foreground && rechecks.pendingDocument() === rendererDocument ? rendererDocument : null);
function cancelInactivePreparation() {
  if (
    preparation?.task &&
    (!tasks.includes(preparation.task) ||
      !["preparing", "downloading"].includes(preparation.task.state))
  ) {
    const stopped = preparation;
    preparation = null;
    stopped.reject(new Error("Chapter preparation was stopped."));
  }
}
/**
 * The hidden rendering does not complete a preparation while the app is away
 * from the screen, so one out when the app leaves is withdrawn as interrupted,
 * not left to time out as a failure; the scheduler asks for it again when the
 * app returns (#76). Its token no longer matches, so the renderer's timer and
 * any late answer for it find nothing.
 */
function abandonPreparation() {
  if (!preparation) return;
  const abandoned = preparation;
  preparation = null;
  emit();
  if (!abandoned.task) debugLog('offline', `Recheck ${shortId(abandoned.document)} section ${abandoned.section} interrupted`);
  abandoned.reject(abandoned.task ? new PreparationInterrupted() : new RecheckInterrupted());
}
const keyOf = (document: string, voice: OfflineVoice, text: string) =>
  JSON.stringify([document, narrationIdentity(voice), text]);
const emit = () => {
  revision++;
  listeners.forEach((listener) => { listener(); });
};
async function persist() {
  cancelInactivePreparation();
  if (!loaded) {
    emit();
    return;
  }
  const snapshot = tasks.map((task) => ({
    ...task,
    voice: { ...task.voice },
    chapters: [...task.chapters],
    failed: [...task.failed],
    paused: [...(task.paused ?? [])],
    writing: [...(task.writing ?? [])],
  }));
  try {
    await (await offlineRepository()).catalog.saveTasks(snapshot);
    storeError = null;
  } catch (error) {
    storeError = `Downloads could not be saved: ${String(error)}`;
    tasks.forEach((t) => {
      if (["preparing", "downloading"].includes(t.state)) t.state = "blocked";
    });
    cancelInactivePreparation();
    emit();
    continued.follow();
    throw error;
  }
  emit();
  continued.follow();
  rechecks.wake();
}
export function useDownloads(): number {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => revision,
  );
}
export const downloadError = () => storeError;
export const downloadsReady = () => loaded && preparationCurrent;
export const downloadTasks = (document: string) =>
  tasks.filter((t) => t.document === document);
export const planOf = (document: string): NarrationPlan | null =>
  plans.get(document) ?? null;
const registerVoice = (voice: Pick<OfflineVoice, "provider" | "voice" | "model">) => {
  const identity = narrationIdentity(voice);
  if (!voiceHashes.has(identity)) voiceHashes.set(identity, voiceKey(voice));
};
const progressKey = (document: string, voice: OfflineVoice) =>
  JSON.stringify([document, narrationIdentity(voice)]);
/** Said once: a store that fails on every utterance would otherwise re-render the reader on every utterance. */
const reportStore = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (storeError === message) return;
  storeError = message;
  emit();
};
const fire = (promise: Promise<unknown>) => {
  void promise.catch(reportStore);
};
export const inventoryReady = (document: string) => inventories.has(document);
export const inventoryError = (document: string) =>
  inventoryErrors.get(document) ?? null;
export async function requestInventory(
  document: string,
  voice?: Pick<OfflineVoice, "provider" | "voice" | "model">,
): Promise<void> {
  if (voice) registerVoice(voice);
  if (inventories.has(document)) return;
  if (!inventoryJobs.has(document)) {
    const job = (async () => {
      try {
        const repository = await offlineRepository();
        if (voice)
          await repository.rememberVoice(document, {
            ...voice,
            label: voice.voice,
          });
        inventories.set(document, await repository.inventory(document));
        const saved = await repository.savedVoices(document);
        saved.forEach(registerVoice);
        savedVoiceSnapshots.set(document, saved);
        inventoryErrors.delete(document);
        emit();
      } catch (error) {
        inventoryErrors.set(document, String(error));
        emit();
        throw error;
      }
    })();
    inventoryJobs.set(document, job);
    void job.finally(() => inventoryJobs.delete(document)).catch(() => {});
  }
  await inventoryJobs.get(document);
}
/** Each progress snapshot as the owner downloaded it, for the chapter list it was answered for. */
const downloadedProgress = new WeakMap<
  Map<string, ChapterProgress>,
  { chapters: readonly string[] | undefined; seen: Map<string, ChapterProgress> }
>();
/**
 * Each chapter's saved sentences in `voice`, as the Download drawer, Manage
 * downloads and Contents show them: a chapter that is not in the voice's
 * Download counts none and is not complete (#146).
 *
 * A sentence that two chapters share is one Clip. Deleting one of them keeps
 * it while a chapter still in the Download uses it, and the catalogue goes on
 * counting it for both. The owner deleted the chapter, so it shows as deleted:
 * not in Manage downloads, no count, no check, even when every one of its
 * sentences is still saved for others. A chapter never downloaded that shares
 * a line with one that was is shown the same way. The scheduler and the Live
 * Activity read the catalogue's own count, and are not shown this.
 *
 * Cached per snapshot and chapter list, both replaced rather than changed, so
 * that a screen's memo holds until one of them is.
 */
export function chapterProgress(
  document: string,
  voice: OfflineVoice,
): ReadonlyMap<string, ChapterProgress> {
  const saved = progressSnapshots.get(progressKey(document, voice));
  if (!saved) return new Map();
  const chapters = tasks.find(
    (task) => task.document === document && sameVoice(task.voice, voice),
  )?.chapters;
  const known = downloadedProgress.get(saved);
  if (known && known.chapters === chapters) return known.seen;
  const kept = new Set(chapters);
  const seen = new Map(
    [...saved].map(([id, progress]): [string, ChapterProgress] => [
      id,
      kept.has(id) ? progress : { ...progress, count: 0, complete: false },
    ]),
  );
  downloadedProgress.set(saved, { chapters, seen });
  return seen;
}
export function requestProgress(document: string, voice: OfflineVoice): void {
  const key = progressKey(document, voice);
  registerVoice(voice);
  progressVoices.set(key, { document, voice });
  if (progressJobs.has(key)) {
    progressDirty.add(key);
    return;
  }
  const job = (async () => {
    await requestInventory(document, voice);
    const repository = await offlineRepository();
    await loadPlan(document);
    progressSnapshots.set(
      key,
      new Map(
        (await repository.progress(document, voice)).map((p) => [p.id, p]),
      ),
    );
    emit();
  })();
  progressJobs.set(key, job);
  void job.catch(reportStore).finally(() => {
    progressJobs.delete(key);
    if (progressDirty.delete(key) && progressVoices.has(key))
      requestProgress(document, voice);
  });
}
export function releaseProgress(document: string, voice: OfflineVoice): void {
  progressVoices.delete(progressKey(document, voice));
}
async function refresh(document: string) {
  const repository = await offlineRepository();
  inventories.set(document, await repository.inventory(document));
  const saved = await repository.savedVoices(document);
  saved.forEach(registerVoice);
  savedVoiceSnapshots.set(document, saved);
  for (const item of progressVoices.values())
    if (item.document === document) requestProgress(document, item.voice);
  emit();
}
export const sameVoice = (a: OfflineVoice, b: OfflineVoice) =>
  narrationIdentity(a) === narrationIdentity(b);
export function hasSavedVoice(
  document: string,
  provider: ProviderId,
  voice: string,
  model = settings?.fish.model ?? DEFAULT_FISH_MODEL,
): boolean {
  const key = voiceHashes.get(narrationIdentity(withFishModel({ provider, voice }, model)));
  return !!inventories
    .get(document)
    ?.some((item) => item.voice === key && item.count > 0);
}
export function savedVoices(document: string): OfflineVoice[] {
  return savedVoiceSnapshots.get(document) ?? [];
}
export function occupied(document: string, voice?: OfflineVoice): number {
  const key = voice ? voiceHashes.get(narrationIdentity(voice)) : null;
  return (inventories.get(document) ?? [])
    .filter((item) => !voice || item.voice === key)
    .reduce((sum, item) => sum + item.bytes, 0);
}
export const formatBytes = (bytes: number) =>
  `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Saved audio, while the store answers. A store that cannot open or recover is
 * reported once, where downloads are managed, and the reading goes on over the
 * network as if nothing were saved: the catalogue decides what is played from
 * disk, never whether anything is played at all (#13).
 *
 * A miss goes straight on to the Provider. The inventory is read again only
 * when the read dropped a record whose file had gone, which is the one miss
 * that changed the saved audio (#47): refreshing on every miss re-read the
 * inventory and re-rendered the reader in front of each sentence that was
 * simply never downloaded (notes/NOTES_2026-09-23.md, 13:48).
 */
async function savedClip(
  document: string,
  voice: OfflineVoice,
  text: string,
): Promise<SynthesisResult | null> {
  try {
    const repository = await offlineRepository();
    const saved = await repository.readClip(document, voice, text);
    if (saved.clip) return saved.clip;
    if (saved.dropped) await refresh(document);
    return null;
  } catch (error) {
    reportStore(error);
    return null;
  }
}
/**
 * What sending one sentence to `voice`'s Provider needs, read at the moment it
 * is needed: a network, the credentials, and everything `readiness` asks for.
 * Throws whatever stands in the way, as the `SynthesisError` a Reading or a
 * download reports.
 *
 * Shared by `synthesize`, which then sends, and `ensureConsent`, which only
 * asks (#109). So the two can never disagree about whether a sentence would go
 * out, or about whom it would go to.
 */
async function sendable(voice: OfflineVoice, current: AppSettings) {
  if (!online) throw new SynthesisError("network", "No network connection");
  const keyResult = keyIsOffered(voice.provider)
    ? await readProviderKey(voice.provider)
    : null;
  const headers = headersAreOffered(voice.provider)
    ? await readGatewayHeaders(voice.provider)
    : null;
  if (keyResult?.outcome === "refused" || headers?.outcome === "refused")
    throw new SynthesisError(
      "auth",
      "Credentials could not be read. Unlock the device and continue.",
    );
  const configured = {
    ...current,
    provider: voice.provider,
    voice: voice.voice,
  };
  const found = keyResult?.outcome === "found";
  const ready = readiness(configured, found);
  if (!ready.ready)
    throw new SynthesisError(
      "no-key",
      readinessSentence(voice.provider, ready.missing),
    );
  return {
    configured,
    credentials: {
      key: keyResult?.outcome === "found" ? keyResult.secret : "",
      headers: headers?.outcome === "found" ? headers.secret : "",
    },
    recipient: providerRecipient(configured, voice.provider, found),
  };
}
/**
 * The owner's answer for one of a Reading's sentences, taken before the
 * engine's clock starts rather than inside it (#109, ADR 0064; `ClipProvider`
 * in `clips.ts`).
 *
 * Measured on the simulator on 2026-09-30, with the question asked only inside
 * `synthesize`: the clip fetcher's 60 s clock ran while the alert was up. At
 * 60.09 s the player said "no audio within 60s" under the still-open alert, and
 * the Reading paused.
 *
 * It asks exactly when `synthesize` would. The recipient must not be allowed
 * already, and this sentence's audio must not be on the phone, saved or in
 * memory. Nothing else may stand in the way either (`sendable`): when
 * something does, `synthesize` refuses the sentence for that reason, and asks
 * nothing. It sends nothing itself. The gate in `synthesize` stays the
 * guarantee, and after this it answers at once.
 *
 * The allowed case costs nothing: the recipient's key needs no credential, so
 * a Provider already allowed reads neither the Keychain nor the store here.
 */
async function ensureConsent(
  document: string,
  voice: OfflineVoice,
  text: string,
  current: AppSettings,
): Promise<void> {
  const configured = { ...current, provider: voice.provider, voice: voice.voice };
  if (consent.allows(providerRecipient(configured, voice.provider, false).key)) return;
  if (await memory.match(keyOf(document, voice, text))) return;
  if (await savedClip(document, voice, text)) return;
  let recipient: Recipient;
  try {
    ({ recipient } = await sendable(voice, current));
  } catch {
    return;
  }
  if (!(await consent.ensure(recipient)))
    throw new SynthesisError("declined", declinedSentence(recipient));
}
/**
 * Credentials are read only on a miss, so saved audio works without a key or enabled provider.
 *
 * Saved audio sends nothing, so while a downloaded chapter plays, the Provider's
 * synthesis connection idles, and one idle for about a minute can be dead: the
 * first sentence of the next chapter, which is not downloaded, was refused with
 * "The network connection was lost" and stopped the reading (#26;
 * notes/NOTES_2026-09-23.md, 12:57). Each saved sentence therefore asks for that
 * connection to be kept warm, and `keepWarm` decides whether anything goes out:
 * at most a GET per 20 s, and only to an origin already reached (ADR 0040).
 * Never while the device is offline, when there is no connection to keep.
 */
async function synthesize(
  document: string,
  voice: OfflineVoice,
  text: string,
  current: AppSettings,
  /** A Download's own Sentences at once; absent for a Reading. */
  download?: { atOnce: number },
): Promise<SynthesisResult> {
  // The request owns its Model, even if Settings changes while it is out.
  if (voice.provider === 'fish') current = { ...current, fish: { ...current.fish, model: fishModelOf(voice) ?? DEFAULT_FISH_MODEL } };
  const saved = await savedClip(document, voice, text);
  if (saved) {
    if (online) keepWarm(synthesisOrigin(current, voice.provider));
    return saved;
  }
  const key = keyOf(document, voice, text);
  let flight = flights.get(key);
  if (!flight) {
    flight = (async () => {
      const cached = await memory.match(key);
      if (cached) return cached.clip;
      const { configured, credentials, recipient } = await sendable(voice, current);
      // Asked here, once the request could go out and before anything is built
      // or sent (#109, ADR 0064). A Reading and a download both send from here,
      // Azure's WebSocket included, so this is the one question on the way out.
      // A refusal sends nothing: the Reading stops where it is and says nothing,
      // and a download stops for it (`scheduler.ts`). A Reading's question has
      // usually been asked already, by `ensureConsent`, before the engine's clock
      // started, and then this answers at once.
      if (!(await consent.ensure(recipient)))
        throw new SynthesisError("declined", declinedSentence(recipient));
      const configuration = providerSettings(configured, credentials);
      // Speechify queues its own requests, so a download's number has to
      // reach its queue as well as the scheduler (#64), and so does whose
      // request it is: a Reading's goes ahead of a download's still waiting
      // (#75). A Reading's is one at a time.
      const speechify = download
        ? { ...configuration.speechify, atOnce: download.atOnce, download: true }
        : configuration.speechify;
      // In the Debug Log (ADR 0054), the Reading's every request, and only a
      // download's failures: a long download asks for tens of thousands of
      // sentences, which would push everything else out of it.
      const provider = createProvider(
        voice.provider,
        { ...configuration, speechify },
        download ? providerDeps : providerDepsFor(voice.provider),
      );
      const controller = new AbortController();
      const started = Date.now();
      const asked = `${voice.provider} for ${download ? "a download" : "the Reading"}`;
      if (!download) debugLog("provider", `synthesis ${asked}, voice ${voice.voice}, ${text.length} chars ${cutText(text)}`);
      let result: SynthesisResult;
      try {
        result = await withTimeout(
          provider.synthesize(text, {
            voice: voice.voice,
            signal: controller.signal,
          }),
          60_000,
          () =>
            new SynthesisError(
              "network",
              "The speech service did not respond within 60 seconds.",
            ),
          () => controller.abort(),
        );
      } catch (problem) {
        debugLog("provider", `synthesis ${asked} failed after ${Date.now() - started} ms: ${describeProblem(problem)}`);
        throw problem;
      }
      if (!download) debugLog("provider", `synthesis ${asked} done in ${Date.now() - started} ms: ${clipFacts(result)}`);
      await memory.put(key, toStored(result));
      return result;
    })();
    flights.set(key, flight);
    void flight.catch(() => {}).finally(() => flights.delete(key));
  }
  return flight;
}
/** What a Debug Log line says of a Provider's reply: how much audio, and whether it came with Word Timings. */
function clipFacts(result: SynthesisResult): string {
  const audio = result.audio === "pcm"
    ? `${(result.samples.byteLength / 2 / result.sampleRate).toFixed(2)} s of PCM at ${result.sampleRate} Hz`
    : `${result.bytes.byteLength} bytes of ${result.mediaType}`;
  return `${audio}, ${result.timestamps?.length ?? 0} word timings`;
}
export function offlineProvider(
  document: string,
  current: AppSettings,
): ClipProvider {
  const voiceOf = (voice: string): OfflineVoice => withFishModel({
    provider: current.provider,
    voice,
    label: voice,
  }, current.fish.model);
  return {
    id: current.provider,
    capabilities: {
      wordTimestamps: ["azure", "fish", "speechify", "local"].includes(current.provider),
    },
    listVoices: async () => [],
    // Before the clip fetcher's clock (#109): the owner's answer is not timed.
    ensureConsent: (text, options) =>
      ensureConsent(document, voiceOf(options.voice), text, current),
    synthesize: (text, options) =>
      synthesize(document, voiceOf(options.voice), text, current),
  };
}

const scheduler = createScheduler({
  tasks: () => tasks,
  plan: (document) => loadPlan(document),
  connected: () => online,
  // Not held back while a Reading plays (#75): a Reading keeps its precedence
  // where requests are queued in the app, which is Speechify's queue alone.
  // Away from the screen, the end of the bounded background time stops a
  // download only once neither a Reading nor a continued task the phone
  // accepted keeps the app running (ADR 0053).
  // While read-aloud is locked (#148, ADR 0075), nothing is written. A download
  // caught mid-chapter as the Trial ends stops at the next sentence, and
  // `pauseForLock` then pauses it. Asked here without a question: the
  // scheduler never raises an alert.
  allowed: () =>
    loaded &&
    preparationCurrent &&
    !storeError &&
    purchases.allowsSpeech() &&
    (foreground || !expired || readingPlays || continued.running()),
  // Where the hidden rendering prepares a chapter's text (#76).
  foreground: () => AppState.currentState === "active",
  // A download the lock stopped mid-run is paused as it stops (#148).
  changed: () => {
    pauseForLock();
    return persist();
  },
  // The texts a chapter holds are the Utterances' own; what is checked, spoken
  // and saved is their Speech Text, as reading asks for it (#25).
  exists: async (task, text) =>
    (await offlineRepository()).hasClip(
      task.document,
      task.voice,
      downloadSpeech(text, settings),
    ),
  load: async (task, chapter) => {
    const loaded = await (
      await offlineRepository()
    ).chapter(task.document, chapter.id);
    if (!loaded) throw new Error("Selected chapter metadata is missing.");
    return loaded;
  },
  // The download's own voice decides, not the one reading now: a task keeps the
  // voice it started with. The owner's number for that Provider (#64).
  concurrency: (task) => settings.sentencesAtOnce[task.voice.provider],
  // One join per run, so resuming a long task does not re-check every saved text.
  completed: async (task) =>
    new Set(
      (await (await offlineRepository()).progress(task.document, task.voice))
        .filter((chapter) => chapter.complete)
        .map((chapter) => chapter.id),
    ),
  prepare: async (task, chapter) => {
    await prepareChapter(task.document, chapter, task);
    return planOf(task.document)!.chapters.find((c) => c.id === chapter.id)!;
  },
  fetch: async (task, text, chapter) => {
    if (task.recheckHeld?.includes(chapter)) return;
    const key = JSON.stringify([
      task.document,
      narrationIdentity(task.voice),
      chapter,
    ]);
    const epoch = deletionEpochs.get(key) ?? 0;
    const speech = downloadSpeech(text, settings);
    const clip = await synthesize(task.document, task.voice, speech, settings, { atOnce: settings.sentencesAtOnce[task.voice.provider] })
      .catch((problem: unknown) => {
        debugLog("download", `${shortId(task.document)} chapter ${chapter}: a sentence was not synthesized, ${describeProblem(problem)}`);
        throw problem;
      });
    const wanted = () => tasks.includes(task) && task.chapters.includes(chapter) &&
      !task.recheckHeld?.includes(chapter) && (deletionEpochs.get(key) ?? 0) === epoch;
    if (!wanted()) return;
    if (!(await (await offlineRepository()).saveClip(task.document, task.voice, speech, clip, wanted))) return;
    await refresh(task.document);
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

let downloadPreparations = 0;
async function prepareChapter(document: string, chapter: Chapter, task: DownloadTask | null): Promise<void> {
  if (task) downloadPreparations++;
  try {
    if (task && preparation && !preparation.task && !preparation.saving) abandonPreparation();
    while (preparation) await preparation.settled.catch(() => {});
    if (!foreground) throw task ? new PreparationInterrupted() : new RecheckInterrupted();
    if (task && (!tasks.includes(task) || !['preparing', 'downloading'].includes(task.state)))
      throw new Error('Chapter preparation was stopped.');
    const section = chapter.section;
    if (section === null || section === undefined)
      throw new Error("This chapter does not identify a document section.");
    const plan = planOf(document);
    const held = plan?.chapters.find((c) => c.id === chapter.id);
    if (!plan || !held) throw new Error('Chapter metadata was removed.');
    if (held.prepared !== false && !held.recheck) return;
    const started = Date.now();
    const which = `${shortId(document)} chapter ${chapter.id} (section ${section})`;
    if (task) debugLog("download", `preparing ${which}`);
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const settled = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    rendererDocument = document;
    preparation = {
      token: ++preparationSerial,
      document,
      section,
      task,
      settled,
      resolve,
      reject,
      points: plan.chapters
        .filter((c) => c.section === section && !c.id.startsWith("section-"))
        .map((c) => ({
          id: c.id,
          title: c.title,
          parent: c.parent,
          depth: c.depth,
          section,
          fragment: c.fragment ?? "",
        })),
    };
    emit();
    await settled.catch((problem: unknown) => {
      if (task) debugLog("download", `preparing ${which} ${problem instanceof PreparationInterrupted ? "waits for the foreground" : "failed"} after ${Date.now() - started} ms: ${describeProblem(problem)}`);
      throw problem;
    });
    if (task) debugLog("download", `prepared ${which} in ${Date.now() - started} ms`);
  } finally { if (task) downloadPreparations--; }
}

let recheckCurrent: RecheckSection | null = null;
export function prioritizeRecheck(document: string | null, section = 0): void {
  recheckCurrent = document ? { document, section } : null;
  rechecks.wake();
}
const recheckMeasures = new Map<string, { started: number; sections: number; lost: number }>();
const rechecks = createRechecks({
  allowed() { return loaded && preparationCurrent && foreground && !storeError && !preparation && !downloadPreparations; },
  order: () => [...documentTitles.keys()],
  current: () => recheckCurrent,
  sections: async () => {
    const ids = new Map([...documentTitles.keys(), ...tasks.map((t) => t.document)].map((id) => [documentKey(id), id]));
    return (await (await offlineRepository()).catalog.recheckSections()).flatMap((s) => {
      const document = ids.get(s.document);
      return document ? [{ document, section: s.section }] : [];
    });
  },
  prepare: async ({ document, section }) => {
    const plan = await loadPlan(document);
    const chapter = plan?.chapters.find((c) => c.section === section && c.recheck);
    if (!chapter) return;
    if (!foreground || preparation || downloadPreparations) throw new RecheckInterrupted();
    if (DEBUG_MODE && !recheckMeasures.has(document)) {
      recheckMeasures.set(document, { started: Date.now(), sections: 0, lost: 0 });
      debugLog('offline', `Recheck ${shortId(document)} ${cutText(documentTitles.get(document) ?? '')} started: ${plan!.chapters.filter((c) => c.recheck).length} chapters awaiting`);
    }
    await prepareChapter(document, chapter, null);
  },
  finished: ({ document }, remaining) => {
    const measure = recheckMeasures.get(document);
    if (!measure) return;
    measure.sections++;
    if (remaining.some((s) => s.document === document)) return;
    debugLog('offline', `Recheck ${shortId(document)} finished: ${measure.sections} sections checked, ${measure.lost} Voice/chapter checks withdrawn in ${Date.now() - measure.started} ms`);
    recheckMeasures.delete(document);
  },
  failed: (s, error) => debugLog('offline', `Recheck ${shortId(s.document)} section ${s.section} failed: ${describeProblem(error)}`),
});
/**
 * The names the Library shows, which the Debug Log gives for the Documents a
 * continued task's Live Activity covers: its title names none (#93).
 */
const documentTitles = new Map<string, string>();
/** Metadata only: summaries must not audit every audio file at launch. */
async function logOfflineState(reason: string, document?: string, selected?: OfflineVoice): Promise<void> {
  if (!DEBUG_MODE) return;
  const catalog = (await offlineRepository()).catalog;
  const documents = document ? [document] : [...new Set([...documentTitles.keys(), ...tasks.map((t) => t.document)])];
  let lines = 0;
  for (const id of documents) {
    const voices = new Map((await catalog.savedVoices(documentKey(id))).map((v) => [narrationIdentity(v), v]));
    for (const task of tasks.filter((t) => t.document === id)) voices.set(narrationIdentity(task.voice), task.voice);
    if (selected) voices.set(narrationIdentity(selected), selected);
    for (const voice of voices.values()) {
      const task = tasks.find((t) => t.document === id && sameVoice(t.voice, voice));
      const summary = await catalog.summary(documentKey(id), voiceKey(voice), task?.chapters ?? []);
      debugLog('offline', `${reason}: ${offlineSummaryLine(id, documentTitles.get(id) ?? '', voice, summary)}`);
      if (task) debugLog('offline', `${reason}: ${downloadActionLine('task', task, documentTitles.get(id) ?? '', 'catalogue')}`);
      lines++;
    }
  }
  debugLog('offline', `${reason}: ${lines} Document/Voice summaries; catalogue records, not a file audit`);
}
function logDownload(action: string, task: DownloadTask, source: string) {
  if (DEBUG_MODE) debugLog('download', downloadActionLine(action, task, documentTitles.get(task.document) ?? '', source));
}
export function nameDocuments(
  entries: readonly { id: string; title: string }[],
): void {
  const added = entries.some(({ id }) => !documentTitles.has(id));
  documentTitles.clear();
  for (const { id, title } of entries) documentTitles.set(id, title);
  if (added) rechecks.retry();
}
/** ADR 0053: the continued processing task a download away from the screen runs under. */
const continued = createContinuedProcessing({
  native: offlineNative && continuedNative(offlineNative),
  tasks: () => tasks,
  shown: async (batch) => {
    const repository = await offlineRepository();
    return continuedShown(
      await Promise.all(
        batch.map(async (task) => ({
          task,
          progress: await repository.progress(task.document, task.voice),
          plan: planOf(task.document),
        })),
      ),
    );
  },
  foreground: () => foreground,
});
/**
 * The continued task's native calls, each also a Debug Log line in Debug Mode
 * (ADR 0054); an update only when what the Live Activity shows changes, not at
 * every saved clip. The line names the Documents covered, as the title does not.
 */
function continuedNative(
  native: NonNullable<typeof offlineNative>,
): ContinuedNative {
  const submit = ({ title, subtitle, completed, total }: ContinuedShown) =>
    native.submitContinued(title, subtitle, completed, total);
  const update = ({ title, subtitle, completed, total }: ContinuedShown) =>
    native.updateContinued(title, subtitle, completed, total);
  if (!DEBUG_MODE)
    return {
      submitContinued: submit,
      updateContinued: update,
      finishContinued: (success) => native.finishContinued(success),
    };
  const described = ({ title, subtitle, documents }: ContinuedShown) =>
    `${cutText(title)}, ${subtitle}, for ${documents
      .map((id) => {
        const name = documentTitles.get(id);
        return name === undefined ? shortId(id) : cutText(name);
      })
      .join(", ")}`;
  let shown = "";
  return {
    async submitContinued(next) {
      const running = await submit(next);
      shown = described(next);
      debugLog("download", `continued task submitted showing ${shown}: ${running ? "running" : "not run"}`);
      return running;
    },
    updateContinued(next) {
      if (described(next) !== shown) {
        shown = described(next);
        debugLog("download", `continued task shows ${shown}`);
      }
      return update(next);
    },
    finishContinued(success) {
      shown = "";
      debugLog("download", `continued task finished, ${success ? "succeeded" : "did not succeed"}`);
      return native.finishContinued(success);
    },
  };
}
const runsAway = () =>
  tasks.some((task) =>
    ["preparing", "downloading", "queued"].includes(task.state),
  );
/**
 * The bounded background time, begun on leaving the app unless a continued
 * task the phone accepted keeps it running; a submission still out does not
 * count, since the phone may refuse it (ADR 0053).
 */
function beginBounded() {
  if (offlineNative)
    void offlineNative.beginBackground().then((allowed) => {
      expired = !allowed;
      emit();
    });
  else {
    expired = true;
    emit();
  }
}
/**
 * The owner started or resumed a download on the screen, or opened the app
 * while one goes on by itself: it may go on away from the screen. Apple asks
 * for the submission to follow a person's action, and the owner counts opening
 * the app as one (#77, 2026-09-28), so a launch and every return to the
 * foreground submit, as the taps do. Nothing submits while the app is away
 * (`start` checks again right before the native call), nor when the phone ends
 * the task: its end pauses what it covered. Where nothing goes on by itself,
 * `start` submits nothing.
 *
 * The app may leave while the submission is out; it then began the bounded
 * time, which a refusal leaves running. An acceptance gives it back: the
 * continued task keeps the app running from then on.
 */
function continueAway() {
  // Nothing goes on away from the screen while read-aloud is locked, so no
  // continued task and no Live Activity is submitted for it (#148).
  if (!preparationCurrent || !foreground || !purchases.allowsSpeech()) return;
  void continued.start().then((running) => {
    if (running && !foreground) void offlineNative?.endBackground();
  });
}
/**
 * Away from the screen, the time ran out: what was being written continues on
 * the return. A playing Reading keeps the app running, and its download with
 * it (#75), until it stops (`setReadingPlays`).
 */
function interruptAway() {
  expired = true;
  if (!readingPlays) interruptWriting();
}
/**
 * While read-aloud is locked (#148, ADR 0075), every download that would go on
 * is paused, as Pause all pauses it: the drawer shows it Paused, with Resume
 * all, which asks about the Unlock first (`toggleTask`). That covers the end of
 * the Trial, a launch and a return to the app, and a download the scheduler
 * stopped mid-chapter, which `interrupted` would otherwise leave reading
 * "continues when available" over a download that cannot.
 *
 * Only once what is owned has first been read: until then a lock is not known,
 * and a launch must not pause what an Unlock read a moment later allows.
 * Returns whether anything was paused, for the caller to persist.
 */
function pauseForLock(): boolean {
  if (!purchases.settled() || purchases.allowsSpeech()) return false;
  let paused = false;
  for (const task of tasks)
    if (pausing.GOES_ON.includes(task.state) || task.state === "interrupted") {
      pausing.pauseAll(task);
      logDownload('paused', task, 'lock');
      paused = true;
    }
  if (paused) debugLog("download", "read-aloud is locked: every download that would go on is paused (#148)");
  return paused;
}
/** The longest a timer may be set for: a longer one fires at once. */
const LONGEST_TIMER_MS = 2 ** 31 - 1;
let trialEnd: ReturnType<typeof setTimeout> | null = null;
/**
 * The end of the Trial with the app running: whatever would go on is paused
 * at that moment, not at the next launch (#148). Set again whenever what is
 * owned changes. Away from the screen the timer may not run; a return or a
 * launch pauses then instead (`kick`, `startDownloads`).
 */
function armTrialEnd(): void {
  if (trialEnd) clearTimeout(trialEnd);
  trialEnd = null;
  const left = purchases.trialLeft();
  if (left === null) return;
  trialEnd = setTimeout(() => {
    trialEnd = null;
    if (pauseForLock()) fire(persist());
    else if ((purchases.trialLeft() ?? 0) > 1000) armTrialEnd();
  }, Math.min(Math.max(0, left) + 50, LONGEST_TIMER_MS));
}
const kick = () => {
  if (pauseForLock()) fire(persist());
  void scheduler
    .run()
    .catch((error) => {
      storeError = String(error);
      emit();
    })
    .finally(() => {
      if (
        !tasks.some((task) =>
          ["queued", "preparing", "downloading"].includes(task.state),
        )
      )
        void offlineNative?.endBackground();
    });
};
/** A settings change cannot resume an old Model, including through a stale UI callback. */
const usesCurrentModel = (voice: OfflineVoice) => inFishModel(voice, settings?.fish.model ?? DEFAULT_FISH_MODEL);
export function configureDownloads(next: AppSettings): void {
  const rekey = !!settings && speechKeying(settings) !== speechKeying(next);
  const changedModel = !!settings && settings.fish.model !== next.fish.model;
  // Read each time a place is to be filled (#311): a running download looks again at once, so a higher number is used now.
  const changedAtOnce = !!settings && JSON.stringify(settings.sentencesAtOnce) !== JSON.stringify(next.sentencesAtOnce);
  settings = next;
  if (changedAtOnce && !changedModel) kick();
  if (changedModel) {
    if (!loaded) fishModelChangedBeforeLoad = true;
    for (const task of tasks) if (task.voice.provider === 'fish' && task.state !== 'done') pausing.pauseAll(task);
    fire(persist().then(kick));
  }
  if (rekey) void ensureSpeechKeys();
}
let keying: Promise<void> = Promise.resolve();
/**
 * A chapter's membership keys name its sentences' Speech Text, so they answer
 * to the bracket setting they were computed under. When that is not the current
 * one — recorded as something else, or never recorded — they are computed again
 * from the stored texts (#25, design 0028). Chained, so two changes in a row
 * walk in order rather than at once; `force` is for a section saved while the
 * setting changed under it.
 */
function ensureSpeechKeys(force = false): Promise<void> {
  keying = keying
    .then(async () => {
      if (!settings) return;
      const current = settings;
      const repository = await offlineRepository();
      const wanted = speechKeying(current);
      if (!force && (await repository.catalog.speechKeying()) === wanted) return;
      await repository.rekey((text) => audioKey(downloadSpeech(text, current)), wanted);
      for (const item of progressVoices.values())
        requestProgress(item.document, item.voice);
      emit();
    })
    .catch(reportStore);
  return keying;
}
/**
 * Old text retains its last known completeness until Rechecked (#321).
 * Revision changes mark the text, not the Downloads: unfinished Downloads
 * continue. A Recheck's new holes have durable per-Voice holds in the same
 * transaction as the new text, and only Download selected releases those.
 * Run on the speech-key chain before enabling either runner; reload held plans.
 */
function ensurePreparedText(): Promise<void> {
  keying = keying
    .then(async () => {
      const repository = await offlineRepository();
      const walk = await repository.catalog.preparedWalk();
      const segmentation = await repository.catalog.preparedSegmentation();
      if (walk === BLOCK_WALK && segmentation === SEGMENTATION) return;
      await repository.catalog.prepareAgain(BLOCK_WALK, SEGMENTATION);
      if (DEBUG_MODE) {
        const pending = await repository.catalog.recheckSections();
        debugLog('offline', `revision change: ${pending.length} sections in ${new Set(pending.map((s) => s.document)).size} Documents with saved Clips await Recheck`);
      }
      debugLog('offline', `preparation revisions walk ${walk}→${BLOCK_WALK}, segmentation ${segmentation}→${SEGMENTATION}; pending Recheck, checks retained; ${tasks.filter((t) => pausing.GOES_ON.includes(t.state)).length} Downloads continue`);
      for (const document of [...plans.keys()]) {
        const plan = await repository.plan(document);
        if (plan) plans.set(document, plan);
        else plans.delete(document);
      }
      for (const item of progressVoices.values())
        requestProgress(item.document, item.voice);
      emit();
    });
  // Let launch report the failure without opening the scheduler gate. A later
  // successful task save must not turn an unverified preparation into a current one.
  return keying;
}
let downloadWatchers = 0;
export function startDownloads(): () => void {
  downloadWatchers++;
  rechecks.start();
  if (!loaded && !starting) {
    starting = (async () => {
      tasks = await (await offlineRepository()).tasks();
      for (const document of new Set(tasks.map((t) => t.document))) await refreshRecheckHolds(document);
      tasks.forEach((task) => {
        registerVoice(task.voice);
        // Settings may have changed before async task loading finished.
        if (task.voice.provider === 'fish' && task.state !== 'done' &&
          (fishModelChangedBeforeLoad || !usesCurrentModel(task.voice))) pausing.pauseAll(task);
      });
      fishModelChangedBeforeLoad = false;
      for (const task of tasks)
        if (
          ["preparing", "downloading", "interrupted", "waiting"].includes(
            task.state,
          )
        )
          { task.state = "queued"; logDownload('resumed', task, 'launch'); }
      loaded = true;
      await persist();
      // Whether read-aloud may go on is known before anything goes on by
      // itself: while it is locked, a download left going on is paused, and no
      // continued task is submitted for it (#148).
      await purchases.ready();
      if (pauseForLock()) await persist();
      // Before any run, including a lifecycle kick while launch is awaiting.
      await ensurePreparedText();
      await ensureSpeechKeys();
      if (DEBUG_MODE) await logOfflineState('launch').catch((error) => debugLog('offline', `launch summary failed: ${describeProblem(error)}`));
      preparationCurrent = true;
      if (downloadWatchers > 0) rechecks.start();
      emit();
      // Only a Download still permitted to go on may start away (#77).
      continueAway();
      kick();
      rechecks.wake();
    })();
    void starting.catch(reportStore).finally(() => {
      starting = null;
    });
  }
  const network = offlineNative?.addListener(
    "connectivity",
    ({ connected }) => {
      online = connected;
      if (connected)
        for (const task of tasks)
          if (task.state === "waiting") { task.state = "queued"; logDownload('resumed', task, 'connectivity'); }
      emit();
      kick();
    },
  );
  // The bounded time ran out. Where the phone accepted a continued task after
  // the app left, that task keeps the app running, and the download with it;
  // the bounded time was given back, and an end that arrives anyway is ignored.
  const expiration = offlineNative?.addListener("expired", () => {
    debugLog("download", `the bounded background time expired${continued.running() ? ", under a running continued task" : ""}`);
    if (!continued.running()) interruptAway();
  });
  // The phone ended the continued task, at the owner's stop in the Live
  // Activity or under pressure; the two cannot be told apart, and both are
  // taken as the owner's stop (#77, 2026-09-28). The downloads it covered that
  // go on by themselves are paused as Pause all pauses them, on the screen or
  // away (the stop itself opens the app for a moment), so opening the app
  // resumes nothing and submits nothing; Resume all does. The rest are left.
  const continuedExpiration = offlineNative?.addListener(
    "continuedExpired",
    (ended?: ContinuedEnded) => {
      debugLog(
        "download",
        ended
          ? `continued task expired: cancelled ${ended.cancelled}, ${ended.completed} of ${ended.total}, ` +
              `thermal state ${ended.thermalState}, Low Power Mode ${ended.lowPower}`
          : "continued task expired",
      );
      for (const task of continued.expired()) { pausing.pauseAll(task); logDownload('paused', task, 'Live Activity'); }
      if (!foreground) expired = true;
      fire(persist());
    },
  );
  const state = AppState.addEventListener("change", (value) => {
    foreground = value === "active";
    if (foreground) {
      rechecks.retry();
      expired = false;
      void offlineNative?.endBackground();
      for (const task of tasks)
        if (task.state === "interrupted") { task.state = "queued"; logDownload('resumed', task, 'foreground'); }
      // Back with a download that goes on by itself: leaving again keeps it going without a tap (#77).
      continueAway();
      fire(persist().then(kick));
    } else if (!continued.running() && runsAway()) beginBounded();
  });
  const noteWatch = DEBUG_MODE ? onDebugNote((time, note) => {
    void logOfflineState(`snapshot, Debug Note ${time}`, note.document.id, note.voice)
      .catch((error) => debugLog('offline', `snapshot, Debug Note ${time} failed: ${describeProblem(error)}`));
  }) : () => {};
  const leaving = AppState.addEventListener("change", (value) => {
    if (value !== "active") abandonPreparation();
  });
  // What is owned changed (#148). Locked now, whatever would go on is paused.
  // An Unlock that arrives by itself, from another device or a parent's
  // approval, resumes nothing: a download the lock paused stays paused, as one
  // the person paused does, until Resume all or a ring.
  const purchaseWatch = purchases.subscribe(() => {
    if (pauseForLock()) fire(persist());
    armTrialEnd();
  });
  armTrialEnd();
  // Without a platform connectivity observer, periodically retry only connectivity failures.
  const timer = Platform.OS !== "ios" ? setInterval(kick, 5000) : null;
  kick();
  return () => {
    noteWatch();
    if (--downloadWatchers === 0) {
      rechecks.stop();
      if (preparation && !preparation.task) abandonPreparation();
    }
    purchaseWatch();
    if (trialEnd) clearTimeout(trialEnd);
    trialEnd = null;
    network?.remove();
    expiration?.remove();
    continuedExpiration?.remove();
    state.remove();
    leaving.remove();
    if (timer) clearInterval(timer);
  };
}
/** What the end of the background time does to the download being written. */
function interruptWriting() {
  for (const task of tasks)
    if (["preparing", "downloading"].includes(task.state))
      task.state = "interrupted";
  fire(persist());
}
/**
 * Whether a Reading is playing, told by the one place that holds it
 * (`reading-host.tsx`, ADR 0049). Away from the screen after the background
 * time has run out, its audio is what keeps the app running (#75): when it
 * stops there, the download is interrupted as the end of that time would have
 * done, and when it starts there, an interrupted download goes on beside it.
 */
export function setReadingPlays(plays: boolean): void {
  if (readingPlays === plays) return;
  readingPlays = plays;
  if (foreground || !expired) return;
  if (!plays) {
    interruptWriting();
    return;
  }
  for (const task of tasks)
    if (task.state === "interrupted") task.state = "queued";
  fire(persist().then(kick));
}
/**
 * A download the owner started from the Download drawer (#109, ADR 0064). The
 * Provider is asked about before a task exists, so "Don't Allow" leaves nothing
 * behind. The press is the owner asking again, so an earlier no does not stand
 * in for the answer. Resolves true once the chapters are queued.
 */
export async function startDownload(
  document: string,
  voice: OfflineVoice,
  chapters: string[],
): Promise<boolean> {
  if (!preparationCurrent || !chapters.length || !settings) return false;
  voice = withFishModel(voice, voice.model ?? settings.fish.model);
  if (!usesCurrentModel(voice)) return false;
  const found = keyIsOffered(voice.provider)
    ? (await readProviderKey(voice.provider)).outcome === "found"
    : false;
  const recipient = providerRecipient(
    { ...settings, provider: voice.provider, voice: voice.voice },
    voice.provider,
    found,
  );
  // The Trial and the Unlock first (#148, ADR 0075): no Consent is asked for a
  // download that could not be written.
  if (!(await purchases.askForSpeech())) return false;
  consent.again(recipient.key);
  if (!(await consent.ensure(recipient))) return false;
  if (!usesCurrentModel(voice)) return false;
  await enqueue(document, voice, chapters);
  return true;
}
export async function enqueue(
  document: string,
  voice: OfflineVoice,
  chapters: string[],
): Promise<void> {
  if (!preparationCurrent || !chapters.length) return;
  voice = withFishModel(voice, voice.model ?? settings?.fish.model ?? DEFAULT_FISH_MODEL);
  if (!usesCurrentModel(voice)) return;
  const task = tasks.find(
    (t) => t.document === document && sameVoice(t.voice, voice),
  );
  if (task?.recheckHeld?.some((id) => chapters.includes(id))) {
    await (await offlineRepository()).catalog.allowRechecked(documentKey(document), voiceKey(voice), chapters);
    // A delete while permission was being saved must not resurrect its task.
    if ((task && !tasks.includes(task)) || !usesCurrentModel(voice)) return;
    await refreshRecheckHolds(document);
  }
  if (task) {
    // Chapters the owner paused stay paused: adding others is not resuming them (#56).
    task.chapters = [...new Set([...task.chapters, ...chapters])];
    task.paused = task.paused?.filter((id) => !chapters.includes(id));
    task.failed = [];
    task.state = "queued";
    task.error = null;
  } else
    tasks.push({
      id: `${Date.now()}-${Math.random()}`,
      document,
      voice,
      chapters,
      state: "queued",
      error: null,
      failed: [],
    });
  registerVoice(voice);
  const queued = tasks.find((t) => t.document === document && sameVoice(t.voice, voice))!;
  logDownload(task ? 'added to' : 'started', queued, `Download selected (${chapters.length} chosen)`);
  continueAway();
  fire(persist().then(kick));
}
/**
 * The download's complete chapters as far as the drawer's progress for its
 * voice knows them; the drawer asks for that progress while it is open, which
 * is when a ring or Pause all can be tapped.
 */
const completeIn = (task: DownloadTask) =>
  new Set(
    [...chapterProgress(task.document, task.voice).values()]
      .filter((chapter) => chapter.complete)
      .map((chapter) => chapter.id),
  );
/** Whether Pause all, rather than Resume all, is what the download offers (#56). */
export const goesOn = (task: DownloadTask) =>
  pausing.goesOn(task, completeIn(task));
/** Pause all while any chapter goes on by itself; otherwise Resume all, which is also Retry failed. */
export function toggleTask(task: DownloadTask): void {
  // A failed preparation check stays a failure, not a queued task whose save
  // clears the error while the scheduler still cannot run. Relaunch retries it.
  if (!preparationCurrent || !usesCurrentModel(task.voice)) return;
  if (goesOn(task)) { pausing.pauseAll(task); logDownload('paused', task, 'Pause all'); }
  else {
    // Resuming is asking for speech: while read-aloud is locked, the person is
    // asked first, and the resume happens only once it is allowed (#148).
    if (!purchases.canStartSpeech()) {
      void purchases.askForSpeech().then((yes) => { if (yes) toggleTask(task); });
      return;
    }
    // Resume all, or Retry failed: the owner asking again, so a Provider they
    // refused is asked about again as the download reaches it (#109).
    consent.again();
    pausing.resumeAll(task);
    logDownload('resumed', task, 'Resume all');
    continueAway();
  }
  fire(persist().then(kick));
}
/** A tap on one chapter's ring (#56); one that resumes may go on away from the screen. */
export function toggleChapter(task: DownloadTask, chapter: string): void {
  if (!preparationCurrent || !usesCurrentModel(task.voice) || task.recheckHeld?.includes(chapter)) return;
  const resumes =
    !pausing.GOES_ON.includes(task.state) || pausing.isPaused(task, chapter);
  // A ring that resumes is asking for speech, as Resume all is (#148).
  if (resumes && !purchases.canStartSpeech()) {
    void purchases.askForSpeech().then((yes) => { if (yes) toggleChapter(task, chapter); });
    return;
  }
  pausing.tapChapter(task, chapter, completeIn(task));
  logDownload(resumes ? 'resumed' : 'paused', task, `ring ${chapter}`);
  if (resumes) {
    consent.again();
    continueAway();
  }
  fire(persist().then(kick));
}
export async function deleteDownloaded(
  document: string,
  voice: OfflineVoice,
  chapters: string[],
): Promise<void> {
  const plan = planOf(document);
  if (!plan) return;
  const selected = new Set(chapters);
  for (const chapter of selected) {
    const key = JSON.stringify([
      document,
      narrationIdentity(voice),
      chapter,
    ]);
    deletionEpochs.set(key, (deletionEpochs.get(key) ?? 0) + 1);
  }
  for (const task of tasks)
    if (task.document === document && sameVoice(task.voice, voice)) {
      task.chapters = task.chapters.filter((id) => !selected.has(id));
      task.failed = task.failed.filter((id) => !selected.has(id));
      task.paused = task.paused?.filter((id) => !selected.has(id));
      if (!task.chapters.length) task.state = "done";
    }
  tasks = tasks.filter((task) => task.chapters.length > 0);
  await persist();
  const remaining = new Set(
    tasks
      .filter((t) => t.document === document && sameVoice(t.voice, voice))
      .flatMap((t) => t.chapters),
  );
  // Counts drop as soon as the audio is hidden; the files go afterwards.
  await (
    await offlineRepository()
  ).deleteChapters(document, voice, chapters, [...remaining], () =>
    refresh(document),
  );
}
/**
 * Everything saved for `document` in one Voice and, for Fish Audio, one Model,
 * and its Download of it ended: Manage downloads' Delete all current voice
 * audio (#306). Other Voices and Models, their Downloads and the plan stay.
 *
 * Dropping the task is what keeps an answer still out at the Provider from
 * being saved after the deletion: `fetch` keeps a result only while its task
 * is still in `tasks`.
 */
export async function removeVoiceDownloads(
  document: string,
  voice: OfflineVoice,
): Promise<void> {
  tasks = tasks.filter(
    (task) => task.document !== document || !sameVoice(task.voice, voice),
  );
  await persist();
  emit();
  await (
    await offlineRepository()
  ).removeVoice(document, voice, () => refresh(document));
  kick();
}
export async function removeDownloads(document: string): Promise<void> {
  tasks = tasks.filter((task) => task.document !== document);
  await persist();
  await (await offlineRepository()).removeDocument(document);
  plans.delete(document);
  inventories.delete(document);
  savedVoiceSnapshots.delete(document);
  indexing.delete(document);
  emit();
  kick();
}
async function loadPlan(
  document: string,
  title?: string,
): Promise<NarrationPlan | null> {
  if (plans.has(document)) return plans.get(document)!;
  if (!planJobs.has(document)) {
    const job = (async () => {
      const repository = await offlineRepository();
      let plan = await repository.plan(document);
      if (!plan && title) {
        const id = asDocumentId(document);
        if (!id) throw new Error("Invalid document identity.");
        const file = documentFile(id, "epub");
        const handle = file.open(FileMode.ReadOnly);
        try {
          plan = navigationPlan(
            readDocumentNavigation({
              size: file.size,
              read: (offset, length) => {
                handle.offset = offset;
                return handle.readBytes(length);
              },
            }),
          );
        } finally {
          handle.close();
        }
        await repository.savePlan(document, plan);
        plan = await repository.plan(document);
      }
      if (plan) plans.set(document, plan);
      return plan;
    })();
    planJobs.set(document, job);
    void job.finally(() => planJobs.delete(document)).catch(() => {});
  }
  return planJobs.get(document)!;
}
export function requestPlan(document: string, title: string): void {
  if (plans.has(document) || indexing.get(document)?.state === "preparing")
    return;
  indexing.set(document, { title, state: "preparing", count: 0 });
  emit();
  void loadPlan(document, title).then(
    () => {
      indexing.delete(document);
      emit();
      kick();
    },
    (error) => {
      indexing.set(document, {
        title,
        state: "failed",
        count: 0,
        error: String(error),
      });
      emit();
    },
  );
}
export const indexingState = (document: string) => indexing.get(document);
async function refreshRecheckHolds(document: string) {
  const catalog = (await offlineRepository()).catalog;
  for (const task of tasks.filter((t) => t.document === document)) {
    const held = await catalog.recheckHolds(documentKey(document), voiceKey(task.voice));
    if (DEBUG_MODE) for (const id of held.filter((id) => !task.recheckHeld?.includes(id))) {
      const progress = (await catalog.progress(documentKey(document), voiceKey(task.voice))).find((c) => c.id === id);
      const chapter = await catalog.chapter(documentKey(document), id);
      debugLog('offline', `Recheck ${shortId(document)} ${id} ${voiceFacts(task.voice)}: ${progress?.count ?? 0} / ${chapter?.textCount ?? 0}; needs Download selected, Resume all cannot fetch it`);
      const measure = recheckMeasures.get(document);
      if (measure) measure.lost++;
    }
    task.recheckHeld = held.length ? held : undefined;
  }
}
export function finishPreparation(token: number, chapters: Chapter[]): void {
  const request = preparation;
  if (!request || request.token !== token || request.saving) return;
  request.saving = true;
  void (async () => {
    try {
      const repository = await offlineRepository();
      if (preparation !== request) return;
      const current = settings;
      await repository.saveSection(request.document, request.section, chapters, (text) =>
        audioKey(downloadSpeech(text, current)),
      );
      if (speechKeying(settings) !== speechKeying(current)) void ensureSpeechKeys(true);
      // Publish holds before the scheduler can observe new text. This is also
      // done for a late save completed after backgrounding/preemption.
      await refreshRecheckHolds(request.document);
      const plan = await repository.plan(request.document);
      if (plan) plans.set(request.document, plan);
      for (const item of progressVoices.values()) if (item.document === request.document)
        requestProgress(item.document, item.voice);
      if (preparation !== request) return;
      preparation = null;
      emit();
      request.resolve();
      rechecks.wake();
    } catch (error) {
      failPreparation(token, String(error));
    }
  })();
}
export function failPreparation(token: number, error: string): void {
  if (!preparation || preparation.token !== token) return;
  const request = preparation;
  preparation = null;
  emit();
  request.reject(new Error(error));
}
