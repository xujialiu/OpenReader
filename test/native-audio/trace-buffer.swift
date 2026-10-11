import Foundation

@main
struct TraceBufferTest {
  static func main() throws {
    let buffer = PlaybackTraceBuffer()
    let start = ProcessInfo.processInfo.systemUptime
    for index in 0..<10_000 { buffer.append("session.route", numbers: ["reason": Double(index % 9)]) }
    let elapsed = ProcessInfo.processInfo.systemUptime - start
    let batch = buffer.drain()
    let events = batch["events"] as! [[String: Any]]
    precondition(events.count == 128)
    precondition(batch["dropped"] as! Int == 9_872)
    precondition(events.first!["sequence"] as! Int == 9_873)
    precondition(events.last!["sequence"] as! Int == 10_000)
    for pair in zip(events, events.dropFirst()) {
      precondition((pair.0["uptimeMs"] as! Double) <= (pair.1["uptimeMs"] as! Double))
    }
    let bytes = try JSONSerialization.data(withJSONObject: batch).count
    precondition(bytes < 32_768)
    precondition((buffer.drain()["events"] as! [[String: Any]]).isEmpty)
    buffer.append("engine.pause.done", numbers: ["state": .infinity, "running": 0])
    let next = buffer.drain()["events"] as! [[String: Any]]
    precondition(next[0]["sequence"] as! Int == 10_001)
    precondition(next[0]["state"] == nil)
    print("PASS 10,000 native events in \(elapsed)s; retained 128 (\(bytes) JSON bytes); counted drops; ordered origin times; empty drain; finite fields")
  }
}
