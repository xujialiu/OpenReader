/**
 * The app's name, as a person reads it. One constant, so there is one place to
 * change it.
 *
 * Read by `app.config.ts`, where it becomes `CFBundleDisplayName` — the label
 * under the icon, and the name in the crash report when the app does not launch
 * at all (ADR 0018) — and by `src/app/`, which prints it in the reader's header
 * and in the two sentences that name the app to the owner. Those are the same
 * name and have to stay the same name: a header that disagrees with the home
 * screen is the kind of defect nobody files.
 *
 * The capitalisation is a **choice**. The name is written `openreader` wherever
 * a machine reads it, and where a person reads it the capital letters have to
 * come from somewhere; they come from here, so that changing them is this line
 * and not a sweep through the app, the config and the documentation.
 *
 * **Not the identifier.** The npm package name, the Expo slug, the bundle
 * identifier, the Keychain service and the highlight names are all `openreader`
 * and are written out literally where they are used. Two reasons they do not
 * come from here: they have no capitalisation to get wrong, and each one is a
 * string somebody will one day have to find by grep — in a Keychain viewer, in
 * a crash report, in `expo-modules-autolinking`'s output — where a constant
 * they cannot see would be worse than a repeated word.
 */
export const APP_NAME = 'OpenReader';
