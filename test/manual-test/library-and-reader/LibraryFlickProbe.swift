import ObjectiveC
import XCTest

/// Fingers that land and lift at exact times inside one synthesized event record
/// (#338). The same private XCUIAutomation synthesis as `LibraryTwoFingerProbe`
/// and `../downloads/TwoFingerProbe.swift` (ADR 0045): one `XCPointerEventPath`
/// per touch, played by the device's `eventSynthesizer`. XCTest's public gestures
/// cannot lift a finger and land the next one 0.1 s later, which is what a finger
/// catching a coasting list needs. The enum is copied rather than shared because
/// `run-probe.sh` compiles one self-contained Swift file per probe.
enum Touches {
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

  /// One touch: down at `points[0]`, through the rest, up `lift` seconds after the record starts.
  static func touch(_ points: [(CGPoint, Double)], lift: Double) -> AnyObject {
    let cls: AnyClass = NSClassFromString("XCPointerEventPath")!
    let (down, downSelector) = method(cls, "initForTouchAtPoint:offset:", InitTouch.self)
    let (move, moveSelector) = method(cls, "moveToPoint:atOffset:", MoveTo.self)
    let (up, upSelector) = method(cls, "liftUpAtOffset:", LiftUp.self)
    let path = down(class_createInstance(cls, 0) as AnyObject, downSelector, points[0].0, points[0].1)
    for (point, at) in points.dropFirst() { move(path, moveSelector, point, at) }
    up(path, upSelector, lift)
    return path
  }

  /// A straight run from `from` to `to`, `seconds` long, starting at record time `start`.
  static func line(_ from: CGPoint, _ to: CGPoint, start: Double, seconds: Double, steps: Int) -> [(CGPoint, Double)] {
    (0...steps).map { index in
      let t = Double(index) / Double(steps)
      return (CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t), start + seconds * t)
    }
  }

  /// Stand still at `at` for `seconds`, with a move every 50 ms so the touch stays alive.
  static func rest(_ at: CGPoint, start: Double, seconds: Double) -> [(CGPoint, Double)] {
    (1...max(1, Int(seconds / 0.05))).map { (at, start + 0.05 * Double($0)) }
  }

  static func play(_ touches: [AnyObject], name: String, in test: XCTestCase) {
    let cls: AnyClass = NSClassFromString("XCSynthesizedEventRecord")!
    let (record, recordSelector) = method(cls, "initWithName:interfaceOrientation:", InitRecord.self)
    let (add, addSelector) = method(cls, "addPointerEventPath:", AddPath.self)
    let event = record(class_createInstance(cls, 0) as AnyObject, recordSelector, name as NSString, 1)
    for touch in touches { add(event, addSelector, touch) }
    let synthesizer = XCUIDevice.shared.perform(NSSelectorFromString("eventSynthesizer"))!.takeUnretainedValue()
    let (synthesize, synthesizeSelector) = method(object_getClass(synthesizer)!, "synthesizeEvent:completion:", Synthesize.self)
    let done = test.expectation(description: name)
    synthesize(synthesizer, synthesizeSelector, event) { ok, error in
      if !ok { print("[flick] SYNTHESIS FAILED \(name): \(String(describing: error))") }
      done.fulfill()
    }
    test.wait(for: [done], timeout: 60)
  }
}

