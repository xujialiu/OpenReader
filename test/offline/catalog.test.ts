import { afterEach, expect, it } from "vitest";
import type {
  OfflineCatalog,
  PreparedChapter,
  StoredAudio,
} from "../../src/offline/catalog";
import { testCatalog } from "./sqlite";

const closers: (() => void)[] = [];
function catalog() {
  const result = testCatalog();
  closers.push(result.close);
  return result.catalog;
}
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function storeAudio(store: OfflineCatalog, audio: StoredAudio) {
  await store.beginWrite(audio.document, audio.voice, audio.key);
  await store.commitWrite(audio);
}
async function prepare(
  store: OfflineCatalog,
  document: string,
  chapters: PreparedChapter[],
) {
  await store.savePlan(document, {
    version: 2,
    preparedSections: [],
    sections: chapters.map((_, i) => ({ href: String(i), path: String(i) })),
    chapters: chapters.map((c, section) => ({
      id: c.id,
      title: c.title,
      depth: c.depth,
      parent: c.parent,
      section,
      prepared: false,
      texts: [],
    })),
  });
  for (let section = 0; section < chapters.length; section++)
    await store.saveSection(document, section, [chapters[section]]);
}

it("answers saved voice availability and size independently of the planned text", async () => {
  const store = catalog();
  await store.initialize();
  expect(await store.voices("long-book")).toEqual([]);
  await storeAudio(store, {
    document: "long-book",
    voice: "voice-A",
    key: "clip-1",
    path: "clip-1.m4a",
    format: "alac",
    size: 120,
  });
  await storeAudio(store, {
    document: "long-book",
    voice: "voice-A",
    key: "clip-2",
    path: "clip-2.m4a",
    format: "alac",
    size: 80,
  });
  expect(await store.voices("long-book")).toEqual([
    { voice: "voice-A", count: 2, bytes: 200 },
  ]);
  expect((await store.getClip("long-book", "voice-A", "clip-2"))?.size).toBe(
    80,
  );
  expect(await store.getClip("long-book", "voice-B", "clip-2")).toBeNull();
});

it("returns metadata for 131,686 prepared texts and queries a second voice without per-voice text indexing", async () => {
  const store = catalog();
  await store.initialize();
  const texts = Array.from({ length: 131686 }, (_, i) => "Sentence " + i + ".");
  await prepare(store, "long-book", [
    {
      id: "first",
      title: "First",
      depth: 0,
      parent: null,
      texts: texts.slice(0, 2),
      keys: ["first", "second"],
    },
    {
      id: "rest",
      title: "Rest",
      depth: 0,
      parent: null,
      texts: texts.slice(2),
      keys: texts.slice(2),
    },
  ]);
  const plan = await store.plan("long-book");
  expect(
    plan?.chapters.map((c) => ({
      id: c.id,
      count: c.textCount,
      texts: c.texts,
    })),
  ).toEqual([
    { id: "first", count: 2, texts: [] },
    { id: "rest", count: 131684, texts: [] },
  ]);
  expect((await store.chapter("long-book", "first"))?.texts).toEqual([
    "Sentence 0.",
    "Sentence 1.",
  ]);
  await storeAudio(store, {
    document: "long-book",
    voice: "A",
    key: "first",
    path: "first.audio",
    format: "encoded",
    size: 3,
  });
  await storeAudio(store, {
    document: "long-book",
    voice: "B",
    key: "first",
    path: "first.audio",
    format: "encoded",
    size: 5,
  });
  expect(await store.progress("long-book", "B")).toEqual([
    { id: "first", count: 1, complete: false },
    { id: "rest", count: 0, complete: false },
  ]);
});

it("queries a second voice against prepared chapter membership without per-voice setup", async () => {
  const store = catalog();
  await store.initialize();
  await prepare(store, "book", [
    {
      id: "one",
      title: "One",
      parent: null,
      depth: 0,
      texts: ["Shared"],
      keys: ["shared"],
    },
    {
      id: "rest",
      title: "Rest",
      parent: null,
      depth: 0,
      texts: ["Other"],
      keys: ["other"],
    },
  ]);
  await storeAudio(store, {
    document: "book",
    voice: "B",
    key: "shared",
    path: "shared.audio",
    format: "encoded",
    size: 3,
  });
  expect(await store.progress("book", "B")).toEqual([
    { id: "one", count: 1, complete: true },
    { id: "rest", count: 0, complete: false },
  ]);
});

