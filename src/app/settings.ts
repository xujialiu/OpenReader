/**
 * What the owner has chosen, and whether it is enough to speak.
 *
 * Nothing in this file imports the platform, and that is the point: it is the
 * part of `src/app/` a test can reach at all (`test/README.md` — React Native
 * code is not tested in this suite by design), and what it decides is the one
 * thing ADR 0014 makes unavoidable. **There is no zero-key path.** Until a key
 * is in the Keychain or a server address has been typed, the app cannot speak,
 * and `readiness` is what lets the screen say so instead of failing at the first
 * synthesis.
 *
 * The API key is a **setting**. `providerSettings` is the one place it is joined
 * to a Provider's configuration on its way to
 * `createProvider(id, settings, deps)`, it never arrives as a side effect of
 * synthesis (ADR 0002, which `src/keys/store.ts` states from the other end), and
 * it is written only into the section of the Provider it was typed for —
 * philosophy rule 3: keys go only to the provider they belong to, and to nowhere
 * else.
 */

import { COMPATIBLE_LABEL } from '../core/providers/compatible';
// The renderer's, because it is the renderer that paints it — and imported from
// the file rather than from the directory's index, which would drag the bridge
// and React Native into a module whose whole point is that neither is here.
import { DOCUMENT_APPEARANCE, type Appearance, type ReadingScheme } from '../renderer/highlighter';
import type { ProviderDeps, ProviderSettings } from '../core/providers/factory';
import { getLocalEngine, LOCAL_ENGINES } from '../core/providers/local/registry';
import type { ProviderId } from '../core/providers/types';

/**
 * The other argument `createProvider(id, settings, deps)` takes, which on this
 * platform is one thing: `fetch` (ADR 0013).
 *
 * Wrapped in an arrow rather than passed by name, because a provider calls
 * `deps.fetch(url, init)` with no receiver and handing over the global itself
 * would make that call's `this` undefined.
 */
export const providerDeps: ProviderDeps = { fetch: (input, init) => fetch(input, init) };

/**
 * The sections the owner can choose between, with the name each is shown under.
 *
 * Two of the four labels are imported rather than written here, because they are
 * the Provider's own and are the same in every language. The local engines are
 * not listed at all: `LOCAL_ENGINES` is the list, and `registry.ts` says adding
 * an engine is an adapter file and one line there — so no engine name is
 * repeated in the UI.
 */
export const PROVIDER_LABELS: Readonly<Record<ProviderId, string>> = {
  'openai-official': 'OpenAI',
  compatible: COMPATIBLE_LABEL,
  speechify: 'Speechify',
  fish: 'Fish Audio',
  local: 'A server of your own',
};

/** The order the sections are offered in: the one that needs no credentials last, because it is the one with an address to type. */
export const PROVIDER_ORDER: readonly ProviderId[] = ['openai-official', 'compatible', 'speechify', 'fish', 'local'];

/**
 * Whether this section has an API key at all.
 *
 * `local` has none — a server on the owner's own machine is reached by address
 * (ADR 0014's one configuration that needs no credentials) — and `compatible`
 * may or may not, which is `keyRequired: false` in `compatible.ts`: the request
 * goes out without an Authorization header and a server that wanted one answers
 * 401.
 */
export function keyIsOffered(provider: ProviderId): boolean {
  return provider !== 'local';
}

/** Whether a request without a key is refused before it goes out. The two hosted services; see `keyRequired` in `openai-compatible.ts`. */
export function keyIsRequired(provider: ProviderId): boolean {
  return provider === 'openai-official' || provider === 'speechify' || provider === 'fish';
}

/**
 * Whether this section is offered a **gateway headers** field.
 *
 * Exactly the two sections of `ProviderSettings` that carry `headers?`, which is
 * exactly where `createProvider` parses it — `factory.ts` calls
 * `parseHeaderList` for `compatible` and for `local` and for nothing else. That
 * is the whole rule, and it is philosophy rule 6 from the other side: a field on
 * any other Provider's screen would be typed into and do nothing.
 *
 * Both rather than only the local engine, because the thing a gateway sits in
 * front of is a server, and an address that speaks OpenAI's API is as likely to
 * be the owner's own as one that speaks an engine's. The owner's desktop export
 * settles it as a fact rather than a guess: it carries the same header text
 * under three separate service keys, one of which is the OpenAI-compatible one.
 *
 * The two entries are separate, so the text typed for one never reaches the
 * other — philosophy rule 3, which the desktop export does not keep, since one
 * copy of a token under three keys is one token that three services could be
 * sent.
 */
