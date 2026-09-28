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
 * The house style of `plugins/with-epub-document-types.ts`: if something else
 * has written the key, the prebuild stops and says so, rather than merging two
 * lists nobody reasoned about together.
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
    if (plist.BGTaskSchedulerPermittedIdentifiers !== undefined) {
      throw new Error(
        '[with-continued-processing] The generated Info.plist already contains ' +
          'BGTaskSchedulerPermittedIdentifiers, so something else is writing it now.\n\n' +
          'Two writers of one Info.plist key is the failure app.config.ts already warns about ' +
          'for UIBackgroundModes. This key decides whether a download goes on away from the ' +
          'screen, and getting it wrong shows only as a download that stops within a minute. ' +
          'Find the other writer and put both identifiers in one place. Nothing is merged here ' +
          'on purpose.'
      );
    }

    plist.BGTaskSchedulerPermittedIdentifiers = [`${bundle}.download.*`];
    return infoPlistConfig;
  });

export default withContinuedProcessing;
