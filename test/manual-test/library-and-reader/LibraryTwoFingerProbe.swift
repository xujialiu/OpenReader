import ObjectiveC
import XCTest

/// Two-finger range selection in the Library (#128, beta4) — the same private
/// XCUIAutomation synthesis as `../downloads/TwoFingerProbe.swift` (ADR 0045):
/// one `XCPointerEventPath` per finger in an `XCSynthesizedEventRecord`, played
/// by the device's `eventSynthesizer`, because XCTest's public API cannot move
/// two fingers together. The enum is copied rather than shared because
/// `run-probe.sh` compiles one self-contained Swift file per probe.
enum Fingers {
  typealias InitTouch = @convention(c) (AnyObject, Selector, CGPoint, Double) -> AnyObject
  typealias MoveTo = @convention(c) (AnyObject, Selector, CGPoint, Double) -> Void
  typealias LiftUp = @convention(c) (AnyObject, Selector, Double) -> Void
  typealias InitRecord = @convention(c) (AnyObject, Selector, NSString, Int) -> AnyObject
  typealias AddPath = @convention(c) (AnyObject, Selector, AnyObject) -> Void
  typealias Synthesize = @convention(c) (AnyObject, Selector, AnyObject, @escaping @convention(block) (Bool, NSError?) -> Void) -> Void

  static func method<T>(_ cls: AnyClass, _ name: String, _ type: T.Type) -> (T, Selector) {
    let selector = NSSelectorFromString(name)
    guard let found = class_getInstanceMethod(cls, selector) else { fatalError("\(cls) has no \(name)") }
    return (unsafeBitCast(method_getImplementation(found), to: type), selector)
  }

  static func finger(_ points: [(CGPoint, Double)], lift: Double) -> AnyObject {
    let cls: AnyClass = NSClassFromString("XCPointerEventPath")!
    let (touch, touchSelector) = method(cls, "initForTouchAtPoint:offset:", InitTouch.self)
    let (move, moveSelector) = method(cls, "moveToPoint:atOffset:", MoveTo.self)
    let (up, upSelector) = method(cls, "liftUpAtOffset:", LiftUp.self)
    let path = touch(class_createInstance(cls, 0) as AnyObject, touchSelector, points[0].0, points[0].1)
    for (point, at) in points.dropFirst() { move(path, moveSelector, point, at) }
    up(path, upSelector, lift)
    return path
  }

  static func pair(_ track: [(CGPoint, Double)], lift: Double, spread: CGFloat = 36) -> [AnyObject] {
    let left = track.map { (CGPoint(x: $0.0.x - spread / 2, y: $0.0.y), $0.1) }
    let right = track.map { (CGPoint(x: $0.0.x + spread / 2, y: $0.0.y), $0.1) }
    return [finger(left, lift: lift), finger(right, lift: lift)]
  }

  static func line(_ from: CGPoint, _ to: CGPoint, start: Double, seconds: Double, steps: Int = 20) -> [(CGPoint, Double)] {
    (0...steps).map { index in
      let t = Double(index) / Double(steps)
      return (CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t), start + seconds * t)
    }
  }

  /// A hold at `at` with small movements for `seconds` (edge auto-scroll needs
  /// contact to persist past the auto-scroll's initial delay).
  static func hold(_ at: CGPoint, seconds: Double, start: Double) -> [(CGPoint, Double)] {
    var track: [(CGPoint, Double)] = []
    let steps = Int(seconds / 0.1)
    for index in 0...steps {
      let wobble = CGFloat(index % 2) * 3 - 1.5
      track.append((CGPoint(x: at.x + wobble, y: at.y + wobble), start + 0.1 * Double(index)))
    }
    return track
  }

  static func play(_ fingers: [AnyObject], name: String, in test: XCTestCase) {
    let cls: AnyClass = NSClassFromString("XCSynthesizedEventRecord")!
    let (record, recordSelector) = method(cls, "initWithName:interfaceOrientation:", InitRecord.self)
    let (add, addSelector) = method(cls, "addPointerEventPath:", AddPath.self)
    let event = record(class_createInstance(cls, 0) as AnyObject, recordSelector, name as NSString, 1)
    for finger in fingers { add(event, addSelector, finger) }
    let synthesizer = XCUIDevice.shared.perform(NSSelectorFromString("eventSynthesizer"))!.takeUnretainedValue()
    let (synthesize, synthesizeSelector) = method(object_getClass(synthesizer)!, "synthesizeEvent:completion:", Synthesize.self)
    let done = test.expectation(description: name)
    synthesize(synthesizer, synthesizeSelector, event) { ok, error in
      if !ok { print("TWO-FINGER SYNTHESIS FAILED \(name): \(String(describing: error))") }
      done.fulfill()
    }
    test.wait(for: [done], timeout: 60)
  }
}

