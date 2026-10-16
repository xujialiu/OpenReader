import { DEFAULT_FISH_MODEL } from '../core/providers/fish-models';
import type { OfflineVoice } from './model';

type VoiceIdentity = Pick<OfflineVoice, 'provider' | 'voice' | 'model'>;
/** Model-less Fish records were all made with the formerly fixed free Model. */
export const fishModelOf = (voice: VoiceIdentity): string | undefined =>
  voice.provider === 'fish' ? voice.model ?? DEFAULT_FISH_MODEL : undefined;

/** Keep old free-audio addresses byte for byte; no moving or copying paid-for files. */
export function narrationIdentity(voice: VoiceIdentity): string {
  const model = fishModelOf(voice);
  return JSON.stringify(model && model !== DEFAULT_FISH_MODEL
    ? [voice.provider, model, voice.voice]
    : [voice.provider, voice.voice]);
}
export function withFishModel<T extends VoiceIdentity>(voice: T, model: string): T {
  return voice.provider === 'fish' ? { ...voice, model } : voice;
}
export function inFishModel(voice: VoiceIdentity, model: string): boolean {
  return voice.provider !== 'fish' || fishModelOf(voice) === model;
}
