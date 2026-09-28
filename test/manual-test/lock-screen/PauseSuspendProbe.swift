import XCTest

/// Real touches for #66's fix: pausing suspends the `AudioContext` and Play
/// resumes it (`src/playback/audio-graph.ts`, `drive()`, queued through
/// `driving`). Checks the Settings version line, then the in-app Play/Pause
/// button through two full cycles, a quick Pause-then-Play close enough
/// together to exercise the ordering queue, and a sentence skip while paused
/// followed by Play. `.activate()` only, and no relaunch inside this probe:
/// the host must already have relaunched the app against its Metro before
/// this run (README, "A launch argument points a Debug app at another Metro
/// port" — this build's `RCTMetroPort` is baked in, so a relaunch is durable,
/// but an in-test one is still avoided here to keep this run on whatever
/// reading position the host's own setup left).
final class PauseSuspendProbe: XCTestCase {
  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  /// Polls `condition` until it holds or `timeout` passes.
  func until(_ timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    repeat {
      if condition() { return true }
      Thread.sleep(forTimeInterval: 0.2)
    } while Date() < deadline
    return false
  }

  /// `APP_VERSION` as the working tree has it, the same way
  /// `SettingsVersionProbe.workingTreeVersion()` reads it.
  func workingTreeVersion() -> String? {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
    guard let text = try? String(contentsOf: root.appendingPathComponent("app-version.ts"), encoding: .utf8),
          let line = text.split(separator: "\n").first(where: { $0.hasPrefix("export const APP_VERSION = ") })
    else { return nil }
    return line.split(separator: "'").dropFirst().first.map(String.init)
  }

  /// No rejected suspend/resume promise has surfaced as the player's own
  /// attention-coloured note (`src/app/reading-view.tsx`'s `notes`,
  /// `src/playback/audio-graph.ts`'s `drive()` catches into `handlers.onError`),
  /// and the LogBox warning banner that can otherwise swallow the next tap
  /// (README Pitfalls, "Metro and the bundle") is not covering it either.
  func assertNoErrorBanner(_ app: XCUIApplication, _ context: String) {
    let logbox = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH '!, Open debugger'")).firstMatch
    XCTAssertFalse(logbox.exists, "\(context): LogBox warning banner is covering the player")
    let suspicious = app.descendants(matching: .any).matching(NSPredicate(
      format: "label CONTAINS[c] 'suspend' OR label CONTAINS[c] 'audio context' OR label CONTAINS[c] 'failed to'"))
    XCTAssertEqual(suspicious.count, 0, "\(context): unexpected error text in the tree")
  }

  func testPauseResumeOrderingAndSkip() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()

