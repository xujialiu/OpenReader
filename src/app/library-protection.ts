import type { LoadedLibrary } from './library';

/** One refusal for the disk writer and for operations that would first change a sibling store. */
export function assertLibraryWritable(loaded: LoadedLibrary): void {
  if (loaded.frozen) {
    throw new Error(loaded.note ?? 'The Library file could not be read. Nothing was written.');
  }
  if (loaded.ignored.length > 0) {
    throw new Error(
      `The Library file carries ${loaded.ignored.length} key(s) this build does not know (${loaded.ignored.join(', ')}). ` +
        'Rewriting it would strip them in silence, which is the defect ADR 0003 exists to prevent. Nothing was written.',
    );
  }
}
