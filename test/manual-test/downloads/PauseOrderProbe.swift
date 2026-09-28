import ObjectiveC
import XCTest

/// Live #56 checks the two-chapter download fixture cannot show: a chapter
/// tapped out of list order still written top-down, pausing the chapter
/// being written starting the next one, the mixed-state label, the ring in
/// Manage downloads pausing only the chapter it belongs to, a two-finger
/// sweep passing over ring rows unchanged (#57), adding a chapter while
/// another stays paused, and a paused chapter surviving an app restart while
/// the rest of the download continues untouched. Uses the five-chapter Pause
/// Order Fixture (`test/manual-test/fixtures/pause-order-fixture.ts`), added once by
/// hand through the walkthrough harness; this probe does not add it.
///
/// A ring's accessibility label carries only halted or not, no fraction, so
/// it cannot show which in-task chapter is actually being written this
/// instant — only a completed chapter is distinguishable (a check, not a
/// ring). So each check below uses whichever signal is actually observable:
/// order is read from **completion order** (chapters One and Two, untouched,
/// racing to a finish only their list position can decide); pausing is read
/// from a ring's own halted/not label, tapped as soon as possible after it
/// appears (chapter Three carries extra sentences to widen that window).
///
/// Two independent methods, like `DownloadRingProbe.testReopenDownloadDrawer`:
/// `testOrderMixedAddAndRingSweep` leaves chapter three paused and chapter
/// five mid-flight or queued, for a **host-level** `xcrun simctl terminate` +
/// `launch -RCT_jsLocation` between runs (an in-test `app.terminate()` drops
/// that launch argument, README Pitfalls, "Metro and the bundle"); then
/// `testOrderAfterRestart` reopens the same drawer and finishes the download.
final class PauseOrderProbe: XCTestCase {
  let title = "Pause Order Fixture"

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func type(_ text: String, into field: XCUIElement) {
    field.tap()
    field.typeText(text)
  }

  /// Polls `condition` until it holds or `timeout` passes.
  func until(_ timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    repeat {
      if condition() { return true }
      Thread.sleep(forTimeInterval: 0.2)
    } while Date() < deadline
    return false
  }

