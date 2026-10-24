import ExpoModulesCore
import AVFAudio
import os

/// ADR 0054. Each Debug Log line also goes to the system log at the default
/// level, which the phone keeps (INFO, where React Native's console lines
/// go, is held only while a stream is attached), so that a collected archive
/// lines the app's lines up with WebKit's and UIKit's. Public, because a
/// private argument is collected as `<private>`.
public final class OpenReaderDebugLogModule: Module {
  private let logger = Logger(subsystem: "top.xujialiu.openreader", category: "debug-log")
  private let playback = PlaybackTraceBuffer()
  private var playbackObservers: [NSObjectProtocol] = []

  /// Called only by the bundle's fixed Debug Mode gate, never a Settings switch.
  private func startPlaybackCapture() {
    guard playbackObservers.isEmpty else { return }
    let center = NotificationCenter.default
    playbackObservers.append(center.addObserver(forName: NSNotification.Name("OpenReaderAudioTrace"), object: nil, queue: nil) { [weak self] notification in
      guard let event = notification.userInfo?["event"] as? String else { return }
      // The library emits fixed event names and these two scalar fields only.
      let allowed = ["engine.start.request", "engine.start.done", "engine.pause.request", "engine.pause.done", "engine.rebuild.begin", "engine.rebuild.end", "interruption.began", "interruption.end.resume", "interruption.end.hold"]
      guard allowed.contains(event) else { return }
      self?.playback.append(event, numbers: [
        "state": (notification.userInfo?["state"] as? NSNumber)?.doubleValue ?? -1,
        "running": (notification.userInfo?["running"] as? NSNumber)?.doubleValue ?? -1
      ])
    })
    playbackObservers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) { [weak self] notification in
      let session = AVAudioSession.sharedInstance()
      self?.playback.append("session.route", numbers: [
        "reason": (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.doubleValue ?? -1,
        "outputLatency": session.outputLatency,
        "ioDuration": session.ioBufferDuration,
        "sampleRate": session.sampleRate
      ])
    })
    playbackObservers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { [weak self] notification in
      self?.playback.append("session.interruption", numbers: [
        "type": (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.doubleValue ?? -1,
        "options": (notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? NSNumber)?.doubleValue ?? 0
      ])
    })
    playback.append("capture.started")
  }

  public func definition() -> ModuleDefinition {
    Name("OpenReaderDebugLog")
    Constant("nativeVersion") { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "" }
    Constant("nativeBuild") { Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "" }
    Constant("buildVariant") { Bundle.main.infoDictionary?["OpenReaderBuildVariant"] as? String ?? "" }
    Function("startPlaybackCapture") { self.startPlaybackCapture() }
    Function("drainPlaybackCapture") { self.playback.drain() }
    OnDestroy {
      for observer in self.playbackObservers { NotificationCenter.default.removeObserver(observer) }
      self.playbackObservers.removeAll()
    }
    Function("systemLog") { (line: String) in
      self.logger.notice("\(line, privacy: .public)")
    }
  }
}
