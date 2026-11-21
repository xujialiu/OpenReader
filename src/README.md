# Source guide

## From startup to a screen

1. [Package entry point](../index.ts) runs the early debug and reduced-motion setup, then registers the app with Expo.
2. [App root](app/index.tsx) mounts the gesture root around [the navigation shell](app/shell.tsx). The shell connects the screens and owns the shared Library and Settings state.
3. Follow a route to its screen: [Library](app/library-screen.tsx) for browsing books and folders, [Reader](app/reader-screen.tsx) for an open document, or [Settings](app/settings-screen.tsx) for preferences.

## Build identity

[App name](build/app-name.ts) supplies the display name. [App version](build/app-version.ts) holds the version, formal base build number and beta. [Build variant](build/build-variant.ts) derives the identity of the formal, free and Debug copies. [Expo configuration](../app.config.ts) uses these values for the native build.

## Reading and playback

| Directory | What lives there | Decision |
| --- | --- | --- |
| [core/providers/](core/providers/) | Speech provider requests, audio and word timings | ADR 0013 |
| [core/segmenter/](core/segmenter/) | Splitting text into utterances | ADR 0006 |
| [core/sync/](core/sync/) | Reading positions in the owner's WebDAV folder | ADR 0003 |
| [core/document/](core/document/) | Document identity and reading positions | ADR 0004, 0007, 0008 |
| [playback/](playback/) | Audio read-ahead, time-stretch and the clock that drives highlighting | ADR 0012, 0009 |
| [renderer/](renderer/) | The bridge to epub.js in a WebView and its highlighter | ADR 0011, 0005 |
| [now-playing/](now-playing/) | Lock screen and headphone controls | ADR 0016 |
| [keys/](keys/) | Provider API keys in the Keychain | ADR 0002 |

[Core](core/) runs under Node. Platform modules can import it. [ESLint](../eslint.config.js) keeps platform dependencies out of core, and the [import-boundary tests](../test/core/providers/import-boundary.test.ts) check that rule.
