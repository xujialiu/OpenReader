import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, LINE_POSITIONS, SCROLLING_LABELS, SCROLLINGS, SENTENCES_AT_ONCE, selectVoice } from '../../src/app/settings';
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
    const settings = selectVoice({ ...DEFAULT_SETTINGS, enabledProviders: ['fish', 'azure'], azure: { region: 'East Asia' },
      appearance: { font: 'helvetica', size: 20, margins: 28, textAlignment: 'left' }, fish: { includeOfficial: false, includeOwn: true, includeManual: true, voices: 'model-id' } }, 'fish', 'en/model-id');
    writeSettings(settings);
    expect(readSettings()).toEqual(settings);
  });
  it('projects known fields so credentials cannot leak into the settings file', () => {
    const settings = { ...DEFAULT_SETTINGS, apiKey: 'secret', fish: { ...DEFAULT_SETTINGS.fish, apiKey: 'secret' }, local: { ...DEFAULT_SETTINGS.local, headers: 'secret' },
      azure: { region: 'eastasia', apiKey: 'secret' } };
    writeSettings(settings);
    expect(disk.get('settings.json')).not.toContain('secret');
  });
  it('keeps both pauses across a reload, and reads a file without them as 0 and 200 ms (#60)', () => {
    const settings = { ...DEFAULT_SETTINGS, pauses: { sentenceMs: 300, paragraphMs: 1500 } };
    writeSettings(settings);
    expect(readSettings().pauses).toEqual({ sentenceMs: 300, paragraphMs: 1500 });
    expect(parseSettings({ version: 1, settings: {} }).pauses).toEqual({ sentenceMs: 0, paragraphMs: 200 });
  });
  it('offers the Line Position from 20 to 80 % a tenth at a time, and starts in the middle (#71)', () => {
    expect(LINE_POSITIONS).toEqual([20, 30, 40, 50, 60, 70, 80]);
    expect(DEFAULT_SETTINGS.following.linePosition).toBe(50);
  });
  it('keeps the Line Position across a reload, and reads a file without one as the middle (#71)', () => {
    writeSettings({ ...DEFAULT_SETTINGS, following: { ...DEFAULT_SETTINGS.following, linePosition: 30 } });
    expect(readSettings().following.linePosition).toBe(30);
    expect(parseSettings({ version: 1, settings: {} }).following.linePosition).toBe(50);
  });
  it('reads a Line Position General does not offer as the middle rather than keeping it (#71)', () => {
    // A value the menu cannot show as chosen would leave the row saying nothing;
    // a share written as 0.3, a string and one past the ends are none of the offered ones.
    for (const linePosition of [0.3, '30', 10, 90, 55, null]) {
      expect(parseSettings({ version: 1, settings: { following: { linePosition } } }).following.linePosition).toBe(50);
    }
  });
  it('offers By line and Continuous, in that order, and starts By line (#71)', () => {
    expect(SCROLLINGS).toEqual(['line', 'continuous']);
    expect(SCROLLINGS.map((way) => SCROLLING_LABELS[way])).toEqual(['By line', 'Continuous']);
    expect(DEFAULT_SETTINGS.following).toEqual({ scrolling: 'line', linePosition: 50 });
  });
  it('keeps Continuous across a reload beside the Line Position, and reads a file without it as By line (#71)', () => {
    writeSettings({ ...DEFAULT_SETTINGS, following: { scrolling: 'continuous', linePosition: 40 } });
    expect(readSettings().following).toEqual({ scrolling: 'continuous', linePosition: 40 });
    // A file written by batch 2, with a Line Position and no way of scrolling.
    expect(parseSettings({ version: 1, settings: { following: { linePosition: 30 } } }).following).toEqual({ scrolling: 'line', linePosition: 30 });
  });
  it('reads a way of scrolling General does not offer as By line rather than keeping it (#71)', () => {
    // Nothing is converted, as nothing else here is: the app is unreleased.
    for (const scrolling of ['Continuous', 'smooth', 'byLine', true, 1, null]) {
      expect(parseSettings({ version: 1, settings: { following: { scrolling, linePosition: 60 } } }).following).toEqual({ scrolling: 'line', linePosition: 60 });
    }
  });
  it('reads a pause General does not offer as that pause’s default rather than keeping it', () => {
    // A value the menu cannot show as chosen would leave the row saying nothing.
    // 1500 is a paragraph pause and not a sentence one; strings and negatives are not pauses.
    expect(parseSettings({ version: 1, settings: { pauses: { sentenceMs: 1500, paragraphMs: 250 } } }).pauses)
      .toEqual({ sentenceMs: 0, paragraphMs: 200 });
    expect(parseSettings({ version: 1, settings: { pauses: { sentenceMs: '300', paragraphMs: -200 } } }).pauses)
      .toEqual({ sentenceMs: 0, paragraphMs: 200 });
  });
  it('starts Fish Audio at five sentences at once and every other Provider at one, and keeps a choice across a reload (#64)', () => {
    expect(parseSettings({ version: 1, settings: {} }).sentencesAtOnce)
      .toEqual({ 'openai-official': 1, compatible: 1, azure: 1, speechify: 1, fish: 5, local: 1 });
    const settings = { ...DEFAULT_SETTINGS, sentencesAtOnce: { ...DEFAULT_SETTINGS.sentencesAtOnce, fish: 8, azure: 2 } };
    writeSettings(settings);
    expect(readSettings().sentencesAtOnce).toEqual(settings.sentencesAtOnce);
  });
  it('reads a number of sentences the menu does not offer as that Provider’s default', () => {
    // Zero would stop every download; eleven and a string are not on the menu, and a Provider this build lacks is dropped.
    const read = parseSettings({ version: 1, settings: { sentencesAtOnce: { fish: 0, azure: 11, local: '3', compatible: 2.5, retired: 4 } } }).sentencesAtOnce;
    expect(read).toEqual({ 'openai-official': 1, compatible: 1, azure: 1, speechify: 1, fish: 5, local: 1 });
    expect(SENTENCES_AT_ONCE).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
  it('keeps a Font Size on the ladder and drops anything else, including the percentages of the build before', () => {
    // The app has not been released, so a percentage saved by the previous build is
    // not converted: it is dropped and the owner starts at the default, 26 (#17).
    expect(parseSettings({ version: 1, settings: { appearance: { font: 'georgia', size: 20 } } }).appearance)
      .toEqual({ font: 'georgia', size: 20, margins: 24, textAlignment: 'justify' });
    expect(parseSettings({ version: 1, settings: { appearance: { font: 'georgia', scale: 150 } } }).appearance)
      .toEqual({ font: 'georgia', size: 26, margins: 24, textAlignment: 'justify' });
    for (const size of [25, 17.5, '18', 0, -1, null]) {
      expect(parseSettings({ version: 1, settings: { appearance: { size } } }).appearance.size).toBe(26);
    }
    // A size already saved is kept, the first default among them.
    expect(parseSettings({ version: 1, settings: { appearance: { size: 16 } } }).appearance.size).toBe(16);
  });
  it('keeps a Text Alignment of the two and reads anything else, or nothing, as Justify', () => {
    // A settings file written before ADR 0034 has no alignment in it, and is read
    // the way a new install starts: justified. Nothing is migrated, since the app
    // has not been released.
    expect(parseSettings({ version: 1, settings: { appearance: { textAlignment: 'left' } } }).appearance.textAlignment).toBe('left');
    expect(parseSettings({ version: 1, settings: { appearance: { textAlignment: 'justify' } } }).appearance.textAlignment).toBe('justify');
    for (const textAlignment of [undefined, null, 'center', 'right', 'start', 'Left', 'justify;}', 1, true]) {
      expect(parseSettings({ version: 1, settings: { appearance: { textAlignment } } }).appearance.textAlignment).toBe('justify');
    }
    expect(parseSettings({}).appearance.textAlignment).toBe('justify');
  });
  it('keeps Margins on the ladder and reads anything else, or nothing, as 24', () => {
    // A settings file written before #84 has no Margins in it, and is read the
    // way a new install starts. Nothing is migrated, since the app has not been
    // released.
    for (const margins of [8, 16, 36, 48]) {
      expect(parseSettings({ version: 1, settings: { appearance: { margins } } }).appearance.margins).toBe(margins);
    }
    for (const margins of [undefined, null, 0, 4, 18, 52, '16', 16.5, true]) {
      expect(parseSettings({ version: 1, settings: { appearance: { margins } } }).appearance.margins).toBe(24);
    }
    expect(parseSettings({}).appearance.margins).toBe(24);
  });
  it('defaults missing sources to official only and rejects unknown enabled ids', () => {
    expect(parseSettings({ version: 1, settings: { sync: { url: 'https://dav.example/or', username: 'ann', enabled: true } } }).sync)
      .toEqual({ url: 'https://dav.example/or', username: 'ann', enabled: true });
    // Never a password in the settings file, and the switch is off unless it was written on.
    expect(parseSettings({ version: 1, settings: { sync: { url: 'x', password: 'secret', enabled: 'yes' } } }).sync)
      .toEqual({ url: 'x', username: '', enabled: false });
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
