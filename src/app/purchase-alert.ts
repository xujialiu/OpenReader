import { Alert, AppState } from 'react-native';

import type { PurchaseAsker } from '../purchase/purchases';
import { endedQuestion, trialQuestion, UNAVAILABLE } from './purchase';

/**
 * The questions as the phone puts them (#148, ADR 0075): the system's own
 * alert, as the Consent question is (`consent-alert.ts`, design 0042).
 *
 * Laid out as iOS lays out its own: two buttons side by side with Not Now, the
 * cancel action, on the left; three stacked with Not Now at the foot. The
 * purchase is the preferred action. An alert iOS cannot dismiss any other way
 * is a Not Now if it ever is dismissed (`onDismiss` exists only on Android).
 *
 * Nothing is asked with the app away from the screen: a Play from the Lock
 * Screen or the headphones while locked plays nothing, and leaves no alert
 * waiting for the person's return.
 */
export const alertAsker: PurchaseAsker = {
  canAsk: () => AppState.currentState === 'active',
  trial: (price) => new Promise((resolve) => {
    const words = trialQuestion(price);
    Alert.alert(words.title, words.message, [
      { text: words.notNow, style: 'cancel', onPress: () => resolve('not-now') },
      { text: words.start, isPreferred: true, onPress: () => resolve('start') },
    ], { cancelable: false, onDismiss: () => resolve('not-now') });
  }),
  ended: (price) => new Promise((resolve) => {
    const words = endedQuestion(price);
    Alert.alert(words.title, words.message, [
      { text: words.unlock, isPreferred: true, onPress: () => resolve('unlock') },
      { text: words.restore, onPress: () => resolve('restore') },
      { text: words.notNow, style: 'cancel', onPress: () => resolve('not-now') },
    ], { cancelable: false, onDismiss: () => resolve('not-now') });
  }),
  unavailable: () => new Promise((resolve) => {
    Alert.alert(UNAVAILABLE.title, UNAVAILABLE.message, [
      { text: UNAVAILABLE.ok, onPress: () => resolve() },
    ], { cancelable: false, onDismiss: () => resolve() });
  }),
};
