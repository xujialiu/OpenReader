import XCTest

/// Verifies issue #32 on the device: Appearance's Alignment row opens the
/// system's own menu from inside the reader's drawer, the menu checks the
/// Text Alignment in force, a choice applies and closes the menu but not the
/// drawer, and a tap outside the menu closes the menu alone. Never presses Play.
///
/// The drawer is a React Native `Modal` whose backdrop closes it on a tap, and
/// the menu is SwiftUI inside that modal (ADR 0035). The tap that dismisses a
/// SwiftUI menu reaching the view underneath was an `expo-modules-core` bug
/// fixed in 57.0.9 and 57.0.17; `testDismissWithoutChoosing` is the check that
/// the fix holds here, where the view underneath is that backdrop.
final class AlignmentProbe: XCTestCase {
  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  /// A cold launch can restore the last reader; its back button is "Back".
  func ensureAtLibrary(_ app: XCUIApplication) {
    if app.buttons["Back"].waitForExistence(timeout: 3) { app.buttons["Back"].tap() }
  }

  /// The player's Play or Choose a Voice button: the reader is ready.
  @discardableResult
  func waitForReaderReady(_ app: XCUIApplication, timeout: TimeInterval = 40) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if app.buttons["Play"].exists || app.buttons["Choose a Voice"].exists { return true }
      Thread.sleep(forTimeInterval: 0.3)
    }
    return false
  }

  /// "Laying the document out…" is the WebView scroll view's label, an `Other`.
  func waitForLayout(_ app: XCUIApplication, timeout: TimeInterval = 30) {
    let loading = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS 'Laying the document out'")).firstMatch
    Thread.sleep(forTimeInterval: 0.6)
    let deadline = Date().addingTimeInterval(timeout)
    while loading.exists && Date() < deadline { Thread.sleep(forTimeInterval: 0.5) }
  }

  /// The row, whichever alignment it is showing. A button: the one element
  /// that replaces the drawn row's words starts with no traits, and was an
  /// `Other` until `ChoiceMenu` added `isButton` back.
  func alignmentRow(_ app: XCUIApplication) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Alignment, '")).firstMatch
  }

  /// A menu item by its title. SwiftUI's `Toggle` in a `Menu` is not always a
  /// `.button` to XCTest, so any element type is accepted.
  func menuItem(_ app: XCUIApplication, _ title: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", title)).firstMatch
  }

  /// Opens the book named `BOOK` (default: the short English fixture) with a
  /// real tap and its Appearance drawer, leaving playback stopped.
  func openAppearance(_ app: XCUIApplication, book title: String = "A Short Test of Reading Aloud") {
    app.terminate(); app.launch()
    ensureAtLibrary(app)
    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title + ",")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10), "\(title) is not in the Library")
    book.tap()
    XCTAssertTrue(waitForReaderReady(app), "Reader did not become ready in time")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    waitForLayout(app)
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
    app.buttons["Appearance"].tap()
    XCTAssertTrue(app.staticTexts["Font Size"].waitForExistence(timeout: 3))
  }

  /// Open the menu, read both items and the check, choose Left, and require the
  /// drawer to be still open with the row saying Left; then choose Justify.
  func testChooseFromMenuInsideDrawer() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openAppearance(app)
    let row = alignmentRow(app)
    XCTAssertTrue(row.waitForExistence(timeout: 3), "No element labelled 'Alignment, …'")
    capture("drawer-with-alignment-row", app)
    let before = row.label

    row.tap()
    XCTAssertTrue(menuItem(app, "Left").waitForExistence(timeout: 3), "The menu did not open, or has no Left")
    XCTAssertTrue(menuItem(app, "Justify").exists, "The menu has no Justify")
    capture("menu-open", app)

    let target = before.hasSuffix("Justify") ? "Left" : "Justify"
    menuItem(app, target).tap()
    Thread.sleep(forTimeInterval: 0.8)
    // The row's own words are hidden from accessibility, so an element titled
    // Left or Justify can only be a menu item.
    XCTAssertFalse(menuItem(app, "Left").exists || menuItem(app, "Justify").exists, "The menu stayed open")
    XCTAssertTrue(app.staticTexts["Font Size"].exists, "Choosing closed the drawer too")
    XCTAssertTrue(app.buttons["Close Appearance"].exists, "Choosing closed the drawer too")
    XCTAssertEqual(alignmentRow(app).label, "Alignment, " + target)
    capture("after-choosing-" + target.lowercased(), app)

    alignmentRow(app).tap()
    XCTAssertTrue(menuItem(app, before.hasSuffix("Justify") ? "Justify" : "Left").waitForExistence(timeout: 3))
    capture("menu-open-again", app)
    menuItem(app, before.hasSuffix("Justify") ? "Justify" : "Left").tap()
    Thread.sleep(forTimeInterval: 0.8)
    XCTAssertEqual(alignmentRow(app).label, before, "Choosing back did not restore the row")
    XCTAssertTrue(app.buttons["Close Appearance"].exists)
    capture("after-choosing-back", app)
  }

  /// Open the menu and dismiss it with a tap that lands on the drawer's own
  /// title, outside the menu: the menu closes, the drawer stays, nothing is
  /// chosen. Then the same with a tap on the page above the drawer, which is
  /// where the drawer's backdrop is.
  func testDismissWithoutChoosing() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openAppearance(app)
    let row = alignmentRow(app)
    XCTAssertTrue(row.waitForExistence(timeout: 3))
    let before = row.label

    row.tap()
    XCTAssertTrue(menuItem(app, "Left").waitForExistence(timeout: 3))
    // The drawer's title: inside the drawer, outside the menu.
    app.staticTexts["Appearance"].firstMatch.tap()
    Thread.sleep(forTimeInterval: 0.8)
    capture("dismissed-on-title", app)
    XCTAssertTrue(app.buttons["Close Appearance"].exists, "A tap on the title closed the drawer")
    XCTAssertEqual(alignmentRow(app).label, before, "Dismissing chose something")

    row.tap()
    XCTAssertTrue(menuItem(app, "Left").waitForExistence(timeout: 3))
    // The page above the drawer, where the backdrop that closes it is.
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
    Thread.sleep(forTimeInterval: 0.8)
    capture("dismissed-on-backdrop", app)
    let drawerOpen = app.buttons["Close Appearance"].exists
    // Recorded rather than asserted: whether one tap there closes the menu
    // alone or the menu and the drawer is the fact this step measures.
    let note = XCTAttachment(string: "drawer still open after a backdrop tap: \(drawerOpen)")
    note.name = "backdrop-tap-result"; note.lifetime = .keepAlways; add(note)
    if drawerOpen { app.buttons["Close Appearance"].tap() }
  }

  /// A tap on a word sets the highlight without playback. A switch of alignment
  /// moves words along their lines and moves no line, so the highlight has to be
  /// painted over the same words afterwards, in the same place on the screen.
  /// Judged from the two screenshots. Needs `Alignment Fixture` in the Library
  /// (`alignment-fixture.ts`) at the top of its chapter, and ends on Justify.
  func testHighlightSurvivesASwitch() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    ensureAtLibrary(app)
    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Alignment Fixture,'")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10), "Alignment Fixture is not in the Library")
    book.tap()
    XCTAssertTrue(waitForReaderReady(app), "Reader did not become ready in time")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    waitForLayout(app)
    // The second line of the first paragraph, from this fixture's own
    // screenshots on the iPhone 17: a tap between two lines does nothing.
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.36)).tap()
    Thread.sleep(forTimeInterval: 0.8)
    capture("highlight-before-switch", app)

    for (target, name) in [("Left", "highlight-after-left"), ("Justify", "highlight-after-justify")] {
      app.buttons["More actions"].tap()
      XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
      app.buttons["Appearance"].tap()
      XCTAssertTrue(alignmentRow(app).waitForExistence(timeout: 3))
      alignmentRow(app).tap()
      XCTAssertTrue(menuItem(app, target).waitForExistence(timeout: 3))
      menuItem(app, target).tap()
      Thread.sleep(forTimeInterval: 0.5)
      app.buttons["Close Appearance"].tap()
      Thread.sleep(forTimeInterval: 1.0)
      capture(name, app)
    }
  }

  /// Independent verification only, not part of #32's own plan: 仙逆 opens at
  /// its cover, so this swipes forward to find chapter 1 (screenshotting every
  /// step, since a synthetic swipe's distance on this content is not known in
  /// advance) and photographs it under Justify, then Left through the menu,
  /// then back. Judged from the screenshots: the centred chapter title/number
  /// unchanged, the paragraphs re-flowing. Never presses Play.
  func testXianniChapterOneBothAlignments() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    ensureAtLibrary(app)
    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH '仙逆,'")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10), "仙逆 is not in the Library")
    book.tap()
    XCTAssertTrue(waitForReaderReady(app), "Reader did not become ready in time")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    waitForLayout(app)
    capture("xianni-scroll-0-cover", app)
    // Measured 2026-09-22: layout can still be running through swipe 1-2 (each
    // screenshot then reads "Laying the document out…", and the swipe itself
    // does nothing while that is up); the decorative section-break page is in
    // view by swipe 3, and swipe 4 lands with "第1章 离乡" at the top of the
    // screen, right above the first paragraph — the frame this test wants.
    // Swipe 5 was one too many: it scrolled the heading out of view.
    for step in 1...4 {
      app.swipeUp()
      Thread.sleep(forTimeInterval: 1.0)
      capture("xianni-scroll-\(step)", app)
    }

    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
    app.buttons["Appearance"].tap()
    XCTAssertTrue(alignmentRow(app).waitForExistence(timeout: 3))
    capture("xianni-chapter1-justify-appearance", app)
    app.buttons["Close Appearance"].tap()
    Thread.sleep(forTimeInterval: 0.5)
    capture("xianni-chapter1-justify", app)

    app.buttons["More actions"].tap()
    app.buttons["Appearance"].tap()
    alignmentRow(app).tap()
    XCTAssertTrue(menuItem(app, "Left").waitForExistence(timeout: 3))
    menuItem(app, "Left").tap()
    Thread.sleep(forTimeInterval: 0.5)
    app.buttons["Close Appearance"].tap()
    Thread.sleep(forTimeInterval: 0.6)
    capture("xianni-chapter1-left", app)

    // Restore Justify.
    app.buttons["More actions"].tap()
    app.buttons["Appearance"].tap()
    alignmentRow(app).tap()
    XCTAssertTrue(menuItem(app, "Justify").waitForExistence(timeout: 3))
    menuItem(app, "Justify").tap()
    Thread.sleep(forTimeInterval: 0.5)
    app.buttons["Close Appearance"].tap()
    Thread.sleep(forTimeInterval: 0.5)
    capture("xianni-chapter1-restored-justify", app)
  }

  /// Independent verification only: the Appearance drawer and its Alignment
  /// menu drawn light, not only dark (#32/#33 asked for both). Switches the
  /// app to Light through General's Theme menu, opens the short fixture's
  /// Appearance drawer and the Alignment menu there, dismisses without
  /// choosing, then restores whichever theme the device had before this
  /// test. Never presses Play.
  func testAppearanceAndAlignmentMenuInLightTheme() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    ensureAtLibrary(app)
    app.buttons["Settings"].tap()
    let general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'General'")).firstMatch
    XCTAssertTrue(general.waitForExistence(timeout: 5))
    general.tap()
    let themeRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Theme,'")).firstMatch
    XCTAssertTrue(themeRow.waitForExistence(timeout: 5))
    themeRow.tap()
    XCTAssertTrue(app.buttons["Light"].waitForExistence(timeout: 3), "Theme menu did not open")
    let initial = ["Light", "Dark", "Match Device"].first { app.buttons[$0].isSelected } ?? "Dark"
    app.buttons["Light"].tap()
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: app.buttons["Light"])], timeout: 3), .completed, "Theme menu did not close")
    Thread.sleep(forTimeInterval: 0.4)
    capture("light-theme-general", app)

    // Back to Library: General's back button reaches Settings, Settings' reaches Library.
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(general.waitForExistence(timeout: 3), "Back from General did not reach Settings")
    app.navigationBars.buttons.element(boundBy: 0).tap()

    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'A Short Test of Reading Aloud,'")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10), "Fixture is not on the shelf")
    book.tap()
    XCTAssertTrue(waitForReaderReady(app), "Reader did not become ready in time")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    waitForLayout(app)
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
    app.buttons["Appearance"].tap()
    capture("light-theme-appearance-drawer", app)
    let row = alignmentRow(app)
    XCTAssertTrue(row.waitForExistence(timeout: 3))
    row.tap()
    XCTAssertTrue(menuItem(app, "Left").waitForExistence(timeout: 3), "Alignment menu did not open in Light")
    XCTAssertTrue(menuItem(app, "Justify").exists)
    capture("light-theme-alignment-menu-open", app)
    // Dismiss the menu without choosing, as testDismissWithoutChoosing does.
    app.staticTexts["Appearance"].firstMatch.tap()
    Thread.sleep(forTimeInterval: 0.4)
    XCTAssertTrue(app.buttons["Close Appearance"].exists, "Drawer closed along with the menu")
    app.buttons["Close Appearance"].tap()

    // Restore the theme this device had before this test.
    ensureAtLibrary(app)
    app.buttons["Settings"].tap()
    XCTAssertTrue(general.waitForExistence(timeout: 5))
    general.tap()
    XCTAssertTrue(themeRow.waitForExistence(timeout: 5))
    themeRow.tap()
    XCTAssertTrue(app.buttons[initial].waitForExistence(timeout: 3))
    app.buttons[initial].tap()
    Thread.sleep(forTimeInterval: 0.4)
    capture("theme-restored", app)
  }
}
