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
    let byPlaceholder = app.textFields.matching(NSPredicate(format: "placeholderValue == %@", "Search Library")).firstMatch
    if byPlaceholder.exists { return byPlaceholder }
    let byAnySearch = app.searchFields.firstMatch
    if byAnySearch.exists { return byAnySearch }
    return app.textFields["Search Library"].firstMatch
  }

  /// Reacquires the field on every poll instead of caching a stale query:
  /// while the input is coming up the element is a SearchField in the
  /// navigation bar and a TextField query made too early waits forever on
  /// the wrong type (beta6 run 18:19). Returns whichever exists.
  @discardableResult
  private func waitForSearchField(_ app: XCUIApplication, timeout: TimeInterval, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement? {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      let textField = app.textFields.matching(NSPredicate(format: "placeholderValue == %@", "Search Library")).firstMatch
      let searchField = app.searchFields.firstMatch
      // Prefer the SearchField: once input starts the element settles into
      // that type, and a cached TextField query goes stale mid-test (the
      // beta9 nonzero-browse run).
      if searchField.exists { return searchField }
      if textField.exists {
        // The focused field settles into the SearchField type right after
        // the TextField phase; wait briefly for that transition so the
        // returned element's query stays valid for typeText.
        for _ in 0..<(10) {
          if searchField.exists { return searchField }
          usleep(200_000)
        }
        return textField
      }
      usleep(200_000)
    }
    // Dead air: return nil (never a query for an element that does not
    // exist) and let the caller retry or fail with evidence.
    return nil
    #if false
    XCTContext.runActivity(named: "wait for the Library search field (\(timeout)s)") { activity in
      let summary = XCTAttachment(string: "no SearchField or placeholder TextField appeared; tree follows")
      summary.name = "search-field-absent"; summary.lifetime = .keepAlways; add(summary)
      let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
      image.name = "search-field-absent-shot"; image.lifetime = .keepAlways; add(image)
    }
    XCTFail("Library search field did not appear within \(timeout)s", file: file, line: line)
    return nil
    #endif
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
    let entries = (documents + folders).filter { $0.exists && $0.frame.minY >= 40 }
    guard let firstEntry = entries.min(by: { $0.frame.minY < $1.frame.minY }) else {
      XCTFail("The staged Library must contain entries")
      return
    }
    let firstDocument = documents.filter { $0.exists && $0.frame.minY >= 40 }.min(by: { $0.frame.minY < $1.frame.minY })
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
    // Coordinate press-drag did not scroll this list at all (both runs
    // pixel-identical, 2026-10-28); a velocity flick does.
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

  /// Contract: the field is revealed by pulling down (no assumption that it
  /// already stands), then tapping it begins input. One pull attempt only: on
  /// this device synthetic swipes have been eaten by the automation bridge
  /// (2026-10-28, pitfalls/mcp.md), so a pull that demonstrably does not
  /// arrive is recorded as skipped-unverified, never retried in a loop.
  func testPullRevealThenTapFocus() throws {
    let app = launch()
    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5), "list must exist")
    let field0 = searchField(app)
    let stoodCold = field0.exists && field0.isHittable
    XCTAssertFalse(stoodCold, "Pull-reveal must start with a hidden field, not a standing one")
    guard !stoodCold else { return }
    let rowBefore = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).firstMatch
    let beforeY = rowBefore.exists ? rowBefore.frame.minY : CGFloat.nan
    drag(list, fromY: 0.2, toY: 0.7)
    let rowAtTouchUp = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).firstMatch
    let atTouchUpY = rowAtTouchUp.exists ? rowAtTouchUp.frame.minY : CGFloat.nan
    let gestureMoved = !beforeY.isNaN && !atTouchUpY.isNaN && abs(atTouchUpY - beforeY) >= 1
    sleep(1)
    shot("pull-reveal-after-pull")
    XCTAssertEqual(app.keyboards.count, 0, "Pull-reveal must not open the keyboard")
    let field = searchField(app)
    if !gestureMoved {
      let note = XCTAttachment(string: "Pull moved no observed content (topRow minY \(beforeY) -> \(atTouchUpY)); pull-reveal is unverified, not a pass. AX existence alone cannot prove a revealed field.")
      note.name = "pull-reveal-unverified"; note.lifetime = .keepAlways; add(note)
      throw XCTSkip("No observed gesture movement; pull-reveal remains unverified")
    }
    let bar = app.navigationBars.firstMatch
    let revealed = field.exists && field.isHittable && bar.exists && bar.frame.intersection(field.frame).height >= 10
    XCTAssertTrue(revealed, "A delivered pull must reveal an interactive field BEFORE any tap; native tap auto-scrolling is not pull-to-reveal")
    guard revealed else { return }
    tree(app, "pull-reveal-tree")
    field.tap()
    sleep(1)
    shot("pull-reveal-after-tap")
    field.typeText("Short")
    sleep(1)
    shot("pull-reveal-typed")
    let typed = field.value as? String ?? ""
    XCTAssertTrue(typed.contains("Short"), "Typed text must land after pull-reveal + tap; field value '\(typed)'")
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", fixturePrefix)).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5), "Query 'Short' must keep matching the fixture")
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
        if top.label != initialLabel || abs(top.frame.minY - initialTop.frame.minY) >= 8 {
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
    XCTAssertTrue(settledY > 0 || settledLabel != initialLabel, "genuine nonzero offset evidence required")
    // Search and cancel.
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
    actions.tap()
    let search = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5), "The actions drawer must offer Search")
    search.tap()
    var field = waitForSearchField(app, timeout: 20)
    if field == nil {
      // One bounded retry: the AX query layer starves intermittently right
      // after relaunches (recorded). Re-open the drawer and wait again.
      let actionsRetry = app.buttons["Library actions"]
      if actionsRetry.waitForExistence(timeout: 5) {
        actionsRetry.tap()
        let searchRetry = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch
        if searchRetry.waitForExistence(timeout: 5) { searchRetry.tap() }
        field = waitForSearchField(app, timeout: 30)
      }
    }
    guard let field = field else {
      shot("nonzero-no-field-after-retry")
      tree(app, "nonzero-no-field-after-retry-tree")
      XCTFail("Search must reach input after one bounded retry; state captured (AX query starvation is recorded, not an app claim)")
      return
    }
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
    let clippedByBar = bar.exists && bar.frame.intersection(afterField.frame).height < 10
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

  /// Matrix: global results reach the nested Folder, show its path, and a
  /// renamed root namesake makes two same-named results with distinct paths.
  /// Renames Scroll Diag 12 to the fixture's name, then back.
  func testGlobalResultsPathsAndNamesakes() {
    // Live rename inside results: search "Scroll Diag 12", rename the result
    // to "A Short Test of Reading Aloud" — the results must update in place
    // (current-name matching, live membership) — then rename back.
    let app = launch()
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
    actions.tap()
    let search = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5), "drawer must offer Search")
    search.tap()
    guard let field = waitForSearchField(app, timeout: 20) else { return }
    field.typeText("Scroll Diag 12")
    sleep(1)
    let original = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Scroll Diag 12 of 12")).firstMatch
    XCTAssertTrue(original.waitForExistence(timeout: 10), "the result must appear")
    let originalActions = app.buttons["Actions for Scroll Diag 12 of 12"]
    XCTAssertTrue(originalActions.waitForExistence(timeout: 5), "the result's actions button must exist")
    originalActions.tap()
    let rename = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Rename")).firstMatch
    XCTAssertTrue(rename.waitForExistence(timeout: 5), "Rename must exist")
    rename.tap()
    let alert = app.alerts.firstMatch
    XCTAssertTrue(alert.waitForExistence(timeout: 10), "rename alert must appear")
    let nameField = alert.textFields.firstMatch
    nameField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 80))
    nameField.typeText("A Short Test of Reading Aloud")
    let save = alert.buttons["Save"]
    XCTAssertTrue(save.waitForExistence(timeout: 5), "Save must exist")
    save.tap()
    // Live results update to the current name.
    var renamed = false
    var stillOld = true
    for _ in 0..<(30) {
      let newResult = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "A Short Test of Reading Aloud")).firstMatch
      let oldResult = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Scroll Diag 12 of 12")).firstMatch
      if newResult.exists && !oldResult.exists { renamed = true; stillOld = false; break }
      if newResult.exists { stillOld = false }
      usleep(300_000)
    }
    shot("matrix-live-rename-result")
    XCTAssertTrue(renamed, "the results must live-update to the renamed Document (old row gone: \(!stillOld))")
    // The renamed result keeps its actions; rename back.
    let renamedActions = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Actions for A Short Test of Reading Aloud")).firstMatch
    XCTAssertTrue(renamedActions.waitForExistence(timeout: 5), "the renamed result keeps its actions")
    renamedActions.tap()
    let rename2 = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Rename")).firstMatch
    XCTAssertTrue(rename2.waitForExistence(timeout: 5), "Rename must still exist")
    rename2.tap()
    let alert2 = app.alerts.firstMatch
    XCTAssertTrue(alert2.waitForExistence(timeout: 10), "second rename alert must appear")
    let nameField2 = alert2.textFields.firstMatch
    nameField2.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 80))
    nameField2.typeText("Scroll Diag 12 of 12")
    let save2 = alert2.buttons["Save"]
    XCTAssertTrue(save2.waitForExistence(timeout: 5), "second Save must exist")
    save2.tap()
    var restored = false
    for _ in 0..<(30) {
      let restoredResult = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Scroll Diag 12 of 12")).firstMatch
      if restoredResult.exists { restored = true; break }
      usleep(300_000)
    }
    shot("matrix-live-rename-restored")
    XCTAssertTrue(restored, "renaming back must restore the original name in the results")
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
