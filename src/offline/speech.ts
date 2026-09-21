import type { AppSettings } from "../app/settings";
import { prepareSpeechText } from "../core/speech-text";

type BracketSettings = Pick<AppSettings, "stripBrackets" | "bracketPairs">;

/**
 * What reading sends to a Provider for one Utterance, and therefore what its
 * saved audio is named by (ADR 0028).
 *
 * Offline Narration used to send and name the Utterance's own text. That
 * agreed with reading only because reading never stripped either: the bracket
 * setting had not reached the engine (#25). With it wired, a downloaded
 * sentence with brackets would have been saved under a name reading never asks
 * for, and its audio made with the brackets Fish swallows. So the download
 * path turns each text into this at the boundary, the same way `clips.ts`
 * does for reading.
 */
export function downloadSpeech(text: string, settings: BracketSettings): string {
  return settings.stripBrackets ? prepareSpeechText(text, true, settings.bracketPairs).text : text;
}

/**
 * The setting a chapter's membership keys answer to: off, or on with its list.
 * The list does not matter while the switch is off, so it is not recorded then.
 */
export function speechKeying(settings: BracketSettings): string {
  return JSON.stringify(settings.stripBrackets ? [true, settings.bracketPairs] : [false]);
}
