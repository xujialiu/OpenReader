import { ActivityIndicator, type ColorValue } from 'react-native';
import { INK } from './controls';

export function LoadingSpinner({ color = INK.text }: { color?: ColorValue }) {
  return <ActivityIndicator size="small" color={color} accessibilityLabel="Loading audio" />;
}
