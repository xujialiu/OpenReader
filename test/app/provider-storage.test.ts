import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, selectVoice } from '../../src/app/settings';
import { parseSettings, readSettings, writeSettings } from '../../src/app/settings-storage';
import { saveProviderEdit, flushProviderEdits } from '../../src/app/provider-edits';
const disk = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-file-system', () => ({ Paths: { document: 'test' }, File: class {
  constructor(_directory: string, private name: string) {}
  get exists() { return disk.has(this.name); }
  textSync() { return disk.get(this.name); }
  write(value: string) { disk.set(this.name, value); }
} }));

describe('local settings persistence', () => {
  it('retains configuration but never enables migrated settings', () => {
    const migrated = parseSettings({ ...DEFAULT_SETTINGS, enabledProviders: ['fish'], local: { engine: 'kokoro', baseURL: 'https://owner.example' } });
    expect(migrated.enabledProviders).toEqual([]);
    expect(migrated.local.baseURL).toBe('https://owner.example');
  });
  it('roundtrips enablement, voice history, sources and appearance across reloads', () => {
    const settings = selectVoice({ ...DEFAULT_SETTINGS, enabledProviders: ['fish'],
      appearance: { font: 'helvetica', scale: 125 }, fish: { includeOfficial: false, includeOwn: true, includeManual: true, voices: 'model-id' } }, 'fish', 'en/model-id');
    writeSettings(settings);
    expect(readSettings()).toEqual(settings);
  });
  it('projects known fields so credentials cannot leak into the settings file', () => {
    const settings = { ...DEFAULT_SETTINGS, apiKey: 'secret', fish: { ...DEFAULT_SETTINGS.fish, apiKey: 'secret' }, local: { ...DEFAULT_SETTINGS.local, headers: 'secret' } };
    writeSettings(settings);
    expect(disk.get('settings.json')).not.toContain('secret');
  });
  it('defaults missing sources to official only and rejects unknown enabled ids', () => {
    expect(parseSettings({ version: 1, settings: { enabledProviders: ['fish', 'other', 'fish'] } })).toMatchObject({
      enabledProviders: ['fish'], fish: { includeOfficial: true, includeOwn: false, includeManual: false },
    });
  });
});

describe('credential autosaves', () => {
  it('serializes rapid edits and waits for the final value before testing', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const saved: string[] = [];
    const first = saveProviderEdit('fish', 'key', async () => { await gate; saved.push('first'); return null; });
    const second = saveProviderEdit('fish', 'key', async () => { saved.push('last'); return null; });
    let flushed = false;
    const flush = flushProviderEdits('fish').then(() => { flushed = true; });
    await Promise.resolve();
    expect(flushed).toBe(false);
    release();
    await Promise.all([first, second, flush]);
    expect(saved).toEqual(['first', 'last']);
  });
  it('does not hide a failed key save behind a successful header save', async () => {
    await saveProviderEdit('compatible', 'key', async () => 'failed');
    await saveProviderEdit('compatible', 'headers', async () => null);
    await expect(flushProviderEdits('compatible')).rejects.toThrow('could not be saved');
    await saveProviderEdit('compatible', 'key', async () => null);
    await expect(flushProviderEdits('compatible')).resolves.toBeUndefined();
  });
});
