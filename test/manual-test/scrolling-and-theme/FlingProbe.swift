import XCTest
import ObjectiveC

/// Real fast flicks on the open reader, for the fling-jump probe: FLINGS flicks
/// in DIRECTION (`down` brings later text up, as a finger swiping up does) at
/// VELOCITY points a second, GAP seconds apart, then SETTLE seconds of stillness.
/// With NOWAIT (the default), XCTest does not wait for the app to go idle
/// between flicks, so the next one lands while the page is still coasting —
/// what a finger flicking again and again does, and what outruns epub.js.
/// Attaches to the running reader with `.activate()`; never launches it.
/// Never plays.
final class FlingProbe: XCTestCase {
  static var unwaited = false

  /// XCTest waits for the app to be idle before and after every synthesized
  /// event, which lets each flick's momentum die before the next. Replace the
  /// wait with nothing, for whichever spelling this Xcode's XCTest has.
  func skipQuiescence() {
    guard !FlingProbe.unwaited, let cls = NSClassFromString("XCUIApplicationProcess") else { return }
    var replaced: [String] = []
    for name in ["waitForQuiescenceIncludingAnimationsIdle:", "waitForQuiescenceIncludingAnimationsIdle:isPreEvent:"] {
      guard let method = class_getInstanceMethod(cls, NSSelectorFromString(name)) else { continue }
      if name.hasSuffix("isPreEvent:") {
        let block: @convention(block) (AnyObject, Bool, Bool) -> Void = { _, _, _ in }
        method_setImplementation(method, imp_implementationWithBlock(block))
      } else {
        let block: @convention(block) (AnyObject, Bool) -> Void = { _, _ in }
        method_setImplementation(method, imp_implementationWithBlock(block))
      }
      replaced.append(name)
    }
    print("FLINGPROBE quiescence waits replaced: \(replaced)")
    FlingProbe.unwaited = true
  }

  func testFlicks() throws {
    let env = ProcessInfo.processInfo.environment
    let count = Int(env["FLINGS"] ?? "") ?? 10
    let direction = env["DIRECTION"] ?? "down"
    let velocity = Double(env["VELOCITY"] ?? "") ?? 4000
    let gap = Double(env["GAP"] ?? "") ?? 0.1
    let settle = Double(env["SETTLE"] ?? "") ?? 2.0
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    if env["NOWAIT"] != "0" { skipQuiescence() }
    // Above the floating player and below the header.
    let low = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.70))
    let high = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.30))
    let started = Date()
    for _ in 0..<count {
      let (from, to) = direction == "down" ? (low, high) : (high, low)
      from.press(forDuration: 0.01, thenDragTo: to, withVelocity: XCUIGestureVelocity(CGFloat(velocity)), thenHoldForDuration: 0)
      if gap > 0 { Thread.sleep(forTimeInterval: gap) }
    }
    print("FLINGPROBE \(count) flicks \(direction) at \(velocity) pt/s in \(Date().timeIntervalSince(started)) s")
    Thread.sleep(forTimeInterval: settle)
  }
}
