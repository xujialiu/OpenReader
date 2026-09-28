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
}
