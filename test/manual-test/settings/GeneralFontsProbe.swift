import UIKit
import XCTest

/// Reproduces issues #10/#11/#12's General rebuild, the Theme menu (#33), the
/// bracket interlock, Manage-downloads delete-all action, and the Fonts page —
/// including whether a font selection actually changes the reading page.
/// Never presses Play; only pauses if a reading was already active.
final class GeneralFontsProbe: XCTestCase {
  let shortTitle = "A Short Test of Reading Aloud"
  let chineseTitle = "仙逆"

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func isOn(_ element: XCUIElement) -> Bool { (element.value as? String) == "1" }

  func clearAndType(_ field: XCUIElement, _ text: String) {
    field.tap()
    field.typeText(String(repeating: "\u{8}", count: 40))
    field.typeText(text)
  }

  /// Whether UIKit resolves a `fontFamily` the way React Native does: as an
  /// exact PostScript name, or as a family with at least one member. Neither
  /// resolving is the silent-fallback failure mode `READING_FONTS.preview`
  /// warns about — the row would then render identically to the system font.
  func systemKnows(_ name: String) -> Bool {
    !UIFont.fontNames(forFamilyName: name).isEmpty || UIFont(name: name, size: 12) != nil
  }

  /// No UI at all: whether the nine named `preview` faces exist on this
  /// simulator's system font registry. A missing face is exactly the silent
  /// fallback `highlighter.ts` warns `preview` cannot promise against.
  func testFontFamiliesAvailableOnSystem() {
    let latin = ["Georgia", "Times New Roman", "Palatino", "Avenir Next", "Helvetica"]
    let chinese = ["PingFang SC", "Songti SC", "Kaiti SC", "Yuanti SC"]
    let cjkFamilies = UIFont.familyNames.filter { family in
      ["song", "kai", "yuan", "ping", "hei", "ming", "cjk", "sc", "tc"].contains { family.lowercased().contains($0) }
    }.sorted()
    print("FONT-CHECK all CJK-ish family names on this system: \(cjkFamilies)")
    for name in latin {
      let known = systemKnows(name)
      print("FONT-CHECK latin \(name): \(known ? "resolves" : "MISSING")")
      XCTAssertTrue(known, "Latin preview face '\(name)' does not resolve on this simulator; its row would silently fall back to the system font.")
    }
    for name in chinese {
      let known = systemKnows(name)
      print("FONT-CHECK chinese \(name): \(known ? "resolves" : "MISSING")")
      XCTAssertTrue(known, "Chinese preview face '\(name)' does not resolve on this simulator; its row would silently fall back to the system font.")
    }
  }

  /// #11: General as two grouped cards in both themes, the Theme row's menu
  /// (#33) with its three system symbols and moving check, and #10's bracket
  /// interlock and inline refusal (never a modal alert).
  func testGeneralThemeAndBrackets() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()

    app.buttons["Settings"].tap()
    let general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'General'")).firstMatch
    XCTAssertTrue(general.waitForExistence(timeout: 5))
    general.tap()

    let themeRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Theme,'")).firstMatch
    XCTAssertTrue(themeRow.waitForExistence(timeout: 5), "General did not load")
    let stripSwitch = app.switches["Remove enclosing brackets when reading"]
    XCTAssertTrue(stripSwitch.exists, "Reading aloud group with the bracket switch must be present")
    capture("general-theme-1-initial", app)

    // Theme menu (#33): three items in order, each the system symbol it names
    // as its identifier, a check on the one in force.
    themeRow.tap()
    XCTAssertTrue(app.buttons["Light"].waitForExistence(timeout: 3), "Theme menu did not open")
    XCTAssertTrue(app.buttons["Dark"].exists)
    XCTAssertTrue(app.buttons["Match Device"].exists)
    XCTAssertEqual(app.buttons["Light"].identifier, "sun.max")
    XCTAssertEqual(app.buttons["Dark"].identifier, "moon")
    XCTAssertEqual(app.buttons["Match Device"].identifier, "circle.lefthalf.filled")
    XCTAssertLessThan(app.buttons["Light"].frame.minY, app.buttons["Dark"].frame.minY, "Light is not above Dark")
    XCTAssertLessThan(app.buttons["Dark"].frame.minY, app.buttons["Match Device"].frame.minY, "Dark is not above Match Device")
    capture("general-theme-2-menu-initial", app)
    let initial = ["Light", "Dark", "Match Device"].first { app.buttons[$0].isSelected } ?? "Match Device"
    print("THEME initial selection: \(initial)")

