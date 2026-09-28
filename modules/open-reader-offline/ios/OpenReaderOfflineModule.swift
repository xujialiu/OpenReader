import ExpoModulesCore
import AVFoundation
import BackgroundTasks
import Network
import UIKit

/// What the Live Activity of the continued task shows, kept for a task the
/// system has not launched yet.
private struct ContinuedShown {
  var title = ""
  var subtitle = ""
  var completed: Int64 = 0
  var total: Int64 = 1
}

public final class OpenReaderOfflineModule: Module {
  private var monitor: NWPathMonitor?
  private var background: UIBackgroundTaskIdentifier = .invalid
  /// ADR 0053. The running continued processing task; typed as its iOS 13
  /// superclass because a stored property cannot be of an iOS 26 type here.
  private var continued: BGTask?
  /// The identifier submitted last and not finished. A launch for any other is
  /// stale and is completed at once.
  private var continuedIdentifier: String?
  private var continuedShown = ContinuedShown()

  public func definition() -> ModuleDefinition {
    Name("OpenReaderOffline")
    Events("connectivity", "expired", "continuedExpired")
    Function("writeJson") { (uri: String, contents: String) in
      try contents.write(to: URL(string: uri)!, atomically: true, encoding: .utf8)
    }
    OnStartObserving {
      let monitor = NWPathMonitor()
      monitor.pathUpdateHandler = { [weak self] path in
        self?.sendEvent("connectivity", ["connected": path.status == .satisfied])
      }
      self.monitor = monitor
      monitor.start(queue: DispatchQueue(label: "openreader.connectivity"))
    }
    OnStopObserving { self.monitor?.cancel(); self.monitor = nil }
    Function("excludeFromBackup") { (uri: String) in
      var url = URL(string: uri)!
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
    }
    AsyncFunction("beginBackground") { () -> Bool in
      if self.background != .invalid { return true }
      self.background = UIApplication.shared.beginBackgroundTask(withName: "Prepare narration") { [weak self] in
        guard let self else { return }
        self.sendEvent("expired", [:])
        if self.background != .invalid {
          UIApplication.shared.endBackgroundTask(self.background)
          self.background = .invalid
        }
      }
      return self.background != .invalid
    }.runOnQueue(.main)
    AsyncFunction("endBackground") {
      if self.background != .invalid {
        UIApplication.shared.endBackgroundTask(self.background)
        self.background = .invalid
      }
    }.runOnQueue(.main)
    // ADR 0053: a download the owner started goes on away from the screen as
    // a continued processing task (iOS 26), shown in a Live Activity. False
    // below iOS 26 and on any refusal, which is logged; the caller then keeps
    // the bounded task above.
    AsyncFunction("submitContinued") { (title: String, subtitle: String, completed: Int, total: Int, promise: Promise) in
      self.continuedShown = ContinuedShown(title: title, subtitle: subtitle, completed: Int64(completed), total: Int64(max(total, 1)))
      guard #available(iOS 26.0, *) else {
        promise.resolve(false)
        return
      }
      self.submitContinued(title: title, subtitle: subtitle) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("updateContinued") { (title: String, subtitle: String, completed: Int, total: Int) in
      self.continuedShown = ContinuedShown(title: title, subtitle: subtitle, completed: Int64(completed), total: Int64(max(total, 1)))
      if #available(iOS 26.0, *) { self.showContinued() }
    }.runOnQueue(.main)
    AsyncFunction("finishContinued") { (success: Bool) in
      self.continuedIdentifier = nil
      if let task = self.continued {
        self.continued = nil
        task.setTaskCompleted(success: success)
      }
    }.runOnQueue(.main)
    // A reload makes a new module; a task this one leaves running would never
    // be completed, and the system may kill an app for that.
    OnDestroy {
      self.continued?.setTaskCompleted(success: false)
      self.continued = nil
      self.continuedIdentifier = nil
    }
    // Lossless compression preserves sample count and provider word timings.
    AsyncFunction("compress") { (input: String, output: String, rate: Double) in
      let data = try Data(contentsOf: URL(string: input)!)
      guard data.count > 0, data.count % 2 == 0, rate > 0 else {
        throw NSError(domain: "OfflineAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid PCM audio"])
      }
      let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false)!
      let frames = AVAudioFrameCount(data.count / 2)
      let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
      buffer.frameLength = frames
      data.withUnsafeBytes { raw in
        for i in 0..<Int(frames) {
          let value = Int16(littleEndian: raw.loadUnaligned(fromByteOffset: i * 2, as: Int16.self))
          buffer.floatChannelData![0][i] = Float(value) / 32768
        }
      }
      let file = try AVAudioFile(forWriting: URL(string: output)!, settings: [
        AVFormatIDKey: kAudioFormatAppleLossless,
        AVSampleRateKey: rate, AVNumberOfChannelsKey: 1,
        AVEncoderBitDepthHintKey: 16
      ])
      try file.write(from: buffer)
    }
  }

  /// On the main queue. `done` says whether the phone runs the task now.
  @available(iOS 26.0, *)
  private func submitContinued(title: String, subtitle: String, done: @escaping (Bool) -> Void) {
    if continuedIdentifier != nil {
      showContinued()
      done(true)
      return
    }
    guard let bundle = Bundle.main.bundleIdentifier else {
      done(false)
      return
    }
    // Info.plist permits `<bundle>.download.*` (plugins/with-continued-processing.ts).
    // A fresh suffix each time, because registering an identifier twice kills the app.
    let identifier = "\(bundle).download.\(UUID().uuidString)"
    let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: DispatchQueue.main) { [weak self] task in
      self?.launchedContinued(task, identifier: identifier)
    }
    guard registered else {
      NSLog("OpenReaderOffline: continued task %@ not registered; is it in BGTaskSchedulerPermittedIdentifiers?", identifier)
      done(false)
      return
    }
    let request = BGContinuedProcessingTaskRequest(identifier: identifier, title: title, subtitle: subtitle)
    // Run now or not at all: a queued request would start later, beside the
    // bounded task, for a download that may by then be over.
    request.strategy = .fail
    continuedIdentifier = identifier
    let refused = { (error: Error) in
      NSLog("OpenReaderOffline: continued task refused: %@", String(describing: error))
      if self.continuedIdentifier == identifier { self.continuedIdentifier = nil }
      done(false)
    }
    if #available(iOS 27.0, *) {
      // The form that reports every refusal; not to be called on the main thread.
      DispatchQueue.global(qos: .userInitiated).async {
        BGTaskScheduler.shared.submitTaskRequest(request) { error in
          DispatchQueue.main.async {
            if let error { refused(error) } else { done(true) }
          }
        }
      }
    } else {
      do {
        try BGTaskScheduler.shared.submit(request)
        done(true)
      } catch {
        refused(error)
      }
    }
  }

  /// On the main queue, where it was registered. The expiration handler is
  /// the phone ending the task, under pressure or at the owner's stop in the
  /// Live Activity; it cannot say which, and JavaScript takes both as the
  /// owner's stop (ADR 0053). What is publicly visible as it ends is logged
  /// and sent with the event, so that an end the phone chose can one day be
  /// compared with the owner's: both of the owner's stops on 2026-09-28 logged
  /// dasd's private `reasons: 1048576` and `reason: 2`, and no end the phone
  /// chose has been seen.
  @available(iOS 26.0, *)
  private func launchedContinued(_ task: BGTask, identifier: String) {
    guard identifier == continuedIdentifier, let processing = task as? BGContinuedProcessingTask else {
      task.setTaskCompleted(success: true)
      return
    }
    continued = task
    task.expirationHandler = { [weak self, weak processing] in
      let progress = processing?.progress
      let cancelled = progress?.isCancelled ?? false
      let fraction = progress?.fractionCompleted ?? 0
      let completed = progress?.completedUnitCount ?? 0
      let total = progress?.totalUnitCount ?? 0
      let thermalState = ProcessInfo.processInfo.thermalState.rawValue
      let lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
      NSLog(
        "OpenReaderOffline: continued task %@ expired: progress cancelled %@, fraction %.4f, %lld of %lld; thermal state %ld, low power %@",
        identifier, cancelled ? "yes" : "no", fraction, completed, total, thermalState, lowPower ? "yes" : "no")
      let ended: [String: Any?] = [
        "cancelled": cancelled, "fraction": fraction, "completed": completed, "total": total,
        "thermalState": thermalState, "lowPower": lowPower,
      ]
      DispatchQueue.main.async { self?.expiredContinued(identifier: identifier, ended: ended) }
    }
    showContinued()
  }

  private func expiredContinued(identifier: String, ended: [String: Any?]) {
    guard identifier == continuedIdentifier, let task = continued else { return }
    continued = nil
    continuedIdentifier = nil
    sendEvent("continuedExpired", ended)
    task.setTaskCompleted(success: false)
  }

  /// Progress is what keeps the task alive: one that reports none is expired.
  @available(iOS 26.0, *)
  private func showContinued() {
    guard let task = continued as? BGContinuedProcessingTask else { return }
    let shown = continuedShown
    if task.title != shown.title || task.subtitle != shown.subtitle {
      task.updateTitle(shown.title, subtitle: shown.subtitle)
    }
    task.progress.totalUnitCount = shown.total
    task.progress.completedUnitCount = min(shown.completed, shown.total)
  }
}
