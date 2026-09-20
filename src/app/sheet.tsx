import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { INK } from './controls';
import { Icon } from './icon';

/**
 * Only the handle/title owns the drag; lists and steppers retain their gestures.
 *
 * `onBack` turns the header into a page header: a round back button on the left
 * and the title centred over it, the way a drawer that has gone one level deeper
 * reads on iOS. It is a header change and not a second drawer on purpose — a
 * page pushed from the right after a drawer rose from the bottom changes
 * direction halfway through one task.
 */
export function Sheet({ visible, title, onClose, onBack, children, style }: {
  visible: boolean;
  title: string;
  onClose(): void;
  onBack?(): void;
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
      <KeyboardAvoidingView style={styles.behind} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={styles.behind} onPress={onClose} accessibilityRole="button" accessibilityLabel={`Close ${title}`} />
      <Animated.View style={[styles.sheet, style, { transform: [{ translateY: y }] }]} onAccessibilityEscape={onClose}>
        <View {...gesture.panHandlers} style={styles.header} accessibilityLabel={`${title}, drag down to close`}>
          <View style={styles.grip} />
          {onBack ? <View style={styles.headerRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Back from ${title}`} onPress={onBack}
              style={({ pressed }) => [styles.back, pressed && { opacity: 0.5 }]}>
              <Icon name="previous" color={INK.text} size={22} />
            </Pressable>
            <Text style={[styles.title, styles.titleCentred]} numberOfLines={1}>{title}</Text>
          </View> : <Text style={styles.title}>{title}</Text>}
        </View>
        {children}
      </Animated.View>
      </KeyboardAvoidingView>
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
  headerRow: { alignItems: 'center', flexDirection: 'row', paddingHorizontal: 10 },
  // Absolute, so the title is centred on the sheet rather than on what is left
  // of it after the button.
  back: { alignItems: 'center', backgroundColor: INK.line, borderRadius: 17, height: 34, justifyContent: 'center', width: 34, zIndex: 1 },
  titleCentred: { flex: 1, paddingHorizontal: 0, position: 'absolute', left: 0, right: 0, textAlign: 'center' },
});
