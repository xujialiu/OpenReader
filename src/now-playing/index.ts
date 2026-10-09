/**
 * The lock screen, Control Centre and the headphone remote — the JavaScript side
 * (ADR 0016).
 *
 * On iOS this routes to [our own native module](../../modules/open-reader-now-playing/),
 * which owns `MPRemoteCommandCenter` and `MPNowPlayingInfoCenter`. The playback
 * library's `PlaybackNotificationManager` is **never called on iOS** — not
 * wrapped, not conditionally used, not called — because `addTarget:` is additive
 * and both writers would fight over one info dictionary with the library
 * re-pinning "paused" on every update. The reasoning, and the three defects that
 * made this ours, are in this directory's README.
 *
 * ## One clock, two readers
 *
 * The elapsed time is **pushed**, never derived here: `lockScreenPosition` takes
 * the source node's content position (ADR 0012), the same value the highlight
 * follows, at the once-a-second cadence `POSITION_INTERVAL_MS` already sets for
 * the renderer. A wall clock would be a second, disagreeing answer to "where are
 * we" — the reading advances at 1.4999x against a requested 1.5, and the
 * highlight follows the audio.
 *
 * ## One pause, one path
 *
 * A remote press does not call the engine. It arrives here, is resolved into a
 * play or a pause by `intentOf`, and is handed to the callback the screen gave —
 * which is the same handler the on-screen button calls, collapse behaviour and
 * all. Two paths into the same transport is how the lock screen and the screen
 * start to disagree about what the app is doing.
 *
 * ## Module-level state, on purpose
 *
 * `shown` and `pushed` are module-level because there is exactly one Now Playing
 * info centre in a process. A per-component copy would be a second claim on a
 * singleton, which is the shape of the defect ADR 0016 exists to avoid.
 */

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import type NowPlayingModule from '../../modules/open-reader-now-playing';
import type { NowPlayingReading, RemoteCommandEvent } from '../../modules/open-reader-now-playing';

import { intentOf, type RemoteIntent } from './reading';

export { chapterOf, intentOf, type RemoteIntent } from './reading';

/**
 * Whether anything has been put on the lock screen yet.
 *
 * The native side refuses an elapsed time before a reading has been shown,
 * because writing one into an empty dictionary would put a titleless item on the
 * lock screen. Before that point there is nothing to push to, which is an
 * ordinary state and not a failure — so `lockScreenPosition` returns rather than
 * reports.
 */
let shown = false;

/**
 * The last position pushed, so that a state change can restate it.
 *
 * iOS replaces the whole info dictionary on every write — there is no way to set
 * one key — so a `show` that left the elapsed time out would reset the lock
 * screen's clock to zero every time the owner pressed pause.
 */
let pushed = 0;

/**
 * The last reading shown, without its position, so that a press the app
 * refused can put the lock screen back as it was (#148, `restateNowPlaying`).
 */
let last: Omit<NowPlayingReading, 'position'> | null = null;

/**
 * The native module, required at the moment it is needed rather than at import.
 *
 * A static import would evaluate `requireNativeModule` while the bundle loads,
 * which on a platform that does not have this module is a failure at startup
 * rather than a sentence at the point of use. The type is imported statically —
 * types are erased, so it costs nothing at runtime.
 */
let native: typeof NowPlayingModule | null = null;

