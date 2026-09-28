import XCTest

/// Reproduces issue #8/#9's Library and reader actions-drawer changes: the
/// Contents note removed for an exact position, the Library's long-press and
/// '...' both raising the shared drawer with no system alert, the Delete row's
/// wording and confirmation, the '...' button centred against a wrapped title,
/// and the reader's own drawer still opening its pages with no Delete row.
/// Since #22 the Library's drawer offers no Appearance (nothing behind it shows
/// the change); the reader's keeps it. Never presses Play; only pauses if a
/// reading was already active.
final class LibraryActionsProbe: XCTestCase {
  let shortTitle = "A Short Test of Reading Aloud"
  let longTitle = "A Considerably Long Title That Will Certainly Wrap Onto Two Lines"

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func testLibraryAndReaderActions() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()

    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", shortTitle + ",")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10), "Fixture document must already be in Library")

    // Item 4: a real long press raises the same bottom drawer.
    row.press(forDuration: 0.7)
    XCTAssertTrue(app.buttons["Rename"].waitForExistence(timeout: 3), "Long press did not raise the actions drawer")
    XCTAssertFalse(app.buttons["Appearance"].exists, "#22: the Library's drawer offers no Appearance")
    XCTAssertTrue(app.buttons["Download"].exists)
    XCTAssertTrue(app.buttons["Delete"].exists, "Library-opened drawer must offer Delete")
    capture("library-long-press-drawer", app)
    app.buttons["Close " + shortTitle].tap()
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: app.buttons["Rename"])], timeout: 3), .completed)

    // Item 5: '...' raises the same drawer, and no system alert appears.
    let ellipsis = app.buttons["Actions for " + shortTitle]
    XCTAssertTrue(ellipsis.waitForExistence(timeout: 3))
    ellipsis.tap()
    XCTAssertTrue(app.buttons["Rename"].waitForExistence(timeout: 3), "'...' did not raise the actions drawer")
    XCTAssertFalse(app.buttons["Appearance"].exists, "#22: the Library's drawer offers no Appearance")
    XCTAssertEqual(app.alerts.count, 0, "'...' must not raise a system alert")
    capture("library-ellipsis-drawer", app)

    // Item 6: Delete wording and confirmation. Cancelled rather than completed;
    // see the verification report for why this fixture stayed in the Library.
    let deleteRow = app.buttons["Delete"]
    XCTAssertTrue(deleteRow.exists)
    deleteRow.tap()
    let alert = app.alerts["Delete this book?"]
    XCTAssertTrue(alert.waitForExistence(timeout: 3), "Delete must raise a confirmation titled 'Delete this book?'")
    XCTAssertTrue(alert.buttons["Delete"].exists)
    XCTAssertTrue(alert.buttons["Cancel"].exists)
    capture("library-delete-confirm", app)
    alert.buttons["Cancel"].tap()
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: alert)], timeout: 3), .completed)
    app.buttons["Close " + shortTitle].tap()

    // Item 7: the '...' button centred against a title that wraps to two lines.
    // Neither current Library title wraps, so the fixture is renamed long enough
    // to wrap, photographed, then restored immediately.
    XCTAssertTrue(ellipsis.waitForExistence(timeout: 3))
    ellipsis.tap()
    XCTAssertTrue(app.buttons["Rename"].waitForExistence(timeout: 3))
    app.buttons["Rename"].tap()
    let field = app.textFields["Display name"]
    XCTAssertTrue(field.waitForExistence(timeout: 3))
    field.buttons["Clear text"].tap()
    field.typeText(longTitle)
    app.buttons["Save"].tap()
    let longRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", longTitle + ",")).firstMatch
    XCTAssertTrue(longRow.waitForExistence(timeout: 5), "Renamed row did not appear")
    capture("library-wrapped-title-centring", app)

    let longEllipsis = app.buttons["Actions for " + longTitle]
    XCTAssertTrue(longEllipsis.waitForExistence(timeout: 3))
    longEllipsis.tap()
    XCTAssertTrue(app.buttons["Rename"].waitForExistence(timeout: 3))
    app.buttons["Rename"].tap()
    XCTAssertTrue(field.waitForExistence(timeout: 3))
    field.buttons["Clear text"].tap()
    field.typeText(shortTitle)
    app.buttons["Save"].tap()
    XCTAssertTrue(row.waitForExistence(timeout: 5), "Title was not restored")

    // Item 1 and the reader-entry risks: open the reader itself. (Item 2, the
    // Contents note, is checked separately against 仙逆 below — this fixture's
    // nav hrefs do not match its spine, so every row is permanently
    // unreachable and it can never reach the 'exact' case being tested.)
    row.tap()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 15), "Document did not reach the reader")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }

    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
    XCTAssertFalse(app.buttons["Delete"].exists, "Reader's own actions drawer must not offer Delete")
    capture("reader-actions-menu", app)

    app.buttons["Appearance"].tap()
    XCTAssertTrue(app.buttons["Increase font size"].waitForExistence(timeout: 3), "Appearance did not open from the reader")
    // #22: from the reader, Appearance still changes the page behind it. The two
    // captures are for a pixel comparison of the page above the sheet; the size
    // goes back to 16 afterwards.
    XCTAssertTrue(app.staticTexts["16"].waitForExistence(timeout: 2), "Font Size must start at 16")
    Thread.sleep(forTimeInterval: 1)
    capture("reader-appearance-16", app)
    for _ in 0..<4 { app.buttons["Increase font size"].tap() }
    XCTAssertTrue(app.staticTexts["20"].waitForExistence(timeout: 2), "Four taps on + must reach 20")
    Thread.sleep(forTimeInterval: 1)
    capture("reader-appearance-20", app)
    for _ in 0..<4 { app.buttons["Decrease font size"].tap() }
    XCTAssertTrue(app.staticTexts["16"].waitForExistence(timeout: 2), "Font Size must be back at 16")
    app.buttons["Close Appearance"].tap()

    app.buttons["More actions"].tap()
    app.buttons["Rename"].tap()
    XCTAssertTrue(app.textFields["Display name"].waitForExistence(timeout: 3), "Rename did not open from the reader")
    app.buttons["Close Rename"].tap()

    app.buttons["More actions"].tap()
    app.buttons["Download"].tap()
    let countLine = app.staticTexts.matching(NSPredicate(format: "label LIKE '* chapters downloaded'")).firstMatch
    XCTAssertTrue(countLine.waitForExistence(timeout: 10), "Download did not open from the reader")
    XCTAssertFalse(app.staticTexts["Whole document downloaded"].exists)
    XCTAssertFalse(app.staticTexts["Generating audio may incur speech service charges."].exists)
    XCTAssertFalse(app.staticTexts["Downloaded"].exists, "The per-row caption must be gone")
    capture("reader-download-view", app)
    app.buttons["Close Download"].tap()

    // Leave a clean, cold Library — also confirms the restored title persisted.
    app.terminate()
    app.launch()
    XCTAssertTrue(row.waitForExistence(timeout: 10), "Restored title did not survive a relaunch")
    capture("final-library-state", app)
  }

  /// Item 2 alone, against 仙逆: a real novel whose contents rows resolve to
  /// real spine items (see `core/document/contents.ts`'s file comment), so its
  /// last-read position can actually land on the 'exact' case. Read-only: no
  /// rename, no download, no delete — only opens Contents and closes it.
  func testContentsExactPrecision() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()
    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH '仙逆,'")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10), "Fixture document must already be in Library")
    book.tap()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 15), "Document did not reach the reader")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }

    // `status.rendered` (reading-view.tsx's `at`) arrives asynchronously after
    // the WebView's first render message, separately from the player footer
    // mounting. Opening Contents immediately after "Choose a Voice" raced that
    // and landed at the top of the 2,076-row list with nothing marked, measured
    // in this probe's own first run. Give it a moment, then retry once.
    let markedRow = app.buttons.matching(NSPredicate(format: "isSelected == true")).firstMatch
    Thread.sleep(forTimeInterval: 3)
    app.buttons["Contents"].tap()
    if !markedRow.waitForExistence(timeout: 5) {
      app.buttons["Close Contents"].tap()
      Thread.sleep(forTimeInterval: 2)
      app.buttons["Contents"].tap()
      XCTAssertTrue(markedRow.waitForExistence(timeout: 5), "No row is marked as the current position, even after a retry")
    }
    XCTAssertFalse(app.staticTexts["Several rows share this file, so the marked one is the part being read rather than the chapter within it."].exists)
    XCTAssertFalse(app.staticTexts["This page is not in the contents, so the nearest row before it is marked."].exists)
    capture("contents-exact-no-note", app)
    app.buttons["Close Contents"].tap()
  }
}
