import { Alert, Button, Host, Text, TextField, useNativeState } from '@expo/ui/swift-ui';
import { useContext } from 'react';
import { StyleSheet } from 'react-native';

import { SchemeContext } from './controls';

/**
 * **Debug Note** (CONTEXT.md, #305, ADR 0082): the phone's own alert over the
 * reader's actions drawer, in a build with Debug Mode only.
 *
 * Its message is the Debug Note's time, fixed when `Debug` was tapped and
 * shown exactly as `Save and Copy` copies it, so what the author reads is what
 * he pastes. One field, which may be left blank: the moment alone is worth
 * keeping when there is no time to type. Every button closes the phone's alert,
 * so the copy is part of Save rather than a button of its own.
 *
 * Mounted only while it is up, inside the drawer, as `RenameAlert` is, and for
 * the same reason it saves what the native field holds (`text.get()`), which
 * can be ahead of React's last change (#123).
 */
export function DebugNoteAlert({ time, onCancel, onSave }: { time: string; onCancel(): void; onSave(comment: string): void }) {
  const scheme = useContext(SchemeContext) ?? undefined;
  const text = useNativeState('');
  return (
    <Host style={styles.host} colorScheme={scheme}>
      <Alert title="Debug Note" isPresented onIsPresentedChange={() => {}}>
        {/* An alert hangs from a view; this one shows nothing. */}
        <Alert.Trigger><Text> </Text></Alert.Trigger>
        <Alert.Actions>
          <TextField text={text} autoFocus placeholder="What went wrong" />
          <Button label="Cancel" role="cancel" onPress={onCancel} />
          <Button label="Save and Copy" onPress={() => onSave(text.get())} />
        </Alert.Actions>
        <Alert.Message><Text>{time}</Text></Alert.Message>
      </Alert>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { height: 1, left: 0, position: 'absolute', top: 0, width: 1 },
});
