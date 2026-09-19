import { describe, expect, it } from 'vitest';
import { PCM_SAMPLE_RATE, base64ToBytes, concatBytes, pcmSeconds, readClip, sniffContainer } from '../../../src/core/providers/audio';

/**
 * The decision ADR 0013 turns on: a provider asks its server for PCM, and this
 * is what says whether PCM is what came back. Getting it wrong in one direction
 * is an error the owner sees; getting it wrong in the other is noise out of the
 * speaker, which is why the container signatures are checked before anything
 * the server merely claims.
 */

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const join = (...parts: Uint8Array[]) => concatBytes(parts.map((p) => Uint8Array.from(p)));

/** Two seconds of 16-bit mono silence at the documented rate. */
const silence = (samples: number) => new Uint8Array(samples * 2);

describe('base64ToBytes', () => {
  it('decodes byte for byte, including bytes no text encoding would survive', () => {
    expect(Array.from(base64ToBytes('AQID'))).toEqual([1, 2, 3]);
    const raw = bytes(0xff, 0xfb, 0x90, 0x00, 0x00, 0x7f, 0x80, 0xfe);
    expect(base64ToBytes(btoa(String.fromCharCode(...raw)))).toEqual(raw);
  });

  it('ignores the whitespace a JSON reply may have wrapped it in', () => {
    expect(Array.from(base64ToBytes('AQ ID\n'))).toEqual([1, 2, 3]);
  });

  it('throws on text that is not base64, so the caller can report decode-failed', () => {
    expect(() => base64ToBytes('not-valid-base64!!!')).toThrow();
  });
});

describe('concatBytes and pcmSeconds', () => {
  it('joins the pieces of one utterance end to end', () => {
    expect(Array.from(concatBytes([bytes(1, 2), bytes(3), new Uint8Array(0), bytes(4)]))).toEqual([1, 2, 3, 4]);
    expect(concatBytes([]).length).toBe(0);
  });

  // This is what moves a later piece's word timings, so it is the arithmetic
  // a drifting highlight would come from: two bytes a sample, one channel
  it('turns a length of 16-bit mono samples into seconds', () => {
    expect(pcmSeconds(2 * PCM_SAMPLE_RATE, PCM_SAMPLE_RATE)).toBe(1);
    expect(pcmSeconds(0, PCM_SAMPLE_RATE)).toBe(0);
    expect(pcmSeconds(2 * 16_000, 16_000)).toBe(1);
  });
});

describe('sniffContainer', () => {
  it('knows the containers a server may answer with instead of samples', () => {
    expect(sniffContainer(join(ascii('ID3'), bytes(0x04, 0x00)))).toBe('audio/mpeg');
    expect(sniffContainer(join(ascii('RIFF'), bytes(0, 0, 0, 0), ascii('WAVEfmt ')))).toBe('audio/wav');
    expect(sniffContainer(ascii('OggS\u0000\u0002'))).toBe('audio/ogg');
    expect(sniffContainer(ascii('fLaC\u0000'))).toBe('audio/flac');
    expect(sniffContainer(join(bytes(0, 0, 0, 0x20), ascii('ftypM4A ')))).toBe('audio/mp4');
  });

  it('says nothing about raw samples, which have no signature to find', () => {
    expect(sniffContainer(silence(10))).toBeNull();
    expect(sniffContainer(new Uint8Array(0))).toBeNull();
    // Loud samples, not a container
    expect(sniffContainer(bytes(0x2f, 0x1a, 0xd0, 0xff))).toBeNull();
  });

  // RIFF without WAVE is an AVI or a WebP; guessing audio/wav for it would hand
  // the decoder a file it cannot read while claiming to know what it is
  it('requires the WAVE tag before calling a RIFF file audio', () => {
    expect(sniffContainer(join(ascii('RIFF'), bytes(0, 0, 0, 0), ascii('AVI ')))).toBeNull();
  });

  it('requires an ID3 version byte, so three letters alone are not enough', () => {
    expect(sniffContainer(join(ascii('ID3'), bytes(0x99)))).toBeNull();
  });
});

