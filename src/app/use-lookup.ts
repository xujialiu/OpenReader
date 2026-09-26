import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { readTranslationKey } from '../keys/store';
import type { ReaderBridge } from '../renderer/reader-bridge';
import { lookup, type LookupResult } from '../translation/services';
import { createPronunciationController } from '../translation/pronunciation';
import { playPronunciation } from '../translation/pronunciation-audio';
import type { LookupMode, LookupSettings } from '../translation/settings';

export interface LookupSelection { text: string; mode: LookupMode; selecting: boolean; attempt: number }
export function useLookup(settings: LookupSettings, reading: {
  bridge: ReaderBridge; pause(): void; play(): void; status: { playing: boolean };
}, focused: boolean) {
  const [selection, setSelection] = useState<LookupSelection | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [pronouncing, setPronouncing] = useState(false);
  const [loading, setLoading] = useState(false);
  const opened = useRef(false);
  const latest = useRef({ settings, reading });
  useEffect(() => { latest.current = { settings, reading }; }, [settings, reading]);
  // The controller stores callbacks; reading state is consulted only on playback events.
  // eslint-disable-next-line react-hooks/refs
  const pronunciation = useMemo(() => createPronunciationController({
    playing: () => latest.current.reading.status.playing,
    pause: () => latest.current.reading.pause(),
    resume: () => latest.current.reading.play(),
    audio: (url, signal) => playPronunciation(url, signal, () => pronunciation.stop(false)),
    changed: setPronouncing,
    failed: setAudioError,
  }), []);
  const close = useCallback((resumeAudio = true) => {
    pronunciation.stop(resumeAudio);
    opened.current = false;
    setSelection(null); setResult(null); setError(null); setAudioError(null);
    latest.current.reading.bridge.closeLookup(resumeAudio && latest.current.reading.status.playing);
  }, [pronunciation]);

  useEffect(() => {
    const bridge = reading.bridge;
    bridge.setLookupEnabled(settings.enabled && focused);
    // Losing focus tears down the external selection and audio session together.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!settings.enabled || !focused) close(false);
    const unsubscribe = bridge.onSelection((message) => {
      if (!latest.current.settings.enabled) return;
      if (!opened.current) {
        opened.current = true;
        if (latest.current.settings.pauseReading) latest.current.reading.pause();
      }
      if (message.selecting) pronunciation.stop();
      setSelection((previous) => {
        if (previous?.text === message.text && previous.selecting === message.selecting) return previous;
        return { text: message.text, mode: message.expanded ? 'translation' : 'dictionary', selecting: message.selecting, attempt: 0 };
      });
    });
    return unsubscribe;
  }, [settings.enabled, focused, reading.bridge, close, pronunciation]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => { if (state !== 'active') close(false); });
    return () => { subscription.remove(); pronunciation.stop(false); };
  }, [close, pronunciation]);

  useEffect(() => {
    // Clear the previous network response as the subscribed selection changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResult(null); setError(null); setAudioError(null);
    pronunciation.stop();
    if (!selection || selection.selecting) { setLoading(false); return; }
    const abort = new AbortController();
    let live = true;
    setLoading(true);
    void (async () => {
      let microsoftKey: string | undefined;
      if (selection.mode === 'translation' && settings.service === 'microsoft') {
        const saved = await readTranslationKey();
        if (saved.outcome === 'refused') throw new Error('The Microsoft Translator key could not be read.');
        if (saved.outcome === 'found') microsoftKey = saved.secret;
      }
      if (!live) return;
      const answer = await lookup({ ...settings, ...selection, microsoftKey }, { fetch: (url, init) => fetch(url, init), signal: abort.signal });
      if (live) setResult(answer);
    })().catch((failure: unknown) => {
      if (live) setError(failure instanceof Error ? failure.message : 'The request failed. Try again.');
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; abort.abort(); };
  }, [selection, settings, pronunciation]);

  const mode = (next: LookupMode) => setSelection((was) => was ? { ...was, mode: next, selecting: false } : null);
  const retry = () => setSelection((was) => was ? { ...was, selecting: false, attempt: was.attempt + 1 } : null);
  const pronounce = (url: string) => { setAudioError(null); void pronunciation.play(url); };
  return { selection, result, error, audioError, loading, pronouncing, close, mode, retry, pronounce, stopPronunciation: pronunciation.stop };
}
export type LookupHandle = ReturnType<typeof useLookup>;
