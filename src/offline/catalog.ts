/** Offline metadata queries. Audio files and platform APIs stay outside this module. */
import type {
  Chapter,
  DownloadTask,
  NarrationPlan,
  OfflineVoice,
} from "./model";
export type SqlValue = string | number | null;
export interface SqlSession {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: SqlValue[]): Promise<unknown>;
  getAllAsync<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
}
export interface SqlDatabase extends SqlSession {
  withExclusiveTransactionAsync(
    run: (transaction: SqlSession) => Promise<void>,
  ): Promise<void>;
}
export interface StoredAudio {
  document: string;
  voice: string;
  key: string;
  path: string;
  format: "alac" | "gzip-pcm" | "encoded";
  size: number;
  sampleRate?: number;
  mediaType?: string;
  timestamps?: {
    start: number;
    end: number;
    charStart: number;
    charEnd: number;
  }[];
}
export interface VoiceInventory {
  voice: string;
  count: number;
  bytes: number;
}
export interface ChapterProgress {
  id: string;
  count: number;
  complete: boolean;
}
export interface PreparedChapter extends Chapter {
  keys: string[];
}
export interface AudioAddress {
  document: string;
  voice: string;
  key: string;
}
export interface PendingWrite extends AudioAddress {
  cancelled: number;
}

export class OfflineCatalog {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly db: SqlDatabase) {}
  async initialize() {
    const [version] = await this.db.getAllAsync<{ user_version: number }>(
      "PRAGMA user_version",
    );
    if (version.user_version > 1)
      throw new Error("Update the app to read this offline database.");
    await this.db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS clips (
        document TEXT NOT NULL, voice TEXT NOT NULL, key TEXT NOT NULL,
        path TEXT NOT NULL, size INTEGER NOT NULL, metadata TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'ready', PRIMARY KEY(document, voice, key)
      );
      CREATE INDEX IF NOT EXISTS clips_inventory ON clips(document, voice, state);
      CREATE TABLE IF NOT EXISTS plans(document TEXT PRIMARY KEY, version INTEGER NOT NULL, sections TEXT, prepared_sections TEXT);
      CREATE TABLE IF NOT EXISTS chapters(
        document TEXT NOT NULL, id TEXT NOT NULL, ordinal INTEGER NOT NULL, title TEXT NOT NULL,
        parent TEXT, depth INTEGER NOT NULL, section INTEGER, fragment TEXT, prepared INTEGER NOT NULL,
        texts TEXT NOT NULL, text_count INTEGER NOT NULL, PRIMARY KEY(document,id)
      );
      CREATE TABLE IF NOT EXISTS memberships(document TEXT NOT NULL,chapter TEXT NOT NULL,
        ordinal INTEGER NOT NULL,clip_key TEXT NOT NULL,PRIMARY KEY(document,chapter,ordinal));
      CREATE INDEX IF NOT EXISTS memberships_clip ON memberships(document,clip_key);
      CREATE TABLE IF NOT EXISTS state(name TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS writes(document TEXT NOT NULL,voice TEXT NOT NULL,key TEXT NOT NULL,cancelled INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(document,voice,key));
      CREATE TABLE IF NOT EXISTS voices(document TEXT NOT NULL,key TEXT NOT NULL,provider TEXT NOT NULL,voice_id TEXT NOT NULL,label TEXT NOT NULL,PRIMARY KEY(document,key));
      CREATE TABLE IF NOT EXISTS removals(document TEXT PRIMARY KEY);
      PRAGMA user_version = 1;
    `);
  }
  private write<T>(run: (transaction: SqlSession) => Promise<T>): Promise<T> {
    const result = this.writes.then(async () => {
      let value!: T;
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        value = await run(tx);
      });
      return value;
    });
    this.writes = result.catch(() => {});
    return result;
  }
  async getClip(
    document: string,
    voice: string,
    key: string,
  ): Promise<StoredAudio | null> {
    const rows = await this.db.getAllAsync<{ metadata: string }>(
      "SELECT metadata FROM clips WHERE document=? AND voice=? AND key=? AND state='ready'",
      document,
      voice,
      key,
    );
    return rows[0] ? (JSON.parse(rows[0].metadata) as StoredAudio) : null;
  }
  voices(document: string): Promise<VoiceInventory[]> {
    return this.db.getAllAsync(
      `SELECT voice, COUNT(*) AS count, SUM(size) AS bytes FROM clips WHERE document=? AND state='ready' GROUP BY voice ORDER BY voice`,
      document,
    );
  }
  async savePlan(document: string, plan: NarrationPlan) {
    if (plan.chapters.some((chapter) => chapter.texts.length > 0))
      throw new Error(
        "Save prepared text and membership together through saveSection.",
      );
    const json = JSON.stringify(plan);
    await this.write(async (tx) => {
      if (
        (await tx.getAllAsync("SELECT 1 FROM plans WHERE document=?", document))
          .length
      )
        return;
      const [header] = await tx.getAllAsync<{ version: number; kind: string }>(
        "SELECT json_extract(?, '$.version') AS version,json_type(?, '$.chapters') AS kind",
        json,
        json,
      );
      if (header?.version !== 2 || header.kind !== "array")
        throw new Error("Unsupported narration plan.");
      // Bulk metadata insertion executes in SQLite. No file probes are made here.
      await tx.runAsync(
        `INSERT INTO plans SELECT ?,json_extract(?,'$.version'),json_extract(?,'$.sections'),json_extract(?,'$.preparedSections')`,
        document,
        json,
        json,
        json,
      );
      await tx.runAsync(
        `INSERT INTO chapters
        SELECT ?,json_extract(value,'$.id'),CAST(key AS INTEGER),json_extract(value,'$.title'),json_extract(value,'$.parent'),
          json_extract(value,'$.depth'),json_extract(value,'$.section'),json_extract(value,'$.fragment'),
          COALESCE(json_extract(value,'$.prepared'),1),json_extract(value,'$.texts'),json_array_length(value,'$.texts')
        FROM json_each(?, '$.chapters')`,
        document,
        json,
      );
    });
  }
  async plan(document: string): Promise<NarrationPlan | null> {
    const [row] = await this.db.getAllAsync<{
      version: 2;
      sections: string | null;
      prepared_sections: string | null;
    }>(
      "SELECT version,sections,prepared_sections FROM plans WHERE document=?",
      document,
    );
    if (!row) return null;
    const chapters = await this.db.getAllAsync<Chapter>(
      `SELECT id,title,parent,depth,section,fragment,prepared,text_count AS textCount FROM chapters WHERE document=? ORDER BY ordinal`,
      document,
    );
    return {
      version: row.version,
      chapters: chapters.map((c) => ({
        ...c,
        prepared: !!c.prepared,
        texts: [],
        textsLoaded: false,
      })),
      ...(row.sections ? { sections: JSON.parse(row.sections) } : {}),
      ...(row.prepared_sections
        ? { preparedSections: JSON.parse(row.prepared_sections) }
        : {}),
    };
  }
  async chapter(document: string, id: string): Promise<Chapter | null> {
    const [row] = await this.db.getAllAsync<
      Omit<Chapter, "texts"> & { texts: string }
    >(
      "SELECT id,title,parent,depth,section,fragment,prepared,text_count AS textCount,texts FROM chapters WHERE document=? AND id=?",
      document,
      id,
    );
    return row
      ? {
          ...row,
          prepared: !!row.prepared,
          texts: JSON.parse(row.texts),
          textsLoaded: true,
        }
      : null;
  }
  async progress(document: string, voice: string): Promise<ChapterProgress[]> {
    const rows = await this.db.getAllAsync<{
      id: string;
      count: number;
      complete: number;
    }>(
      `
      SELECT ch.id,COUNT(c.key) AS count,
        ch.prepared AND ch.text_count>0 AND COUNT(c.key)=ch.text_count AS complete
      FROM chapters ch
      LEFT JOIN memberships m ON m.document=ch.document AND m.chapter=ch.id
      LEFT JOIN clips c ON c.document=m.document AND c.voice=? AND c.key=m.clip_key AND c.state='ready'
      WHERE ch.document=? GROUP BY ch.id ORDER BY ch.ordinal`,
      voice,
      document,
    );
    return rows.map((row) => ({
      ...row,
      complete: !!row.complete,
    }));
  }
  async beginDelete(
    document: string,
    voice: string,
    selected: string[],
    keep: string[],
  ) {
    await this.write(async (tx) => {
      const filter = `WHERE document=? AND voice=?
      AND key IN(SELECT clip_key FROM memberships WHERE document=? AND chapter IN(SELECT value FROM json_each(?)))
      AND key NOT IN(SELECT clip_key FROM memberships WHERE document=? AND chapter IN(SELECT value FROM json_each(?)))`;
      const params = [
        document,
        voice,
        document,
        JSON.stringify(selected),
        document,
        JSON.stringify(keep),
      ];
      await tx.runAsync(
        `UPDATE clips SET state='deleting' ${filter}`,
        ...params,
      );
      await tx.runAsync(`UPDATE writes SET cancelled=1 ${filter}`, ...params);
    });
  }
  async pendingDeletes(): Promise<StoredAudio[]> {
    const rows = await this.db.getAllAsync<{ metadata: string }>(
      "SELECT metadata FROM clips WHERE state='deleting'",
    );
    return rows.map((row) => JSON.parse(row.metadata) as StoredAudio);
  }
  async isDeleting(
    document: string,
    voice: string,
    key: string,
  ): Promise<boolean> {
    return (
      (
        await this.db.getAllAsync(
          "SELECT 1 FROM clips WHERE document=? AND voice=? AND key=? AND state='deleting'",
          document,
          voice,
          key,
        )
      ).length > 0
    );
  }
  async finishDelete(document: string, voice: string, key: string) {
    await this.write((tx) =>
      tx.runAsync(
        "DELETE FROM clips WHERE document=? AND voice=? AND key=?",
        document,
        voice,
        key,
      ),
    );
  }
  async readTasks(): Promise<DownloadTask[] | null> {
    const [row] = await this.db.getAllAsync<{ value: string }>(
      "SELECT value FROM state WHERE name='tasks'",
    );
    return row ? (JSON.parse(row.value) as DownloadTask[]) : null;
  }
  async saveTasks(tasks: DownloadTask[]) {
    const snapshot = JSON.stringify(tasks);
    await this.write((tx) =>
      tx.runAsync(
        "INSERT INTO state VALUES('tasks',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
        snapshot,
      ),
    );
  }
  async saveSection(
    document: string,
    section: number,
    chapters: PreparedChapter[],
  ) {
    if (
      chapters.some((chapter) => chapter.keys.length !== chapter.texts.length)
    )
      throw new Error("Every prepared text must have one membership key.");
    await this.write(async (tx) => {
      for (const chapter of await tx.getAllAsync<{ id: string }>(
        "SELECT id FROM chapters WHERE document=? AND section=?",
        document,
        section,
      )) {
        const content = chapters.find((c) => c.id === chapter.id);
        await tx.runAsync(
          `UPDATE chapters SET texts=?,text_count=?,prepared=1,title=CASE WHEN id LIKE 'section-%' THEN COALESCE(?,title) ELSE title END WHERE document=? AND id=?`,
          JSON.stringify(content?.texts ?? []),
          content?.texts.length ?? 0,
          content?.title ?? null,
          document,
          chapter.id,
        );
        await tx.runAsync(
          "DELETE FROM memberships WHERE document=? AND chapter=?",
          document,
          chapter.id,
        );
        await tx.runAsync(
          "INSERT INTO memberships SELECT ?,?,CAST(key AS INTEGER),value FROM json_each(?)",
          document,
          chapter.id,
          JSON.stringify(content?.keys ?? []),
        );
      }
      const [row] = await tx.getAllAsync<{ prepared_sections: string | null }>(
        "SELECT prepared_sections FROM plans WHERE document=?",
        document,
      );
      const sections: number[] = row?.prepared_sections
        ? JSON.parse(row.prepared_sections)
        : [];
      await tx.runAsync(
        "UPDATE plans SET prepared_sections=? WHERE document=?",
        JSON.stringify(
          [...new Set([...sections, section])].sort((a, b) => a - b),
        ),
        document,
      );
    });
  }
  async removeDocument(document: string) {
    await this.write(async (tx) => {
      await tx.runAsync(
        "UPDATE clips SET state='deleting' WHERE document=?",
        document,
      );
      await tx.runAsync(
        "UPDATE writes SET cancelled=1 WHERE document=?",
        document,
      );
      for (const table of ["memberships", "chapters", "plans", "voices"])
        await tx.runAsync(`DELETE FROM ${table} WHERE document=?`, document);
      // The document's directory goes as one; per-clip removal is for chapters.
      await tx.runAsync("INSERT OR IGNORE INTO removals VALUES(?)", document);
    });
  }
  async removals(): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ document: string }>(
      "SELECT document FROM removals",
    );
    return rows.map((row) => row.document);
  }
  async finishRemoval(document: string) {
    await this.write(async (tx) => {
      await tx.runAsync(
        "DELETE FROM clips WHERE document=? AND state='deleting'",
        document,
      );
      await tx.runAsync("DELETE FROM removals WHERE document=?", document);
    });
  }
  /** One statement for a batch whose files are already gone. Rows left by a crash before it are found and dropped by the next cleanup. */
  async finishDeletes(document: string, voice: string, keys: string[]) {
    if (!keys.length) return;
    await this.write((tx) =>
      tx.runAsync(
        "DELETE FROM clips WHERE document=? AND voice=? AND state='deleting' AND key IN(SELECT value FROM json_each(?))",
        document,
        voice,
        JSON.stringify(keys),
      ),
    );
  }
  async beginWrite(document: string, voice: string, key: string) {
    await this.write((tx) =>
      tx.runAsync(
        "INSERT INTO writes VALUES(?,?,?,0) ON CONFLICT(document,voice,key) DO UPDATE SET cancelled=0",
        document,
        voice,
        key,
      ),
    );
  }
  pendingWrites(): Promise<PendingWrite[]> {
    return this.db.getAllAsync(
      "SELECT document,voice,key,cancelled FROM writes",
    );
  }
  async finishWrite(document: string, voice: string, key: string) {
    await this.write((tx) =>
      tx.runAsync(
        "DELETE FROM writes WHERE document=? AND voice=? AND key=?",
        document,
        voice,
        key,
      ),
    );
  }
  async commitWrite(audio: StoredAudio): Promise<boolean> {
    return this.write(async (tx) => {
      const [job] = await tx.getAllAsync<{ cancelled: number }>(
        "SELECT cancelled FROM writes WHERE document=? AND voice=? AND key=?",
        audio.document,
        audio.voice,
        audio.key,
      );
      if (!job || job.cancelled) return false;
      await tx.runAsync(
        `INSERT INTO clips(document,voice,key,path,size,metadata,state) VALUES(?,?,?,?,?,?,'ready')
        ON CONFLICT(document,voice,key) DO UPDATE SET path=excluded.path,size=excluded.size,metadata=excluded.metadata,state='ready'`,
        audio.document,
        audio.voice,
        audio.key,
        audio.path,
        audio.size,
        JSON.stringify(audio),
      );
      await tx.runAsync(
        "DELETE FROM writes WHERE document=? AND voice=? AND key=?",
        audio.document,
        audio.voice,
        audio.key,
      );
      return true;
    });
  }
  async rememberVoice(document: string, key: string, voice: OfflineVoice) {
    await this.write((tx) =>
      tx.runAsync(
        `INSERT INTO voices VALUES(?,?,?,?,?) ON CONFLICT(document,key) DO UPDATE SET
      label=CASE WHEN excluded.label<>excluded.voice_id THEN excluded.label ELSE voices.label END`,
        document,
        key,
        voice.provider,
        voice.voice,
        voice.label,
      ),
    );
  }
  savedVoices(document: string): Promise<OfflineVoice[]> {
    return this.db.getAllAsync(
      `SELECT v.provider,v.voice_id AS voice,v.label FROM voices v
      WHERE v.document=? AND EXISTS(SELECT 1 FROM clips c WHERE c.document=v.document AND c.voice=v.key AND c.state='ready') ORDER BY v.key`,
      document,
    );
  }
}
