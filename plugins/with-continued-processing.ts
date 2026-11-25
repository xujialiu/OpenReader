import { withInfoPlist, type ConfigPlugin } from 'expo/config-plugins';

/**
 * Permit the continued processing task a download away from the screen runs
 * under (ADR 0053, iOS 26 and later).
 *
 * One Info.plist key, `BGTaskSchedulerPermittedIdentifiers`, with one wildcard
 * identifier: the bundle identifier, `.download`, and `.*`. The SDK header of
 * `BGContinuedProcessingTaskRequest` asks for exactly that form — the bundle
 * identifier, optional context, and a final `.*` — and
 * `modules/open-reader-offline/ios/OpenReaderOfflineModule.swift` submits
 * `<bundle>.download.<UUID>`, a fresh suffix each time, because registering one
 * identifier twice kills the app. Without the key, registration returns false
 * and every download falls back to the bounded background time, which no log
 * line but the module's own reports.
 *
 * Nothing is added to `UIBackgroundModes`. Neither the header nor Apple's
 * article on these tasks asks for a mode (the `processing` mode is for
 * `BGProcessingTask`), and the react-native-audio-api plugin owns that key
 * (app.config.ts). A `notPermitted` refusal on the device would say otherwise.
 *
 * A repeated prebuild accepts the same singleton list. Any other list
 * requires an explicit decision about which tasks the app can schedule.
 */
const withContinuedProcessing: ConfigPlugin = (config) =>
  withInfoPlist(config, (infoPlistConfig) => {
    const bundle = infoPlistConfig.ios?.bundleIdentifier;
    if (!bundle) {
      throw new Error(
        '[with-continued-processing] app.config.ts has no ios.bundleIdentifier, and the ' +
          'continued processing task identifier must begin with it (ADR 0053).'
      );
    }

    const plist = infoPlistConfig.modResults;
    const identifier = `${bundle}.download.*`;
    const existing = plist.BGTaskSchedulerPermittedIdentifiers;
    if (existing !== undefined && !(Array.isArray(existing) && existing.length === 1 && existing[0] === identifier)) {
      throw new Error(`[with-continued-processing] Info.plist already contains BGTaskSchedulerPermittedIdentifiers = ${JSON.stringify(existing)}. Expected only ${identifier}.`);
    }
    plist.BGTaskSchedulerPermittedIdentifiers = [identifier];
    return infoPlistConfig;
  });

export default withContinuedProcessing;
