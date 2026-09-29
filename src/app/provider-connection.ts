/** A connection check uses the target provider's credentials, independent of the document's voice. */
import { createProvider } from '../core/providers/factory';
import type { ProviderId, VoiceInfo } from '../core/providers/types';
import { withTimeout } from '../core/timeout';
import { readProviderKey, readGatewayHeaders } from '../keys/store';
import { headersAreOffered, keyIsOffered, missingBeforeVoice, providerDepsFor, providerSettings, readinessSentence, type AppSettings } from './settings';

export async function testProviderConnection(settings: AppSettings, id: ProviderId): Promise<readonly VoiceInfo[]> {
  const abort = new AbortController();
  return withTimeout((async () => {
    const key = keyIsOffered(id) ? await readProviderKey(id) : null;
    const headers = headersAreOffered(id) ? await readGatewayHeaders(id) : null;
    if (key?.outcome === 'refused' || headers?.outcome === 'refused') throw new Error('Credentials could not be read. Unlock the device and try again.');
    const missing = missingBeforeVoice(settings, id, key?.outcome === 'found');
    if (missing.length) throw new Error(readinessSentence(id, missing));
    const provider = createProvider(id, providerSettings({ ...settings, provider: id }, {
      key: key?.outcome === 'found' ? key.secret : '', headers: headers?.outcome === 'found' ? headers.secret : '',
    }), providerDepsFor(id));
    // Some voice lists are static. They cannot prove that an address or key works.
    if (provider.checkConnection) await provider.checkConnection();
    const voices = await provider.listVoices({ signal: abort.signal });
    if (!voices.length) throw new Error('No voices returned. Check the configuration and try again.');
    return voices;
  })(), 15_000, () => new Error('Connection timed out. Check the address and try again.'), () => abort.abort());
}
