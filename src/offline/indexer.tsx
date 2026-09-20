import { Reader, ReaderProvider, useReader } from '@epubjs-react-native/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { documentFile } from '../app/library';
import { useReaderFileSystem } from '../app/reader-file-system';
import { asDocumentId } from '../core/document';
import type { Block } from '../core/segmenter';
import { highlighterSource } from '../renderer/highlighter';
import { sectionChapters, type Chapter, type NavPoint } from './model';
import { failIndex, finishIndex, indexProgress, nextIndex, useDownloads } from './runtime';

function useIndexFileSystem() { return useReaderFileSystem('epubjs-offline'); }
const source = highlighterSource();

export function DownloadIndexer() {
  useDownloads();
  const next = nextIndex();
  if (!next) return null;
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ position: 'absolute', left: -1000, top: 0, width: 390, height: 600, opacity: 0 }}>
    <ReaderProvider><Indexer key={next[0]} document={next[0]} /></ReaderProvider>
  </View>;
}
function Indexer({ document }: { document: string }) {
  const size = useWindowDimensions();
  const [bytes, setBytes] = useState<string | null>(null);
  const { injectJavascript } = useReader();
  const chapters = useRef<Chapter[]>([]);
  const expected = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ask = useCallback((index: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => failIndex(document, 'Chapter preparation timed out. Try again.'), 60_000);
    injectJavascript(`window.openreaderOfflineSection(${index}); true;`);
  }, [document, injectJavascript]);
  useEffect(() => {
    let alive = true;
    const id = asDocumentId(document);
    if (!id) return;
    timer.current = setTimeout(() => failIndex(document, 'Opening the document timed out. Try again.'), 60_000);
    void documentFile(id, 'epub').base64().then((value) => { if (alive) setBytes(value); }, (e) => failIndex(document, String(e)));
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); };
  }, [document]);
  const receive = useCallback((event: unknown) => {
    const message = event as { type: string; index: number; total: number; blocks: Block[]; points: NavPoint[]; language: string; detail: string };
    if (message.type === 'openreader:document') { ask(0); return; }
    if (message.type === 'openreader:offline-error') { failIndex(document, message.detail); return; }
    if (message.type !== 'openreader:offline-section' || message.index !== expected.current) return;
    try {
      chapters.current.push(...sectionChapters(message.index, message.blocks, message.points, message.language));
      expected.current++;
      indexProgress(document, expected.current);
      if (expected.current < message.total) ask(expected.current);
      else {
        if (timer.current) clearTimeout(timer.current);
        const all = chapters.current;
        const parents = new Set(all.map((c) => c.parent));
        finishIndex(document, { version: 1, chapters: all.filter((c) => c.texts.length || parents.has(c.id)) });
      }
    } catch (error) { failIndex(document, String(error)); }
  }, [ask, document]);
  if (!bytes) return null;
  return <Reader src={bytes} fileSystem={useIndexFileSystem} width={size.width} height={size.height}
    manager="default" flow="scrolled-doc" injectedJavascript={source} onWebViewMessage={receive}
    onDisplayError={(error) => failIndex(document, error)}
    renderLoadingFileComponent={() => null} renderOpeningBookComponent={() => null} />;
}
