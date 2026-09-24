import XCTest

/// #29: photographs every drawer and the player, each opened the way the owner
/// opens it, so `line-colour.py` can read the colour of every hairline in them.
/// The Library's drawer is opened twice, once by a long press and once by the
/// '...', because the two came out differently. The voice drawer is photographed
/// after its list has had time to arrive, which changes its height.
/// Never presses Play; only opens and closes drawers.
final class LineColourProbe: XCTestCase {
  let title = "A Short Test of Reading Aloud"

  func capture(_ name: String, _ app: XCUIApplication, settle: TimeInterval = 1.5) {
    Thread.sleep(forTimeInterval: settle)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  /// The area behind every drawer is a button named `Close <title>`; a tap on a
  /// coordinate near the top of the screen lands on the status bar instead and
  /// closes nothing.
  func closeDrawer(_ app: XCUIApplication) {
    let close = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Close '")).firstMatch
    XCTAssertTrue(close.waitForExistence(timeout: 3), "No drawer to close")
    close.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: close)], timeout: 3)
  }

  func testPhotographDrawers() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()

    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title + ",")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10), "The fixture must be in the Library, and the Library on screen")

    row.press(forDuration: 0.7)
    XCTAssertTrue(app.buttons["Rename"].waitForExistence(timeout: 3))
    capture("library-long-press", app)
    closeDrawer(app)

    app.buttons["Actions for " + title].tap()
    XCTAssertTrue(app.buttons["Rename"].waitForExistence(timeout: 3))
    capture("library-ellipsis", app)
    closeDrawer(app)

    row.tap()
    XCTAssertTrue(app.buttons["Contents"].waitForExistence(timeout: 10))
    capture("reader-player", app, settle: 4)
    // React Native's warning banner sits over the player's Contents button, and
    // a tap there opens nothing (README, Pitfalls).
    XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Open debugger'")).firstMatch.exists,
                   "A LogBox banner covers the player: relaunch the app and run again")

    app.buttons["Contents"].tap()
    let chapter = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'The Second Chapter'")).firstMatch
    XCTAssertTrue(chapter.waitForExistence(timeout: 3))
    capture("contents", app)
    closeDrawer(app)

    app.buttons["Choose a Voice"].tap()
    // With a Provider enabled, the sheet asks for its Voices; wait for that
    // note to clear so the chip and row colours captured are the settled
    // ones, not the loading placeholder (#29 also checks the chips and the
    // voice rows, not only the sheet's own top edge).
    let asking = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Asking '")).firstMatch
    if asking.waitForExistence(timeout: 2) {
      _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
        predicate: NSPredicate(format: "exists == false"), object: asking)], timeout: 15)
    }
    capture("voices", app, settle: 2)
    closeDrawer(app)

    for page in ["Download", "Appearance"] {
      app.buttons["More actions"].tap()
      XCTAssertTrue(app.buttons[page].waitForExistence(timeout: 3))
      if page == "Download" { capture("reader-actions", app) }
      app.buttons[page].tap()
      capture("reader-" + page.lowercased(), app, settle: 2.5)
      if page == "Download" {
        // The ring around an unchecked chapter (quiet grey) and a checked one
        // (reading amber) are both a `borders` colour outside line-colour.py's
        // two hairline greys, so they are photographed for a by-eye check
        // rather than scored automatically. Only ever selects; never starts a
        // download (that needs a further tap on "Download selected").
        // A download-list checkbox row is not a `.button` to XCUITest, only a
        // label among `.any` descendants (`PauseOrderProbe.checkbox`, `DownloadRingProbe.ring`).
        let chapter = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'The First Chapter'")).firstMatch
        if chapter.waitForExistence(timeout: 3) {
          chapter.tap()
          capture("reader-download-selected", app, settle: 1)
        }
      }
      closeDrawer(app)
    }
  }

  /// #29 (live path): leaves Contents open on purpose. `borders.line` is read
  /// through `useBorders()`, so a theme change now has to re-render the open
  /// drawer's lines to pick up the new theme's colour — unlike every other
  /// colour in `INK`, which repaints with no render at all (ADR 0046). The
  /// caller (`live-theme-drawer.sh`) pushes a theme patch through the harness
  /// while this is still on screen and photographs it without reopening.
  /// Needs the Library on screen when it starts. Never presses Play.
  func testOpenContentsAndLeaveIt() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title + ",")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10), "The fixture must be in the Library, and the Library on screen")
    row.tap()
    XCTAssertTrue(app.buttons["Contents"].waitForExistence(timeout: 10))
    app.buttons["Contents"].tap()
    let chapter = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'The Second Chapter'")).firstMatch
    XCTAssertTrue(chapter.waitForExistence(timeout: 3), "Contents did not open")
    capture("contents-open-for-live-theme", app)
  }
}
