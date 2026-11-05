import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import { parseSettings, readSettings, writeSettings } from '../../src/app/settings-storage';
import { appearanceCss } from '../../src/renderer/highlighter';
import { resolveMargins } from '../../src/renderer/margins';

const disk = vi.hoisted(() => new Map<string, string>());
const write = vi.hoisted(() => vi.fn((uri: string, text: string) => disk.set(uri, text)));
vi.mock('expo-file-system', () => ({ Paths: { document: 'test' }, File: class {
  constructor(_directory: string, private name: string) {}
  get uri() { return this.name; }
  get exists() { return disk.has(this.name); }
  textSync() { return disk.get(this.name); }
} }));
vi.mock('../../modules/open-reader-offline', () => ({ offlineNative: {
  writeJson: write,
} }));
beforeEach(() => { disk.clear(); write.mockClear(); });

describe('old point margins survive until a real reader width is available (#344)', () => {
  it('keeps old 8 points through unrelated writes, converts at 1180 once, then retains 1% at other widths and launches', () => {
    disk.set('settings.json', JSON.stringify({ version: 1, settings: { appearance: { margins: 8 } } }));
    let settings = readSettings();
    expect(settings.appearance).toMatchObject({ margins: 8, marginsUnit: 'points' });
    expect(appearanceCss(settings.appearance)).toContain('padding-left: 8px !important');
    writeSettings({ ...settings, theme: 'dark' });
    settings = readSettings();
    expect(settings.appearance).toMatchObject({ margins: 8, marginsUnit: 'points' });
    for (const width of [0, -1, NaN, Infinity]) expect(resolveMargins(settings.appearance, width)).toBe(settings.appearance);
    settings = { ...settings, appearance: resolveMargins(settings.appearance, 1180) };
    expect(settings.appearance).toMatchObject({ margins: 1, marginsUnit: 'percent' });
    writeSettings(settings);
    settings = readSettings();
    expect(settings.theme).toBe('dark');
    expect(settings.appearance).toMatchObject({ margins: 1, marginsUnit: 'percent' });
    expect(resolveMargins(settings.appearance, 820)).toBe(settings.appearance);
    expect(appearanceCss(settings.appearance)).toContain('padding-left: 1% !important');
  });
  it('leaves the old value and unit recoverable when persisting the conversion fails', () => {
    disk.set('settings.json', JSON.stringify({ version: 1, settings: { appearance: { margins: 48 } } }));
    const before = disk.get('settings.json');
    const old = readSettings();
    const converted = { ...old, appearance: resolveMargins(old.appearance, 1180) };
    write.mockImplementationOnce(() => { throw new Error('Storage full'); });
    expect(() => writeSettings(converted)).toThrow('Storage full');
    expect(disk.get('settings.json')).toBe(before);
    expect(readSettings().appearance).toMatchObject({ margins: 48, marginsUnit: 'points' });
    writeSettings(converted);
    expect(readSettings().appearance).toMatchObject({ margins: 4, marginsUnit: 'percent' });
  });
  it('never mistakes overlapping new 8% for old 8 points', () => {
    writeSettings({ ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, margins: 8 } });
    const saved = readSettings();
    expect(saved.appearance).toMatchObject({ margins: 8, marginsUnit: 'percent' });
    expect(resolveMargins(saved.appearance, 1180)).toBe(saved.appearance);
  });
  it('rounds against actual width, not the retired cap, and defaults new or invalid choices to 5%', () => {
    const old = parseSettings({ version: 1, settings: { appearance: { margins: 28 } } }).appearance;
    expect(resolveMargins(old, 1180).margins).toBe(2);
    expect(resolveMargins(old, 820).margins).toBe(3);
    expect(resolveMargins(old, 400).margins).toBe(7);
    expect(readSettings().appearance).toMatchObject({ margins: 5, marginsUnit: 'percent' });
    for (const margins of [null, '8', -1, 26, 4.5, NaN]) {
      expect(parseSettings({ version: 1, settings: { appearance: { margins, marginsUnit: 'percent' } } }).appearance)
        .toMatchObject({ margins: 5, marginsUnit: 'percent' });
    }
  });
});
