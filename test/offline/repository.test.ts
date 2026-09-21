import { expect, it } from "vitest";
import {
  OfflineRepository,
  type AudioFiles,
} from "../../src/offline/repository";
import {
  audioKey,
  documentKey,
  voiceKey,
} from "../../src/offline/catalog-keys";
import { testCatalog } from "./sqlite";
import { downloadSpeech } from "../../src/offline/speech";
import type { StoredAudio } from "../../src/offline/catalog";
const voice = { provider: "fish" as const, voice: "A", label: "A" };

it("answers empty inventory without inspecting any potential audio files", async () => {
  const { catalog, close } = testCatalog();
  await catalog.initialize();
  const files: AudioFiles = {
    lookup: async () => {
      throw new Error("Unindexed files must not be inspected");
    },
    read: async () => null,
    present: async () => false,
    write: async () => false,
    remove: async () => {},
    cleanTemporary: async () => {},
    removeDocumentFiles: async () => {},
  };
  try {
    const repository = new OfflineRepository(catalog, files);
    expect(await repository.inventory("long-book")).toEqual([]);
    expect(
      await repository.readClip("long-book", voice, "Just this sentence."),
    ).toBeNull();
  } finally {
    close();
  }
});

it("recovers a file stored before its database commit, and invalidates a missing payload", async () => {
  const { catalog, close } = testCatalog();
  await catalog.initialize();
  const address = {
    document: documentKey("book"),
    voice: voiceKey(voice),
    key: audioKey("Hi"),
  };
  let audio: StoredAudio | null = {
    ...address,
    path: "audio.m4a",
    format: "alac",
    size: 3,
  };
  const files: AudioFiles = {
    lookup: async () => audio,
    present: async () => !!audio,
    read: async () =>
      audio
        ? {
            audio: "encoded",
            bytes: new Uint8Array([1, 2, 3]),
            mediaType: "audio/mp4",
          }
        : null,
    write: async () => true,
    remove: async () => {
      audio = null;
    },
    cleanTemporary: async () => {},
    removeDocumentFiles: async () => {},
  };
  try {
    await catalog.beginWrite(address.document, address.voice, address.key);
    const repository = new OfflineRepository(catalog, files);
    await repository.recover();
    expect((await repository.inventory("book"))[0]?.count).toBe(1);
    expect((await repository.readClip("book", voice, "Hi"))?.audio).toBe(
      "encoded",
    );
    audio = null;
    expect(await repository.readClip("book", voice, "Hi")).toBeNull();
    expect(await repository.inventory("book")).toEqual([]);
  } finally {
    close();
  }
});

/** Files that always exist and count what is done to them; `gate` holds the directory removal until released. */
function countingFiles(gate?: Promise<void>) {
  const calls = { remove: 0, removeDocumentFiles: 0 };
  const files: AudioFiles = {
    lookup: async (address) => ({
      ...address,
      path: `${address.key}.audio`,
      format: "encoded",
      size: 1,
    }),
    present: async () => true,
    read: async () => null,
    write: async () => true,
    remove: async () => {
      calls.remove++;
    },
    cleanTemporary: async () => {},
    removeDocumentFiles: async () => {
      await gate;
      calls.removeDocumentFiles++;
    },
  };
  return { files, calls };
}
const text = (i: number) => `Sentence ${i}.`;
async function seed(repository: OfflineRepository, document: string, count: number) {
  for (let i = 0; i < count; i++)
    await repository.saveClip(
      document,
      voice,
      text(i),
      { audio: "encoded", bytes: new Uint8Array([1]), mediaType: "audio/mp4" },
      () => true,
    );
}

it("removes a document's audio with two transactions and one directory removal, however many clips it holds", async () => {
  const counts = { transactions: 0 };
  const { catalog, close } = testCatalog({
    transaction: () => counts.transactions++,
  });
  await catalog.initialize();
  const { files, calls } = countingFiles();
  try {
    const repository = new OfflineRepository(catalog, files);
    await seed(repository, "book", 300);
    expect((await repository.inventory("book"))[0]?.count).toBe(300);
    counts.transactions = 0;
    await repository.removeDocument("book");
    expect(counts.transactions).toBe(2);
    expect(calls).toEqual({ remove: 0, removeDocumentFiles: 1 });
    expect(await repository.inventory("book")).toEqual([]);
    expect(await catalog.pendingDeletes()).toEqual([]);
    expect(await catalog.removals()).toEqual([]);
  } finally {
    close();
  }
});

