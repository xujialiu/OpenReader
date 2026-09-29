import { describe, expect, it } from 'vitest';

import { sharedFileName } from '../../src/app/share-name';

/**
 * The name a shared Document's file carries (#95, ADR 0059).
 *
 * The recipient sees this name and nothing else: in the AirDrop prompt, in
 * Files, in a mail attachment. So it is the name the Library shows for the
 * Document, rename included, made into something a file system will take.
 */

const bytes = (text: string) => new TextEncoder().encode(text).length;

describe('sharedFileName', () => {
  it('is the Library name with the format as its extension', () => {
    expect(sharedFileName('The Long Road', 'epub')).toBe('The Long Road.epub');
  });

  it('keeps letters a file system accepts, full-width punctuation included', () => {
    expect(sharedFileName('三体：地球往事', 'epub')).toBe('三体：地球往事.epub');
  });

  it('turns a slash, a backslash or a colon between words into a dash with the spaces kept', () => {
    expect(sharedFileName('Volume Three: The Long Road', 'epub')).toBe('Volume Three - The Long Road.epub');
    expect(sharedFileName('Either / Or', 'epub')).toBe('Either - Or.epub');
  });

  it('turns one inside a word into a bare dash', () => {
    expect(sharedFileName('Part 1/2', 'epub')).toBe('Part 1-2.epub');
    expect(sharedFileName('C:\\Books', 'epub')).toBe('C--Books.epub');
  });

  it('turns line breaks and tabs from a document title into single spaces', () => {
    expect(sharedFileName('The First\nLegendary\t\tBeast', 'epub')).toBe('The First Legendary Beast.epub');
  });

  it('does not start with a dot, which would hide the file', () => {
    expect(sharedFileName('...And Then There Were None', 'epub')).toBe('And Then There Were None.epub');
  });

  it('is Untitled when nothing of the name is left', () => {
    expect(sharedFileName(' \n ', 'epub')).toBe('Untitled.epub');
    expect(sharedFileName('..', 'epub')).toBe('Untitled.epub');
  });

  it('fits in 255 UTF-8 bytes, extension included, and is cut between characters', () => {
    const long = sharedFileName('字'.repeat(200), 'epub');
    expect(bytes(long)).toBeLessThanOrEqual(255);
    expect(long).toBe(`${'字'.repeat(83)}.epub`);
  });

  it('does not cut a character made of several code points in half', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    const long = sharedFileName(family.repeat(20), 'epub');
    expect(bytes(long)).toBeLessThanOrEqual(255);
    expect(long.replace('.epub', '').split(family).every((part) => part === '')).toBe(true);
  });

  it('does not end the cut name in a space', () => {
    const name = sharedFileName(`${'a'.repeat(249)} b`, 'epub');
    expect(name).toBe(`${'a'.repeat(249)}.epub`);
  });
});
