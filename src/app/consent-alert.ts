import { Alert } from 'react-native';

import { consentQuestion, type Recipient } from './consent';

/**
 * The question as the phone puts it (#109, design 0064): the system's own
 * alert, as design 0042 asks wherever the phone can draw the thing itself.
 * It is laid out like the phone's permission prompts: "Don't Allow" on the
 * left, and "Allow" on the right as the preferred action.
 *
 * Resolves true for Allow. An alert iOS cannot dismiss any other way is a no if
 * it ever is dismissed (`onDismiss` exists only on Android). So the app's only
 * answers are the two buttons.
 */
export function askWithAlert(recipient: Recipient): Promise<boolean> {
  const { title, message } = consentQuestion(recipient);
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Don't Allow", style: 'cancel', onPress: () => resolve(false) },
      { text: 'Allow', isPreferred: true, onPress: () => resolve(true) },
    ], { cancelable: false, onDismiss: () => resolve(false) });
  });
}
