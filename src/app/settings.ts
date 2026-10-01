import { DEFAULT_LOOKUP, type LookupSettings } from '../translation/settings';
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
import { DEFAULT_BRACKET_PAIRS } from '../core/speech-text';
// The renderer's, because it is the renderer that paints it — and imported from
// the file rather than from the directory's index, which would drag the bridge
// and React Native into a module whose whole point is that neither is here.
import { DEFAULT_APPEARANCE, type Appearance, type ReadingScheme } from '../renderer/highlighter';
// The file rather than `playback/index.ts`, for the same reason: `gap.ts` is
// frames and seconds, and the index is the audio graph.
import { DEFAULT_GAP, type GapSettings } from '../playback/gap';
import { azureRegion, type HeaderWebSocket } from '../core/providers/azure';
import type { ProviderDeps, ProviderSettings } from '../core/providers/factory';
import { FISH_API } from '../core/providers/fish';
import { getLocalEngine, LOCAL_ENGINES } from '../core/providers/local/registry';
import { OPENAI_URL } from '../core/providers/openai';
import { SPEECHIFY_API } from '../core/providers/speechify';
import type { ProviderId } from '../core/providers/types';
import { createWarmConnections, originOf } from '../core/warm-connections';
import { DEBUG_MODE } from '../debug/mode';
import { loggedFetch } from '../debug/requests';

/**
 * The one set of Provider connections the app has, kept from dying of quiet
 * (#26, ADR 0040): every request a Provider makes goes through its `fetch`, and
 * saved audio asks it to keep the synthesis connection warm (`keepWarm`). One
 * instance for both, because what it knows is which origins have been reached
 * and when.
 *
 * The global `fetch` is looked up at each call rather than held, so whatever
 * stands in for it — the walkthrough harness's `watchfetch` — sees the warm-ups
 * too.
 */
const connections = createWarmConnections({ fetch: (input, init) => fetch(input, init), now: () => Date.now() });

/**
 * The other argument `createProvider(id, settings, deps)` takes: `fetch` (ADR
 * 0013), and the two Azure's WebSocket route needs (ADR 0037).
 *
 * `fetch` is the platform's, through `connections` above. The platform's itself
 * is wrapped in an arrow rather than passed by name, because it is called with
 * no receiver and handing over the global itself would make that call's `this`
 * undefined.
 *
 * `getWebSocket` is React Native's own `WebSocket`, which takes the upgrade's
 * request headers as a third argument (`Libraries/WebSocket/WebSocket.js`); the
 * cast is to that shape, which the DOM's type does not declare. `newRequestId`
 * is `Math.random`, as the Device Name is: `crypto` is not among the globals
 * measured on this Hermes, and an id that only has to differ from the next
 * request's needs nothing stronger.
 */
export const providerDeps: ProviderDeps = {
  fetch: connections.fetch,
  getWebSocket: () => WebSocket as unknown as HeaderWebSocket,
  newRequestId: () => Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
};

/**
 * `providerDeps` for one Provider, with each of its requests a Debug Log line
 * in Debug Mode (ADR 0054): the method, the address, the status and how long it
 * took, never its headers (`src/debug/requests.ts`). `providerDeps` itself in a
 * build without Debug Mode.
 */
export function providerDepsFor(provider: ProviderId): ProviderDeps {
  return DEBUG_MODE ? { ...providerDeps, fetch: loggedFetch('provider', provider, providerDeps.fetch) } : providerDeps;
}

/**
 * Where a Provider's synthesis goes, as an origin, or null when there is no
 * connection of its own to keep warm (ADR 0040).
 *
 * The three hosted Providers have one fixed address each; the two that speak to a
 * server of the owner's own go wherever the owner typed. Azure is null: its
 * synthesis opens a WebSocket of its own for every Utterance (`turn` in
 * `azure.ts`), so it never reuses an idle connection and has none to lose.
 */
export function synthesisOrigin(settings: AppSettings, provider: ProviderId): string | null {
  switch (provider) {
    case 'fish':
      return originOf(FISH_API);
    case 'openai-official':
      return originOf(OPENAI_URL);
    case 'speechify':
      return originOf(SPEECHIFY_API);
    case 'compatible':
      return originOf(settings.compatible.baseURL);
    case 'local':
      return originOf(settings.local.baseURL);
    case 'azure':
      return null;
  }
}

