import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { OpenReader } from './shell';

/** The download drawer's two-finger selection needs a gesture root above the navigator (ADR 0045). */
export function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <OpenReader />
    </GestureHandlerRootView>
  );
}
