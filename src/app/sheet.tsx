import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Modal, PanResponder, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { INK } from './controls';

/** Only the handle/title owns the drag; lists and steppers retain their gestures. */
export function Sheet({ visible, title, onClose, children, style }: {
  visible: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const [y] = useState(() => new Animated.Value(0));
  useEffect(() => { if (visible) y.setValue(0); }, [visible, y]);
  const gesture = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 3 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => y.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_, g) => {
      if (g.dy > 60 || (g.dy > 12 && g.vy > 0.6)) onClose();
      else Animated.spring(y, { toValue: 0, useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => Animated.spring(y, { toValue: 0, useNativeDriver: true }).start(),
  }), [y, onClose]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.behind} onPress={onClose} accessibilityRole="button" accessibilityLabel={`Close ${title}`} />
      <Animated.View style={[styles.sheet, style, { transform: [{ translateY: y }] }]} onAccessibilityEscape={onClose}>
        <View {...gesture.panHandlers} style={styles.header} accessibilityLabel={`${title}, drag down to close`}>
          <View style={styles.grip} />
          <Text style={styles.title}>{title}</Text>
        </View>
        {children}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  behind: { flex: 1 },
  sheet: { backgroundColor: INK.panel, borderTopColor: INK.line, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 32, gap: 10, maxHeight: '90%' },
  header: { paddingTop: 10, paddingBottom: 4, gap: 16, minHeight: 62 },
  grip: { alignSelf: 'center', backgroundColor: INK.line, borderRadius: 3, height: 5, width: 40 },
  title: { color: INK.text, fontSize: 18, fontWeight: '700', paddingHorizontal: 16 },
});
