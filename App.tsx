import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

/**
 * There is no reader yet.
 *
 * This screen replaces the day-one engine spike, which answered notes/NOTES.md
 * items 1 and 2 and was deleted along with them — its results are in
 * notes/NOTES_2026-09-19.md, which is the record (ADR 0015).
 *
 * It says so out loud rather than rendering nothing. A blank screen and an app
 * that failed to launch look identical, and this app is about to be launched
 * repeatedly to check native changes that fail exactly that way: ADR 0018
 * exists because iOS 27 kills the process before any of this runs, reporting it
 * only as a crash log. For as long as that is the shape of the risk, a first
 * screen that distinguishes "not built yet" from "broken" is worth its fifteen
 * lines. It goes when the reader arrives.
 */
export default function App() {
  return (
    <View style={styles.screen}>
      <StatusBar style="auto" />
      <Text style={styles.title}>OwnReader</Text>
      <Text style={styles.body}>
        Nothing is built yet. This screen exists so that a launch that works is distinguishable from one that does not.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', backgroundColor: '#fff', gap: 12, justifyContent: 'center', padding: 32 },
  title: { fontSize: 22, fontWeight: '600' },
  body: { color: '#555', fontSize: 14, lineHeight: 21, textAlign: 'center' },
});
