/**
 * The third-party components the app ships, each with its licence's own text
 * (#111, ADR 0065), as scripts/acknowledgements/generate.mjs writes them into
 * acknowledgements.json. Settings → Acknowledgements shows them.
 *
 * Read on first use, not at launch. The file is a few hundred kilobytes of
 * licence text that nobody needs until the page opens, and a JSON module
 * imported at the top of a screen is evaluated with the shell at startup (Expo's
 * Metro configuration does not inline requires).
 */

export interface Acknowledgement {
  /** As the component names itself: the npm package name, or the project's own name for what a package carries inside it. */
  readonly name: string;
  /** Every version the app ships, comma-separated; empty where the carrying package gives none. */
  readonly version: string;
  /** SPDX identifier or expression, or the project's own name for a licence that has none. */
  readonly license: string;
  /** The package it arrives inside, for a library that is not a package of its own. */
  readonly carriedBy?: string;
  /** What the text is and where it came from, where that is not the component's own licence file. */
  readonly note?: string;
  readonly text: string;
}

let loaded: readonly Acknowledgement[] | null = null;

export function acknowledgements(): readonly Acknowledgement[] {
  loaded ??= require('./acknowledgements.json') as Acknowledgement[];
  return loaded;
}

export function acknowledgement(name: string): Acknowledgement | undefined {
  return acknowledgements().find((entry) => entry.name === name);
}

/** The line under a licence: which version, and what it arrived inside, then whatever the note adds. */
export function aboutLine(entry: Acknowledgement): string {
  const facts: string[] = [];
  if (entry.version) facts.push(`Version ${entry.version}`);
  if (entry.carriedBy) facts.push(`${facts.length ? 'part' : 'Part'} of ${entry.carriedBy}`);
  return [facts.length ? `${facts.join(', ')}.` : '', entry.note].filter(Boolean).join(' ');
}
