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

  /// A remote Play at the end is refused without starting an audio graph.
  /// iOS optimistically changes the label before JS answers; allow the existing
  /// 400 ms restatement, then require stable Play. Never send a second command
  /// here: an automatic Pause would hide a failure. Caller checks Debug Logs
  /// for the delivered play, no audio resume/synthesis, and the retained note.
  func testPlayAtEndStaysStopped() throws {
    continueAfterFailure = false
    let settings = Bundle(for: Self.self)
    let target = try XCTUnwrap(settings.object(forInfoDictionaryKey: "ManualTargetBundleIdentifier") as? String)
    let app = XCUIApplication(bundleIdentifier: target)
    app.activate()
    XCTAssertTrue(app.buttons["Play"].exists, "Precondition: Reader must be stopped")
    XCTAssertFalse(app.buttons["Pause"].exists)
    let endNote = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "That was the last of this document.")).firstMatch
    XCTAssertTrue(endNote.exists, "Precondition: the Document must actually have ended")
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.01))
      .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.7)))
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let center = springboard.buttons["UIA.MediaControls.NowPlaying.CenterButton"]
    XCTAssertTrue(center.waitForExistence(timeout: 3), "Now Playing button is missing")
    XCTAssertTrue(center.isEnabled)
    XCTAssertEqual(center.label, "Play")
    let before = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    before.name = "lock-screen-before-tap"; before.lifetime = .keepAlways; add(before)
    let tapMark = ISO8601DateFormatter().string(from: Date())
    center.tap()
    // The module's measured restatement delay is 400 ms. Check at one second,
    // then two seconds later, with no input that could stop a phantom Reading.
    Thread.sleep(forTimeInterval: 1)
    XCTAssertEqual(center.label, "Play", "The card did not return to stopped after end refusal")
    Thread.sleep(forTimeInterval: 2)
    XCTAssertEqual(center.label, "Play", "The card did not stay stopped")
    let after = XCTAttachment(string: "tapMark=\(tapMark) labelAfterWait=\(center.label) commandsSent=1")
    after.name = "after-tap"; after.lifetime = .keepAlways; add(after)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = "lock-screen-after-tap"; image.lifetime = .keepAlways; add(image)
    app.activate()
    XCTAssertTrue(app.buttons["Play"].exists)
    XCTAssertFalse(app.buttons["Pause"].exists)
    XCTAssertTrue(endNote.exists, "The end explanation disappeared")
  }
}