export function headersAreOffered(provider: ProviderId): boolean {
  return provider === 'local' || provider === 'compatible';
}

/**
 * Everything the owner has set. One object, held for the session.
 *
 * It is **not** stored anywhere. Shared Settings live in the Sync Folder
 * (ADR 0003) and `src/core/sync/` is not written yet, so the honest thing is to
 * keep them in memory and have the screen say so — rather than inventing a
 * private store now that the folder will have to argue with later.
 *
 * **The credentials are the exception, and that is why they are not in here.**
 * The API key and the gateway headers are in the Keychain, because ADR 0002 says
 * where a credential lives and nothing about that waits on sync — and because
 * this object's eventual home is a file on a server the owner syncs through,
 * which philosophy rule 3 says is not where a Provider's credential goes. So
 * there is no `headers` field below, and the absence is the decision.
 *
 * The two sections that speak OpenAI's API keep their own model and address, as
 * `ProviderSettings` does: nothing typed for one is ever sent to the other.
 */
export interface AppSettings {
  provider: ProviderId;
  openai: {
    /** A speech model id. Empty by default: OpenAI publishes the list and `listModels()` asks for it, so the app does not guess one. */
    model: string;
  };
  compatible: {
    baseURL: string;
    model: string;
  };
  local: {
    /** A `LOCAL_ENGINES` id. */
    engine: string;
    baseURL: string;
  };
  /**
   * The Voice, as the **global default** — what a Document that has never been
   * opened will be read in. One Voice belongs to exactly one Provider
   * (CONTEXT.md), which is why choosing one from another Provider's list chooses
   * that Provider too.
   *
   * ADR 0010 binds a Voice to a Document with this as the default, and that half is
   * built now: a `LibraryEntry` keeps its own `voice`, `settingsForDocument` below
   * is how it reaches the reading, and `use-library.ts`'s `voiced` is what writes
   * it. So this is read at the moment a Document is opened for the first time and
   * not afterwards — changing it steers the next new Document and leaves a book
   * already underway exactly as it was, which is the whole of design 0010.
   */
  voice: string;
  /** The reading speed. Applied at playback and nowhere else; a Provider is never asked for it (ADR 0009). */
  rate: number;
  /**
   * How the document's text is set: the **Appearance** sheet (ADR 0019).
   *
   * **Per app and not per Document**, which is the one thing about it that could
   * have gone either way. A Voice belongs to a document (ADR 0010) because it is
   * a property of *that book being read*; how big the text is belongs to the
   * owner's eyes, and they do not change between books. The cost is that a book
   * whose own typography the owner liked has to be put back by hand — which is
   * what "follow the document" being the default makes rare.
   */
  appearance: Appearance;
  /**
   * Light, dark, or whatever the phone is doing: the **theme** (ADR 0022).
   *
   * In General and not in the Appearance sheet, and the two are not the same
   * question. Appearance is how *this book's* text is set and defaults to
   * following the document; the theme is what the whole app looks like, in the
   * room the owner is in, and it reaches the Library and the Settings screens as
   * well as the page.
   */
  theme: ThemeSetting;
}

/**
 * What the owner chose in General, which is one more thing than the app can
 * actually paint: `resolveTheme` turns three into two.
 *
 * `'system'` is a real answer and not an absence. A phone that switches itself at
 * sunset is a thing the owner set up on purpose, and an app that ignored it would
 * be the one light window in a dark evening.
 */
export type ThemeSetting = 'light' | 'dark' | 'system';

/** The three, in the order General offers them: the two answers first, then the one that defers. */
export const THEME_SETTINGS: readonly ThemeSetting[] = ['light', 'dark', 'system'];

/** What each is called on the screen. `System` names what it follows rather than what it shows, because what it shows changes. */
export const THEME_LABELS: Readonly<Record<ThemeSetting, string>> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Follow the system',
};

/**
 * The theme the app actually paints.
 *
 * The one decision in the theme, which is why it is a function here rather than a
 * conditional at each of the three places that need the answer — the app's own
 * colours, the status bar, and the stylesheet that reaches the page. Three copies
 * of it is three chances for the chrome and the page to disagree, which on a dark
 * theme is a white rectangle in the middle of a dark screen.
 *
 * `system` is resolved against what the platform reports, and **everything that
 * is not `'dark'` resolves to light**. React Native answers with four things, not
 * two: `'light'`, `'dark'`, `'unspecified'` — which is what a window whose style
 * has been given back to the system reports — and `null`, before the platform has
 * said anything at all. Light is the right reading of the last two for one
 * reason: it is what the page already is, so a wrong guess corrects to dark in a
 * frame, while the other way round would flash a black page at someone reading in
 * daylight.
 *
 * The parameter is spelled out rather than imported: `settings.ts` imports no
 * platform (`eslint.config.js` would not stop it here, but the rule is the same
 * one), and these four values are the whole of React Native's `ColorSchemeName`.
 */
