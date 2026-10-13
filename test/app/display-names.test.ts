import { beforeEach, describe, expect, it, vi } from 'vitest';
import { displayNames, forgetDisplayName, saveDisplayName } from '../../src/app/display-names';

/** `display-names.json` over an in-memory file (ADR 0027, "Display names"). */

const disk = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock('expo-file-system', () => ({
  Paths: { document: 'doc' },
  File: class {
    uri: string;
    constructor(_directory: string, name: string) { this.uri = name; }
    get exists() { return disk.files.has(this.uri); }
    textSync() { return disk.files.get(this.uri)!; }
    write(text: string) { disk.files.set(this.uri, text); }
  },
}));
vi.mock('../../modules/open-reader-offline', () => ({ offlineNative: null }));

beforeEach(() => { disk.files.clear(); });

describe('display names', () => {
  it('forgetting one name keeps the others, in the same file format (#180)', () => {
    saveDisplayName('sha256:a', 'Emma');
    saveDisplayName('sha256:b', 'Persuasion');
    forgetDisplayName('sha256:a');
    expect(displayNames()).toEqual({ 'sha256:b': 'Persuasion' });
    expect(JSON.parse(disk.files.get('display-names.json')!)).toEqual({ version: 1, names: { 'sha256:b': 'Persuasion' } });
  });

  it('forgetting a name that is not there leaves the names as they were', () => {
    saveDisplayName('sha256:b', 'Persuasion');
    forgetDisplayName('sha256:a');
    expect(displayNames()).toEqual({ 'sha256:b': 'Persuasion' });
  });
});
