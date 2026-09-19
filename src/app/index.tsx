/**
 * The public surface of `src/app/`: one component, which is the app.
 *
 * Everything below it is either a screen or the wiring in `use-reading.ts`, and
 * the layering is the one `src/README.md` draws — this directory may reach into
 * `core/`, `playback/`, `renderer/` and `keys/`, and none of them may reach back
 * or sideways. It is the only place in OwnReader where all five meet, which is
 * what an app is.
 */

import { ReaderProvider } from '@epubjs-react-native/core';

import { ReaderScreen } from './reader-screen';

export function OwnReader() {
  /**
   * `ReaderProvider` is `@epubjs-react-native/core`'s own context and has to sit
   * above both `<Reader>` and `useReaderBridge`, which reads `injectJavascript`
   * and `goToLocation` out of it (ADR 0011). It is the only provider the app
   * needs: there is no store to configure, no account to hold and no navigator,
   * because there is one screen.
   */
  return (
    <ReaderProvider>
      <ReaderScreen />
    </ReaderProvider>
  );
}