describe('readClip', () => {
  it('reports the samples that were asked for when nothing contradicts them', () => {
    const samples = silence(4);
    expect(readClip(samples, 'audio/pcm')).toEqual({ audio: 'pcm', samples, sampleRate: PCM_SAMPLE_RATE });
    expect(readClip(samples, 'audio/L16')).toMatchObject({ audio: 'pcm' });
    expect(readClip(samples, 'audio/x-pcm')).toMatchObject({ audio: 'pcm' });
  });

  // RFC 2586's parameter: a server that resamples has to be able to say so, or
  // every word timing in the clip is scaled by the wrong factor
  it('takes the sample rate the content type names, when it names one', () => {
    expect(readClip(silence(4), 'audio/L16;rate=16000')).toMatchObject({ sampleRate: 16_000 });
    expect(readClip(silence(4), 'audio/L16; rate="8000"; channels=1')).toMatchObject({ sampleRate: 8000 });
    expect(readClip(silence(4), 'audio/L16;rate=0')).toMatchObject({ sampleRate: PCM_SAMPLE_RATE });
  });

  it('reports the type a server declares for anything that is not samples', () => {
    const encoded = bytes(0x11, 0x22, 0x33, 0x44);
    expect(readClip(encoded, 'audio/mpeg')).toEqual({ audio: 'encoded', bytes: encoded, mediaType: 'audio/mpeg' });
    expect(readClip(encoded, 'audio/ogg; codecs=opus')).toMatchObject({ mediaType: 'audio/ogg' });
  });

  // The bytes are the truth: a server that declares PCM and sends a WAV is
  // reported as sending a WAV, because that is what the decoder will be given
  it('believes the bytes over the declaration', () => {
    const wav = join(ascii('RIFF'), bytes(0, 0, 0, 0), ascii('WAVEfmt '));
    expect(readClip(wav, 'audio/pcm')).toMatchObject({ audio: 'encoded', mediaType: 'audio/wav' });
  });

  // Kokoro's captioned route answers JSON, so its audio arrives with no type at
  // all; a server that ignored `response_format: pcm` would otherwise have its
  // MP3 frames played as samples, which is noise rather than an error
  it('recognises MP3 frames in a reply that declared nothing', () => {
    expect(readClip(bytes(0xff, 0xfb, 0x90, 0x00))).toMatchObject({ audio: 'encoded', mediaType: 'audio/mpeg' });
    expect(readClip(bytes(0xff, 0xf3, 0x48, 0xc4))).toMatchObject({ audio: 'encoded', mediaType: 'audio/mpeg' });
  });

  it('does not take near-silent samples for MP3 frames', () => {
    // Sample pairs around zero, which is how a clip starts: 0xFF 0xFF is -1,
    // and the byte after it lands on a bitrate index no frame header uses
    expect(readClip(bytes(0xff, 0xff, 0xff, 0xff))).toMatchObject({ audio: 'pcm' });
    expect(readClip(bytes(0xff, 0xff, 0x01, 0x00))).toMatchObject({ audio: 'pcm' });
    expect(readClip(silence(8))).toMatchObject({ audio: 'pcm' });
  });

  it('treats an undeclared or unhelpful type as the samples it asked for', () => {
    expect(readClip(silence(2))).toMatchObject({ audio: 'pcm', sampleRate: PCM_SAMPLE_RATE });
    expect(readClip(silence(2), null)).toMatchObject({ audio: 'pcm' });
    expect(readClip(silence(2), 'application/octet-stream')).toMatchObject({ audio: 'pcm' });
  });

  // An utterance with nothing speakable in it, which plays as a short pause
  it('reads no bytes at all as no samples rather than as an error', () => {
    expect(readClip(new Uint8Array(0))).toEqual({ audio: 'pcm', samples: new Uint8Array(0), sampleRate: PCM_SAMPLE_RATE });
  });
});