it("answers before an interrupted document removal is finished, then finishes it", async () => {
  const counts = { transactions: 0 };
  const { catalog, close } = testCatalog({
    transaction: () => counts.transactions++,
  });
  await catalog.initialize();
  let release!: () => void;
  const { files, calls } = countingFiles(
    new Promise<void>((resolve) => (release = resolve)),
  );
  try {
    await seed(new OfflineRepository(catalog, files), "book", 300);
    // The marking transaction ran; the app died before the files went.
    await catalog.removeDocument(documentKey("book"));
    counts.transactions = 0;
    const repository = new OfflineRepository(catalog, files);
    await repository.recover();
    expect(calls.removeDocumentFiles).toBe(0);
    expect(await repository.inventory("book")).toEqual([]);
    expect(await repository.readClip("book", voice, text(0))).toBeNull();
    release();
    await repository.cleanup;
    expect(calls).toEqual({ remove: 0, removeDocumentFiles: 1 });
    expect(counts.transactions).toBe(1);
    expect(await catalog.removals()).toEqual([]);
    expect(await catalog.pendingDeletes()).toEqual([]);
  } finally {
    close();
  }
});

it("hides selected chapters first, then removes their files and their rows in one statement per batch", async () => {
  const counts = { transactions: 0 };
  const { catalog, close } = testCatalog({
    transaction: () => counts.transactions++,
  });
  await catalog.initialize();
  const { files, calls } = countingFiles();
  try {
    const repository = new OfflineRepository(catalog, files);
    const texts = Array.from({ length: 600 }, (_, i) => text(i));
    await repository.savePlan("book", {
      version: 2,
      sections: [{ href: "0", path: "0" }],
      preparedSections: [],
      chapters: [
        { id: "one", title: "One", depth: 0, parent: null, section: 0, prepared: false, texts: [] },
      ],
    });
    await repository.saveSection("book", 0, [
      { id: "one", title: "One", depth: 0, parent: null, texts },
    ]);
    await seed(repository, "book", 600);
    expect((await repository.progress("book", voice))[0]?.complete).toBe(true);
    counts.transactions = 0;
    const seen: string[] = [];
    await repository.deleteChapters("book", voice, ["one"], [], async () => {
      seen.push(`hidden after ${calls.remove} removals`);
      expect((await repository.progress("book", voice))[0]?.count).toBe(0);
    });
    expect(seen).toEqual(["hidden after 0 removals"]);
    expect(calls).toEqual({ remove: 600, removeDocumentFiles: 0 });
    // The mark, then 500 keys and 100 keys.
    expect(counts.transactions).toBe(3);
    expect(await catalog.pendingDeletes()).toEqual([]);
    expect(await repository.inventory("book")).toEqual([]);
  } finally {
    close();
  }
});

it("names a chapter's sentences by their Speech Text, and re-keys them when the bracket setting changes (#25)", async () => {
  const { catalog, close } = testCatalog();
  await catalog.initialize();
  const { files } = countingFiles();
  try {
    const repository = new OfflineRepository(catalog, files);
    await repository.savePlan("book", {
      version: 2,
      sections: [{ href: "0", path: "0" }],
      preparedSections: [],
      chapters: [
        { id: "one", title: "One", depth: 0, parent: null, section: 0, prepared: false, texts: [] },
      ],
    });
    const texts = ["He cast [Fireball] at the wolf.", "Plain."];
    const strip = { stripBrackets: true, bracketPairs: "<> []" };
    const stripped = (t: string) => audioKey(downloadSpeech(t, strip));
    await repository.saveSection("book", 0, [{ id: "one", title: "One", depth: 0, parent: null, texts }], stripped);
    // Saved the way reading will ask for it: under the Speech Text.
    for (const t of texts)
      await repository.saveClip("book", voice, downloadSpeech(t, strip), { audio: "encoded", bytes: new Uint8Array([1]), mediaType: "audio/mp4" }, () => true);
    expect((await repository.progress("book", voice))[0]).toMatchObject({ count: 2, complete: true });

    // Switched off: the bracketed sentence is now named by its own text, which
    // nothing was saved under, so the chapter needs downloading again.
    await repository.rekey((t) => audioKey(t), '[false]');
    expect((await repository.progress("book", voice))[0]).toMatchObject({ count: 1, complete: false });
    expect(await catalog.speechKeying()).toBe('[false]');
    // The texts themselves are untouched.
    expect((await repository.chapter("book", "one"))?.texts).toEqual(texts);

    // Switched back: the old audio counts again without being touched.
    await repository.rekey(stripped, '[true,"<> []"]');
    expect((await repository.progress("book", voice))[0]).toMatchObject({ count: 2, complete: true });
  } finally {
    close();
  }
});