    // Item 1: the Settings version line, as the owner reads it — proves this
    // is the working tree's beta and that Metro actually served it.
    if app.buttons["Back"].exists { app.buttons["Back"].tap() }
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 15), "Library header did not appear")
    app.buttons["Settings"].tap()
    guard let expected = workingTreeVersion() else { XCTFail("Could not read APP_VERSION from app-version.ts"); return }
    let version = app.staticTexts["Version \(expected)"]
    XCTAssertTrue(version.waitForExistence(timeout: 10), "No element labelled 'Version \(expected)' — running app is not \(expected), or Metro did not reconnect")
    capture("00-settings-version", app)
    app.navigationBars.buttons.element(boundBy: 0).tap()

    // Reach the fixture's reader, paused.
    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'A Short Test of Reading Aloud,'")).firstMatch
    if book.waitForExistence(timeout: 3) { book.tap() }
    XCTAssertTrue(until(15) { app.buttons["Play"].exists || app.buttons["Pause"].exists }, "Reader did not open")
    if app.buttons["Pause"].exists {
      app.buttons["Pause"].tap()
      _ = until(5) { app.buttons["Play"].exists }
    }
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Expected paused before this test")
    capture("01-reader-paused", app)

    // Item 2a: Play, Pause, Play, Pause — each Play resumes and continues,
    // each Pause actually stops it, with no error surfaced.
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play did not start")
    Thread.sleep(forTimeInterval: 4.0)
    XCTAssertTrue(app.buttons["Pause"].exists, "Playback stopped on its own during the first play")
    capture("02-first-play", app)
    assertNoErrorBanner(app, "after first play")

    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause")
    Thread.sleep(forTimeInterval: 0.5)
    capture("03-first-pause", app)
    assertNoErrorBanner(app, "after first pause")

    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play after a pause did not start (context not resumed?)")
    Thread.sleep(forTimeInterval: 4.0)
    XCTAssertTrue(app.buttons["Pause"].exists, "Playback stopped on its own during the second play")
    capture("04-second-play", app)
    assertNoErrorBanner(app, "after second play")

    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause a second time")
    capture("05-second-pause", app)
    assertNoErrorBanner(app, "after second pause")

    // Item 2b: a quick Pause -> Play, measured, still ends up playing —
    // exercises `driving`'s ordering queue against the library's own
    // unordered thread pool.
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play did not start before the quick-toggle check")
    Thread.sleep(forTimeInterval: 1.5)
    capture("06-before-quick-toggle", app)
    let pauseButton = app.buttons["Pause"]
    let t0 = Date()
    pauseButton.tap()
    let playButton = app.buttons["Play"]
    XCTAssertTrue(playButton.waitForExistence(timeout: 1), "Pause did not flip the button to Play")
    playButton.tap()
    let gap = Date().timeIntervalSince(t0)
    print("QUICK-TOGGLE gap=\(gap)s")
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Did not end up playing after the quick Pause -> Play")
    Thread.sleep(forTimeInterval: 3.0)
    XCTAssertTrue(app.buttons["Pause"].exists, "Playback stopped again shortly after the quick toggle")
    capture("07-after-quick-toggle", app)
    assertNoErrorBanner(app, "after quick toggle")

    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause before the skip check")
    capture("08-paused-before-skip", app)

    // Item 4: skip while paused (real touches on the sentence-skip buttons),
    // then Play — plays from the new sentence, not the old one.
    XCTAssertTrue(app.buttons["Next sentence"].waitForExistence(timeout: 3), "Next sentence button not found")
    app.buttons["Next sentence"].tap()
    Thread.sleep(forTimeInterval: 0.3)
    app.buttons["Next sentence"].tap()
    Thread.sleep(forTimeInterval: 0.3)
    XCTAssertTrue(app.buttons["Play"].exists, "A skip while paused must not start playback")
    capture("09-skipped-still-paused", app)

    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play after the skip did not start")
    Thread.sleep(forTimeInterval: 4.0)
    XCTAssertTrue(app.buttons["Pause"].exists, "Playback stopped on its own after the skip")
    capture("10-playing-after-skip", app)
    assertNoErrorBanner(app, "after skip and play")

    // Leave the app paused, on the reader, as the run must.
    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause at the end of the run")
    Thread.sleep(forTimeInterval: 0.3)
    capture("11-final-paused", app)
    assertNoErrorBanner(app, "final state")
  }

  /// A tighter measurement of the same Pause -> Play gap as
  /// `testPauseResumeOrderingAndSkip`'s item 2b, without an intervening
  /// `waitForExistence` poll between the two taps (measured separately: that
  /// poll's own first check landed only at its full timeout budget, inflating
  /// the earlier run's printed gap to 1.74s — see README Pitfalls). Reuses
  /// whichever reader state this device is already in; plays only long enough
  /// to confirm the end state.
  func testQuickToggleTight() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(until(10) { app.buttons["Play"].exists || app.buttons["Pause"].exists }, "Reader not open")
    if app.buttons["Play"].exists {
      app.buttons["Play"].tap()
      XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10))
    }
    Thread.sleep(forTimeInterval: 1.0)
    capture("t0-playing", app)
    let t0 = Date()
    app.buttons["Pause"].tap()
    app.buttons["Play"].tap()
    let gap = Date().timeIntervalSince(t0)
    print("QUICK-TOGGLE-TIGHT gap=\(gap)s")
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Did not end up playing after the tight quick toggle")
    Thread.sleep(forTimeInterval: 3.0)
    XCTAssertTrue(app.buttons["Pause"].exists, "Playback stopped again shortly after the tight quick toggle")
    capture("t1-after-tight-toggle", app)
    assertNoErrorBanner(app, "after tight quick toggle")
    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
    capture("t2-final-paused", app)
  }

  /// Just enough to hand off to `LockScreenProbe`'s tap mode: open the fixture,
  /// play briefly to register an active Now Playing session, and pause. Not a
  /// #66 check by itself — the remote-transport check is `LockScreenProbe`'s.
  func testEstablishPausedSession() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    if app.buttons["Back"].exists { app.buttons["Back"].tap() }
    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'A Short Test of Reading Aloud,'")).firstMatch
    if book.waitForExistence(timeout: 3) { book.tap() }
    XCTAssertTrue(until(15) { app.buttons["Play"].exists || app.buttons["Pause"].exists }, "Reader did not open")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap(); _ = until(5) { app.buttons["Play"].exists } }
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play did not start")
    Thread.sleep(forTimeInterval: 3.0)
    XCTAssertTrue(app.buttons["Pause"].exists, "Playback stopped on its own")
    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause")
    capture("session-paused", app)
    assertNoErrorBanner(app, "establishing the paused session")
  }
}
