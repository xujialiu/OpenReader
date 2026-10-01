import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { OpenReader } from './src/app';
import { SheetProbe } from './src/app/sheet-probe';

/**
 * The reader, which is the whole app (`src/app/`).
 *
 * What was here until now was a screen saying nothing was built yet, so that a
 * launch that worked could be told apart from one that did not — ADR 0018 exists
 * because iOS 27 kills the process before any JavaScript runs and reports it only
 * as a crash log. That screen said it would go when the reader arrived, and the
 * property it was protecting is kept: `src/app/reader-screen.tsx` renders
 * something at every stage, including before a document has been picked.
 *
 * The gesture root is here because a two-finger drag over the download
 * drawer's list selects the chapters under it (#57, ADR 0045), and a gesture
 * detector with no root above it throws.
 */
export default function App() {
  // THROWAWAY PROBE (not for merge): a temporary button that mounts the sheet probe.
  const [probe, setProbe] = useState(false);
  return <GestureHandlerRootView style={{ flex: 1 }}>
    <OpenReader />
    {__DEV__ && !probe && <Pressable accessibilityLabel="SHEET PROBE" onPress={() => setProbe(true)}
      style={{ position: 'absolute', left: 8, top: 430, padding: 10, backgroundColor: '#FF00FF', borderRadius: 6 }}>
      <Text style={{ color: 'white', fontWeight: '700' }}>SHEET PROBE</Text></Pressable>}
    {__DEV__ && probe && <SheetProbe onExit={() => setProbe(false)} />}
  </GestureHandlerRootView>;
}
