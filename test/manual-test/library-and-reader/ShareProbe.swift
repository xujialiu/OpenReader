import XCTest

/// Verifies the actions drawer's Share button (#95) end to end: the round
/// button on the drawer's menu page, the system share sheet over the drawer
/// with the book's file, and the drawer still open after the sheet closes.
/// Real taps throughout; never presses Play.
///
/// The launch names this tree's Metro explicitly (pitfalls/metro.md, "An
/// XCTest probe's `app.launch()` does not carry `simctl`'s launch
/// arguments"): the port comes from TEST_RUNNER_OPENREADER_METRO_PORT, which
/// xcodebuild hands the runner without its prefix.
final class ShareProbe: XCTestCase {
  /// The row prefix as the Library first showed it. The first real open
  /// retitles the entry from the EPUB's own metadata ("… — Chapters 1–250"),
  /// so every lookup matches the shared prefix only.
  static let book = "The First Legendary Beast Master"

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func launch(_ app: XCUIApplication) {
    let port = ProcessInfo.processInfo.environment["OPENREADER_METRO_PORT"] ?? "8088"
    app.launchArguments = ["-RCT_jsLocation", "localhost:" + port]
    app.terminate(); app.launch()
  }

  func openDrawer(_ app: XCUIApplication) {
    let ellipsis = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Actions for " + Self.book)).firstMatch
    XCTAssertTrue(ellipsis.waitForExistence(timeout: 15), "the book's row must be on the Library")
    ellipsis.tap()
    XCTAssertTrue(app.buttons["Share"].waitForExistence(timeout: 5), "the drawer's menu page must show Share")
    XCTAssertTrue(app.buttons["Rename"].exists)
    XCTAssertTrue(app.buttons["Download"].exists)
    XCTAssertTrue(app.buttons["Delete"].exists)
  }

  /// Check 1: the drawer from the Library's `…`, the share sheet over it, and
  /// the drawer still open when the sheet closes. The sheet's items are Cell
  /// elements, not Buttons (`app.buttons["Save to Files"]` finds nothing), and
  /// tapping its own Copy cell closes it. Copy, because Save to Files opens a
  /// Files dialog no synthetic tap reliably reaches (pitfalls/mcp.md, "The
  /// share sheet's actions"): verify the shared bytes with `cmp` on the
  /// `Caches/share/` copy instead.
  func testSheetClosesBackToOpenDrawer() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    launch(app)
    openDrawer(app)

    let share = app.buttons["Share"]
    print("SHAREPROBE share frame before: \(String(describing: share.frame))")
    share.tap()

    let copy = app.cells["Copy"]
    let copySeen = copy.waitForExistence(timeout: 10)
    print("SHAREPROBE sheet Copy cell seen: \(copySeen) count=\(app.cells.matching(NSPredicate(format: "label == 'Copy'")).count)")
    capture("sheet-before-close", app)
    XCTAssertTrue(copySeen, "the sheet's Copy cell (a Cell, not a Button) must be in the tree")
    copy.tap()