    app.buttons["Light"].tap()
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: app.buttons["Light"])], timeout: 3), .completed, "Theme menu did not close after picking Light")
    Thread.sleep(forTimeInterval: 0.4)
    XCTAssertTrue(app.buttons["Theme, Light"].exists, "The row does not say Light")
    capture("general-theme-3-light", app)

    themeRow.tap()
    XCTAssertTrue(app.buttons["Light"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.buttons["Light"].isSelected, "Check did not move to Light")
    XCTAssertFalse(app.buttons["Dark"].isSelected)
    capture("general-theme-4-menu-light", app)

    // Restore the theme this device had before the run, Match Device included.
    app.buttons[initial].tap()
    Thread.sleep(forTimeInterval: 0.4)
    capture("general-theme-5-restored", app)

    // --- Bracket interlock (#10) ---
    let field = app.textFields["Bracket pairs"]
    XCTAssertTrue(field.exists)
    XCTAssertEqual(field.value as? String, "<> []", "Default bracket pairs must be '<> []'")
    XCTAssertTrue(isOn(stripSwitch), "Removing brackets must be on by default")

    // Locked: a tap must not raise a keyboard.
    field.tap()
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertEqual(app.keyboards.count, 0, "The field must not become editable while the switch is on")

    // Off unlocks it.
    stripSwitch.tap()
    XCTAssertFalse(isOn(stripSwitch))
    field.tap()
    XCTAssertTrue(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "count > 0"), object: app.keyboards)], timeout: 3) == .completed, "The field must become editable once the switch is off")
    capture("bracket-1-unlocked", app)

    // Invalid entry: refused, stays off, named inline, no modal alert.
    clearAndType(field, "abc")
    XCTAssertEqual(field.value as? String, "abc")
    stripSwitch.tap()
    XCTAssertFalse(isOn(stripSwitch), "An invalid list must not switch removal on")
    XCTAssertEqual(app.alerts.count, 0, "A bad bracket list must never raise a modal alert")
    let entryNote = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'is not a pair'")).firstMatch
    XCTAssertTrue(entryNote.waitForExistence(timeout: 3), "Refusal must name the offending entry inline")
    XCTAssertTrue(app.buttons["Use <> [] instead"].exists)
    capture("bracket-2-invalid-entry", app)
    app.buttons["Use <> [] instead"].tap()
    XCTAssertTrue(isOn(stripSwitch), "The recovery link must switch removal back on")
    XCTAssertEqual(field.value as? String, "<> []")
    XCTAssertFalse(entryNote.exists)

    // Duplicate entry.
    stripSwitch.tap()
    clearAndType(field, "() ()")
    XCTAssertEqual(field.value as? String, "() ()")
    stripSwitch.tap()
    XCTAssertFalse(isOn(stripSwitch), "A duplicated pair must not switch removal on")
    XCTAssertEqual(app.alerts.count, 0)
    let dupNote = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'entered twice'")).firstMatch
    XCTAssertTrue(dupNote.waitForExistence(timeout: 3), "Refusal must name the duplicated entry inline")
    capture("bracket-3-duplicate-entry", app)
    app.buttons["Use <> [] instead"].tap()
    XCTAssertTrue(isOn(stripSwitch))

    // Valid, non-default list: accepted silently, no note, no alert.
    stripSwitch.tap()
    clearAndType(field, "{} ()")
    stripSwitch.tap()
    XCTAssertTrue(isOn(stripSwitch), "A valid list must switch removal on")
    XCTAssertEqual(app.alerts.count, 0)
    XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'is not a pair' OR label CONTAINS 'entered twice'")).firstMatch.exists,
                    "A valid list must be accepted without an inline note")
    capture("bracket-4-valid-silent-accept", app)

    // Restore the default list for a clean handoff.
    stripSwitch.tap()
    clearAndType(field, "<> []")
    stripSwitch.tap()
    XCTAssertTrue(isOn(stripSwitch))
    XCTAssertEqual(field.value as? String, "<> []")
    capture("bracket-5-restored-default", app)
  }

  /// #10: Manage downloads gains a red delete-all action next to "Back to
  /// downloads" when the document has saved audio. Cancelled, never confirmed
  /// — the fixture's downloads are not reproducible without provider quota.
  func testManageDownloadsDeleteAll() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()

    let ellipsis = app.buttons["Actions for " + shortTitle]
    XCTAssertTrue(ellipsis.waitForExistence(timeout: 10))
    ellipsis.tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 3))
    app.buttons["Download"].tap()

    let countLine = app.staticTexts.matching(NSPredicate(format: "label LIKE '* chapters downloaded'")).firstMatch
    XCTAssertTrue(countLine.waitForExistence(timeout: 10), "Download did not open")
    XCTAssertTrue(app.buttons["Manage downloads"].waitForExistence(timeout: 5))
    app.buttons["Manage downloads"].tap()

    let savedLine = app.staticTexts.matching(NSPredicate(format: "label LIKE '* saved'")).firstMatch
    XCTAssertTrue(savedLine.waitForExistence(timeout: 5), "Manage downloads did not show a saved-size line")
    let deleteAll = app.buttons["Delete all saved audio"]
    XCTAssertTrue(deleteAll.waitForExistence(timeout: 3), "Delete all saved audio must appear when the document has saved audio")
    XCTAssertTrue(app.buttons["Back to downloads"].exists, "Delete all saved audio must sit next to Back to downloads")
    print("MANAGE-DOWNLOADS saved line: \(savedLine.label)")
    capture("manage-downloads-1-delete-all-button", app)

    deleteAll.tap()
    let alert = app.alerts["Delete all saved audio?"]
    XCTAssertTrue(alert.waitForExistence(timeout: 3), "Must raise a confirmation titled 'Delete all saved audio?'")
    XCTAssertTrue(alert.staticTexts.matching(NSPredicate(format: "label CONTAINS 'freeing'")).firstMatch.exists, "Confirmation must name a size")
    print("MANAGE-DOWNLOADS confirm text: \(alert.label)")
    capture("manage-downloads-2-confirm", app)
    alert.buttons["Cancel"].tap()
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: alert)], timeout: 3), .completed)

    app.buttons["Back to downloads"].tap()
    app.buttons["Close Download"].tap()
  }

  /// #12: the Fonts page inside the actions drawer — the full list, a check
  /// on the current one, and that Back returns to Appearance rather than
  /// closing the drawer.
  func testFontsPageListAndBackButton() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()

    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", chineseTitle + ",")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10))
    book.tap()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 15), "Document did not reach the reader")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }

    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
    app.buttons["Appearance"].tap()
    let fontRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Font,'")).firstMatch
    XCTAssertTrue(fontRow.waitForExistence(timeout: 3))
    fontRow.tap()

    XCTAssertTrue(app.buttons["Back from Fonts"].waitForExistence(timeout: 3), "Fonts must open with a back button, not as a second drawer")
    let names = ["Original Book Font", "System", "Georgia", "Times New Roman", "Palatino", "Avenir Next", "Helvetica", "苹方", "宋体", "楷体", "圆体"]
    for name in names {
      XCTAssertTrue(app.buttons[name].waitForExistence(timeout: 3), "Fonts list is missing '\(name)'")
    }
    let selected = app.buttons.matching(NSPredicate(format: "selected == true"))
    XCTAssertEqual(selected.count, 1, "Exactly one font row must carry the check")
    print("FONTS-PAGE current selection: \(selected.count == 1 ? selected.firstMatch.label : "none")")
    capture("fonts-page-1-top", app)

    app.swipeUp()
    capture("fonts-page-2-scrolled", app)
    XCTAssertTrue(app.buttons["楷体"].exists)
    XCTAssertTrue(app.buttons["圆体"].exists)

    app.buttons["Back from Fonts"].tap()
    XCTAssertTrue(app.buttons["Increase font size"].waitForExistence(timeout: 3), "Back must return to Appearance")
    XCTAssertFalse(app.buttons["Back from Fonts"].exists, "The drawer must no longer show the Fonts back button")
    XCTAssertTrue(fontRow.exists, "Appearance's Font row must still be present after Back")
    capture("fonts-page-3-back-at-appearance", app)
    app.buttons["Close Appearance"].tap()
  }

  /// #12: picking a font actually changes the reading page. 楷体 on the
  /// Chinese fixture, then Georgia, then back to Original Book Font.
  func testFontSelectionChangesReadingPage() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()

    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", chineseTitle + ",")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10))
    book.tap()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 15), "Document did not reach the reader")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    capture("reading-1-baseline", app)

    func chooseFont(_ name: String, _ shot: String) {
      app.buttons["More actions"].tap()
      XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
      app.buttons["Appearance"].tap()
      let fontRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Font,'")).firstMatch
      XCTAssertTrue(fontRow.waitForExistence(timeout: 3))
      fontRow.tap()
      XCTAssertTrue(app.buttons[name].waitForExistence(timeout: 3))
      app.buttons[name].tap()
      XCTAssertTrue(app.buttons["Back from Fonts"].waitForExistence(timeout: 3))
      app.buttons["Back from Fonts"].tap()
      XCTAssertTrue(app.buttons["Close Appearance"].waitForExistence(timeout: 3))
      app.buttons["Close Appearance"].tap()
      XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
        predicate: NSPredicate(format: "exists == false"), object: app.buttons["Close Appearance"])], timeout: 3), .completed)
      Thread.sleep(forTimeInterval: 0.3)
      capture(shot, app)
    }

    chooseFont("楷体", "reading-2-kaiti")
    chooseFont("Georgia", "reading-3-georgia")
    chooseFont("Original Book Font", "reading-4-original-restored")
  }

  /// #12, Latin control: confirms `appearanceCss` actually reaches the WebView
  /// when the named face is present on the system (Georgia resolves per
  /// `testFontFamiliesAvailableOnSystem`), using the English fixture since the
  /// Chinese one carries no Latin runs in its opening chapter. Isolates whether
  /// a same-looking Chinese reading page (see `testFontSelectionChangesReadingPage`)
  /// is the CSS pipeline or the simulator's missing CJK faces.
  func testLatinFontChangesEnglishReadingPage() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()

    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", shortTitle + ",")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10))
    book.tap()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 15), "Document did not reach the reader")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    capture("latin-1-baseline", app)

    func chooseFont(_ name: String, _ shot: String) {
      app.buttons["More actions"].tap()
      XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
      app.buttons["Appearance"].tap()
      let fontRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Font,'")).firstMatch
      XCTAssertTrue(fontRow.waitForExistence(timeout: 3))
      fontRow.tap()
      XCTAssertTrue(app.buttons[name].waitForExistence(timeout: 3))
      app.buttons[name].tap()
      XCTAssertTrue(app.buttons["Back from Fonts"].waitForExistence(timeout: 3))
      app.buttons["Back from Fonts"].tap()
      XCTAssertTrue(app.buttons["Close Appearance"].waitForExistence(timeout: 3))
      app.buttons["Close Appearance"].tap()
      XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
        predicate: NSPredicate(format: "exists == false"), object: app.buttons["Close Appearance"])], timeout: 3), .completed)
      Thread.sleep(forTimeInterval: 0.3)
      capture(shot, app)
    }

    chooseFont("Georgia", "latin-2-georgia")
    chooseFont("Times New Roman", "latin-3-times")
    chooseFont("Helvetica", "latin-4-helvetica")
    chooseFont("Original Book Font", "latin-5-original-restored")
  }

  /// ADR/#12 migration: a settings.json written by an older version with
  /// `"font": "serif"` must resolve to Georgia rather than falling back to
  /// Original Book Font. The rewrite to "serif" happens on the host, with the
  /// app already terminated, immediately before this method is invoked alone.
  func testMigratedFontShowsGeorgia() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()

    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", shortTitle + ",")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10))
    book.tap()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 15))
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }

    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
    app.buttons["Appearance"].tap()
    XCTAssertTrue(app.buttons["Font, Georgia"].waitForExistence(timeout: 5), "A migrated 'serif' id must read as Georgia, not fall back to Original Book Font")
    capture("migrated-font-shows-georgia", app)
    app.buttons["Close Appearance"].tap()
  }
}