function lockScreen(): typeof NowPlayingModule {
  if (native) return native;
  if (Platform.OS !== 'ios') {
    /**
     * Android is deliberately not built, and this throws rather than doing
     * nothing, in the house style of `plugins/with-ui-scene-lifecycle.ts`: the
     * symptom of a silent no-op here is a lock screen with no controls on it,
     * which no log line reports and which looks exactly like a lock screen that
     * is merely broken.
     *
     * ADR 0016 gives Android to `react-native-audio-api`'s `MediaSession`, which
     * is the better-built half and honours playback state correctly. Wiring it up
     * means enabling each control explicitly — its Android default is **none**,
     * the opposite of iOS — and that cannot be verified from this machine, which
     * has no Android device and no emulator. A path that has never run is not a
     * path this project ships.
     */
    throw new Error(
      `OpenReader has no lock-screen controls on ${Platform.OS}. iOS is our own native module (ADR 0016); ` +
        "Android's half is react-native-audio-api's MediaSession, which enables no controls by default and so " +
        'has to turn each one on explicitly from src/now-playing/. It is not written, and it is not stubbed: ' +
        'a call that quietly did nothing would be indistinguishable from a lock screen that is broken. ' +
        'Write it, verify it on a device, and delete this refusal.',
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  native = require('../../modules/open-reader-now-playing').default as typeof NowPlayingModule;
  return native;
}

/**
 * Push the reading's position to the lock screen. About once a second, from the
 * clock and from nowhere else.
 *
 * The value is the source node's **content position** (ADR 0012) — seconds of
 * synthesized audio the queue has consumed — exactly as the node reported it.
 * iOS interpolates between pushes as `position + rate x elapsed wall clock`,
 * which is how a content position advances, so its arithmetic and the graph's
 * agree instead of drifting apart by the 1.5-3x the app runs at.
 */
/**
 * Show the lock screen what was last shown, again (#148).
 *
 * The system turns its centre button to Pause the moment Play is tapped,
 * before the app has answered. When the app then refuses the press, read-aloud
 * being locked, nothing it shows has changed, so nothing would be written, and
 * the button stayed on Pause over a paused app (LockScreenProbe, 85 s later,
 * on 1.0.0 (7)-beta11). Writing the same paused state again puts it back.
 * Nothing happens before a reading has been shown.
 */
export function restateNowPlaying(): void {
  if (!shown || !last) return;
  lockScreen().show({ ...last, position: pushed });
}

export function lockScreenPosition(position: number): void {
  pushed = position;
  if (!shown) return;
  lockScreen().setPosition(position);
}

export interface NowPlaying {
  /** The Document's title. Never empty: the native side refuses one, because a Now Playing item with no title looks exactly like a broken one. */
  title: string;
  /** The part of the book being read, from `chapterOf`, or the empty string when nothing can honestly name it. */
  chapter: string;
  /**
   * The Document's Cover as a file URI, `null` when it has none, and `undefined`
   * while that is still being found out.
   *
   * Nothing is shown while it is `undefined`: Now Playing shows the app's icon
   * for a Document without a Cover, so showing before the answer would flash the
   * icon in front of a Cover (#119).
   */
  cover: string | null | undefined;
  playing: boolean;
  /** The owner's reading speed, which is also the rate iOS extrapolates the elapsed time at. */
  rate: number;
  /**
   * Whether there is a reading for a lock screen to control.
   *
   * False until the first Clip has played, and for a reason rather than out of
   * caution: an app only becomes the system's now-playing app once it holds an
   * active audio session, so before the first Clip a lock screen showing this
   * book would carry buttons whose presses could not reach it. It stays true
   * through a pause, which is the whole point — the session is still active, so
   * play from the lock screen works.
   */
  live: boolean;
  /**
   * What a remote press does. **The same handler the on-screen button calls**,
   * collapse behaviour and all: two paths into one transport is how the lock
   * screen and the screen start to disagree.
   */
  onIntent(intent: RemoteIntent): void;
}

/**
 * Keep the lock screen showing this reading, and route its buttons back.
 *
 * Two effects, and the split is deliberate. The metadata effect runs whenever
 * anything shown changes, which is a few times a minute at most — a chapter
 * boundary, a pause, a nudge of the speed. The subscription effect runs once for
 * the life of the screen, because a listener torn down and rebuilt on every state
 * change is a window in which a press is dropped.
 */
export function useNowPlaying({ title, chapter, cover, playing, rate, live, onIntent }: NowPlaying): void {
  /**
   * The current state, for the subscription that was registered once. A handler
   * that closed over `playing` would resolve a toggle against whatever was true
   * when the screen mounted, which for a toggle is the whole of the answer.
   */
  const now = useRef({ playing, onIntent });
  // In an effect and not in the render body, because `react-hooks/refs` refuses the
  // latter — and rightly: this runs after every render, and a remote press cannot
  // arrive between a render and its effects.
  useEffect(() => {
    now.current = { playing, onIntent };
  });

  useEffect(() => {
    const subscription = lockScreen().addListener('remoteCommand', ({ command }: RemoteCommandEvent) => {
      const { playing: running, onIntent: act } = now.current;
      act(intentOf(command, running));
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!live || cover === undefined) return;
    last = { title, chapter, cover: cover ?? '', playing, rate };
    lockScreen().show({ ...last, position: pushed });
    shown = true;
  }, [title, chapter, cover, playing, rate, live]);

  /**
   * The Reading ending gives the lock screen back (#68: going back to the
   * Library while it plays keeps it, and keeps this item). Separate from the effect above
   * so that a chapter change does not tear the item down and build it again,
   * which on a lock screen is a visible flicker.
   */
  useEffect(
    () => () => {
      shown = false;
      pushed = 0;
      last = null;
      lockScreen().hide();
    },
    [],
  );
}