/// #338: a flick whose momentum carries the Library list past its top must not show
/// "Search Library", and nothing the fix does while the list coasts may break the
/// pull (design 0090), the menu Search, Settings or the results list. Real
/// synthesized touches against the staged Library: sixteen root Folders, then
/// Documents (`A Short Test of Reading Aloud` and `Scroll Diag NN of 14`).
/// `flick-to-top.sh` measures the field frame by frame; this probe asserts the
/// outcomes that follow a finger or a button meeting a coast.
///
/// Every test relaunches the app, so the page starts at the Library root with the
/// field hidden. Each prints `[flick]` lines (wall-clock seconds) for the log.
final class LibraryFlickProbe: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
  let centre: CGFloat = 201

  // MARK: reading the app

  func mark(_ text: String) {
    print("[flick] \(String(format: "%.3f", Date().timeIntervalSince1970)) \(text)")
  }

  func shot(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func searchField() -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "placeholderValue == %@", "Search Library")).firstMatch
  }

  /// The field is on screen, not merely in the tree: a collapsed field is clipped away.
  func fieldShowing() -> Bool {
    let field = searchField()
    guard field.exists else { return false }
    let frame = field.frame
    return frame.height > 20 && frame.minY >= 90 && frame.maxY <= 260
  }

  func closeShowing() -> Bool { app.navigationBars.firstMatch.buttons["Close"].exists }
  func keyboardShowing() -> Bool { app.keyboards.count > 0 }
  func title() -> String { app.navigationBars.firstMatch.identifier }

  /// Where Folder 01 is, or -9999 when the list does not offer it.
  func firstFolderY() -> CGFloat {
    let row = app.buttons["Folder, Flick Folder 01, Empty"]
    return row.exists ? row.frame.minY : -9999
  }

  func state(_ context: String) -> String {
    let line = "\(context): field=\(fieldShowing()) close=\(closeShowing()) keyboard=\(keyboardShowing()) page=\(title()) folder01Y=\(Int(firstFolderY()))"
    mark(line)
    return line
  }

  func expectHidden(_ context: String, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertFalse(fieldShowing(), "\(context): the search field must be hidden", file: file, line: line)
    XCTAssertFalse(closeShowing(), "\(context): no Close control", file: file, line: line)
    XCTAssertFalse(keyboardShowing(), "\(context): no keyboard", file: file, line: line)
    XCTAssertEqual(title(), "Library", "\(context): still on the Library page", file: file, line: line)
  }

  func launchAtRoot() {
    app.terminate()
    app.launch()
    XCTAssertTrue(app.buttons["Library actions"].waitForExistence(timeout: 20), "Library actions must appear")
    XCTAssertTrue(app.buttons["Folder, Flick Folder 01, Empty"].waitForExistence(timeout: 20), "the staged Folders must appear")
    sleep(1)
    expectHidden("cold launch")
    XCTAssertEqual(firstFolderY(), 128, accuracy: 2, "cold launch: the first row rests under the title")
  }

  // MARK: gestures (screen points on the 402 x 874 iPhone 17)

  /// A slow drag up that stops moving before the finger lifts, so the list keeps no
  /// momentum: the list ends exactly `distance` points further down.
  func dragAway(_ distance: CGFloat, record: Bool = true) {
    // From y 760: a LogBox toast ("Open debugger to view warnings", y 787 to 834) can appear after a Settings round trip and eats a drag that starts under it.
    let from = CGPoint(x: centre, y: 760)
    let to = CGPoint(x: centre, y: 760 - distance)
    let seconds = Double(distance) / 250
    var points = Touches.line(from, to, start: 0, seconds: seconds, steps: max(4, Int(seconds / 0.04)))
    points += Touches.rest(to, start: seconds, seconds: 0.4)
    Touches.play([Touches.touch(points, lift: seconds + 0.42)], name: "drag-away-\(Int(distance))", in: self)
    sleep(1)
  }

  /// The flick of `flick-to-top.sh`, in points: the finger runs `distance` down in `seconds` and lifts.
  func flickPath(from y: CGFloat = 300, distance: CGFloat = 300, seconds: Double = 0.1, start: Double = 0, steps: Int? = nil) -> AnyObject {
    // One move every 25 ms or slower: XCTest drops a path whose moves come faster than a frame (a 0.1 s flick of eight steps moved nothing).
    let points = Touches.line(CGPoint(x: centre, y: y), CGPoint(x: centre, y: y + distance), start: start, seconds: seconds, steps: steps ?? max(3, Int(seconds / 0.025)))
    return Touches.touch(points, lift: start + seconds + 0.005)
  }

  /// A finger that lands at `start` and pulls `travel` points down over `seconds`, then rests and lifts.
  func pullPath(from y: CGFloat, travel: CGFloat, over seconds: Double, start: Double, rest: Double = 0.35) -> AnyObject {
    let origin = CGPoint(x: centre, y: y)
    let end = CGPoint(x: centre, y: y + travel)
    var points: [(CGPoint, Double)] = [(origin, start)]
    points += Touches.rest(origin, start: start, seconds: 0.05)
    points += Touches.line(origin, end, start: start + 0.05, seconds: seconds, steps: max(3, Int(seconds / 0.04)))
    points += Touches.rest(end, start: start + 0.05 + seconds, seconds: rest)
    return Touches.touch(points, lift: start + 0.05 + seconds + rest + 0.02)
  }

  /// A finger that lands at `y`, stays `seconds`, and lifts without moving.
  func holdPath(at y: CGFloat, start: Double, seconds: Double) -> AnyObject {
    let origin = CGPoint(x: centre, y: y)
    var points: [(CGPoint, Double)] = [(origin, start)]
    points += Touches.rest(origin, start: start, seconds: seconds)
    return Touches.touch(points, lift: start + seconds + 0.02)
  }

  /// A tap at `point` at record time `start`, held `hold` seconds: 0.04 s opens a bar button, a row of the actions sheet needs about 0.2 s.
  func tapPath(_ point: CGPoint, start: Double, hold: Double = 0.04) -> AnyObject {
    Touches.touch([(point, start), (point, start + hold)], lift: start + hold + 0.02)
  }

  /// Folder 01's y once it has stopped moving (two reads 0.6 s apart agree), or the last read after about 8 s.
  func settledFirstFolderY() -> CGFloat {
    var last = firstFolderY()
    for _ in 0..<14 {
      Thread.sleep(forTimeInterval: 0.6)
      let now = firstFolderY()
      if abs(now - last) < 0.5 { return now }
      last = now
    }
    return last
  }

  /// Flicks until the page is at its top, then asserts it rests there with nothing open. The finger lifts well short of
  /// the top (70 % of the way, at most 500 pt; a slow drag 15 pt short within 160 pt of it), because a drag that carries the
  /// list past its top is a pull, which commits search by design; and it never flicks a list that is already at the top,
  /// whatever is open on it.
  func goTop(_ context: String) {
    for _ in 0..<5 {
      let y = settledFirstFolderY()
      if y >= 100 { break }
      let offset = 128 - y
      if offset < 160 {
        // Close to the top: a slow drag 15 pt short of it, no momentum (any flick or longer drag would be a pull).
        let drag = max(offset - 15, 10)
        var points = Touches.line(CGPoint(x: centre, y: 200), CGPoint(x: centre, y: 200 + drag), start: 0, seconds: 0.5, steps: 12)
        points += Touches.rest(CGPoint(x: centre, y: 200 + drag), start: 0.5, seconds: 0.3)
        Touches.play([Touches.touch(points, lift: 0.82)], name: "go-top-near", in: self)
        sleep(1)
        continue
      }
      let drag = min(max(offset * 0.7, 100), 500)
      Touches.play([flickPath(from: 150, distance: drag, seconds: max(0.1, Double(drag) / 3000))], name: "go-top", in: self)
    }
    let rest = settledFirstFolderY()
    expectHidden("\(context) back at the top")
    // A list that stopped a few points short of the top is fine; the 54 pt a revealed field adds is not.
    XCTAssertTrue((100...140).contains(rest), "\(context): the first row rests under the title, no leftover inset (Folder 01 at \(rest))")
  }

  func closeSearch(_ context: String) {
    let close = app.navigationBars.firstMatch.buttons["Close"]
    XCTAssertTrue(close.waitForExistence(timeout: 5), "\(context): Close must exist to leave search")
    if close.exists { close.tap() }
    sleep(1)
  }

  // MARK: flick shapes

  /// The two flicks, each played alone in its own record: a flick with a pull in the same record lost its coast (the list
  /// moved only the flick's own 660 pt), so the finger that catches it is a second record, played right after the first returns
  /// (about 0.15 s after the lift on this machine; `[flick] gap` lines carry the measured time between the two plays). XCTest
  /// flicks are weaker than AXe's (a 0.12 s, 400 pt AXe swipe bounces the list 400 pt past its top; these bounce 50 to 100 pt), and
  /// XCTest drops a path whose moves are closer than 25 ms, hence the step counts.
  /// - `bounce`: one 200 pt jump in 25 ms from 585 pt down: the finger lifts 385 pt short of the top, the coast reaches it about 0.2 s
  ///   later and the list bounces about 190 pt past it, back at rest after about 0.7 s (300 pt in 0.1 s bounced 33 pt, 450 pt in
  ///   0.05 s 170 pt, 200 pt in one 25 ms step 194 pt; the AXe flick of `flick-to-top.sh` 370 to 450 pt).
  /// - `long`: 320 pt in 0.1 s from 1271 pt down: a gentle coast that takes about 3 s to reach the top, with no bounce.
  struct Shape {
    let name: String; let from: CGFloat; let distance: CGFloat; let seconds: Double; let drags: [CGFloat]
    var lift: Double { seconds + 0.005 }
  }
  let bounce = Shape(name: "bounce", from: 300, distance: 200, seconds: 0.025, drags: [600])
  let long = Shape(name: "long", from: 300, distance: 320, seconds: 0.10, drags: [650, 650])

  func scrollAway(_ shape: Shape) { for distance in shape.drags { dragAway(distance) } }

  func flick(_ shape: Shape) -> AnyObject {
    flickPath(from: shape.from, distance: shape.distance, seconds: shape.seconds, steps: Int((shape.seconds / 0.025).rounded()))
  }

  /// Plays the flick, waits `wait` seconds, then plays `second`; logs the time between the two plays.
  func flickThen(_ shape: Shape, wait: Double, name: String, _ second: () -> [AnyObject]) {
    let started = Date()
    Touches.play([flick(shape)], name: "\(name)-flick", in: self)
    if wait > 0 { Thread.sleep(forTimeInterval: wait) }
    let between = Date().timeIntervalSince(started)
    mark("\(name): gap \(String(format: "%.3f", between - shape.lift)) s from the flick's lift to the second record")
    Touches.play(second(), name: "\(name)-second", in: self)
  }

  // MARK: check 4: a finger catches the coast

  /// A flick from a scrolled list and a finger landing (`wait` + about 0.15 s) after it lifted, then pulling
  /// down, pulling a little, or only touching. The pull must behave as a pull: a full one commits into input
  /// with the keyboard and Close; a short one and a bare touch leave the field hidden on the same page.
  /// Afterwards the list must still reach its top with the first row at rest and no field.
  func catchThenPull(_ shape: Shape, kind: String, waits: [Double], travel: CGFloat) {
    for wait in waits {
      let name = "\(shape.name) \(kind) wait \(wait)"
      launchAtRoot()
      scrollAway(shape)
      let before = state("\(name) scrolled")
      XCTAssertFalse(before.contains("field=true"), "the list must start with the field hidden")
      mark("\(name): play")
      flickThen(shape, wait: wait, name: name) {
        switch kind {
        case "full": return [pullPath(from: 330, travel: travel, over: 1.2, start: 0)]
        case "short": return [pullPath(from: 330, travel: travel, over: 0.5, start: 0)]
        default: return [holdPath(at: 330, start: 0, seconds: 0.4)]
        }
      }
      mark("\(name): played")
      sleep(2)
      let after = state("\(name) after")
      shot("catch-\(shape.name)-\(kind)-\(wait)")
      if kind != "full" && shape.name == "bounce" {
        // The bounce ends at the top: the first row must rest at 128, not 54 pt lower under a field that never went away.
        let rest = settledFirstFolderY()
        XCTAssertEqual(rest, 128, accuracy: 2, "\(name): the list must come to rest at its top with no inset (Folder 01 at \(rest))")
      }
      if kind == "full" {
        XCTAssertTrue(after.contains("field=true") && after.contains("close=true") && after.contains("keyboard=true"),
                      "\(name): the pull must commit into input (\(after))")
        closeSearch(name)
        expectHidden("\(name) after Close")
      } else {
        expectHidden(name)
      }
      goTop(name)
    }
  }

  /// What the field does after a finger catches the bounce and lets go without pulling: kept up for how long, and what
  /// puts it away. Records, does not judge (the judging test is `testCatchTheBounceThenRelease`).
  func testCatchTheBounceReleaseDetails() {
    for (name, wait, build) in [
      ("hold 0.4 s at y 330", 0.1, { self.holdPath(at: 330, start: 0, seconds: 0.4) }),
      ("quick tap at y 330", 0.1, { self.tapPath(CGPoint(x: self.centre, y: 330), start: 0) }),
      ("hold 0.4 s at y 140", 0.1, { self.holdPath(at: 140, start: 0, seconds: 0.4) }),
    ] as [(String, Double, () -> AnyObject)] {
      launchAtRoot()
      scrollAway(bounce)
      flickThen(bounce, wait: wait, name: name) { [build()] }
      sleep(2)
      mark("\(name) +2 s: \(state("\(name) +2 s"))")
      sleep(6)
      _ = state("\(name) +8 s")
      sleep(7)
      _ = state("\(name) +15 s")
      shot("release-\(name)-15s")
      // What puts it away: a small drag, then a tap on a blank spot of the bar.
      dragAway(30)
      _ = state("\(name) after a 30 pt drag")
    }
  }

  func testCatchTheBounceThenFullPull() {
    catchThenPull(bounce, kind: "full", waits: [0, 0.1, 0.25, 0.4, 0.7], travel: 160)
  }

  func testCatchTheBounceThenShortPull() {
    catchThenPull(bounce, kind: "short", waits: [0, 0.15, 0.3, 0.5], travel: 25)
  }

  func testCatchTheBounceThenRelease() {
    catchThenPull(bounce, kind: "release", waits: [0, 0.1, 0.25, 0.4], travel: 0)
  }

  /// A finger that lands on the bounce and takes the list the other way, back up and away from its top, as a drag or as
  /// a flick: the finger begins a drag with the list still past its top, which is when a caught coast is bound to the
  /// navigation bar again. Only a pull opens search, so the field, Close and the keyboard must stay away, the list
  /// must leave its top, and a flick back must reach the top at rest with no inset (#338, round 2). The state it reads
  /// passes a field that is up for 0.15 s: record the run (`record-probe.sh`) and `field-visible.py --scan` the video.
  func catchThenScrollAway(kind: String, waits: [Double]) {
    for wait in waits {
      let name = "\(bounce.name) \(kind) wait \(wait)"
      launchAtRoot()
      scrollAway(bounce)
      mark("\(name): play")
      flickThen(bounce, wait: wait, name: name) {
        // Long enough to leave the overscroll first: a list caught up to about 190 pt past its top
        // is still rubber-banded, and a 200 pt drag only brings it back to the top (#338, round 3).
        switch kind {
        case "drag-up": return [pullPath(from: 760, travel: -600, over: 1.0, start: 0)]
        // The gestures of round 2 (the ones that showed F1's flash): too short to take the list away from its top.
        case "short-drag-up": return [pullPath(from: 500, travel: -200, over: 0.5, start: 0)]
        case "short-flick-up": return [flickPath(from: 500, distance: -250, seconds: 0.1)]
        case "wiggle":
          // A little pull first (a pull candidate forms, 30 pt is short of the 54 pt that commits), then the list is taken away.
          var points: [(CGPoint, Double)] = [(CGPoint(x: self.centre, y: 600), 0)]
          points += Touches.line(CGPoint(x: self.centre, y: 600), CGPoint(x: self.centre, y: 630), start: 0.05, seconds: 0.2, steps: 5)
          points += Touches.line(CGPoint(x: self.centre, y: 630), CGPoint(x: self.centre, y: 130), start: 0.25, seconds: 0.9, steps: 22)
          points += Touches.rest(CGPoint(x: self.centre, y: 130), start: 1.15, seconds: 0.3)
          return [Touches.touch(points, lift: 1.47)]
        default: return [flickPath(from: 700, distance: -450, seconds: 0.15)]
        }
      }
      let during = state("\(name) played")
      XCTAssertFalse(during.contains("close=true") || during.contains("keyboard=true"), "\(name): no Close and no keyboard (\(during))")
      sleep(2)
      let after = state("\(name) +2 s")
      shot("scroll-away-\(kind)-\(wait)")
      expectHidden("\(name) +2 s")
      if !kind.hasPrefix("short") {
        XCTAssertLessThan(firstFolderY(), 100, "\(name): the list must have left its top (Folder 01 at \(firstFolderY()))")
      }
      mark("\(name): \(after)")
      goTop(name)
    }
  }

  func testCatchTheBounceThenDragUp() { catchThenScrollAway(kind: "drag-up", waits: [0, 0.15, 0.4]) }
  func testCatchTheBounceThenFlickUp() { catchThenScrollAway(kind: "flick-up", waits: [0.1, 0.3]) }

  // Round 3 of #338: the gestures that reproduced F1, and the catch phases between the three waits above.
  func testCatchTheBounceThenShortDragUp() { catchThenScrollAway(kind: "short-drag-up", waits: [0, 0.15]) }
  func testCatchTheBounceThenShortFlickUp() { catchThenScrollAway(kind: "short-flick-up", waits: [0.1]) }
  func testCatchTheBounceThenWiggle() { catchThenScrollAway(kind: "wiggle", waits: [0, 0.15]) }
  func testCatchTheBounceThenDragUpSweep() { catchThenScrollAway(kind: "drag-up", waits: [0.05, 0.1, 0.2, 0.3, 0.5, 0.6]) }

  func testCatchTheLongCoastThenPull() {
    catchThenPull(long, kind: "full", waits: [0.3, 1.0, 2.0], travel: 450)
    catchThenPull(long, kind: "short", waits: [0.6, 1.6], travel: 25)
    catchThenPull(long, kind: "release", waits: [0.4, 1.2], travel: 0)
  }

  // MARK: check 5: the menu Search starts while the list is coasting

  /// A flick; a tap on Library actions in the second record, 0.35 s after the lift; the sheet then rises (about 0.8 s)
  /// and its appearance cuts the coast short, so the list stays where it was in the middle of its coast. Search is
  /// then chosen with a 0.2 s press (a 0.04 s one did not select the row). The capture rebinds the list first: Search must
  /// open into input, and Close must hide it and bring back the position the list had when Search was chosen.
  func menuSearchDuringCoast(_ shape: Shape, menu: Double) {
    let name = "\(shape.name) menu \(menu)"
    launchAtRoot()
    scrollAway(shape)
    state("\(name) scrolled")
    mark("\(name): play")
    flickThen(shape, wait: 0, name: name) { [tapPath(CGPoint(x: 360, y: 84), start: menu)] }
    sleep(2)
    let sheet = app.buttons["Search"]
    XCTAssertTrue(sheet.waitForExistence(timeout: 5), "the actions sheet must be up")
    shot("menu-search-\(shape.name)-sheet")
    // Where the list was cut short: the first Folder row on screen.
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Folder, Flick Folder'")).allElementsBoundByIndex
      .filter { $0.exists && $0.frame.minY >= 130 && $0.frame.maxY <= 600 }
      .min(by: { $0.frame.minY < $1.frame.minY })
    guard let anchor = row else { XCTFail("a Folder row must be on screen behind the sheet"); return }
    let label = anchor.label
    let anchorY = anchor.frame.minY
    mark("\(name): anchor \(label) at \(Int(anchorY))")
    Touches.play([tapPath(CGPoint(x: centre, y: 635), start: 0, hold: 0.2)], name: "menu-search-row", in: self)
    sleep(2)
    let opened = state("\(name) after Search")
    shot("menu-search-\(shape.name)-opened")
    XCTAssertTrue(opened.contains("field=true") && opened.contains("close=true") && opened.contains("keyboard=true"),
                  "\(name): Search must open into input (\(opened))")
    closeSearch(name)
    expectHidden("\(name) after Close")
    shot("menu-search-\(shape.name)-closed")
    let restored = app.buttons[label]
    XCTAssertEqual(restored.exists ? restored.frame.minY : -9999, anchorY, accuracy: 8,
                   "\(name): Close must bring back the position of the Search (\(label) at \(restored.exists ? restored.frame.minY : -9999) vs \(anchorY))")
    goTop(name)
  }

  func testMenuSearchDuringTheLongCoast() { menuSearchDuringCoast(long, menu: 0.1) }

  // MARK: check 7: leaving the page while the list coasts

  /// Settings opened by a tap in the middle of a coast, then Back. The list must
  /// scroll, reach its top without the field, commit a pull, and open a menu Search
  /// and Close again (the position it comes back to is recorded, not judged).
  func settingsDuringCoastThenBack(_ shape: Shape, tap: Double) {
    let name = "\(shape.name) settings tap \(tap)"
    launchAtRoot()
    scrollAway(shape)
    mark("\(name): play")
    flickThen(shape, wait: 0, name: name) { [tapPath(CGPoint(x: 42, y: 84), start: tap)] }
    sleep(2)
    let back = app.buttons["Back"]
    XCTAssertTrue(back.waitForExistence(timeout: 5), "the tap must open Settings, which offers Back")
    shot("\(shape.name)-settings-open")
    back.tap()
    sleep(2)
    XCTAssertEqual(title(), "Library", "Back must return to the Library")
    // The field right after Back is recorded, not judged: pressing a bar button can leave it up on any build.
    mark("\(name) field after Back: \(state("\(name) after Back"))")
    shot("\(shape.name)-after-back")

    // The list scrolls normally.
    let beforeScroll = firstFolderY()
    dragAway(400)
    let scrolled = firstFolderY()
    XCTAssertLessThan(scrolled, beforeScroll - 200, "after Back the list must scroll (Folder 01 \(beforeScroll) -> \(scrolled))")
    XCTAssertFalse(fieldShowing(), "scrolled away: no field")

    // A flick back to the top shows no field and ends at rest.
    Touches.play([flickPath(from: 300, distance: 420, seconds: 0.1)], name: "flick-after-back", in: self)
    sleep(3)
    XCTAssertFalse(fieldShowing(), "flick after Back: no field")
    XCTAssertEqual(firstFolderY(), 128, accuracy: 2, "flick after Back: the first row at rest")

    // A pull still commits into input.
    Touches.play([pullPath(from: 300, travel: 160, over: 1.2, start: 0)], name: "pull-after-back", in: self)
    sleep(2)
    let pulled = state("\(name) pull after Back")
    shot("\(shape.name)-pull-after-back")
    XCTAssertTrue(pulled.contains("field=true") && pulled.contains("close=true") && pulled.contains("keyboard=true"),
                  "a pull after Back must commit (\(pulled))")
    closeSearch("pull after Back")
    expectHidden("after Close")

    // The browse position survives a search: needs the list bound to the bar again.
    dragAway(400)
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Folder, Flick Folder'")).allElementsBoundByIndex
      .filter { $0.exists && $0.frame.minY >= 130 && $0.frame.maxY <= 800 }
      .min(by: { $0.frame.minY < $1.frame.minY })
    guard let anchor = row else { XCTFail("a Folder row must be on screen"); return }
    let label = anchor.label
    let anchorY = anchor.frame.minY
    app.buttons["Library actions"].tap()
    let search = app.buttons["Search"]
    XCTAssertTrue(search.waitForExistence(timeout: 5)); search.tap()
    XCTAssertTrue(app.navigationBars.firstMatch.buttons["Close"].waitForExistence(timeout: 5))
    closeSearch("restore")
    expectHidden("restore after Close")
    // Recorded, not judged: after a pulled Search a menu Search returned to the top on the pre-fix build too (Folder 06 at 548, not 162).
    let restored = app.buttons[label]
    mark("\(name) restore after a second Search: \(label) was at \(Int(anchorY)), now at \(restored.exists ? Int(restored.frame.minY) : -9999)")
    shot("\(shape.name)-restored")
  }

  func testSettingsDuringTheLongCoastThenBack() { settingsDuringCoastThenBack(long, tap: 0.6) }
  func testSettingsDuringTheBounceThenBack() { settingsDuringCoastThenBack(bounce, tap: 0.1) }

  // MARK: check 8: search active

  /// With a query typed (results list, fix inactive), a flick of the results to their top must
  /// leave the field, the query and Close exactly as they were, and Close must still hide it.
  func testSearchResultsFlickToTop() {
    launchAtRoot()
    app.buttons["Library actions"].tap()
    let search = app.buttons["Search"]
    XCTAssertTrue(search.waitForExistence(timeout: 5)); search.tap()
    let field = searchField()
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.typeText("Scroll Diag")
    sleep(1)
    XCTAssertEqual(field.value as? String, "Scroll Diag")
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Scroll Diag'")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5), "the results must list the Scroll Diag Documents")
    // Dismiss the keyboard with its Search key (the query stays), so the drag below is not typed.
    let submit = app.keyboards.buttons.matching(NSPredicate(format: "identifier == %@ OR label == %@", "Search", "search")).firstMatch
    XCTAssertTrue(submit.waitForExistence(timeout: 5)); submit.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
    state("results shown")
    shot("results-top")
    dragAway(400)
    state("results scrolled")
    shot("results-scrolled")
    Touches.play([flickPath(from: 300, distance: 420, seconds: 0.1)], name: "results-flick-to-top", in: self)
    sleep(2)
    let after = state("results after flick")
    shot("results-after-flick")
    XCTAssertTrue(after.contains("field=true") && after.contains("close=true"), "searching: the field and Close stay (\(after))")
    XCTAssertEqual(searchField().value as? String, "Scroll Diag", "searching: the query is untouched")
    XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Scroll Diag'")).firstMatch.exists, "searching: results remain")
    closeSearch("results")
    expectHidden("results after Close")
    XCTAssertEqual(firstFolderY(), 128, accuracy: 2, "after Close the first row is at rest")
  }

  // MARK: check 6: ordinary scrolling

  /// Slow drags and flicks away from the top, a flick that stops mid-list, a flick that
  /// reaches the top: after each settle there is no field, no Close, no keyboard and
  /// the page is the same, and the list's rest position at the top carries no inset.
  func testOrdinaryScrolling() {
    launchAtRoot()
    dragAway(300)
    expectHidden("slow drag away")
    XCTAssertLessThan(firstFolderY(), 0, "the list left its top")
    // A hard flick up (deeper).
    for _ in 0..<2 {
      let points = Touches.line(CGPoint(x: centre, y: 700), CGPoint(x: centre, y: 400), start: 0, seconds: 0.1, steps: 4)
      Touches.play([Touches.touch(points, lift: 0.105)], name: "flick-up", in: self)
      sleep(2)
      expectHidden("flick up")
    }
    // A slow drag back down, staying below the top.
    var back = Touches.line(CGPoint(x: centre, y: 200), CGPoint(x: centre, y: 350), start: 0, seconds: 0.6, steps: 15)
    back += Touches.rest(CGPoint(x: centre, y: 350), start: 0.6, seconds: 0.4)
    Touches.play([Touches.touch(back, lift: 1.02)], name: "slow-down", in: self)
    sleep(1)
    expectHidden("slow drag down")
    // A gentle flick down that stops short of the top.
    Touches.play([flickPath(from: 300, distance: 60, seconds: 0.1)], name: "short-flick-down", in: self)
    sleep(3)
    expectHidden("short flick down")
    XCTAssertLessThan(firstFolderY(), 0, "the short flick stopped before the top")
    // A flick that reaches the top and bounces.
    goTop("ordinary scrolling")
    shot("ordinary-end")
  }
}
