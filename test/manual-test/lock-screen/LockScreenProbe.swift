import XCTest

/// Operates the installed app; does not launch a Provider reading by itself.
final class LockScreenProbe: XCTestCase {
  func testLockScreen() throws {
    let settings = Bundle(for: Self.self)
    let target = try XCTUnwrap(settings.object(forInfoDictionaryKey: "ManualTargetBundleIdentifier") as? String)
    let app = XCUIApplication(bundleIdentifier: target)
    app.activate()
    // The LEFT edge opens Notification Centre's lock-screen surface. The right
    // edge opens Control Centre, which does not reproduce this UI.
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.01))
      .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.7)))
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let center = springboard.buttons["UIA.MediaControls.NowPlaying.CenterButton"]
    if settings.object(forInfoDictionaryKey: "ManualExpectPlayer") as? String == "YES" {
      XCTAssertTrue(center.waitForExistence(timeout: 3), "Now Playing center button is missing")
    }
    let tree = XCTAttachment(string: springboard.debugDescription)
    tree.name = "lock-screen-accessibility"; tree.lifetime = .keepAlways; add(tree)
    if center.exists {
      let frame = center.frame
      let data = try JSONSerialization.data(withJSONObject: [
        "label": center.label, "enabled": center.isEnabled,
        "screenWidth": springboard.frame.width,
        "x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height,
      ], options: [.prettyPrinted, .sortedKeys])
      let geometry = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
      geometry.name = "center-button"; geometry.lifetime = .keepAlways; add(geometry)
    }
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = "lock-screen"; image.lifetime = .keepAlways; add(image)
    // Accessibility existence is NOT a visual pass. Inspect the attached image.
    if settings.object(forInfoDictionaryKey: "ManualMode") as? String == "tap" {
      guard center.exists && center.label == "Play" else {
        XCTFail("Start the transport check with playback paused")
        app.activate()
        if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
        return
      }
      // Stop as soon as the state change is established, including failure paths.
      center.tap()
      let pausedLabel = NSPredicate(format: "label == %@", "Pause")
      let playing = XCTNSPredicateExpectation(predicate: pausedLabel, object: center)
      let changed = XCTWaiter.wait(for: [playing], timeout: 3) == .completed
      if center.exists && center.label == "Pause" { center.tap() }
      else {
        app.activate()
        if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
      }
      XCTAssertTrue(changed, "Lock-screen Play did not become Pause")
      if changed {
        let stopped = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "Play"), object: center)
        XCTAssertEqual(XCTWaiter.wait(for: [stopped], timeout: 3), .completed)
      }
    }
    app.activate()
    if settings.object(forInfoDictionaryKey: "ManualMode") as? String == "tap",
       app.buttons["Pause"].exists {
      app.buttons["Pause"].tap()
      XCTFail("Transport check needed an app-side pause to stop playback")
    }
  }

  /// Play pressed on the lock-screen card at the END of a Document (#156).
  ///
  /// Preconditions, asserted here and by the caller: the Reader is open on a
  /// Document whose reading has run out at the end (the player bar shows Play),
  /// and the card shows Play. The press must NOT start playback: the button
  /// stays "Play", the app stays stopped, and the caller proves from the Debug
  /// Log and the provider log that the play attempt was answered with the end
  /// note and no synthesis.
  func testPlayAtEndStaysStopped() throws {
  let settings = Bundle(for: Self.self)
  let target = try XCTUnwrap(settings.object(forInfoDictionaryKey: "ManualTargetBundleIdentifier") as? String)
  let app = XCUIApplication(bundleIdentifier: target)
  app.activate()
  XCTAssertTrue(app.buttons["Play"].exists, "Precondition: the Reader's reading must be stopped (Play present)")
  XCTAssertFalse(app.buttons["Pause"].exists, "Precondition: the Reader's reading must not be playing")
  // The LEFT edge opens Notification Centre's lock-screen surface.
  app.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.01))
    .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.7)))
  let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
  let center = springboard.buttons["UIA.MediaControls.NowPlaying.CenterButton"]
  XCTAssertTrue(center.waitForExistence(timeout: 3), "Now Playing center button is missing")
  XCTAssertTrue(center.isEnabled, "The centre button must be enabled")
  XCTAssertEqual(center.label, "Play", "Precondition: the card must show Play (the reading is stopped)")
  let tree = XCTAttachment(string: springboard.debugDescription)
  tree.name = "lock-screen-accessibility"; tree.lifetime = .keepAlways; add(tree)
  let before = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
  before.name = "lock-screen-before-tap"; before.lifetime = .keepAlways; add(before)
  // The single press under test.
  let tapMark = ISO8601DateFormatter().string(from: Date())
  center.tap()
  // At the end of a Document the reading must stay stopped: the button must
  // not become "Pause" (that would mean playback started).
  let becamePause = NSPredicate(format: "label == %@", "Pause")
  let flipped = XCTNSPredicateExpectation(predicate: becamePause, object: center)
  let started = XCTWaiter.wait(for: [flipped], timeout: 3) == .completed
  let after = XCTAttachment(string: "tapMark=\(tapMark) startedPlayback=\(started) labelAfterWait=\(center.exists ? center.label : "gone")")
  after.name = "after-tap"; after.lifetime = .keepAlways; add(after)
  let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
  image.name = "lock-screen-after-tap"; image.lifetime = .keepAlways; add(image)
  XCTAssertFalse(started, "Lock-screen Play started playback at the end of the document")
  if started, center.exists, center.label == "Pause" { center.tap() }
  app.activate()
  XCTAssertTrue(app.buttons["Play"].exists, "The reading must remain stopped after the lock-screen Play press")
  XCTAssertFalse(app.buttons["Pause"].exists, "The reading must remain stopped after the lock-screen Play press")
  }
}
