import type { SynthesisResult } from "../core/providers/types";
import { audioAddress, audioKey, documentKey, voiceKey } from "./catalog-keys";
import {
  OfflineCatalog,
  type AudioAddress,
  type StoredAudio,
  type PreparedChapter,
} from "./catalog";
import type {
  Chapter,
  DownloadTask,
  NarrationPlan,
  OfflineVoice,
} from "./model";

/** Audio payloads and interrupted-write recovery. Availability comes from SQLite. */
export interface AudioFiles {
  lookup(address: AudioAddress): Promise<StoredAudio | null>;
  present(audio: StoredAudio): Promise<boolean>;
  read(audio: StoredAudio): Promise<SynthesisResult | null>;
  write(
    document: string,
    voice: OfflineVoice,
    text: string,
    clip: SynthesisResult,
    wanted: () => boolean,
  ): Promise<boolean>;
  remove(address: AudioAddress): Promise<void>;
  cleanTemporary(address: AudioAddress): Promise<void>;
  removeDocumentFiles(documentKey: string): Promise<void>;
}

/** Rows one DELETE takes. A JSON array of this many keys is about 34 KB. */
const DELETE_BATCH = 500;

/**
 * A saved clip, or none, and whether looking for it changed the saved audio.
 *
 * `dropped` is true only for a record whose file had gone, which the read drops:
 * the one read that changes what is saved, and so the one miss after which the
 * inventory is worth reading again (#47). A plain miss, which is every sentence
 * that was never downloaded, changes nothing.
 */
export type SavedClipRead =
  | { clip: SynthesisResult; dropped: false }
  | { clip: null; dropped: boolean };

const MISS: SavedClipRead = { clip: null, dropped: false };

