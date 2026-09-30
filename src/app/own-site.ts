import { Alert, Linking } from 'react-native';

/**
 * The project's own pages (#110), which GitHub Pages serves from `site/` in
 * this repository. This is the one place the app opens a URL.
 *
 * ADR 0017 forbids a tappable route to a Provider's signup, pricing or key
 * console, and `test/app/no-outgoing-links.test.ts` holds the rule: no file
 * under `src/` opens a URL except this one, and this one opens only addresses
 * under `SITE`. The privacy policy is not such a route: it names no Provider's
 * page, and guideline 5.1.1(i) requires it to be reachable from inside the app.
 */
export const SITE = 'https://xujialiu.github.io/OpenReader/';

/** What leaves the phone and where it goes (`site/privacy.html`). */
export const PRIVACY_POLICY = `${SITE}privacy.html`;

/** Opens the privacy policy in Safari. If that is refused, the alert gives the address so it can be typed instead. */
export function openPrivacyPolicy(): void {
  Linking.openURL(PRIVACY_POLICY).catch(() => Alert.alert('Could not open the privacy policy', PRIVACY_POLICY));
}
