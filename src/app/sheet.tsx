import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { INK, Note, useBorders } from './controls';
import { Icon, type IconName } from './icon';
import { TEXT } from './text-styles';

/** A button at the right end of a drawer's title row. */
export interface SheetAction {
  icon: IconName;
  /** What VoiceOver says. The button shows no words. */
  label: string;
  onPress(): void;
  disabled?: boolean;
}

/**
 * Only the handle/title owns the drag; lists and steppers retain their gestures.
 *
 * `onBack` turns the header into a page header: a round back button on the left
 * and the title centred over it, the way a drawer that has gone one level deeper
 * reads on iOS. It is a header change and not a second drawer on purpose — a
 * page pushed from the right after a drawer rose from the bottom changes
 * direction halfway through one task.
 *
 * `action` puts one button at the right end of the title row (#95): its icon
 * alone, with no circle, at the size of the drawer's row icons (#97). A title
 * that does not fit wraps before it, and the button stays at the middle of the
 * title however many lines it takes.
 */
export function Sheet({ visible, title, onClose, onBack, action, children, style }: {
  visible: boolean;
  title: string;
  onClose(): void;
  onBack?(): void;
  action?: SheetAction;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const borders = useBorders();
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
      <Animated.View style={[styles.sheet, { borderTopColor: borders.line }, style, { transform: [{ translateY: y }] }]} onAccessibilityEscape={onClose}>
        <View {...gesture.panHandlers} style={styles.header} accessibilityLabel={`${title}, drag down to close`}>
          <View style={styles.grip} />
          {onBack ? <View style={styles.headerRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Back from ${title}`} onPress={onBack}
              style={({ pressed }) => [styles.back, pressed && { opacity: 0.5 }]}>
              <Icon name="previous" color={INK.text} size={22} />
            </Pressable>
            <Text style={[styles.title, styles.titleCentred]} numberOfLines={1}>{title}</Text>
            {action ? <SheetActionButton action={action} /> : null}
          </View> : action ? <View style={styles.titleRow}>
            <Text style={[styles.title, styles.titleBeside]}>{title}</Text>
            <SheetActionButton action={action} />
          </View> : <Text style={styles.title}>{title}</Text>}
        </View>
        {children}
      </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SheetActionButton({ action }: { action: SheetAction }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={action.label} accessibilityState={{ disabled: !!action.disabled }}
    disabled={action.disabled} onPress={action.onPress}
    style={({ pressed }) => [styles.action, styles.trailing, (pressed || action.disabled) && { opacity: 0.5 }]}>
    <Icon name={action.icon} color={INK.text} size={ACTION_ICON} />
  </Pressable>;
}

/**
 * A `Note` set in from the sheet's edge like everything else in it (#28).
 *
 * The sheet's body has no horizontal padding of its own: every row sets itself
 * in by 16 — the title above, a sheet's chips and rows — so a `Note` placed
 * straight in the body started at the screen's edge and lost half its first
 * letter. `Note` stays unpadded, because on the settings screens it already
 * sits in a padded container.
 */
export function SheetNote({ children, attention }: { children: ReactNode; attention?: boolean }) {
  return <View style={styles.inset}><Note attention={attention}>{children}</Note></View>;
}

/** The action's icon: the size `ReaderActions` draws Rename and Download at. */
const ACTION_ICON = 26;

const styles = StyleSheet.create({
  behind: { flex: 1 },
  sheet: { backgroundColor: INK.panel, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 32, gap: 10, maxHeight: '90%' },
  header: { paddingTop: 10, paddingBottom: 4, gap: 16, minHeight: 62 },
  grip: { alignSelf: 'center', backgroundColor: INK.line, borderRadius: 3, height: 5, width: 40 },
  title: { ...TEXT.headline, color: INK.text, paddingHorizontal: 16 },
  inset: { paddingHorizontal: 16 },
  headerRow: { alignItems: 'center', flexDirection: 'row', paddingHorizontal: 10 },
  // Absolute, so the title is centred on the sheet rather than on what is left
  // of it after the button.
  back: { alignItems: 'center', backgroundColor: INK.line, borderRadius: 17, height: 34, justifyContent: 'center', width: 34, zIndex: 1 },
  titleCentred: { flex: 1, paddingHorizontal: 0, position: 'absolute', left: 0, right: 0, textAlign: 'center' },
  trailing: { marginLeft: 'auto' },
  // The action's touch area is 44 square around its 26 of icon. The negative
  // margins keep the row only as tall as the icon, so a one-line title's header
  // does not grow; `hitSlop` would not do, because a touch outside the row's
  // own bounds never reaches the button. 15 of padding puts the icon's right
  // edge 24 from the drawer's, where the rows' icons are from its left.
  action: { alignItems: 'center', height: 44, justifyContent: 'center', marginVertical: -(44 - ACTION_ICON) / 2, width: 44 },
  titleRow: { alignItems: 'center', flexDirection: 'row', paddingRight: 15 },
  titleBeside: { flex: 1, paddingRight: 0 },
});
