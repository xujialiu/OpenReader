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
