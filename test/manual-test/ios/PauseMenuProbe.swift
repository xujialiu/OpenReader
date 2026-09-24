import XCTest

/// Verifies #60/ADR 0047 on the device: General's "Reading aloud" card (two
/// menu rows, under its own header, directly above the now-headerless bracket
/// card), both Pause menus opened with real touches — their values in order,
/// the current one checked, choosing updates the row — the row's own
/// accessibility label, and the longer paragraph label at a larger Dynamic
/// Type. Never presses Play.
final class PauseMenuProbe: XCTestCase {
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

  /// A menu item by its title. A SwiftUI `Toggle` inside a `Menu` is not
  /// always a `.button` to XCTest (AlignmentProbe), so any element type is
  /// accepted.
  func menuItem(_ app: XCUIApplication, _ title: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", title)).firstMatch
  }

  /// The row, whichever value it is showing. A button: the one element that
  /// replaces the drawn row's words starts with no traits, and was an `Other`
  /// until `ChoiceMenu` added `isButton` back (AlignmentProbe measured the
  /// same for Alignment's row).
  func sentenceRow(_ app: XCUIApplication) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Pause between sentences,'")).firstMatch
  }
  func paragraphRow(_ app: XCUIApplication) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Pause between paragraphs,'")).firstMatch
  }

  /// Settings -> General with real touches, from a fresh launch.
  func openGeneral(_ app: XCUIApplication) {
    app.terminate(); app.launch()
    ensureAtLibrary(app)
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
    app.buttons["Settings"].tap()
    let general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'General'")).firstMatch
    XCTAssertTrue(general.waitForExistence(timeout: 5))
    general.tap()
    XCTAssertTrue(sentenceRow(app).waitForExistence(timeout: 5), "General did not load the Reading aloud card")
  }

  /// Asserts every label in `order` is present in the open menu and that each
  /// sits strictly below the previous one on screen — `menuOrder('fixed')`
  /// keeping the declared order even where SwiftUI might otherwise reverse it
  /// opening upward. Returns nothing; fails the test in place.
  func assertMenuOrder(_ app: XCUIApplication, _ order: [String], _ context: String) {
    var lastY = -CGFloat.greatestFiniteMagnitude
    for label in order {
      let item = menuItem(app, label)
      XCTAssertTrue(item.waitForExistence(timeout: 3), "\(context): menu is missing '\(label)'")
      XCTAssertGreaterThan(item.frame.origin.y, lastY, "\(context): '\(label)' is not below the previous item — menuOrder('fixed') may have been dropped")
      lastY = item.frame.origin.y
    }
  }

  static let sentenceLabels = ["0 ms", "50 ms", "100 ms", "150 ms", "200 ms", "300 ms", "400 ms", "500 ms", "750 ms", "1000 ms"]
  static let paragraphLabels = ["0 ms", "100 ms", "200 ms", "300 ms", "400 ms", "500 ms", "750 ms", "1000 ms", "1500 ms", "2000 ms"]

  /// The layout: Theme's card with no header, a "Reading aloud" header over
  /// exactly the two Pause rows, and the bracket card directly below with no
  /// header of its own (#60 moved it there) but keeping its downloaded-
  /// chapters footnote. Both rows read their fresh-install default, and each
  /// row's own accessibility label is exactly "Pause between sentences, 0 ms"
  /// / "Pause between paragraphs, 200 ms". Captured in whichever theme the
  /// device starts in, then Dark, then restored either way.
  func testReadingAloudCardLayoutAndBothThemes() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openGeneral(app)

    XCTAssertEqual(sentenceRow(app).label, "Pause between sentences, 0 ms", "Sentence row's accessibility label at the fresh-install default")
    XCTAssertEqual(paragraphRow(app).label, "Pause between paragraphs, 200 ms", "Paragraph row's accessibility label at the fresh-install default")
    // React Native nests a duplicate static text inside every `Text`, so one
    // logical header matches twice (README, Pitfalls, "app.staticTexts[…]
    // matches twice"); two logical headers — the regression this guards
    // against, the bracket card repeating the title #60 moved off it — would
    // match four times.
    XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == 'Reading aloud'")).count, 2,
                   "Exactly one logical 'Reading aloud' header (matched twice, RN's own duplication): the bracket card must not repeat it")
    XCTAssertTrue(app.staticTexts["Remove enclosing brackets when reading"].exists, "Bracket card is not directly below Reading aloud")
    capture("general-reading-aloud-initial-theme", app)

    let themeRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Theme,'")).firstMatch
    XCTAssertTrue(themeRow.waitForExistence(timeout: 3))
    themeRow.tap()
    XCTAssertTrue(app.buttons["Dark"].waitForExistence(timeout: 3), "Theme menu did not open")
    let initial = ["Light", "Dark", "Match Device"].first { app.buttons[$0].isSelected } ?? "Match Device"
    app.buttons["Dark"].tap()
    Thread.sleep(forTimeInterval: 0.5)
    capture("general-reading-aloud-dark", app)

    themeRow.tap()
    XCTAssertTrue(app.buttons[initial].waitForExistence(timeout: 3))
    app.buttons[initial].tap()
    Thread.sleep(forTimeInterval: 0.5)
    capture("general-reading-aloud-restored", app)
  }

  /// The sentence menu: all ten values in order top to bottom, 0 ms checked at
  /// a fresh install, choosing updates the row, and choosing back restores it.
  func testSentencePauseMenuRealTouches() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openGeneral(app)
    let row = sentenceRow(app)
    let before = row.label
    row.tap()

    assertMenuOrder(app, Self.sentenceLabels, "sentence menu")
    XCTAssertTrue(menuItem(app, "0 ms").isSelected, "0 ms is the default and should read checked")
    capture("sentence-menu-open", app)

    menuItem(app, "1000 ms").tap()
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertEqual(sentenceRow(app).label, "Pause between sentences, 1000 ms")
    capture("sentence-menu-chose-1000", app)

    sentenceRow(app).tap()
    XCTAssertTrue(menuItem(app, "0 ms").waitForExistence(timeout: 3))
    menuItem(app, "0 ms").tap()
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertEqual(sentenceRow(app).label, before, "Choosing back did not restore the default")
    capture("sentence-menu-restored", app)
  }

  /// The paragraph menu: same shape, ten values from 0 to 2000 ms, 200 ms
  /// checked at a fresh install.
  func testParagraphPauseMenuRealTouches() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openGeneral(app)
    let row = paragraphRow(app)
    let before = row.label
    row.tap()

    assertMenuOrder(app, Self.paragraphLabels, "paragraph menu")
    XCTAssertTrue(menuItem(app, "200 ms").isSelected, "200 ms is the default and should read checked")
    capture("paragraph-menu-open", app)

    menuItem(app, "2000 ms").tap()
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertEqual(paragraphRow(app).label, "Pause between paragraphs, 2000 ms")
    capture("paragraph-menu-chose-2000", app)

    paragraphRow(app).tap()
    XCTAssertTrue(menuItem(app, "200 ms").waitForExistence(timeout: 3))
    menuItem(app, "200 ms").tap()
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertEqual(paragraphRow(app).label, before, "Choosing back did not restore the default")
    capture("paragraph-menu-restored", app)
  }

  /// #60's two named risks together, at a larger Dynamic Type the caller sets
  /// before this run and restores after (`ProviderFreezeProbe.testDynamicTypeSpotCheck`'s
  /// own convention — not this probe's job): the ten-item menu still keeps
  /// `menuOrder('fixed')`'s order, and whether the longer "Pause between
  /// paragraphs" label with a "2000 ms" value clips or wraps badly. The drawn
  /// row's `settingRow` style has only a `minHeight`, but `ChoiceMenu` gives
  /// its host the fixed row height, so the row cannot grow; its screen position
  /// is recorded rather than assumed to be near the bottom — General's short
  /// content may not need to scroll even at a larger size.
  func testParagraphMenuAtLargerDynamicType() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openGeneral(app)
    capture("general-larger-dynamic-type", app)
    let row = paragraphRow(app)
    let rowFrame = row.frame
    let note = XCTAttachment(string: "Paragraph row before opening the menu: origin.y=\(rowFrame.origin.y) height=\(rowFrame.height); app frame height=\(app.frame.height)")
    note.name = "row-position"; note.lifetime = .keepAlways; add(note)

    row.tap()
    XCTAssertTrue(menuItem(app, "0 ms").waitForExistence(timeout: 3), "Paragraph menu did not open at a larger Dynamic Type")
    capture("paragraph-menu-open-larger-dynamic-type", app)
    assertMenuOrder(app, Self.paragraphLabels, "paragraph menu at a larger Dynamic Type")

    menuItem(app, "2000 ms").tap()
    Thread.sleep(forTimeInterval: 0.6)
    capture("paragraph-row-2000-larger-dynamic-type", app)
    XCTAssertEqual(paragraphRow(app).label, "Pause between paragraphs, 2000 ms", "Row's accessibility label still names the chosen value even if its drawn text is short of room")

    paragraphRow(app).tap()
    XCTAssertTrue(menuItem(app, "200 ms").waitForExistence(timeout: 3))
    menuItem(app, "200 ms").tap()
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertEqual(paragraphRow(app).label, "Pause between paragraphs, 200 ms")
  }

  /// Persistence (#60's own requirement): choose a non-default value in each
  /// menu with real touches, terminate and relaunch the app — not just this
  /// test's own setup relaunch, a second one after the choice — and require
  /// both rows still read the chosen values. Deliberately does **not** restore
  /// the defaults: the caller reads `settings.json` from the still-chosen
  /// state right after this method returns, and resets afterward.
  func testPauseValuesPersistAcrossRelaunch() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openGeneral(app)

    sentenceRow(app).tap()
    XCTAssertTrue(menuItem(app, "300 ms").waitForExistence(timeout: 3))
    menuItem(app, "300 ms").tap()
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertEqual(sentenceRow(app).label, "Pause between sentences, 300 ms")

    paragraphRow(app).tap()
    XCTAssertTrue(menuItem(app, "1500 ms").waitForExistence(timeout: 3))
    menuItem(app, "1500 ms").tap()
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertEqual(paragraphRow(app).label, "Pause between paragraphs, 1500 ms")
    capture("pause-values-chosen-before-relaunch", app)

    app.terminate()
    app.launch()
    ensureAtLibrary(app)
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
    app.buttons["Settings"].tap()
    let general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'General'")).firstMatch
    XCTAssertTrue(general.waitForExistence(timeout: 5))
    general.tap()
    XCTAssertTrue(sentenceRow(app).waitForExistence(timeout: 5))
    XCTAssertEqual(sentenceRow(app).label, "Pause between sentences, 300 ms", "Sentence pause did not survive a relaunch")
    XCTAssertEqual(paragraphRow(app).label, "Pause between paragraphs, 1500 ms", "Paragraph pause did not survive a relaunch")
    capture("pause-values-after-relaunch", app)
  }
}
