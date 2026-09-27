import { AppState, Platform } from "react-native";
import { useSyncExternalStore } from "react";
import { FileMode } from "expo-file-system";
import { asDocumentId } from "../core/document";
import {
  readDocumentNavigation,
  type ChapterMetadata,
} from "../core/document/navigation";
import { documentFile } from "../app/library";
import { offlineNative } from "../../modules/open-reader-offline";
import { createMemoryCache } from "../core/memory-cache";
import { createProvider } from "../core/providers/factory";
import { SynthesisError } from "../core/providers/errors";
import type {
  ProviderId,
  SynthesisResult,
  TTSProvider,
} from "../core/providers/types";
import { withTimeout } from "../core/timeout";
import { readGatewayHeaders, readProviderKey } from "../keys/store";
import {
  clipCacheKey,
  toStored,
  type StoredClip,
} from "../playback/clip-cache";
import {
  headersAreOffered,
  keepWarm,
  keyIsOffered,
  providerDeps,
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
} from "./continued-processing";
import { APP_NAME } from "../../app-name";
import { offlineRepository } from "./database";
import { audioKey, voiceKey } from "./catalog-keys";
import { downloadSpeech, speechKeying } from "./speech";
import type { ChapterProgress, VoiceInventory } from "./catalog";

let revision = 0;
let tasks: DownloadTask[] = [];
let settings: AppSettings;
let loaded = false;
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
      task: DownloadTask;
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
    : null);
