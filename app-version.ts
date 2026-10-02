/**
 * The version Settings shows, so the owner can read off the device which build
 * is running.
 *
 * Every app change moves it to a new `-beta<n>`; AGENTS.md, "Every app change
 * carries a beta version", says which. It lives in the JavaScript bundle, so a
 * reload from Metro shows the new number as surely as a new build does — and a
 * reload is how most changes reach the simulator.
 *
 * **Not `version` in app.config.ts.** That one is this without the `-beta<n>`,
 * the version the build leads to (#108), and the comment there says why.
 * `package.json` declares the same numbers, and test/app-config.test.ts holds
 * all three together.
 *
 * A release drops the suffix here. The first beta of the next version moves
 * `package.json` to its numbers.
 */
export const APP_VERSION = '1.0.0-beta20';
