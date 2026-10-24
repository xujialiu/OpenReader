/** Device-local lookup preferences. Credentials are deliberately not part of this shape. */
export type LookupDirection = 'en-zh' | 'en-en' | 'zh-en';
export type TranslationService = 'youdao' | 'google' | 'microsoft';
export type TranslationTarget = 'zh-CN' | 'en';
export type LookupMode = 'dictionary' | 'translation';
export interface LookupSettings {
  enabled: boolean;
  pauseReading: boolean;
  /** Only an explicit Dictionary/Translation choice writes this, never selection automation. */
  preferredMode: LookupMode;
  direction: LookupDirection;
  target: TranslationTarget;
  service: TranslationService;
  microsoftRegion: string;
}
export const DEFAULT_LOOKUP: LookupSettings = {
  enabled: true, pauseReading: true, preferredMode: 'dictionary', direction: 'en-en', target: 'en', service: 'youdao', microsoftRegion: '',
};
export const SERVICE_NAMES: Record<TranslationService, string> = { youdao: 'Youdao', google: 'Google', microsoft: 'Microsoft' };
export function parseLookupSettings(value: unknown): LookupSettings {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_LOOKUP.enabled,
    pauseReading: typeof v.pauseReading === 'boolean' ? v.pauseReading : DEFAULT_LOOKUP.pauseReading,
    preferredMode: v.preferredMode === 'translation' ? 'translation' : DEFAULT_LOOKUP.preferredMode,
    direction: v.direction === 'en-en' || v.direction === 'en-zh' || v.direction === 'zh-en' ? v.direction : DEFAULT_LOOKUP.direction,
    target: v.target === 'en' || v.target === 'zh-CN' ? v.target : DEFAULT_LOOKUP.target,
    service: v.service === 'google' || v.service === 'microsoft' ? v.service : 'youdao',
    microsoftRegion: typeof v.microsoftRegion === 'string' ? v.microsoftRegion : '',
  };
}
