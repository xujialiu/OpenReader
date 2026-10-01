/**
 * The typed surface of the iOS Now Playing module (ADR 0016).
 *
 * Consumed only from [`src/now-playing/`](../../src/now-playing/), which is where
 * the reasoning lives and which is the only file that decides whether this
 * platform has a lock screen at all. Nothing else in the app imports this.
 *
 * `requireNativeModule` and not `requireOptionalNativeModule`, deliberately.
 * Autolinking tolerates an `apple` platform declared with nothing behind it —
 * measured, and written down in this directory's README — so the absence of the
 * Swift is reported by nothing until something asks for the module. That ask is
 * here, and it throws. The optional form would hand back `undefined`, every call
 * would be a no-op, and a lock screen that does nothing looks exactly like one
 * that is merely broken.
 */

import { requireNativeModule } from 'expo';

/** What the lock screen is told, in one call. See `show`. */
export interface NowPlayingReading {
  /** The Document's title. **Never empty** — the native side throws, because a Now Playing item with no title is indistinguishable from a broken one. */
  title: string;
  /**
   * The part of the book being read, or the empty string when nothing can
   * honestly say which.
   *
   * Empty rather than repeating the title: the lock screen draws two lines and
   * two lines saying the same thing is worse than one line and a blank.
   */
  chapter: string;
  /**
   * The Document's Cover as a `file://` URI, or the empty string when it has none.
   *
   * Without one the native side shows the app's icon in its default appearance,
   * and it does the same for a file UIKit cannot decode: a Cover that cannot be
   * read is no Cover (#119).
   */
  cover: string;
  playing: boolean;
  /**
   * The source node's **content position** in seconds (ADR 0012) — the same clock
   * the highlight follows, never a wall clock.
   *
   * iOS interpolates between pushes as `position + rate x elapsed wall clock`,
   * which is exactly how a content position advances, so the lock screen's own
   * arithmetic and the graph's agree rather than drifting apart by the 1.5-3x the
   * app runs at.
   */
  position: number;
  /** The owner's reading speed, and therefore also how fast `position` advances. Must be greater than zero; the native side throws otherwise. */
  rate: number;
}

/** Which button was pressed. Three, because what a reader can be told from a lock screen is play, pause, or toggle. */
export type RemoteCommand = 'play' | 'pause' | 'toggle';

export interface RemoteCommandEvent {
  command: RemoteCommand;
}

/**
 * **This does not extend `NativeModule`, and in SDK 57 it cannot.**
 *
 * Read out of the installed package: `expo-modules-core/src/NativeModule.ts`
 * declares `export type NativeModule<TEventsMap extends EventsMap = …> = typeof
 * ExpoGlobal.NativeModule<EventsMap>`. `typeof` a class is its **constructor**
 * type, so the alias describes the static side and carries none of the instance
 * members — and the events map is discarded on the way, replaced by the
 * unparameterised `EventsMap`. An interface extending it compiles, and then
 * `addListener` "does not exist", several lines from anything that mentions
 * inheritance. So the two calls this app makes are declared here directly.
 *
 * The subscription is typed structurally rather than as `EventSubscription`,
 * which `expo` does not re-export — only `expo-modules-core` does, and that is
 * not a dependency of this app's `package.json`.
 */
interface OpenReaderNowPlayingModule {
  /**
   * Show a reading, and claim the commands.
   *
   * Idempotent and cheap to repeat: it rewrites the whole info dictionary, which
   * is the only way iOS offers, and re-registers the command targets after
   * removing the previous ones — `addTarget:` is additive, so that removal is
   * what keeps one button press from being handled twice.
   */
  show(reading: NowPlayingReading): void;
  /**
   * The elapsed time on its own, for the once-a-second push.
   *
   * Throws unless `show` has been called, because writing an elapsed time into an
   * empty dictionary would put a titleless item on the lock screen.
   */
  setPosition(position: number): void;
  /** Give the lock screen back: the info dictionary is cleared and every command is disabled. */
  hide(): void;
  /** A remote press. One event, declared in the Swift's `Events("remoteCommand")` — without which `sendEvent` is dropped with no warning at all. */
  addListener(event: 'remoteCommand', listener: (event: RemoteCommandEvent) => void): { remove(): void };
}

export default requireNativeModule<OpenReaderNowPlayingModule>('OpenReaderNowPlaying');