function cancelInactivePreparation() {
  if (
    preparation &&
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
  abandoned.reject(new PreparationInterrupted());
}
const keyOf = (document: string, voice: OfflineVoice, text: string) =>
  JSON.stringify([document, clipCacheKey(voice.provider, voice.voice, text)]);
const emit = () => {
  revision++;
  listeners.forEach((listener) => listener());
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
export const downloadsReady = () => loaded;
export const downloadTasks = (document: string) =>
  tasks.filter((t) => t.document === document);
export const planOf = (document: string): NarrationPlan | null =>
  plans.get(document) ?? null;
const voiceIdentity = (voice: Pick<OfflineVoice, "provider" | "voice">) =>
  JSON.stringify([voice.provider, voice.voice]);
const registerVoice = (voice: Pick<OfflineVoice, "provider" | "voice">) => {
  const identity = voiceIdentity(voice);
  if (!voiceHashes.has(identity)) voiceHashes.set(identity, voiceKey(voice));
};
const progressKey = (document: string, voice: OfflineVoice) =>
  JSON.stringify([document, voice.provider, voice.voice]);
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
  voice?: Pick<OfflineVoice, "provider" | "voice">,
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
export function chapterProgress(
  document: string,
  voice: OfflineVoice,
): ReadonlyMap<string, ChapterProgress> {
  return progressSnapshots.get(progressKey(document, voice)) ?? new Map();
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
  a.provider === b.provider && a.voice === b.voice;
export function hasSavedVoice(
  document: string,
  provider: ProviderId,
  voice: string,
): boolean {
  const key = voiceHashes.get(voiceIdentity({ provider, voice }));
  return !!inventories
    .get(document)
    ?.some((item) => item.voice === key && item.count > 0);
}
export function savedVoices(document: string): OfflineVoice[] {
  return savedVoiceSnapshots.get(document) ?? [];
}
export function occupied(document: string, voice?: OfflineVoice): number {
  const key = voice ? voiceHashes.get(voiceIdentity(voice)) : null;
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
      const ready = readiness(configured, keyResult?.outcome === "found");
      if (!ready.ready)
        throw new SynthesisError(
          "no-key",
          readinessSentence(voice.provider, ready.missing),
        );
      const configuration = providerSettings(configured, {
        key: keyResult?.outcome === "found" ? keyResult.secret : "",
        headers: headers?.outcome === "found" ? headers.secret : "",
      });
      // Speechify queues its own requests, so a download's number has to
      // reach its queue as well as the scheduler (#64), and so does whose
      // request it is: a Reading's goes ahead of a download's still waiting
      // (#75). A Reading's is one at a time.
      const speechify = download
        ? { ...configuration.speechify, atOnce: download.atOnce, download: true }
        : configuration.speechify;
      const provider = createProvider(
        voice.provider,
        { ...configuration, speechify },
        providerDeps,
      );
      const controller = new AbortController();
      const result = await withTimeout(
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
      await memory.put(key, toStored(result));
      return result;
    })();
    flights.set(key, flight);
    void flight.catch(() => {}).finally(() => flights.delete(key));
  }
  return flight;
}
export function offlineProvider(
  document: string,
  current: AppSettings,
): TTSProvider {
  return {
    id: current.provider,
    capabilities: {
      wordTimestamps: ["azure", "fish", "speechify", "local"].includes(current.provider),
    },
    listVoices: async () => [],
    synthesize: (text, options) =>
      synthesize(
        document,
        {
          provider: current.provider,
          voice: options.voice,
          label: options.voice,
        },
        text,
        current,
      ),
  };
}

const scheduler = createScheduler({
  tasks: () => tasks,
  plan: (document) => loadPlan(document),
  connected: () => online,
  // Not held back while a Reading plays (#75): a Reading keeps its precedence
  // where requests are queued in the app, which is Speechify's queue alone.
  // Away from the screen, the end of the background time stops a download
  // only once no Reading keeps the app running.
  allowed: () =>
    loaded && !storeError && (foreground || !expired || readingPlays),
  // Where the hidden rendering prepares a chapter's text (#76).
  foreground: () => AppState.currentState === "active",
  changed: persist,
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
    const section = chapter.section;
    if (section === null || section === undefined)
      throw new Error("This chapter does not identify a document section.");
    const plan = planOf(task.document)!;
    const held = plan.chapters.find((c) => c.id === chapter.id)!;
    if (held.prepared !== false) return held;
    await new Promise<void>((resolve, reject) => {
      rendererDocument = task.document;
      preparation = {
        token: ++preparationSerial,
        document: task.document,
        section,
        task,
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
    });
    return planOf(task.document)!.chapters.find((c) => c.id === chapter.id)!;
  },
  fetch: async (task, text, chapter) => {
    const key = JSON.stringify([
      task.document,
      task.voice.provider,
      task.voice.voice,
      chapter,
    ]);
    const epoch = deletionEpochs.get(key) ?? 0;
    const speech = downloadSpeech(text, settings);
    const clip = await synthesize(task.document, task.voice, speech, settings, { atOnce: settings.sentencesAtOnce[task.voice.provider] });
    // A paused task can keep its paid in-flight result; a removed chapter cannot.
    const wanted = () =>
      tasks.includes(task) &&
      task.chapters.includes(chapter) &&
      (deletionEpochs.get(key) ?? 0) === epoch;
    if (!wanted()) return;
    if (
      !(await (
        await offlineRepository()
      ).saveClip(task.document, task.voice, speech, clip, wanted))
    )
      return;
    await refresh(task.document);
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
/** The names the Library shows, which the Live Activity shows for a download away from the screen. */
const documentTitles = new Map<string, string>();
export function nameDocuments(
  entries: readonly { id: string; title: string }[],
): void {
  let renamed = false;
  for (const { id, title } of entries)
    if (documentTitles.get(id) !== title) {
      documentTitles.set(id, title);
      renamed = true;
    }
  if (renamed) continued.follow();
}
/** ADR 0052: the continued processing task a download away from the screen runs under. */
const continued = createContinuedProcessing({
  native: offlineNative,
  tasks: () => tasks,
  shown: async (task) =>
    continuedShown(
      task,
      documentTitles.get(task.document) ?? APP_NAME,
      await (await offlineRepository()).progress(task.document, task.voice),
      planOf(task.document),
    ),
});
const runsAway = () =>
  tasks.some((task) =>
    ["preparing", "downloading", "queued"].includes(task.state),
  );
/** Today's bounded background time, where no continued task keeps the app running. */
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
 * The owner started or resumed a download, on the screen: it may go on away
 * from it. Only here, because Apple asks for the submission to follow a
 * person's action; a launch or a return to the app never submits.
 */
function continueAway() {
  if (!foreground) return;
  void continued.start().then((running) => {
    if (!running && !foreground && runsAway()) beginBounded();
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
const kick = () => {
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
export function configureDownloads(next: AppSettings): void {
  const rekey = !!settings && speechKeying(settings) !== speechKeying(next);
  settings = next;
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
export function startDownloads(): () => void {
  if (!loaded && !starting) {
    starting = (async () => {
      tasks = await (await offlineRepository()).tasks();
      tasks.forEach((task) => registerVoice(task.voice));
      for (const task of tasks)
        if (
          ["preparing", "downloading", "interrupted", "waiting"].includes(
            task.state,
          )
        )
          task.state = "queued";
      loaded = true;
      await persist();
      // Before the first run, so the scheduler never trusts keys computed under
      // a setting the owner has since changed.
      await ensureSpeechKeys();
      kick();
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
          if (task.state === "waiting") task.state = "queued";
      emit();
      kick();
    },
  );
  const expiration = offlineNative?.addListener("expired", interruptAway);
  // The phone ended the continued task, under pressure or at the owner's stop
  // in the Live Activity; the two cannot be told apart. On the screen the
  // download needs no task and goes on.
  const continuedExpiration = offlineNative?.addListener(
    "continuedExpired",
    () => {
      continued.expired();
      if (!foreground) interruptAway();
    },
  );
  const state = AppState.addEventListener("change", (value) => {
    foreground = value === "active";
    if (foreground) {
      expired = false;
      void offlineNative?.endBackground();
      for (const task of tasks)
        if (task.state === "interrupted") task.state = "queued";
      fire(persist().then(kick));
    } else if (!continued.holding() && runsAway()) beginBounded();
  });
  const leaving = AppState.addEventListener("change", (value) => {
    if (value !== "active") abandonPreparation();
  });
  // Without a platform connectivity observer, periodically retry only connectivity failures.
  const timer = Platform.OS !== "ios" ? setInterval(kick, 5000) : null;
  kick();
  return () => {
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
export function enqueue(
  document: string,
  voice: OfflineVoice,
  chapters: string[],
): void {
  if (!chapters.length) return;
  const task = tasks.find(
    (t) => t.document === document && sameVoice(t.voice, voice),
  );
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
  if (goesOn(task)) pausing.pauseAll(task);
  else {
    pausing.resumeAll(task);
    continueAway();
  }
  fire(persist().then(kick));
}
/** A tap on one chapter's ring (#56); one that resumes may go on away from the screen. */
export function toggleChapter(task: DownloadTask, chapter: string): void {
  const resumes =
    !pausing.GOES_ON.includes(task.state) || pausing.isPaused(task, chapter);
  pausing.tapChapter(task, chapter, completeIn(task));
  if (resumes) continueAway();
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
      voice.provider,
      voice.voice,
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
export function finishPreparation(token: number, chapters: Chapter[]): void {
  const request = preparation;
  if (!request || request.token !== token) return;
  void (async () => {
    try {
      const repository = await offlineRepository();
      if (preparation !== request) return;
      const current = settings;
      await repository.saveSection(request.document, request.section, chapters, (text) =>
        audioKey(downloadSpeech(text, current)),
      );
      if (speechKeying(settings) !== speechKeying(current)) void ensureSpeechKeys(true);
      const plan = await repository.plan(request.document);
      if (preparation !== request) return;
      if (plan) plans.set(request.document, plan);
      preparation = null;
      emit();
      request.resolve();
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
