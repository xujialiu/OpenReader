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

export class OfflineRepository {
  private fileJobs = new Map<string, Promise<unknown>>();
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
    await this.cleanDeletions();
  }
  private async cleanDeletions(document?: string) {
    for (const audio of await this.catalog.pendingDeletes()) {
      if (document && audio.document !== document) continue;
      await this.files.remove(audio);
      await this.catalog.finishDelete(audio.document, audio.voice, audio.key);
    }
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
  ): Promise<SynthesisResult | null> {
    const address = this.address(document, voice, text);
    if (
      await this.catalog.isDeleting(
        address.document,
        address.voice,
        address.key,
      )
    )
      return null;
    const audio = await this.catalog.getClip(
      address.document,
      address.voice,
      address.key,
    );
    if (!audio) return null;
    const clip = await this.files.read(audio);
    if (!clip) {
      await this.catalog.finishDelete(
        address.document,
        address.voice,
        address.key,
      );
      return null;
    }
    return clip;
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
    return this.serialize(document, async () => {
      if (!wanted()) return false;
      await this.rememberVoice(document, voice);
      const address = this.address(document, voice, text);
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
  async saveSection(document: string, section: number, chapters: Chapter[]) {
    const prepared: PreparedChapter[] = [];
    for (const chapter of chapters) {
      const keys: string[] = [];
      for (let i = 0; i < chapter.texts.length; i++) {
        keys.push(audioKey(chapter.texts[i]));
        if (i % 128 === 127)
          await new Promise((resolve) => setTimeout(resolve, 0));
      }
      prepared.push({ ...chapter, keys });
    }
    await this.catalog.saveSection(documentKey(document), section, prepared);
  }
  async progress(document: string, voice: OfflineVoice) {
    return this.catalog.progress(documentKey(document), voiceKey(voice));
  }
  async deleteChapters(
    document: string,
    voice: OfflineVoice,
    selected: string[],
    keep: string[],
  ) {
    const key = documentKey(document);
    await this.catalog.beginDelete(key, voiceKey(voice), selected, keep);
    await this.serialize(document, () => this.cleanDeletions(key));
  }
  async removeDocument(document: string) {
    await this.inventory(document);
    const key = documentKey(document);
    await this.catalog.removeDocument(key);
    await this.serialize(document, async () => {
      await this.cleanDeletions(key);
      await this.files.removeDocumentFiles(key);
    });
  }
}
