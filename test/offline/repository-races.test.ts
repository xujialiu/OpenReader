import { expect, it, vi } from "vitest";
import { OfflineRepository, type AudioFiles } from "../../src/offline/repository";
import type { AudioAddress, StoredAudio } from "../../src/offline/catalog";
import { audioAddress, audioKey, documentKey, voiceKey } from "../../src/offline/catalog-keys";
import { testCatalog } from "./sqlite";

const voice = { provider: "fish" as const, voice: "A", label: "A" };
const clip = { audio: "encoded" as const, bytes: new Uint8Array([1, 2, 3]), mediaType: "audio/mp4" };
const at = (a: AudioAddress) => `${a.document}/${a.voice}/${a.key}`;
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((r) => { release = r; });
  return { promise, release };
}
function setup() {
  const database = testCatalog();
  const disk = new Map<string, StoredAudio>();
  const files: AudioFiles = {
    lookup: async (a) => disk.get(at(a)) ?? null,
    present: async (a) => disk.has(at(a)),
    read: async (a) => disk.has(at(a)) ? clip : null,
    write: async (document, v, text, _clip, wanted) => {
      if (!wanted()) return false;
      const a = audioAddress(document, v, text);
      disk.set(at(a), { ...a, path: `${a.key}.audio`, format: "encoded", size: 3, mediaType: "audio/mp4" });
      return true;
    },
    remove: async (a) => { disk.delete(at(a)); },
    cleanTemporary: async () => {},
    removeDocumentFiles: async (doc) => {
      for (const [key, a] of disk) if (a.document === doc) disk.delete(key);
    },
  };
  const repository = new OfflineRepository(database.catalog, files);
  return { ...database, disk, files, repository };
}
async function chapter(repository: OfflineRepository, document = "book", text = "Hello.") {
  await repository.savePlan(document, { version: 2, sections: [{ href: "0", path: "0" }], preparedSections: [],
    chapters: [{ id: "one", title: "One", depth: 0, parent: null, section: 0, prepared: false, texts: [] }] });
  await repository.saveSection(document, 0, [{ id: "one", title: "One", depth: 0, parent: null, texts: [text] }]);
}

for (const kind of ["chapter", "voice"] as const) {
  it(`a recovered ${kind} deletion cannot remove a Clip saved again while its query was out (#313)`, async () => {
    const { catalog, close, files, repository: before, disk } = setup();
    const held = latch(), listed = latch();
    let repository: OfflineRepository | undefined;
    try {
      await catalog.initialize();
      await chapter(before);
      await before.saveClip("book", voice, "Hello.", clip, () => true);
      if (kind === "chapter") await catalog.beginDelete(documentKey("book"), voiceKey(voice), ["one"], []);
      else await catalog.beginVoiceRemoval(documentKey("book"), voiceKey(voice));
      const pending = catalog.pendingDeletes.bind(catalog);
      vi.spyOn(catalog, "pendingDeletes").mockImplementationOnce(async (...args) => {
        const result = await pending(...args);
        expect(result).toHaveLength(1);
        listed.release();
        await held.promise;
        return result;
      });
      repository = new OfflineRepository(catalog, files);
      await repository.recover();
      await listed.promise;
      // Queue the save during the query; don't await it while the query is held.
      // With the fix the query already owns the file queue, so the save follows it.
      const saving = repository.saveClip("book", voice, "Hello.", clip, () => true);
      held.release();
      expect(await saving).toBe(true);
      await repository.cleanup;
      expect(disk.has(at(audioAddress("book", voice, "Hello.")))).toBe(true);
      expect((await repository.progress("book", voice))[0]?.complete).toBe(true);
      expect((await repository.readClip("book", voice, "Hello.")).clip).not.toBeNull();
    } finally {
      held.release();
      await repository?.cleanup;
      vi.restoreAllMocks();
      close();
    }
  });
}

