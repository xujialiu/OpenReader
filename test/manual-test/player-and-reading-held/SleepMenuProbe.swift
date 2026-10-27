import XCTest

/// Real touches on the Player's Sleep Timer (#326): the native
/// SwiftUI `Menu` (through `@expo/ui`) that AXe and mobilebuildmcp taps do not
/// open (the #311 pitfall again, "Sentences at once"), the menu's entries, and
/// choosing one. Attaches to the already running app; the caller leaves the
/// reader open with the Player expanded. Plays nothing.
///
///   bash test/manual-test/kit/run-probe.sh SleepMenuProbe SIMULATOR_UDID OUT_DIR \
///     -only-testing:testOpenSleepMenu
///   TEST_RUNNER_SLEEP_ITEM='5 Minutes' TEST_RUNNER_SLEEP_EXPECT='Sleep Timer, 5:00 left' \
///   bash test/manual-test/kit/run-probe.sh SleepMenuProbe SIMULATOR_UDID OUT_DIR \
///     -only-testing:testChooseMenuEntry
///
/// SLEEP_ITEM is the menu entry's exact title; SLEEP_EXPECT is what the button
/// must read afterwards (prefix, or exact with SLEEP_EXPECT_EXACT=1). With
/// SLEEP_CAPTURE=1 the post-choice screen is attached as `after-choose` even
/// when the label assertion passes.
///
/// SLEEP_DISMISS_X/SLEEP_DISMISS_Y override the outside tap that closes the
/// menu after testOpenSleepMenu (normalized to the app's frame). The default
/// moved from the title bar (0.5, 0.05) to the page (0.5, 0.30): on iOS 26.5
/// the title-bar tap did not dismiss the menu (it stayed open over the reader,
/// 2026-10-27), while the nav bar's title consumes touches; a tap on the page
/// above the menu dismisses it.
final class SleepMenuProbe: XCTestCase {

  func capture(_ name: String, _ app: XCUIApplication) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  /// A menu item by its title, of any element type (PauseMenuProbe):
  /// SwiftUI's `Toggle` in a `Menu` is not always a `.button` to XCTest.
  func menuItem(_ app: XCUIApplication, _ title: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", title)).firstMatch
  }

  /// The Sleep Timer's button, whose label carries the timer's state.
  func sleepButton(_ app: XCUIApplication) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sleep Timer'")).firstMatch
  }

  func testOpenSleepMenu() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let button = sleepButton(app)
    XCTAssertTrue(button.waitForExistence(timeout: 10), "Sleep Timer button not found: is the reader open with the Player expanded?")
    let before = button.label
    button.tap()
    let chapter = menuItem(app, "When Current Chapter Ends")
    XCTAssertTrue(chapter.waitForExistence(timeout: 5), "The menu did not open (button was: \(before))")
    capture("sleep-menu-open", app)
    for title in ["5 Minutes", "10 Minutes", "15 Minutes", "30 Minutes", "45 Minutes", "1 Hour"] {
      XCTAssertTrue(menuItem(app, title).exists, "The menu has no \(title)")
    }
    XCTAssertFalse(menuItem(app, "Turn Off Timer").exists, "Turn Off Timer is offered while the timer is off")
    // The menu opens upward and its last row covers the button, so a second
    // tap on the button chooses that row (measured: it chose 1 Hour).
    // Dismiss by tapping outside it; the title bar's tap does not dismiss the
    // menu on iOS 26.5 (the nav bar consumes it), so the default is the page
    // above the menu.
    let env = ProcessInfo.processInfo.environment
    let dismissX = env["SLEEP_DISMISS_X"].flatMap(Double.init) ?? 0.5
    let dismissY = env["SLEEP_DISMISS_Y"].flatMap(Double.init) ?? 0.30
    app.coordinate(withNormalizedOffset: CGVector(dx: dismissX, dy: dismissY)).tap()
    let chapterGone = NSPredicate(format: "exists == false")
    expectation(for: chapterGone, evaluatedWith: chapter, handler: nil)
    waitForExpectations(timeout: 5, handler: nil)
    capture("sleep-menu-closed", app)
  }

  func testChooseMenuEntry() throws {
    let env = ProcessInfo.processInfo.environment
    let item = env["SLEEP_ITEM"]
    let expect = env["SLEEP_EXPECT"]
    XCTAssertNotNil(item, "Set TEST_RUNNER_SLEEP_ITEM to the menu entry's exact title")
    XCTAssertNotNil(expect, "Set TEST_RUNNER_SLEEP_EXPECT to the button label to expect")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let button = sleepButton(app)
    XCTAssertTrue(button.waitForExistence(timeout: 10), "Sleep Timer button not found: is the reader open with the Player expanded?")
    button.tap()
    let entry = menuItem(app, item!)
    XCTAssertTrue(entry.waitForExistence(timeout: 5), "The menu did not open, or has no \(item!)")
    capture("sleep-menu-before-choose", app)
    entry.tap()
    let expected = env["SLEEP_EXPECT_EXACT"] == "1"
      ? NSPredicate(format: "label == %@", expect!)
      : NSPredicate(format: "label BEGINSWITH %@", expect!)
    let chosen = expectation(for: expected, evaluatedWith: button, handler: nil)
    waitForExpectations(timeout: 10, handler: nil)
    if env["SLEEP_CAPTURE"] == "1" { capture("after-choose", app) }
    print("SLEEPMENU button now reads: \(button.label)")
  }
}
