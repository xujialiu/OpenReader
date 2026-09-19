// The lock screen, Control Centre and the headphone remote (ADR 0016).
//
// This module owns `MPRemoteCommandCenter` and `MPNowPlayingInfoCenter` for the
// whole app. `react-native-audio-api`'s `PlaybackNotificationManager` is **never
// called on iOS** — not wrapped, not conditionally used, not called — because
// `addTarget:` is additive and both writers would fight over one info
// dictionary, with the library re-pinning "paused" on every update. The library
// touches `MediaPlayer` from exactly one file, instantiated lazily on the first
// `show()`, so as long as that call never happens there is no contest over
// either singleton. One owner, and it is this file.
//
// The three defects that made this ours rather than the library's were re-read
// out of the installed 0.13.5 before this was written, and all three still hold.
// `PlaybackNotification.mm` reads its playback state from `_currentInfo[@"state"]`,
// a key its own `NOW_PLAYING_INFO_KEYS` map never writes, so it sends
// `MPNowPlayingPlaybackStatePaused` unconditionally; `togglePlayPauseCommand`
// appears nowhere in the file; and `MPNowPlayingInfoPropertyDefaultPlaybackRate`
// is in neither its key map nor its source. See ADR 0016.
//
// ## The elapsed time is pushed, and it is the audio graph's clock
//
// Nothing here derives a position. The caller pushes the source node's **content
// position** (ADR 0012) — the same value the highlight follows — about once a
// second, which is the cadence `POSITION_INTERVAL_MS` already sets for the
// renderer. A wall clock here would be a second, disagreeing answer to "where
// are we", and the reading advances at 1.4999x against a requested 1.5.
//
// Between two pushes iOS interpolates for itself, as `elapsed + rate * dt`. That
// is why `MPNowPlayingInfoPropertyPlaybackRate` carries the owner's reading speed
// rather than 1: a content position advances at `rate` content-seconds per second
// of wall clock, so iOS's own arithmetic and the graph's agree instead of drifting
// apart by the 1.5-3x the app runs at.
//
// ## Everything MediaPlayer is touched on the main thread
//
// `MPRemoteCommandCenter` is a UIKit-adjacent singleton and `MPNowPlayingInfoCenter`
// is documented for neither thread, so every call into either is dispatched to the
// main queue from one place. The validation that can fail happens first, on the
// calling thread, so a refusal is still a thrown error the caller sees rather than
// something logged from a queue nobody is reading.

import ExpoModulesCore
import MediaPlayer

/// What the lock screen shows and what state it is in. One record, because these
/// are written together: a state change with a stale position is a lock screen
/// whose clock jumps when it is next touched.
struct NowPlayingReading: Record {
  /// The Document's title. Never empty — see the guard in `show`.
  @Field var title: String = ""

  /// The part of the book being read, or empty when nothing can honestly say.
  ///
  /// Empty rather than a fallback to the title: two lines saying the same thing
  /// is worse than one line and a blank.
  @Field var chapter: String = ""

  @Field var playing: Bool = false

  /// The source node's content position in seconds (ADR 0012). Never a wall clock.
  @Field var position: Double = 0

  /// The owner's reading speed, which is also how fast `position` advances.
  @Field var rate: Double = 1
}

public final class OpenReaderNowPlayingModule: Module {
  /// The `addTarget` tokens, so that a re-registration removes what it replaces.
  ///
  /// `addTarget:` is additive: registering twice — which a JavaScript reload does,
  /// because the module is rebuilt while the command centre is a process-wide
  /// singleton that is not — would handle every button press twice. Holding the
  /// tokens is what makes `register` idempotent.
  private var targets: [MPRemoteCommand: Any] = [:]

  /// The last state pushed, so that a position-only push can restate the rate
  /// iOS extrapolates with. Writing `nowPlayingInfo` replaces the dictionary
  /// wholesale, so there is nothing to read back and merge.
  private var reading = NowPlayingReading()
  private var shown = false

  public func definition() -> ModuleDefinition {
    Name("OpenReaderNowPlaying")

    /// One event, carrying which button was pressed. Three commands, and
    /// deliberately not a general "remote event" channel: what a reader can be
    /// told to do from a lock screen is play, pause, or toggle.
    Events("remoteCommand")

    OnDestroy {
      // A JavaScript reload deallocates the module and leaves the command centre
      // and the info centre exactly as they were, so without this the next load
      // adds a second target to every command and the lock screen keeps showing a
      // reading that no longer exists.
      self.teardown()
    }

    Function("show") { (reading: NowPlayingReading) in
      guard !reading.title.isEmpty else {
        // A lock screen with a blank title is indistinguishable from one that is
        // merely broken, and there is nothing further along that would report it.
        throw EmptyTitleException()
      }
      guard reading.rate > 0 else {
        throw NonPositiveRateException(reading.rate)
      }
      self.reading = reading
      self.shown = true
      onMain {
        self.register()
        self.publish()
      }
    }

    /// The elapsed time, pushed about once a second while a reading runs.
    ///
    /// Separate from `show` because it is the one thing that arrives at a cadence:
    /// rebuilding the whole dictionary for it would rewrite the title sixty times
    /// a minute, and taking the position out of `show` would mean a state change
    /// could carry a stale one.
    Function("setPosition") { (position: Double) in
      guard self.shown else {
        // Writing an elapsed time into an empty dictionary would put a Now Playing
        // item on the lock screen with no title at all. The caller's order is
        // `show` then `setPosition`; this is the tripwire for it being otherwise.
        throw NotShownException()
      }
      self.reading.position = position
      onMain { self.publish() }
    }

    Function("hide") {
      self.teardown()
    }
  }

