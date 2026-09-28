import XCTest

/// Real touch for #71 (ADR 0050): a finger dragging the page during playback
/// stops the program's glide at once (`halt()`, on the first `touchmove`) and
/// puts the page in Browsing past 10 px (`DRAG_PX`), so a later line change
/// does not move it; Play-pause-Play then brings it back. `line-follow.cjs`
/// proves the program's own side with a synthetic click; this is the real
/// finger `browse-probe.cjs`/`BrowseTouchProbe` could not touch either, because
/// none of them drags **during a live glide**.
///
/// A companion host script, `glide-touch.cjs`, arms a per-frame `scrollTop`
/// and real-touch-timestamp recorder in the reader's WebView before this runs
/// (`arm`) and reads it back after (`analyse`) — the same idea as
/// `browse-touch-state.cjs` beside `BrowseTouchProbe`, but continuous over the
/// whole method rather than a single before/after diff, because what matters
/// here is the frame the touch landed on.
///
/// Needs a reader already open, paused, on a sentence with Word Timings
/// (Fish/Azure/Speechify/Kokoro), `glide-touch.cjs arm` already run, and the
/// simulator silenced. `.activate()` only, never `.terminate()/.launch()`,
/// the same reason `PlayerTouchProbe`/`BrowseTouchProbe` give: the point is
/// this book, this position, this Voice, already loaded.
///
/// `DRAG_DELAY_MS` (`/tmp/openreader-glide-touch-params.txt`, `KEY=VALUE`,
/// default 2000): how long after Play's own cue (the
/// `Pause` button's `busy` state clearing, `BrowseTouchProbe`'s own signal for
/// "the first Clip has started") to wait before the real drag. Timed from the
/// cue rather than from the tap because the cue is the one signal this method
/// can observe; the cadence from cue to the first line change still varies
/// with where the reading is and how long its first sentence is, so this is a
/// best-effort aim at a live glide, not a guarantee — `glide-touch.cjs
/// analyse` reads what actually happened relative to the recorded touch
/// timestamps regardless of whether this aim landed.
final class GlideTouchProbe: XCTestCase {
  /// `xcodebuild … test` does not pass the caller's environment to the test
  /// process (README Pitfalls), so the caller writes `KEY=VALUE` lines to this
  /// file instead — the same convention `SyncProbe.param` uses.
  func param(_ key: String, _ fallback: String) -> String {
    if let text = try? String(contentsOfFile: "/tmp/openreader-glide-touch-params.txt", encoding: .utf8) {
      for line in text.split(separator: "\n") where line.hasPrefix(key + "=") {
        return String(line.dropFirst(key.count + 1)).trimmingCharacters(in: .whitespaces)
      }
    }
    return ProcessInfo.processInfo.environment[key] ?? fallback
  }

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

  /// Waits for the Pause button's own `busy` accessibility state to clear —
  /// the first Clip's cue (`BrowseTouchProbe.testPlayAfterBrowseReturnsAtFirstCue`
  /// uses the same signal). Returns whether it cleared before `timeout`.
  func waitForCue(_ app: XCUIApplication, timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      guard app.buttons["Pause"].exists else { return false }
      if (app.buttons["Pause"].value as? String)?.contains("busy") != true { return true }
      Thread.sleep(forTimeInterval: 0.1)
    }
    return false
  }

  func testDragDuringLiveGlideStopsThenRecovers() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(waitForReaderReady(app), "Reader was not ready")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap(); XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5)) }
    capture("gt-00-before-play", app)

    let delayMs = Double(param("DRAG_DELAY_MS", "2000")) ?? 2000
    let playTapAt = Date()
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5), "Play did not start")
    let cued = waitForCue(app, timeout: 30)
    let cueAt = Date()
    print("GLIDETOUCH play-tap-to-cue=\(cueAt.timeIntervalSince(playTapAt))s cued=\(cued)")
    XCTAssertTrue(cued, "The first Clip's cue never arrived (busy state never cleared)")

    Thread.sleep(forTimeInterval: delayMs / 1000)
    XCTAssertTrue(app.buttons["Pause"].exists, "Must still be playing just before the drag")

    // A small real drag: comfortably past the WebView's 10 px DRAG_PX, well
    // short of a fling (FlingProbe's own low/high points are the full 0.30 to
    // 0.70 of the window; this moves about a tenth of that).
    let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.44))
    let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.36))
    let dragIssuedAt = Date()
    from.press(forDuration: 0.05, thenDragTo: to, withVelocity: XCUIGestureVelocity(250), thenHoldForDuration: 0.1)
    let dragDoneAt = Date()
    print("GLIDETOUCH drag issued at +\(dragIssuedAt.timeIntervalSince(playTapAt))s (+\(dragIssuedAt.timeIntervalSince(cueAt))s after cue), gesture took \(dragDoneAt.timeIntervalSince(dragIssuedAt))s")
    capture("gt-01-after-drag", app)
    XCTAssertTrue(app.buttons["Pause"].exists, "A drag must not pause playback")

    // Let a further sentence or two pass while still playing, to give
    // Browsing (if engaged) something it would otherwise have moved.
    Thread.sleep(forTimeInterval: 4.0)
    XCTAssertTrue(app.buttons["Pause"].exists, "Still expected playing after the drag settled")
    capture("gt-02-still-playing-after-settle", app)

    // Recovery: Play-pause-Play. The drag was small, so the reading should
    // still be within a page of where the drag left it — a glide back, not a
    // jump; `glide-touch.cjs analyse`'s own episode list is what actually
    // proves that, not this method.
    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause")
    Thread.sleep(forTimeInterval: 0.3)
    capture("gt-03-paused", app)
    let recoverAt = Date()
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5), "Recovery Play did not start")
    Thread.sleep(forTimeInterval: 1.2)
    print("GLIDETOUCH recovery play-tap-to-1.2s-later elapsed=\(Date().timeIntervalSince(recoverAt))s")
    capture("gt-04-recovered-playing", app)

    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause back at the end")
    Thread.sleep(forTimeInterval: 0.3)
    capture("gt-05-paused-again", app)
  }
}