/// Drives the Library's two-finger range selection through real synthesized
/// gestures and reads the state back off the accessibility tree: the header's
/// `N selected` count and the rows' checkbox state. Rows at the root are 84 pt
/// tall from y=128 at the default text size on this 440x956 screen.
final class LibraryTwoFingerProbe: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")

  func capture(_ name: String) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func until(_ timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    repeat {
      if condition() { return true }
      Thread.sleep(forTimeInterval: 0.25)
    } while Date() < deadline
    return false
  }

  /// The header's `N selected` count, or nil outside selection mode.
  func selectedCount() -> Int? {
    let header = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "^\\d+ selected$")).firstMatch
    guard header.exists else { return nil }
    return Int(header.label.components(separatedBy: " ").first ?? "")
  }

  func waitCount(_ expected: Int?, timeout: TimeInterval = 8) -> Bool {
    until(timeout) { self.selectedCount() == expected }
  }

  /// Library at the root, normal mode: relaunch (a restart clears selection)
  /// and wait for the first row. The launch argument pins the bundle to this
  /// checkout's Metro: with `RCTMetroPort` empty in the app's Info.plist, a
  /// launch without it silently loads another Metro's older bundle
  /// (pitfalls/metro.md) and every sweep assertion fails against code that
  /// has no selection at all.
  func launchAtRoot() {
    app.terminate()
    let port = ProcessInfo.processInfo.environment["OPENREADER_METRO_PORT"] ?? "8082"
    app.launchArguments = ["-RCT_jsLocation", "localhost:\(port)"]
    app.launch()
    let first = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Folder, Scratch'")).firstMatch
    XCTAssertTrue(first.waitForExistence(timeout: 20), "Library root did not show its first row")
    XCTAssertNil(selectedCount(), "Library launched already in selection mode")
    XCTAssertTrue(app.buttons["Library actions"].waitForExistence(timeout: 10))
    XCTAssertTrue(until(5) { first.isHittable })
  }

  func cancelSelection() {
    let cancel = app.buttons["Cancel"]
    XCTAssertTrue(cancel.waitForExistence(timeout: 5), "No Cancel button to leave selection mode")
    cancel.tap()
    XCTAssertTrue(waitCount(nil), "Cancel did not leave selection mode")
  }

  /// Two fingers down over rows 1-5 from normal mode: direct entry adds the range.
  func testSweepAddsThenReverseRetracts() {
    launchAtRoot()
    // y=170 opens on row 1 and y=590 lands mid-row-6, so the sweep owns 6 rows.
    Fingers.play(Fingers.pair(Fingers.line(CGPoint(x: 220, y: 170), CGPoint(x: 220, y: 590), start: 0, seconds: 1.2), lift: 1.4), name: "sweep-down", in: self)
    XCTAssertTrue(waitCount(6), "Sweep down over rows 1-6 did not select 6 (count \(selectedCount().map(String.init) ?? "none"))")
    capture("sweep-down-5")
    // Reverse over the same rows, which start selected: the range removes and
    // retracts to the sweep-start snapshot.
    Fingers.play(Fingers.pair(Fingers.line(CGPoint(x: 220, y: 590), CGPoint(x: 220, y: 170), start: 0, seconds: 1.2), lift: 1.4), name: "sweep-up", in: self)
    XCTAssertTrue(waitCount(0), "Reverse sweep did not retract the added range (count \(selectedCount().map(String.init) ?? "none"))")
    capture("sweep-up-retracted")
    // A further sweep accumulates again from the retracted state.
    Fingers.play(Fingers.pair(Fingers.line(CGPoint(x: 220, y: 170), CGPoint(x: 220, y: 590), start: 0, seconds: 1.2), lift: 1.4), name: "sweep-down-again", in: self)
    XCTAssertTrue(waitCount(6), "Second sweep down did not select 6 again (count \(selectedCount().map(String.init) ?? "none"))")
    cancelSelection()
    capture("cancelled-normal")
  }

  /// A single continuous contact moves out and back: rows beyond the new end
  /// return to their pre-gesture state, rather than remaining selected.
  func testSingleSweepReversalRestoresRows() {
    launchAtRoot()
    var track = Fingers.line(CGPoint(x: 220, y: 170), CGPoint(x: 220, y: 590), start: 0.2, seconds: 0.8)
    track += Fingers.line(CGPoint(x: 220, y: 590), CGPoint(x: 220, y: 338), start: 1.0, seconds: 0.8).dropFirst()
    Fingers.play(Fingers.pair(track, lift: 2.0), name: "single-contact-reversal", in: self)
    XCTAssertTrue(waitCount(3), "Returning to row 3 in the same contact must restore rows 4-6")
    capture("single-contact-reversal-3")
    cancelSelection()
  }

  /// One finger over the same track is an ordinary scroll: no selection.
  func testOneFingerScrollDoesNotSelect() {
    launchAtRoot()
    let first = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Folder, Scratch'")).firstMatch
    let originalTop = first.frame.minY
    Fingers.play([Fingers.finger(Fingers.line(CGPoint(x: 220, y: 600), CGPoint(x: 220, y: 200), start: 0.2, seconds: 0.6), lift: 1.0)], name: "one-finger", in: self)
    XCTAssertTrue(until(3) { !first.exists || first.frame.minY < originalTop - 20 }, "One finger did not actually scroll the list")
    XCTAssertTrue(until(3) { self.selectedCount() == nil }, "One-finger scroll entered selection mode")
    let library = app.staticTexts["Library"]
    XCTAssertTrue(library.waitForExistence(timeout: 5), "Library header lost after one-finger scroll")
  }

  /// Two fingers held against the bottom edge auto-scroll the range beyond the screen.
  func testEdgeHoldAutoScrollsRange() {
    launchAtRoot()
    // Enter with a short horizontal sweep, then clear only the selection so
    // the native action's measured frame defines the visible list edge.
    Fingers.play(Fingers.pair(Fingers.line(CGPoint(x: 200, y: 170), CGPoint(x: 240, y: 170), start: 0.2, seconds: 0.5), lift: 0.9), name: "enter-selection", in: self)
    guard waitCount(1) else { XCTFail("Horizontal two-finger entry failed"); capture("entry-failed"); return }
    app.buttons["Select all"].tap()
    let total = selectedCount() ?? 0
    XCTAssertGreaterThanOrEqual(total, 10, "Seed at least 10 root rows")
    app.buttons["Deselect all"].tap()
    XCTAssertTrue(waitCount(0))
    let edge = app.buttons["Move selected"].frame.minY - 4
    var track = Fingers.line(CGPoint(x: 220, y: 170), CGPoint(x: 220, y: edge), start: 0.2, seconds: 1.0)
    track += Fingers.hold(CGPoint(x: 220, y: edge), seconds: 1.5, start: 1.2)
    Fingers.play(Fingers.pair(track, lift: 2.9), name: "edge-hold", in: self)
    XCTAssertTrue(waitCount(total, timeout: 5), "Edge hold did not reach all \(total) rows (count \(selectedCount().map(String.init) ?? "none"))")
    capture("edge-autoscrolled")
    cancelSelection()
  }

  /// Cancel from a two-finger-entered selection restores the normal Library.
  func testCancelAfterSweepRestoresNormal() {
    launchAtRoot()
    Fingers.play(Fingers.pair(Fingers.line(CGPoint(x: 220, y: 170), CGPoint(x: 220, y: 590), start: 0, seconds: 1.2), lift: 1.4), name: "sweep-down", in: self)
    XCTAssertTrue(waitCount(6), "Sweep did not select 6 before Cancel")
    cancelSelection()
    let first = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Folder, Scratch'")).firstMatch
    XCTAssertTrue(first.waitForExistence(timeout: 5), "Rows are not ordinary rows after Cancel")
  }
}
