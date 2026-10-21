import XCTest

/// Raises Kokoro FastAPI's Sentences at once to 5 with real taps, on an app that
/// is already running (never relaunched: a running download must take the
/// higher number at once, #311's B4). The caller leaves the app on the Settings
/// root; the probe walks Providers › (the provider) › Sentences at once and
/// taps the menu item, then requires the row to read the new number.
final class SentencesAtOnceProbe: XCTestCase {
  let providerRow = "Kokoro FastAPI, enabled"

  func capture(_ name: String, _ app: XCUIApplication) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  /// A menu item by its title, of any element type (PauseMenuProbe): SwiftUI's
  /// `Toggle` in a `Menu` is not always a `.button` to XCTest.
  func menuItem(_ app: XCUIApplication, _ title: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", title)).firstMatch
  }

  func testRaiseKokoroSentencesAtOnceToFive() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let providers = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Providers,'")).firstMatch
    XCTAssertTrue(providers.waitForExistence(timeout: 10), "Providers row not found: is the Settings root in front?")
    providers.tap()
    let kokoro = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Kokoro FastAPI,'")).firstMatch
    XCTAssertTrue(kokoro.waitForExistence(timeout: 5), "Kokoro FastAPI row not found")
    kokoro.tap()
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sentences at once,'")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5), "Sentences at once row not found")
    let before = row.label
    row.tap()
    let five = menuItem(app, "5")
    XCTAssertTrue(five.waitForExistence(timeout: 5), "The menu did not open, or no item '5'")
    capture("menu-open", app)
    five.tap()
    let raised = app.buttons.matching(NSPredicate(format: "label == 'Sentences at once, 5'")).firstMatch
    XCTAssertTrue(raised.waitForExistence(timeout: 5), "The row did not come back reading 5 (was: \(before))")
    capture("raised-to-five", app)
  }
}
