import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { engineReport } from './src/spike/hermes-support';

/**
 * There is no reader yet. The first screen is the day-one spike from
 * notes/NOTES.md items 1 and 2 (see src/spike/hermes-support.ts): the two
 * questions about the Hermes bundled in React Native 0.86 that cannot be
 * answered without running on it.
 *
 * Read the answer off this screen on a real build, then write it into a dated
 * file in notes/ and strike the items — that, not this screen, is where the
 * answer lives. The screen goes away with the items.
 */
export default function App() {
  const report = engineReport();

  // Also logged, so the answer can be copied out of the device log into a
  // dated notes/ file rather than transcribed off a screenshot.
  useEffect(() => {
    console.log(`ENGINE-SPIKE ${JSON.stringify(report)}`);
  }, [report]);

  return (
    <View style={styles.screen}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Engine spike</Text>
        <Text style={styles.engine}>{report.engine}</Text>

        {report.isHermes ? null : (
          <Text style={styles.warning}>
            Not Hermes. These results answer nothing about the engine the app ships on — notes/NOTES.md items 1 and 2
            stay open until this says Hermes.
          </Text>
        )}

        {report.probes.map((item) => (
          <View key={item.id} style={styles.probe}>
            <Text style={styles.question}>
              {item.ok ? '✓' : '✗'} {item.question}
            </Text>
            <Text style={item.ok ? styles.detail : styles.failure}>{item.detail}</Text>
            <Text style={styles.source}>{item.source}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24, paddingTop: 72, gap: 16 },
  title: { fontSize: 22, fontWeight: '600' },
  engine: { fontSize: 15, fontVariant: ['tabular-nums'] },
  warning: { fontSize: 13, lineHeight: 19, color: '#8a4b00', backgroundColor: '#fff4e5', padding: 12, borderRadius: 8 },
  probe: { gap: 3 },
  question: { fontSize: 15, fontWeight: '500' },
  detail: { fontSize: 13, color: '#1f7a1f' },
  failure: { fontSize: 13, color: '#b00020' },
  source: { fontSize: 11, color: '#777' },
});
