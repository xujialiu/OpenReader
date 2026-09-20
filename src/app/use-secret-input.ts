/** A masked editing value, held only by the mounted provider detail screen. */
import { useEffect, useState } from 'react';
import type { ProviderId } from '../core/providers/types';
import type { ProviderSecret } from './use-provider-secrets';
import { flushProviderEdits, saveProviderEdit } from './provider-edits';

export function useSecretInput(id: ProviderId, label: string, secret: ProviderSecret, locked: boolean) {
  const [value, setValue] = useState('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = secret.with;
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const writeError = await flushProviderEdits(id).then(() => null, () => 'The previous edit could not be saved.');
        await read(async (saved) => {
          if (mounted) { setValue(saved); setReady(true); setError(writeError); }
        });
      } catch {
        if (mounted) setError('Credential unavailable. Reopen this page to try again.');
      }
    })();
    return () => { mounted = false; };
  }, [id, read]);

  const change = (next: string) => {
    if (locked || !ready) return;
    setValue(next);
    void saveProviderEdit(id, label, () => next.trim() ? secret.save(next) : secret.forget())
      .then(() => flushProviderEdits(id)).then(() => setError(null), () => setError('Could not save. Try again.'));
  };
  return { value, change, editable: ready && !locked, error };
}
