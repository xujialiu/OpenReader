import { AudioManager, type AudioContext, type AudioBufferSourceNode } from 'react-native-audio-api';
import { createNativeAudioContext } from '../playback/audio-graph';

/**
 * A short-lived graph for dictionary-supplied audio; no lock-screen ownership.
 *
 * `onAudioLost` is called when the sound cannot go on: the headphones came out,
 * or iOS took the audio away (#303). Interruptions are observed in JavaScript
 * since #303 (`audio-graph.ts`), so the library no longer resumes this graph by
 * itself; an interrupted Pronunciation ends here instead of running to its deadline.
 */
export async function playPronunciation(url: string, signal: AbortSignal, onAudioLost: () => void): Promise<void> {
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
    if (event.reason === 'OldDeviceUnavailable') { onAudioLost(); stop(); }
  });
  AudioManager.observeAudioInterruptions(true);
  const interruption = AudioManager.addSystemEventListener('interruption', (event) => {
    if (event.type === 'began') { onAudioLost(); stop(); }
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
    context = createNativeAudioContext();
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
    interruption?.remove();
    if (source) source.onEnded = null;
    await context?.close();
  }
}
