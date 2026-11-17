import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createElement, type ReactElement, useMemo } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(), fail: '', directoryFails: false, directoryCreates: 0,
  hold: '', release: null as null | (() => void),
}));
vi.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(base: { uri: string } | string, name?: string) {
      const root = typeof base === 'string' ? base : base.uri;
      this.uri = root.replace(/\/+$/, '') + (name ? `/${name}` : '') + '/';
    }
    create() {
      disk.directoryCreates++;
      if (disk.directoryFails) throw new Error('No room to create the reader directory');
    }
  }
  class File {
    constructor(public uri: string) {}
    writeSync(contents: string) {
      if (disk.fail && this.uri.endsWith(disk.fail)) throw new Error(`No space left on device (${disk.fail})`);
      disk.files.set(this.uri, contents);
    }
  }
  return { Directory, File, Paths: { cache: { uri: 'file:///cache/' }, bundle: { uri: 'file:///bundle/' }, info: () => ({ exists: true, isDirectory: false }) } };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const require = createRequire(import.meta.url);
const LIB = dirname(require.resolve('@epubjs-react-native/core/package.json'));
const libraryRequire = createRequire(join(LIB, 'lib/commonjs/Reader.js'));
const { ReaderProvider } = libraryRequire('./context.js') as { ReaderProvider: (props: { children: ReactElement }) => ReactElement };
const BUILDS = ['commonjs', 'module'] as const;
type Build = (typeof BUILDS)[number];

/** The installed Reader in each build. Only the native View is replaced. The
 * module build is transpiled for Node and uses the same real ReaderProvider. */
function loadReader(build: Build): (props: Record<string, unknown>) => ReactElement | null {
  let source = readFileSync(join(LIB, 'lib', build, 'Reader.js'), 'utf8');
  if (build === 'module') source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as { Reader: (props: Record<string, unknown>) => ReactElement | null } };
  const stubs: Record<string, unknown> = {
    'react-native': { Platform: { OS: 'ios' } },
    './utils/LoadingFile': { LoadingFile: () => null },
    './View': { View: (props: { templateUri: string }) => createElement('view', { templateUri: props.templateUri }) },
  };
  const req = (id: string) => id in stubs ? stubs[id] : libraryRequire(id);
  new Function('exports', 'require', 'module', source)(module.exports, req, module);
  return module.exports.Reader;
}

let tree: ReactTestRenderer | null = null;
const unhandled: unknown[] = [];
const onUnhandled = (error: unknown) => unhandled.push(error);
const settle = async () => { for (let turn = 0; turn < 4; turn++) await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); }); };

async function mount(build: Build) {
  const Reader = loadReader(build);
  const { useReaderFileSystem } = await import('../../src/app/reader-file-system');
  function useDisk() {
    const real = useReaderFileSystem();
    return useMemo(() => ({ ...real, async writeAsStringAsync(uri: string, contents: string) {
      if (disk.hold && uri.endsWith(disk.hold)) {
        disk.hold = '';
        await new Promise<void>((resolve) => { disk.release = resolve; });
      }
      return real.writeAsStringAsync(uri, contents);
    } }), [real]);
  }
  const errors: string[] = [];
  const props = {
    src: 'UEsDB'.repeat(300), width: 400, height: 800, fileSystem: useDisk,
    onDisplayError: (reason: string) => errors.push(reason),
    renderLoadingFileComponent: () => createElement('loading'),
  };
  const element = (next = props) => createElement(ReaderProvider, null, createElement(Reader, next));
  await act(async () => { tree = create(element()); });
  await settle();
  return { errors, element, props, shown: () => (tree!.toJSON() as { type: string } | null)?.type ?? 'nothing' };
}

beforeEach(() => {
  disk.files.clear(); disk.fail = ''; disk.directoryFails = false; disk.directoryCreates = 0; disk.hold = ''; disk.release = null;
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});
afterEach(async () => {
  await act(async () => { tree?.unmount(); }); tree = null;
  disk.release?.();
  await settle();
  process.off('unhandledRejection', onUnhandled);
});

