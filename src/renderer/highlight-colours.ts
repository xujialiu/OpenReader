/**
 * The **Highlight Colours** (CONTEXT.md): the colour and opacity the sentence
 * being read and the word being spoken are marked in (#118, design and ADR
 * 0068). Part of Appearance, and the same under either theme.
 *
 * Here and not in `highlighter.ts` because the app's Appearance drawer, its
 * accent (`src/app/`) and the page's stylesheet all read it, and a test must
 * be able to import it: it imports nothing.
 *
 * **One colour and one opacity per level, stored the way the desktop
 * Zotero-TTS plugin stores them** (`highlight.sentenceColor` /
 * `sentenceAlpha`, `wordColor` / `wordAlpha`): a `#rrggbb` string and a whole
 * percent, 0–100. The phone's colour picker answers `#RRGGBBAA`; its alpha is
 * kept as the nearest whole percent. 0 is allowed (owner's Q11): a word at 0
 * is a reading marked by the sentence alone.
 */

/** One level's mark: a colour, `#rrggbb` in lower case, and its opacity in whole percent. */
export interface HighlightColour {
  color: string;
  opacity: number;
}

/** The sentence being read and, over it, the word being spoken. */
export interface HighlightColours {
  sentence: HighlightColour;
  word: HighlightColour;
}

/**
 * The two looks the app has had, offered above the owner's own choice
 * (owner's Q2, Q4, Q7).
 *
 * **Amber** is the light page's mark before #118: `rgba(255,196,0,0.22)` and
 * `rgba(255,168,0,0.62)`. **Blue** is the dark page's, `#434665` and `#4456de`
 * (#69), at amber's opacities: opaque, its sentence put black letters on a
 * light page at 2.3:1, and the two themes now share one mark.
 *
 * Their names are what VoiceOver says; the drawer shows only their samples.
 */
export const HIGHLIGHT_PRESETS = {
  blue: { sentence: { color: '#434665', opacity: 22 }, word: { color: '#4456de', opacity: 62 } },
  amber: { sentence: { color: '#ffc400', opacity: 22 }, word: { color: '#ffa800', opacity: 62 } },
} as const satisfies Record<string, HighlightColours>;

/** A preset's id. */
export type HighlightPreset = keyof typeof HIGHLIGHT_PRESETS;

/** The presets in the order the drawer offers them: Amber, the app's first look, then Blue. */
export const HIGHLIGHT_PRESET_ORDER: readonly HighlightPreset[] = ['amber', 'blue'];

/** What VoiceOver calls each preset. */
export const HIGHLIGHT_PRESET_LABELS: Readonly<Record<HighlightPreset, string>> = { amber: 'Amber', blue: 'Blue' };

/**
 * Blue, for a new install and for a settings file written before #118 (owner's
 * Q4): the only one of the two whose spoken word stays readable on both pages,
 * 6.4:1 on white and 7.2:1 on the dark page, where amber's is 2.82:1.
 */
export const DEFAULT_HIGHLIGHT_COLOURS: HighlightColours = HIGHLIGHT_PRESETS.blue;

const HEX = /^#[0-9a-f]{6}$/;

/** A colour as stored: `#rrggbb` in lower case, or null for anything else. `#RRGGBBAA` gives its colour; its alpha is the picker's, read by `fromPicker`. */
export function readHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const lower = value.trim().toLowerCase();
  if (HEX.test(lower)) return lower;
  if (/^#[0-9a-f]{8}$/.test(lower)) return lower.slice(0, 7);
  return null;
}

/** An opacity as stored: a whole percent, 0–100, or null for anything else. */
export function readOpacity(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** One level read back from a settings file, each half that is missing or malformed taken from `preset` on its own. */
function readColour(value: unknown, preset: HighlightColour): HighlightColour {
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return { color: readHex(object.color) ?? preset.color, opacity: readOpacity(object.opacity) ?? preset.opacity };
}

/** The Highlight Colours read back from a settings file: Blue for anything missing or malformed. */
export function readHighlightColours(value: unknown): HighlightColours {
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    sentence: readColour(object.sentence, DEFAULT_HIGHLIGHT_COLOURS.sentence),
    word: readColour(object.word, DEFAULT_HIGHLIGHT_COLOURS.word),
  };
}

/**
 * What the phone's colour picker answered, as a level: `#RRGGBBAA` (or
 * `#RRGGBB`, opaque) to a colour and a whole percent. Null when it is neither.
 */
export function fromPicker(value: string): HighlightColour | null {
  const lower = value.trim().toLowerCase();
  if (HEX.test(lower)) return { color: lower, opacity: 100 };
  if (!/^#[0-9a-f]{8}$/.test(lower)) return null;
  return { color: lower.slice(0, 7), opacity: Math.round((parseInt(lower.slice(7, 9), 16) / 255) * 100) };
}

/** A level as the picker's `selection`: `#RRGGBBAA`, its alpha the opacity. */
export function toPicker(level: HighlightColour): string {
  const alpha = Math.round((readOpacity(level.opacity) ?? 100) * 2.55).toString(16).padStart(2, '0');
  return (readHex(level.color) ?? '#000000') + alpha;
}

/** The three channels of a stored colour, 0–255. */
export function channels(color: string): [number, number, number] {
  const hex = readHex(color) ?? '#000000';
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** A level as a CSS colour: `rgba(r, g, b, a)`, `a` the opacity as a fraction. */
export function rgba(level: HighlightColour): string {
  const [r, g, b] = channels(level.color);
  const a = (readOpacity(level.opacity) ?? 0) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** The preset these colours are, all four values alike, or null when they are the owner's own (owner's Q12). */
export function presetOf(colours: HighlightColours): HighlightPreset | null {
  const same = (a: HighlightColour, b: HighlightColour) => readHex(a.color) === readHex(b.color) && readOpacity(a.opacity) === readOpacity(b.opacity);
  return HIGHLIGHT_PRESET_ORDER.find((id) => same(colours.sentence, HIGHLIGHT_PRESETS[id].sentence) && same(colours.word, HIGHLIGHT_PRESETS[id].word)) ?? null;
}
