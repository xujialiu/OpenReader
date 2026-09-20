import type { File } from "expo-file-system";
import { gunzipSync } from "fflate";
import type { SynthesisResult } from "../core/providers/types";
import type { AudioAddress, StoredAudio } from "./catalog";
import type { AudioFiles } from "./repository";
import { saveClip } from "./storage";
import {
  documentDirectory as doc,
  metadataFile as metadata,
  audioExtension as extension,
  payloadFile as payload,
  audioFile,
} from "./audio-paths";
const json = async <T>(file: File): Promise<T | null> =>
  file.exists ? (JSON.parse(await file.text()) as T) : null;

async function lookup(address: AudioAddress): Promise<StoredAudio | null> {
  const record = await json<Partial<StoredAudio>>(metadata(address));
  if (
    !record ||
    !["alac", "gzip-pcm", "encoded"].includes(record.format ?? "") ||
    !Number.isSafeInteger(record.size) ||
    record.size! <= 0
  )
    return null;
  const format = record.format!;
  const file = payload(address, format);
  if (!file.exists || file.size !== record.size) return null;
  return {
    ...address,
    path: `${address.key}.${extension(format)}`,
    format,
    size: record.size!,
    sampleRate: record.sampleRate,
    mediaType: record.mediaType,
    timestamps: record.timestamps,
  };
}
async function remove(address: AudioAddress) {
  // Delete only names derived from the indexed address, never a sidecar-supplied path.
  for (const suffix of [
    "json",
    "m4a",
    "audio",
    "pending.m4a",
    "pending.audio",
    "pending.pcm",
    "json.pending",
  ]) {
    const file = audioFile(address, suffix);
    if (file.exists) file.delete();
  }
}

export const audioFiles: AudioFiles = {
  lookup,
  async present(audio) {
    const file = payload(audio, audio.format);
    return file.exists && file.size === audio.size;
  },
  async read(audio): Promise<SynthesisResult | null> {
    const file = payload(audio, audio.format);
    if (!file.exists || file.size !== audio.size) return null;
    const bytes = await file.bytes();
    if (audio.format === "gzip-pcm")
      return {
        audio: "pcm",
        samples: new Uint8Array(gunzipSync(bytes)),
        sampleRate: audio.sampleRate!,
        timestamps: audio.timestamps,
      };
    return {
      audio: "encoded",
      bytes,
      mediaType: audio.format === "alac" ? "audio/mp4" : audio.mediaType!,
      timestamps: audio.timestamps,
    };
  },
  write: saveClip,
  remove,
  async cleanTemporary(address) {
    for (const suffix of [
      "pending.m4a",
      "pending.audio",
      "pending.pcm",
      "json.pending",
    ]) {
      const file = audioFile(address, suffix);
      if (file.exists) file.delete();
    }
  },
  async removeDocumentFiles(document) {
    const directory = doc(document);
    if (directory.exists) directory.delete();
  },
};
