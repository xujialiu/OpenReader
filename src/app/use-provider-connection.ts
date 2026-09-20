import { useSyncExternalStore } from 'react';
import type { ProviderId } from '../core/providers/types';
import { useShell } from './routes';
import { testProviderConnection } from './provider-connection';
import { flushProviderEdits } from './provider-edits';
import { rememberVoices } from './voice-catalog';

type Check = { busy: boolean; note: string | null };
const idle: Check = { busy: false, note: null };
const checks = new Map<ProviderId, Check>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function publish(id: ProviderId, state: Check) {
  checks.set(id, state);
  for (const listener of listeners) listener();
}

/** List and detail share one in-flight check; navigating back cannot start another. */
export function useProviderConnection(id: ProviderId) {
  const { settings, setSettings } = useShell();
  const state = useSyncExternalStore(subscribe, () => checks.get(id) ?? idle);
  const enabled = settings.enabledProviders.includes(id);
  const run = async (enable: boolean) => {
    if (checks.get(id)?.busy) return;
    publish(id, { busy: true, note: null });
    try {
      await flushProviderEdits(id);
      const voices = await testProviderConnection(settings, id);
      rememberVoices(settings, id, voices);
      if (enable) setSettings((previous) => ({ ...previous,
        enabledProviders: [...new Set([...previous.enabledProviders, id])] }));
      publish(id, { busy: false, note: 'Connection successful' });
    } catch (problem) {
      publish(id, { busy: false, note: problem instanceof Error ? problem.message : 'Connection failed. Try again.' });
    }
  };
  const disable = () => {
    setSettings((previous) => ({ ...previous, enabledProviders: previous.enabledProviders.filter((provider) => provider !== id) }));
    publish(id, idle);
  };
  return { enabled, ...state, test: () => run(false), toggle: () => enabled ? disable() : void run(true) };
}
