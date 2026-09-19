import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * ADR 0016's rules, checked against the source text.
 *
 * The module itself is Swift and cannot run here — `test/README.md` is explicit
 * that native modules are not tested in this suite by design, and a fake
 * `MPNowPlayingInfoCenter` would prove the fake was called. What a suite that
 * cannot load `MediaPlayer` can still do is the same thing
 * `test/playback/footguns.test.ts` does for the playback library: read the lines
 * that obey each rule, and fail when one of them goes.
 *
 * Every rule below is one the library got wrong, and **every one of them fails as
 * nothing at all**: a lock screen that says "paused" while the book reads, a
 * headphone tap that does nothing, a rate rendered as 1x, four dead buttons, a
 * command handled twice. None of them throws and none appears in a log.
 *
 * What this cannot do is prove the lock screen works. That rests on the device
 * session in `notes/NOTES_2026-09-20.md`.
 */

const root = new URL('../../', import.meta.url).pathname;
const read = (path: string): string => readFileSync(root + path, 'utf8');

/**
 * The code, without the comments.
 *
 * Needed because both halves of this feature explain each defect where they avoid
 * it, so `playbackState` and `PlaybackNotificationManager` appear in prose beside
 * the lines that get them right. A naive search would find the explanation and
 * call it the offence.
 */
const code = (path: string): string =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const swift = code('modules/open-reader-now-playing/ios/OpenReaderNowPlayingModule.swift');

/**
 * One `private func`'s body, by name.
 *
 * Needed rather than searching the whole file, and the mutation sweep is why: the
 * same two lines appear in more than one place — `removeTarget` both claims a
 * command and gives it back, and `isEnabled = false` is written both by the
 * loop that disables the dead buttons and by `teardown`. A search of the file
 * therefore passes when either copy survives, which is a test that cannot fail.
 */
function body(name: string): string {
  const at = swift.indexOf(`private func ${name}`);
  if (at < 0) throw new Error(`OpenReaderNowPlayingModule.swift has no private func ${name}`);
  const next = swift.indexOf('private func ', at + 1);
  return swift.slice(at, next < 0 ? undefined : next);
}

describe('the three defects ADR 0016 exists for', () => {
  it('registers togglePlayPause, which is what AirPods single-tap and most car head units send', () => {
    // The library never registers it: `togglePlayPauseCommand` appears nowhere in
    // `ios/audioapi/ios/system/notification/PlaybackNotification.mm`, and its
    // `enableRemoteCommand:` has no branch for it. It was named "important on ios"
    // in the epic that introduced the feature and left unchecked when it closed.
    expect(swift).toContain('center.togglePlayPauseCommand');
    expect(swift).toContain('center.playCommand');
    expect(swift).toContain('center.pauseCommand');
  });

  it('writes DefaultPlaybackRate, which is the key a reader at 1.5–3x needs', () => {
    // The library's `NOW_PLAYING_INFO_KEYS` maps `speed` to
    // `MPNowPlayingInfoPropertyPlaybackRate` and nothing to the default one, so
    // iOS renders the rate as 1x however fast the book is actually being read.
    expect(swift).toContain('MPNowPlayingInfoPropertyDefaultPlaybackRate');
    expect(swift).toContain('MPNowPlayingInfoPropertyPlaybackRate');
  });

  it('sets the playback state honestly, which is the one the library pins to .paused', () => {
    // `PlaybackNotification.mm` reads its state from `_currentInfo[@"state"]`, a
    // key its own key map never writes, so it sends `.paused` unconditionally
    // beside every metadata update and cannot be told otherwise from JavaScript.
    expect(swift).toContain('center.playbackState = reading.playing ? .playing : .paused');
  });
});

describe('one owner of the command centre, and it is ours', () => {
  it('never names the library’s notification manager anywhere in the app', () => {
    // `addTarget:` is additive, so every button press would be handled twice, and
    // both writers would fight over the info dictionary with the library
    // re-pinning "paused" each time. The library touches `MediaPlayer` from
    // exactly one file, instantiated lazily on the first `show()` — so as long as
    // that call never happens there is no contest over either singleton.
    for (const path of [
      'src/playback/audio-graph.ts',
      'src/playback/engine.ts',
      'src/now-playing/index.ts',
      'src/app/use-reading.ts',
      'src/app/reading-view.tsx',
    ]) {
      expect(code(path), path).not.toContain('PlaybackNotificationManager');
      expect(code(path), path).not.toContain('setLockScreenInfo');
    }
  });

  it('removes a command’s previous target before adding one, so a reload is not two handlers', () => {
    // A JavaScript reload rebuilds the module while the command centre is a
    // process-wide singleton that is not rebuilt, so without this every press
    // would be handled twice after the first reload — which on a toggle is a
    // pause followed by a play.
    const handle = body('handle');
    expect(handle).toContain('command.removeTarget(targets.removeValue(forKey: command))');
    expect(handle).toContain('targets[command] = command.addTarget');
    // And the removal comes first, which is the whole of it.
    expect(handle.indexOf('removeTarget')).toBeLessThan(handle.indexOf('addTarget'));
  });

  it('turns off every control this app cannot answer', () => {
    // iOS enables these by default and the library enables four of them
    // explicitly — next, previous, a 15-second skip each way and a scrubber. On a
    // book reader every one is a button that does nothing: this app's four skip
    // targets are sentences and paragraphs (ADR 0020), not tracks, and it
    // publishes no duration to scrub along.
    const register = body('register');
    for (const command of [
      'nextTrackCommand',
      'previousTrackCommand',
      'skipForwardCommand',
      'skipBackwardCommand',
      'seekForwardCommand',
      'seekBackwardCommand',
      'changePlaybackPositionCommand',
    ]) {
      expect(register, command).toContain(`center.${command},`);
    }
    expect(register).toContain('command.isEnabled = false');
    expect(register).not.toContain('command.isEnabled = true');
  });
});

