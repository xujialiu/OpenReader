/**
 * The version Settings shows, so the owner can read off the device which build
 * is running: `x.y.z (n)-betaN`, the Version, Build Number and Beta of
 * CONTEXT.md (#127, ADR 0070). `-debug` follows it in Debug Mode
 * (`shownVersion`).
 *
 * - `x.y.z` changes only when the owner says so.
 * - `n` is the Build Number of the upload this tree leads to: the first change
 *   after an upload raises it by one, and it is never used twice.
 * - `-betaN` counts the app changes since that upload, from 1. Every app change
 *   moves it on (MEMORY/app-change.md); the commit that is uploaded drops it.
 *
 * It lives in the JavaScript bundle, so a reload from Metro shows the new line
 * as surely as a new build does — and a reload is how most changes reach the
 * simulator. `app.config.ts` reads both native numbers from it, and
 * test/app-config.test.ts holds it, them and `package.json` together.
 */
export const APP_VERSION = '1.0.0 (7)';
