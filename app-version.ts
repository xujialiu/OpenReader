/**
 * The version Settings shows, so the owner can read off the device which build
 * is running.
 *
 * Every app change moves it to a new `-beta<n>`; AGENTS.md, "Every app change
 * carries a beta version", says which. It lives in the JavaScript bundle, so a
 * reload from Metro shows the new number as surely as a new build does — and a
 * reload is how most changes reach the simulator.
 *
 * **Not `version` in app.config.ts.** That one stays at the released version,
 * and the comment there says why. test/app-config.test.ts holds the two
 * together: this is either that version or a beta of the next one.
 *
 * A release drops the suffix here and moves app.config.ts and `package.json` to
 * the same number.
 */
export const APP_VERSION = '0.0.2-beta46';
