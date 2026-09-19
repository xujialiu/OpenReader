/**
 * The provider contract: text in, PCM and word timings out.
 *
 * This is the Zotero-TTS plugin's `src/core/providers/types.ts` with one thing
 * changed — `SynthesisResult`, which is no longer a `Blob` (ADR 0013) — and
 * with the members none of the ported providers produce left out rather than
 * carried as decoration.
 */

/** Every provider that exists here. The plugin's `azure`, `cloudflare`, `fish`, `fishspeech`, `mimo` and `system` have not come across (ADR 0005 for Azure, ADR 0014 for the OS voices). */
export type ProviderId = 'openai-official' | 'compatible' | 'speechify' | 'local';

/**
 * One Word Timing: where a spoken word falls inside a clip. `start` and `end`
 * are seconds from the start of the clip; `charStart` and `charEnd` are UTF-16
 * code-unit offsets into the utterance's text.
 *
 * The name is the plugin's and stays, because the aligner and the ~3,200 lines
 * of provider tests that arrive with ADR 0013 spell it this way and the point
 * of copying is that they arrive unchanged. CONTEXT.md's word for what it
 * holds is a **Word Timing**; prefer that in prose.
 *
 * A provider either reports these or it does not. They are never estimated or
 * interpolated: a clip without them is highlighted at utterance level
 * (ADR 0005, philosophy rule 1).
 */
export type Timestamp = {
  start: number;
  end: number;
  charStart: number;
  charEnd: number;
};

/**
 * The audio a provider returns for one utterance — a **Clip** — which is
 * either samples ready to play or bytes that still have to be decoded, and
 * which says honestly which it is.
 *
 * **`pcm` means 16-bit signed little-endian mono, at `sampleRate` hertz**, the
 * layout `core/wav.ts` writes and the one the playback engine of ADR 0012
 * enqueues. Nothing about the samples is inferred: a provider reports `pcm`
 * only where it asked for PCM and nothing in the reply contradicts that.
 *
 * `encoded` is the fallback ADR 0013 keeps, and the reason this is a union at
 * all rather than `{ audio: Uint8Array; sampleRate: number }`. The
 * OpenAI-compatible provider talks to *any* server speaking that protocol,
 * including someone's self-hosted one, and such a server may only emit MP3.
 * Decoding is the playback layer's job — this directory may not import
 * `react-native-audio-api` — so the bytes are handed on with the media type
 * the server gave them and the decision stays where the decoder is.
 *
 * `audio` is the discriminant and was the `Blob` field's name, which is
 * deliberate: every one of the plugin's 19 blob sites now fails to compile
 * rather than quietly type-checking against a string.
 */
export type SynthesisResult =
  | {
      audio: 'pcm';
      /** 16-bit signed little-endian mono samples, no container, no header. */
      samples: Uint8Array<ArrayBuffer>;
      /** Hertz. Read from the reply where the reply says, else the rate that was asked for. */
      sampleRate: number;
      /** Omitted means this provider reported no word timings; the utterance is highlighted whole. Never interpolated, never estimated (ADR 0005). */
      timestamps?: Timestamp[];
      /** Why the timings are missing, or what the request had to do differently, when the provider knows. For the debug output. */
      note?: string;
    }
  | {
      audio: 'encoded';
      /** The bytes as the server sent them: a container the playback layer decodes. */
      bytes: Uint8Array<ArrayBuffer>;
      /** What the bytes are, as a media type: `audio/mpeg`, `audio/wav`, … */
      mediaType: string;
      timestamps?: Timestamp[];
      note?: string;
    };

/**
 * The locale of voices that speak whatever language they are given — OpenAI's,
 * voices of unknown language from OpenAI-compatible servers. `mul` is BCP-47
 * for "multiple languages", so a language list built through
 * `Intl.DisplayNames` shows them as their own entry, "Multiple languages",
 * instead of repeating them under every language.
 */
export const MULTILINGUAL = 'mul';

export type VoiceInfo = {
  /** The raw id within the provider, without the provider prefix */
  id: string;
  label: string;
  /** BCP-47, or MULTILINGUAL for a voice that speaks whatever it is given */
  locale: string;
};

/**
 * No speed, and there is no adding one: every clip is synthesized at the
 * voice's Natural Pace and the owner's 1.5–3× is applied by the playback
 * layer's pitch-preserving time-stretch. A synthesis-time speed would multiply
 * with that, and the cache key is provider, voice and text — deliberately not
 * speed (ADR 0009).
 */
export type SynthesisOptions = {
  voice: string;
  signal: AbortSignal;
};

/**
 * The signal a caller that bounds the listing hands over. Providers may use it
 * to cancel a request. Optional: a connection check lists without one.
 */
export type ListVoicesOptions = {
  signal?: AbortSignal;
};

export interface TTSProvider {
  readonly id: ProviderId;
  readonly capabilities: { wordTimestamps: boolean };
  listVoices(options?: ListVoicesOptions): Promise<VoiceInfo[]>;
  synthesize(text: string, o: SynthesisOptions): Promise<SynthesisResult>;
  /**
   * One cheap request that proves the configuration works — server
   * reachable, key accepted. Rejects with a SynthesisError saying what is
   * wrong. Providers whose listVoices already makes such a request
   * (Speechify, Kokoro) leave this out; OpenAI needs it because its voice
   * list is static and would "succeed" against any URL and any key.
   */
  checkConnection?(): Promise<void>;
  /** The model ids the server offers, for servers that have a model list (OpenAI and its look-alikes). Rejects like checkConnection. */
  listModels?(): Promise<string[]>;
  /**
   * Prove the account can actually synthesize — quota not exhausted, voice
   * accepted — with the smallest possible request (a couple of characters).
   * checkConnection cannot see this: a key lists voices fine long after its
   * quota ran out. Rejects with a SynthesisError whose kind tells quota
   * from auth from network.
   */
  checkSynthesis?(voice: string): Promise<void>;
  /**
   * Whether this configuration yields word timings, proven with a tiny real
   * synthesis (a connection check runs it with the first listed voice).
   * ok=false with a human-readable detail when the server answers but without
   * timings — a wrong server behind the Kokoro provider looks exactly like
   * that. Rejects like synthesize (auth, server down).
   */
  checkWordTimestamps?(voice: string): Promise<{ ok: boolean; detail?: string }>;
}