export function resolveTheme(
  setting: ThemeSetting,
  system: 'light' | 'dark' | 'unspecified' | null | undefined,
): ReadingScheme {
  if (setting === 'light' || setting === 'dark') return setting;
  return system === 'dark' ? 'dark' : 'light';
}

export const DEFAULT_SETTINGS: AppSettings = {
  // The first section, not the easiest one: a first run that says "OpenAI has no
  // API key" states ADR 0014's rule where the owner can act on it, and the sheet
  // names the server-of-your-own path underneath. Defaulting to an address that
  // happens to be free would hide the rule instead.
  provider: 'openai-official',
  openai: { model: '' },
  compatible: { baseURL: '', model: '' },
  local: { engine: LOCAL_ENGINES[0].id, baseURL: LOCAL_ENGINES[0].defaultBaseURL },
  voice: '',
  rate: 1.5,
  // Follow the document, in both. A book that ships its own typography keeps it
  // until the owner overrides it (`highlighter.ts`'s `Appearance`).
  appearance: DOCUMENT_APPEARANCE,
  // Follow the system, which is the only default that is not a guess about the
  // room the owner is in.
  theme: 'system',
};

/**
 * What is still missing before the app can speak, in the owner's words.
 *
 * A list rather than the first problem found, because "enter a key" followed by
 * "now choose a Voice" followed by "now type a model" is three trips to the same
 * sheet for something that could have been said once.
 */
export type Readiness = { readonly ready: true } | { readonly ready: false; readonly missing: readonly string[] };

/**
 * Whether the selected Provider can be built and asked to speak.
 *
 * `hasKey` rather than the key itself: this decides what the screen shows, and a
 * secret has no business in that. The value is read from the Keychain at the
 * moment it is needed and handed straight to `providerSettings`.
 */
export function readiness(settings: AppSettings, hasKey: boolean): Readiness {
  const missing = [...missingBeforeVoice(settings, settings.provider, hasKey)];
  // Last, because it is the one thing every section needs and reads oddly first.
  if (!settings.voice.trim()) missing.push('a Voice');
  return missing.length === 0 ? { ready: true } : { ready: false, missing };
}

/**
 * What a Provider still needs before it could be read with, **leaving the Voice
 * out**.
 *
 * Split from `readiness` for one caller, and the split is the decision: the voice
 * list of ADR 0020 shows only the Providers the owner has set up, and it is the
 * list a Voice is *chosen* from — so the Voice cannot be one of the things it asks
 * for. Everything else is, including the model. A Provider that could list its
 * voices but not speak with them would be a trap: the picker would offer it, the
 * owner would pick, and the reading would stop on "OpenAI needs a model" at the
 * first press of Play.
 *
 * It takes the Provider explicitly rather than reading `settings.provider`,
 * because the whole point is asking about one that is not in use.
 */
export function missingBeforeVoice(settings: AppSettings, provider: ProviderId, hasKey: boolean): readonly string[] {
  const missing: string[] = [];

  switch (provider) {
    case 'openai-official':
      if (!hasKey) missing.push('an API key');
      if (!settings.openai.model.trim()) missing.push('a model');
      break;

    case 'compatible':
      if (!settings.compatible.baseURL.trim()) missing.push('the address of the server');
      if (!settings.compatible.model.trim()) missing.push('a model');
      break;

    case 'speechify':
      if (!hasKey) missing.push('an API key');
      break;

    // Fish needs nothing but the key: its Voice list carries the model's own
    // Default entry, so there is no model to type and no address.
    case 'fish':
      if (!hasKey) missing.push('an API key');
      break;

    case 'local':
      // An engine id that is in no adapter would reach `createProvider` and
      // throw there; naming it here keeps that a sentence rather than an error.
      if (!getLocalEngine(settings.local.engine)) missing.push('an engine the app knows');
      if (!settings.local.baseURL.trim()) missing.push('the address of the server');
      break;
  }

  return missing;
}

