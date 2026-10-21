import { SynthesisError } from './errors';
import { readClip } from './audio';
import { serverReason } from './server-reason';
import type { SynthesisResult } from './types';

/** A received response is not a completed transfer (#203). Keep transport
 * failures distinct from parsing a complete, malformed reply. The native Expo
 * readers are patched to reject on a lost transfer; the caller's existing
 * deadline still bounds a server that neither completes nor reports failure. */
async function consume<T>(read: () => Promise<T>, what: string, signal?: AbortSignal): Promise<T> {
  const cancelled = () => new SynthesisError('unknown', `${what}: request aborted`);
  if (signal?.aborted) throw cancelled();
  let onAbort: (() => void) | undefined;
  const abort = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(cancelled());
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([read(), abort]);
  } catch (error) {
    if (signal?.aborted) throw cancelled();
    if (error instanceof SynthesisError) throw error;
    throw new SynthesisError('network', `${what}: the response connection was lost (${String(error)})`);
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

export function throwIfAborted(signal: AbortSignal | null | undefined, what: string): void {
  if (signal?.aborted) throw new SynthesisError('unknown', `${what}: request aborted`);
}

export const responseText = (response: Response, what: string, signal?: AbortSignal): Promise<string> =>
  consume(() => response.text(), what, signal);

/** Once HTTP has refused a request, a lost error body must not turn a known
 * auth/quota refusal into a retriable network failure. Cancellation still wins. */
export async function responseErrorText(response: Response, what: string, signal?: AbortSignal): Promise<string> {
  try { return await responseText(response, what, signal); }
  catch (error) {
    if (signal?.aborted) throw error;
    return '';
  }
}

export const responseBytes = async (response: Response, what: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await consume(() => response.arrayBuffer(), what, signal));

/** Only raw-audio routes use this. Fish's event stream and JSON envelopes
 * deliberately carry non-audio types and must be parsed by their Provider.
 *
 * A reply with no bytes is refused whatever it declares: a 204, or a 200 whose
 * body a gateway swallowed. Read as zero samples of PCM it played as a silence
 * and the sentence was passed over unheard, where every other Provider stops
 * on "no audio" (ADR 0027, ADR 0037, #235). Only speakable text is sent. */
export async function responseAudio(response: Response, what: string, signal?: AbortSignal): Promise<SynthesisResult> {
  const type = response.headers.get('Content-Type');
  const essence = type?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (essence && essence !== 'application/octet-stream' && !essence.startsWith('audio/')) {
    const reason = serverReason(await responseText(response, what, signal));
    throw new SynthesisError('decode-failed', `${what}: the server returned ${essence}, not audio${reason ? ` — ${reason}` : ''}`);
  }
  const bytes = await responseBytes(response, what, signal);
  if (bytes.byteLength === 0) throw new SynthesisError('unknown', `${what}: the reply carried no audio`);
  return readClip(bytes, type);
}

/** JSON parsing is outside consume: only an incomplete transfer is network. */
export async function responseJSON<T>(response: Response, what: string, signal?: AbortSignal): Promise<T> {
  return JSON.parse(await responseText(response, what, signal)) as T;
}
