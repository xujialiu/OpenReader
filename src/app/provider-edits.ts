/** Serialize credential autosaves across screens, so Enable always tests the latest edit. */
import type { ProviderId } from '../core/providers/types';
const writes = new Map<ProviderId, Promise<void>>();
const failures = new Map<string, string>();
export function saveProviderEdit(id: ProviderId, field: string, write: () => Promise<string | null>): Promise<void> {
  const next = (writes.get(id) ?? Promise.resolve()).then(async () => {
    try {
      const error = await write();
      if (error) failures.set(`${id}:${field}`, 'Credentials could not be saved. Try editing again.');
      else failures.delete(`${id}:${field}`);
    } catch { failures.set(`${id}:${field}`, 'Credentials could not be saved. Try editing again.'); }
  });
  writes.set(id, next);
  return next;
}
export async function flushProviderEdits(id: ProviderId): Promise<void> {
  await writes.get(id);
  const error = [...failures].find(([field]) => field.startsWith(`${id}:`))?.[1];
  if (error) throw new Error(error);
}
