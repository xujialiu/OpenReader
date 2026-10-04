import { Alert, Linking } from 'react-native';

/**
 * The project's own addresses: its pages (#110), which GitHub Pages serves from
 * `site/` in this repository, its repository and its author's email (#129).
 * This is the one place the app opens a URL.
 *
 * ADR 0017 forbids a tappable route to a Provider's signup, pricing or key
 * console, and `test/app/no-outgoing-links.test.ts` holds the rule: no file
 * under `src/` opens a URL except this one, and this one opens only the three
 * constants below. None of them is such a route. The privacy policy names no
 * Provider's signup page, and guideline 5.1.1(i) requires it to be reachable
 * from inside the app. The repository's README and the site are held to the
 * same rule by the same test, since each is one tap from the app (#129).
 * Guideline 1.5 asks that the app itself carry a way to reach its author.
 */
export const SITE = 'https://xujialiu.github.io/OpenReader/';

/** What leaves the phone and where it goes (`site/privacy.html`). */
export const PRIVACY_POLICY = `${SITE}privacy.html`;

/** Where the source is, and where a star helps others find the project (#129). */
export const REPOSITORY = 'https://github.com/xujialiu/OpenReader';

/** The repository as its row names it: the address without its host. */
export const REPOSITORY_NAME = 'xujialiu/OpenReader';

/** The Author of CONTEXT.md, as Settings names him (#129). */
export const AUTHOR = 'Xujia Liu';

/** The Author's address, the same one the support page and the privacy policy give. */
export const EMAIL = 'xujialiuphd@gmail.com';

/** Opens the privacy policy in Safari. If that is refused, the alert gives the address so it can be typed instead. */
export function openPrivacyPolicy(): void {
  Linking.openURL(PRIVACY_POLICY).catch(() => Alert.alert('Could not open the privacy policy', PRIVACY_POLICY));
}

/** Opens the repository in Safari, or gives its address when that is refused. */
export function openRepository(): void {
  Linking.openURL(REPOSITORY).catch(() => Alert.alert('Could not open GitHub', REPOSITORY));
}

/** Starts an email to the Author in the phone's mail app, or gives the address when there is none to start it in. */
export function emailAuthor(): void {
  Linking.openURL(`mailto:${EMAIL}`).catch(() => Alert.alert('Could not open Mail', EMAIL));
}