it("a save overtaking recovery's directory-removal listing survives that removal (#313)", async () => {
  const { catalog, close, files, repository: before, disk } = setup();
  const held = latch(), listed = latch();
  let repository: OfflineRepository | undefined;
  try {
    await catalog.initialize();
    await before.saveClip("book", voice, "Hello.", clip, () => true);
    await catalog.removeDocument(documentKey("book"));
    const removals = catalog.removals.bind(catalog);
    vi.spyOn(catalog, "removals").mockImplementationOnce(async () => {
      const result = await removals();
      listed.release();
      await held.promise;
      return result;
    });
    repository = new OfflineRepository(catalog, files);
    await repository.recover();
    await listed.promise;
    const saving = repository.saveClip("book", voice, "Hello.", clip, () => true);
    held.release();
    expect(await saving).toBe(true);
    await repository.cleanup;
    expect(disk.has(at(audioAddress("book", voice, "Hello.")))).toBe(true);
    expect((await repository.readClip("book", voice, "Hello.")).clip).not.toBeNull();
    expect(await catalog.removals()).toEqual([]);
  } finally {
    held.release();
    await repository?.cleanup;
    vi.restoreAllMocks();
    close();
  }
});

for (const change of ["none", "remove", "replace"] as const) {
  it(`rekey survives ${change} after reading a chapter and before committing its keys (#175)`, async () => {
    const { catalog, close, repository } = setup();
    const held = latch(), read = latch();
    let walk: Promise<void> | undefined;
    try {
      await catalog.initialize();
      await chapter(repository, "a", "[Old]");
      await chapter(repository, "b", "[Other]");
      const first = (await catalog.preparedChapters())[0].document;
      const victim = documentKey("a") === first ? "a" : "b";
      const survivor = victim === "a" ? "b" : "a";
      const plain = catalog.chapter.bind(catalog);
      vi.spyOn(catalog, "chapter").mockImplementationOnce(async (...args) => {
        const result = await plain(...args);
        read.release();
        await held.promise;
        return result;
      });
      const strip = (s: string) => s.replace(/[\[\]]/g, "");
      walk = repository.rekey((s) => audioKey(strip(s)), "new-keying");
      // Attach the rejection handler immediately; the expectation below still asserts it.
      void walk.catch(() => {});
      await read.promise;
      if (change === "remove") await repository.removeDocument(victim);
      if (change === "replace") await chapter(repository, victim, "[Changed]");
      held.release();
      await expect(walk).resolves.toBeUndefined();
      expect(await catalog.speechKeying()).toBe("new-keying");
      for (const doc of change === "remove" ? [survivor] : [victim, survivor]) {
        const current = await repository.chapter(doc, "one");
        if (!current) throw new Error("The surviving chapter must still exist.");
        const text = current.texts[0];
        await repository.saveClip(doc, voice, strip(text), clip, () => true);
        expect((await repository.progress(doc, voice))[0]?.complete).toBe(true);
      }
    } finally {
      held.release();
      await walk?.catch(() => {});
      vi.restoreAllMocks();
      close();
    }
  });
}

it("repairs a pre-fix ready row whose payload is gone before reporting Downloaded, without fetching (#313)", async () => {
  const { catalog, close, repository, files, disk } = setup();
  try {
    await catalog.initialize();
    await chapter(repository);
    await repository.saveClip("book", voice, "Hello.", clip, () => true);
    disk.clear(); // State left by the pre-fix cleanup: ready row, no payload.
    const next = new OfflineRepository(catalog, files);
    await next.recover();
    await next.cleanup;
    expect((await next.progress("book", voice))[0]).toMatchObject({ count: 0, complete: false });
    expect(await next.inventory("book")).toEqual([]);
    // An explicit re-download can save it again; no automatic synthesis occurred.
    expect(await next.saveClip("book", voice, "Hello.", clip, () => true)).toBe(true);
    expect((await next.progress("book", voice))[0]?.complete).toBe(true);
  } finally { close(); }
});

it("retries an interrupted cleanup and keeps Clips that were not selected (#313)", async () => {
  const { catalog, close, repository, files, disk } = setup();
  try {
    await catalog.initialize();
    await chapter(repository);
    await repository.saveClip("book", voice, "Hello.", clip, () => true);
    await repository.saveClip("book", voice, "Unselected.", clip, () => true);
    const remove = vi.spyOn(files, "remove").mockRejectedValueOnce(new Error("disk busy"));
    await expect(repository.deleteChapters("book", voice, ["one"], [])).rejects.toThrow("disk busy");
    expect(await catalog.pendingDeletes()).toHaveLength(1);
    remove.mockRestore();
    const next = new OfflineRepository(catalog, files);
    await next.recover();
    await next.cleanup;
    expect(await catalog.pendingDeletes()).toEqual([]);
    expect(disk.has(at(audioAddress("book", voice, "Hello.")))).toBe(false);
    expect(disk.has(at(audioAddress("book", voice, "Unselected.")))).toBe(true);
  } finally { vi.restoreAllMocks(); close(); }
});

