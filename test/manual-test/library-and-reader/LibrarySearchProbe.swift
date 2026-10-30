import XCTest

/// #332 Library Search, native-touch acceptance at the first checkpoint.
/// Real XCUITest touches only; no playback, no downloads, no settings changes.
/// The contract (design 0090) is: no visible field or magnifier during
/// ordinary browsing; tap on the field begins input; `...` > Search goes
/// straight to input.
final class LibrarySearchProbe: XCTestCase {
  private let fixturePrefix = "A Short Test of Reading Aloud,"

  private func launch() -> XCUIApplication {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()
    // The fixture may live inside a Folder once matrix staging moved it;
    // wait for any Document row rather than the root fixture.
    let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10), "a Document must be in the Library already")
    return app
  }

  private func shot(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  private func tree(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(string: app.debugDescription)
    attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
  }

  private func searchField(_ app: XCUIApplication) -> XCUIElement {
    // Match the stable placeholder, not a TextField/SearchField type that
    // UIKit changes during focus. The query re-resolves across that transition.
    app.descendants(matching: .any).matching(NSPredicate(format: "placeholderValue == %@", "Search Library")).firstMatch.firstMatch
  }

  /// Bounded input readiness. Absence is ALWAYS a test failure, never an
  /// early return that turns an unexecuted assertion sequence into a pass.
  @discardableResult
  private func waitForSearchField(_ app: XCUIApplication, timeout: TimeInterval, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement? {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      let field = searchField(app)
      if field.exists { return field }
      usleep(200_000)
    }
    XCTContext.runActivity(named: "wait for the Library search field (\(timeout)s)") { activity in
      let summary = XCTAttachment(string: "no SearchField or placeholder TextField appeared; tree follows")
      summary.name = "search-field-absent"; summary.lifetime = .keepAlways; add(summary)
      let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
      image.name = "search-field-absent-shot"; image.lifetime = .keepAlways; add(image)
    }
    XCTFail("Library search field did not appear within \(timeout)s", file: file, line: line)
    return nil
  }

  /// Frame-only observation of the ALREADY-RUNNING app (no launch, no
  /// touches): pairs with the CDP-driven scroll for authoritative XCUITest
  /// frames when the snapshot bridge answers with an empty tree.
  func testObserveRunningLibraryFrames() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    let field = searchField(app)
    let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5) || row.exists, "app must be foregrounded on the Library")
    let line = "observe-running: field exists=\(field.exists) hittable=\(field.isHittable) frame=\(field.exists ? NSCoder.string(for: field.frame) : "none") | topRow exists=\(row.exists) hittable=\(row.isHittable) frame=\(row.exists ? NSCoder.string(for: row.frame) : "none")"
    print("[diag] \(line)")
    let attachment = XCTAttachment(string: line)
    attachment.name = "observe-running-frames"; attachment.lifetime = .keepAlways; add(attachment)
    shot("observe-running")
  }

  /// Contract: a cold ordinary Library shows NO visible/hittable search field
  /// or magnifier, reserves no search-field space in the header, and does not
  /// clip the first Document. AX presence alone is not a violation — an
  /// offscreen native control may stay in the tree — so every check is on
  /// frames, hittability and layout. On beta1 (6f73fad) this failed with a
  /// standing hittable field at {{16, 117}, {370, 44}} and the row pushed to
  /// y 188; those raw runs are the red evidence this must keep producing.
  func testColdLibraryShowsNoSearchField() {
    let app = launch()
    let field = searchField(app)
    // Query order is not visual order. Include clipped/offscreen rows and
    // choose the smallest frame y, rather than a firstMatch that can select
    // the second Document while the first is hidden under the bar.
    // The staged Library now leads with a Folder row: the first ENTRY
    // (Folder or Document) carries the no-reserved-space and unclipped
    // checks, and the first DOCUMENT is additionally required to be present
    // below it. Never treat the Folder row as reserved search space.
    let documents = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).allElementsBoundByIndex
    let folders = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Folder,")).allElementsBoundByIndex
    let entries = (documents + folders).filter { $0.exists }
    guard let firstEntry = entries.min(by: { $0.frame.minY < $1.frame.minY }) else {
      XCTFail("The staged Library must contain entries")
      return
    }
    let firstDocument = documents.filter { $0.exists }.min(by: { $0.frame.minY < $1.frame.minY })
    tree(app, "cold-library-tree")
    shot("cold-library")
    if field.exists {
      // A collapsed navigation bar CLIPS the field, so window frames prove
      // nothing: judge visibility by hittability AND intersection with the
      // navigation bar's own visible frame.
      let bar = app.navigationBars.firstMatch
      let clipped = bar.exists ? bar.frame.intersection(field.frame).height < 10 : field.frame.maxY < 10
      XCTAssertFalse(field.isHittable, "Contract 0090: the search field must not be hittable during ordinary browsing (frame: \(NSCoder.string(for: field.frame)), bar: \(bar.exists ? NSCoder.string(for: bar.frame) : "none"))")
      XCTAssertTrue(clipped, "Contract 0090: the search field must be clipped by the collapsed navigation bar (field: \(NSCoder.string(for: field.frame)), bar: \(bar.exists ? NSCoder.string(for: bar.frame) : "none"))")
    }
    XCTAssertTrue(firstEntry.exists, "First entry must be present")
    XCTAssertLessThan(firstEntry.frame.minY, 170, "Contract 0090: the header must not reserve search-field space (first entry minY \(firstEntry.frame.minY); beta1/beta2's standing field pushed the first row to 188)")
    let barForClip = app.navigationBars.firstMatch
    // Judge the actual topmost row against the visible navigation bar, not
    // just the window. Keep the screenshot as independent visual evidence.
    if barForClip.exists {
      XCTAssertGreaterThanOrEqual(firstEntry.frame.minY, barForClip.frame.maxY - 4, "Contract 0090: the first entry must not be clipped under the navigation bar (entry minY \(firstEntry.frame.minY), bar maxY \(barForClip.frame.maxY))")
    }
    XCTAssertGreaterThanOrEqual(firstEntry.frame.minY, 0, "The first entry must not be clipped at the top")
    XCTAssertLessThanOrEqual(firstEntry.frame.maxY, app.frame.maxY, "The first entry must not be clipped at the bottom")
    if let document = firstDocument {
      XCTAssertGreaterThanOrEqual(document.frame.minY, barForClip.frame.maxY - 4, "Contract 0090: the first Document must not be clipped under the navigation bar (doc minY \(document.frame.minY))")
      XCTAssertGreaterThanOrEqual(document.frame.minY, 0, "First Document must not be clipped at the top")
      XCTAssertLessThanOrEqual(document.frame.maxY, app.frame.maxY, "First Document must not be clipped at the bottom")
    }
    XCTAssertEqual(app.keyboards.count, 0, "Cold ordinary browsing must have no keyboard")
  }

  /// Parent follow-up diagnostic (2026-10-28), H1/H2/H3 discrimination on the
  /// unchanged beta1 build. NO acceptance assertion here: record frames of the
  /// search field and the first Document row across a real swipe-up, a settle
  /// wait and a pull-down, with screenshots. Run against the ONE-ROW Library.
  /// `exists` alone is not visibility: every record is frame + hittable.
  func testDiagnosticOneRowScrollFrames() {
    var lines: [String] = []
    let app = launch()
    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5), "list must exist")
    lines.append(self.observe(app, "a0-cold"))
    self.drag(list, fromY: 0.7, toY: 0.2)
    sleep(1)
    lines.append(self.observe(app, "a1-after-swipe-up"))
    sleep(2)
    lines.append(self.observe(app, "a2-settled"))
    self.drag(list, fromY: 0.2, toY: 0.7)
    sleep(1)
    lines.append(self.observe(app, "a3-after-pull-down"))
    lines.append("keyboards.count after pull-down: \(app.keyboards.count)")
    let attachment = XCTAttachment(string: lines.joined(separator: "\n"))
    attachment.name = "one-row-frames"; attachment.lifetime = .keepAlways; add(attachment)
    tree(app, "one-row-final-tree")
  }

  /// Same diagnostic with real scroll range (13 staged rows). Discriminates
  /// insufficient scroll range (one-row result) from a disconnected header:
  /// after the list genuinely scrolls (first row out of view), does the field
  /// collapse, stay put, or re-expand (H1 / H2 / H3)?
  func testDiagnosticLongListScrollFrames() {
    var lines: [String] = []
    let app = launch()
    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5), "list must exist")
    lines.append(self.observe(app, "b0-cold"))
    self.drag(list, fromY: 0.8, toY: 0.1)
    sleep(1)
    lines.append(self.observe(app, "b1-after-drag-1"))
    self.drag(list, fromY: 0.8, toY: 0.1)
    sleep(1)
    lines.append(self.observe(app, "b2-after-drag-2"))
    sleep(2)
    lines.append(self.observe(app, "b3-settled"))
    self.drag(list, fromY: 0.1, toY: 0.8)
    sleep(1)
    lines.append(self.observe(app, "b4-after-pull-down"))
    lines.append("keyboards.count after pull-down: \(app.keyboards.count)")
    let attachment = XCTAttachment(string: lines.joined(separator: "\n"))
    attachment.name = "long-list-frames"; attachment.lifetime = .keepAlways; add(attachment)
    tree(app, "long-list-final-tree")
  }

  private func drag(_ list: XCUIElement, fromY: CGFloat, toY: CGFloat) {
    // Keep the established flick primitive. Slow and coordinate diagnostics
    // are separate; a revealed field without keyboard/Close is not a commit.
    if toY < fromY {
      list.swipeUp(velocity: .fast)
    } else {
      list.swipeDown(velocity: .fast)
    }
  }

  /// One evidence line: field and first-row existence, hit-testability and
  /// exact frames in screen points, plus a named screenshot.
  private func observe(_ app: XCUIApplication, _ label: String) -> String {
    let field = searchField(app)
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", fixturePrefix)).firstMatch
    let fieldFrame = field.exists ? NSCoder.string(for: field.frame) : "none"
    let rowFrame = row.exists ? NSCoder.string(for: row.frame) : "none"
    let line = "\(label): field exists=\(field.exists) hittable=\(field.isHittable) frame=\(fieldFrame) | firstRow exists=\(row.exists) hittable=\(row.isHittable) frame=\(rowFrame)"
    print("[diag] \(line)")
    shot(label)
    return line
  }

  /// Record this real slow gesture to inspect blur progression, not just its
  /// final frame. The full pull is a delivery control for the short pull.
  func testPullPreviewThreshold() {
    let app = launch()
    let bar = app.navigationBars.firstMatch
    let originTitle = bar.identifier
    let point = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(
      dx: app.frame.width / 2, dy: bar.frame.maxY - app.frame.minY + 100
    ))
    let velocity = XCUIGestureVelocity(rawValue: 40)
    point.press(forDuration: 0.01, thenDragTo: point.withOffset(CGVector(dx: 0, dy: 20)),
                withVelocity: velocity, thenHoldForDuration: 0.3)
    sleep(1)
    let samePage = app.navigationBars.firstMatch.identifier == originTitle
    XCTAssertTrue(samePage, "A short pull must not navigate into the touched row")
    guard samePage else { shot("short-pull-wrong-page"); return }
    let field = searchField(app)
    let hidden = !field.exists || field.frame.maxY < 10 ||
      (bar.exists && bar.frame.intersection(field.frame).height < 10)
    XCTAssertTrue(hidden, "Releasing a short pull must not leave a half-open field")
    XCTAssertFalse(bar.buttons["Close"].exists)
    XCTAssertEqual(app.keyboards.count, 0)
    shot("short-pull-remains-hidden")
    point.press(forDuration: 0.01, thenDragTo: point.withOffset(CGVector(dx: 0, dy: 160)),
                withVelocity: velocity, thenHoldForDuration: 0.3)
    let close = app.navigationBars.firstMatch.buttons["Close"]
    XCTAssertTrue(close.waitForExistence(timeout: 5), "A full pull with the SAME input path must commit")
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    shot("full-pull-commits-input")
    guard close.exists else { return }
    close.tap()
    sleep(1)
    XCTAssertEqual(app.keyboards.count, 0)
  }

  /// Revised #332 contract: a real pull enters input without a field tap,
  /// shows the external Close immediately, and Close hides even an empty query.
  func testPullFocusesAndCloseStaysHidden() {
    let app = launch()
    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5))
    let ordinary = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).firstMatch
    let ordinaryLabel = ordinary.label
    let ordinaryY = ordinary.frame.minY
    func assertHidden(_ context: String) {
      let field = searchField(app)
      let bar = app.navigationBars.firstMatch
      let hidden = !field.exists || field.frame.maxY < 10 ||
        (bar.exists && bar.frame.intersection(field.frame).height < 10)
      XCTAssertTrue(hidden, "\(context): search must be hidden")
      XCTAssertFalse(app.navigationBars.firstMatch.buttons["Close"].exists,
                     "\(context): no standing close control")
      XCTAssertEqual(app.keyboards.count, 0, "\(context): keyboard must be dismissed")
    }
    func pullIntoInput() -> XCUIElement? {
      drag(list, fromY: 0.2, toY: 0.7)
      let close = app.navigationBars.firstMatch.buttons["Close"]
      let closeReady = close.waitForExistence(timeout: 5)
      let keyboardReady = app.keyboards.firstMatch.waitForExistence(timeout: 5)
      XCTAssertTrue(closeReady, "Pull must show Close BEFORE typing or tapping input")
      XCTAssertTrue(keyboardReady, "Pull must open the keyboard without a second tap")
      guard closeReady && keyboardReady else {
        shot("pull-input-not-ready"); tree(app, "pull-input-not-ready-tree"); return nil
      }
      guard let field = waitForSearchField(app, timeout: 5) else { return nil }
      XCTAssertTrue(field.isHittable)
      return field
    }
    assertHidden("cold")
    guard let first = pullIntoInput() else { return }
    XCTAssertTrue(["", "Search Library"].contains(first.value as? String ?? ""))
    shot("pull-empty-input-with-close")
    app.navigationBars.firstMatch.buttons["Close"].tap()
    sleep(1)
    assertHidden("empty Close")
    XCTAssertEqual(app.buttons[ordinaryLabel].frame.minY, ordinaryY, accuracy: 8)
    sleep(1)
    assertHidden("settled after empty Close")
    // A second deliberate pull is a fresh entry, not an automatic reopen.
    guard let second = pullIntoInput() else { return }
    second.typeText("Short")
    XCTAssertTrue((second.value as? String ?? "").contains("Short"))
    shot("second-pull-typed")
    app.navigationBars.firstMatch.buttons["Close"].tap()
    sleep(1)
    assertHidden("typed Close")
    XCTAssertEqual(app.buttons[ordinaryLabel].frame.minY, ordinaryY, accuracy: 8)
    // Scrolling down the list must not activate search after cancellation.
    list.swipeUp(velocity: .slow)
    assertHidden("ordinary scroll")
    app.buttons["Library actions"].tap()
    let search = app.buttons["Search"]
    XCTAssertTrue(search.waitForExistence(timeout: 5)); search.tap()
    let close = app.navigationBars.firstMatch.buttons["Close"]
    XCTAssertTrue(close.waitForExistence(timeout: 5), "Menu entry also shows Close with empty input")
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    close.tap()
    sleep(1)
    assertHidden("menu Close")
    shot("closed-until-next-entry")
  }

  /// Diagnostic (beta5): reproduce menu-Search -> type -> Close, then HOLD
  /// the post-cancel state for a native LLDB read. Records frames only.
  func testReproCancelThenHold() {
    let app = launch()
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
    actions.tap()
    let search = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5), "drawer must offer Search")
    search.tap()
    // Reacquire the native field type on every poll (the cached-query bug of
    // the 18:19 run waited on a TextField while the field was a SearchField).
    guard let field = waitForSearchField(app, timeout: 20) else { return }
    let closeDuringInput = app.navigationBars.firstMatch.buttons["Close"]
    XCTAssertTrue(closeDuringInput.waitForExistence(timeout: 20), "Search must reach input (Close control appears)")
    field.typeText("Short")
    sleep(1)
    let close = app.navigationBars.firstMatch.buttons["Close"]
    XCTAssertTrue(close.waitForExistence(timeout: 5), "Close must exist while a query is present")
    close.tap()
    sleep(2)
    // Absence after Close is correct; observe without waiting for a field to appear.
    let afterField = searchField(app)
    let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).firstMatch
    let bar = app.navigationBars.firstMatch
    let line = "post-cancel: field exists=\(afterField.exists) hittable=\(afterField.exists && afterField.isHittable) frame=\(afterField.exists ? NSCoder.string(for: afterField.frame) : "none") | topRow frame=\(row.exists ? NSCoder.string(for: row.frame) : "none") | bar frame=\(bar.exists ? NSCoder.string(for: bar.frame) : "none")"
    print("[diag] \(line)")
    let attachment = XCTAttachment(string: line)
    attachment.name = "post-cancel-frames"; attachment.lifetime = .keepAlways; add(attachment)
    shot("beta5-post-cancel-hold")
    tree(app, "beta5-post-cancel-tree")
  }

  /// Contract: a NONZERO browse offset survives search/Close. Pairs with a
  /// CDP-driven scroll (diagnostic offset source; the native capture reads
  /// the scroll view directly) run between the app launch and this attach:
  /// relaunch the app, drive the list to ~300, then run this method, which
  /// attaches WITHOUT launching, records the scrolled state, searches, types,
  /// closes, and requires the same topmost row back at the same frame with
  /// the field hidden and no keyboard.
  /// Contract: a NONZERO browse offset survives search/Close. The offset is
  /// produced by a REAL swipe (asserted to move the list) — no programmatic
  /// scroll counts as acceptance. Cache the settled top row's label and y as
  /// values, then compare the SAME identity after Close.
  func testCancelRestoresNonzeroBrowse() {
    let app = launch()
    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5), "list must exist")
    let initial = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).allElementsBoundByIndex
      .filter { $0.exists && $0.frame.minY >= 60 }
    guard let initialTop = initial.min(by: { $0.frame.minY < $1.frame.minY }) else {
      XCTFail("the browse list must show Document rows")
      return
    }
    let initialLabel = initialTop.label
    let initialY = initialTop.frame.minY
    list.swipeUp(velocity: .fast)
    // Require actual movement before anything else: the same topmost query
    // must return a different top row or a moved frame.
    var moved = false
    var settledLabel = ""
    var settledY: CGFloat = -1
    for _ in 0..<(20) {
      let rows = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).allElementsBoundByIndex
        .filter { $0.exists && $0.frame.minY >= 60 }
      if let top = rows.min(by: { $0.frame.minY < $1.frame.minY }) {
        if top.label != initialLabel || abs(top.frame.minY - initialY) >= 8 {
          moved = true
          settledLabel = top.label
          settledY = top.frame.minY
          break
        }
      }
      usleep(300_000)
    }
    guard moved else {
      shot("nonzero-no-movement")
      tree(app, "nonzero-no-movement-tree")
      XCTFail("the swipe did not move the browse list; state captured (no offset evidence, no acceptance)")
      return
    }
    sleep(1)
    // Settle the momentum and cache the settled top identity.
    let settled = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).allElementsBoundByIndex
      .filter { $0.exists && $0.frame.minY >= 60 }
      .min(by: { $0.frame.minY < $1.frame.minY })
    guard let settledTop = settled else {
      XCTFail("the scrolled list must keep Document rows")
      return
    }
    settledLabel = settledTop.label
    settledY = settledTop.frame.minY
    shot("nonzero-browse-scrolled")
    XCTAssertTrue(settledLabel != initialLabel || abs(settledY - initialY) >= 8, "genuine nonzero offset evidence required")
    // Search and cancel.
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
    actions.tap()
    let search = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5), "The actions drawer must offer Search")
    search.tap()
    guard let field = waitForSearchField(app, timeout: 20) else { return }
    field.typeText("Short")
    sleep(1)
    let close = app.navigationBars.firstMatch.buttons["Close"]
    XCTAssertTrue(close.waitForExistence(timeout: 5), "Close must exist while a query is present")
    close.tap()
    sleep(2)
    shot("nonzero-browse-restored")
    let afterField = searchField(app)
    let afterFieldClipped = !afterField.exists || afterField.frame.maxY < 10
    let bar = app.navigationBars.firstMatch
    let clippedByBar = afterField.exists && bar.exists && bar.frame.intersection(afterField.frame).height < 10
    XCTAssertTrue(afterFieldClipped || clippedByBar, "Close must hide the field again (field: \(afterField.exists ? NSCoder.string(for: afterField.frame) : "gone"))")
    XCTAssertEqual(app.keyboards.count, 0, "Close must dismiss the keyboard")
    // Same identity back at the cached settled position.
    var restoredTop: XCUIElement? = nil
    for _ in 0..<(20) {
      let rows = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).allElementsBoundByIndex
        .filter { $0.exists && $0.frame.minY >= 0 && $0.label == settledLabel }
      if let top = rows.min(by: { $0.frame.minY < $1.frame.minY }) { restoredTop = top; break }
      usleep(300_000)
    }
    guard let restored = restoredTop else {
      shot("nonzero-browse-row-missing")
      tree(app, "nonzero-browse-row-missing-tree")
      XCTFail("the settled top row '\(settledLabel)' must be back after Close; state captured")
      return
    }
    XCTAssertEqual(restored.frame.minY, settledY, accuracy: 12, "Nonzero browse offset must be restored (\(restored.frame.minY) vs \(settledY))")
    let line = "nonzero-browse: settled '\(settledLabel)' @\(settledY) -> restored @\(restored.frame.minY)"
    print("[diag] \(line)")
    let attachment = XCTAttachment(string: line)
    attachment.name = "nonzero-browse-frames"; attachment.lifetime = .keepAlways; add(attachment)
  }


  /// Contract: opening a result and returning retains the query AND a nonzero
  /// results offset, without the keyboard. Scrolling the results uses the
  /// same swipe primitive as pull-reveal; a non-moving swipe is recorded as
  /// unverified rather than a pass.
  func testResultRoundTripRetainsQueryAndOffset() {
    let app = launch()
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
    actions.tap()
    let search = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5), "The actions drawer must offer Search")
    search.tap()
    guard let field = waitForSearchField(app, timeout: 20) else { return }
    field.typeText("Scroll Diag")
    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5), "results list must exist")
    // The filtered rows can lag the text by a re-render, the subtitle swaps
    // to the Folder path asynchronously, and the AX snapshot layer on this
    // device is intermittently empty — poll across both predicates.
    var topBefore: XCUIElement? = nil
    var topBeforeLabel = ""
    var beforeY: CGFloat = -1
    for _ in 0..<(60) {
      let byTitle = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Scroll Diag")).allElementsBoundByIndex
      let bySubtitle = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).allElementsBoundByIndex
      let rows = (byTitle + bySubtitle).filter { $0.exists && $0.frame.minY >= 60 }
      if let top = rows.min(by: { $0.frame.minY < $1.frame.minY }) {
        topBefore = top
        topBeforeLabel = top.label
        beforeY = top.frame.minY
        break
      }
      usleep(300_000)
    }
    guard topBefore != nil else {
      shot("roundtrip-no-rows")
      tree(app, "roundtrip-no-rows-tree")
      XCTFail("results must show Document rows after typing; state captured")
      return
    }
    list.swipeUp(velocity: .fast)
    var topAfter: XCUIElement? = nil
    for _ in 0..<(40) {
      let byTitle = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Scroll Diag")).allElementsBoundByIndex
      let rows = byTitle.filter { $0.exists && $0.frame.minY >= 60 }
      if let top = rows.min(by: { $0.frame.minY < $1.frame.minY }) { topAfter = top; break }
      usleep(300_000)
    }
    guard let topAfter = topAfter else {
      shot("roundtrip-no-rows-after-swipe")
      tree(app, "roundtrip-no-rows-after-swipe-tree")
      XCTFail("results must keep Document rows after the scroll; state captured")
      return
    }
    let moved = topAfter.label != topBeforeLabel || abs(topAfter.frame.minY - beforeY) >= 8
    XCTAssertTrue(moved, "The swipe must move the results list for a valid nonzero-offset claim (top '\(topBeforeLabel)' @\(beforeY) -> '\(topAfter.label)' @\(topAfter.frame.minY))")
    // Settle before measuring. The old test then tapped an obscured anchor;
    // XCTest logged "Scroll element to visible" BEFORE opening the Reader.
    // Keep that anchor for comparison, but tap a fully visible row by coordinate.
    sleep(1)
    let rowsSettled = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Scroll Diag")).allElementsBoundByIndex
      .filter { $0.exists && $0.frame.minY >= 60 }
    let scrolled = rowsSettled.min(by: { $0.frame.minY < $1.frame.minY }) ?? topAfter
    let scrolledLabel = scrolled.label
    let scrolledY = scrolled.frame.minY
    let headerBottom = app.navigationBars.firstMatch.frame.maxY
    let keyboardTop = app.keyboards.firstMatch.exists ? app.keyboards.firstMatch.frame.minY : app.frame.maxY
    guard let visibleResult = rowsSettled.first(where: {
      $0.frame.minY > headerBottom + 8 && $0.frame.maxY < min(keyboardTop, app.frame.maxY - 80)
    }) else {
      tree(app, "roundtrip-no-fully-visible-target")
      XCTFail("A fully visible result is needed; never auto-scroll an obscured anchor into view")
      return
    }
    let targetFrame = visibleResult.frame
    print("[diag] roundtrip tap '\(visibleResult.label)' @\(targetFrame); anchor '\(scrolledLabel)' @\(scrolledY)")
    shot("roundtrip-scrolled-results")
    app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(
      dx: targetFrame.midX - app.frame.minX, dy: targetFrame.midY - app.frame.minY
    )).tap()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 15), "The result must open the reader")
    shot("roundtrip-reader")
    let back = app.navigationBars.buttons.firstMatch
    XCTAssertTrue(back.exists, "reader back button must exist")
    back.tap()
    let returnedField = searchField(app)
    let fieldBack = returnedField.waitForExistence(timeout: 15)
    shot("roundtrip-returned")
    XCTAssertTrue(fieldBack, "Returning must restore the search view")
    let value = returnedField.value as? String ?? ""
    XCTAssertTrue(value.contains("Scroll Diag"), "The query must be retained after the reader round trip; field value '\(value)'")
    XCTAssertEqual(app.keyboards.count, 0, "Returning must not reopen the keyboard")
    // Result rows show the parent Folder path ("Library"), not the browse
    // subtitle — match the query's own titles, not the browse predicate.
    var topReturn: XCUIElement? = nil
    for _ in 0..<(40) {
      let byTitle = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Scroll Diag")).allElementsBoundByIndex
      let rows = byTitle.filter { $0.exists && $0.frame.minY >= 60 }
      if let top = rows.min(by: { $0.frame.minY < $1.frame.minY }) { topReturn = top; break }
      usleep(300_000)
    }
    guard let topReturn = topReturn else {
      shot("roundtrip-no-results-back")
      tree(app, "roundtrip-no-results-back-tree")
      XCTFail("results must be back after returning; state captured")
      return
    }
    XCTAssertEqual(topReturn.label, scrolledLabel, "The same scrolled results position must be restored (top '\(scrolledLabel)' -> '\(topReturn.label)')")
    XCTAssertEqual(topReturn.frame.minY, scrolledY, accuracy: 12, "The nonzero results offset must be restored (\(topReturn.frame.minY) vs \(scrolledY))")
    let line = "roundtrip: query retained='Scroll Diag', scrolled top '\(scrolledLabel)' @\(scrolledY) -> returned '\(topReturn.label)' @\(topReturn.frame.minY)"
    print("[diag] \(line)")
    let attachment = XCTAttachment(string: line)
    attachment.name = "roundtrip-frames"; attachment.lifetime = .keepAlways; add(attachment)
  }

  /// Diagnostic (beta7): reproduce menu-Search -> type -> scroll results ->
  /// open result -> back, then HOLD the returned state for the native
  /// stored-position read. Records frames; asserts nothing about accuracy.
  func testResultRoundTripHold() {
    let app = launch()
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
    actions.tap()
    let search = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5), "drawer must offer Search")
    search.tap()
    guard let field = waitForSearchField(app, timeout: 20) else { return }
    field.typeText("Scroll Diag")
    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5), "results list must exist")
    list.swipeUp(velocity: .fast)
    sleep(1)
    let result = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Scroll Diag 08")).firstMatch
    XCTAssertTrue(result.waitForExistence(timeout: 10), "scrolled results must show row 08")
    result.tap()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 15), "reader must open")
    let back = app.navigationBars.buttons.firstMatch
    back.tap()
    sleep(2)
    let field2 = searchField(app)
    let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Scroll Diag")).allElementsBoundByIndex
      .filter { $0.exists && $0.frame.minY >= 60 }.min(by: { $0.frame.minY < $1.frame.minY })
    let bar = app.navigationBars.firstMatch
    let line = "roundtrip-hold: field exists=\(field2.exists) value='\(field2.exists ? field2.value as? String ?? "" : "none")' | topRow frame=\(row != nil ? NSCoder.string(for: row!.frame) : "none") | bar frame=\(bar.exists ? NSCoder.string(for: bar.frame) : "none")"
    print("[diag] \(line)")
    let attachment = XCTAttachment(string: line)
    attachment.name = "roundtrip-hold-frames"; attachment.lifetime = .keepAlways; add(attachment)
    shot("beta7-roundtrip-hold")
    tree(app, "beta7-roundtrip-hold-tree")
  }

  /// Matrix staging: create Folder `Search Folder` via the drawer, then move
  /// `A Short Test of Reading Aloud` into it through the Document actions'
  /// Move drawer. Leaves the Library with one Folder (root) and 12 root
  /// Documents + 1 moved Document.
  func testStageFolderAndMoveFixture() {
    let app = launch()
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
    actions.tap()
    let create = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Create folder")).firstMatch
    XCTAssertTrue(create.waitForExistence(timeout: 5), "Create folder row must exist")
    create.tap()
    // Create folder is a native alert with its own text field and OK.
    let alert = app.alerts.firstMatch
    XCTAssertTrue(alert.waitForExistence(timeout: 10), "the folder-name alert must appear")
    let nameField = alert.textFields.firstMatch
    XCTAssertTrue(nameField.exists, "the alert text field must exist")
    nameField.typeText("Search Folder")
    let ok = alert.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "create")).firstMatch
    XCTAssertTrue(ok.exists, "the alert OK/Create button must exist")
    ok.tap()
    sleep(1)
    shot("stage-folder-created")
    // Move the fixture into the folder: row actions -> Move -> Search Folder.
    let rowActions = app.buttons["Actions for A Short Test of Reading Aloud"]
    XCTAssertTrue(rowActions.waitForExistence(timeout: 5), "the fixture row must be present")
    rowActions.tap()
    let move = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Move")).firstMatch
    XCTAssertTrue(move.waitForExistence(timeout: 5), "the Move action must exist")
    move.tap()
    sleep(1)
    let folderRow = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search Folder")).firstMatch
    XCTAssertTrue(folderRow.waitForExistence(timeout: 5), "the move drawer must list Search Folder")
    folderRow.tap()
    sleep(1)
    let confirm = app.buttons.matching(NSPredicate(format: "label IN %@", ["Move", "Move here", "Confirm"])).firstMatch
    if confirm.exists { confirm.tap() }
    sleep(1)
    shot("stage-moved-fixture")
    tree(app, "stage-final-tree")
  }

  /// Global current-name matching, namesake paths, and live rename removal.
  /// The root fixture may already be renamed by an interrupted earlier run.
  func testGlobalResultsPathsAndNamesakes() {
    let app = launch()
    let oldName = "Scroll Diag 12 of 12"
    let sharedName = "A Short Test of Reading Aloud"
    func rename(_ actions: XCUIElement, to name: String) -> Bool {
      guard actions.waitForExistence(timeout: 5) else {
        XCTFail("The intended Document actions must exist"); return false
      }
      actions.tap()
      let rename = app.buttons["Rename"]
      guard rename.waitForExistence(timeout: 5) else {
        XCTFail("Rename must be offered"); return false
      }
      rename.tap()
      let alert = app.alerts.firstMatch
      guard alert.waitForExistence(timeout: 5) else {
        XCTFail("Rename alert must appear"); return false
      }
      let input = alert.textFields.firstMatch
      input.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
      input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 80))
      input.typeText(name)
      guard input.value as? String == name else {
        XCTFail("Name must read back exactly before Save"); return false
      }
      alert.buttons["Save"].tap()
      return true
    }
    let originalActions = app.buttons["Actions for " + oldName]
    if originalActions.exists {
      guard rename(originalActions, to: sharedName) else { return }
    }
    // Ordinary root has just one namesake; the other lives inside Search Folder.
    XCTAssertTrue(app.buttons["Actions for " + sharedName].waitForExistence(timeout: 5))
    app.buttons["Library actions"].tap()
    let search = app.buttons["Search"]
    XCTAssertTrue(search.waitForExistence(timeout: 5))
    search.tap()
    guard let field = waitForSearchField(app, timeout: 10) else { return }
    field.typeText(oldName)
    XCTAssertTrue(app.staticTexts["No documents found"].waitForExistence(timeout: 5),
                  "An old name must not match the renamed Document")
    app.buttons["Clear text"].tap()
    field.typeText("A Short")
    let root = app.buttons[sharedName + ", Library"]
    let nested = app.buttons[sharedName + ", Library → Search Folder"]
    XCTAssertTrue(root.waitForExistence(timeout: 5), "Root namesake must show Library")
    XCTAssertTrue(nested.waitForExistence(timeout: 5), "Global result must show its nested Folder path")
    shot("namesakes-distinct-paths")
    // Actions have identical labels; choose the one aligned with the ROOT row.
    let rootY = root.frame.midY
    let candidates = app.buttons.matching(NSPredicate(format: "label == %@", "Actions for " + sharedName)).allElementsBoundByIndex
    guard let rootActions = candidates.first(where: { abs($0.frame.midY - rootY) < 5 }) else {
      XCTFail("Root result actions must be unambiguously aligned with its row"); return
    }
    guard rename(rootActions, to: oldName) else { return }
    // Current query stays A Short: the renamed root MUST disappear, not relabel
    // itself into a nonmatching result. The nested namesake must remain.
    XCTAssertTrue(root.waitForNonExistence(timeout: 5), "Rename must remove the now-nonmatching result")
    XCTAssertTrue(nested.exists, "Rename must leave the other namesake intact")
    XCTAssertEqual(field.value as? String, "A Short")
    shot("rename-removes-only-root-result")
    app.buttons["Clear text"].tap()
    field.typeText(oldName)
    XCTAssertTrue(app.buttons[oldName + ", Library"].waitForExistence(timeout: 5),
                  "The same Document must be searchable by its restored current name")
    app.navigationBars.firstMatch.buttons["Close"].tap()
    XCTAssertTrue(app.buttons["Actions for " + oldName].waitForExistence(timeout: 5))
    shot("namesake-fixture-restored")
  }

  /// Matrix: leaving the Library for Settings ends the search.
  func testSettingsEndsSearch() {
    let app = launch()
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
    actions.tap()
    let search = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5), "drawer must offer Search")
    search.tap()
    guard let field = waitForSearchField(app, timeout: 20) else { return }
    field.typeText("Scroll Diag")
    sleep(1)
    let settings = app.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 5), "Settings button must exist")
    settings.tap()
    sleep(2)
    shot("matrix-settings-open")
    let back = app.navigationBars.buttons.firstMatch
    XCTAssertTrue(back.exists, "Settings back must exist")
    back.tap()
    sleep(2)
    let fieldAfter = searchField(app)
    let bar = app.navigationBars.firstMatch
    let hidden = !fieldAfter.exists || fieldAfter.frame.maxY < 10 || (bar.exists && bar.frame.intersection(fieldAfter.frame).height < 10)
    XCTAssertTrue(hidden, "Returning from Settings must end the search (field: \(fieldAfter.exists ? NSCoder.string(for: fieldAfter.frame) : "gone"))")
    shot("matrix-settings-returned")
  }

  /// Matrix: backgrounding preserves the search; a fresh launch clears it.
  func testBackgroundPreservesRelaunchClears() {
    let app = launch()
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
    actions.tap()
    let search = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5), "drawer must offer Search")
    search.tap()
    guard let field = waitForSearchField(app, timeout: 20) else { return }
    field.typeText("Scroll Diag")
    sleep(1)
    XCUIDevice.shared.press(.home)
    sleep(2)
    app.activate()
    sleep(2)
    let afterField = searchField(app)
    let stillThere = afterField.exists && (afterField.value as? String ?? "").contains("Scroll Diag")
    shot("matrix-after-background")
    XCTAssertTrue(stillThere, "Backgrounding must preserve the search; field '\(afterField.exists ? afterField.value as? String ?? "" : "gone")'")
    app.terminate()
    app.launch()
    sleep(2)
    let coldField = searchField(app)
    let bar = app.navigationBars.firstMatch
    let cleared = !coldField.exists || coldField.frame.maxY < 10 || (bar.exists && bar.frame.intersection(coldField.frame).height < 10)
    shot("matrix-after-relaunch")
    XCTAssertTrue(cleared, "A fresh launch must not restore the search")
    tree(app, "matrix-relaunch-tree")
  }

  /// Search from a Folder remains global; moving its result changes only the
  /// result path, and Close returns to the original Folder. Restore the fixture.
  func testFolderGlobalSearchAndLiveMove() {
    let app = launch()
    let folder = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Folder, Search Folder,")).firstMatch
    XCTAssertTrue(folder.waitForExistence(timeout: 5))
    folder.tap()
    XCTAssertTrue(app.navigationBars["Search Folder"].waitForExistence(timeout: 5))
    app.buttons["Library actions"].tap()
    let search = app.buttons["Search"]
    XCTAssertTrue(search.waitForExistence(timeout: 5))
    search.tap()
    guard let field = waitForSearchField(app, timeout: 10) else { return }
    field.typeText("Scroll Diag 12")
    let rootResult = app.buttons["Scroll Diag 12 of 12, Library"]
    XCTAssertTrue(rootResult.waitForExistence(timeout: 5), "Folder search must reach a root Document")
    func openMove() {
      app.buttons["Actions for Scroll Diag 12 of 12"].tap()
      let move = app.buttons["Move to…"]
      XCTAssertTrue(move.waitForExistence(timeout: 5))
      move.tap()
    }
    openMove()
    let destination = app.buttons["Search Folder"]
    XCTAssertTrue(destination.waitForExistence(timeout: 5))
    destination.tap()
    let commit = app.buttons["Move"]
    XCTAssertTrue(commit.waitForExistence(timeout: 5) && commit.isEnabled)
    commit.tap()
    let movedResult = app.buttons["Scroll Diag 12 of 12, Library → Search Folder"]
    XCTAssertTrue(movedResult.waitForExistence(timeout: 5), "Move must update the result path live")
    XCTAssertEqual(field.value as? String, "Scroll Diag 12")
    shot("folder-search-live-move")
    openMove()
    let up = app.buttons["Back to Library"]
    XCTAssertTrue(up.waitForExistence(timeout: 5))
    up.tap()
    XCTAssertTrue(commit.waitForExistence(timeout: 5) && commit.isEnabled)
    commit.tap()
    XCTAssertTrue(rootResult.waitForExistence(timeout: 5), "The fixture must be back in Library")
    app.buttons["Clear text"].tap()
    XCTAssertTrue(app.buttons["A Short Test of Reading Aloud, Not started."].waitForExistence(timeout: 5),
                  "Empty input must show the original Folder's ordinary contents")
    app.navigationBars.firstMatch.buttons["Close"].tap()
    XCTAssertTrue(app.navigationBars["Search Folder"].exists, "Cancel must keep the original Folder")
    shot("folder-origin-restored")
    app.navigationBars.firstMatch.buttons.firstMatch.tap()
  }

  /// Stage #317's existing held-menu recipe without overwriting folder data.
  /// This verifies the relaunch location, NOT menu contents. A press followed
  /// by release can select an ancestor; inspect the menu while still held down.
  func testStageNestedFolderForHeldBackMenu() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    for _ in 0..<4 {
      if app.navigationBars["Library"].waitForExistence(timeout: 2) { break }
      app.navigationBars.firstMatch.buttons.firstMatch.tap()
    }
    XCTAssertTrue(app.navigationBars["Library"].exists)
    func enter(_ name: String) {
      let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Folder, " + name + ",")).firstMatch
      if !row.exists {
        app.buttons["Library actions"].tap()
        let create = app.buttons["Create folder"]
        XCTAssertTrue(create.waitForExistence(timeout: 5)); create.tap()
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        alert.textFields.firstMatch.typeText(name)
        alert.buttons["Create"].tap()
      }
      XCTAssertTrue(row.waitForExistence(timeout: 5)); row.tap()
      XCTAssertTrue(app.navigationBars[name].waitForExistence(timeout: 5))
    }
    enter("Search Outer")
    enter("Search Inner")
    app.terminate(); app.launch()
    XCTAssertTrue(app.navigationBars["Search Inner"].waitForExistence(timeout: 10))
    shot("nested-folder-ready-for-held-menu")
    tree(app, "nested-folder-ready-for-held-menu-tree")
  }

  /// Matrix: hardware keyboard CmdF reveals search, Escape leaves it, and
  /// neither exists on the Reader. Runs in the current theme (dark during the
  /// matrix) so the screenshots double as appearance evidence.
  func testHardwareCmdFAndEscape() {
    let app = launch()
    let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10), "a Document must be in the Library")
    app.typeKey("f", modifierFlags: .command)
    let close = app.navigationBars.firstMatch.buttons["Close"]
    XCTAssertTrue(close.waitForExistence(timeout: 10), "CmdF must reveal the search (Close appears)")
    shot("matrix-cmdf-revealed")
    guard let field = waitForSearchField(app, timeout: 10) else { return }
    field.typeText("Scroll Diag")
    sleep(1)
    app.typeKey("\u{1b}", modifierFlags: [])
    sleep(1)
    let afterEscape = searchField(app)
    let bar = app.navigationBars.firstMatch
    let hidden = !afterEscape.exists || afterEscape.frame.maxY < 10 || (bar.exists && bar.frame.intersection(afterEscape.frame).height < 10)
    shot("matrix-escape-hidden")
    XCTAssertTrue(hidden, "Escape must return the hidden presentation (field: \(afterEscape.exists ? NSCoder.string(for: afterEscape.frame) : "gone"))")
    // Reader exclusion: open a Document, CmdF must not reveal a search field.
    let doc = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Scroll Diag 12")).firstMatch
    XCTAssertTrue(doc.waitForExistence(timeout: 10), "a Document must exist to open")
    doc.tap()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 15), "reader must open")
    app.typeKey("f", modifierFlags: .command)
    sleep(2)
    let readerField = searchField(app)
    shot("matrix-reader-cmdf")
    XCTAssertFalse(readerField.exists, "CmdF must do nothing on the Reader (search field appeared)")
    let back = app.navigationBars.buttons.firstMatch
    back.tap()
    sleep(1)
  }

  /// Diagnostic: one Escape only, without relaunching the process being traced.
  func testEscapeOnlyInRunningSearch() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    guard let field = waitForSearchField(app, timeout: 5) else { return }
    XCTAssertTrue(field.isHittable)
    app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
    shot("same-process-escape-only")
  }

  /// Diagnostic on the SAME running process: a printable key is the delivery
  /// control, then Escape. Never launches/terminates; safe to pair with an
  /// already-attached, auto-continuing debugger. Not acceptance on its own.
  func testTypeKeysInRunningSearch() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    guard let field = waitForSearchField(app, timeout: 5) else { return }
    app.typeKey("f", modifierFlags: .command)
    let before = field.value as? String ?? ""
    app.typeKey("z", modifierFlags: [])
    let typed = field.value as? String ?? ""
    XCTAssertEqual(typed, before + "z", "Printable typeKey must actually reach the focused input")
    let nativeEscape = XCUIKeyboardKey.escape.rawValue
    print("[diag] Escape constant scalars=\(nativeEscape.unicodeScalars.map { $0.value }); literal scalars=\("\u{1b}".unicodeScalars.map { $0.value })")
    app.typeKey(nativeEscape, modifierFlags: [])
    sleep(1)
    let after = searchField(app)
    let bar = app.navigationBars.firstMatch
    let hidden = !after.exists || after.frame.maxY < 10 || (bar.exists && bar.frame.intersection(after.frame).height < 10)
    let line = "same-process keys: before='\(before)' typed='\(typed)' escapeHidden=\(hidden) field='\(after.exists ? after.value as? String ?? "" : "absent")'"
    print("[diag] \(line)")
    let attachment = XCTAttachment(string: line)
    attachment.name = "same-process-keys"; attachment.lifetime = .keepAlways; add(attachment)
    shot("same-process-escape")
    if hidden { return }
    app.typeKey(XCUIKeyboardKey.return.rawValue, modifierFlags: [])
    app.typeKey(nativeEscape, modifierFlags: [])
    sleep(1)
    let afterReturn = searchField(app)
    let hiddenAfterReturn = !afterReturn.exists || afterReturn.frame.maxY < 10 || (bar.exists && bar.frame.intersection(afterReturn.frame).height < 10)
    print("[diag] same-process Return then Escape hidden=\(hiddenAfterReturn)")
  }

  /// Diagnostic (beta7): CmdF -> type -> Escape, then HOLD the post-Escape
  /// state for the native keyCommands split. Records frames only.
  func testEscapeHold() {
    let app = launch()
    app.typeKey("f", modifierFlags: .command)
    let close = app.navigationBars.firstMatch.buttons["Close"]
    XCTAssertTrue(close.waitForExistence(timeout: 10), "CmdF must reveal the search")
    guard let field = waitForSearchField(app, timeout: 10) else { return }
    field.typeText("Scroll")
    sleep(1)
    app.typeKey("\u{1b}", modifierFlags: [])
    sleep(2)
    let after = searchField(app)
    let bar = app.navigationBars.firstMatch
    let line = "post-escape: field exists=\(after.exists) frame=\(after.exists ? NSCoder.string(for: after.frame) : "none") | bar frame=\(bar.exists ? NSCoder.string(for: bar.frame) : "none")"
    print("[diag] \(line)")
    let attachment = XCTAttachment(string: line)
    attachment.name = "post-escape-frames"; attachment.lifetime = .keepAlways; add(attachment)
    shot("beta7-post-escape-hold")
    tree(app, "beta7-post-escape-tree")
  }

  /// Matrix: deleting a result removes it from the live results.
  func testDeleteFromResultsUpdatesMembership() {
    let app = launch()
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
    actions.tap()
    let search = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5), "drawer must offer Search")
    search.tap()
    guard let field = waitForSearchField(app, timeout: 20) else { return }
    field.typeText("Scroll Diag 01")
    sleep(1)
    let result = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Scroll Diag 01")).firstMatch
    XCTAssertTrue(result.waitForExistence(timeout: 10), "the result must appear")
    let resultActions = app.buttons["Actions for Scroll Diag 01 of 12"]
    XCTAssertTrue(resultActions.waitForExistence(timeout: 5), "the result's actions button must exist")
    resultActions.tap()
    let delete = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Delete")).firstMatch
    XCTAssertTrue(delete.waitForExistence(timeout: 5), "Delete must be offered on the result")
    delete.tap()
    let confirm = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Delete")).firstMatch
    XCTAssertTrue(confirm.waitForExistence(timeout: 5), "the delete confirmation must appear")
    confirm.tap()
    sleep(2)
    let gone = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Scroll Diag 01")).firstMatch
    shot("matrix-delete-live")
    XCTAssertFalse(gone.exists, "the deleted result must disappear from the live results")
  }

  /// Matrix: a result's actions drawer retains the single-Document actions
  /// and offers NO Select while searching (presentation only; cancel).
  func testResultActionsPresentationNoSelect() {
    let app = launch()
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
    actions.tap()
    let search = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5), "drawer must offer Search")
    search.tap()
    guard let field = waitForSearchField(app, timeout: 20) else { return }
    field.typeText("Scroll Diag 02")
    sleep(1)
    let resultActions = app.buttons["Actions for Scroll Diag 02 of 12"]
    XCTAssertTrue(resultActions.waitForExistence(timeout: 5), "the result's actions button must exist")
    resultActions.tap()
    sleep(1)
    for expected in ["Rename", "Download", "Share", "Delete", "Move"] {
      XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", expected)).firstMatch.exists,
        "the result actions drawer must offer \(expected)")
    }
    let select = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Select")).firstMatch
    shot("matrix-result-actions-no-select")
    XCTAssertFalse(select.exists, "result actions must NOT offer Select while searching")
    tree(app, "matrix-result-actions-tree")
    let close = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Close")).firstMatch
    if close.exists { close.tap() }
  }

  /// Matrix: during selection, CmdF and pull must not reveal search (the
  /// missing drawer button alone is not proof).
  func testSelectionBlocksKeysAndPull() {
    let app = launch()
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
    actions.tap()
    let select = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Select")).firstMatch
    XCTAssertTrue(select.waitForExistence(timeout: 5), "Select must exist")
    select.tap()
    sleep(1)
    // CmdF during selection.
    app.typeKey("f", modifierFlags: .command)
    sleep(2)
    let close = app.navigationBars.firstMatch.buttons["Close"]
    let field = searchField(app)
    let cmdfRevealed = close.exists || (field.exists && field.isHittable)
    shot("matrix-selection-cmdf")
    XCTAssertFalse(cmdfRevealed, "CmdF must not reveal search during selection")
    // Pull during selection.
    let list = app.scrollViews.firstMatch
    if list.exists {
      list.swipeDown(velocity: .fast)
      sleep(1)
    }
    let fieldAfterPull = searchField(app)
    let closeAfterPull = app.navigationBars.firstMatch.buttons["Close"]
    let pullRevealed = closeAfterPull.exists || (fieldAfterPull.exists && fieldAfterPull.isHittable)
    shot("matrix-selection-pull")
    XCTAssertFalse(pullRevealed, "Pull must not reveal search during selection")
    // Leave selection.
    let exit = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Cancel")).firstMatch
    XCTAssertTrue(exit.waitForExistence(timeout: 5), "selection Cancel must exist")
    exit.tap()
    sleep(1)
    shot("matrix-selection-left")
  }

  /// Matrix: a modal (the rename alert) blocks CmdF.
  func testModalBlocksCmdF() {
    let app = launch()
    let sourceActions = app.buttons["Actions for Scroll Diag 12 of 12"]
    XCTAssertTrue(sourceActions.waitForExistence(timeout: 10), "root Scroll Diag 12 must exist")
    sourceActions.tap()
    let rename = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Rename")).firstMatch
    XCTAssertTrue(rename.waitForExistence(timeout: 5), "Rename must exist")
    rename.tap()
    let alert = app.alerts.firstMatch
    XCTAssertTrue(alert.waitForExistence(timeout: 10), "the rename alert must appear")
    app.typeKey("f", modifierFlags: .command)
    sleep(2)
    let field = searchField(app)
    let close = app.navigationBars.firstMatch.buttons["Close"]
    shot("matrix-modal-cmdf")
    XCTAssertFalse(field.exists || close.exists, "CmdF must do nothing while a modal alert is up")
    let cancel = alert.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Cancel")).firstMatch
    if cancel.exists { cancel.tap() }
    sleep(1)
  }

  /// Matrix (#317 regression): opening the staged Folder shows its title and
  /// the back navigation returns to the root.
  func testFolderOpenBackRegression() {
    let app = launch()
    let folder = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search Folder")).firstMatch
    XCTAssertTrue(folder.waitForExistence(timeout: 10), "Search Folder must exist at root")
    folder.tap()
    let bar = app.navigationBars.firstMatch
    XCTAssertTrue(bar.waitForExistence(timeout: 5), "the Folder bar must appear")
    XCTAssertEqual(bar.identifier, "Search Folder", "the Folder bar must carry the Folder title (got '\(bar.identifier)')")
    shot("matrix-folder-open")
    let back = app.navigationBars.buttons.firstMatch
    XCTAssertTrue(back.exists, "back must exist")
    back.tap()
    sleep(1)
    let rootFolder = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search Folder")).firstMatch
    XCTAssertTrue(rootFolder.waitForExistence(timeout: 5), "returning to root must show the Folder row")
    shot("matrix-folder-back")
  }

  /// Gesture-causality control: the SAME slow coordinate press-drag applied
  /// to the system Settings list on this owned device. If Settings moves,
  /// synthetic coordinate drags deliver, and a non-moving Library is an
  /// app/target finding; if Settings also stands still, the coordinate
  /// primitive cannot deliver on this stack at all.
  func testControlSettingsCoordinateDrag() {
    let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
    settings.launch()
    XCTAssertTrue(settings.wait(for: .runningForeground, timeout: 10), "Settings must run foreground")
    // iOS 26 Settings exposes no ScrollView; drag on the app element itself
    // and read the visible static texts before/after.
    let textsBefore = settings.staticTexts.allElementsBoundByIndex
      .filter { $0.exists && $0.frame.minY >= 100 && !$0.label.isEmpty }
      .prefix(6).map { "\($0.label)@\(Int($0.frame.minY))" }.joined(separator: " | ")
    let start = settings.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
    let end = start.withOffset(CGVector(dx: 0, dy: -300))
    start.press(forDuration: 0.01, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.3)
    sleep(1)
    let textsAfter = settings.staticTexts.allElementsBoundByIndex
      .filter { $0.exists && $0.frame.minY >= 100 && !$0.label.isEmpty }
      .prefix(6).map { "\($0.label)@\(Int($0.frame.minY))" }.joined(separator: " | ")
    XCTAssertFalse(textsBefore.isEmpty, "Settings control needs a nonempty starting snapshot")
    XCTAssertFalse(textsAfter.isEmpty, "Settings control needs a nonempty ending snapshot")
    XCTAssertNotEqual(textsBefore, textsAfter, "The gesture control must actually move Settings")
    let line = "settings-control: before=[\(textsBefore)] after=[\(textsAfter)] moved=\(textsBefore != textsAfter)"
    print("[diag] \(line)")
    let attachment = XCTAttachment(string: line)
    attachment.name = "settings-control-frames"; attachment.lifetime = .keepAlways; add(attachment)
    shot("settings-control-after-drag")
    settings.terminate()
  }

  /// Basic browse-scroll regression, no relaunch: suitable for a controlled
  /// native-handler A/B diagnostic. Capture scalar coordinates, not live refs.
  func testBasicScrollOnRunningLibrary() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5))
    let row = app.buttons["Scroll Diag 12 of 12, Not started."]
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    let beforeY = row.frame.minY
    list.swipeUp(velocity: .slow)
    sleep(1)
    let upY = row.frame.minY
    print("[diag] basic-scroll before=\(beforeY) after-up=\(upY)")
    shot("basic-scroll-after-up")
    XCTAssertLessThan(upY, beforeY - 40, "Ordinary upward swipe must move the Library, not snap back")
    list.swipeDown(velocity: .slow)
    sleep(1)
    let downY = row.frame.minY
    print("[diag] basic-scroll after-down=\(downY)")
    shot("basic-scroll-after-down")
    XCTAssertGreaterThan(downY, upY + 40, "Ordinary downward swipe must move back through the Library")
  }

  /// A real pan against the already-running Library, so an owned debugger
  /// observes the SAME process throughout. No launch, app mutation or audio.
  func testPanOnRunningLibrary() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5))
    let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
    start.press(forDuration: 0.01, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 160)),
                withVelocity: XCUIGestureVelocity(rawValue: 80), thenHoldForDuration: 0.2)
    shot("same-process-pan")
    tree(app, "same-process-pan-tree")
  }

  /// Diagnostic (beta10): one slow coordinate drag on the Library, then
  /// idle — pairs with an external video recording to see whether the pan
  /// translation drives the blur preview at all.
  func testDragAndIdle() {
    let app = launch()
    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5), "list must exist")
    let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15))
    let end = start.withOffset(CGVector(dx: 0, dy: 300))
    start.press(forDuration: 0.02, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 1.5)
    sleep(3)
    shot("beta10-drag-idle-end")
  }

  /// Short-drag cancellation must not activate the row under the finger.
  /// No launch: usable for controlled native gesture-dependency diagnostics.
  func testPartialPullStaysOnPage() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    let bar = app.navigationBars.firstMatch
    XCTAssertTrue(bar.waitForExistence(timeout: 5))
    let title = bar.identifier
    let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(
      dx: app.frame.width / 2, dy: bar.frame.maxY - app.frame.minY + 100
    ))
    start.press(forDuration: 0.01, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 20)),
                withVelocity: XCUIGestureVelocity(rawValue: 40), thenHoldForDuration: 0.3)
    sleep(1)
    XCTAssertEqual(app.navigationBars.firstMatch.identifier, title, "A short pull must not open the row beneath it")
    let field = searchField(app)
    let hidden = !field.exists || field.frame.maxY < 10 ||
      app.navigationBars.firstMatch.frame.intersection(field.frame).height < 10
    XCTAssertTrue(hidden)
    XCTAssertEqual(app.keyboards.count, 0)
    shot("partial-pull-same-page")
  }

  /// Works on a one-row or empty Library/Folder. Pull starts in blank content,
  /// not a row; prove keyboard, native Close, preserved route and hidden return.
  func testBlankSpacePullAndClose() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let bar = app.navigationBars.firstMatch
    XCTAssertTrue(bar.waitForExistence(timeout: 5))
    let title = bar.identifier
    let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
    start.press(forDuration: 0.01, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 160)),
                withVelocity: XCUIGestureVelocity(rawValue: 80), thenHoldForDuration: 0.3)
    let close = app.navigationBars.firstMatch.buttons["Close"]
    XCTAssertTrue(close.waitForExistence(timeout: 5), "Blank-space pull must offer native Close immediately")
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    XCTAssertEqual(app.navigationBars.firstMatch.identifier, title)
    shot("blank-space-pull-input")
    guard close.exists else { return }
    close.tap()
    sleep(1)
    let field = searchField(app)
    XCTAssertTrue(!field.exists || field.frame.maxY < 10 ||
      app.navigationBars.firstMatch.frame.intersection(field.frame).height < 10)
    XCTAssertEqual(app.keyboards.count, 0)
    XCTAssertEqual(app.navigationBars.firstMatch.identifier, title)
    shot("blank-space-pull-closed")
  }

  /// Compare a pull beginning over an actual row with one over blank list
  /// space on a short Library. Both must use the same native scrolling surface.
  func testPullFromVisibleRow() {
    let app = launch()
    let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).firstMatch
    let rect = row.frame
    let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(
      dx: rect.midX - app.frame.minX, dy: rect.midY - app.frame.minY
    ))
    start.press(forDuration: 0.01, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 160)),
                withVelocity: XCUIGestureVelocity(rawValue: 80), thenHoldForDuration: 0.3)
    let close = app.navigationBars.firstMatch.buttons["Close"]
    XCTAssertTrue(close.waitForExistence(timeout: 5), "Row-origin pull must enter search, not open the Reader")
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    shot("visible-row-pull")
    if close.exists { close.tap() }
  }

  /// Same-process coordinate pull, for a controlled gesture-dependency A/B.
  func testCoordinatePullOnRunningLibrary() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5))
    let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
    start.press(forDuration: 0.01, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 160)),
                withVelocity: XCUIGestureVelocity(rawValue: 40), thenHoldForDuration: 0.3)
    XCTAssertTrue(app.navigationBars.firstMatch.buttons["Close"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    shot("coordinate-pull-input")
  }

  /// Stage actual native marked-text input for a read-only command-scope check.
  /// The owned simulator already has the Bopomofo keyboard; no settings change.
  func testStageIMEComposition() {
    let app = launch()
    app.buttons["Library actions"].tap()
    let search = app.buttons["Search"]
    XCTAssertTrue(search.waitForExistence(timeout: 5)); search.tap()
    guard let field = waitForSearchField(app, timeout: 5) else { return }
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    let phonetic = app.keys["ㄅ"]
    for _ in 0..<3 {
      if phonetic.exists { break }
      let globe = app.buttons["Next keyboard"]
      XCTAssertTrue(globe.exists, "Native keyboard switching must be available")
      guard globe.exists else { return }
      globe.tap()
    }
    guard phonetic.waitForExistence(timeout: 3) else {
      tree(app, "ime-keyboard-unavailable"); XCTFail("Preinstalled Bopomofo key must exist"); return
    }
    // First-time system keyboard onboarding can cover otherwise-present keys.
    let onboarding = app.buttons["Continue"]
    if onboarding.exists { onboarding.tap() }
    phonetic.tap()
    XCTAssertTrue(field.exists)
    XCTAssertFalse(["", "Search Library"].contains(field.value as? String ?? ""),
                   "The phonetic key must actually reach the field")
    shot("ime-composition-held")
    tree(app, "ime-composition-held-tree")
  }

  /// Clear marked input and return the owned simulator to its English keyboard.
  func testRestoreKeyboardAfterIME() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    guard let field = waitForSearchField(app, timeout: 5) else { return }
    field.tap()
    for _ in 0..<3 {
      if app.keys["q"].exists { break }
      let globe = app.buttons["Next keyboard"]
      XCTAssertTrue(globe.exists); guard globe.exists else { return }
      globe.tap()
    }
    XCTAssertTrue(app.keys["q"].exists, "Restore the English keyboard")
    let close = app.navigationBars.firstMatch.buttons["Close"]
    XCTAssertTrue(close.exists); close.tap()
    XCTAssertEqual(app.keyboards.count, 0)
    shot("ime-restored-ordinary-library")
  }

  /// Same-process slow flick for native end-drag ordering inspection.
  func testSlowFlickOnRunningLibrary() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5))
    list.swipeDown(velocity: .slow)
    sleep(1)
    shot("same-process-slow-flick")
  }

  /// Diagnostic (beta11): a SLOW velocity swipeDown (the primitive that
  /// verifiably translates this list) — does it drive the new pull?
  func testSlowFlickPullProbe() {
    let app = launch()
    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5), "list must exist")
    list.swipeDown(velocity: .slow)
    sleep(1)
    let close = app.navigationBars.firstMatch.buttons["Close"]
    let field = searchField(app)
    let line = "slow-flick: close=\(close.exists) field=\(field.exists) frame=\(field.exists ? NSCoder.string(for: field.frame) : "none") keyboard=\(app.keyboards.count)"
    print("[diag] \(line)")
    let attachment = XCTAttachment(string: line)
    attachment.name = "slow-flick-frames"; attachment.lifetime = .keepAlways; add(attachment)
    shot("slow-flick-pull")
  }

  /// Diagnostic: isolate why testPullFocusesAndCloseStaysHidden's swipe
  /// fails while testSlowFlickPullProbe's identical swipe works — this
  /// variant adds the cold assertHidden queries before the swipe.
  func testSlowFlickAfterColdChecks() {
    let app = launch()
    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5), "list must exist")
    // — the cold assertHidden block —
    let field0 = searchField(app)
    let bar0 = app.navigationBars.firstMatch
    let hidden = !field0.exists || field0.frame.maxY < 10 ||
      (bar0.exists && bar0.frame.intersection(field0.frame).height < 10)
    XCTAssertFalse(app.navigationBars.firstMatch.buttons["Close"].exists)
    XCTAssertEqual(app.keyboards.count, 0)
    // — then the identical swipe —
    list.swipeDown(velocity: .slow)
    sleep(1)
    let close = app.navigationBars.firstMatch.buttons["Close"]
    let field = searchField(app)
    let line = "slow-flick-after-checks: hidden=\(hidden) close=\(close.exists) field=\(field.exists) frame=\(field.exists ? NSCoder.string(for: field.frame) : "none") keyboard=\(app.keyboards.count)"
    print("[diag] \(line)")
    let attachment = XCTAttachment(string: line)
    attachment.name = "slow-flick-after-checks"; attachment.lifetime = .keepAlways; add(attachment)
    shot("slow-flick-after-checks")
  }

  /// Diagnostic: replicate testPullFocusesAndCloseStaysHidden's EXACT
  /// pre-swipe flow (ordinary row caching + pullIntoInput + cold
  /// assertHidden) to isolate the swipe failure.
  func testSlowFlickPullTestFlow() {
    let app = launch()
    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5))
    let ordinary = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).firstMatch
    let ordinaryLabel = ordinary.label
    let ordinaryY = ordinary.frame.minY
    func assertHidden(_ context: String) {
      let field = searchField(app)
      let bar = app.navigationBars.firstMatch
      let hidden = !field.exists || field.frame.maxY < 10 ||
        (bar.exists && bar.frame.intersection(field.frame).height < 10)
      XCTAssertTrue(hidden, "\(context): search must be hidden")
      XCTAssertFalse(app.navigationBars.firstMatch.buttons["Close"].exists,
                     "\(context): no standing close control")
      XCTAssertEqual(app.keyboards.count, 0, "\(context): keyboard must be dismissed")
    }
    func pullIntoInput() -> XCUIElement? {
      drag(list, fromY: 0.2, toY: 0.7)
      let close = app.navigationBars.firstMatch.buttons["Close"]
      let closeReady = close.waitForExistence(timeout: 5)
      let keyboardReady = app.keyboards.firstMatch.waitForExistence(timeout: 5)
      guard closeReady && keyboardReady else {
        shot("flow-pull-input-not-ready"); tree(app, "flow-pull-input-not-ready-tree"); return nil
      }
      guard let f = waitForSearchField(app, timeout: 5) else { return nil }
      return f
    }
    assertHidden("cold")
    guard let first = pullIntoInput() else { return }
    let line = "flow: reached input, value='\(first.value as? String ?? "")'"
    print("[diag] \(line)")
    let attachment = XCTAttachment(string: line)
    attachment.name = "flow-reached"; attachment.lifetime = .keepAlways; add(attachment)
  }

  /// Helper: navigate back until the Library root is reached.
  func testNavigateToRoot() {
    // Attach to the already-running app; no launch (launch() waits for a
    // Document which does not exist inside a Folder).
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    if !app.navigationBars.firstMatch.exists {
      app.launch()
    }
    for _ in 0..<4 {
      if app.navigationBars.firstMatch.identifier == "Library" {
        shot("at-root")
        return
      }
      let back = app.navigationBars.buttons.firstMatch
      if back.exists { back.tap(); sleep(1) } else { break }
    }
    XCTAssertEqual(app.navigationBars.firstMatch.identifier, "Library", "must reach the Library root")
  }

  /// Dismissing only input must not strand an active query without a usable X.
  func testCloseAfterKeyboardDismissal() {
    let app = launch()
    app.buttons["Library actions"].tap()
    let search = app.buttons["Search"]
    XCTAssertTrue(search.waitForExistence(timeout: 5)); search.tap()
    guard let field = waitForSearchField(app, timeout: 5) else { return }
    field.typeText("Short")
    let submit = app.keyboards.buttons.matching(NSPredicate(format: "identifier == %@ OR label == %@", "Search", "search")).firstMatch
    XCTAssertTrue(submit.waitForExistence(timeout: 5)); submit.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
    XCTAssertEqual(field.value as? String, "Short")
    let close = app.navigationBars.firstMatch.buttons["Close"]
    XCTAssertTrue(close.exists && close.isEnabled, "Active search must keep an enabled native Close after blur")
    close.tap()
    sleep(1)
    let after = searchField(app)
    XCTAssertTrue(!after.exists || after.frame.maxY < 10 ||
      app.navigationBars.firstMatch.frame.intersection(after.frame).height < 10)
    shot("close-after-input-dismissal")
  }

  /// Contract: clearing input shows the ordinary list again but stays in
  /// search (field available); cancelling ends search, hides/collapses the
  /// field and restores the ordinary position. Gesture-free: `...` › Search
  /// begins input without needing the pull. The field reads back its
  /// placeholder as the value when empty.
  func testClearAndCancelRestoreOrdinaryPosition() {
    let app = launch()
    let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10), "ordinary list must show a Document")
    let ordinaryY = row.frame.minY
    let ordinaryLabel = row.label

    func beginSearch() -> XCUIElement? {
      let actions = app.buttons["Library actions"]
      XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
      actions.tap()
      let search = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch
      XCTAssertTrue(search.waitForExistence(timeout: 5), "The actions drawer must offer Search")
      search.tap()
      return waitForSearchField(app, timeout: 5)
    }

    // iOS 26's search-cancel icon is labelled Close in the native AX tree,
    // distinct from the field's Clear text button; scope it to the bar.
    guard var field = beginSearch() else { return }
    field.typeText("Short")
    sleep(1)
    XCTAssertTrue((field.value as? String ?? "").contains("Short"), "query typed")
    let cancel = app.navigationBars.firstMatch.buttons["Close"]
    XCTAssertTrue(cancel.exists, "Cancel control must exist while a query is present")
    cancel.tap()
    sleep(1)
    shot("cancel-restores-ordinary")
    let afterField = searchField(app)
    let bar = app.navigationBars.firstMatch
    let clippedOrGone = !afterField.exists || afterField.frame.maxY < 10 || (bar.exists && bar.frame.intersection(afterField.frame).height < 10)
    XCTAssertTrue(clippedOrGone, "Cancel must hide/collapse the field (field: \(afterField.exists ? NSCoder.string(for: afterField.frame) : "gone"), bar: \(bar.exists ? NSCoder.string(for: bar.frame) : "none"))")
    XCTAssertEqual(app.keyboards.count, 0, "Cancel must dismiss the keyboard")
    let restoredRow = app.buttons[ordinaryLabel]
    XCTAssertTrue(restoredRow.waitForExistence(timeout: 5), "Ordinary list must be back after cancel")
    XCTAssertEqual(restoredRow.frame.minY, ordinaryY, accuracy: 8, "Cancel must restore the ordinary list position (\(restoredRow.frame.minY) vs \(ordinaryY))")

    // Clear: the field's clear control empties the query, the ordinary list
    // returns, and the field stays revealed and available (still searching).
    guard let reopened = beginSearch() else { return }
    field = reopened
    field.typeText("zzz")
    sleep(1)
    let clear = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Clear")).firstMatch
    XCTAssertTrue(clear.exists, "The field's clear control must exist while a query is present")
    clear.tap()
    sleep(1)
    field = searchField(app)
    let value = field.value as? String ?? ""
    XCTAssertTrue(value.isEmpty || value == "Search Library", "Clear must empty the field; value '\(value)'")
    let ordinaryAgain = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).firstMatch
    XCTAssertTrue(ordinaryAgain.waitForExistence(timeout: 5), "An empty query must show the ordinary list again")
    XCTAssertTrue(field.isHittable, "Clear must leave the field revealed and available, not cancelled")
    shot("clear-restores-list")
    tree(app, "clear-final-tree")
  }

  /// Contract: tapping the field begins input (first responder + typing lands).
  /// Typing landing in the field and filtering the list is the first-responder
  /// proof (a software keyboard may be hidden under a connected Mac keyboard).
  func testTappingFieldFocusesAndTypes() {
    let app = launch()
    var field = searchField(app)
    if !field.exists {
      // The cold field is collapsed now: reveal it. A synthetic pull does not
      // arrive on this device (recorded), so use the gesture-free `...` >
      // Search entry and say so in the attachment.
      let actions = app.buttons["Library actions"]
      XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
      actions.tap()
      let search = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch
      XCTAssertTrue(search.waitForExistence(timeout: 5), "The actions drawer must offer Search")
      search.tap()
      sleep(1)
      field = searchField(app)
      XCTAssertTrue(field.waitForExistence(timeout: 5), "Search must reveal the field for tapping")
    }
    field.tap()
    sleep(1)
    tree(app, "after-field-tap-tree")
    shot("after-field-tap")
    field.typeText("Short")
    sleep(1)
    shot("after-typing-short")
    let typed = field.value as? String ?? ""
    XCTAssertTrue(typed.contains("Short"), "Typed text must land in the field (first responder); field value read back: '\(typed)'")
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", fixturePrefix)).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5), "Query 'Short' must keep matching the fixture by continuous fragment")
  }

  /// Contract: `...` > Search goes directly to input, without a second tap on
  /// the field. Typing landing (and the list filtering) is the proof.
  func testActionsMenuSearchFocusesDirectly() {
    let app = launch()
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
    actions.tap()
    sleep(1)
    tree(app, "actions-drawer-tree")
    shot("actions-drawer")
    let search = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5), "The actions drawer must offer Search")
    search.tap()
    sleep(1)
    shot("after-actions-search")
    guard let field = waitForSearchField(app, timeout: 5) else { return }
    field.typeText("zzzz-no-match")
    sleep(1)
    shot("after-typing-no-match")
    let noMatch = app.staticTexts["No documents found"]
    XCTAssertTrue(noMatch.waitForExistence(timeout: 5), "A no-match query must show 'No documents found'; field value '\(field.value as? String ?? "")'")
  }
}
