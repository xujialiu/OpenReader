import { createElement, Fragment, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Footnote } from '../../src/app/controls';
import type { Shell } from '../../src/app/routes';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import { SyncScreen } from '../../src/app/sync-screen';
import type { Library } from '../../src/app/use-library';
import { useSync, type SyncDeps } from '../../src/app/use-sync';
import { serializePositionsFile, type PositionsItem } from '../../src/core/sync/positions-file';
import { WebDAVError } from '../../src/core/sync/webdav';

/** Real screen, hook and transport; only platform controls, credentials and the server are doubled. */
const phone = vi.hoisted(() => ({
  shell: null as Pick<Shell, 'settings' | 'setSettings' | 'sync' | 'syncLast'> | null,
  lines: [] as string[],
}));
vi.mock('../../src/app/routes', () => ({ useShell: () => phone.shell }));
vi.mock('../../src/keys/store', () => ({
  readSyncPassword: async () => ({ outcome: 'absent' }),
  saveSyncPassword: vi.fn(), forgetSyncPassword: vi.fn(),
}));
vi.mock('../../src/debug/debug-log', () => ({
  cutAddress: (url: string) => url,
  debugLog: (_area: string, line: string) => phone.lines.push(line),
}));
vi.mock('../../src/app/controls', () => ({
  SettingsPage: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  SettingsGroup: ({ children, footer }: { children: ReactNode; footer?: ReactNode }) => createElement(Fragment, null, children, footer),
  Footnote: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  FieldRow: () => null,
  SwitchRow: () => null,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const position: PositionsItem = {
  id: `sha256:${'a'.repeat(64)}`, format: 'epub', publicationId: null,
  locator: 'epubcfi(/6/2!/4/4)', anchor: { exact: 'The sentence.', prefix: '', suffix: '' },
  stamp: { at: 1, device: 'phone' },
};
const settings = { ...DEFAULT_SETTINGS, sync: { url: 'https://dav.example/reading', username: 'owner', enabled: true } };

async function open(remote: string | null, { local = [position], uploadFails = false, replyLost = false }: { local?: PositionsItem[]; uploadFails?: boolean; replyLost?: boolean } = {}) {
  let text = remote;
  const uploads: string[] = [];
  const library = { positionsItems: () => local, adopt: () => [] } as unknown as Library;
  const deps: SyncDeps = {
    now: () => 1_000_000,
    client: () => ({
      check: async () => {},
      download: async () => {
        if (text === null) throw new WebDAVError('not-found', 'No file yet', 404);
        return text;
      },
      upload: async (_name, value) => {
        if (uploadFails) throw new WebDAVError('network', 'Upload refused');
        uploads.push(value);
        text = value;
        if (replyLost) throw new WebDAVError('network', 'Upload reply lost');
      },
    }),
  };
  function App() {
    const { sync, last } = useSync(settings, library, deps);
    phone.shell = { settings, setSettings: vi.fn(), sync, syncLast: last };
    return createElement(SyncScreen);
  }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(App)); });
  return {
    uploads,
    get text() { return text; },
    get line() { return tree.root.findAllByType(Footnote).map((note) => note.props.children).join(' '); },
    get logs() { return phone.lines.join('\n'); },
    sync: () => act(async () => { await phone.shell!.sync.wait('play'); }),
    close: () => act(async () => { tree.unmount(); }),
  };
}

beforeEach(() => { phone.shell = null; phone.lines = []; });

describe('an unreadable Positions File is not an ordinary first sync (#178)', () => {
  it.each(['{not json', '', '<html>Sign in</html>', '{"format":"foreign","version":1,"items":[]}'])('says the unreadable file was replaced: %s', async (remote) => {
    const app = await open(remote);
    try {
      await app.sync();
      expect(app.uploads).toHaveLength(1);
      expect(app.line).toMatch(/could not be read/i);
      expect(app.line).toMatch(/replaced/i);
      expect(app.logs).toMatch(/could not be read/i);
      expect(app.logs).toMatch(/replaced/i);
    } finally { await app.close(); }
  });

  it('keeps an absent file an ordinary successful first sync', async () => {
    const app = await open(null);
    try {
      await app.sync();
      expect(app.uploads).toHaveLength(1);
      expect(app.line).toMatch(/^Synced at /);
      expect(app.line).not.toMatch(/could not be read|replaced/i);
    } finally { await app.close(); }
  });

  it('says the file was not replaced when the phone has no positions', async () => {
    const app = await open('{not json', { local: [] });
    try {
      await app.sync();
      expect(app.uploads).toHaveLength(0);
      expect(app.text).toBe('{not json');
      expect(app.line).toMatch(/could not be read/i);
      expect(app.line).toMatch(/not replaced/i);
      expect(app.logs).toMatch(/not replaced/i);
    } finally { await app.close(); }
  });

  it('does not claim replacement succeeded if the upload failed', async () => {
    const app = await open('{not json', { uploadFails: true });
    try {
      await app.sync();
      expect(app.uploads).toHaveLength(0);
      expect(app.text).toBe('{not json');
      expect(app.line).toContain('Upload refused');
      expect(app.line).toMatch(/could not be read/i);
      expect(app.line).toMatch(/replacement was not confirmed/i);
      expect(app.logs).toMatch(/replacement was not confirmed/i);
    } finally { await app.close(); }
  });

  it('does not promise the old file survived when only the upload reply was lost', async () => {
    const app = await open('{not json', { replyLost: true });
    try {
      await app.sync();
      expect(app.text).toBe(serializePositionsFile([position]));
      expect(app.line).toContain('Upload reply lost');
      expect(app.line).toMatch(/replacement was not confirmed/i);
      expect(app.line).not.toMatch(/was not replaced|was replaced/i);
    } finally { await app.close(); }
  });

  it('still leaves a newer version alone', async () => {
    const remote = '{"format":"xujialiu-positions","version":2,"items":[]}';
    const app = await open(remote);
    try {
      await app.sync();
      expect(app.uploads).toHaveLength(0);
      expect(app.text).toBe(remote);
      expect(app.line).toMatch(/version 2/);
      expect(app.line).toMatch(/left alone/);
      expect(app.line).not.toMatch(/replaced/i);
    } finally { await app.close(); }
  });

  it('describes the next ordinary sync without the earlier repair warning', async () => {
    const app = await open('{not json');
    try {
      await app.sync();
      expect(app.line).toMatch(/could not be read/i);
      expect(app.text).toBe(serializePositionsFile([position]));
      await app.sync();
      expect(app.uploads).toHaveLength(1);
      expect(app.line).toMatch(/^Synced at /);
      expect(app.line).not.toMatch(/could not be read|replaced/i);
    } finally { await app.close(); }
  });
});