for (const build of BUILDS) describe(`${build} Reader cache preparation (#254)`, () => {
  it('control: hands the written HTML to the View', async () => {
    const page = await mount(build);
    expect(page.shown()).toBe('view');
    expect(disk.files.has('file:///cache/epubjs/index.html')).toBe(true);
    expect(page.errors).toEqual([]);
    expect(unhandled).toEqual([]);
  });
  for (const file of ['jszip.min.js', 'epub.min.js', 'index.html']) {
    it(`reports a failed ${file} once and removes the loading surface`, async () => {
      disk.fail = file;
      const page = await mount(build);
      expect(page.errors).toEqual([`No space left on device (${file})`]);
      expect(page.shown()).toBe('nothing');
      expect(unhandled).toEqual([]);
    });
  }
  it('reports directory creation failure instead of throwing during render', async () => {
    disk.directoryFails = true;
    const page = await mount(build);
    expect(page.errors).toEqual(['No room to create the reader directory']);
    expect(page.shown()).toBe('nothing');
    expect(unhandled).toEqual([]);
  });
  it('does not start new writes or report an old failure after unmount', async () => {
    disk.hold = 'jszip.min.js';
    disk.fail = 'jszip.min.js';
    const page = await mount(build);
    expect(disk.release).not.toBeNull();
    await act(async () => { tree!.unmount(); }); tree = null;
    disk.release!();
    await settle();
    expect(page.errors).toEqual([]);
    expect(disk.files.size).toBe(0);
    expect(unhandled).toEqual([]);
  });
  it('can open again after a failed page is unmounted and storage is available', async () => {
    disk.fail = 'index.html';
    const first = await mount(build);
    expect(first.errors).toHaveLength(1);
    await act(async () => { tree!.unmount(); }); tree = null;
    disk.fail = '';
    const next = await mount(build);
    expect(next.shown()).toBe('view');
    expect(next.errors).toEqual([]);
    expect(first.errors).toHaveLength(1);
    expect(unhandled).toEqual([]);
  });
  it('does not publish or write old HTML when its source changes during script preparation', async () => {
    disk.hold = 'jszip.min.js';
    const page = await mount(build);
    const replacement = 'NEW'.repeat(400);
    await act(async () => { tree!.update(page.element({ ...page.props, src: replacement })); });
    await settle();
    expect(page.shown()).toBe('view');
    disk.release!();
    await settle();
    expect(disk.files.get('file:///cache/epubjs/index.html')).toContain(replacement);
    expect(disk.files.get('file:///cache/epubjs/index.html')).not.toContain(page.props.src);
    expect(page.errors).toEqual([]);
    expect(unhandled).toEqual([]);
  });
  it('uses the latest error callback without restarting cache preparation', async () => {
    disk.hold = 'index.html'; disk.fail = 'index.html';
    const page = await mount(build);
    const latest = vi.fn();
    await act(async () => { tree!.update(page.element({ ...page.props, onDisplayError: latest })); });
    disk.release!();
    await settle();
    expect(latest).toHaveBeenCalledExactlyOnceWith('No space left on device (index.html)');
    expect(page.errors).toEqual([]);
    expect(page.shown()).toBe('nothing');
    expect(unhandled).toEqual([]);
  });
});

it('the file-system hook is stable, creates no directory during render and isolates offline preparation', async () => {
  const { useReaderFileSystem } = await import('../../src/app/reader-file-system');
  let current!: ReturnType<typeof useReaderFileSystem>;
  function Probe({ name }: { name: string }) { current = useReaderFileSystem(name); return null; }
  await act(async () => { tree = create(createElement(Probe, { name: 'epubjs' })); });
  const first = current;
  expect(disk.directoryCreates).toBe(0);
  await act(async () => { tree!.update(createElement(Probe, { name: 'epubjs' })); });
  expect(current).toBe(first);
  await current.writeAsStringAsync(`${current.documentDirectory}/first.js`, 'first');
  await current.writeAsStringAsync(`${current.documentDirectory}/next.js`, 'next');
  expect(disk.directoryCreates).toBe(1);
  await act(async () => { tree!.update(createElement(Probe, { name: 'epubjs-offline' })); });
  expect(disk.directoryCreates).toBe(1);
  await current.writeAsStringAsync(`${current.documentDirectory}/index.html`, 'offline');
  expect(disk.directoryCreates).toBe(2);
  expect([...disk.files.keys()]).toEqual(['file:///cache/epubjs/first.js', 'file:///cache/epubjs/next.js', 'file:///cache/epubjs-offline/index.html']);
});
