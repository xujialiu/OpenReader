import XCTest

/// Library Search (#332, #339), native-touch acceptance. Real XCUITest
/// touches only; no playback, no downloads, no settings changes. The contract
/// (design 0090): no field at all during ordinary browsing, whatever the list
/// does; `…` > Search or Command-F shows the app's own field under the title
/// with the keyboard; its close control takes it away again; results can be
/// selected, moved and deleted, with the field locked while selecting.
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
    // Match the stable placeholder, which the app's text field carries
    // whatever its AX type. The query re-resolves as the field comes and goes.
    app.descendants(matching: .any).matching(NSPredicate(format: "placeholderValue == %@", "Search Library")).firstMatch.firstMatch
  }

  /// The close control beside the field (#339): a page control, not a bar item.
  private func closeButton(_ app: XCUIApplication) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label == %@", "Close")).firstMatch
  }

  /// #339 verification finding (library-search.md): while the field has the cursor, the Library actions drawer and a
  /// result's actions drawer open under the keyboard, so Select, Move to…, Download and Delete cannot be pressed. A flow
  /// about what those rows DO puts the keyboard away with its own Search key first; the finding itself is
  /// `testActionsDrawersAreReachableWithTheKeyboardUp`.
  private func putKeyboardAway(_ app: XCUIApplication) {
    guard app.keyboards.firstMatch.exists else { return }
    let key = app.keyboards.buttons.matching(NSPredicate(format: "identifier == %@ OR label == %@", "Search", "search")).firstMatch
    XCTAssertTrue(key.waitForExistence(timeout: 5), "the keyboard's Search key must be there to put the keyboard away")
    key.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5), "the Search key must put the keyboard away")
  }

  /// Drags the open half sheet down and away by its grabber.
  private func dragSheetAway(_ app: XCUIApplication) {
    let grabber = app.buttons["Sheet Grabber"]
    guard grabber.waitForExistence(timeout: 3) else { return }
    let from = grabber.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    from.press(forDuration: 0.05, thenDragTo: from.withOffset(CGVector(dx: 0, dy: 600)))
    _ = grabber.waitForNonExistence(timeout: 5)
  }

  /// Types into the search field and reads it back. XCTest's `typeText("A Short")` once left "AShort" (the space lost,
  /// #339 verification), which matched nothing and made the rest of that test read as an app fault: a query is
  /// typed again, once, after a mismatch, and the readback is asserted.
  private func typeChecked(_ field: XCUIElement, _ text: String, file: StaticString = #filePath, line: UInt = #line) {
    field.typeText(text)
    if field.value as? String != text {
      print("[diag] typeText('\(text)') left '\(field.value as? String ?? "?")'; clearing and typing again")
      let clear = field.buttons["Clear text"]
      if clear.exists { clear.tap() }
      field.typeText(text)
    }
    XCTAssertEqual(field.value as? String, text, "the field must read back what was typed", file: file, line: line)
  }

  /// `…` > Search: the only touch entry (#339).
  private func openSearch(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement? {
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist", file: file, line: line)
    actions.tap()
    let search = app.buttons["Search"]
    XCTAssertTrue(search.waitForExistence(timeout: 5), "The actions drawer must offer Search", file: file, line: line)
    search.tap()
    return waitForSearchField(app, timeout: 10, file: file, line: line)
  }

  /// The Document's actions drawer > Rename, replacing the whole name. False after an XCTFail.
  private func rename(_ app: XCUIApplication, _ actions: XCUIElement, to name: String) -> Bool {
    guard actions.waitForExistence(timeout: 5) else {
      XCTFail("The intended Document actions must exist"); return false
    }
    actions.tap()
    // The sheet rises for about 0.8 s, and a press on a row while it does misses (pitfalls/verification-runs.md, #339
    // verification: the same Rename press found no alert in one run and an alert that saved nothing in another).
    usleep(1_300_000)
    let rename = app.buttons["Rename"]
    guard rename.waitForExistence(timeout: 5) else {
      XCTFail("Rename must be offered"); return false
    }
    rename.press(forDuration: 0.2)
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
    // The alert slides up as the keyboard settles under it, and XCTest's frames lag it: right after typing Save read
    // y 482, two seconds later y 335 (the AX tree said 359 at its centre), so a press at the early frame hit the
    // dimmed page, closed nothing and saved nothing (no display-names.json, five runs, #339 verification). Press it once
    // it has stopped moving (about two seconds).
    // Two equal reads 0.7 s apart were both still the early frame, so wait a flat three seconds.
    sleep(3)
    alert.buttons["Save"].tap()
    return true
  }

  /// The header's `N selected` count, or nil outside selection.
  private func selectedCount(_ app: XCUIApplication) -> Int? {
    let header = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "^\\d+ selected$")).firstMatch
    guard header.exists else { return nil }
    return Int(header.label.components(separatedBy: " ").first ?? "")
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

  /// Contract (#339): a cold ordinary Library has NO search field at all, not
  /// even one clipped under the bar, reserves no space for one, and does not
  /// clip the first entry. On #332's beta1 (6f73fad) a standing field pushed
  /// the first row to y 188; the app's field now exists only while searching.
  func testColdLibraryShowsNoSearchField() {
    let app = launch()
    let documents = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).allElementsBoundByIndex
    let folders = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Folder,")).allElementsBoundByIndex
    // Query order is not visual order: take the smallest frame y.
    guard let firstEntry = (documents + folders).filter({ $0.exists }).min(by: { $0.frame.minY < $1.frame.minY }) else {
      XCTFail("The staged Library must contain entries")
      return
    }
    tree(app, "cold-library-tree")
    shot("cold-library")
    XCTAssertFalse(searchField(app).exists, "Contract 0090: no search field exists during ordinary browsing")
    XCTAssertFalse(closeButton(app).exists, "Contract 0090: no close control exists during ordinary browsing")
    let bar = app.navigationBars.firstMatch
    XCTAssertLessThan(firstEntry.frame.minY, 170, "Contract 0090: nothing reserves search-field space (first entry minY \(firstEntry.frame.minY))")
    if bar.exists {
      XCTAssertGreaterThanOrEqual(firstEntry.frame.minY, bar.frame.maxY - 4, "The first entry must not be clipped under the title bar (entry minY \(firstEntry.frame.minY), bar maxY \(bar.frame.maxY))")
    }
    XCTAssertEqual(app.keyboards.count, 0, "Cold ordinary browsing must have no keyboard")
  }

  /// Contract (#339): pulling down at the top of the list only bounces, and a
  /// flick that coasts back to the top shows nothing either (#338's fault).
  /// Every check is sampled while the list moves, not only at the end: the
  /// field must never exist and the page must stay the Library.
  func testPullAndFlickToTopShowNoField() {
    let app = launch()
    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5), "list must exist")
    var seen: [String] = []
    func sample(_ label: String, for seconds: Double) {
      let end = Date().addingTimeInterval(seconds)
      repeat {
        if searchField(app).exists || closeButton(app).exists { seen.append(label) }
        usleep(50_000)
      } while Date() < end
    }
    // A long, slow pull from the first row, held, then released.
    let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15))
    start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 300)), withVelocity: .slow, thenHoldForDuration: 0.5)
    sample("pull", for: 1.5)
    XCTAssertTrue(app.navigationBars["Library"].exists, "A pull must stay on the Library page")
    // Flicks away and back to the top, twice.
    for round in 1...2 {
      list.swipeUp(velocity: .fast)
      sample("flick-up-\(round)", for: 0.6)
      list.swipeDown(velocity: .fast)
      sample("flick-to-top-\(round)", for: 2.0)
    }
    shot("pull-and-flick-final")
    XCTAssertEqual(seen, [], "No search field or close control may appear while pulling or flicking (seen during: \(seen))")
    XCTAssertEqual(app.keyboards.count, 0, "Neither a pull nor a flick may open the keyboard")
    XCTAssertTrue(app.navigationBars["Library"].exists, "The page must still be the Library")
  }

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
    usleep(400_000)
    // The press itself must leave the list where it is (#339): an app-drawn `…`
    // in the title bar reached UIKit's scroll-to-top, so search noted the top.
    if let pressed = row(app, labelled: settledLabel) {
      XCTAssertEqual(pressed.frame.minY, settledY, accuracy: 4, "Pressing … must not move the list (\(pressed.frame.minY) vs \(settledY))")
    } else {
      XCTFail("the settled top row '\(settledLabel)' left the screen when … was pressed")
    }
    let search = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Search")).firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5), "The actions drawer must offer Search")
    search.tap()
    guard let field = waitForSearchField(app, timeout: 20) else { return }
    field.typeText("Short")
    sleep(1)
    let close = closeButton(app)
    XCTAssertTrue(close.waitForExistence(timeout: 5), "Close must exist while a query is present")
    close.tap()
    sleep(2)
    shot("nonzero-browse-restored")
    let afterField = searchField(app)
    XCTAssertFalse(afterField.exists, "Close must take the field away (field: \(afterField.exists ? NSCoder.string(for: afterField.frame) : "gone"))")
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

  /// #339: Settings is a bar item the phone draws, so pressing it, and coming
  /// back, leaves a scrolled list where it was.
  func testSettingsRoundTripKeepsTheListWhereItWas() {
    let app = launch()
    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5), "list must exist")
    list.swipeUp(velocity: .slow)
    sleep(2)
    guard let top = documentRows(app).min(by: { $0.frame.minY < $1.frame.minY }), top.frame.minY < 120 else {
      shot("settings-round-trip-not-scrolled"); tree(app, "settings-round-trip-not-scrolled-tree")
      XCTFail("the swipe must leave the list away from its top"); return
    }
    let label = top.label, y = top.frame.minY
    let settings = app.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 5), "Settings button must exist")
    settings.tap()
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5), "Settings must open")
    app.navigationBars.buttons.firstMatch.tap()
    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5), "Back must return to the Library")
    sleep(1)
    guard let back = row(app, labelled: label) else {
      shot("settings-round-trip-row-missing"); tree(app, "settings-round-trip-row-missing-tree")
      XCTFail("'\(label)' must still be on screen after the Settings round trip"); return
    }
    XCTAssertEqual(back.frame.minY, y, accuracy: 4, "A Settings round trip must leave the list where it was (\(back.frame.minY) vs \(y))")
    print("[diag] settings-round-trip: '\(label)' @\(y) -> @\(back.frame.minY)")
  }

  /// #339: a position at the very bottom of the list comes back exactly on
  /// Close, not short by the home indicator's room (34 pt on an iPhone).
  func testCancelRestoresTheBottomOfTheList() {
    let app = launch()
    let list = app.scrollViews.firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 5), "list must exist")
    for _ in 0..<4 { list.swipeUp(velocity: .fast); usleep(600_000) }
    sleep(2)
    let window = app.windows.firstMatch.frame
    guard let bottom = documentRows(app).filter({ $0.frame.maxY <= window.maxY }).max(by: { $0.frame.minY < $1.frame.minY }) else {
      shot("bottom-no-rows"); tree(app, "bottom-no-rows-tree")
      XCTFail("the list's bottom must show Document rows"); return
    }
    let label = bottom.label, y = bottom.frame.minY
    shot("bottom-before-search")
    guard let field = openSearch(app) else { return }
    field.typeText("Short")
    sleep(1)
    closeButton(app).tap()
    sleep(2)
    guard let back = row(app, labelled: label) else {
      shot("bottom-row-missing"); tree(app, "bottom-row-missing-tree")
      XCTFail("'\(label)' must be back after Close"); return
    }
    shot("bottom-after-close")
    XCTAssertEqual(back.frame.minY, y, accuracy: 4, "Close must return to the list's very bottom (\(back.frame.minY) vs \(y))")
    print("[diag] bottom-restore: '\(label)' @\(y) -> @\(back.frame.minY)")
  }

  /// Document rows on screen, below the title bar.
  private func documentRows(_ app: XCUIApplication) -> [XCUIElement] {
    app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).allElementsBoundByIndex
      .filter { $0.exists && $0.frame.minY >= 60 }
  }

  /// The row with exactly this label, waiting up to six seconds for it.
  private func row(_ app: XCUIApplication, labelled label: String) -> XCUIElement? {
    for _ in 0..<20 {
      if let found = app.buttons.matching(NSPredicate(format: "label == %@", label)).allElementsBoundByIndex.first(where: { $0.exists }) {
        return found
      }
      usleep(300_000)
    }
    return nil
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
    // XCTest's swipeUp starts at 80% of the list's height, which is under the keyboard while it is up (the list is
    // 758 pt tall from y 116, the keyboard starts at y 590): that swipe began on the keys and moved nothing
    // (#339 verification: first row at 190 before and after). Drag from just above the keyboard instead.
    let dragKeyboardTop = app.keyboards.firstMatch.exists ? app.keyboards.firstMatch.frame.minY : app.frame.maxY
    let dragFrom = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 200, dy: dragKeyboardTop - 30))
    dragFrom.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 200, dy: 200)), withVelocity: .fast, thenHoldForDuration: 0)
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
    // The drawer's first press while the keyboard is up only puts the keyboard away (React Native's
    // keyboardShouldPersistTaps "never", #339 verification), so a flow about renaming puts it away first.
    func rename(_ actions: XCUIElement, to name: String) -> Bool { putKeyboardAway(app); return self.rename(app, actions, to: name) }
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
    if !app.buttons["Clear text"].exists { field.tap() }
    app.buttons["Clear text"].tap()
    field.typeText(oldName)
    XCTAssertTrue(app.buttons[oldName + ", Library"].waitForExistence(timeout: 5),
                  "The same Document must be searchable by its restored current name")
    closeButton(app).tap()
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
    let hidden = !fieldAfter.exists
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
    let cleared = !coldField.exists
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
      putKeyboardAway(app)
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
    // The clear button shows only while the field is being edited, and the keyboard was put away for the drawers.
    if !app.buttons["Clear text"].exists { field.tap() }
    app.buttons["Clear text"].tap()
    XCTAssertTrue(app.buttons["A Short Test of Reading Aloud, Not started."].waitForExistence(timeout: 5),
                  "Empty input must show the original Folder's ordinary contents")
    closeButton(app).tap()
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

  /// Matrix: hardware keyboard CmdF opens search into its field, Escape closes
  /// it, and neither acts on the Reader. Runs in the current theme (dark during the
  /// matrix) so the screenshots double as appearance evidence.
  func testHardwareCmdFAndEscape() {
    let app = launch()
    let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10), "a Document must be in the Library")
    app.typeKey("f", modifierFlags: .command)
    let close = closeButton(app)
    XCTAssertTrue(close.waitForExistence(timeout: 10), "CmdF must reveal the search (Close appears)")
    shot("matrix-cmdf-revealed")
    guard let field = waitForSearchField(app, timeout: 10) else { return }
    field.typeText("Scroll Diag")
    sleep(1)
    app.typeKey("\u{1b}", modifierFlags: [])
    sleep(1)
    let afterEscape = searchField(app)
    shot("matrix-escape-hidden")
    XCTAssertFalse(afterEscape.exists, "Escape must close search and take the field away (field: \(afterEscape.exists ? NSCoder.string(for: afterEscape.frame) : "gone"))")
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
    putKeyboardAway(app)
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

  /// Matrix (#339): a result's actions drawer keeps the single-Document actions
  /// and offers Select, which starts a selection of results with it selected.
  func testResultActionsOfferSelect() {
    let app = launch()
    guard let field = openSearch(app) else { return }
    field.typeText("Scroll Diag 02")
    let resultActions = app.buttons["Actions for Scroll Diag 02 of 12"]
    XCTAssertTrue(resultActions.waitForExistence(timeout: 5), "the result's actions button must exist")
    putKeyboardAway(app)
    resultActions.tap()
    sleep(1)
    for expected in ["Rename", "Download", "Share", "Delete", "Move", "Select"] {
      XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", expected)).firstMatch.exists,
        "the result actions drawer must offer \(expected)")
    }
    shot("matrix-result-actions-select")
    app.buttons.matching(NSPredicate(format: "label == %@", "Select")).firstMatch.tap()
    XCTAssertTrue(app.navigationBars["1 selected"].waitForExistence(timeout: 5), "Select must start a selection holding that result")
    XCTAssertEqual(field.value as? String, "Scroll Diag 02", "Selecting must keep the query")
    XCTAssertFalse(field.isEnabled, "Selecting must lock the field")
    app.buttons["Cancel"].tap()
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    closeButton(app).tap()
  }

  /// Matrix: during a Folder's selection, CmdF opens no search (the missing
  /// drawer button alone is not proof), and Escape ends the selection.
  func testSelectionBlocksCmdF() {
    let app = launch()
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5), "Library actions button must exist")
    actions.tap()
    let select = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Select")).firstMatch
    XCTAssertTrue(select.waitForExistence(timeout: 5), "Select must exist")
    select.tap()
    XCTAssertTrue(app.navigationBars["0 selected"].waitForExistence(timeout: 5))
    app.typeKey("f", modifierFlags: .command)
    sleep(2)
    shot("matrix-selection-cmdf")
    XCTAssertFalse(searchField(app).exists || closeButton(app).exists, "CmdF must not open search during selection")
    XCTAssertTrue(app.navigationBars["0 selected"].exists, "CmdF must leave the selection as it was")
    app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
    let ended = app.navigationBars["Library"].waitForExistence(timeout: 5)
    shot("matrix-selection-escape")
    XCTAssertTrue(ended, "Escape must end the selection")
    if !ended { app.buttons["Cancel"].tap() }
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
    let close = closeButton(app)
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
    let close = closeButton(app)
    XCTAssertTrue(close.exists); close.tap()
    XCTAssertEqual(app.keyboards.count, 0)
    shot("ime-restored-ordinary-library")
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
    let close = closeButton(app)
    XCTAssertTrue(close.exists && close.isEnabled, "Active search must keep an enabled native Close after blur")
    close.tap()
    sleep(1)
    let after = searchField(app)
    XCTAssertTrue(!after.exists)
    shot("close-after-input-dismissal")
  }

  /// The #339 verification finding: with the cursor in the field (keyboard up), the Library actions drawer and a result's
  /// actions drawer open UNDER the keyboard (iPhone 17: the rows from y 560 down, the keyboard from about y 590), so
  /// Select, Move to…, Download and Delete cannot be pressed until the owner puts the keyboard away. Every row of
  /// either drawer must be reachable, whatever the field is doing. Red until the app puts the keyboard away when a
  /// drawer opens, or lifts the sheet above it.
  func testActionsDrawersAreReachableWithTheKeyboardUp() {
    let app = launch()
    guard let field = openSearch(app) else { return }
    field.typeText("Diag 12")
    XCTAssertTrue(app.keyboards.firstMatch.exists, "the keyboard is up while the field has the cursor")
    XCTAssertTrue(app.buttons["Scroll Diag 12 of 12, Library"].waitForExistence(timeout: 5))
    func reachable(_ names: [String], in drawer: String) {
      sleep(2)
      shot("drawer-\(drawer)-keyboard-up")
      let keyboardTop = app.keyboards.firstMatch.exists ? app.keyboards.firstMatch.frame.minY : app.frame.maxY
      for name in names {
        let row = app.buttons.matching(NSPredicate(format: "label == %@", name)).firstMatch
        XCTAssertTrue(row.exists, "\(drawer): '\(name)' must be offered")
        XCTAssertTrue(row.exists && row.isHittable && row.frame.maxY <= keyboardTop + 1,
          "\(drawer): '\(name)' must be reachable above the keyboard (row \(NSCoder.string(for: row.frame)), hittable \(row.isHittable), keyboard top \(keyboardTop))")
      }
    }
    app.buttons["Actions for Scroll Diag 12 of 12"].tap()
    reachable(["Rename", "Move to…", "Download", "Select", "Delete"], in: "result-actions")
    dragSheetAway(app)
    app.buttons["Library actions"].tap()
    reachable(["Import file", "Create folder", "Select"], in: "library-actions")
    dragSheetAway(app)
    if closeButton(app).exists { closeButton(app).tap() }
  }

  /// Diagnosis, not acceptance (#339 verification): types a rename into the real alert with XCTest's `typeText`, as
  /// `rename()` does, and then waits 25 s WITHOUT pressing Save, so that another tool can press it and read what the
  /// app stored (`Documents/display-names.json`). Separates "XCTest's typed text is not what the app submits" from "XCTest's
  /// press on Save does nothing".
  func testStageRenameAlertTypedAndWait() {
    let app = launch()
    let actions = app.buttons["Actions for Scroll Diag 12 of 12"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5))
    actions.tap()
    usleep(1_300_000)
    app.buttons["Rename"].press(forDuration: 0.2)
    let alert = app.alerts.firstMatch
    XCTAssertTrue(alert.waitForExistence(timeout: 5), "Rename alert must appear")
    let input = alert.textFields.firstMatch
    input.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
    input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 80))
    input.typeText("A Short Test of Reading Aloud")
    print("[diag] typed: field reads '\(input.value as? String ?? "?")', Save enabled \(alert.buttons["Save"].isEnabled)")
    shot("rename-typed-waiting")
    let save = alert.buttons["Save"]
    print("[diag] Save frame \(NSCoder.string(for: save.frame)), hittable \(save.isHittable), alert frame \(NSCoder.string(for: alert.frame))")
    sleep(2)
    print("[diag] two seconds later: Save frame \(NSCoder.string(for: alert.buttons["Save"].frame)), alert frame \(NSCoder.string(for: alert.frame)), field frame \(NSCoder.string(for: input.frame))")
    if ProcessInfo.processInfo.environment["OPENREADER_SAVE_BY"] == "return" {
      input.typeText("\n")
      sleep(2)
      print("[diag] after Return: alert exists \(alert.exists)")
      return
    }
    if ProcessInfo.processInfo.environment["OPENREADER_SAVE_BY"] == "coordinate" {
      app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: save.frame.midX, dy: save.frame.midY)).press(forDuration: 0.2)
      sleep(2)
      print("[diag] after the coordinate press: alert exists \(alert.exists)")
      return
    }
    sleep(25)
    print("[diag] after the wait: alert exists \(alert.exists)")
  }

  /// Matching rules of design 0090 (#339), through the app's own field: a name matches when it holds the typed
  /// text as one continuous fragment, whatever the letter case, anywhere in the Library; words are not matched
  /// one by one; a Folder's name is not a result; a result shows its Folder path where the excerpt was, and
  /// results keep the Library's order. Needs `Scroll Diag 01 … 12 of 12` at the root and the short test in
  /// `Search Folder`. Each query is typed with XCTest's `typeText`, so the field reads back as typed.
  func testMatchingRules() {
    let app = launch()
    guard let field = openSearch(app) else { return }
    /// The Document rows on show, top to bottom, as the labels the app gives them ("name, Folder path").
    func shown() -> [String] {
      app.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND NOT label BEGINSWITH %@", ", Library", "Actions for")).allElementsBoundByIndex
        .filter { $0.exists }.sorted { $0.frame.minY < $1.frame.minY }.map(\.label)
    }
    func query(_ text: String) -> [String] {
      if app.buttons["Clear text"].exists { app.buttons["Clear text"].tap() }
      field.typeText(text)
      XCTAssertEqual(field.value as? String, text, "the field must read back what was typed")
      let none = app.staticTexts["No documents found"]
      _ = none.waitForExistence(timeout: 1.5)
      sleep(1)
      let rows = shown()
      print("[diag] matching '\(text)' -> \(rows) none=\(none.exists)")
      return rows
    }
    XCTAssertEqual(query("diag 12"), ["Scroll Diag 12 of 12, Library"], "lower case finds the capitalised name by a fragment")
    XCTAssertEqual(query("DIAG 1"), ["Scroll Diag 12 of 12, Library", "Scroll Diag 11 of 12, Library", "Scroll Diag 10 of 12, Library"],
                   "upper case matches too, and results keep the Library's order (most recent first)")
    shot("matching-diag-1")
    XCTAssertEqual(query("short"), ["A Short Test of Reading Aloud, Library → Search Folder"], "a Document inside a Folder is found from the root, with its Folder path")
    shot("matching-short-in-folder")
    XCTAssertEqual(query("Diag Scroll"), [], "words are not matched independently or out of order")
    XCTAssertTrue(app.staticTexts["No documents found"].exists, "no match says so")
    XCTAssertEqual(query("Search Folder"), [], "a Folder's name is not a result")
    XCTAssertTrue(app.staticTexts["No documents found"].exists, "a Folder name matches no Document")
    shot("matching-folder-name-no-result")
    XCTAssertEqual(query("12 of"), ["Scroll Diag 12 of 12, Library"], "a fragment from the middle of the name matches")
    app.buttons["Clear text"].tap()
    XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Not started.")).firstMatch.waitForExistence(timeout: 5),
                  "an empty field shows the Folder's own list, with its excerpts")
    XCTAssertTrue(shown().isEmpty, "an empty field shows no search results (no Folder path lines)")
    closeButton(app).tap()
    XCTAssertTrue(field.waitForNonExistence(timeout: 5), "Close takes the field away")
  }

  /// Contract: clearing input shows the ordinary list again but stays in
  /// search (field available); closing ends search, takes the field away and
  /// restores the ordinary position. The field reads back its placeholder as
  /// the value when empty.
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

    // The close control beside the field is `Close`; the field's own clear
    // button inside it is `Clear text`.
    guard var field = beginSearch() else { return }
    field.typeText("Short")
    sleep(1)
    XCTAssertTrue((field.value as? String ?? "").contains("Short"), "query typed")
    let cancel = closeButton(app)
    XCTAssertTrue(cancel.exists, "Cancel control must exist while a query is present")
    cancel.tap()
    sleep(1)
    shot("cancel-restores-ordinary")
    let afterField = searchField(app)
    let bar = app.navigationBars.firstMatch
    let clippedOrGone = !afterField.exists
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
      // There is no field until Search is chosen (#339).
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

  /// Contract (#339): `…` > Search shows the app's field under the title with
  /// the keyboard up and the cursor in it, and its close control beside it,
  /// where the phone drew its own stacked field (iPhone 17: the capsule at
  /// {{16, 117}, {315, 44}}, Close at {{342, 117}, {44, 44}}; notes
  /// 2026-11-01). The text input itself starts 42 points into the capsule.
  /// Frames and a screenshot are kept for comparison with the phone's.
  func testSearchShowsFieldWithKeyboardWhereThePhoneDrewIt() {
    let app = launch()
    guard let field = openSearch(app) else { return }
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "Search must open the keyboard without another tap")
    XCTAssertEqual(field.value(forKey: "hasKeyboardFocus") as? Bool, true, "The cursor must be in the field")
    let close = closeButton(app)
    XCTAssertTrue(close.exists && close.isEnabled, "The close control must be there before any text")
    let line = "field frames: input=\(NSCoder.string(for: field.frame)) close=\(NSCoder.string(for: close.frame)) bar=\(NSCoder.string(for: app.navigationBars.firstMatch.frame))"
    print("[diag] \(line)")
    let attachment = XCTAttachment(string: line)
    attachment.name = "search-field-frames"; attachment.lifetime = .keepAlways; add(attachment)
    shot("search-field-open-empty")
    XCTAssertEqual(field.frame.minY, 117, accuracy: 3, "The field's top must sit where the phone's did")
    XCTAssertEqual(field.frame.height, 44, accuracy: 3, "The field must be the phone's 44 points tall")
    XCTAssertEqual(field.frame.minX, 58, accuracy: 3, "The words must start where the phone's did")
    XCTAssertEqual(close.frame.minX, 342, accuracy: 3, "Close must sit where the phone's did")
    XCTAssertEqual(close.frame.width, 44, accuracy: 3, "Close must be the phone's 44 points")
    XCTAssertEqual(close.frame.midY, field.frame.midY, accuracy: 2, "Close must be centred on the field")
    field.typeText("Scroll Diag")
    shot("search-field-typed")
    close.tap()
    XCTAssertTrue(field.waitForNonExistence(timeout: 5), "Close must take the field away")
    XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5), "Close must put the keyboard away")
  }

  /// Contract (#339): results from different Folders are selected together,
  /// with the field locked; Move opens where search began, acts where at least
  /// one is not already, leaves the ones already there, and afterwards ends
  /// selection but keeps search, its query and the new paths. Needs Scroll
  /// Diag 10 to 12 at the root and Search Folder; leaves them as it found them.
  func testSelectResultsAcrossFoldersAndMove() {
    let app = launch()
    guard let field = openSearch(app) else { return }
    field.typeText("Scroll Diag 1")
    let names = ["Scroll Diag 10 of 12", "Scroll Diag 11 of 12", "Scroll Diag 12 of 12"]
    for name in names { XCTAssertTrue(app.buttons[name + ", Library"].waitForExistence(timeout: 5), "\(name) must be at the root") }
    // Put one of them in another Folder through its own Move.
    putKeyboardAway(app)
    app.buttons["Actions for Scroll Diag 12 of 12"].tap()
    let moveTo = app.buttons["Move to…"]
    XCTAssertTrue(moveTo.waitForExistence(timeout: 5)); moveTo.tap()
    let commit = app.buttons.matching(NSPredicate(format: "label == %@", "Move")).firstMatch
    app.buttons["Search Folder"].tap()
    XCTAssertTrue(commit.waitForExistence(timeout: 5) && commit.isEnabled); commit.tap()
    XCTAssertTrue(app.buttons["Scroll Diag 12 of 12, Library → Search Folder"].waitForExistence(timeout: 5))

    func selectAll() {
      putKeyboardAway(app)
      app.buttons["Library actions"].tap()
      let select = app.buttons.matching(NSPredicate(format: "label == %@", "Select")).firstMatch
      XCTAssertTrue(select.waitForExistence(timeout: 5), "Library actions must offer Select while searching"); select.tap()
      XCTAssertTrue(app.navigationBars["0 selected"].waitForExistence(timeout: 5))
      app.buttons["Select all"].tap()
      XCTAssertTrue(app.navigationBars["3 selected"].waitForExistence(timeout: 5), "Select all must take every result")
    }
    func openMove() {
      let move = app.buttons["Move selected"]
      XCTAssertTrue(move.waitForExistence(timeout: 5) && move.isEnabled); move.tap()
      XCTAssertTrue(app.staticTexts["Move to…"].waitForExistence(timeout: 5))
    }
    func afterMove(_ path: String) {
      XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5), "Moving must end the selection")
      for name in names { XCTAssertTrue(app.buttons[name + ", " + path].waitForExistence(timeout: 5), "\(name) must show \(path)") }
      XCTAssertEqual(field.value as? String, "Scroll Diag 1", "Moving must keep the query")
      XCTAssertTrue(field.isEnabled, "The field must unlock with selection")
    }

    selectAll()
    XCTAssertFalse(field.isEnabled, "Selecting must lock the field")
    XCTAssertFalse(closeButton(app).isEnabled, "Selecting must lock the close control")
    XCTAssertEqual(field.value as? String, "Scroll Diag 1")
    XCTAssertEqual(app.keyboards.count, 0, "Selecting must put the keyboard away")
    shot("results-selected-locked")
    openMove()
    XCTAssertTrue(app.staticTexts["Library"].exists, "Move must open where search began")
    XCTAssertTrue(commit.isEnabled, "Move must act where one of them is not already")
    commit.tap()
    afterMove("Library")
    shot("results-moved-to-root")

    selectAll()
    openMove()
    XCTAssertFalse(commit.isEnabled, "Move must not act where every one of them already is")
    app.buttons["Search Folder"].tap()
    XCTAssertTrue(commit.isEnabled); commit.tap()
    afterMove("Library → Search Folder")
    shot("results-moved-to-folder")

    selectAll()
    openMove()
    // All three are in Search Folder now, and the page opens where search began, the root: no "Back to Library".
    XCTAssertFalse(app.buttons["Back to Library"].exists, "Move must open at the Folder where search began, not where the Documents are")
    XCTAssertTrue(commit.isEnabled, "Move must act at the root, where none of them is")
    commit.tap()
    afterMove("Library")
    closeButton(app).tap()
    XCTAssertTrue(field.waitForNonExistence(timeout: 5))
  }

  /// Contract (#339, #227): a selection of results whose move would put two
  /// Documents of one name in a Folder is refused whole, naming the Document.
  /// Stages a root namesake of the Document in Search Folder from Scroll Diag
  /// 11 and restores it.
  func testSameNameRefusesWholeMove() {
    let app = launch()
    let shared = "A Short Test of Reading Aloud"
    guard rename(app, app.buttons["Actions for Scroll Diag 11 of 12"], to: shared) else { return }
    defer {
      // Restore the fixture whatever happened above.
      dragSheetAway(app)
      if !app.navigationBars["Library"].exists, app.buttons["Cancel"].exists, app.buttons["Cancel"].isEnabled { app.buttons["Cancel"].tap() }
      if closeButton(app).exists, closeButton(app).isEnabled { closeButton(app).tap() }
      let root = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", shared + ",", "Not started.")).allElementsBoundByIndex
      if let namesake = root.first(where: { $0.exists }) {
        let actions = app.buttons.matching(NSPredicate(format: "label == %@", "Actions for " + shared)).allElementsBoundByIndex
          .first { abs($0.frame.midY - namesake.frame.midY) < 5 }
        if let actions { _ = rename(app, actions, to: "Scroll Diag 11 of 12") }
      }
      XCTAssertTrue(app.buttons["Actions for Scroll Diag 11 of 12"].waitForExistence(timeout: 5), "The fixture must be restored")
    }
    guard let field = openSearch(app) else { return }
    typeChecked(field, "A Short")
    XCTAssertTrue(app.buttons[shared + ", Library"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons[shared + ", Library → Search Folder"].waitForExistence(timeout: 5))
    putKeyboardAway(app)
    app.buttons["Library actions"].tap()
    app.buttons.matching(NSPredicate(format: "label == %@", "Select")).firstMatch.tap()
    app.buttons["Select all"].tap()
    XCTAssertTrue(app.navigationBars["2 selected"].waitForExistence(timeout: 5))
    app.buttons["Move selected"].tap()
    let commit = app.buttons.matching(NSPredicate(format: "label == %@", "Move")).firstMatch
    XCTAssertTrue(commit.waitForExistence(timeout: 5) && commit.isEnabled)
    commit.tap()
    let alert = app.alerts["Could not move"]
    XCTAssertTrue(alert.waitForExistence(timeout: 5), "The move must be refused")
    let message = alert.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: " ")
    XCTAssertTrue(message.contains(shared), "The refusal must name the Document (\(message))")
    print("[diag] same-name refusal: alert '\(alert.label)' says: \(message)")
    shot("same-name-refused")
    alert.buttons.firstMatch.tap()
    // In a selection the rows are checkboxes, not buttons, so look for them by label among everything.
    let rows = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR label == %@", shared + ", Library", shared + ", Library → Search Folder"))
      .allElementsBoundByIndex.filter { $0.exists }.map(\.label)
    XCTAssertEqual(Set(rows), [shared + ", Library", shared + ", Library → Search Folder"], "A refused move must move nothing (rows now: \(rows))")
    // Put the drawer away by dragging it down.
    dragSheetAway(app)
    XCTAssertTrue(app.buttons["Sheet Grabber"].waitForNonExistence(timeout: 5), "the Move page must go")
  }

  /// Contract (#339): while results are selected the field and its Close are greyed AND do nothing: a touch on the
  /// field brings no keyboard, a touch on Close neither closes search nor ends the selection, and the query is the
  /// one the selected Documents were found by.
  func testLockedFieldAndCloseDoNothing() {
    let app = launch()
    guard let field = openSearch(app) else { return }
    typeChecked(field, "Scroll Diag 1")
    XCTAssertTrue(app.buttons["Scroll Diag 10 of 12, Library"].waitForExistence(timeout: 5))
    putKeyboardAway(app)
    app.buttons["Library actions"].tap()
    app.buttons.matching(NSPredicate(format: "label == %@", "Select")).firstMatch.tap()
    app.buttons["Select all"].tap()
    XCTAssertTrue(app.navigationBars["3 selected"].waitForExistence(timeout: 5))
    XCTAssertFalse(field.isEnabled, "the field is greyed")
    XCTAssertFalse(closeButton(app).isEnabled, "Close is greyed")
    field.tap()
    sleep(1)
    XCTAssertEqual(app.keyboards.count, 0, "a touch on the greyed field must not bring the keyboard")
    XCTAssertEqual(field.value as? String, "Scroll Diag 1", "the query cannot change while selecting")
    closeButton(app).tap()
    sleep(1)
    XCTAssertTrue(field.exists, "a touch on the greyed Close must not close search")
    XCTAssertTrue(app.navigationBars["3 selected"].exists, "nor end the selection")
    shot("locked-field-and-close-touched")
    app.buttons["Cancel"].tap()
    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5))
    XCTAssertTrue(field.isEnabled && closeButton(app).isEnabled, "both unlock with the selection")
    XCTAssertEqual(field.value as? String, "Scroll Diag 1")
    closeButton(app).tap()
    XCTAssertTrue(field.waitForNonExistence(timeout: 5))
  }

  /// Staging for `keys-trial.sh`-style key trials with results SELECTED (#339 verification), not an acceptance check:
  /// search "Scroll Diag 1" (checked typing), put the keyboard away, select all three results through `…` > Select, then
  /// wait up to 150 s, until search is closed by something else (another tool's Escape), for keys to be sent.
  func testStageSelectedResultsAndWait() {
    let app = launch()
    guard let field = openSearch(app) else { return }
    typeChecked(field, "Scroll Diag 1")
    XCTAssertTrue(app.buttons["Scroll Diag 10 of 12, Library"].waitForExistence(timeout: 5))
    putKeyboardAway(app)
    app.buttons["Library actions"].tap()
    app.buttons.matching(NSPredicate(format: "label == %@", "Select")).firstMatch.tap()
    app.buttons["Select all"].tap()
    XCTAssertTrue(app.navigationBars["3 selected"].waitForExistence(timeout: 5))
    print("[diag] staged: 3 selected, query '\(field.value as? String ?? "?")', field enabled \(field.isEnabled); waiting for keys")
    XCTAssertTrue(field.waitForNonExistence(timeout: 150), "search was never closed from outside")
    print("[diag] staged search closed from outside; heading now '\(app.navigationBars.firstMatch.identifier)'")
  }

  /// Contract (#339): Escape ends a selection of results first, keeping
  /// search and its query; a second Escape closes search.
  func testEscapeEndsSelectionThenSearch() {
    let app = launch()
    app.typeKey("f", modifierFlags: .command)
    guard let field = waitForSearchField(app, timeout: 10) else { return }
    field.typeText("Scroll Diag 1")
    XCTAssertTrue(app.buttons["Scroll Diag 10 of 12, Library"].waitForExistence(timeout: 5))
    putKeyboardAway(app)
    app.buttons["Library actions"].tap()
    app.buttons.matching(NSPredicate(format: "label == %@", "Select")).firstMatch.tap()
    app.buttons["Select all"].tap()
    XCTAssertTrue(app.navigationBars["3 selected"].waitForExistence(timeout: 5))
    app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5), "The first Escape must end the selection")
    XCTAssertTrue(field.exists && field.isEnabled, "The first Escape must keep search")
    XCTAssertEqual(field.value as? String, "Scroll Diag 1")
    shot("escape-ended-selection")
    app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
    XCTAssertTrue(field.waitForNonExistence(timeout: 5), "The second Escape must close search")
    shot("escape-closed-search")
  }

  /// Contract (#339): a selection of results deletes through the same
  /// confirmation as a Folder's selection, and search stays. Restage Scroll
  /// Diag 01 at the root first; this deletes it.
  func testDeleteSelectedResult() {
    let app = launch()
    guard let field = openSearch(app) else { return }
    field.typeText("Scroll Diag 01")
    XCTAssertTrue(app.buttons["Scroll Diag 01 of 12, Library"].waitForExistence(timeout: 5), "Restage Scroll Diag 01 at the root")
    putKeyboardAway(app)
    app.buttons["Library actions"].tap()
    app.buttons.matching(NSPredicate(format: "label == %@", "Select")).firstMatch.tap()
    app.buttons["Select all"].tap()
    XCTAssertTrue(app.navigationBars["1 selected"].waitForExistence(timeout: 5))
    app.buttons["Delete selected"].tap()
    let alert = app.alerts["Delete selected entries?"]
    XCTAssertTrue(alert.waitForExistence(timeout: 5), "Delete must ask first")
    alert.buttons["Delete"].tap()
    XCTAssertTrue(app.staticTexts["No documents found"].waitForExistence(timeout: 10), "The deleted result must leave the results")
    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5), "Deleting must end the selection")
    XCTAssertEqual(field.value as? String, "Scroll Diag 01", "Deleting must keep the query")
    shot("selected-result-deleted")
    closeButton(app).tap()
  }
}
