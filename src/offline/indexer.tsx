import { Reader, ReaderProvider, useReader } from '@epubjs-react-native/core';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { documentFile } from '../app/library';
import { useReaderFileSystem } from '../app/reader-file-system';
import { asDocumentId } from '../core/document';
import type { Block } from '../core/segmenter';
import { highlighterSource } from '../renderer/highlighter';
import { sectionChapters, type NavPoint } from './model';
import { EMPTY_LOCATIONS_SOURCE } from './reader-locations';
import { failPreparation, finishPreparation, indexDocument, planOf, preparationRequest, useDownloads, type PreparationRequest } from './runtime';

function useIndexFileSystem() { return useReaderFileSystem('epubjs-offline'); }
const source = highlighterSource();
// Compatibility boundary for the installed renderer's incorrectly typed JSON
// source prop. Keep identity stable: Reader regenerates its HTML when it changes.
const emptyLocations = EMPTY_LOCATIONS_SOURCE as unknown as ComponentProps<typeof Reader>['initialLocations'];

/** Remains mounted while the selected document is synthesized, but renders
 * another section only when the scheduler asks for selected text. */
export function DownloadIndexer() {
  useDownloads();
  const document = indexDocument();
  const size = useWindowDimensions();
  if (!document) return null;
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ position: 'absolute', left: -size.width * 2, top: 0, width: size.width, height: size.height, opacity: 0 }}>
    <ReaderProvider><Indexer key={document} document={document} request={preparationRequest()} /></ReaderProvider>
  </View>;
}
function Indexer({ document, request }: { document: string; request: PreparationRequest | null }) {
  const size = useWindowDimensions();
  const [bytes, setBytes] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const { injectJavascript } = useReader();
  const latest = useRef(request);
  const [initialLocation] = useState(() => request ? planOf(document)?.sections?.[request.section].href : undefined);
  useEffect(() => { latest.current = request; }, [request]);
  useEffect(() => {
    let alive = true;
    const id = asDocumentId(document);
    if (!id) return;
    void documentFile(id, 'epub').base64().then((value) => { if (alive) setBytes(value); }, (error) => {
      if (alive && latest.current) failPreparation(latest.current.token, String(error));
    });
    return () => { alive = false; };
  }, [document]);
  useEffect(() => {
    if (!request) return;
    const timer = setTimeout(() => failPreparation(request.token, 'Chapter preparation timed out. Continue to try again.'), 60_000);
    if (ready) injectJavascript(`window.openreaderOfflineSection(${request.section}, ${JSON.stringify(request.points)}, ${request.token}); true;`);
    return () => clearTimeout(timer);
  }, [request, ready, injectJavascript]);
  const receive = useCallback((event: unknown) => {
    const message = event as { type: string; token: number; index: number; blocks: Block[]; points: NavPoint[]; language: string; detail: string };
    if (message.type === 'openreader:document') { setReady(true); return; }
    if (message.type === 'openreader:offline-error') { failPreparation(message.token, message.detail); return; }
    if (message.type !== 'openreader:offline-section') return;
    try { finishPreparation(message.token, sectionChapters(message.index, message.blocks, message.points, message.language)); }
    catch (error) { failPreparation(message.token, String(error)); }
  }, []);
  if (!bytes) return null;
  return <Reader src={bytes} fileSystem={useIndexFileSystem} width={size.width} height={size.height}
    manager="default" flow="scrolled-doc" initialLocations={emptyLocations} initialLocation={initialLocation} injectedJavascript={source} onWebViewMessage={receive}
    onDisplayError={(error) => { if (latest.current) failPreparation(latest.current.token, error); }}
    renderLoadingFileComponent={() => null} renderOpeningBookComponent={() => null} />;
}
