import { useCallback, useState, useSyncExternalStore } from 'react';
import type { ProviderId } from '../core/providers/types';
import { useShell } from './routes';
import { testProviderConnection } from './provider-connection';
import { flushProviderEdits } from './provider-edits';
import { providerConfiguration } from './settings';
import { rememberVoices } from './voice-catalog';

const checking = new Set<ProviderId>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function setChecking(id: ProviderId, busy: boolean) {
  if (busy) checking.add(id);
  else checking.delete(id);
  for (const listener of listeners) listener();
}

export function useProviderConnection(id: ProviderId) {
  const { settings, setSettings } = useShell();
  const busy = useSyncExternalStore(subscribe, () => checking.has(id));
  const config = providerConfiguration(settings, id);
  const [result, setResult] = useState<{ id: ProviderId; config: typeof config; note: string | null } | null>(null);
  const clearNote = useCallback(() => setResult(null), []);
  if (result && (result.id !== id || result.config !== config)) setResult(null);
  const enabled = settings.enabledProviders.includes(id);

  const run = async (enable: boolean) => {
    if (checking.has(id)) return;
    // A later visit still sees the running check. Only this visit owns its note.
    const pending = { id, config, note: null };
    setResult(pending);
    setChecking(id, true);
    let note: string;
    try {
      await flushProviderEdits(id);
      const voices = await testProviderConnection(settings, id);
      rememberVoices(settings, id, voices);
      if (enable) setSettings((previous) => ({ ...previous,
        enabledProviders: [...new Set([...previous.enabledProviders, id])] }));
      note = 'Connection successful';
    } catch (problem) {
      note = problem instanceof Error ? problem.message : 'Connection failed. Try again.';
    } finally {
      setChecking(id, false);
    }
    setResult((current) => current === pending ? { ...pending, note } : current);
  };
  const disable = () => {
    setSettings((previous) => ({ ...previous, enabledProviders: previous.enabledProviders.filter((provider) => provider !== id) }));
    clearNote();
  };
  return { enabled, busy, note: result?.note ?? null, clearNote, test: () => run(false),
    toggle: () => enabled ? disable() : void run(true) };
}
