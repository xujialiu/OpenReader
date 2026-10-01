import { parseLookupSettings } from '../translation/settings';
/** Local persistence only; this is not the shared sync format. Secrets never enter it. */
import { File, Paths } from 'expo-file-system';
import { FONT_SIZES, MARGINS, READING_FONTS, TEXT_ALIGNMENTS, type FontSize, type Margin, type ReadingFont, type TextAlignment } from '../renderer/highlighter';
import { CONSENT_KEY } from './consent';
import { DEFAULT_SETTINGS, DRAWER_HEIGHTS, isProviderId, LINE_POSITIONS, PARAGRAPH_PAUSES_MS, SCROLLINGS, SENTENCE_PAUSES_MS, SENTENCES_AT_ONCE, type AppSettings, type DocumentVoice, type Scrolling } from './settings';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown, fallback: string) => typeof value === 'string' ? value : fallback;

/**
 * The two ids ADR 0029 retired, and what they become.
 *
 * `Serif` was `Georgia, "Times New Roman", serif` and `Sans-serif` was
 * `Helvetica, Arial, sans-serif`, so each migrates to the face its own stack
 * already named first and an owner's book keeps rendering exactly as it did.
 */
const RETIRED_FONTS: Readonly<Record<string, ReadingFont>> = { serif: 'georgia', sans: 'helvetica' };

function readFont(value: unknown): AppSettings['appearance']['font'] {
  if (typeof value !== 'string') return DEFAULT_SETTINGS.appearance.font;
  if (READING_FONTS.some((font) => font.id === value)) return value as ReadingFont;
  return RETIRED_FONTS[value] ?? DEFAULT_SETTINGS.appearance.font;
}

/**
 * A size on the ladder, or the default. Nothing is converted: a percentage saved
 * by the build before ADR 0030 is simply not a size, and the app has not been
 * released, so the owner starts again at 16 rather than being carried across.
 */
function readSize(value: unknown): FontSize {
  return FONT_SIZES.find((size) => size === value) ?? DEFAULT_SETTINGS.appearance.size;
}

/** A margin on the ladder, or 16: a file written before #84 has none, and reads as a new install does. */
function readMargins(value: unknown): Margin {
  return MARGINS.find((margins) => margins === value) ?? DEFAULT_SETTINGS.appearance.margins;
}

/** One of the two, or Justify: a file written before ADR 0034 has none, and reads as a new install does. */
function readTextAlignment(value: unknown): TextAlignment {
  return TEXT_ALIGNMENTS.find((alignment) => alignment === value) ?? DEFAULT_SETTINGS.appearance.textAlignment;
}

/** A pause General offers, or the default: nothing else is a value the menu could show as chosen. */
function readPause(value: unknown, offered: readonly number[], fallback: number): number {
  return offered.find((ms) => ms === value) ?? fallback;
}

/** A Line Position General offers, or the middle, for the same reason (#71). Nothing is converted: the app is unreleased. */
function readLinePosition(value: unknown): number {
  return LINE_POSITIONS.find((percent) => percent === value) ?? DEFAULT_SETTINGS.following.linePosition;
}

/** A Drawer Height General offers, or half the screen, for the same reason (#117). Nothing is converted: the app is unreleased. */
function readDrawerHeight(value: unknown): number {
  return DRAWER_HEIGHTS.find((percent) => percent === value) ?? DEFAULT_SETTINGS.drawerHeight;
}

/** A way of scrolling General offers, or By line, the default, for the same reason (#71). */
function readScrolling(value: unknown): Scrolling {
  return SCROLLINGS.find((scrolling) => scrolling === value) ?? DEFAULT_SETTINGS.following.scrolling;
}

/** Each Provider's number of sentences at once if the menu offers it, else that Provider's default (#64). */
function readSentencesAtOnce(value: unknown): AppSettings['sentencesAtOnce'] {
  const saved = object(value);
  return Object.fromEntries(Object.entries(DEFAULT_SETTINGS.sentencesAtOnce).map(([id, fallback]) =>
    [id, SENTENCES_AT_ONCE.find((n) => n === saved[id]) ?? fallback])) as AppSettings['sentencesAtOnce'];
}