it("tracks completion and recoverable deletion without double-counting shared audio", async () => {
  const store = catalog();
  await store.initialize();
  await prepare(store, "book", [
    {
      id: "one",
      title: "One",
      parent: null,
      depth: 0,
      texts: ["Shared", "Only one"],
      keys: ["shared", "unique"],
    },
    {
      id: "two",
      title: "Two",
      parent: null,
      depth: 0,
      texts: ["Shared"],
      keys: ["shared"],
    },
  ]);
  await storeAudio(store, {
    document: "book",
    voice: "A",
    key: "shared",
    path: "s.m4a",
    format: "alac",
    size: 10,
  });
  await storeAudio(store, {
    document: "book",
    voice: "A",
    key: "unique",
    path: "u.m4a",
    format: "alac",
    size: 20,
  });
  expect(await store.progress("book", "A")).toEqual([
    { id: "one", count: 2, complete: true },
    { id: "two", count: 1, complete: true },
  ]);
  await store.beginDelete("book", "A", ["one"], ["two"]);
  expect((await store.pendingDeletes()).map((c) => c.key)).toEqual(["unique"]);
  expect(await store.getClip("book", "A", "unique")).toBeNull();
  expect(await store.voices("book")).toEqual([
    { voice: "A", count: 1, bytes: 10 },
  ]);
  await store.finishDelete("book", "A", "unique");
  expect(await store.pendingDeletes()).toEqual([]);
  expect((await store.progress("book", "A"))[0]).toEqual({
    id: "one",
    count: 1,
    complete: false,
  });
});

it("keeps write intent until registration and cancels an in-flight write on deletion", async () => {
  const store = catalog();
  await store.initialize();
  await prepare(store, "book", [
    {
      id: "one",
      title: "One",
      parent: null,
      depth: 0,
      texts: ["New"],
      keys: ["new"],
    },
  ]);
  await store.beginWrite("book", "A", "new");
  expect(await store.pendingWrites()).toEqual([
    { document: "book", voice: "A", key: "new", cancelled: 0 },
  ]);
  await store.beginDelete("book", "A", ["one"], []);
  expect(
    await store.commitWrite({
      document: "book",
      voice: "A",
      key: "new",
      path: "new.m4a",
      format: "alac",
      size: 20,
    }),
  ).toBe(false);
  expect(await store.voices("book")).toEqual([]);
  await store.finishWrite("book", "A", "new");
  await store.beginWrite("book", "A", "new");
  expect(
    await store.commitWrite({
      document: "book",
      voice: "A",
      key: "new",
      path: "new.m4a",
      format: "alac",
      size: 20,
    }),
  ).toBe(true);
  expect(await store.pendingWrites()).toEqual([]);
});

it("keeps saved voice identity after its task is removed", async () => {
  const store = catalog();
  await store.initialize();
  await store.rememberVoice("book", "voice-hash", {
    provider: "fish",
    voice: "voice-id",
    label: "Narrator",
  });
  await storeAudio(store, {
    document: "book",
    voice: "voice-hash",
    key: "one",
    path: "one.audio",
    format: "encoded",
    size: 42,
  });
  await store.saveTasks([]);
  expect(await store.savedVoices("book")).toEqual([
    { provider: "fish", voice: "voice-id", label: "Narrator" },
  ]);
});

it("rolls back a failed plan write instead of leaving partial chapters", async () => {
  const store = catalog();
  await store.initialize();
  const chapter = {
    id: "duplicate",
    title: "Chapter",
    depth: 0,
    parent: null,
    texts: [],
  };
  await expect(
    store.savePlan("book", { version: 2, chapters: [chapter, chapter] }),
  ).rejects.toThrow();
  expect(await store.plan("book")).toBeNull();
});

it("persists selected section text and membership without declaring the rest prepared", async () => {
  const store = catalog();
  await store.initialize();
  await store.savePlan("book", {
    version: 2,
    sections: [
      { path: "1", href: "1" },
      { path: "2", href: "2" },
    ],
    preparedSections: [],
    chapters: [
      {
        id: "section-0",
        title: "One",
        section: 0,
        parent: null,
        depth: 0,
        texts: [],
        prepared: false,
      },
      {
        id: "section-1",
        title: "Two",
        section: 1,
        parent: null,
        depth: 0,
        texts: [],
        prepared: false,
      },
    ],
  });
  await store.saveSection("book", 1, [
    {
      id: "section-1",
      title: "Second chapter",
      parent: null,
      depth: 0,
      texts: ["Saved text."],
      keys: ["saved-text"],
    },
  ]);
  const plan = await store.plan("book");
  expect(plan?.preparedSections).toEqual([1]);
  expect(plan?.chapters.map((c) => [c.prepared, c.textCount, c.texts])).toEqual(
    [
      [false, 0, []],
      [true, 1, []],
    ],
  );
  expect((await store.chapter("book", "section-1"))?.texts).toEqual([
    "Saved text.",
  ]);
});
