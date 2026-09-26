/** Device-local lookup preferences. Credentials are deliberately not part of this shape. */
export type LookupDirection = 'en-zh' | 'en-en' | 'zh-en';
export type TranslationService = 'youdao' | 'google' | 'microsoft';
export type TranslationTarget = 'zh-CN' | 'en';
export type LookupMode = 'dictionary' | 'translation';
export interface LookupSettings {
  enabled: boolean;
  pauseReading: boolean;
  direction: LookupDirection;
  target: TranslationTarget;
  service: TranslationService;
  microsoftRegion: string;
}
export const DEFAULT_LOOKUP: LookupSettings = {
  enabled: false, pauseReading: true, direction: 'en-zh', target: 'zh-CN', service: 'youdao', microsoftRegion: '',
};
export const SERVICE_NAMES: Record<TranslationService, string> = { youdao: 'Youdao', google: 'Google', microsoft: 'Microsoft' };
export function parseLookupSettings(value: unknown): LookupSettings {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    enabled: v.enabled === true,
    pauseReading: v.pauseReading !== false,
    direction: v.direction === 'en-en' || v.direction === 'zh-en' ? v.direction : 'en-zh',
    target: v.target === 'en' ? 'en' : 'zh-CN',
    service: v.service === 'google' || v.service === 'microsoft' ? v.service : 'youdao',
    microsoftRegion: typeof v.microsoftRegion === 'string' ? v.microsoftRegion : '',
  };
}