  /// Same touches as `DownloadRingProbe.configureFishIfNeeded`; idempotent
  /// against a provider a previous run already enabled.
  func configureFishIfNeeded(_ app: XCUIApplication) throws {
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
    app.buttons["Settings"].tap()
    let providersRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Providers'")).firstMatch
    XCTAssertTrue(providersRow.waitForExistence(timeout: 5))
    providersRow.tap()
    let fishRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Fish Audio,'")).firstMatch
    XCTAssertTrue(fishRow.waitForExistence(timeout: 5))
    let alreadyEnabled = fishRow.label.contains("enabled") && !fishRow.label.contains("disabled")
    fishRow.tap()
    if !alreadyEnabled {
      let keyPath = "/tmp/openreader-fish-key.txt"
      let key = (try? String(contentsOfFile: keyPath, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      XCTAssertFalse(key.isEmpty, "Fish API key file was empty or unreadable at \(keyPath)")
      let field = app.textFields["API key"].exists ? app.textFields["API key"] : app.secureTextFields["API key"]
      XCTAssertTrue(field.waitForExistence(timeout: 5), "API key field not found")
      type(key, into: field)
      let enableSwitch = app.switches["Enable Fish Audio"]
      XCTAssertTrue(enableSwitch.waitForExistence(timeout: 3))
      enableSwitch.tap()
      XCTAssertTrue(app.staticTexts["Enabled"].waitForExistence(timeout: 20), "Fish Audio did not report Enabled after the connection check")
    }
    let anyLibraryRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Actions for '")).firstMatch
    var backs = 0
    while backs < 4 && !anyLibraryRow.exists {
      let back = app.navigationBars.buttons.element(boundBy: 0)
      guard back.exists else { break }
      back.tap()
      backs += 1
      Thread.sleep(forTimeInterval: 0.6)
    }
    if !anyLibraryRow.waitForExistence(timeout: 2) {
      app.terminate(); app.launch()
      _ = anyLibraryRow.waitForExistence(timeout: 20)
    }
  }

  /// React Native's "Open debugger to view warnings." LogBox banner overlays
  /// the drawer's footer almost exactly (measured 2026-09-24: banner frame
  /// `{10, 787.7, 382, 48}` against "Download selected"'s `{20, 792.7, 362,
  /// 49.3}`), so a tap aimed at that button lands on the banner instead —
  /// the same class of failure the README's Pitfalls document for the Play
  /// button. A restart is the only confirmed clear (README, Pitfalls,
  /// XCTest); this device's container plist now holds the correct
  /// `RCT_jsLocation`, so an in-test relaunch is safe here.
  func clearWarningBannerIfPresent(_ app: XCUIApplication) throws {
    let banner = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH '!, Open debugger'")).firstMatch
    guard banner.exists else { return }
    print("WARNING BANNER PRESENT: relaunching to clear it before it can swallow a tap on the footer")
    app.terminate(); app.launch()
    try openFixtureDownload(app)
  }

  /// From Library, open the fixture and its Download drawer, choosing a Fish
  /// voice first if the reader offers one (same touches as
  /// `DownloadRingProbe.chooseVoiceIfNeeded`).
  func openFixtureDownload(_ app: XCUIApplication) throws {
    if app.buttons["Close Download"].exists {
      app.buttons["Close Download"].tap()
      _ = until(5) { !app.buttons["Close Download"].exists }
    }
    let anyLibraryRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Actions for '")).firstMatch
    var backs = 0
    while backs < 5 && !anyLibraryRow.exists {
      let back = app.navigationBars.buttons.element(boundBy: 0)
      if back.exists { back.tap() } else if app.buttons["Back"].exists { app.buttons["Back"].tap() }
      backs += 1
      Thread.sleep(forTimeInterval: 0.6)
    }
    XCTAssertTrue(anyLibraryRow.waitForExistence(timeout: 10), "Never reached the Library")
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title + ",")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5), "\(title) not in the Library — was it added via the harness?")
    row.tap()
    let choose = app.buttons["Choose a Voice"]
    if choose.waitForExistence(timeout: 5) {
      choose.tap()
      let heading = app.staticTexts.matching(NSPredicate(format: "label == 'Voice'")).firstMatch
      XCTAssertTrue(heading.waitForExistence(timeout: 5))
      let anyVoice = app.buttons.matching(NSPredicate(format: "label CONTAINS ' - '")).firstMatch
      XCTAssertTrue(anyVoice.waitForExistence(timeout: 15), "No Fish voice rows appeared")
      anyVoice.tap()
      app.buttons["Close Voice"].tap()
      XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
    }
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 10))
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 3))
    app.buttons["Download"].tap()
    XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label ENDSWITH 'chapters downloaded'")).firstMatch.waitForExistence(timeout: 20))
  }

  /// The ring on the row titled `chapterTitle` (`DownloadRingProbe.ring(beside:)`).
  func ring(beside chapterTitle: String, _ app: XCUIApplication) -> XCUIElement? {
    let names = app.staticTexts.matching(NSPredicate(format: "label == %@", chapterTitle))
    let rings = app.buttons.matching(NSPredicate(format: "label == 'Pause download' OR label == 'Resume download'"))
    for n in 0..<names.count {
      let name = names.element(boundBy: n).frame
      for r in 0..<rings.count {
        let ringElement = rings.element(boundBy: r)
        if abs(ringElement.frame.midY - name.midY) < 22 && ringElement.frame.minX > name.minX { return ringElement }
      }
    }
    return nil
  }

  /// The checkbox row titled `chapterTitle`, before it belongs to any task.
  func checkbox(_ chapterTitle: String, _ app: XCUIApplication) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", chapterTitle)).firstMatch
  }

  func downloadSelectedButton(_ app: XCUIApplication) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Download selected ('")).firstMatch
  }

  /// The count in "Download selected (N)". The button always exists once the
  /// drawer is open, N included when N is 0, so a sweep that should select
  /// nothing must be read from this count, not from the button's existence
  /// (TwoFingerProbe.swift's `chosenCount`, the same fix, same day).
  func chosenCount(_ app: XCUIApplication) -> Int {
    let button = downloadSelectedButton(app)
    guard button.exists, let open = button.label.firstIndex(of: "("), let close = button.label.firstIndex(of: ")") else { return -1 }
    return Int(button.label[button.label.index(after: open)..<close]) ?? -1
  }

  // MARK: - Two fingers, played through XCUIAutomation's private event synthesis (#57, TwoFingerProbe.swift).
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

  func downloaded(_ chapterTitle: String, _ app: XCUIApplication) -> Bool {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "\(chapterTitle), downloaded")).firstMatch.exists
  }

  /// Polls until every title in `candidates` is downloaded, returning the
  /// order they finished in (empty entries omitted if `timeout` passes first).
  func completionOrder(_ candidates: [String], _ app: XCUIApplication, timeout: TimeInterval) -> [String] {
    var order: [String] = []
    _ = until(timeout) {
      for c in candidates where !order.contains(c) {
        if self.downloaded(c, app) { order.append(c) }
      }
      return order.count == candidates.count
    }
    return order
  }

  /// #56-3: chapters One and Two, tapped in reverse order and left to run
  /// untouched, finish top-down (One first) regardless.
  func testOrderMixedAddAndRingSweep() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    try configureFishIfNeeded(app)
    try openFixtureDownload(app)
    try clearWarningBannerIfPresent(app)

    for title in ["Order Chapter One", "Order Chapter Two", "Order Chapter Three", "Order Chapter Four", "Order Chapter Five"] {
      XCTAssertTrue(checkbox(title, app).waitForExistence(timeout: 5), "\(title) checkbox not found")
    }
    capture("00-five-chapters", app)
    XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH '!, Open debugger'")).firstMatch.exists,
                   "The warning banner is still covering the footer — see it in 00-five-chapters")

    // Tap chapter two, then chapter one: reversed list order. Neither is
    // touched again, so completion order alone proves list order won, not tap
    // order — no fraction/progress signal is needed for this one.
    checkbox("Order Chapter Two", app).tap()
    checkbox("Order Chapter One", app).tap()
    var start = downloadSelectedButton(app)
    XCTAssertEqual(start.label, "Download selected (2)")
    start.tap()
    let orderProof = completionOrder(["Order Chapter One", "Order Chapter Two"], app, timeout: 40)
    capture("01-order-proof-done", app)
    XCTAssertEqual(orderProof, ["Order Chapter One", "Order Chapter Two"],
                   "Chapter one (tapped second) must finish before chapter two (tapped first)")

    // #56-1 / #56-5 / #56-8 / #57-8: chapters four, then three (reversed
    // again). Three carries extra sentences, so there is a window to pause it
    // before it finishes on its own — pause as soon as its ring appears.
    try clearWarningBannerIfPresent(app)
    checkbox("Order Chapter Four", app).tap()
    checkbox("Order Chapter Three", app).tap()
    start = downloadSelectedButton(app)
    XCTAssertEqual(start.label, "Download selected (2)")
    start.tap()
    XCTAssertTrue(until(10) { self.ring(beside: "Order Chapter Three", app) != nil }, "Chapter three never showed a ring")
    guard let threeRingAtStart = ring(beside: "Order Chapter Three", app) else {
      XCTFail("Chapter three's ring disappeared before it could be read"); return
    }
    threeRingAtStart.tap()
    XCTAssertTrue(until(5) { self.ring(beside: "Order Chapter Three", app)?.label == "Resume download" }, "Chapter three's ring did not pause")
    capture("02-chapter-three-paused", app)

    // Mixed state, checked before chapter four can also finish (it has no
    // pause applied, so it is "going on" for as long as it is still unfinished).
    if ring(beside: "Order Chapter Four", app) != nil {
      let footer = app.buttons.matching(NSPredicate(format: "label == 'Pause all' OR label == 'Resume all'")).firstMatch
      XCTAssertEqual(footer.label, "Pause all", "One chapter paused, another going on: still Pause all, not Resume all")
      capture("03-mixed-state-pause-all", app)
    } else {
      print("MIXED STATE LABEL CHECK SKIPPED: chapter four already finished before it could be read")
    }

    // #56-8: in Manage downloads, the ring on the chapter being written pauses that chapter alone, and Delete all saved audio stays opposite it.
    app.buttons["Manage downloads"].tap()
    // Tolerant like `DownloadRingProbe`'s own race allowance ("a fast
    // connection can finish the second chapter before Pause all is
    // tapped"): chapter four can complete during this navigation, at any of
    // the three points its ring is re-read below, not only before it.
    if let manageRing = ring(beside: "Order Chapter Four", app) {
      manageRing.tap()
      let paused = until(5) { self.ring(beside: "Order Chapter Four", app)?.label == "Resume download" }
      let stillThere = ring(beside: "Order Chapter Four", app) != nil
      if paused {
        XCTAssertFalse(app.buttons["Resume all"].exists, "Manage downloads keeps Delete all saved audio in that place, not Resume all")
        capture("04-manage-ring-paused-chapter-four", app)
        if let resumeRing = ring(beside: "Order Chapter Four", app) {
          resumeRing.tap()
          _ = until(5) { self.ring(beside: "Order Chapter Four", app)?.label == "Pause download" }
          capture("05-manage-ring-resumed-chapter-four", app)
        }
      } else if !stillThere {
        print("MANAGE RING CHECK PARTIAL: chapter four finished right after its Manage ring was tapped, before the pause could be read")
        capture("04-manage-ring-raced-to-completion", app)
      } else {
        XCTFail("Manage's own ring did not pause chapter four, and chapter four is still unfinished — a real defect, not a race")
      }
    } else {
      print("MANAGE RING CHECK SKIPPED: chapter four already finished before the Manage downloads dip")
      capture("04-manage-no-ring-chapter-four-already-done", app)
    }
    app.buttons["Back to downloads"].tap()
    XCTAssertTrue(until(5) { app.buttons["Manage downloads"].exists }, "Did not return to the plain download view")

    // #57-8 (ring case): a two-finger sweep across whatever ring rows exist now changes nothing.
    var sweepRows: [(String, XCUIElement)] = []
    if let threeRing = ring(beside: "Order Chapter Three", app) { sweepRows.append(("Order Chapter Three", threeRing)) }
    if let fourRing = ring(beside: "Order Chapter Four", app) { sweepRows.append(("Order Chapter Four", fourRing)) }
    if sweepRows.count >= 1 {
      let before = sweepRows.map { ($0.0, $0.1.label) }
      let beforeCount = chosenCount(app)
      let fromRow = sweepRows.first!.1.frame
      let toRow = sweepRows.last!.1.frame
      let from = CGPoint(x: fromRow.midX - 90, y: fromRow.midY)
      let to = CGPoint(x: toRow.midX - 90, y: toRow.midY)
      Fingers.play(Fingers.pair(Fingers.line(from, to, start: 0, seconds: 0.8), lift: 1.0), name: "ring-sweep", in: self)
      Thread.sleep(forTimeInterval: 0.8)
      XCTAssertEqual(chosenCount(app), beforeCount, "A sweep across ring rows must select nothing")
      for (chapterTitle, label) in before {
        XCTAssertEqual(ring(beside: chapterTitle, app)?.label, label, "The sweep must not change \(chapterTitle)'s ring")
      }
      capture("06-ring-sweep-unaffected", app)
    } else {
      print("RING SWEEP CHECK SKIPPED: no ring rows left (both chapters already finished)")
    }

    // #56-1, completed: chapter four finishes on its own while chapter three
    // stays paused throughout — pausing the chapter being written let the
    // next one proceed to completion.
    XCTAssertTrue(until(30) { self.downloaded("Order Chapter Four", app) }, "Chapter four never finished while chapter three was paused")
    XCTAssertEqual(ring(beside: "Order Chapter Three", app)?.label, "Resume download", "Chapter three must still be paused once chapter four finished")
    capture("07-chapter-four-done-chapter-three-still-paused", app)

    // #56-6: add chapter five while chapter three is still paused. A
    // relaunch here is safe for the download itself — its state is
    // persisted and reloaded on launch (this is exactly what #56-7 checks
    // separately) — even though it is disruptive to reach for here.
    try clearWarningBannerIfPresent(app)
    checkbox("Order Chapter Five", app).tap()
    let addButton = downloadSelectedButton(app)
    XCTAssertEqual(addButton.label, "Download selected (1)")
    addButton.tap()
    XCTAssertTrue(until(5) { self.ring(beside: "Order Chapter Five", app) != nil }, "Chapter five should show a ring once added to the download")
    XCTAssertEqual(ring(beside: "Order Chapter Three", app)?.label, "Resume download", "Adding a chapter must not resume the one the owner paused")
    capture("08-chapter-five-added-chapter-three-still-paused", app)

    // Leave chapter three paused and chapter five mid-flight or queued: state for the host-level restart.
    capture("09-before-restart", app)
  }

  /// Reopens the fixture's Download drawer after a host-level
  /// `simctl terminate` + `launch -RCT_jsLocation` (never an in-test
  /// `app.terminate()`/`app.launch()`, which drops that launch argument).
  /// #56-7: the chapter the owner paused is still paused, and the rest of the
  /// download continued without a tap. Finishes the download cleanly.
  func testOrderAfterRestart() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    try openFixtureDownload(app)
    capture("10-reopened-after-restart", app)

    XCTAssertEqual(ring(beside: "Order Chapter Three", app)?.label, "Resume download", "Chapter three must still be paused after the restart")

    // #56-2: if chapter five (below chapter three) is still being written at
    // this point, resume chapter three now and confirm five's ring is
    // unaffected — resuming a chapter above the one being written must not
    // interrupt it. Opportunistic: if five already finished by the time the
    // app reconnected, this falls through to resuming three directly, and
    // the "did not interrupt" half is left to the code reading and unit
    // tests the README already cites for this (`scheduler.test.ts`,
    // `runtime-pausing.test.ts`).
    if let fiveRingBefore = ring(beside: "Order Chapter Five", app) {
      let fiveLabelBefore = fiveRingBefore.label
      try XCTUnwrap(ring(beside: "Order Chapter Three", app)).tap()
      if let fiveRingAfter = ring(beside: "Order Chapter Five", app) {
        XCTAssertEqual(fiveRingAfter.label, fiveLabelBefore, "Resuming chapter three must not interrupt chapter five, which was already being written")
        print("RESUME WHILE WRITING: chapter five's ring was unaffected by resuming chapter three above it")
      } else {
        print("RESUME WHILE WRITING: chapter five finished in the instant between reading its ring and resuming chapter three — inconclusive, not a failure")
      }
      capture("11-resumed-chapter-three-while-five-active", app)
    }

    // The rest of the download continues by itself: poll for chapter five to finish, no tap involved.
    let restCompleted = until(60) { self.downloaded("Order Chapter Five", app) }
    capture("11-rest-continued-after-restart", app)
    XCTAssertTrue(restCompleted, "Chapter five did not finish on its own after the restart")

    // Resume chapter three (if not already, from the opportunistic branch above) and finish the download, leaving nothing paused or running.
    if ring(beside: "Order Chapter Three", app) != nil { try XCTUnwrap(ring(beside: "Order Chapter Three", app)).tap() }
    XCTAssertTrue(until(30) { self.downloaded("Order Chapter Three", app) }, "Chapter three never finished after being resumed")
    XCTAssertTrue(app.staticTexts["5 chapters downloaded"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["Pause all"].exists)
    XCTAssertFalse(app.buttons["Resume all"].exists)
    capture("12-final-all-five-downloaded", app)
  }
}