    let rename = app.buttons["Rename"]
    XCTAssertTrue(rename.waitForExistence(timeout: 10), "the drawer must still be open after the sheet closed")
    let shareAgain = app.buttons["Share"]
    XCTAssertTrue(shareAgain.waitForExistence(timeout: 5), "Share must be back and enabled after the sheet closed")
    let shareValue = shareAgain.value ?? "n/a" as String
    print("SHAREPROBE share frame after: \(shareAgain.frame) disabled=\(shareValue)")
    XCTAssertEqual(app.cells.matching(NSPredicate(format: "label == 'Copy'")).count, 0, "the sheet must be gone")
    capture("drawer-after-sheet-closed", app)
  }

  /// Check 2: the reader's own drawer (More actions) shows the same button in
  /// the same place, and none of the Appearance, Rename, Download or Fonts
  /// pages does.
  func testReaderDrawerShareOnlyOnMenu() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    launch(app)
    // A restored Reader (the last run opened a book) sits over the Library.
    if app.buttons["Back"].waitForExistence(timeout: 4) { app.buttons["Back"].tap() }

    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", Self.book)).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 15), "the book must be on the Library")
    row.tap()

    let more = app.buttons["More actions"]
    XCTAssertTrue(more.waitForExistence(timeout: 30), "the reader must offer More actions")
    more.tap()

    let share = app.buttons["Share"]
    XCTAssertTrue(share.waitForExistence(timeout: 5), "the reader drawer's menu page must show Share")
    XCTAssertTrue(app.buttons["Rename"].exists && app.buttons["Download"].exists && app.buttons["Appearance"].exists)
    print("SHAREPROBE reader share frame: \(String(describing: share.frame))")
    capture("reader-drawer-menu", app)

    // Appearance: no Share. The font page (row "Font, <chosen>"): no Share either.
    app.buttons["Appearance"].tap()
    XCTAssertFalse(share.waitForExistence(timeout: 3), "Appearance must not show Share")
    let fontRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Font,'")).firstMatch
    XCTAssertTrue(fontRow.waitForExistence(timeout: 5), "Appearance must offer the Font row")
    capture("reader-drawer-appearance", app)
    fontRow.tap()
    XCTAssertFalse(app.buttons["Share"].exists, "Fonts must not show Share")
    capture("reader-drawer-fonts", app)
    app.buttons["Back from Fonts"].tap()

    // Dismiss Appearance, reopen the menu, and check Rename and Download.
    app.buttons["Close Appearance"].tap()
    XCTAssertTrue(more.waitForExistence(timeout: 5), "the reader must offer More actions again")
    more.tap()
    XCTAssertTrue(app.buttons["Share"].waitForExistence(timeout: 5))
    app.buttons["Rename"].tap()
    XCTAssertFalse(app.buttons["Share"].exists, "Rename must not show Share")
    XCTAssertTrue(app.textFields["Display name"].waitForExistence(timeout: 5))
    capture("reader-drawer-rename", app)
    app.buttons["Close Rename"].tap()
    XCTAssertTrue(more.waitForExistence(timeout: 5))
    more.tap()
    XCTAssertTrue(app.buttons["Share"].waitForExistence(timeout: 5))
    app.buttons["Download"].tap()
    XCTAssertFalse(app.buttons["Share"].exists, "Download must not show Share")
    capture("reader-drawer-download", app)
    app.buttons["Close Download"].tap()

    // Leave the reader open, drawer closed, nothing playing.
    XCTAssertFalse(app.buttons["Pause"].exists, "no playback may have started")
  }

  /// Check 3: renamed to the long name, the drawer's title wraps before the
  /// button and the button sits at the title's middle (#97); the share copy carries
  /// the renamed title with `:` become ` - `.
  func testLongTitleWrapsBeforeButtonAndShareName() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    launch(app)
    if app.buttons["Back"].waitForExistence(timeout: 4) { app.buttons["Back"].tap() }

    // Rename through the drawer's own Rename page, in chunks (pitfalls: a long
    // typeText silently drops characters).
    let long = "The First Legendary Beast Master, Volume Three: The Long Road Through the Northern Mountains and Beyond"
    let ellipsis = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Actions for " + Self.book)).firstMatch
    XCTAssertTrue(ellipsis.waitForExistence(timeout: 15), "the book's row must be on the Library")
    ellipsis.tap()
    XCTAssertTrue(app.buttons["Rename"].waitForExistence(timeout: 5))
    app.buttons["Rename"].tap()
    let field = app.textFields["Display name"]
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.buttons["Clear text"].tap()
    var rest = Substring(long)
    while !rest.isEmpty {
      field.typeText(String(rest.prefix(10)))
      rest = rest.dropFirst(10)
    }
    let typed = (field.value as? String) ?? ""
    print("SHAREPROBE typed value: \(typed)")
    XCTAssertEqual(typed, long, "the field must hold the whole long name after chunked typing")
    app.buttons["Save"].tap()

    // The renamed row, then the drawer's wrapped title with the button at its
    // middle.
    let longRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", long)).firstMatch
    XCTAssertTrue(longRow.waitForExistence(timeout: 5), "the renamed row must appear")
    let ellipsis2 = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Actions for " + long)).firstMatch
    XCTAssertTrue(ellipsis2.waitForExistence(timeout: 5))
    ellipsis2.tap()
    let share = app.buttons["Share"]
    XCTAssertTrue(share.waitForExistence(timeout: 5))
    print("SHAREPROBE long share frame: \(String(describing: share.frame))")
    let title = app.staticTexts.matching(NSPredicate(format: "label == %@", long)).firstMatch
    XCTAssertTrue(title.waitForExistence(timeout: 5), "the drawer's title must be the long name")
    print("SHAREPROBE long title frame: \(String(describing: title.frame))")
    capture("drawer-long-title", app)

    // Share it: the sheet rises over the drawer, and the cache copy carries the
    // renamed file name (read on the host). Then close the sheet by its Copy
    // cell and find the drawer still open.
    share.tap()
    let copy = app.cells["Copy"]
    XCTAssertTrue(copy.waitForExistence(timeout: 10), "the share sheet must rise over the drawer")
    capture("sheet-long-title", app)
    copy.tap()
    XCTAssertTrue(app.buttons["Rename"].waitForExistence(timeout: 10), "the drawer must still be open after the sheet")
    XCTAssertTrue(app.buttons["Share"].exists)
    capture("drawer-long-after-share", app)
  }

  /// Check 4a: with the kept library file moved away, Share stays on the menu
  /// page, no sheet rises, and one attention note says why.
  func testMissingFileShowsAttentionNote() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    launch(app)
    if app.buttons["Back"].waitForExistence(timeout: 4) { app.buttons["Back"].tap() }
    let long = "The First Legendary Beast Master, Volume Three: The Long Road Through the Northern Mountains and Beyond"
    let ellipsis = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Actions for " + long)).firstMatch
    XCTAssertTrue(ellipsis.waitForExistence(timeout: 15), "the renamed book's row must be on the Library")
    ellipsis.tap()
    let share = app.buttons["Share"]
    XCTAssertTrue(share.waitForExistence(timeout: 5))
    share.tap()

    let note = app.staticTexts["The file for this book is not on this device any more, so there is nothing to share. Add the book again to share it."]
    XCTAssertTrue(note.waitForExistence(timeout: 8), "the missing-file attention note must appear in the drawer")
    XCTAssertFalse(app.cells["Copy"].waitForExistence(timeout: 3), "no share sheet may rise without a file")
    XCTAssertTrue(app.buttons["Rename"].exists, "the drawer's rows are still there under the note")
    capture("drawer-missing-file-note", app)
  }

  /// Check 4b: with the kept file back, Share works again.
  func testShareAgainAfterFileRestored() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    launch(app)
    if app.buttons["Back"].waitForExistence(timeout: 4) { app.buttons["Back"].tap() }
    let long = "The First Legendary Beast Master, Volume Three: The Long Road Through the Northern Mountains and Beyond"
    let ellipsis = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Actions for " + long)).firstMatch
    XCTAssertTrue(ellipsis.waitForExistence(timeout: 15))
    ellipsis.tap()
    let share = app.buttons["Share"]
    XCTAssertTrue(share.waitForExistence(timeout: 5))
    share.tap()
    let copy = app.cells["Copy"]
    XCTAssertTrue(copy.waitForExistence(timeout: 10), "the share sheet must rise again with the file restored")
    capture("sheet-restored", app)
    copy.tap()
    XCTAssertTrue(app.buttons["Rename"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["Share"].exists)
    capture("drawer-restored-after-share", app)
  }
}
