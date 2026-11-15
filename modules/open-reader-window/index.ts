import { requireNativeView } from 'expo';
import { createElement } from 'react';
import { type NativeSyntheticEvent, Platform, type ViewProps } from 'react-native';

export type VerticalBarEdge = 'none' | 'leading' | 'trailing';

interface WindowTraitsProps extends ViewProps {
  onVerticalBarChange(event: NativeSyntheticEvent<{ edge: VerticalBarEdge }>): void;
}

const NativeObserver = Platform.OS === 'ios'
  ? requireNativeView<WindowTraitsProps>('OpenReaderWindow')
  : null;

/** Reports the hosting window's public trait, not a guessed device or fold state. */
export function WindowTraitsObserver(props: WindowTraitsProps) {
  return NativeObserver ? createElement(NativeObserver, props) : null;
}
