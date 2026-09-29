import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/**
 * The walkthrough harness polls `Documents/harness.json`, and what that file
 * holds can run JavaScript in the reader, change settings and navigate. So it
 * runs in Debug Mode only (#82, ADR 0054): a build without it never so much as
 * looks for the file.
 */
const disk = vi.hoisted(() => ({ opened: [] as string[], body: '{"seq":1,"do":"go","route":"Library"}' }));
vi.mock('expo-file-system', () => ({
  Paths: { document: 'Documents' },
  File: class {
    constructor(directory: string, name: string) { disk.opened.push(`${directory}/${name}`); }
    get exists() { return true; }
    textSync() { return disk.body; }
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

async function mounted(debugMode: boolean) {
  vi.resetModules();
  vi.doMock('../../src/debug/mode', () => ({ DEBUG_MODE: debugMode }));
  const { useHarnessCommands } = await import('../../src/app/walkthrough-harness');
  const run = vi.fn();
  function Probe() { useHarnessCommands(run); return null; }
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => { tree = create(createElement(Probe)); });
  await act(async () => { vi.advanceTimersByTime(2_000); });
  await act(async () => { tree!.unmount(); });
  return run;
}

beforeEach(() => { vi.useFakeTimers(); disk.opened = []; });
afterEach(() => { vi.doUnmock('../../src/debug/mode'); vi.useRealTimers(); });

it('never reads harness.json in a build without Debug Mode', async () => {
  const run = await mounted(false);
  expect(disk.opened).toEqual([]);
  expect(run).not.toHaveBeenCalled();
});

it('polls it four times a second in Debug Mode, and runs a command once per seq', async () => {
  const run = await mounted(true);
  expect(disk.opened).toHaveLength(8);
  expect(new Set(disk.opened)).toEqual(new Set(['Documents/harness.json']));
  expect(run).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledWith({ seq: 1, do: 'go', route: 'Library' });
});
