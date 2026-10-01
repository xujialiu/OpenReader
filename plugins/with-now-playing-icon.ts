import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { withDangerousMod, type ConfigPlugin } from 'expo/config-plugins';

/**
 * Put the app's icon in the asset catalog as a plain picture, for Now Playing to
 * show when a Document has no Cover (#119).
 *
 * The icon iOS shows on the Home Screen cannot be loaded as a picture.
 * `ios.icon` is an Icon Composer document, compiled into `Assets.car` as `Icon
 * Image` renditions under the name `OpenReader`, and `UIImage(named:
 * "OpenReader", in: .main, compatibleWith:)` does not return nil for it: it
 * **raises** `NSInternalInconsistencyException` from `-[_UIImageCGImageContent
 * initWithCGImageSource:CGImage:scale:]` (`_UIImageContent.m:742`). Measured on
 * the simulator, iOS 27.0, 2026-10-01, with the light trait collection and in
 * dark mode alike. Swift cannot catch an Objective-C exception, so the reader's
 * first `show` for a Document without a Cover failed in JavaScript and took the
 * whole screen down with it.
 *
 * So the picture is `assets/icon/icon.png` — the default appearance's white
 * fill under the icon's two layers, written from `OpenReader.icon` by
 * `assets/icon/export-android.sh` — copied into an ordinary image set named
 * `NowPlayingIcon`, which `UIImage(named:)` loads like any other. One source
 * still: the PNG is copied at every prebuild and never committed under `ios/`.
 *
 * The house style of `plugins/with-epub-document-types.ts`: a catalog or a
 * source that is not where it should be stops the prebuild and says so, because
 * the way this fails otherwise is Now Playing's empty grey square, which no log
 * line reports.
 */

/** The image set's name. `NowPlayingPicture.iconName` in the Swift is the same string. */
export const NOW_PLAYING_ICON = 'NowPlayingIcon';

/** Relative to the project root. */
export const NOW_PLAYING_ICON_SOURCE = 'assets/icon/icon.png';

const withNowPlayingIcon: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    'ios',
    (modConfig) => {
      const { projectRoot, platformProjectRoot, projectName } = modConfig.modRequest;
      const catalog = join(platformProjectRoot, projectName ?? '', 'Images.xcassets');
      if (!projectName || !existsSync(catalog)) {
        throw new Error(
          `[with-now-playing-icon] There is no asset catalog at ${catalog}, so the app's icon ` +
            'has nowhere to go for Now Playing (#119). Expo’s template has always generated ' +
            'Images.xcassets beside the app delegate; find where it went and point this plugin there.'
        );
      }
      const source = join(projectRoot, NOW_PLAYING_ICON_SOURCE);
      if (!existsSync(source)) {
        throw new Error(
          `[with-now-playing-icon] ${NOW_PLAYING_ICON_SOURCE} does not exist. It is written from ` +
            'assets/icon/OpenReader.icon by assets/icon/export-android.sh; run that, then prebuild again.'
        );
      }
      const set = join(catalog, `${NOW_PLAYING_ICON}.imageset`);
      mkdirSync(set, { recursive: true });
      copyFileSync(source, join(set, `${NOW_PLAYING_ICON}.png`));
      writeFileSync(
        join(set, 'Contents.json'),
        `${JSON.stringify(
          { images: [{ filename: `${NOW_PLAYING_ICON}.png`, idiom: 'universal' }], info: { author: 'xcode', version: 1 } },
          null,
          2
        )}\n`
      );
      return modConfig;
    },
  ]);

export default withNowPlayingIcon;
