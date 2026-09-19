/**
 * The one thing read out of a WAV: how many bytes of samples it holds. macOS
 * `say` writes a header whose `data` chunk is zero bytes long for text it
 * cannot voice — an empty or whitespace-only string, measured 2026-09-06 — and
 * a decoder handed that file fails, which is heard as a silent stop rather than
 * as an error. So the length is checked first and such a clip becomes silence,
 * which plays as a short pause and reading continues.
 *
 * Chunks are walked, not assumed to start at offset 44: `say` puts a 4044-byte
 * `FLLR` filler between `fmt ` and `data` to align the samples to 4096.
 */
export function wavDataLength(bytes: Uint8Array): number | null {
  if (bytes.length < 12) return null;
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  while (at + 8 <= bytes.length) {
    const name = tag(at);
    const size = view.getUint32(at + 4, true);
    const start = at + 8;
    // A declared size past the end of the file counts only what is there
    if (name === 'data') return Math.min(size, bytes.length - start);
    // Chunks are word-aligned: an odd size carries one pad byte
    at = start + size + (size & 1);
  }
  return null;
}

/**
 * Raw 16-bit mono samples as the bytes of a WAV: the 44-byte header, then the
 * samples byte for byte. For the pieces of an utterance that Speechify has to
 * take in parts, whose own WAV declares a data chunk of 26 bytes whatever it
 * actually holds (measured 2026-09-09).
 *
 * The plugin returned a `Blob` here and this returns the bytes, for two
 * reasons that point the same way: React Native's `Blob` constructor rejects a
 * `Uint8Array` outright, and under ADR 0013 a synthesis result is PCM plus a
 * sample rate, so nothing downstream asks for a blob any more.
 */
export function pcm16ToWav(samples: Uint8Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(44 + samples.length);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples.length, true);
  out.set(samples, 44);
  return out;
}