/**
 * The Providers the owner has actually set up, in `PROVIDER_ORDER`.
 *
 * This is the voice list of ADR 0020 and docs/design/0020: **only configured
 * Providers appear at all**, and when none is the list is empty apart from a line
 * pointing at Settings. That was chosen over listing everything greyed out — this
 * app is for one owner, who knows what they have signed up for, and a list mostly
 * full of things that cannot be picked is a worse list than a short one that
 * works. The cost, stated in the design file, is that nothing in the reading
 * screen advertises a service that has not been configured.
 *
 * `hasKey` is asked per Provider rather than passed as one boolean, because the
 * Keychain holds one entry per Provider and the answer differs between them. The
 * key itself never comes near this function.
 */
export function configuredProviders(settings: AppSettings, hasKey: (provider: ProviderId) => boolean): readonly ProviderId[] {
  return PROVIDER_ORDER.filter((provider) => missingBeforeVoice(settings, provider, hasKey(provider)).length === 0);
}

/**
 * A Document's own Voice (ADR 0010): the pair a `LibraryEntry` remembers, as this
 * app would have to read it.
 *
 * Structural and `provider: string`, because that is how the Library carries it and
 * why: "an entry written by a build with one more provider than this one must still
 * be readable — losing a Reading Position because the Voice names something
 * unfamiliar would be the worst possible trade" (`core/document/library.ts`). So
 * the validation is here, which is the layer that knows which Providers exist.
 */
export interface DocumentVoice {
  provider: string;
  voice: string;
}

/** Whether a string names a Provider this build has. The one place `PROVIDER_ORDER` is used as the closed set it is. */
export function isProviderId(id: string): id is ProviderId {
  return (PROVIDER_ORDER as readonly string[]).includes(id);
}

/**
 * The settings a **Document** is read with: the owner's, with its own Voice in
 * place of the default (ADR 0010).
 *
 * The one place the per-Document Voice is applied, and everything downstream
 * follows from it without knowing: `engineIdentity` sees this Provider and this
 * Voice, so the engine is built around them; `readiness` asks for this Provider's
 * key; the player's line and the Voice sheet show this Voice as the one in use. A
 * screen that reached past this to `settings.provider` would be the one place two
 * books could disagree about who is reading them.
 *
 * Only the pair moves. A model, an address and the Appearance are the owner's and
 * are the same in every book — `settings.ts`'s own comment on the Appearance is the
 * argument, and it is why this is not "the Document's settings".
 *
 * A choice this build cannot use — a Provider from a later version, an empty
 * Voice — leaves the settings alone, which reads the Document in the default Voice.
 * `unusableVoiceSentence` is what says so out loud; between them nothing is
 * silently substituted.
 */
export function settingsForDocument(settings: AppSettings, choice: DocumentVoice | null): AppSettings {
  if (!choice || !isProviderId(choice.provider) || !choice.voice.trim()) return settings;
  return { ...settings, provider: choice.provider, voice: choice.voice };
}

/**
 * What to say about a Document whose remembered Voice this build cannot use, or
 * null when there is nothing to say.
 *
 * It can only come from a Library file written by a build with a Provider this one
 * does not have (ADR 0003 keeps the file readable across versions on purpose), and
 * the reading still works — in the default Voice. Saying so is philosophy rule 1:
 * the alternative is a book that is quietly read by someone else.
 */
export function unusableVoiceSentence(choice: DocumentVoice | null): string | null {
  if (!choice || isProviderId(choice.provider)) return null;
  return (
    `This book remembers being read by "${choice.provider}", which this version of the app does not have. ` +
    'It is being read in the Voice the rest of the app is set to; choosing a Voice here replaces what it remembers.'
  );
}

