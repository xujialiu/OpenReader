import { File, Paths } from "expo-file-system";
import { gzipSync } from "fflate";
import { offlineNative } from "../../modules/open-reader-offline";
import type { SynthesisResult } from "../core/providers/types";
import { audioAddress } from "./catalog-keys";
import {
  voiceDirectory,
  audioFile,
  audioExtension,
  metadataFile,
  payloadFile,
} from "./audio-paths";
import type { OfflineVoice } from "./model";

/** Commit a small manifest only after its payload exists; a crash never marks a
 * half-written clip complete. Temporary files are scoped to this store. */
export function writeJson(file: File, value: unknown): void {
  if (offlineNative) {
    offlineNative.writeJson(file.uri, JSON.stringify(value));
    return;
  }
  const temp = new File(`${file.uri}.pending`);
  temp.write(JSON.stringify(value));
  temp.moveSync(file, { overwrite: true });
}
interface ClipMeta {
  format: "alac" | "gzip-pcm" | "encoded";
  size: number;
  sampleRate?: number;
  mediaType?: string;
  timestamps?: SynthesisResult["timestamps"];
}
export async function saveClip(
  id: string,
  voice: OfflineVoice,
  text: string,
  clip: SynthesisResult,
  stillWanted = () => true,
): Promise<boolean> {
  const address = audioAddress(id, voice, text);
  const dir = voiceDirectory(address);
  dir.create({ intermediates: true, idempotent: true });
  const bytes = clip.audio === "pcm" ? clip.samples : clip.bytes;
  if (!bytes.length) throw new Error("The provider returned empty audio.");
  if (Paths.availableDiskSpace < bytes.length * 3 + 1024 * 1024)
    throw new Error("Not enough storage. Free space and continue.");
  const format: ClipMeta["format"] =
    clip.audio === "encoded" ? "encoded" : offlineNative ? "alac" : "gzip-pcm";
  const target = payloadFile(address, format);
  const temp = audioFile(address, "pending." + audioExtension(format));
  const tempUri = temp.uri;
  const raw = audioFile(address, "pending.pcm");
  try {
    if (clip.audio === "pcm" && offlineNative) {
      raw.write(bytes);
      await offlineNative.compress(raw.uri, temp.uri, clip.sampleRate);
    } else temp.write(clip.audio === "pcm" ? gzipSync(bytes) : bytes);
    if (!stillWanted()) return false;
    temp.moveSync(target, { overwrite: true });
    writeJson(metadataFile(address), {
      format,
      size: target.size,
      timestamps: clip.timestamps,
      ...(clip.audio === "pcm"
        ? { sampleRate: clip.sampleRate }
        : { mediaType: clip.mediaType }),
    } satisfies ClipMeta);
    return true;
  } finally {
    if (raw.exists) raw.delete();
    const unfinished = new File(tempUri);
    if (unfinished.exists) unfinished.delete();
  }
}
