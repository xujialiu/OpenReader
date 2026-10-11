import Foundation

/// A bounded native-time history while JS is busy. No file/bridge work in a
/// notification callback; install.ts drains this into the existing rolling log.
final class PlaybackTraceBuffer {
  private let lock = NSLock()
  private let capacity: Int
  private var events: [[String: Any]] = []
  private var sequence = 0
  private var dropped = 0

  init(capacity: Int = 128) { self.capacity = max(1, capacity) }

  func append(_ event: String, numbers: [String: Double] = [:]) {
    lock.lock()
    defer { lock.unlock() }
    sequence += 1
    var record: [String: Any] = [
      "event": event, "sequence": sequence,
      "nativeMs": Date().timeIntervalSince1970 * 1000,
      "uptimeMs": ProcessInfo.processInfo.systemUptime * 1000
    ]
    for (key, value) in numbers where value.isFinite { record[key] = value }
    if events.count == capacity { events.removeFirst(); dropped += 1 }
    events.append(record)
  }

  func drain() -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    let result: [String: Any] = ["events": events, "dropped": dropped]
    events.removeAll(keepingCapacity: true)
    dropped = 0
    return result
  }
}
