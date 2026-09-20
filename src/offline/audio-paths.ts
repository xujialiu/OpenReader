import { Directory, File, Paths } from "expo-file-system";
import { offlineNative } from "../../modules/open-reader-offline";
import type { AudioAddress, StoredAudio } from "./catalog";

let directory: Directory | null = null;
export function offlineDirectory(): Directory {
  if (directory) return directory;
  // The owner authorized discarding the unreleased JSON download store.
  const previous = new Directory(Paths.document, "offline-narration");
  if (previous.exists) previous.delete();
  const next = new Directory(Paths.document, "offline-narration-v2");
  next.create({ intermediates: true, idempotent: true });
  offlineNative?.excludeFromBackup(next.uri);
  directory = next;
  return next;
}
const checked = (key: string) => {
  if (!/^[a-f0-9]{64}$/.test(key))
    throw new Error("Invalid offline file identity.");
  return key;
};
export const documentDirectory = (document: string) =>
  new Directory(offlineDirectory(), checked(document));
export const voiceDirectory = (address: AudioAddress) =>
  new Directory(documentDirectory(address.document), checked(address.voice));
export const audioExtension = (format: StoredAudio["format"]) =>
  format === "alac" ? "m4a" : "audio";
export const audioFile = (address: AudioAddress, suffix: string) =>
  new File(voiceDirectory(address), checked(address.key) + "." + suffix);
export const metadataFile = (address: AudioAddress) =>
  audioFile(address, "json");
export const payloadFile = (
  address: AudioAddress,
  format: StoredAudio["format"],
) => audioFile(address, audioExtension(format));
