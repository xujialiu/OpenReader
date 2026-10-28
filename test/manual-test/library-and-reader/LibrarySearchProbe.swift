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
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", fixturePrefix)).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10), "fixture Document must be in the Library already")
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
    // The AX query layer on this device intermittently misses the focused
    // field (a stuck-state tree showed it focused while the query said
    // absent). Detect search-active via the bar's Close control instead,
    // polling up to 30 s, and re-snapshot the field before typing.
    let closeDuringInput = app.navigationBars.firstMatch.buttons["Close"]
    XCTAssertTrue(closeDuringInput.waitForExistence(timeout: 30), "Search must reach input (Close control appears)")
    var field = searchField(app)
    if !field.exists { field = app.searchFields.firstMatch }
    XCTAssertTrue(field.exists, "the focused search field must be in the tree (Close is up)")
    field.typeText("Short")
    sleep(1)
    let close = app.navigationBars.firstMatch.buttons["Close"]
    XCTAssertTrue(close.waitForExistence(timeout: 5), "Close must exist while a query is present")
    close.tap()
    sleep(2)
    field = searchField(app)
    let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).firstMatch
    let bar = app.navigationBars.firstMatch
    let line = "post-cancel: field exists=\(field.exists) hittable=\(field.isHittable) frame=\(field.exists ? NSCoder.string(for: field.frame) : "none") | topRow frame=\(row.exists ? NSCoder.string(for: row.frame) : "none") | bar frame=\(bar.exists ? NSCoder.string(for: bar.frame) : "none")"
    print("[diag] \(line)")
    let attachment = XCTAttachment(string: line)
    attachment.name = "post-cancel-frames"; attachment.lifetime = .keepAlways; add(attachment)
    shot("beta5-post-cancel-hold")
    tree(app, "beta5-post-cancel-tree")
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

    func beginSearch() {
      let actions = app.buttons["Library actions"]
      XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
      actions.tap()
      let search = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch
      XCTAssertTrue(search.waitForExistence(timeout: 5), "The actions drawer must offer Search")
      search.tap()
      let field = searchField(app)
      XCTAssertTrue(field.waitForExistence(timeout: 5), "Search must reach input")
    }

    // iOS 26's search-cancel icon is labelled Close in the native AX tree,
    // distinct from the field's Clear text button; scope it to the bar.
    beginSearch()
    var field = searchField(app)
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
    let restoredRow = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).firstMatch
    XCTAssertTrue(restoredRow.waitForExistence(timeout: 5), "Ordinary list must be back after cancel")
    XCTAssertEqual(restoredRow.frame.minY, ordinaryY, accuracy: 8, "Cancel must restore the ordinary list position (\(restoredRow.frame.minY) vs \(ordinaryY))")

    // Clear: the field's clear control empties the query, the ordinary list
    // returns, and the field stays revealed and available (still searching).
    beginSearch()
    field = searchField(app)
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
    let field = searchField(app)
    guard field.exists else {
      tree(app, "no-field-after-menu-search")
      XCTFail("No search field after `...` > Search")
      return
    }
    field.typeText("zzzz-no-match")
    sleep(1)
    shot("after-typing-no-match")
    let noMatch = app.staticTexts["No documents found"]
    XCTAssertTrue(noMatch.waitForExistence(timeout: 5), "A no-match query must show 'No documents found'; field value '\(field.value as? String ?? "")'")
  }
}
