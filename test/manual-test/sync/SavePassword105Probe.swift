import XCTest

/**
 * Dismisses the system **Save Password?** alert with a real tap for #105's
 * simulator run.
 *
 * Typing a gateway credential into the Provider screen's masked field makes
 * iOS offer to save a password; the alert then sits over the reader. Like the
 * share sheet (pitfalls/mcp.md), its contents are a remote view: invisible to
 * `snapshot_ui` and to AXe, and the first version of this probe found no
 * `Not Now` under `com.apple.springboard`. The alert is searched wherever it
 * may live — the app's own tree, springboard's buttons and alerts — and,
 * failing that, iOS's interruption-monitor path is driven, with the trees
 * printed so the next run needs no guessing.
 *
 *     bash test/manual-test/kit/run-probe.sh SavePassword105Probe \
 *       SIMULATOR_UDID OUTPUT_DIR
 *
 * What it cannot prove: anything about the app. It only clears the alert.
 */
final class SavePassword105Probe: XCTestCase {

  func testDismissSavePasswordAlert() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    app.activate()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10), "OpenReader did not come to the front")

    let candidates: [String: XCUIElement] = [
      "app.buttons['Not Now']": app.buttons["Not Now"],
      "app.alerts.buttons['Not Now']": app.alerts.buttons["Not Now"],
      "app.otherElements.buttons['Not Now']": app.otherElements.buttons["Not Now"],
      "springboard.buttons['Not Now']": springboard.buttons["Not Now"],
      "springboard.alerts.buttons['Not Now']": springboard.alerts.buttons["Not Now"],
      "springboard.otherElements.buttons['Not Now']": springboard.otherElements.buttons["Not Now"],
    ]
    for (name, element) in candidates where element.exists {
      print("DISMISSING via \(name)")
      element.tap()
      let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == 0"), object: element)
      XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 5), .completed, "The alert must be gone after tapping Not Now via \(name)")
      return
    }

    // Nothing exposed directly: drive iOS's interruption monitor with a tap
    // in the app, then look once more (the monitor answers the alert's own
    // buttons out of band).
    let monitorFired = expectation(description: "interruption monitor fired")
    var monitor: NSObjectProtocol?
    monitor = addUIInterruptionMonitor(withDescription: "Save Password?") { alert in
      monitorFired.fulfill()
      let button = alert.buttons["Not Now"].exists ? alert.buttons["Not Now"] : alert.buttons.firstMatch
      if button.exists { button.tap(); return true }
      return false
    }
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()
    _ = XCTWaiter.wait(for: [monitorFired], timeout: 8)
    if let monitor { removeUIInterruptionMonitor(monitor) }

    for (name, element) in candidates where element.exists {
      print("DISMISSING (second pass) via \(name)")
      element.tap()
      return
    }

    print("SPRINGBOARD TREE: \(springboard.debugDescription.prefix(3000))")
    XCTFail("No 'Not Now' button found in the app's or springboard's tree; trees printed above")
  }
}
