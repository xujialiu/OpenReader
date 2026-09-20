import { strToU8 } from "fflate";
import { sha256Hex } from "../core/document/sha256";
import type { OfflineVoice } from "./model";
import type { AudioAddress } from "./catalog";
const digest = (text: string) => sha256Hex(strToU8(text));
export const documentKey = (id: string) => digest(id);
export const voiceKey = (voice: Pick<OfflineVoice, "provider" | "voice">) =>
  digest(JSON.stringify([voice.provider, voice.voice]));
/** Voice already has its own directory/key column. Membership is shared across voices. */
export const audioKey = (text: string) => digest(text);
export const audioAddress = (
  document: string,
  voice: OfflineVoice,
  text: string,
): AudioAddress => ({
  document: documentKey(document),
  voice: voiceKey(voice),
  key: audioKey(text),
});
