import XCTest

/// Issue #30: Settings shows `APP_VERSION` under the Sync row, so the owner
/// can read off the device which build is running. Checks the line's exact
/// accessibility label, that the three rows above it still open their screens
/// and return here, and how the line reads in both the light and dark theme.
/// Never presses Play.
final class SettingsVersionProbe: XCTestCase {
  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  /// From wherever the last session left the app (state restoration can land
  /// in a reader) to the Library, then into Settings.
  func openSettings(_ app: XCUIApplication) {
    if app.buttons["Back"].exists { app.buttons["Back"].tap() }
    let settings = app.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 15), "Library header did not appear")
    settings.tap()
  }

  /// `APP_VERSION` as the working tree has it, read from app-version.ts at run
  /// time so the probe follows every bump. The runner can read host files, as
  /// SyncProbe's parameter file already relies on.
  func workingTreeVersion() -> String? {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
    guard let text = try? String(contentsOf: root.appendingPathComponent("app-version.ts"), encoding: .utf8),
          let line = text.split(separator: "\n").first(where: { $0.hasPrefix("export const APP_VERSION = ") })
    else { return nil }
    return line.split(separator: "'").dropFirst().first.map(String.init)
  }

  /// General/Providers/Sync all set `headerBackTitle: 'Settings'`; Settings'
  /// own back button reads 'Library' (README pitfall: named after the screen
  /// behind it, not always literally "Back"). The first nav-bar button is
  /// always that one, whatever it is labelled.
  func backToSettings(_ app: XCUIApplication) {
    app.navigationBars.buttons.element(boundBy: 0).tap()
  }

  func testVersionLineRowsAndThemes() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    openSettings(app)

    let general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'General'")).firstMatch
    let providers = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Providers'")).firstMatch
    let sync = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sync'")).firstMatch
    XCTAssertTrue(general.waitForExistence(timeout: 10), "Settings did not load")
    XCTAssertTrue(providers.exists, "Settings has no Providers row")
    XCTAssertTrue(sync.exists, "Settings has no Sync row")

    // The version line's accessibility label, exactly. `accessibilityLabel`
    // replaces what iOS exposes, so the raw version text is not a separately
    // queryable label; the screenshot is what proves that.
    guard let expected = workingTreeVersion() else { return XCTFail("Could not read APP_VERSION from app-version.ts") }
    let version = app.staticTexts["Version \(expected)"]
    XCTAssertTrue(version.waitForExistence(timeout: 5), "No element labelled 'Version \(expected)'")
    capture("settings-version-1-initial", app)

    // The three rows above it still open their own screens and return here,
    // with the version line unmoved and unchanged by the round trip.
    general.tap()
    XCTAssertTrue(app.navigationBars["General"].waitForExistence(timeout: 5), "General did not load")
    backToSettings(app)
    XCTAssertTrue(version.waitForExistence(timeout: 5), "Version line missing after returning from General")

    providers.tap()
    XCTAssertTrue(app.navigationBars["Providers"].waitForExistence(timeout: 5), "Providers did not load")
    backToSettings(app)
    XCTAssertTrue(version.waitForExistence(timeout: 5), "Version line missing after returning from Providers")

    sync.tap()
    XCTAssertTrue(app.navigationBars["Sync"].waitForExistence(timeout: 5), "Sync did not load")
    backToSettings(app)
    XCTAssertTrue(version.waitForExistence(timeout: 5), "Version line missing after returning from Sync")

    // Theme: General > Theme menu > Light, back to Settings, photograph;
    // then Dark; then restore whatever the device had before this run.
    general.tap()
    let themeRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Theme,'")).firstMatch
    XCTAssertTrue(themeRow.waitForExistence(timeout: 5), "General has no Theme row")
    themeRow.tap()
    XCTAssertTrue(app.buttons["Light"].waitForExistence(timeout: 3), "Theme menu did not open")
    let initiallyDark = app.buttons["Dark"].isSelected
    let initiallyMatch = app.buttons["Match Device"].isSelected

    app.buttons["Light"].tap()
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: app.buttons["Light"])], timeout: 3), .completed, "Theme menu did not close after picking Light")
    backToSettings(app)
    XCTAssertTrue(version.waitForExistence(timeout: 5), "Version line missing in the light theme")
    capture("settings-version-2-light", app)

    general.tap()
    XCTAssertTrue(themeRow.waitForExistence(timeout: 5))
    themeRow.tap()
    XCTAssertTrue(app.buttons["Dark"].waitForExistence(timeout: 3), "Theme menu did not open")
    app.buttons["Dark"].tap()
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: app.buttons["Dark"])], timeout: 3), .completed, "Theme menu did not close after picking Dark")
    backToSettings(app)
    XCTAssertTrue(version.waitForExistence(timeout: 5), "Version line missing in the dark theme")
    capture("settings-version-3-dark", app)

    // Restore.
    general.tap()
    XCTAssertTrue(themeRow.waitForExistence(timeout: 5))
    themeRow.tap()
    XCTAssertTrue(app.buttons["Light"].waitForExistence(timeout: 3))
    let restore = initiallyDark ? "Dark" : (initiallyMatch ? "Match Device" : "Light")
    app.buttons[restore].tap()
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: app.buttons["Light"])], timeout: 3), .completed, "Theme menu did not close after restoring")
    backToSettings(app)
    capture("settings-version-4-restored", app)
  }
}