/** Explicit projection also prevents legacy credential fields from being persisted. */
export function parseSettings(value: unknown): AppSettings {
  const root = object(value);
  const data = object(root.settings ?? value);
  const openai = object(data.openai), compatible = object(data.compatible), local = object(data.local), azure = object(data.azure);
  const fish = object(data.fish), appearance = object(data.appearance), sync = object(data.sync), pauses = object(data.pauses);
  const following = object(data.following);
  const voices: DocumentVoice[] = Array.isArray(data.recentVoices) ? data.recentVoices.flatMap((entry: unknown) => {
    const item = object(entry);
    return typeof item.provider === 'string' && isProviderId(item.provider) && typeof item.voice === 'string' && item.voice.trim()
      ? [{ provider: item.provider, voice: item.voice }] : [];
  }) : [];
  return {
    lookup: parseLookupSettings(data.lookup),
    provider: typeof data.provider === 'string' && isProviderId(data.provider) ? data.provider : DEFAULT_SETTINGS.provider,
    voice: string(data.voice, ''),
    // Only this version knows explicit enablement. Older configurations migrate disabled.
    enabledProviders: root.version === 1 && Array.isArray(data.enabledProviders)
      ? [...new Set(data.enabledProviders.filter((id): id is AppSettings['provider'] => typeof id === 'string' && isProviderId(id)))] : [],
    recentVoices: voices,
    openai: { model: string(openai.model, DEFAULT_SETTINGS.openai.model) },
    compatible: { baseURL: string(compatible.baseURL, ''), model: string(compatible.model, '') },
    azure: { region: string(azure.region, '') },
    local: { engine: string(local.engine, DEFAULT_SETTINGS.local.engine), baseURL: string(local.baseURL, DEFAULT_SETTINGS.local.baseURL) },
    fish: { includeOfficial: typeof fish.includeOfficial === 'boolean' ? fish.includeOfficial : true,
      includeOwn: fish.includeOwn === true, includeManual: fish.includeManual === true, voices: string(fish.voices, '') },
    rate: typeof data.rate === 'number' && Number.isFinite(data.rate) && data.rate >= 0.5 && data.rate <= 4 ? data.rate : DEFAULT_SETTINGS.rate,
    theme: data.theme === 'dark' || data.theme === 'light' ? data.theme : 'system',
    stripBrackets: data.stripBrackets !== false,
    // Kept exactly as it was typed, including a list that does not validate: the
    // owner edits this with the setting off, and a half-finished edit that the
    // app silently replaced on the way to disk would be an edit they never made.
    // Nothing guesses from it either — `prepareSpeechText` strips nothing at all
    // when the list is invalid.
    bracketPairs: string(data.bracketPairs, DEFAULT_SETTINGS.bracketPairs),
    pauses: {
      sentenceMs: readPause(pauses.sentenceMs, SENTENCE_PAUSES_MS, DEFAULT_SETTINGS.pauses.sentenceMs),
      paragraphMs: readPause(pauses.paragraphMs, PARAGRAPH_PAUSES_MS, DEFAULT_SETTINGS.pauses.paragraphMs),
    },
    following: { scrolling: readScrolling(following.scrolling), linePosition: readLinePosition(following.linePosition) },
    drawerHeight: readDrawerHeight(data.drawerHeight),
    sentencesAtOnce: readSentencesAtOnce(data.sentencesAtOnce),
    appearance: {
      font: readFont(appearance.font),
      size: readSize(appearance.size),
      margins: readMargins(appearance.margins),
      textAlignment: readTextAlignment(appearance.textAlignment),
    },
    // The switch is read as written: it was turned on after a check passed,
    // and the next launch syncs without checking again (issue #20).
    sync: { url: string(sync.url, ''), username: string(sync.username, ''), enabled: sync.enabled === true },
    // The recipients the owner allowed (#109): kept as written, once each. A file
    // written before them has none, and every service is asked about afresh.
    consent: Array.isArray(data.consent)
      ? [...new Set(data.consent.filter((key): key is string => typeof key === 'string' && CONSENT_KEY.test(key)))] : [],
  };
}
export function readSettings(): AppSettings {
  const file = new File(Paths.document, 'settings.json');
  return file.exists ? parseSettings(JSON.parse(file.textSync())) : DEFAULT_SETTINGS;
}
export function writeSettings(settings: AppSettings): void {
  const clean = parseSettings({ version: 1, settings });
  new File(Paths.document, 'settings.json').write(JSON.stringify({ version: 1, settings: clean }));
}
