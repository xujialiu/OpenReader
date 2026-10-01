import { Alert, Button, Host, Text, TextField, useNativeState } from '@expo/ui/swift-ui';
import { disabled } from '@expo/ui/swift-ui/modifiers';
import { useContext, useState } from 'react';
import { StyleSheet } from 'react-native';

import { SchemeContext } from './controls';

/**
 * **Rename**: the phone's own alert with a field in it, over a Document's
 * actions drawer (#117, design 0066). A new name is one short answer, and the
 * phone asks for one of those in an alert, not on a page.
 *
 * SwiftUI's alert rather than React Native's `Alert.prompt`, because a blank
 * name must not be saved (design 0027) and `Alert.prompt` cannot disable a
 * button: `RCTAlertManager` adds the field and the buttons once and never looks
 * at them again. SwiftUI's alert reads its buttons' `disabled` as the field
 * changes.
 *
 * Mounted only while it is up, inside the drawer, so the phone presents it
 * from the drawer's sheet, over it, and the drawer stays where it was. The
 * field starts with the current name and the caret after it: SwiftUI's alert
 * makes its own field from the `TextField` and does not take its selection
 * (measured on iOS 27.0, notes 2026-10-01).
 */
export function RenameAlert({ name, onCancel, onSave }: { name: string; onCancel(): void; onSave(name: string): void }) {
  const scheme = useContext(SchemeContext) ?? undefined;
  const text = useNativeState(name);
  const [typed, setTyped] = useState(name);
  return (
    <Host style={styles.host} colorScheme={scheme}>
      <Alert title="Rename" isPresented onIsPresentedChange={() => {}}>
        {/* An alert hangs from a view; this one shows nothing. */}
        <Alert.Trigger><Text> </Text></Alert.Trigger>
        <Alert.Actions>
          <TextField text={text} autoFocus placeholder="Name" onTextChange={setTyped} />
          <Button label="Cancel" role="cancel" onPress={onCancel} />
          <Button label="Save" onPress={() => onSave(typed)} modifiers={[disabled(!typed.trim())]} />
        </Alert.Actions>
      </Alert>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { height: 1, left: 0, position: 'absolute', top: 0, width: 1 },
});