it("two concurrent cleanup sweeps do not reuse each other's stale batches (#313)", async () => {
  const { catalog, close, repository, files, disk } = setup();
  const held = latch(), removing = latch();
  try {
    await catalog.initialize();
    await chapter(repository);
    await repository.saveClip("book", voice, "Hello.", clip, () => true);
    const remove = files.remove.bind(files);
    vi.spyOn(files, "remove").mockImplementationOnce(async (a) => {
      removing.release();
      await held.promise;
      await remove(a);
    });
    const first = repository.deleteChapters("book", voice, ["one"], []);
    await removing.promise;
    const second = repository.removeVoice("book", voice);
    const saving = repository.saveClip("book", voice, "Hello.", clip, () => true);
    held.release();
    await Promise.all([first, second, saving]);
    expect(disk.has(at(audioAddress("book", voice, "Hello.")))).toBe(true);
    expect((await repository.progress("book", voice))[0]?.complete).toBe(true);
  } finally { held.release(); vi.restoreAllMocks(); close(); }
});

it("file repair paginates across removed rows, shares concurrent queries and is durable (#313)", async () => {
  const { catalog, close, repository, files, disk } = setup();
  try {
    await catalog.initialize();
    for (let n = 0; n < 130; n++) await repository.saveClip("book", voice, String(n), clip, () => true);
    for (const [key] of [...disk].slice(2)) disk.delete(key);
    const present = vi.spyOn(files, "present");
    const [inventory] = await Promise.all([repository.inventory("book"), repository.progress("book", voice)]);
    expect(inventory[0].count).toBe(2);
    expect(present).toHaveBeenCalledTimes(130);
    expect(await catalog.audioVerified(documentKey("book"))).toBe(true);
    const next = new OfflineRepository(catalog, files);
    await next.recover();
    await next.cleanup;
    expect((await next.inventory("book"))[0].count).toBe(2);
    expect(present).toHaveBeenCalledTimes(130); // no scan on the next launch
  } finally { vi.restoreAllMocks(); close(); }
});

it("file repair never drops a newer save after a missing-payload check (#313)", async () => {
  const { catalog, close, repository, files, disk } = setup();
  const held = latch(), checked = latch();
  try {
    await catalog.initialize();
    await repository.saveClip("book", voice, "Hello.", clip, () => true);
    disk.clear();
    vi.spyOn(files, "present").mockImplementationOnce(async () => {
      checked.release();
      await held.promise;
      return false;
    });
    const inventory = repository.inventory("book");
    await checked.promise;
    const save = repository.saveClip("book", voice, "Hello.", clip, () => true);
    held.release();
    expect(await save).toBe(true);
    await inventory;
    expect((await repository.inventory("book"))[0].count).toBe(1);
    expect((await repository.readClip("book", voice, "Hello.")).clip).not.toBeNull();
  } finally { held.release(); vi.restoreAllMocks(); close(); }
});

it("a failed file audit stays unverified and is retried, without losing good audio (#313)", async () => {
  const { catalog, close, repository, files } = setup();
  try {
    await catalog.initialize();
    await repository.saveClip("book", voice, "Hello.", clip, () => true);
    vi.spyOn(files, "present").mockRejectedValueOnce(new Error("cannot inspect file"));
    await expect(repository.inventory("book")).rejects.toThrow("cannot inspect file");
    expect(await catalog.audioVerified(documentKey("book"))).toBe(false);
    expect((await repository.inventory("book"))[0].count).toBe(1);
    expect(await catalog.audioVerified(documentKey("book"))).toBe(true);
  } finally { vi.restoreAllMocks(); close(); }
});

it("rekey keeps genuine membership and database failures visible and records no completed setting (#175)", async () => {
  const { catalog, close, repository } = setup();
  try {
    await catalog.initialize();
    await chapter(repository);
    await expect(catalog.rekeyChapter(documentKey("book"), "one", ["Hello."], [])).rejects.toThrow("Every prepared text");
    vi.spyOn(catalog, "rekeyChapter").mockRejectedValueOnce(new Error("database write failed"));
    await expect(repository.rekey(audioKey, "new")).rejects.toThrow("database write failed");
    expect(await catalog.speechKeying()).not.toBe("new");
    await repository.rekey(audioKey, "new");
    expect(await catalog.speechKeying()).toBe("new");
  } finally { vi.restoreAllMocks(); close(); }
});
