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

  /// Contract: a cold ordinary Library shows NO search field or magnifier.
  /// This method documents the current build; a failure here is the #332
  /// presentation defect, not a harness problem.
  func testColdLibraryShowsNoSearchField() {
    let app = launch()
    let field = searchField(app)
    tree(app, "cold-library-tree")
    shot("cold-library")
    XCTAssertFalse(field.exists, "Contract 0090: a cold Library must show no search field; found one (frame: \(field.exists ? NSCoder.string(for: field.frame) : "n/a"))")
    if field.exists {
      XCTAssertFalse(field.isHittable, "Contract 0090: the search field must not be visible/tappable during ordinary browsing")
    }
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

  /// Contract: tapping the field begins input (first responder + typing lands).
  /// Typing landing in the field and filtering the list is the first-responder
  /// proof (a software keyboard may be hidden under a connected Mac keyboard).
  func testTappingFieldFocusesAndTypes() {
    let app = launch()
    let field = searchField(app)
    guard field.exists else {
      shot("tap-field-absent")
      XCTFail("Search field not present to tap; the cold-Library presentation already fails contract 0090")
      return
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
