import { Pressable, StyleSheet, Text } from 'react-native';
import { INK } from './controls';
import { DRAWER_LIST } from './drawer-list';
import { TEXT } from './text-styles';

type SelectionAction = { action: 'Copy'; copied: boolean } | { action: 'Delete' | 'Download'; count: number };

export function SelectionButton(props: SelectionAction & { disabled?: boolean; onPress(): void }) {
  const inactive = !!props.disabled || (props.action !== 'Copy' && props.count === 0);
  const label = props.action === 'Copy' ? (props.copied ? 'Copied' : 'Copy selected') : `${props.action} selected (${props.count})`;
  const deleting = props.action === 'Delete';
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: inactive }}
    disabled={inactive} onPress={props.onPress} style={({ pressed }) => [
      styles.button, deleting && styles.deleteButton, inactive && styles.disabled, pressed && styles.pressed,
    ]}>
    <Text style={[styles.label, deleting && styles.deleteLabel]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center', backgroundColor: INK.text, borderRadius: 24, marginHorizontal: DRAWER_LIST.inset,
    marginTop: 12, paddingVertical: 15,
  },
  label: { ...TEXT.headline, color: INK.page, textAlign: 'center' },
  deleteButton: { backgroundColor: INK.page },
  deleteLabel: { color: INK.attention },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.65 },
});
