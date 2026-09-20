import ExpoModulesCore
import AVFoundation
import Network
import UIKit

public final class OpenReaderOfflineModule: Module {
  private var monitor: NWPathMonitor?
  private var background: UIBackgroundTaskIdentifier = .invalid

  public func definition() -> ModuleDefinition {
    Name("OpenReaderOffline")
    Events("connectivity", "expired")
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
}