describe('one clock, two readers (ADR 0012)', () => {
  it('pushes the source node’s content position and never a wall clock', () => {
    // A lock screen showing a wall-clock position would be a second, disagreeing
    // answer to "where are we": the reading advances at 1.4999x against a
    // requested 1.5, and the highlight follows the audio.
    const clock = code('src/app/use-reading.ts');
    expect(clock).toContain('lockScreenPosition(correction.contentPosition)');
    expect(code('src/now-playing/index.ts')).not.toContain('Date.now()');
    expect(code('src/now-playing/index.ts')).not.toContain('currentTime');
  });

  it('refuses an elapsed time before anything has been shown', () => {
    // Writing one into an empty dictionary puts a titleless item on the lock
    // screen, which looks exactly like a broken one.
    expect(swift).toContain('guard self.shown else {');
    expect(swift).toContain('throw NotShownException()');
  });

  it('refuses an empty title and a rate that would freeze or reverse the clock', () => {
    expect(swift).toContain('guard !reading.title.isEmpty else {');
    expect(swift).toContain('guard reading.rate > 0 else {');
  });
});

describe('one pause, one path', () => {
  it('gives the lock screen the same pause the on-screen button gets', () => {
    // The player's pause re-opens the player. A remote pause that did not would
    // leave the app in a state the screen disagrees with, and the two would drift
    // apart in behaviour from there.
    const screen = code('src/app/reading-view.tsx');
    expect(screen).toContain('onIntent: (intent) => (intent === \'play\' ? reading.play() : pause())');
    expect(screen).toContain('onPause={pause}');
    // And the coupling itself is in that one handler rather than in the button.
    expect(screen).toMatch(/const pause = useCallback\(\(\) => \{\s*reading\.pause\(\);\s*setCollapsed\(false\);/);
    expect(code('src/app/player.tsx')).not.toContain('onCollapsed(false)');
  });
});

describe('the podspec, whose failure is a warning in a prebuild', () => {
  it('never claims a minimum above the app’s deployment target', () => {
    // Expo's autolinking skips a pod whose own minimum exceeds the app's
    // deployment target, and it skips it with `UI.warn "[Expo] … was not linked"`
    // — after which the app builds and runs with no lock screen and nothing
    // anywhere saying why (expo-modules-autolinking/scripts/ios/autolinking_manager.rb,
    // `supports_platform?`). Stating ADR 0001's 17.2 here would sit exactly on
    // that boundary.
    const podspec = read('modules/open-reader-now-playing/ios/OpenReaderNowPlaying.podspec');
    const floor = /:ios => '([\d.]+)'/.exec(podspec)?.[1];
    const target = /IOS_DEPLOYMENT_TARGET = '([\d.]+)'/.exec(read('app.config.ts'))?.[1];
    expect({ floor, target }).toEqual({ floor: '16.4', target: '17.2' });
    expect(Number(floor)).toBeLessThan(Number(target));
  });

  it('is named for the pod it declares, which is what autolinking looks for', () => {
    // `expo-modules-autolinking` re-derives the path as
    // `File.join(pod.podspec_dir, pod.pod_name + ".podspec")`, and it searches
    // only the module's first-level directories — a podspec at the module root is
    // invisible to Expo while the React Native CLI still finds it, so `pod install`
    // succeeds, the Swift compiles, and the class is never registered.
    const podspec = read('modules/open-reader-now-playing/ios/OpenReaderNowPlaying.podspec');
    expect(podspec).toContain("s.name           = 'OpenReaderNowPlaying'");
    expect(podspec).toContain("s.dependency 'ExpoModulesCore'");
  });

  it('declares the event the Swift sends, without which sendEvent is dropped in silence', () => {
    // `LegacyEventEmitterCompat` only delivers to holders whose definition lists
    // the name, so an undeclared event is discarded with no warning at all.
    expect(swift).toContain('Events("remoteCommand")');
    expect(swift).toContain('sendEvent("remoteCommand"');
    expect(code('modules/open-reader-now-playing/index.ts')).toContain("addListener(event: 'remoteCommand'");
  });
});
