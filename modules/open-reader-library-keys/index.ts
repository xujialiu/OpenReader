import { requireNativeView } from 'expo';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

export type LibraryKey = 'find' | 'escape';

interface LibraryKeysProps extends ViewProps {
  /** Command-F: open Library Search, or put the cursor back in its field. */
  find: boolean;
  /** Escape: end selection, or close search. */
  escape: boolean;
  onKey(event: NativeSyntheticEvent<{ key: LibraryKey }>): void;
}

/**
 * A Library or Folder page's hardware-keyboard commands (#339, ADR 0090). It
 * draws nothing; the navigation stack offers its keys only while its page is
 * on top with nothing presented over it.
 */
export const LibraryKeys = requireNativeView<LibraryKeysProps>('OpenReaderLibraryKeys');