export class OfflineRepository {
  private fileJobs = new Map<string, Promise<unknown>>();
  /**
   * Settles once the deletions found by the last `recover()` have removed their
   * files and rows. Reads already leave a `deleting` row out, so nothing waits
   * for this: the store answers as soon as pending writes are settled, and an
   * interrupted deletion finishes here rather than in front of the first clip.
   */
  cleanup: Promise<void> = Promise.resolve();
  constructor(
    readonly catalog: OfflineCatalog,
    private readonly files: AudioFiles,
  ) {}
  private address(
    document: string,
    voice: OfflineVoice,
    text: string,
  ): AudioAddress {
    return audioAddress(document, voice, text);
  }
  /** File work for one document runs in order. Keyed by the document's key, so recovery, which knows only keys, joins the same queue. */
  private serialize<T>(document: string, run: () => Promise<T>): Promise<T> {
    const job = (this.fileJobs.get(document) ?? Promise.resolve()).then(run);
    this.fileJobs.set(
      document,
      job.catch(() => {}),
    );
    return job;
  }
  async recover() {
    for (const job of await this.catalog.pendingWrites()) {
      await this.files.cleanTemporary(job);
      const audio = await this.files.lookup(job);
      if (job.cancelled || !audio) await this.files.remove(job);
      else if (audio) await this.catalog.commitWrite(audio);
      await this.catalog.finishWrite(job.document, job.voice, job.key);
    }
    this.cleanup = this.cleanDeletions();
    // Seen by whoever awaits `cleanup`; not an unhandled rejection otherwise.
    void this.cleanup.catch(() => {});
  }
  /**
   * Files first, rows after, one statement per batch rather than one transaction
   * per clip. A crash between the two leaves `deleting` rows whose files are
   * already gone; the next cleanup removes nothing and drops them.
   */
  private async cleanDeletions(only?: string) {
    for (const document of await this.catalog.removals()) {
      if (only && document !== only) continue;
      await this.serialize(document, async () => {
        await this.files.removeDocumentFiles(document);
        await this.catalog.finishRemoval(document);
      });
    }
    const groups = new Map<string, StoredAudio[]>();
    for (const audio of await this.catalog.pendingDeletes()) {
      if (only && audio.document !== only) continue;
      const key = JSON.stringify([audio.document, audio.voice]);
      let group = groups.get(key);
      if (!group) groups.set(key, (group = []));
      group.push(audio);
    }
    for (const group of groups.values())
      await this.serialize(group[0].document, async () => {
        for (const audio of group) await this.files.remove(audio);
        for (let at = 0; at < group.length; at += DELETE_BATCH)
          await this.catalog.finishDeletes(
            group[0].document,
            group[0].voice,
            group.slice(at, at + DELETE_BATCH).map((audio) => audio.key),
          );
      });
  }
  async tasks(): Promise<DownloadTask[]> {
    return (await this.catalog.readTasks()) ?? [];
  }
  rememberVoice(document: string, voice: OfflineVoice) {
    return this.catalog.rememberVoice(
      documentKey(document),
      voiceKey(voice),
      voice,
    );
  }
  savedVoices(document: string) {
    return this.catalog.savedVoices(documentKey(document));
  }
  async inventory(document: string) {
    return this.catalog.voices(documentKey(document));
  }
  async readClip(
    document: string,
    voice: OfflineVoice,
    text: string,
  ): Promise<SavedClipRead> {
    const address = this.address(document, voice, text);
    if (
      await this.catalog.isDeleting(
        address.document,
        address.voice,
        address.key,
      )
    )
      return MISS;
    const audio = await this.catalog.getClip(
      address.document,
      address.voice,
      address.key,
    );
    if (!audio) return MISS;
    const clip = await this.files.read(audio);
    if (!clip) {
      await this.catalog.finishDelete(
        address.document,
        address.voice,
        address.key,
      );
      return { clip: null, dropped: true };
    }
    return { clip, dropped: false };
  }
  async hasClip(
    document: string,
    voice: OfflineVoice,
    text: string,
  ): Promise<boolean> {
    const address = this.address(document, voice, text);
    if (
      await this.catalog.isDeleting(
        address.document,
        address.voice,
        address.key,
      )
    )
      return false;
    const audio = await this.catalog.getClip(
      address.document,
      address.voice,
      address.key,
    );
    if (!audio) return false;
    if (!(await this.files.present(audio))) {
      await this.catalog.finishDelete(
        address.document,
        address.voice,
        address.key,
      );
      return false;
    }
    return true;
  }
  async saveClip(
    document: string,
    voice: OfflineVoice,
    text: string,
    clip: SynthesisResult,
    wanted: () => boolean,
  ): Promise<boolean> {
    const address = this.address(document, voice, text);
    return this.serialize(address.document, async () => {
      if (!wanted()) return false;
      await this.rememberVoice(document, voice);
      await this.catalog.beginWrite(
        address.document,
        address.voice,
        address.key,
      );
      if (!(await this.files.write(document, voice, text, clip, wanted))) {
        await this.catalog.finishWrite(
          address.document,
          address.voice,
          address.key,
        );
        return false;
      }
      if (!wanted()) {
        await this.files.remove(address);
        await this.catalog.finishWrite(
          address.document,
          address.voice,
          address.key,
        );
        return false;
      }
      const audio = await this.files.lookup(address);
      if (!audio) throw new Error("The saved audio could not be verified.");
      if (!(await this.catalog.commitWrite(audio))) {
        await this.files.remove(address);
        await this.catalog.finishWrite(
          address.document,
          address.voice,
          address.key,
        );
        return false;
      }
      return true;
    });
  }
  async plan(document: string): Promise<NarrationPlan | null> {
    return this.catalog.plan(documentKey(document));
  }
  async savePlan(document: string, plan: NarrationPlan) {
    const key = documentKey(document);
    await this.catalog.savePlan(key, plan);
  }
  async chapter(document: string, id: string) {
    return this.catalog.chapter(documentKey(document), id);
  }
  /**
   * A chapter's texts are the Utterances' own; its membership keys name the
   * Speech Text each one is saved under, which is what `keyOf` computes (#25).
   * Left out, a text is its own Speech Text.
   */
  async saveSection(document: string, section: number, chapters: Chapter[], keyOf: (text: string) => string = audioKey) {
    const prepared: PreparedChapter[] = [];
    for (const chapter of chapters) {
      const keys: string[] = [];
      for (let i = 0; i < chapter.texts.length; i++) {
        keys.push(keyOf(chapter.texts[i]));
        if (i % 128 === 127)
          await new Promise((resolve) => setTimeout(resolve, 0));
      }
      prepared.push({ ...chapter, keys });
    }
    await this.catalog.saveSection(documentKey(document), section, prepared);
  }
  /**
   * Every prepared chapter's membership keys computed again from its stored
   * texts, and the setting they now answer to recorded (#25).
   *
   * Run when the bracket setting differs from the one the keys were computed
   * under. It is design 0028's promise kept: after a change a downloaded
   * chapter needs downloading again, because its sentences are now named by
   * their new Speech Text, and switching back makes the old audio count again
   * without a byte of it having moved. One chapter per transaction, so a book
   * of two thousand chapters does not hold the store for the whole walk; an
   * interrupted walk leaves the old record, and the next start walks again.
   */
  async rekey(keyOf: (text: string) => string, keying: string) {
    for (const { document, id } of await this.catalog.preparedChapters()) {
      const chapter = await this.catalog.chapter(document, id);
      if (!chapter) continue;
      const keys: string[] = [];
      for (let i = 0; i < chapter.texts.length; i++) {
        keys.push(keyOf(chapter.texts[i]));
        if (i % 128 === 127)
          await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await this.catalog.rekeyChapter(document, id, keys);
    }
    await this.catalog.recordSpeechKeying(keying);
  }
  async progress(document: string, voice: OfflineVoice) {
    return this.catalog.progress(documentKey(document), voiceKey(voice));
  }
  /**
   * The selected chapters' audio stops being offered in the marking transaction.
   * `hidden` runs then, before the files and rows go, so a screen can show the
   * drop without waiting for the removal to finish.
   */
  async deleteChapters(
    document: string,
    voice: OfflineVoice,
    selected: string[],
    keep: string[],
    hidden?: () => Promise<void> | void,
  ) {
    const key = documentKey(document);
    await this.catalog.beginDelete(key, voiceKey(voice), selected, keep);
    await hidden?.();
    await this.cleanDeletions(key);
  }
  async removeDocument(document: string) {
    const key = documentKey(document);
    await this.catalog.removeDocument(key);
    await this.cleanDeletions(key);
  }
}
