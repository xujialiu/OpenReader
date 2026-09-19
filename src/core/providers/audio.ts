import type { SynthesisResult } from './types';

/**
 * The bytes half of the contract change (ADR 0013): base64 in, and the one
 * decision a provider has to make about what came back — are these samples, or
 * are they a container someone still has to decode?
 *
 * It lives here because three providers made it separately in the plugin, each
 * with its own copy of the base64 loop and its own `new Blob([bytes], { type })`.
 */

/**
 * The rate every provider on the list documents for raw PCM: OpenAI's
 * `response_format: "pcm"` ("raw samples … 24kHz, 16-bit signed,
 * little-endian, without header"), Kokoro's own output rate, and Speechify's
 * `pcm_24000`. It is what a reply is taken to be when the reply itself says
 * nothing; where a reply names a rate, the named rate wins.
 */
export const PCM_SAMPLE_RATE = 24_000;

/**
 * Base64 to bytes, byte for byte; throws on text that is not base64.
 *
 * `atob` is a global here and is binary-safe — measured on this Hermes, not
 * assumed, because nothing under `react-native/Libraries/` defines it:
 * `atob('//7//w==')` gives char codes 255,254,255,255, which is what makes the
 * byte-for-byte loop below sound and a base64 library unnecessary. See
 * notes/NOTES_2026-09-19.md. The plugin's three copies of this each carried a
 * comment about the Zotero sandbox's whitelist, which says nothing about React
 * Native and has been dropped.
 */
export function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The bytes of several replies end to end, for an utterance that had to be asked for in pieces. */
export function concatBytes(chunks: readonly Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** How long that many bytes of 16-bit mono PCM last — two bytes a sample, one channel. It is what turns a piece's length into the offset the next piece's words move by, so it is where a drifting highlight would come from. */
export function pcmSeconds(bytes: number, sampleRate: number): number {
  return bytes / (2 * sampleRate);
}

/** A `Content-Type` without its parameters, lowercased: `audio/L16;rate=16000` → `audio/l16`. */
const essenceOf = (contentType: string | null | undefined): string => (contentType ?? '').split(';')[0].trim().toLowerCase();

/** The media types that name raw samples rather than a container. `audio/L16` is the registered one (RFC 2586); the rest are what servers write in practice. */
const PCM_TYPES = new Set(['audio/l16', 'audio/pcm', 'audio/x-pcm', 'audio/raw']);

/** `audio/L16;rate=16000` — the one parameter that changes how the samples must be played. */
function declaredRate(contentType: string | null | undefined): number | null {
  const rate = /;\s*rate\s*=\s*"?(\d+)/i.exec(contentType ?? '');
  const hz = rate ? Number(rate[1]) : NaN;
  return Number.isFinite(hz) && hz > 0 ? hz : null;
}

const ascii = (bytes: Uint8Array, at: number, text: string): boolean => {
  if (at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
};

/**
 * The first frame header of an MP3 that carries no ID3 tag: eleven sync bits,
 * then a version, a layer and a bitrate index that are not the reserved values.
 *
 * This is a heuristic and the only one here, so it is used last — after the
 * server's own declaration — and the checks beyond the sync bits are what make
 * it usable. A quiet PCM clip starts with samples near zero, whose low bytes
 * land on bitrate index 0 or 15, both of which are refused below; the pattern
 * that survives needs sample 0 to be exactly -1 and sample 1 to be loud. The
 * residual risk is one clip reported as `encoded` and failing to decode, which
 * is a visible error. Reporting MP3 frames as PCM instead would be noise, and
 * noise is worse than an error.
 */
function looksLikeMp3Frame(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] !== 0xff || (bytes[1] & 0xe0) !== 0xe0) return false;
  if ((bytes[1] & 0x18) === 0x08) return false; // reserved MPEG version
  if ((bytes[1] & 0x06) === 0x00) return false; // reserved layer
  const bitrate = bytes[2] >> 4;
  return bitrate !== 0x0 && bitrate !== 0xf; // free-format and invalid
}

/**
 * The media type of the container these bytes begin with, or null when they
 * begin with nothing recognisable — which, for the reply to a request that
 * asked for PCM, means the samples themselves. Raw PCM has no header to
 * recognise, so this can only ever rule PCM out, never confirm it.
 *
 * Every signature here is four bytes, so a PCM clip matching one by accident is
 * a one-in-four-billion coincidence rather than something to design around.
 */
export function sniffContainer(bytes: Uint8Array): string | null {
  // ID3v2, whose major version is 2, 3 or 4 — the fourth byte that makes this a four-byte test
  if (ascii(bytes, 0, 'ID3') && bytes.length > 3 && bytes[3] < 0x10) return 'audio/mpeg';
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE')) return 'audio/wav';
  if (ascii(bytes, 0, 'OggS')) return 'audio/ogg';
  if (ascii(bytes, 0, 'fLaC')) return 'audio/flac';
  // AAC and ALAC arrive in an MP4 box, whose first box is `....ftyp`
  if (ascii(bytes, 4, 'ftyp')) return 'audio/mp4';
  // Bare ADTS AAC is deliberately absent: its signature is two bytes, one of
  // which a PCM sample pair matches once in 65,536 clips, and it never arrives
  // undeclared — a server that sends AAC says `audio/aac`, and readClip
  // believes a server that says what it sent.
  return null;
}

/**
 * What a reply's bytes are. PCM is what every provider here asks its server
 * for, so PCM is the answer unless something says otherwise, in this order:
 *
 * 1. a container signature in the bytes — the bytes are the truth, whatever was
 *    declared;
 * 2. a `Content-Type` naming raw samples — `pcm`, at the rate the type names if
 *    it names one;
 * 3. any other `audio/…` type — `encoded`, as declared, because a server that
 *    says what it sent is believed;
 * 4. an MP3 frame header, for a reply that declared nothing at all (Kokoro's
 *    captioned route answers JSON, so its audio arrives without a type);
 * 5. otherwise the samples that were asked for.
 */
export function readClip(bytes: Uint8Array<ArrayBuffer>, contentType?: string | null): SynthesisResult {
  const pcm = (sampleRate: number): SynthesisResult => ({ audio: 'pcm', samples: bytes, sampleRate });
  const encoded = (mediaType: string): SynthesisResult => ({ audio: 'encoded', bytes, mediaType });

  const container = sniffContainer(bytes);
  if (container) return encoded(container);

  const essence = essenceOf(contentType);
  if (PCM_TYPES.has(essence)) return pcm(declaredRate(contentType) ?? PCM_SAMPLE_RATE);
  // `application/octet-stream` is "some bytes", which is no declaration at all
  if (essence.startsWith('audio/')) return encoded(essence);

  if (looksLikeMp3Frame(bytes)) return encoded('audio/mpeg');
  return pcm(PCM_SAMPLE_RATE);
}
