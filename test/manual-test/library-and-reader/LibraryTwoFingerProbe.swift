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

  /// #339: the two-finger sweep selects search results as it selects a
  /// Folder's rows. A browse control first, then the same track over results
  /// must select exactly the three traversed results, lock the field with its
  /// query, and offer Move. #342: a query with no results comes first, so the
  /// sweep must not take the empty line for the list. No seeding.
  func testSweepSelectsSearchResults() {
    app.terminate(); app.launchArguments = []; app.launch()
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 10))
    let browse = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ OR label CONTAINS %@", "Folder,", "Not started.")).allElementsBoundByIndex
      .filter { $0.exists && $0.frame.minY >= app.navigationBars.firstMatch.frame.maxY }
      .sorted { $0.frame.minY < $1.frame.minY }
    guard browse.count >= 3 else { XCTFail("Stage at least three visible root entries"); return }
    let center = app.frame.midX
    Fingers.play(Fingers.pair(Fingers.line(CGPoint(x: center, y: browse[0].frame.midY),
      CGPoint(x: center, y: browse[2].frame.midY), start: 0.1, seconds: 0.8), lift: 1.1), name: "search-sweep-control", in: self)
    XCTAssertTrue(waitCount(3), "Two fingers must select exactly the three traversed entries")
    capture("search-sweep-control-selected")
    cancelSelection()
    actions.tap()
    let search = app.buttons["Search"]
    XCTAssertTrue(search.waitForExistence(timeout: 5)); search.tap()
    let field = app.descendants(matching: .any).matching(NSPredicate(format: "placeholderValue == %@", "Search Library")).firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    // #342: a query with no results first, on purpose. Its empty line's layout reached the sweep as the list's
    // height (72 pt), and the results sweep below then scrolled the list by itself and selected nine. Typed once
    // the field's motion (#341) has settled: a layout of the list's own that arrives after the empty line's puts
    // the right height back and hides the fault (two passes with the fix off, 2026-11-02).
    Thread.sleep(forTimeInterval: 1.5)
    field.typeText("zqxj")
    XCTAssertTrue(app.staticTexts["No documents found"].waitForExistence(timeout: 5), "A query with no results must show the empty line")
    if app.buttons["Clear text"].exists { app.buttons["Clear text"].tap() }
    field.typeText("Scroll Diag")
    // XCTest's typeText left "SDiag" here once (and "AShort" for "A Short" in LibrarySearchProbe, #339 verification):
    // read the field back, and type again after clearing when it does not match.
    if field.value as? String != "Scroll Diag" {
      print("[diag] typeText('Scroll Diag') left '\(field.value as? String ?? "?")'; clearing and typing again")
      if app.buttons["Clear text"].exists { app.buttons["Clear text"].tap() }
      field.typeText("Scroll Diag")
    }
    let firstResult = app.buttons["Scroll Diag 12 of 12, Library"]
    XCTAssertTrue(firstResult.waitForExistence(timeout: 5))
    // Results sit under the field, which sits under the title bar.
    let results = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label ENDSWITH %@", "Scroll Diag", ", Library")).allElementsBoundByIndex
      .filter { $0.exists && $0.frame.minY >= field.frame.maxY }
      .sorted { $0.frame.minY < $1.frame.minY }
    guard results.count >= 3 else { XCTFail("Need three visible global results"); return }
    Fingers.play(Fingers.pair(Fingers.line(CGPoint(x: center, y: results[0].frame.midY),
      CGPoint(x: center, y: results[2].frame.midY), start: 0.1, seconds: 0.8), lift: 1.1), name: "search-sweep-results", in: self)
    XCTAssertTrue(waitCount(3), "The same two-finger gesture must select exactly the three traversed results")
    XCTAssertEqual(field.value as? String, "Scroll Diag", "Selecting must keep the query")
    XCTAssertFalse(field.isEnabled, "Selecting must lock the field")
    XCTAssertFalse(app.buttons["Close"].isEnabled, "Selecting must lock the close control")
    XCTAssertTrue(app.buttons["Move selected"].exists)
    XCTAssertEqual(app.keyboards.count, 0, "Selecting must put the keyboard away")
    capture("search-sweep-selected-results")
    cancelSelection()
    XCTAssertEqual(field.value as? String, "Scroll Diag", "Leaving selection must keep the query")
    XCTAssertTrue(app.buttons["Close"].isEnabled)
    app.buttons["Close"].tap()
    XCTAssertTrue(field.waitForNonExistence(timeout: 5), "Close must take the field away")
  }

  /// #339: the list's content no longer grows to the viewport, so the blank space under a SHORT list must still begin a
  /// two-finger sweep. Inside `Search Folder` (one Document) the pair starts 300 pt under the row, in blank space, and
  /// moves up onto the row; the row must be the one selected. Then the same pair from the blank space of a one-result
  /// search (the field up, the keyboard away). Needs the staged Library (the Folder with the short test).
  func testSweepFromBlankSpaceBelowShortList() {
    app.terminate(); app.launchArguments = []; app.launch()
    let folder = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Folder, Search Folder,")).firstMatch
    XCTAssertTrue(folder.waitForExistence(timeout: 15), "Search Folder must be at the root")
    folder.tap()
    XCTAssertTrue(app.navigationBars["Search Folder"].waitForExistence(timeout: 5))
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND NOT label BEGINSWITH %@", "A Short Test of Reading Aloud", "Actions for")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5), "the Folder's one Document must be on show")
    let x = app.frame.midX
    let blank = row.frame.maxY + 300
    XCTAssertGreaterThan(app.frame.maxY - blank, 120, "the start must be on the screen, under the row")
    Fingers.play(Fingers.pair(Fingers.line(CGPoint(x: x, y: blank), CGPoint(x: x, y: row.frame.midY), start: 0.1, seconds: 0.8), lift: 1.1),
      name: "sweep-from-blank-below-the-row", in: self)
    XCTAssertTrue(waitCount(1), "A sweep that starts in the blank space under a short list must select the row it reaches")
    capture("sweep-from-blank-in-folder")
    cancelSelection()
    // The same from the blank space of a short list of results.
    app.navigationBars.firstMatch.buttons.firstMatch.tap()
    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5))
    app.buttons["Library actions"].tap()
    let search = app.buttons["Search"]
    XCTAssertTrue(search.waitForExistence(timeout: 5)); sleep(1); search.tap()
    let field = app.descendants(matching: .any).matching(NSPredicate(format: "placeholderValue == %@", "Search Library")).firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5)); field.typeText("Diag 12")
    if field.value as? String != "Diag 12" {
      if app.buttons["Clear text"].exists { app.buttons["Clear text"].tap() }
      field.typeText("Diag 12")
    }
    let result = app.buttons["Scroll Diag 12 of 12, Library"]
    XCTAssertTrue(result.waitForExistence(timeout: 5))
    let key = app.keyboards.buttons.matching(NSPredicate(format: "identifier == %@ OR label == %@", "Search", "search")).firstMatch
    if key.exists { key.tap() }
    XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
    let blankResults = result.frame.maxY + 300
    Fingers.play(Fingers.pair(Fingers.line(CGPoint(x: x, y: blankResults), CGPoint(x: x, y: result.frame.midY), start: 0.1, seconds: 0.8), lift: 1.1),
      name: "sweep-from-blank-below-the-result", in: self)
    XCTAssertTrue(waitCount(1), "The same from the blank space under a short list of results")
    capture("sweep-from-blank-in-results")
    cancelSelection()
    app.buttons["Close"].tap()
  }

  /// Record this gesture to inspect the native back-menu WHILE held. Releasing
  /// over the original button selects a row; move away before lifting instead.
  /// Prerequisite: Search Inner, staged by LibrarySearchProbe's named helper.
  func testHeldNestedBackMenu() {
    app.launchArguments = []; app.activate()
    let bar = app.navigationBars["Search Inner"]
    XCTAssertTrue(bar.waitForExistence(timeout: 10))
    let back = bar.buttons.firstMatch
    let point = CGPoint(x: back.frame.midX, y: back.frame.midY)
    var track = Fingers.hold(point, seconds: 1.8, start: 0.1)
    track += Fingers.line(point, CGPoint(x: app.frame.midX, y: app.frame.maxY - 120), start: 2.0, seconds: 0.4).dropFirst()
    Fingers.play([Fingers.finger(track, lift: 2.5)], name: "held-native-back-menu", in: self)
    XCTAssertTrue(bar.exists, "Release away must dismiss the menu without selecting an ancestor")
    back.tap()
    XCTAssertTrue(app.navigationBars["Search Outer"].waitForExistence(timeout: 5))
    app.navigationBars.firstMatch.buttons.firstMatch.tap()
    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5))
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

  /// #335: a sweep that ends inside its start row's press retention (about 20 pt above and 30 pt below the row) or back
  /// on that row keeps the start row chosen. Before the fix the lift fired the start row's press as well, which in
  /// selection mode took the row out again. Each case relaunches into the normal Library root and reads the rows'
  /// frames from the accessibility tree; it needs three root entries. A Library row is about 84 pt tall, so the next
  /// row's middle lies outside the start row's retention: `0-to-row1-mid` is the control that passed before the fix.
  func testShortSweepKeepsStartRow() {
    let port = ProcessInfo.processInfo.environment["OPENREADER_METRO_PORT"] ?? "8082"
    enum Stop { case mid(Int); case belowRow0(CGFloat) }
    let cases: [(String, [Stop], Int)] = [
      ("0-to-row1-mid", [.mid(0), .mid(1)], 2), ("0-to-below-row0-10", [.mid(0), .belowRow0(10)], 2), ("0-2-0", [.mid(0), .mid(2), .mid(0)], 1),
    ]
    for (name, stops, expected) in cases {
      app.terminate(); app.launchArguments = ["-RCT_jsLocation", "localhost:\(port)"]; app.launch()
      guard app.buttons["Library actions"].waitForExistence(timeout: 20) else { XCTFail("short-\(name): the Library did not open"); return }
      Thread.sleep(forTimeInterval: 1)
      let top = app.navigationBars.firstMatch.frame.maxY
      let rows = app.buttons.allElementsBoundByIndex
        .filter { $0.exists && !$0.label.hasPrefix("Actions for") && $0.frame.minY >= top && $0.frame.width > 250 && $0.frame.height > 60 && $0.frame.height < 160 }
        .map { (label: $0.label, frame: $0.frame) }
        .sorted { $0.frame.minY < $1.frame.minY }
      guard rows.count >= 3, selectedCount() == nil else { XCTFail("short-\(name): UNVERIFIED, need three root rows in normal mode, have \(rows.map { $0.label })"); return }
      let x = app.frame.midX
      let points = stops.map { stop -> CGPoint in
        switch stop {
        case .mid(let row): return CGPoint(x: x, y: rows[row].frame.midY)
        case .belowRow0(let offset): return CGPoint(x: x, y: rows[0].frame.maxY + offset)
        }
      }
      var track = Fingers.line(points[0], points[1], start: 0.1, seconds: 0.7)
      var end = 0.8
      if points.count == 3 { track += Fingers.line(points[1], points[2], start: 0.9, seconds: 0.5).dropFirst(); end = 1.4 }
      print("LIBRARY short-\(name): rows=\(rows.map { "\($0.label)@\($0.frame.minY)-\($0.frame.maxY)" }) gesture=\(points)")
      Fingers.play(Fingers.pair(track, lift: end + 0.1), name: "library-short-\(name)", in: self)
      Thread.sleep(forTimeInterval: 1.5)
      let count = selectedCount()
      let reader = app.buttons["More actions"].exists
      capture("library-short-\(name)")
      print("LIBRARY short-\(name): selected=\(count.map(String.init) ?? "none") expected=\(expected) readerOpened=\(reader)")
      XCTAssertFalse(reader, "short-\(name): the lift opened a Document")
      XCTAssertEqual(count, expected, "short-\(name)")
      // A one-finger tap after the sweep comes down afresh on row 2, which no case chose, and must add it: the sweep's
      // guard drops only the press of the sweep's own touch.
      guard count == expected, !reader else { continue }
      app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: rows[2].frame.midY)).tap()
      let tapped = waitCount(expected + 1, timeout: 4)
      print("LIBRARY short-\(name) tap row 2: selected=\(selectedCount().map(String.init) ?? "none") expected=\(expected + 1)")
      XCTAssertTrue(tapped, "short-\(name): a one-finger tap after the sweep must still choose row 2")
    }
  }

  /// Setup for the accessibility-activation check of #335, not a measurement: relaunches into the Library root, makes the short
  /// sweep row 0 to row 2 and back to row 0 (row 0 selected, selection mode on) and stops, so that no finger has come down on
  /// a row since the sweep: the state in which `SweepController.guard` drops a press that has no touch of its own. The caller
  /// then activates a row by accessibility, outside XCTest, and reads the header's `N selected` from the AX tree.
  func testLibrarySweepThenStay() {
    let port = ProcessInfo.processInfo.environment["OPENREADER_METRO_PORT"] ?? "8082"
    app.terminate(); app.launchArguments = ["-RCT_jsLocation", "localhost:\(port)"]; app.launch()
    guard app.buttons["Library actions"].waitForExistence(timeout: 20) else { return XCTFail("the Library did not open") }
    if app.buttons["Back"].waitForExistence(timeout: 2) {
      app.buttons["Back"].tap()
      guard app.buttons["Settings"].waitForExistence(timeout: 5) else { return XCTFail("UNVERIFIED: Back did not reach the Library root") }
    }
    Thread.sleep(forTimeInterval: 1)
    let top = app.navigationBars.firstMatch.frame.maxY
    let rows = app.buttons.allElementsBoundByIndex
      .filter { $0.exists && !$0.label.hasPrefix("Actions for") && $0.frame.minY >= top && $0.frame.width > 250 && $0.frame.height > 60 && $0.frame.height < 160 }
      .map { (label: $0.label, frame: $0.frame) }
      .sorted { $0.frame.minY < $1.frame.minY }
    guard rows.count >= 4, selectedCount() == nil else { return XCTFail("UNVERIFIED: need four root rows in normal mode, have \(rows.map { $0.label })") }
    let x = app.frame.midX
    let from = CGPoint(x: x, y: rows[0].frame.midY), far = CGPoint(x: x, y: rows[2].frame.midY)
    var track = Fingers.line(from, far, start: 0.1, seconds: 0.7)
    track += Fingers.line(far, from, start: 0.9, seconds: 0.5).dropFirst()
    print("LIBRARY stay: rows=\(rows.map { "\($0.label)@\($0.frame.minY)-\($0.frame.maxY)" }) gesture=[\(from), \(far), \(from)]")
    Fingers.play(Fingers.pair(track, lift: 1.5), name: "library-stay", in: self)
    let chosen = waitCount(1)
    print("LIBRARY stay: selected=\(selectedCount().map(String.init) ?? "none") expected=1 (row 0, no finger down on a row since the sweep)")
    XCTAssertTrue(chosen, "stay: the sweep leaves row 0 selected")
    capture("library-stay")
  }

  /// Fixture step, not a measurement: creates the root Folder `TapCheck` that `testPlainTapsOpenAfterSweeps` needs, through
  /// the real Create folder alert and XCTest's own `typeText` (the AXe-based `name-save.py` lost its typed text on iOS 27.0,
  /// pitfalls/typing-environment.md). Does nothing when the Folder is already there; leaves the alert's name readback and the
  /// new row in the artifacts. Never deletes or renames anything.
  func testCreateTapCheckFolderFixture() { createRootFolder("TapCheck") }

  /// The same fixture step for the root Folder `Scratch`, which every `launchAtRoot` test waits for as the first row it names.
  func testCreateScratchFolderFixture() { createRootFolder("Scratch") }

  func createRootFolder(_ name: String) {
    let port = ProcessInfo.processInfo.environment["OPENREADER_METRO_PORT"] ?? "8082"
    let existing = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Folder, \(name)")).firstMatch
    app.terminate(); app.launchArguments = ["-RCT_jsLocation", "localhost:\(port)"]; app.launch()
    guard app.buttons["Library actions"].waitForExistence(timeout: 20) else { return XCTFail("the Library did not open") }
    if existing.waitForExistence(timeout: 3) { print("FOLDER fixture: Folder \(name) already exists"); return }
    app.buttons["Library actions"].tap()
    let create = app.buttons["Create folder"]
    XCTAssertTrue(create.waitForExistence(timeout: 5), "the Library actions menu has no Create folder")
    create.tap()
    let field = app.textFields["Name"]
    XCTAssertTrue(field.waitForExistence(timeout: 8), "the Create folder alert has no Name field")
    field.tap()
    field.typeText(name)
    let read = field.value as? String ?? "?"
    print("FOLDER fixture: Create folder field reads \(read)")
    XCTAssertEqual(read, name, "native readback of the typed name")
    capture("create-folder-typed")
    guard read == name else { return }
    app.buttons["Create"].tap()
    let row = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Folder, \(name)")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 8), "the Library has no Folder \(name) row after Create")
    print("FOLDER fixture: created row \(row.label)")
    capture("create-folder-created")
  }

  /// #335 regression, the other direction: the sweep's press guard must never swallow an ordinary tap. Outside selection mode
  /// a one-finger tap on a Document opens the reader and a tap on a Folder opens it. Needs an empty root Folder named
  /// `TapCheck` beside the Documents (`testCreateTapCheckFolderFixture` makes it). Each case relaunches into the normal root: the taps on a
  /// fresh launch have no sweep before them; the others follow a two-finger sweep that selected rows and then Cancel, and
  /// tap the row the sweep began on, which is the row whose own press the guard dropped (a Document, a Folder, and a
  /// Document after a sweep that ended where it began). A last case taps both kinds of row in selection mode, where a tap
  /// toggles the row and opens nothing.
  func testPlainTapsOpenAfterSweeps() {
    let port = ProcessInfo.processInfo.environment["OPENREADER_METRO_PORT"] ?? "8082"
    struct Row { let label: String; let frame: CGRect; var isFolder: Bool { label.hasPrefix("Folder,") } }
    func rootRows() -> [Row] {
      let top = app.navigationBars.firstMatch.frame.maxY
      return app.buttons.allElementsBoundByIndex
        .filter { $0.exists && !$0.label.hasPrefix("Actions for") && $0.frame.minY >= top && $0.frame.width > 250 && $0.frame.height > 60 && $0.frame.height < 160 }
        .map { Row(label: $0.label, frame: $0.frame) }
        .sorted { $0.frame.minY < $1.frame.minY }
    }
    func launch() -> [Row]? {
      app.terminate(); app.launchArguments = ["-RCT_jsLocation", "localhost:\(port)"]; app.launch()
      guard app.buttons["Library actions"].waitForExistence(timeout: 20) else { XCTFail("UNVERIFIED: the Library did not open"); return nil }
      // A relaunch reopens the Folder browsed last (design 0069), which a Folder tap of an earlier phase leaves behind: go
      // up to the root first. Back is a toolbar button, not a row, so no finger comes down on the list before the case.
      if app.buttons["Back"].waitForExistence(timeout: 2) {
        app.buttons["Back"].tap()
        guard app.buttons["Settings"].waitForExistence(timeout: 5) else { XCTFail("UNVERIFIED: Back did not reach the Library root"); return nil }
      }
      Thread.sleep(forTimeInterval: 1)
      let rows = rootRows()
      guard selectedCount() == nil, rows.contains(where: { $0.isFolder && $0.label.contains("TapCheck") }), rows.filter({ !$0.isFolder }).count >= 2 else {
        XCTFail("UNVERIFIED: need the Folder TapCheck and two Documents at the root in normal mode, have \(rows.map { $0.label })"); return nil
      }
      return rows
    }
    func tap(_ row: Row) { app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: app.frame.midX, dy: row.frame.midY)).tap() }
    func sweep(_ points: [CGPoint], name: String) {
      var track = Fingers.line(points[0], points[1], start: 0.1, seconds: 0.7)
      var end = 0.8
      if points.count == 3 { track += Fingers.line(points[1], points[2], start: 0.9, seconds: 0.5).dropFirst(); end = 1.4 }
      Fingers.play(Fingers.pair(track, lift: end + 0.1), name: name, in: self)
    }
    func middle(_ row: Row) -> CGPoint { CGPoint(x: app.frame.midX, y: row.frame.midY) }
    /// The reader opened for a Document, or the empty Folder's page for the Folder.
    func opened(_ row: Row, timeout: TimeInterval = 8) -> Bool {
      row.isFolder ? app.staticTexts["No documents or folders yet"].waitForExistence(timeout: timeout) : app.buttons["More actions"].waitForExistence(timeout: timeout)
    }

    // Taps with no sweep before them.
    for kind in ["document", "folder"] {
      guard let rows = launch() else { return }
      let row = kind == "folder" ? rows.first(where: { $0.isFolder && $0.label.contains("TapCheck") })! : rows.first(where: { !$0.isFolder })!
      print("TAPCHECK library fresh-\(kind): rows=\(rows.map { "\($0.label)@\($0.frame.minY)-\($0.frame.maxY)" }) tapping \(row.label)")
      tap(row)
      let result = opened(row)
      capture("tap-fresh-\(kind)")
      print("TAPCHECK library fresh-\(kind): opened=\(result)")
      XCTAssertTrue(result, "fresh-\(kind): a one-finger tap with no sweep before it must open the \(kind)")
    }

    // Taps after a sweep and Cancel, on the row the sweep began on.
    for kind in ["document", "folder", "document-short-sweep"] {
      guard let rows = launch() else { return }
      let folder = rows.first(where: { $0.isFolder && $0.label.contains("TapCheck") })!, documents = rows.filter { !$0.isFolder }
      let start = kind == "folder" ? folder : documents[0]
      let next = kind == "folder" ? documents[0] : documents[1]
      let after = kind == "document-short-sweep" ? [middle(start), middle(next), middle(start)] : [middle(start), middle(next)]
      let expected = kind == "document-short-sweep" ? 1 : 2
      print("TAPCHECK library after-sweep-\(kind): rows=\(rows.map { "\($0.label)@\($0.frame.minY)-\($0.frame.maxY)" }) gesture=\(after)")
      sweep(after, name: "library-tap-\(kind)")
      let chosen = waitCount(expected)
      print("TAPCHECK library after-sweep-\(kind): selected=\(selectedCount().map(String.init) ?? "none") expected=\(expected)")
      XCTAssertTrue(chosen, "after-sweep-\(kind): the sweep must select \(expected)")
      guard chosen else { continue }
      cancelSelection()
      Thread.sleep(forTimeInterval: 0.5)
      guard let again = rootRows().first(where: { $0.label == start.label }) else { XCTFail("UNVERIFIED: the row \(start.label) is gone after Cancel"); return }
      tap(again)
      let result = opened(again)
      capture("tap-after-sweep-\(kind)")
      print("TAPCHECK library after-sweep-\(kind): cancelled, tapped \(again.label) opened=\(result)")
      XCTAssertTrue(result, "after-sweep-\(kind): a one-finger tap on the row the sweep began on, after Cancel, must open it")
    }

    // In selection mode a tap toggles the row, whichever kind it is, and opens nothing.
    guard let rows = launch() else { return }
    let folder = rows.first(where: { $0.isFolder && $0.label.contains("TapCheck") })!, documents = rows.filter { !$0.isFolder }
    sweep([middle(documents[0]), middle(documents[1])], name: "library-tap-selection")
    XCTAssertTrue(waitCount(2), "selection: the sweep must select 2")
    tap(folder)
    var toggled = waitCount(3)
    print("TAPCHECK library selection-folder: selected=\(selectedCount().map(String.init) ?? "none") expected=3 reader=\(app.buttons["More actions"].exists)")
    XCTAssertTrue(toggled, "selection: a tap on a Folder must add it")
    tap(folder)
    toggled = waitCount(2)
    print("TAPCHECK library selection-folder-again: selected=\(selectedCount().map(String.init) ?? "none") expected=2")
    XCTAssertTrue(toggled, "selection: a second tap on the Folder must take it out")
    XCTAssertFalse(app.buttons["More actions"].exists, "selection: no tap may open a Document")
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

