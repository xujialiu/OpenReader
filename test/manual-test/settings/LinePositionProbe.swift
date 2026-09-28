import XCTest

/// Verifies #71 batch 2 on the device: General's `Line position` row, in a
/// card of its own directly under the two pauses, opened with real touches —
/// its seven values in order from 20% to 80%, the current one checked,
/// choosing updates the row, and choosing back restores it. Never presses
/// Play.
final class LinePositionProbe: XCTestCase {
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

  /// A menu item by its title, of any element type (PauseMenuProbe).
  func menuItem(_ app: XCUIApplication, _ title: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", title)).firstMatch
  }

  func row(_ app: XCUIApplication) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Line position,'")).firstMatch
  }
  func paragraphRow(_ app: XCUIApplication) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Pause between paragraphs,'")).firstMatch
  }

  static let labels = ["20%", "30%", "40%", "50%", "60%", "70%", "80%"]

  func testLinePositionMenuRealTouches() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    ensureAtLibrary(app)
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
    app.buttons["Settings"].tap()
    let general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'General'")).firstMatch
    XCTAssertTrue(general.waitForExistence(timeout: 5))
    general.tap()
    XCTAssertTrue(row(app).waitForExistence(timeout: 5), "General has no Line position row")
    let before = row(app).label
    // Under the pauses: the row starts below the paragraph pause's row.
    XCTAssertGreaterThan(row(app).frame.minY, paragraphRow(app).frame.maxY, "Line position is not below the pauses")
    XCTAssertTrue(app.staticTexts["Remove enclosing brackets when reading"].firstMatch.frame.minY > row(app).frame.maxY,
                  "The brackets' card is not below Line position")
    capture("line-position-general", app)

    row(app).tap()
    var lastY = -CGFloat.greatestFiniteMagnitude
    for label in Self.labels {
      let item = menuItem(app, label)
      XCTAssertTrue(item.waitForExistence(timeout: 3), "menu is missing '\(label)'")
      XCTAssertGreaterThan(item.frame.origin.y, lastY, "'\(label)' is not below the previous item")
      lastY = item.frame.origin.y
    }
    XCTAssertEqual(Self.labels.filter { menuItem(app, $0).isSelected }, [String(before.dropFirst("Line position, ".count))],
                   "exactly the row's value is checked")
    capture("line-position-menu-open", app)

    menuItem(app, "30%").tap()
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertEqual(row(app).label, "Line position, 30%")
    capture("line-position-chose-30", app)

    row(app).tap()
    let back = String(before.dropFirst("Line position, ".count))
    XCTAssertTrue(menuItem(app, back).waitForExistence(timeout: 3))
    menuItem(app, back).tap()
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertEqual(row(app).label, before, "Choosing back did not restore the row")
    capture("line-position-restored", app)
  }

  /// #71 batch 2: choosing 40% survives a relaunch — the same convention as
  /// `PauseMenuProbe.testPauseValuesPersistAcrossRelaunch`. Remove
  /// `Documents/harness.json` before this method runs (README Pitfalls, "Two
  /// harness commands written back to back run only the second" /ADR: the
  /// walkthrough harness re-runs its last command on every launch), or a
  /// leftover `settings` patch from an earlier `line-follow.cjs` run silently
  /// rewrites the Line Position right after the relaunch and the check would
  /// pass or fail for the wrong reason. Leaves the row at 50%, the default.
  func testLinePositionPersistsAcrossRelaunch() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    ensureAtLibrary(app)
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
    app.buttons["Settings"].tap()
    // The version line lives on this same screen (SettingsVersionProbe); a
    // capture here is incidental evidence for #71's own version bump too.
    capture("line-position-settings-root-before-persist", app)
    var general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'General'")).firstMatch
    XCTAssertTrue(general.waitForExistence(timeout: 5))
    general.tap()
    XCTAssertTrue(row(app).waitForExistence(timeout: 5))

    row(app).tap()
    XCTAssertTrue(menuItem(app, "40%").waitForExistence(timeout: 3))
    menuItem(app, "40%").tap()
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertEqual(row(app).label, "Line position, 40%")
    capture("line-position-40-before-relaunch", app)

    app.terminate()
    app.launch()
    ensureAtLibrary(app)
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
    app.buttons["Settings"].tap()
    general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'General'")).firstMatch
    XCTAssertTrue(general.waitForExistence(timeout: 5))
    general.tap()
    XCTAssertTrue(row(app).waitForExistence(timeout: 5))
    XCTAssertEqual(row(app).label, "Line position, 40%", "Line position did not survive a relaunch")
    capture("line-position-40-after-relaunch", app)

    row(app).tap()
    XCTAssertTrue(menuItem(app, "50%").waitForExistence(timeout: 3))
    menuItem(app, "50%").tap()
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertEqual(row(app).label, "Line position, 50%", "did not restore the default")
    capture("line-position-restored-50", app)
  }
}
