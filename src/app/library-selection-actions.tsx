import { Button, Host } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonBorderShape, buttonStyle, controlSize, disabled as nativeDisabled, font } from '@expo/ui/swift-ui/modifiers';
import { useContext } from 'react';
import { Platform } from 'react-native';
import { SchemeContext, useAccent } from './controls';

/** The phone draws the capsule, glass, disabled state and reduced-transparency fallback. */
export function LibrarySelectionAction({ action, disabled, working, onPress }: {
  action: 'Move' | 'Delete'; disabled: boolean; working?: boolean; onPress(): void;
}) {
  const scheme = useContext(SchemeContext);
  const accent = useAccent();
  return <Host matchContents colorScheme={scheme ?? undefined} ignoreSafeArea="all"
    seedColor={action === 'Move' ? accent.reading : scheme === 'dark' ? '#ff453a' : '#ff3b30'}>
    <Button label={working ? 'Deleting…' : action} role={action === 'Delete' ? 'destructive' : 'default'} onPress={onPress}
      modifiers={[
        buttonStyle(Number.parseInt(String(Platform.Version), 10) >= 26 ? 'glass' : 'bordered'),
        buttonBorderShape('capsule'), controlSize('large'), font({ textStyle: 'body' }),
        nativeDisabled(disabled), accessibilityLabel(working ? 'Deleting selected entries' : `${action} selected`),
      ]} />
  </Host>;
}
