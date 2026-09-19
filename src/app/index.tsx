/**
 * The public surface of `src/app/`: one component, which is the app.
 *
 * Everything below it is a screen, the shell that arranges the screens
 * (`shell.tsx`), or the wiring in `use-reading.ts`. The layering is the one
 * `src/README.md` draws — this directory may reach into `core/`, `playback/`,
 * `renderer/` and `keys/`, and none of them may reach back or sideways. It is
 * the only place in OpenReader where all five meet, which is what an app is.
 *
 * There used to be a `ReaderProvider` and a single screen here. Both moved into
 * `shell.tsx` when ADR 0019 gave the app four screens and a stack; this file is
 * one line so that `App.tsx` imports one name and nothing about the arrangement
 * of the screens leaks out of the directory.
 */

export { OpenReader } from './shell';
