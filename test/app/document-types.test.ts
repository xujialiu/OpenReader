import type { ExportedConfig, ExportedConfigWithProps, InfoPlist } from 'expo/config-plugins';
import { describe, expect, it } from 'vitest';

import withEpubDocumentTypes from '../../plugins/with-epub-document-types';

/**
 * ADR 0019, the half that is not JavaScript: iOS is told this app opens EPUBs,
 * or the app is absent from Files' "Open in" and from every share sheet — with
 * no error, anywhere, to explain the absence.
 *
 * The plugin runs at prebuild, which no other test in this suite reaches, so
 * this is the only thing that would notice it being undone. It is plain
 * TypeScript against a plain object, so unlike the rest of `src/app/` it can be
 * run here at all.
 *
 * Both refusals are tested as well as both writes. They are the house style of
 * `plugins/with-ui-scene-lifecycle.ts` — every edit fails the prebuild if what
 * it expects is not there — and a refusal nobody has watched fire is a comment.
 */

/** A generated Info.plist, as the mod receives it. Only `modResults` is read by this plugin. */
function generated(plist: InfoPlist): ExportedConfigWithProps<InfoPlist> {
  return { name: 'OpenReader', slug: 'openreader', modResults: plist } as ExportedConfigWithProps<InfoPlist>;
}

async function run(plist: InfoPlist): Promise<InfoPlist> {
  const config = withEpubDocumentTypes({ name: 'OpenReader', slug: 'openreader' }) as ExportedConfig;
  const mod = config.mods?.ios?.infoPlist;
  if (!mod) throw new Error('The plugin registered no iOS Info.plist mod at all.');
  const result = await mod(generated(plist));
  return result.modResults;
}

describe('ADR 0019: iOS is told this app opens EPUBs', () => {
  it('declares the EPUB content type by its UTI', async () => {
    const plist = await run({});
    // The system's own type on Apple platforms — `UTType(mimeType:
    // "application/epub+zip")` resolves to it, which is what the file picker in
    // src/app/document.ts already relies on. Declaring a type of our own would
    // be a second declaration of one fact.
    expect(plist.CFBundleDocumentTypes).toEqual([
      {
        CFBundleTypeName: 'EPUB',
        CFBundleTypeRole: 'Viewer',
        LSHandlerRank: 'Alternate',
        LSItemContentTypes: ['org.idpf.epub-container'],
      },
    ]);
  });

  it('asks for the owner’s own file rather than a copy of every book', async () => {
    // Without this key iOS copies the file into Documents/Inbox first, for
    // every open including one from Files — 34 MB duplicated before a line of
    // JavaScript runs.
    const plist = await run({});
    expect(plist.LSSupportsOpeningDocumentsInPlace).toBe(true);
  });

  it('leaves everything else in the generated Info.plist alone', async () => {
    const plist = await run({ CFBundleDisplayName: 'OpenReader', UIBackgroundModes: ['audio'] });
    expect(plist.CFBundleDisplayName).toBe('OpenReader');
    expect(plist.UIBackgroundModes).toEqual(['audio']);
  });

  it('fails the prebuild when something else already declares document types', async () => {
    await expect(run({ CFBundleDocumentTypes: [] })).rejects.toThrow(/already contains\s+CFBundleDocumentTypes/);
  });

  it('fails the prebuild when something else already sets the in-place key', async () => {
    // `false` and not `true`, because the value this plugin would have written
    // is the one a merge would silently agree with — and agreeing silently is
    // the outcome being prevented.
    await expect(run({ LSSupportsOpeningDocumentsInPlace: false })).rejects.toThrow(/already sets\s+LSSupportsOpeningDocumentsInPlace/);
  });
});