  // MARK: - MediaPlayer

  /// Write the whole dictionary. Called on the main queue only.
  private func publish() {
    let center = MPNowPlayingInfoCenter.default()

    var info: [String: Any] = [
      MPMediaItemPropertyTitle: reading.title,
      MPMediaItemPropertyMediaType: MPMediaType.audioBook.rawValue,
      // Zero while paused, so that iOS stops extrapolating; the owner's reading
      // speed while playing, so that its extrapolation matches the graph's clock.
      MPNowPlayingInfoPropertyPlaybackRate: reading.playing ? reading.rate : 0.0,
      // The key the library never writes, and the one a reader at 1.5-3x needs
      // for iOS to render the rate rather than assume 1 (ADR 0016).
      MPNowPlayingInfoPropertyDefaultPlaybackRate: reading.rate,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: reading.position,
      MPNowPlayingInfoPropertyIsLiveStream: false,
    ]
    if !reading.chapter.isEmpty {
      info[MPMediaItemPropertyArtist] = reading.chapter
    }

    // `MPMediaItemPropertyPlaybackDuration` is deliberately absent. A book is
    // synthesized a sentence at a time and only the sections rendered so far are
    // even known, so any total would be an estimate — and estimating is the one
    // thing this project does not do (PHILOSOPHY rule 1, ADR 0005). The cost is
    // that iOS draws no scrub bar, which is the honest picture: there is nothing
    // to scrub along.
    center.nowPlayingInfo = info

    // The exact thing the library pins to `.paused` and cannot be told otherwise
    // from JavaScript.
    center.playbackState = reading.playing ? .playing : .paused
  }

  /// Claim the commands. Idempotent; called on the main queue only.
  private func register() {
    let center = MPRemoteCommandCenter.shared()

    handle(center.playCommand) { [weak self] in self?.emit("play") }
    handle(center.pauseCommand) { [weak self] in self?.emit("pause") }
    // The one the library forgets, and the one AirPods single-tap and most car
    // head units actually send (ADR 0016).
    handle(center.togglePlayPauseCommand) { [weak self] in self?.emit("toggle") }

    // iOS enables these by default, and the library enables four of them
    // explicitly — next, previous, a 15-second skip each way and a scrubber.
    // Every one of them would be a button on a book reader's lock screen that
    // does nothing: this app's four skip targets are sentences and paragraphs
    // (ADR 0020), not tracks, and it publishes no duration to scrub along.
    // Android's MediaSession is the other way round and enables none, which is
    // why `src/now-playing/` turns each one on there by hand.
    for command in [
      center.nextTrackCommand,
      center.previousTrackCommand,
      center.skipForwardCommand,
      center.skipBackwardCommand,
      center.seekForwardCommand,
      center.seekBackwardCommand,
      center.changePlaybackPositionCommand,
      center.stopCommand,
    ] {
      command.removeTarget(targets.removeValue(forKey: command))
      command.isEnabled = false
    }
  }

  private func handle(_ command: MPRemoteCommand, _ body: @escaping () -> Void) {
    // Remove first: `addTarget:` is additive, so this is what makes a second
    // `show` — or a JavaScript reload — one handler rather than two.
    command.removeTarget(targets.removeValue(forKey: command))
    targets[command] = command.addTarget { _ in
      body()
      return .success
    }
    command.isEnabled = true
  }

  private func emit(_ command: String) {
    sendEvent("remoteCommand", ["command": command])
  }

  private func teardown() {
    shown = false
    let held = targets
    targets = [:]
    onMain {
      for (command, token) in held {
        command.removeTarget(token)
        command.isEnabled = false
      }
      MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
      MPNowPlayingInfoCenter.default().playbackState = .stopped
    }
  }
}

/// Main-queue dispatch that does not hop when it is already there.
///
/// `show` is called from a button press and `setPosition` from the position
/// stream, both on the JavaScript thread, so in practice this always dispatches —
/// but `OnDestroy` can run on either, and a queue hop that is a no-op reads better
/// than two spellings of the same call.
private func onMain(_ body: @escaping () -> Void) {
  if Thread.isMainThread {
    body()
  } else {
    DispatchQueue.main.async(execute: body)
  }
}

private final class EmptyTitleException: Exception {
  override var reason: String {
    "The lock screen was given an empty title. A Now Playing item with no title looks exactly like one that is broken, so it is refused here rather than shown."
  }
}

private final class NonPositiveRateException: GenericException<Double> {
  override var reason: String {
    "The lock screen was given a playback rate of \(param). iOS extrapolates the elapsed time as rate x elapsed time, so a rate of zero or less would freeze or reverse the clock the highlight agrees with."
  }
}

private final class NotShownException: Exception {
  override var reason: String {
    "An elapsed time was pushed to the lock screen before anything was shown on it. Writing it would create a Now Playing item with no title; the caller shows a reading first."
  }
}
