import { AudioContext, AudioManager, type AudioBufferSourceNode } from 'react-native-audio-api';

/** A short-lived graph for dictionary-supplied audio; no lock-screen ownership. */
export async function playPronunciation(url: string, signal: AbortSignal, onOutputLost: () => void): Promise<void> {
  let context: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  const abort = new AbortController();
  let end: (() => void) | null = null;
  const stop = () => {
    abort.abort();
    if (source) { source.onEnded = null; try { source.stop(); } catch { /* May still be decoding. */ } }
    end?.();
  };
  signal.addEventListener('abort', stop);
  const route = AudioManager.addSystemEventListener('routeChange', (event) => {
    if (event.reason === 'OldDeviceUnavailable') { onOutputLost(); stop(); }
  });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; stop(); }, 15000);
  try {
    if (signal.aborted) return;
    const response = await fetch(url, { signal: abort.signal });
    if (!response.ok) throw new Error('Pronunciation unavailable.');
    const bytes = await response.arrayBuffer();
    if (signal.aborted || abort.signal.aborted) return;
    AudioManager.setAudioSessionOptions({ iosCategory: 'playback', iosMode: 'spokenAudio' });
    await AudioManager.setAudioSessionActivity(true);
    context = new AudioContext();
    const buffer = await context.decodeAudioData(bytes);
    if (signal.aborted || abort.signal.aborted) return;
    source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const ended = new Promise<void>((resolve) => { end = resolve; source!.onEnded = () => resolve(); });
    await context.resume();
    if (signal.aborted || abort.signal.aborted) return;
    source.start();
    await ended;
    if (timedOut) throw new Error('Pronunciation timed out.');
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', stop);
    route?.remove();
    if (source) source.onEnded = null;
    await context?.close();
  }
}
