import { requireNativeView } from 'expo';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

export interface PaletteChange {
  /** sRGB colour plus alpha, #rrggbbaa. */
  color: string;
  eventCount: number;
}

interface PaletteProps extends ViewProps {
  /** Acknowledgement travels with the value so a stale render cannot rewind a drag. */
  selection: PaletteChange;
  scheme: 'light' | 'dark';
  onSelectionChange(event: NativeSyntheticEvent<PaletteChange>): void;
}

/** UIKit's complete inline palette, not SwiftUI ColorPicker's presenting well. */
export const NativePalette = requireNativeView<PaletteProps>('OpenReaderPalette');
