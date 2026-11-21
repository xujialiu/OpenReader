import { Pressable, StyleSheet, Text } from 'react-native';
import { INK } from './controls';
import { DRAWER_LIST } from './drawer-list';
import { TEXT } from './text-styles';

export function SelectionButton({ action, count, disabled, onPress }: {
  action: 'Delete' | 'Download'; count: number; disabled?: boolean; onPress(): void;
}) {
  const inactive = !!disabled || count === 0;
  const label = `${action} selected (${count})`;
  const deleting = action === 'Delete';
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: inactive }}
    disabled={inactive} onPress={onPress} style={({ pressed }) => [
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
