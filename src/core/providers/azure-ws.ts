import type { TimedWord } from '../align';

/**
 * Azure's WebSocket protocol, spoken by hand: the frames `azure.ts` sends and
 * reads, and nothing that touches a socket (ADR 0037).
 *
 * This is the plugin's `azure-ws.ts`. It is the protocol the Speech SDK speaks,
 * which Microsoft does not document, so what it says about a frame's shape was
 * measured rather than read: from Node on 2026-09-22 with the owner's key
 * (notes/NOTES_2026-09-22.md, 14:30), and in the plugin since August.
 *
 * - A **text frame** is header lines, a blank line, then the body. The server
 *   writes its headers with no space after the colon (`Path:turn.end`); ours
 *   carry one, and both are read.
 * - A **binary frame** is a two-byte big-endian header length, that many bytes
 *   of header lines, then the payload. For `raw-24khz-16bit-mono-pcm` the
 *   payload is samples, with `Content-Type:audio/basic`, and the last audio
 *   frame of a turn is empty.
 * - A word boundary arrives in an `audio.metadata` frame of its own, in 100 ns
 *   ticks, with its text and no offset into the text that was sent.
 */

/** Azure's time unit is a 100-nanosecond tick. */
const TICKS_PER_SECOND = 10_000_000;

export function buildTextFrame(headers: Record<string, string>, body: string): string {
  const head = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n');
  return `${head}\r\n\r\n${body}`;
}

export function parseTextFrame(raw: string): { headers: Record<string, string>; body: string } {
  const split = raw.indexOf('\r\n\r\n');
  const headText = split === -1 ? raw : raw.slice(0, split);
  const body = split === -1 ? '' : raw.slice(split + 4);

  const headers: Record<string, string> = {};
  for (const line of headText.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { headers, body };
}

/**
 * A binary frame's headers and payload. Throws on a buffer too short to hold
 * the header it announces, which the caller turns into a rejection.
 *
 * The payload is a view on the frame's own buffer, not a copy: `concatBytes`
 * copies once, when the turn ends.
 */
export function parseBinaryFrame(buf: ArrayBuffer): {
  headers: Record<string, string>;
  payload: Uint8Array<ArrayBuffer>;
} {
  const view = new DataView(buf);
  const headerLength = view.getUint16(0, false);
  const headerText = new TextDecoder().decode(new Uint8Array(buf, 2, headerLength));
  const { headers } = parseTextFrame(headerText + '\r\n\r\n');
  return { headers, payload: new Uint8Array(buf, 2 + headerLength) };
}

function escapeXML(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The document one turn speaks.
 *
 * No `<prosody rate>`: every clip is made at the voice's Natural Pace and the
 * owner's speed is applied on playback (ADR 0009). `xml:lang` stays the
 * plugin's `en-US` whatever the voice, which is what a Chinese voice was
 * measured reading Chinese under (notes/NOTES_2026-09-22.md, 14:30).
 */
export function buildSSML(text: string, voice: string): string {
  return (
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">' +
    `<voice name="${escapeXML(voice)}">` +
    escapeXML(text) +
    '</voice></speak>'
  );
}

type MetadataEntry = {
  Type?: string;
  Data?: { Offset?: number; Duration?: number; text?: { Text?: string } };
};

/**
 * The word boundaries in an `audio.metadata` frame, as seconds.
 *
 * Fault-tolerant, as the plugin wrote it: anything it cannot read is no words,
 * which leaves the clip to be highlighted whole rather than failing it.
 */
export function parseWordBoundaries(body: string): TimedWord[] {
  let parsed: { Metadata?: MetadataEntry[] };
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed?.Metadata)) return [];

  const words: TimedWord[] = [];
  for (const entry of parsed.Metadata) {
    if (entry?.Type !== 'WordBoundary') continue;
    const text = entry.Data?.text?.Text;
    const offset = entry.Data?.Offset;
    const duration = entry.Data?.Duration;
    if (typeof text !== 'string' || typeof offset !== 'number' || typeof duration !== 'number') {
      continue;
    }
    words.push({
      text,
      start: offset / TICKS_PER_SECOND,
      end: (offset + duration) / TICKS_PER_SECOND,
    });
  }
  return words;
}

/**
 * How many words at the end of a clip Azure pinned to one instant: the run of
 * trailing boundaries with no duration at one offset, when it is two or more
 * long, else 0.
 *
 * It is what the `:DragonLatestNeural` voices send once a clip passes about
 * 9.5 s: 37 of 66 boundaries at `Offset: 95900000` with `Duration: 0`, on every
 * run and whatever the words (the plugin's notes, 2026-09-07). The page lights
 * each word at its start, so those words would all light at the pin and the
 * last one would stay lit while the voice went on — the mark in the wrong place
 * that ADR 0005 forbids. The caller drops the clip's timings instead.
 *
 * By the data and not by the voice's name, so it stops applying on its own if
 * Azure fixes the voices. Two, because no spoken word has no length: a single
 * zero-length boundary at the end is left alone.
 */
export function pinnedTail(words: readonly TimedWord[]): number {
  const last = words[words.length - 1];
  if (!last || last.end !== last.start) return 0;
  let run = 0;
  for (let i = words.length - 1; i >= 0 && words[i].start === last.start && words[i].end === words[i].start; i--) run++;
  return run >= 2 ? run : 0;
}
