import XCTest

/// #204 with a real native touch, after AXe's automation session proved
/// unstable on this machine. Setup done by the host before this runs: the
/// startup Voice prefetch was refused (the fault server answered 503 — its log
/// holds the line), then the server recovered to its fixture list with no app
/// restart. This probe attaches to the running reader (no relaunch, so the
/// prefetch failure is not repaired by a new start-up ask), taps "Choose a
/// Voice" once, and requires the sheet to list the server's fixture voices —
/// never the OpenAI fallback names. That a fresh GET /v1/audio/voices reached
/// the server at the tap is read from the fault server's log on the host; this
/// probe proves the touch and what the sheet then shows. Never presses Play.
final class ProviderVoiceDrawerProbe: XCTestCase {
  func testDrawerAsksAgainAndListsFixtures() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let voice = app.buttons["Choose a Voice"]
    XCTAssertTrue(voice.waitForExistence(timeout: 60), "Open the reader on the fixture first; this probe touches, it does not navigate")
    let before = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    before.name = "before-touch"; before.lifetime = .keepAlways; add(before)
    voice.tap()
    // Every AX snapshot takes 20-40 s on a loaded machine (run 1 expired a
    // 20 s window while the sheet was mid-load); these waits only bound the
    // probe, the request timing is the server log's.
    let fixture = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS %@", "Fixture Willow")).firstMatch
    XCTAssertTrue(fixture.waitForExistence(timeout: 60), "The sheet did not list the recovered server's Fixture Willow")
    let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    shot.name = "drawer-with-fixture-voices"; shot.lifetime = .keepAlways; add(shot)
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = "drawer-tree"; tree.lifetime = .keepAlways; add(tree)
    for fallback in ["alloy", "ash", "ballad"] {
      let row = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", fallback)).firstMatch
      XCTAssertFalse(row.exists, "The OpenAI fallback name \(fallback) is on the sheet")
    }
  }
}
