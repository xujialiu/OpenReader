import XCTest

/// Verifies the reader's custom navigation-bar title (#85) and the Margins
/// row's VoiceOver labels (#84) through the accessibility tree.
///
/// Launches the app, opens the renamed Scroll Fixture from the Library with a
/// real tap, then asserts that an accessibility **header** element carries the
/// Document's whole display name (the custom `ReaderTitle`, exposed with
/// `accessibilityRole="header"`), and — with the Appearance sheet opened by
/// real taps — that the Margins stepper's buttons answer to `Decrease margins`
/// / `Increase margins` while Font Size's still answer to `Decrease font size`
/// / `Increase font size`. Never presses Play. Leaves the reader open, sheet
/// closed, paused.
final class ReaderTitleProbe: XCTestCase {
  /// The display name under test (set through Documents/display-names.json and
  /// library.json before the run; see library-and-reader/bar-title.md).
  static let title = "The First Legendary Beast Master, Volume Three: The Long Road Through the Northern Mountains and Beyond"

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  @discardableResult
  func waitForReaderReady(_ app: XCUIApplication, timeout: TimeInterval = 40) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if app.buttons["Play"].exists || app.buttons["Choose a Voice"].exists { return true }
      Thread.sleep(forTimeInterval: 0.3)
    }
    return app.buttons["Play"].exists || app.buttons["Choose a Voice"].exists
  }

  func testTitleIsHeaderWithFullNameAndMarginsLabels() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    // The installed build has an empty RCTMetroPort, so every launch must name
    // this tree's Metro (docs/install-on-simulator.md, "A port is taken by a
    // Metro that serves another tree" in pitfalls/metro.md).
    app.launchArguments = ["-RCT_jsLocation", "localhost:8085"]
    app.terminate(); app.launch()
    if app.buttons["Back"].waitForExistence(timeout: 3) {
      // A restored Reader: leave it, the row tap below is only for the Library path.
    }
    let book = app.buttons.matching(
      NSPredicate(format: "label BEGINSWITH 'The First Legendary Beast Master, Volume Three'")
    ).firstMatch
    if book.waitForExistence(timeout: 10) {
      book.tap()
    } else {
      // Already on the reader (state restoration); nothing to tap.
    }
    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 10))
    XCTAssertTrue(waitForReaderReady(app), "Reader never became ready")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }

    // The title: an accessibility element whose label is the whole name.
    // XCUITest has no header query and cannot see the header trait; the
    // AXHeading role itself is asserted with `axe describe-ui` — see
    // bar-title.md in this folder.
    let named = app.descendants(matching: .any).matching(
      NSPredicate(format: "label == %@", Self.title)
    )
    XCTAssertTrue(named.count > 0, "No accessibility element carries the full name as its label")
    capture("title-elements", app)

    // The Appearance sheet's steppers, opened by real taps.
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
    app.buttons["Appearance"].tap()
    XCTAssertTrue(app.buttons["Decrease margins"].waitForExistence(timeout: 3), "Margins row must expose Decrease margins")
    XCTAssertTrue(app.buttons["Increase margins"].exists, "Margins row must expose Increase margins")
    XCTAssertTrue(app.buttons["Decrease font size"].exists, "Font Size must keep Decrease font size")
    XCTAssertTrue(app.buttons["Increase font size"].exists, "Font Size must keep Increase font size")
    let margins = app.buttons["Decrease margins"]
    let increase = app.buttons["Increase margins"]
    XCTAssertFalse(margins.isSelected)
    capture("appearance-labels", app)
    app.buttons["Close Appearance"].tap()
    XCTAssertFalse(app.buttons["Close Appearance"].waitForExistence(timeout: 2), "Sheet should close")
  }
}
