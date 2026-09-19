/**
 * PCM bytes into the samples an `AudioBuffer` holds, and the one resampling
 * this directory does.
 *
 * ADR 0013's contract is exact about what arrives: `pcm` means **16-bit signed
 * little-endian mono, at `sampleRate` hertz**, no container and no header. Web
 * Audio buffers hold `Float32Array` normalised to [-1, 1], so somebody has to
 * convert, and doing it here rather than in the graph keeps it runnable under
 * Node and therefore tested — a sign error or a swapped byte order is inaudible
 * as a bug report and obvious as a test.
 */

/**
 * The divisor, and the reason it is 32768 rather than 32767: 16-bit signed
 * samples run from -32768 to 32767, so dividing by 32768 maps the whole range
 * into [-1, 1) without clipping the most negative sample. Dividing by 32767
 * would push -32768 to just past -1, which every mixer then clips.
 */
const FULL_SCALE = 32768;

/** Bytes per frame: two, because the contract is 16-bit mono. */
export const BYTES_PER_FRAME = 2;

/** How many whole frames that many bytes hold. An odd byte count is a truncated reply; the trailing half-sample is dropped rather than read as a sample of noise. */
export function frameCount(byteLength: number): number {
  return Math.floor(byteLength / BYTES_PER_FRAME);
}

/**
 * 16-bit signed little-endian mono bytes as normalised float samples.
 *
 * Read byte by byte rather than through a `DataView` or an `Int16Array` view:
 * the bytes arrive as a `Uint8Array` over a buffer the provider layer built, and
 * an `Int16Array` view requires the byte offset to be two-aligned, which nothing
 * in the contract promises. Little-endian is spelled out rather than inherited
 * from the platform's endianness, because ADR 0013 fixes it and ARM would
 * otherwise agree by luck.
 */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  const frames = frameCount(bytes.byteLength);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const low = bytes[i * 2]!;
    const high = bytes[i * 2 + 1]!;
    // Two's complement from the unsigned pair: values at or above 0x8000 are negative.
    const unsigned = low | (high << 8);
    const signed = unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
    out[i] = signed / FULL_SCALE;
  }
  return out;
}

/**
 * Linear resampling of mono samples.
 *
 * Needed because of what the queue node's clock is made of. `AudioBufferQueueSourceNode::getCurrentPosition()`
 * is `sampleFrameToTime(vReadIndex_, getContextSampleRate()) + playedBuffersDuration_`:
 * the read index into the current buffer is divided by the **context's** sample
 * rate, while `playedBuffersDuration_` accumulates each buffer's `size / its own
 * sampleRate`. A buffer enqueued at any rate other than the context's therefore
 * both plays at the wrong speed — `runBufferProcessor` is handed the playback
 * rate and nothing else, so no resampling factor is applied anywhere in
 * `QueueBufferProcessor` — and mixes two units into the one number the highlight
 * follows. Read out of the library's source, like the footguns.
 *
 * So the context is created at the first Clip's own rate and this function
 * exists for the Clip that then disagrees — a reply that declared
 * `audio/L16;rate=16000` where the last one was 24 kHz. It is not on the normal
 * path: every Provider on ADR 0013's list emits 24 kHz.
 *
 * Linear rather than windowed-sinc on purpose. It runs on a mismatch only, the
 * material is speech, and a resampler good enough to be worth its own file would
 * be a second signal-processing implementation in a project that already has the
 * native WSOLA stretcher for the part that matters.
 */
export function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array<ArrayBuffer> {
  if (fromRate === toRate || samples.length === 0) return copyOf(samples);
  const ratio = fromRate / toRate;
  const frames = Math.max(1, Math.round(samples.length / ratio));
  const out = new Float32Array(frames);
  const last = samples.length - 1;
  for (let i = 0; i < frames; i++) {
    const at = i * ratio;
    const index = Math.floor(at);
    if (index >= last) {
      out[i] = samples[last]!;
      continue;
    }
    const fraction = at - index;
    const a = samples[index]!;
    out[i] = a + fraction * (samples[index + 1]! - a);
  }
  return out;
}

/** A `Float32Array` over its own `ArrayBuffer`, which is what `AudioBuffer.copyToChannel` is typed for. */
function copyOf(samples: Float32Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(samples.length);
  out.set(samples);
  return out;
}
