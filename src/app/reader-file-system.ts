/**
 * The file system `@epubjs-react-native/core` asks for, over `expo-file-system`.
 *
 * `<Reader>` takes a `fileSystem()` hook and uses it to write three files —
 * `jszip.min.js`, `epub.min.js` and the `index.html` it builds around the book —
 * and then loads that HTML into the WebView. The package publishes a companion
 * module for this, and it is written against the *legacy* `expo-file-system`
 * API; SDK 57's is `File`/`Directory`/`Paths`. Twenty lines here rather than a
 * dependency whose whole content is the same twenty lines against the API this
 * project does not use.
 *
 * Two things about it are load-bearing rather than incidental.
 *
 * **Everything it returns must keep its identity across renders.** `Reader`'s
 * effect lists `documentDirectory` and `downloadFile` among its dependencies, and
 * that effect rewrites `index.html` and re-sets the template state — so a fresh
 * function on every render reloads the WebView, and a WebView that reloads
 * starts the book again from page one. Hence the `useMemo`/`useCallback`, which
 * are not decoration.
 *
 * **The three files are regenerated at every mount**, so they live in the cache
 * and not among the owner's documents. Nothing of the owner's is written here
 * at all: a Document is read (`document.ts`) and never copied (philosophy
 * rule 8).
 */

import { Directory, File, Paths } from 'expo-file-system';
import { useCallback, useMemo } from 'react';

import { APP_NAME } from '../../app-name';

/**
 * What `ReaderProps.fileSystem` must return.
 *
 * Declared here because the package does not export the type — it is a local
 * `type FileSystem` in its `types.d.ts` — so the only way to satisfy it is
 * structurally. The fields `<Reader>` actually reads are `documentDirectory`,
 * `writeAsStringAsync`, `downloadFile` and the five that describe a download;
 * the rest belong to the shape.
 */
export interface ReaderFileSystem {
  file: string | null;
  progress: number;
  downloading: boolean;
  size: number;
  error: string | null;
  success: boolean;
  documentDirectory: string | null;
  cacheDirectory: string | null;
  bundleDirectory: string | undefined;
  readAsStringAsync(uri: string, options?: { encoding?: 'utf8' | 'base64' }): Promise<string>;
  writeAsStringAsync(uri: string, contents: string, options?: { encoding?: 'utf8' | 'base64' }): Promise<void>;
  deleteAsync(uri: string): Promise<void>;
  downloadFile(fromUrl: string, toFile: string): Promise<{ uri: string | null; mimeType: string | null }>;
  getFileInfo(uri: string): Promise<{ uri: string; exists: boolean; isDirectory: boolean; size: number | undefined }>;
}

/** Where the library's own three files go. A subdirectory, so that what it writes is recognisable as not ours. */
const RENDERER_DIRECTORY = 'epubjs';

export function useReaderFileSystem(name = RENDERER_DIRECTORY): ReaderFileSystem {
  /**
   * The directory, made if it is not there, **without its trailing slash**.
   *
   * `Paths.cache.uri` ends in one and the library concatenates `/jszip.min.js`
   * onto whatever this returns, which would otherwise produce a `//` in the
   * middle of the very path it then hands to WKWebView as read access.
   */
  const directory = useMemo(() => {
    const made = new Directory(Paths.cache, name);
    made.create({ intermediates: true, idempotent: true });
    return made.uri.replace(/\/+$/, '');
  }, [name]);

  const readAsStringAsync = useCallback(async (uri: string, options?: { encoding?: 'utf8' | 'base64' }) => {
    const file = new File(uri);
    return options?.encoding === 'base64' ? file.base64() : file.text();
  }, []);

  const writeAsStringAsync = useCallback(async (uri: string, contents: string, options?: { encoding?: 'utf8' | 'base64' }) => {
    new File(uri).write(contents, { encoding: options?.encoding ?? 'utf8' });
  }, []);

  const deleteAsync = useCallback(async (uri: string) => {
    new File(uri).delete();
  }, []);

  /**
   * Refused, and said so.
   *
   * This is how `<Reader>` opens a book given an `http(s)` address, and OpenReader
   * never gives it one: a Document is a file on the owner's device, read in
   * `document.ts` and handed over as bytes. Rejecting names that decision at the
   * one place it could be quietly undone, where an implementation nothing
   * exercises would be a claim about code that has never run.
   */
  const downloadFile = useCallback(async (fromUrl: string) => {
    throw new Error(`${APP_NAME} reads documents from this device, so it does not download ${fromUrl}.`);
  }, []);

  const getFileInfo = useCallback(async (uri: string) => {
    const info = Paths.info(uri);
    const file = new File(uri);
    return { uri, exists: info.exists, isDirectory: info.isDirectory ?? false, size: info.exists ? file.size : undefined };
  }, []);

  return useMemo(
    () => ({
      // The five fields `<Reader>` passes to its loading component, which
      // describe the download that `downloadFile` refuses. They are constants
      // because nothing here downloads, and the reader screen renders its own
      // loading component rather than the library's.
      file: null,
      progress: 0,
      downloading: false,
      size: 0,
      error: null,
      success: false,

      documentDirectory: directory,
      cacheDirectory: Paths.cache.uri.replace(/\/+$/, ''),
      bundleDirectory: Paths.bundle.uri,
      readAsStringAsync,
      writeAsStringAsync,
      deleteAsync,
      downloadFile,
      getFileInfo,
    }),
    [directory, readAsStringAsync, writeAsStringAsync, deleteAsync, downloadFile, getFileInfo],
  );
}
