/** Local persistence only; this is not the shared sync format. Secrets never enter it. */
import { File, Paths } from 'expo-file-system';
import { DEFAULT_SETTINGS, isProviderId, type AppSettings, type DocumentVoice } from './settings';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown, fallback: string) => typeof value === 'string' ? value : fallback;

/** Explicit projection also prevents legacy credential fields from being persisted. */
export function parseSettings(value: unknown): AppSettings {
  const root = object(value);
  const data = object(root.settings ?? value);
  const openai = object(data.openai), compatible = object(data.compatible), local = object(data.local);
  const fish = object(data.fish), appearance = object(data.appearance);
  const voices: DocumentVoice[] = Array.isArray(data.recentVoices) ? data.recentVoices.flatMap((entry: unknown) => {
    const item = object(entry);
    return typeof item.provider === 'string' && isProviderId(item.provider) && typeof item.voice === 'string' && item.voice.trim()
      ? [{ provider: item.provider, voice: item.voice }] : [];
  }) : [];
  return {
    provider: typeof data.provider === 'string' && isProviderId(data.provider) ? data.provider : DEFAULT_SETTINGS.provider,
    voice: string(data.voice, ''),
    // Only this version knows explicit enablement. Older configurations migrate disabled.
    enabledProviders: root.version === 1 && Array.isArray(data.enabledProviders)
      ? [...new Set(data.enabledProviders.filter((id): id is AppSettings['provider'] => typeof id === 'string' && isProviderId(id)))] : [],
    recentVoices: voices,
    openai: { model: string(openai.model, DEFAULT_SETTINGS.openai.model) },
    compatible: { baseURL: string(compatible.baseURL, ''), model: string(compatible.model, '') },
    local: { engine: string(local.engine, DEFAULT_SETTINGS.local.engine), baseURL: string(local.baseURL, DEFAULT_SETTINGS.local.baseURL) },
    fish: { includeOfficial: typeof fish.includeOfficial === 'boolean' ? fish.includeOfficial : true,
      includeOwn: fish.includeOwn === true, includeManual: fish.includeManual === true, voices: string(fish.voices, '') },
    rate: typeof data.rate === 'number' && Number.isFinite(data.rate) && data.rate >= 0.5 && data.rate <= 4 ? data.rate : DEFAULT_SETTINGS.rate,
    theme: data.theme === 'dark' || data.theme === 'light' ? data.theme : 'system',
    appearance: {
      font: typeof appearance.font === 'string' && ['system', 'serif', 'sans'].includes(appearance.font)
        ? appearance.font as AppSettings['appearance']['font'] : DEFAULT_SETTINGS.appearance.font,
      scale: typeof appearance.scale === 'number' && Number.isFinite(appearance.scale) && appearance.scale > 0 ? appearance.scale : DEFAULT_SETTINGS.appearance.scale,
    },
  };
}
export function readSettings(): AppSettings {
  const file = new File(Paths.document, 'settings.json');
  return file.exists ? parseSettings(JSON.parse(file.textSync())) : DEFAULT_SETTINGS;
}
export function writeSettings(settings: AppSettings): void {
  const clean = parseSettings({ version: 1, settings });
  new File(Paths.document, 'settings.json').write(JSON.stringify({ version: 1, settings: clean }));
}
