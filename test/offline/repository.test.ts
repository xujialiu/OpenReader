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
