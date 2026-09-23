import XCTest

/// Real touches for the downloaded-to-non-downloaded verification (#26, #45,
/// #46, #49) and its #2 regression check: a Play tap after an idle pause must
/// succeed on the first press, and a paused-state word tap must not start
/// playback. `.activate()` only — this device's Debug build is connected to a
/// non-default Metro port via a launch argument that `app.terminate();
/// app.launch()` would drop (test/manual-test/README.md Pitfalls, "A launch
/// argument points a Debug app at another Metro port").
final class PausedTransportProbe: XCTestCase {
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
      if app.buttons["Play"].exists || app.buttons["Pause"].exists { return true }
      Thread.sleep(forTimeInterval: 0.3)
    }
    return app.buttons["Play"].exists || app.buttons["Pause"].exists
  }

  /// A normalized point inside this book's dense body-text paragraphs, the
  /// same way ScrollThemeReaderProbe/FontSizeProbe choose theirs.
  func wordPoint(_ app: XCUIApplication) -> XCUICoordinate {
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
  }

  /// #26 after a pause: pressing Play after an idle spell must play on the
  /// very first tap, not need a retry. The idle wait itself happens on the
  /// host before this method is invoked (test/manual-test/README.md, "Fish
  /// Audio from the simulator"), so the elapsed idle time is exact; this
  /// method presses Play once, measures how long the transition to Pause
  /// takes, confirms playback is sustained rather than an immediate second
  /// failure, then pauses again — this run's required real Play touch and
  /// real Pause touch.
  func testPlayAfterIdlePause() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(waitForReaderReady(app), "Reader was not ready")
    XCTAssertTrue(app.buttons["Play"].exists, "Expected the reading paused before this test (found Pause already showing)")
    capture("idle-00-before-tap", app)
    let start = Date()
    app.buttons["Play"].tap()
    let becamePlaying = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Pause"])], timeout: 25) == .completed
    let elapsed = Date().timeIntervalSince(start)
    print("IDLE-PLAY became Pause=\(becamePlaying) after \(elapsed) s")
    capture("idle-01-after-tap", app)
    XCTAssertTrue(becamePlaying, "Play did not start on the first tap after the idle pause")
    Thread.sleep(forTimeInterval: 2.5)
    XCTAssertTrue(app.buttons["Pause"].exists, "Playback stopped again almost immediately after starting (not a sustained play)")
    capture("idle-02-still-playing", app)
    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause back on the second tap")
    Thread.sleep(forTimeInterval: 0.4)
    capture("idle-03-paused-again", app)
  }

  /// Regression #2: a word tapped while paused moves the highlight and holds
  /// it there — no word progression from the tap alone, and no playback
  /// starts.
  func testWordTapStaysStaticWhilePaused() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(waitForReaderReady(app))
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Expected paused before this test")
    capture("wordtap-00-before", app)
    wordPoint(app).tap()
    Thread.sleep(forTimeInterval: 1.0)
    capture("wordtap-01-after-tap", app)
    XCTAssertTrue(app.buttons["Play"].exists, "A word tap while paused must not start playback")
    Thread.sleep(forTimeInterval: 2.0)
    capture("wordtap-02-after-wait", app)
    XCTAssertTrue(app.buttons["Play"].exists, "Still expected paused a couple of seconds after the word tap")
  }
}
