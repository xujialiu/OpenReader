import { useEffect, useState } from 'react';
import { readTranslationKey, saveTranslationKey, forgetTranslationKey } from '../keys/store';
import { type LookupSettings, type LookupDirection, type TranslationService, type TranslationTarget, SERVICE_NAMES } from '../translation/settings';
import { ActionRow, FieldRow, Footnote, SettingsGroup, SettingsPage, SwitchRow, TextRow, ValueRow, type Choice } from './controls';
import { useShell } from './routes';

const DIRECTIONS: readonly Choice<LookupDirection>[] = [
  { value: 'en-zh', label: 'English → Chinese' }, { value: 'en-en', label: 'English → English' }, { value: 'zh-en', label: 'Chinese → English' },
];
const TARGETS: readonly Choice<TranslationTarget>[] = [{ value: 'zh-CN', label: 'Simplified Chinese' }, { value: 'en', label: 'English' }];
export const TRANSLATION_SERVICES: readonly Choice<TranslationService>[] = (['youdao', 'google', 'microsoft'] as const).map((value) => ({ value, label: SERVICE_NAMES[value] }));

export function TranslationScreen() {
  const { settings, setSettings } = useShell();
  const s = settings.lookup;
  const change = (patch: Partial<LookupSettings>) => setSettings((was) => ({ ...was, lookup: { ...was.lookup, ...patch } }));
  const [key, setKey] = useState('');
  const [held, setHeld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void readTranslationKey().then((result) => {
      if (!live) return;
      setHeld(result.outcome === 'found');
      if (result.outcome === 'refused') setError('The saved key could not be read. Try again.');
    });
    return () => { live = false; };
  }, []);
  const save = async (remove: boolean) => {
    setBusy(true); setError(null);
    try {
      const result = await (remove ? forgetTranslationKey() : saveTranslationKey(key));
      if (result.outcome === 'refused') { setError('The key could not be saved. Try again.'); return; }
      setHeld(!remove); setKey('');
    } catch { setError('The key could not be saved. Try again.'); }
    finally { setBusy(false); }
  };
  return <SettingsPage>
    <SettingsGroup>
      <SwitchRow label="Long-press lookup" value={s.enabled} onChange={(enabled) => change({ enabled })} />
      <SwitchRow label="Pause reading during lookup" value={s.pauseReading} onChange={(pauseReading) => change({ pauseReading })} />
    </SettingsGroup>
    <SettingsGroup title="Dictionary">
      <ValueRow label="Direction" choices={DIRECTIONS} chosen={s.direction} onChoose={(direction) => change({ direction })} />
    </SettingsGroup>
    <SettingsGroup title="Translation">
      <ValueRow label="Translate into" choices={TARGETS} chosen={s.target} onChoose={(target) => change({ target })} />
      <ValueRow label="Service" choices={TRANSLATION_SERVICES} chosen={s.service} onChoose={(service) => change({ service })} />
    </SettingsGroup>
    {s.service === 'microsoft' ? <SettingsGroup title="Microsoft Translator" footer={error ? <Footnote attention>{error}</Footnote> : undefined}>
      <TextRow label="Region" value={s.microsoftRegion} onChangeText={(microsoftRegion) => change({ microsoftRegion })} placeholder="e.g. eastasia" />
      <FieldRow label="API key" secure value={key} onChangeText={setKey} editable={!busy} placeholder={held ? 'Saved — enter to replace' : 'Enter key'} />
      <ActionRow label="Save key" disabled={busy || !key.trim()} onPress={() => { void save(false); }} />
      {held ? <ActionRow label="Remove key" disabled={busy} onPress={() => { void save(true); }} /> : null}
    </SettingsGroup> : null}
  </SettingsPage>;
}
