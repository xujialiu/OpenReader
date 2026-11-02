import { LogBox } from 'react-native';

/**
 * In development, Reanimated warns once, as it loads, that Reduce Motion is on,
 * and LogBox shows the warning as a toast over the bottom of the Library (#341).
 * The app's only animations, Library Search's field, ignore Reduce Motion on
 * purpose, as the phone's own search field does, so the warning says nothing
 * about them. The silencing is the one Reanimated documents ("Reduced motion
 * setting is enabled on this device", Troubleshooting); it has to come before
 * Reanimated is first loaded, so `index.ts` imports this before the app.
 */
LogBox.ignoreLogs(['[Reanimated] Reduced motion setting is enabled on this device.']);