/** "an API key, a model and a Voice" — the one place the commas and the final "and" are decided. */
export function andList(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "OpenAI needs an API key, a model and a Voice." */
export function readinessSentence(provider: ProviderId, missing: readonly string[]): string {
  const label = PROVIDER_LABELS[provider];
  if (missing.length === 0) return `${label} is ready.`;
  return `${label} needs ${andList(missing)}.`;
}

/**
 * What a Provider's own screen holds, for the row in the list that has to say
 * what is behind it before it is tapped.
 *
 * Not `readiness`, and the difference matters: `readiness` says what is
 * *missing* for the Provider in use, which is a question about the Keychain and
 * the settings as they are now. This says what the screen is *for*, which is
 * true whether or not the Provider has ever been used, and is what a list of six
 * rows can honestly show without six Keychain lookups.
 *
 * The Voice is deliberately absent. A Document keeps its own (ADR 0010) and the
 * one thing a Provider screen holds is the **default** for Documents not yet
 * opened, which belongs to the Provider in use (CONTEXT.md) — so it is not
 * something a Provider that is not in use holds either.
 *
 * The last two lines are derived from the predicates above rather than written
 * out, so a Provider that gains a key field or a headers field cannot end up
 * with a row that does not mention it.
 */
export function providerFields(provider: ProviderId): readonly string[] {
  const fields: string[] = [];
  if (provider === 'local') fields.push('an engine');
  if (provider === 'local' || provider === 'compatible') fields.push('the address of the server');
  if (provider === 'openai-official' || provider === 'compatible') fields.push('a model');
  if (keyIsOffered(provider)) fields.push(keyIsRequired(provider) ? 'an API key' : 'an API key if the server wants one');
  if (headersAreOffered(provider)) fields.push('the headers of a gateway in front of it');
  return fields;
}

/**
 * The owner's credentials for the Provider that is about to be built, read out
 * of the Keychain at the moment they are needed and never held anywhere else
 * (ADR 0002, ADR 0019).
 *
 * Two, because there are two: a key, and the gateway headers in front of a
 * server of the owner's own. Both are the empty string where the Provider has
 * none, which is what each one's own refusal is there to judge — a Provider that
 * requires a key answers 401, and a gateway that requires a token answers 403.
 */
export interface ProviderSecrets {
  key: string;
  /** The field as the owner typed it. `core/headers.ts` parses it; nothing here does. */
  headers: string;
}

/**
 * The settings `createProvider` reads, with each credential in the one section
 * it belongs to.
 *
 * Every section is filled in because `ProviderSettings` describes all five and
 * the factory reads one; the four that are not selected get no key and no
 * headers. That is not defensive tidiness — it is philosophy rule 3 in the only
 * place it can be enforced, since this is the single call that turns a typed
 * credential into something a Provider can use.
 */
export function providerSettings(settings: AppSettings, secrets: ProviderSecrets): ProviderSettings {
  const keyFor = (provider: ProviderId): string => (settings.provider === provider ? secrets.key : '');
  const headersFor = (provider: ProviderId): string => (settings.provider === provider ? secrets.headers : '');

  return {
    'openai-official': { apiKey: keyFor('openai-official'), model: settings.openai.model.trim() },
    compatible: {
      baseURL: settings.compatible.baseURL.trim(),
      apiKey: keyFor('compatible'),
      model: settings.compatible.model.trim(),
      headers: headersFor('compatible'),
    },
    speechify: { apiKey: keyFor('speechify') },
    // `freeOnly` is on and is not yet a setting: a missing or unknown `model`
    // header makes Fish fall back to the **paid** model, so the value that
    // spends nothing is the one to state until the sheet offers the switch
    // (philosophy rule 4, no silent spending). `voices` — the pasted model ids
    // of ADR 0010's per-document Voice — has no field yet either, and an empty
    // field is a field with no ids rather than a special case.
    fish: { apiKey: keyFor('fish'), freeOnly: true, voices: '' },
    // No key — a server of the owner's own is reached by address (ADR 0014) —
    // but headers, because that address can be behind a gateway that wants a
    // service token of its own, and `factory.ts` has passed
    // `parseHeaderList(settings.local.headers)` to the engine since the layer
    // was ported. Until this line there was no field to fill it from, which is
    // the whole of why a Kokoro behind Cloudflare Access answered 403
    // (notes/NOTES_2026-09-19.md, 22:48).
    local: { engine: settings.local.engine, baseURL: settings.local.baseURL.trim(), headers: headersFor('local') },
  };
}

/**
 * What identifies the Provider the engine was built around.
 *
 * A change to any of it is a different Provider or a different Voice, and the
 * Voice is fixed for an engine's lifetime (ADR 0010) — so the engine is thrown
 * away and built again. The rate is deliberately absent: it is a live parameter
 * of the graph (`setRate`) and putting it here would rebuild the engine, and
 * re-spend the quota, every time the owner nudged the speed. The Appearance is
 * absent for a stronger reason: it is not the engine's at all. It changes what
 * the page looks like and not one character of what is spoken, so an engine
 * rebuilt for it would re-spend the quota to change a font.
 */
export function engineIdentity(settings: AppSettings): string {
  return JSON.stringify([
    settings.provider,
    settings.voice,
    settings.openai.model,
    settings.compatible.baseURL,
    settings.compatible.model,
    settings.local.engine,
    settings.local.baseURL,
  ]);
}