/**
 * Keep a Provider's connection from going quiet while nothing else is sent to it
 * (ADR 0040): a credential-free GET to the origin's root that nothing waits for,
 * at most once per 20 s of quiet, and only for an origin a request has reached.
 * Null does nothing.
 */
export function keepWarm(origin: string | null): void {
  if (origin !== null) connections.keepWarm(origin);
}

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
  azure: 'Azure',
  speechify: 'Speechify',
  fish: 'Fish Audio',
  local: 'Kokoro FastAPI',
};

/** The order the sections are offered in — the plugin's, for the ones both have — with the one that needs no credentials last, because it is the one with an address to type. */
export const PROVIDER_ORDER: readonly ProviderId[] = ['openai-official', 'compatible', 'azure', 'speechify', 'fish', 'local'];

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

/** Whether a request without a key is refused before it goes out. The hosted services; see `keyRequired` in `openai-compatible.ts`. */
export function keyIsRequired(provider: ProviderId): boolean {
  return provider === 'openai-official' || provider === 'azure' || provider === 'speechify' || provider === 'fish';
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

/** Device-local preferences. Credentials live separately in the Keychain. */
export interface AppSettings {
  lookup: LookupSettings;
  provider: ProviderId;
  enabledProviders: readonly ProviderId[];
  recentVoices: readonly DocumentVoice[];
  fish: { includeOfficial: boolean; includeOwn: boolean; includeManual: boolean; voices: string };
  openai: {
    /** A speech model id. Empty by default: OpenAI publishes the list and `listModels()` asks for it, so the app does not guess one. */
    model: string;
  };
  compatible: {
    baseURL: string;
    model: string;
  };
  azure: {
    /** As the owner typed it, `East Asia` or `eastasia`; `azureRegion` is what makes it a host name. */
    region: string;
  };
  local: {
    /** A `LOCAL_ENGINES` id. */
    engine: string;
    baseURL: string;
  };
  /** Most recently selected voice; recentVoices retains earlier enabled alternatives. */
  voice: string;
  /** The reading speed. Applied at playback and nowhere else; a Provider is never asked for it (ADR 0009). */
  rate: number;
  /**
   * How the document's text is set: the **Appearance** sheet (ADR 0019).
   *
   * **Per app and not per Document**, which is the one thing about it that could
   * have gone either way. A Voice belongs to a document (ADR 0010) because it is
   * a property of *that book being read*; how big the text is belongs to the
   * owner's eyes, and they do not change between books.
   *
   * The size goes one step further and is never the book's at all (ADR 0030):
   * two books typeset differently read at the same size. So does the Text
   * Alignment (ADR 0034): body text is justified until the owner picks Left.
   * So do the Margins (ADR 0056): 16 points a side in every book.
   * The font still starts on each book's own, so a face the owner liked needs
   * no putting back.
   */
  appearance: Appearance;
  /**
   * Light, dark, or whatever the phone is doing: the **theme** (ADR 0022).
   *
   * In General and not in the Appearance sheet, and the two are not the same
   * question. Appearance is how the text on the page is set — the owner's size,
   * margins and alignment, and a font that starts on the book's own; the theme
   * is what the whole app looks like, in the room the owner is in, and it reaches the
   * Library and the Settings screens as well as the page.
   */
  theme: ThemeSetting;
  /**
   * Whether the brackets around text are spoken with it — wherever they stand
   * in a sentence since #25 — which is the **Speech Text** (CONTEXT.md), and
   * ADR 0028.
   *
   * On by default, which is the one default here that is not a guess: a voice
   * reading `<Log in>` as its punctuation is unlistenable, and an owner who
   * wanted the brackets read would be the surprising one. It is also what the
   * desktop plugin does, and the same book read on both should be read the
   * same way.
   */
  stripBrackets: boolean;
  /**
   * Which pairs count as brackets, as the owner typed them — `validateBracketPairs`
   * in `core/speech-text.ts` is what says whether that is a list at all.
   *
   * Editable rather than fixed because the default `<> []` is a Western list and
   * this app is read in Chinese, where what wraps a heading is `【】` and what
   * wraps a title is `《》`. A fixed list would mean the setting does nothing on
   * the books it was asked for.
   */
  bracketPairs: string;
  /**
   * The **Pause between sentences** and the **Pause between paragraphs**
   * (CONTEXT.md, #60, ADR 0047): silence the playback adds, in milliseconds
   * at Natural Pace.
   *
   * App-wide, as in the desktop plugin, and for the same reason as the
   * brackets: one pair is true of every Voice, so the same number means the
   * same pause on the phone and on the desktop. Not in `engineIdentity`: it is
   * set in General, which is reached only from the Library, so the engine it
   * would rebuild is already gone and the next one is built with it.
   */
  pauses: GapSettings;
  /**
   * How the page follows the reading (CONTEXT.md **Following**, #71, ADR 0050).
   *
   * `scrolling` is how the page moves to keep the line there: a line at a time,
   * the default, or continuously as the words are spoken (`Scrolling`).
   *
   * `linePosition` is the **Line Position**: how far down the visible page the
   * line being spoken is held, in percent of that page's height, one of
   * `LINE_POSITIONS`. App-wide, like the theme, because it is about the owner's
   * eyes and not about a book; and per device, like every setting here, because
   * a phone and a tablet hold the page at different heights. It reaches an open
   * document live, as the Appearance does, and is not in `engineIdentity`: no
   * Clip depends on it.
   */
  following: FollowingSettings;
  /**
   * How many of a chapter's sentences a download asks each Provider for at
   * once (#64): the provider's own page, **Sentences at once**. Per Provider
   * because the limit is the service's — Fish Audio states five for an account
   * that has spent under $100, Azure's free tier counts requests per minute —
   * and one number for all would raise the ones that refuse along with the one
   * that does not. Read by a download as each chapter starts, never by
   * playback, so not in `engineIdentity`.
   */
  sentencesAtOnce: Readonly<Record<ProviderId, number>>;
  /**
   * The **Sync Folder** (CONTEXT.md, ADR 0003): where it is and who this device
   * is to it, and whether sync is on. The password is not here — it is a
   * Keychain entry (`src/keys/`) — and the Device Name is not either, being a
   * fact about the device rather than a choice (`src/app/library.ts`).
   *
   * `enabled` is a switch with a check behind it: turning it on runs the
   * connection check and it stays on only if that passed, and while it is on
   * the address and the username are frozen — the way a Provider is enabled.
   */
  sync: SyncSettings;
  /**
   * The services the owner has let receive text (#109, ADR 0064), one key per
   * recipient as `src/app/consent.ts` names them. On this device only, like
   * every setting here, and never migrated: each device asks for itself. The
   * consent gate is the only reader and the only writer.
   */
  consent: readonly string[];
}

export interface SyncSettings {
  url: string;
  username: string;
  enabled: boolean;
}

/** How the page follows the reading; see `AppSettings.following`. */
export interface FollowingSettings {
  /** Whether the page moves a line at a time or continuously: one of `SCROLLINGS`. */
  scrolling: Scrolling;
  /** The Line Position, in percent of the visible page's height from its top: one of `LINE_POSITIONS`. */
  linePosition: number;
}

/**
 * How the page follows the reading (#71, ADR 0050).
 *
 * `'line'` holds the line being spoken still and glides the next one up when
 * the voice reaches it, a line at a time. `'continuous'` moves the page all the
 * while, by how far along its line the word being spoken is, so that the next
 * line has arrived where this one was by the time the voice gets there. The
 * owner asked for both and chose the first as the default.
 */
export type Scrolling = 'line' | 'continuous';

/** The two, in the order General offers them: the default first. */
export const SCROLLINGS: readonly Scrolling[] = ['line', 'continuous'];

/** What each is called in General's `Scrolling` menu. */
export const SCROLLING_LABELS: Readonly<Record<Scrolling, string>> = {
  line: 'By line',
  continuous: 'Continuous',
};

/**
 * The Line Positions General offers (#71), in percent: a fifth of the way down
 * to four fifths, a tenth at a time. The middle is the default, as the owner
 * asked; 30 % is where Speechify holds its line (notes/NOTES_2026-09-25.md,
 * 23:00). Nothing above 80 %: the line would sit on the player's edge.
 */
export const LINE_POSITIONS: readonly number[] = [20, 30, 40, 50, 60, 70, 80];

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

/** What each is called on the screen. The third names what it follows rather than what it shows, because what it shows changes. */
export const THEME_LABELS: Readonly<Record<ThemeSetting, string>> = {
  light: 'Light',
  dark: 'Dark',
  // Two words rather than `Follow the system`'s four. This sits on the right of
  // a row next to its label, where a sentence fragment reads as a sentence that
  // was cut off.
  system: 'Match Device',
};

/**
 * The pauses General offers, in milliseconds at Natural Pace (#60).
 *
 * A menu of these rather than a number field: one tap, and no keyboard over the
 * screen. Every one is a multiple of 50, the desktop plugin's step, so a value
 * set there can be set here too; the ranges are where a pause is still a pause
 * rather than a stop. The paragraph list goes twice as far because it is the
 * whole pause at a Block, not an addition to the sentence's.
 */
export const SENTENCE_PAUSES_MS: readonly number[] = [0, 50, 100, 150, 200, 300, 400, 500, 750, 1000];
export const PARAGRAPH_PAUSES_MS: readonly number[] = [0, 100, 200, 300, 400, 500, 750, 1000, 1500, 2000];

/**
 * What **Sentences at once** offers (#64): one to ten, where ten is the most
 * measured — Fish Audio refused none of 40 at ten, and eight was no slower
 * (notes/NOTES_2026-09-25.md, 13:27).
 */
export const SENTENCES_AT_ONCE: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Where each Provider starts. Fish Audio's replies carry
 * `ratelimit-limit-concurrency: 5`, the limit its documentation gives an
 * account that has spent under $100, and five at once came back 5.3 times as
 * fast as one, each as quickly as when alone (notes/NOTES_2026-09-25.md,
 * 13:27). Every other Provider starts at one: Azure's free tier counts
 * requests per minute (#40), Speechify's provider sends its own requests one
 * after another, and the rest were not measured.
 */
export const DEFAULT_SENTENCES_AT_ONCE: Readonly<Record<ProviderId, number>> = {
  'openai-official': 1, compatible: 1, azure: 1, speechify: 1, fish: 5, local: 1,
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
  lookup: DEFAULT_LOOKUP,
  // A placeholder until a voice is selected. All providers start disabled.
  provider: 'openai-official',
  enabledProviders: [],
  recentVoices: [],
  fish: { includeOfficial: true, includeOwn: false, includeManual: false, voices: '' },
  openai: { model: '' },
  compatible: { baseURL: '', model: '' },
  // Empty rather than the plugin's `eastasia`: a key belongs to one region, and
  // a guessed one is refused with the same 401 as a wrong key.
  azure: { region: '' },
  local: { engine: LOCAL_ENGINES[0].id, baseURL: LOCAL_ENGINES[0].defaultBaseURL },
  voice: '',
  rate: 1.5,
  // 26px with 24-point Margins, the owner's choice of 2026-10-01, and each
  // Document's own font until the owner picks one (`highlighter.ts`'s
  // `DEFAULT_APPEARANCE`, ADR 0030).
  appearance: DEFAULT_APPEARANCE,
  // Follow the system, which is the only default that is not a guess about the
  // room the owner is in.
  theme: 'system',
  // On, and the same list the desktop plugin starts from (ADR 0028).
  stripBrackets: true,
  bracketPairs: DEFAULT_BRACKET_PAIRS,
  // 0 and 200 ms, which is what a reading sounded like before either was a
  // setting (`gap.ts`).
  pauses: DEFAULT_GAP,
  // A line at a time, the way the owner asked for first, held in the middle of
  // what can be seen, which is where the page held the sentence being spoken
  // before either was a setting (#71).
  following: { scrolling: 'line', linePosition: 50 },
  sentencesAtOnce: DEFAULT_SENTENCES_AT_ONCE,
  // Off, with nothing filled in: sync starts the moment the owner names a
  // folder and turns it on, and not before (issue #20).
  sync: { url: '', username: '', enabled: false },
  // Nothing yet: each service is asked about the first time it would receive text (#109).
  consent: [],
};

/**
 * What is still missing before the app can speak, in the owner's words.
 *
 * A list rather than the first problem found, because "enter a key" followed by
 * "now type a model" is two trips to the same page for something that could
 * have been said once. Three entries stand alone instead, each the one thing to
 * do next: `no provider`, `a Voice` and `enabling` (#103).
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
  // Nothing to choose from: enabling one is the only way on, whichever Provider a
  // book remembers (#103).
  if (settings.enabledProviders.length === 0) return { ready: false, missing: ['no provider'] };
  // No Voice means no Provider was chosen either: `settings.provider` is then the
  // one the settings start with, or one since disabled, and what it lacks is
  // beside the point. The Voice sheet offers only Providers that are ready (#103).
  if (!settings.voice.trim()) return { ready: false, missing: ['a Voice'] };
  if (!settings.enabledProviders.includes(settings.provider)) return { ready: false, missing: ['enabling'] };
  const missing = missingBeforeVoice(settings, settings.provider, hasKey);
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

    // A key and the region it was made in: the host is the region's own, and a
    // key sent to another region is refused (ADR 0037).
    case 'azure':
      if (!hasKey) missing.push('an API key');
      if (!settings.azure.region.trim()) missing.push('a region');
      else if (!azureRegion(settings.azure.region)) missing.push('a region id such as eastasia');
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

/** Only explicit enablement makes a provider selectable. Configuration is checked at enablement. */
export function enabledProviders(settings: AppSettings): readonly ProviderId[] {
  return PROVIDER_ORDER.filter((provider) => settings.enabledProviders.includes(provider));
}

/** The last selection for each provider is enough to find the latest enabled narrator. */
export function selectVoice(settings: AppSettings, provider: ProviderId, voice: string): AppSettings {
  if (!settings.enabledProviders.includes(provider)) return settings;
  return { ...settings, provider, voice,
    recentVoices: [{ provider, voice }, ...settings.recentVoices.filter((entry) => entry.provider !== provider)] };
}

export function recentEnabledVoice(settings: AppSettings): DocumentVoice | null {
  return settings.recentVoices.find((entry) => isProviderId(entry.provider) &&
    settings.enabledProviders.includes(entry.provider) && entry.voice.trim()) ?? null;
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
  if (!choice || !isProviderId(choice.provider) || !choice.voice.trim()) {
    const recent = recentEnabledVoice(settings);
    return recent && isProviderId(recent.provider)
      ? { ...settings, provider: recent.provider, voice: recent.voice }
      : { ...settings, voice: '' };
  }
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

/** What the Library and the player say when no Provider is enabled (#103). */
export const NO_PROVIDER_SENTENCE = 'No provider is enabled. Enable one in Settings to listen.';

/**
 * "OpenAI needs an API key and a model."
 *
 * A Provider is named only when the owner chose it: with none enabled, or no
 * Voice chosen, `provider` is only the one the settings start with (#103).
 */
export function readinessSentence(provider: ProviderId, missing: readonly string[]): string {
  const label = PROVIDER_LABELS[provider];
  if (missing.includes('no provider')) return NO_PROVIDER_SENTENCE;
  if (missing.includes('a Voice')) return 'Choose a Voice.';
  if (missing.includes('enabling')) return `${label} is disabled. Choose an enabled provider.`;
  if (missing.length === 0) return `${label} is ready.`;
  return `${label} needs ${andList(missing)}.`;
}

/**
 * What the player says about readiness, or null when there is nothing to say.
 *
 * Nothing when only a Voice is missing: the Voice button already reads
 * `Choose a Voice`, and a note would say it twice (#103).
 */
export function readinessNote(provider: ProviderId, ready: Readiness): string | null {
  if (ready.ready || ready.missing.includes('a Voice')) return null;
  return readinessSentence(provider, ready.missing);
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
  if (provider === 'azure') fields.push('a region');
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
 * Every section is filled in because `ProviderSettings` describes all six and
 * the factory reads one; the five that are not selected get no key and no
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
    // The region as typed: `azure.ts` makes it the host, or refuses it before
    // any request, so the key is never sent to a host it did not name.
    azure: { apiKey: keyFor('azure'), region: settings.azure.region },
    speechify: { apiKey: keyFor('speechify') },
    // `freeOnly` is on and is not yet a setting: a missing or unknown `model`
    // header makes Fish fall back to the **paid** model, so the value that
    // spends nothing remains fixed (philosophy rule 4). Source choices and
    // manual ids now come from the provider's configuration screen.
    fish: { apiKey: keyFor('fish'), freeOnly: true, ...settings.fish },
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
  const config = settings.provider === 'local' ? settings.local : settings.provider === 'compatible' ? settings.compatible :
    settings.provider === 'openai-official' ? settings.openai : settings.provider === 'fish' ? settings.fish :
      settings.provider === 'azure' ? settings.azure : null;
  // The bracket setting decides the Speech Text, so it is part of what is
  // spoken: a change rebuilds the engine instead of mixing the two forms in
  // one reading (#25).
  return JSON.stringify([settings.provider, settings.enabledProviders.includes(settings.provider), settings.voice, config,
    settings.stripBrackets, settings.bracketPairs]);
}
