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
      let searchField = app.searchFields.firstMatch
      if searchField.exists { return searchField }
      let textField = app.textFields.matching(NSPredicate(format: "placeholderValue == %@", "Search Library")).firstMatch
      if textField.exists { return textField }
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
    let rows = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).allElementsBoundByIndex
    guard let row = rows.min(by: { $0.frame.minY < $1.frame.minY }) else {
      XCTFail("The staged Library must contain Document rows")
      return
    }
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
    XCTAssertTrue(row.exists, "First Document must be present")
    XCTAssertLessThan(row.frame.minY, 170, "Contract 0090: the header must not reserve search-field space (first row minY \(row.frame.minY); beta1/beta2's standing field pushed it to 188)")
    let barForClip = app.navigationBars.firstMatch
    // Judge the actual topmost row against the visible navigation bar, not
    // just the window. Keep the screenshot as independent visual evidence.
    if barForClip.exists {
      XCTAssertGreaterThanOrEqual(row.frame.minY, barForClip.frame.maxY - 4, "Contract 0090: the first Document must not be clipped under the navigation bar (row minY \(row.frame.minY), bar maxY \(barForClip.frame.maxY))")
    }
    XCTAssertGreaterThanOrEqual(row.frame.minY, 0, "First Document must not be clipped at the top")
    XCTAssertLessThanOrEqual(row.frame.maxY, app.frame.maxY, "First Document must not be clipped at the bottom")
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
  func testCancelRestoresNonzeroBrowse() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    let before = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).firstMatch
    XCTAssertTrue(before.waitForExistence(timeout: 10), "app must be foregrounded on the scrolled Library")
    let beforeLabel = before.label
    let beforeFrame = NSCoder.string(for: before.frame)
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
    let clippedByBar = bar.exists && bar.frame.intersection(afterField.frame).height < 10
    XCTAssertTrue(afterFieldClipped || clippedByBar, "Close must hide the field again (field: \(afterField.exists ? NSCoder.string(for: afterField.frame) : "gone"))")
    XCTAssertEqual(app.keyboards.count, 0, "Close must dismiss the keyboard")
    let restored = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).allElementsBoundByIndex
      .min(by: { $0.frame.minY < $1.frame.minY })
    XCTAssertTrue(restored?.exists ?? false, "Ordinary list must be back")
    XCTAssertEqual(restored?.label, beforeLabel, "The same topmost Document must be restored")
    XCTAssertEqual(restored?.frame.minY ?? -1, before.frame.minY, accuracy: 8, "Nonzero browse offset must be restored (\(restored?.frame.minY ?? -1) vs \(before.frame.minY))")
    let line = "nonzero-browse: before=\(beforeLabel) @\(beforeFrame) after=\(restored?.label ?? "none") @\(restored != nil ? NSCoder.string(for: restored!.frame) : "none")"
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
    // Let the flick momentum settle, then measure the position that the
    // capture will actually see — measuring mid-momentum misreads it by a
    // row (the beta7 60 pt false drift).
    sleep(1)
    let rowsSettled = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Scroll Diag")).allElementsBoundByIndex
      .filter { $0.exists && $0.frame.minY >= 60 }
    let scrolled = rowsSettled.min(by: { $0.frame.minY < $1.frame.minY }) ?? topAfter
    let scrolledLabel = scrolled.label
    let scrolledY = scrolled.frame.minY
    shot("roundtrip-scrolled-results")
    scrolled.tap()
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
    let app = launch()
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
    actions.tap()
    let search = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5), "drawer must offer Search")
    search.tap()
    guard let field = waitForSearchField(app, timeout: 20) else { return }
    field.typeText("A Short")
    sleep(1)
    // The only match lives in Search Folder: global reach + path subtitle.
    let folderResult = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search Folder")).firstMatch
    XCTAssertTrue(folderResult.waitForExistence(timeout: 10), "the nested Folder document must be found globally with its path 'Search Folder'")
    shot("matrix-global-path-result")
    // Namesakes: rename root Scroll Diag 12 to the same name, then both appear.
    let close = app.navigationBars.firstMatch.buttons["Close"]
    close.tap()
    sleep(1)
    // Return the browse list to the top before looking for the row.
    let browseList = app.scrollViews.firstMatch
    if browseList.exists {
      browseList.swipeDown(velocity: .fast)
      browseList.swipeDown(velocity: .fast)
    }
    sleep(1)
    let sourceActions = app.buttons["Actions for Scroll Diag 12 of 12"]
    let found = sourceActions.waitForExistence(timeout: 15)
    if !found {
      shot("matrix-no-root-row-after-close")
      tree(app, "matrix-no-root-row-tree")
    }
    XCTAssertTrue(found, "root Scroll Diag 12 must exist after Close (state captured)")
    sourceActions.tap()
    let rename = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Rename")).firstMatch
    XCTAssertTrue(rename.waitForExistence(timeout: 5), "Rename action must exist")
    rename.tap()
    let alert = app.alerts.firstMatch
    XCTAssertTrue(alert.waitForExistence(timeout: 10), "rename alert must appear")
    let nameField = alert.textFields.firstMatch
    nameField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 80))
    nameField.typeText("A Short Test of Reading Aloud")
    let ok = alert.buttons["Save"]
    XCTAssertTrue(ok.waitForExistence(timeout: 5), "rename Save must exist")
    ok.tap()
    sleep(1)
    // Search again: two same-named results, distinct paths.
    let actions2 = app.buttons["Library actions"]
    actions2.tap()
    let search2 = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch
    search2.tap()
    guard let field2 = waitForSearchField(app, timeout: 20) else { return }
    field2.typeText("A Short")
    sleep(1)
    let both = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "A Short Test of Reading Aloud,")).allElementsBoundByIndex
      .filter { $0.exists && $0.frame.minY >= 60 }
    XCTAssertTrue(both.count >= 2, "two same-named results must appear; found \(both.count): \(both.map(\.label))")
    let folderOne = both.first { $0.label.contains("Search Folder") }
    let rootOne = both.first { $0.label.contains(", Library") }
    XCTAssertNotNil(folderOne, "one namesake must show the Search Folder path")
    XCTAssertNotNil(rootOne, "one namesake must show the Library (root) path")
    shot("matrix-namesake-two-paths")
    // Restore the root name via its result row's own actions button
    // (tapping the row would open the Document).
    let renameActions = app.buttons["Actions for A Short Test of Reading Aloud"]
    XCTAssertTrue(renameActions.waitForExistence(timeout: 5), "the root namesake's actions button must exist")
    renameActions.tap()
    let rename2 = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Rename")).firstMatch
    XCTAssertTrue(rename2.waitForExistence(timeout: 5), "Rename must be reachable from results")
    rename2.tap()
    let alert2 = app.alerts.firstMatch
    XCTAssertTrue(alert2.waitForExistence(timeout: 10), "second rename alert must appear")
    let nameField2 = alert2.textFields.firstMatch
    nameField2.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 80))
    nameField2.typeText("Scroll Diag 12 of 12")
    let ok2 = alert2.buttons["Save"]
    XCTAssertTrue(ok2.waitForExistence(timeout: 5), "second rename Save must exist")
    ok2.tap()
    sleep(1)
    shot("matrix-namesake-restored")
  }

  /// Matrix state restore: rename the root namesake back to
  /// `Scroll Diag 12 of 12` (its actions button is unique at root).
  func testRestoreRootName() {
    let app = launch()
    let renameActions = app.buttons["Actions for A Short Test of Reading Aloud"].firstMatch
    XCTAssertTrue(renameActions.waitForExistence(timeout: 10), "the renamed root row must exist")
    renameActions.tap()
    let rename = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Rename")).firstMatch
    XCTAssertTrue(rename.waitForExistence(timeout: 5), "Rename must exist")
    rename.tap()
    let alert = app.alerts.firstMatch
    XCTAssertTrue(alert.waitForExistence(timeout: 10), "rename alert must appear")
    let nameField = alert.textFields.firstMatch
    nameField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 80))
    nameField.typeText("Scroll Diag 12 of 12")
    let save = alert.buttons["Save"]
    XCTAssertTrue(save.waitForExistence(timeout: 5), "Save must exist")
    save.tap()
    sleep(1)
    let restored = app.buttons["Actions for Scroll Diag 12 of 12"]
    XCTAssertTrue(restored.waitForExistence(timeout: 10), "Scroll Diag 12 of 12 must be restored")
    shot("matrix-root-name-restored")
  }

  /// Matrix: while selection is active, the drawer's Search must not open
  /// input (blocked), and Select must be absent from result actions.
  func testSelectionBlocksSearch() {
    let app = launch()
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
    actions.tap()
    let select = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Select")).firstMatch
    XCTAssertTrue(select.waitForExistence(timeout: 5), "Select must exist in the drawer while not searching")
    select.tap()
    sleep(1)
    // Selection mode replaces the header: the Library actions button (the
    // only path to the drawer's Search) disappears, so search is blocked
    // structurally while selecting.
    let drawerTry = app.buttons["Library actions"]
    let blocked = !drawerTry.exists
    shot("matrix-selection-search-blocked")
    XCTAssertTrue(blocked, "Search must be unreachable during selection (Library actions still exists)")
    // Leave selection via the selection header's Cancel.
    let exit = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Cancel")).firstMatch
    XCTAssertTrue(exit.waitForExistence(timeout: 5), "the selection header must offer Cancel")
    exit.tap()
    sleep(1)
    let actionsBack = app.buttons["Library actions"]
    XCTAssertTrue(actionsBack.waitForExistence(timeout: 5), "the ordinary header must return after leaving selection")
    shot("matrix-selection-exited")
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
