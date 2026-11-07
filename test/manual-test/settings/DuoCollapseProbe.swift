import XCTest

/// Paused, attach-only Player control. Caller stages the Reader with no notes
/// (enabling a Provider with voice="" is a valid no-Voice/no-note setup).
/// It does not navigate, launch, play, or assume an imported file's title.
final class DuoCollapseProbe: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")

  override func setUp() {
    super.setUp()
    continueAfterFailure = false
  }

  private func capture(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
  }

  func testCollapseShow() throws {
    guard app.state != .notRunning else {
      XCTFail("PRECONDITION: attach-only target is not running")
      return
    }
    app.activate()
    XCTAssertEqual(app.state, .runningForeground)
    let collapse = app.buttons["Collapse the player"]
    let voice = app.buttons["Choose a Voice"]
    XCTAssertTrue(collapse.waitForExistence(timeout: 8), "PRECONDITION: stage the expanded Reader first")
    XCTAssertTrue(voice.exists)
    XCTAssertTrue(collapse.isHittable)
    XCTAssertTrue(app.frame.contains(collapse.frame), "Collapse lies outside the actual app window")
    XCTAssertFalse(app.buttons["Slower"].exists, "PRECONDITION: speed popup still open")
    XCTAssertFalse(app.buttons["Faster"].exists, "PRECONDITION: speed popup still open")
    // Absence of just the no-provider sentence is insufficient: an enabled
    // but incompletely configured Provider also keeps the Player expanded.
    let readinessNote = app.staticTexts.matching(NSPredicate(
      format: "label CONTAINS 'No provider is enabled' OR label CONTAINS ' needs ' OR label CONTAINS ' is disabled.'"
    )).firstMatch
    XCTAssertFalse(readinessNote.exists, "PRECONDITION: Provider readiness note forces expansion")
    print("[collapse] BEFORE window=\(app.frame) control=\(collapse.frame)")
    print("[collapse] BEFORE hierarchy:\n\(app.debugDescription)")
    capture("expanded-before-collapse")

    // Use the actual element's centre; no remembered device-specific point.
    collapse.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.1)
    let show = app.buttons["Show the player"]
    XCTAssertTrue(show.waitForExistence(timeout: 8), "Collapse did not reveal Show the player")
    XCTAssertFalse(voice.exists, "Player rows remain after Collapse")
    XCTAssertFalse(app.buttons["Play"].exists, "Transport remains after Collapse")
    XCTAssertTrue(app.frame.contains(show.frame))
    print("[collapse] COLLAPSED show=\(show.frame)")
    capture("collapsed")

    show.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.1)
    XCTAssertTrue(collapse.waitForExistence(timeout: 8), "Show did not restore expanded Player")
    XCTAssertTrue(voice.exists)
    XCTAssertFalse(show.exists)
    XCTAssertFalse(app.buttons["Slower"].exists)
    XCTAssertFalse(app.buttons["Faster"].exists)
    print("[collapse] SHOWN window=\(app.frame) control=\(collapse.frame)")
    capture("shown-again")
  }
}