/// #345 upgrade re-check on a 402×874 device using the EXISTING root rows (no
/// fixture creation, nothing moved or deleted): every coordinate is read from
/// the visible rows' frames. One finger must really scroll (the first row's
/// frame moves while the list settles) without entering selection; two fingers
/// must select exactly the three traversed rows; an upward re-sweep starting
/// on the checked rows must retract to exactly zero with selection mode still
/// on; Cancel must restore normal mode.
func testUpgradeOneFingerScrollAndTwoFingerCounts() {
  let port = ProcessInfo.processInfo.environment["OPENREADER_METRO_PORT"] ?? "8796"

  func visibleRows() -> [(label: String, frame: CGRect)] {
    let top = app.navigationBars.firstMatch.frame.maxY
    return app.buttons.allElementsBoundByIndex
      .filter { $0.exists && !$0.label.hasPrefix("Actions for") && $0.frame.minY >= top && $0.frame.width > 250 && $0.frame.height > 60 && $0.frame.height < 160 }
      .map { (label: $0.label, frame: $0.frame) }
      .sorted { $0.frame.minY < $1.frame.minY }
  }

  func launchAtRootFresh() -> [(label: String, frame: CGRect)]? {
    app.terminate()
    app.launchArguments = ["-RCT_jsLocation", "localhost:\(port)"]
    app.launch()
    guard app.buttons["Library actions"].waitForExistence(timeout: 25) else {
      XCTFail("upgrade: the Library did not open"); return nil
    }
    Thread.sleep(forTimeInterval: 1)
    let rows = visibleRows()
    guard rows.count >= 3, selectedCount() == nil else {
      XCTFail("upgrade: UNVERIFIED, need three root rows in normal mode, have \(rows.map { $0.label })"); return nil
    }
    return rows
  }

  // (a) ONE FINGER: real scroll displacement, selection stays off.
  guard let startRows = launchAtRootFresh() else { return }
  let before = startRows[0].frame
  let x = app.frame.midX
  let navBottom = app.navigationBars.firstMatch.frame.maxY
  let swipeFrom = CGPoint(x: x, y: max(startRows[1].frame.midY, startRows[0].frame.maxY))
  let swipeTo = CGPoint(x: x, y: max(swipeFrom.y - 300, navBottom + 40))
  print("PROBE-SCROLL from row0=\(before) swipe=\(swipeFrom)->\(swipeTo)")
  Fingers.play([Fingers.finger(Fingers.line(swipeFrom, swipeTo, start: 0.2, seconds: 0.6), lift: 1.0)],
               name: "upgrade-one-finger-scroll", in: self)
  Thread.sleep(forTimeInterval: 1.5)
  let scrolled = visibleRows()
  guard let after = scrolled.first?.frame else { return XCTFail("upgrade: no rows visible after the scroll") }
  print("PROBE-SCROLL to   row0=\(after) rows=\(scrolled.map { $0.label })")
  XCTAssertNotEqual(Int(after.minY), Int(before.minY), "upgrade: one finger did not scroll the list (first row did not move)")
  XCTAssertNil(selectedCount(), "upgrade: one-finger scroll entered selection mode")
  capture("upgrade-one-finger-scroll")

  // (b) TWO FINGERS over rows 0→2: exactly three selected.
  guard let rowsForSweep = launchAtRootFresh() else { return }
  let down = CGPoint(x: x, y: rowsForSweep[0].frame.midY)
  let far = CGPoint(x: x, y: rowsForSweep[2].frame.midY)
  print("PROBE-SWEEP down \(down)->\(far) rows=\(rowsForSweep.map { $0.label })")
  Fingers.play(Fingers.pair(Fingers.line(down, far, start: 0.1, seconds: 0.8), lift: 1.1),
               name: "upgrade-two-finger-down", in: self)
  let added = waitCount(3, timeout: 8)
  let addedCount = selectedCount()
  print("PROBE-SWEEP selected after down=\(addedCount.map(String.init) ?? "none") expected=3")
  capture("upgrade-two-finger-down")
  XCTAssertTrue(added, "upgrade: the two-finger sweep did not select exactly 3 rows (header read \(addedCount.map(String.init) ?? "none"))")

  // (c) REVERSE/RETRACT: an upward sweep starting on the checked rows retracts to zero,
  // still inside selection mode. In selection mode the rows are labeled elements of
  // any kind carrying a checkbox value (the Buttons become Others), so read any-kind
  // elements shaped like rows instead of Buttons only.
  func visibleSelectedRows() -> [(label: String, frame: CGRect)] {
    let top = app.navigationBars.firstMatch.frame.maxY
    return app.descendants(matching: .any).allElementsBoundByIndex
      .filter { $0.exists && !$0.label.isEmpty && !$0.label.hasPrefix("Actions for") && $0.frame.minY >= top && $0.frame.width > 250 && $0.frame.height > 60 && $0.frame.height < 160 }
      .map { (label: $0.label, frame: $0.frame) }
      .sorted { $0.frame.minY < $1.frame.minY }
  }
  let selectedRows = visibleSelectedRows()
  guard selectedRows.count >= 2 else { return XCTFail("upgrade: rows vanished inside selection mode (any-kind read)") }
  let up = CGPoint(x: x, y: selectedRows[0].frame.midY)
  let from = CGPoint(x: x, y: selectedRows[min(2, selectedRows.count - 1)].frame.midY)
  print("PROBE-SWEEP retract \(from)->\(up)")
  Fingers.play(Fingers.pair(Fingers.line(from, up, start: 0.1, seconds: 0.8), lift: 1.1),
               name: "upgrade-two-finger-retract", in: self)
  let retracted = waitCount(0, timeout: 8)
  let retractedCount = selectedCount()
  print("PROBE-SWEEP selected after retract=\(retractedCount.map(String.init) ?? "none") expected=0 (still in selection mode)")
  capture("upgrade-two-finger-retract")
  XCTAssertTrue(retracted, "upgrade: the reverse sweep did not retract the selection to exactly 0 (header read \(retractedCount.map(String.init) ?? "none"))")
  XCTAssertNotNil(retractedCount, "upgrade: reaching zero must stay inside selection mode")

  // (d) CANCEL restores normal mode.
  cancelSelection()
  XCTAssertTrue(selectedCount() == nil, "upgrade: Cancel left selection mode on")
}
}
