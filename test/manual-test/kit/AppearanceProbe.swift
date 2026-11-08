import XCTest

/// Ordinary-lane #354 flow: ONE attach-only run that opens the Word Boundaries
/// document, captures the Appearance-closed passage, opens the Appearance
/// drawer through the real menu buttons, steps the native Font Size stepper
/// down and back up, and captures the screen at every step. The tester's phase
/// script watches the `[flow]` markers in the test log and takes its own
/// active-display captures and harness reads while the app stays foreground.
/// The title-bar buttons are only reachable through this instrumentation
/// channel on the ordinary window (synthetic HID taps there are consumed by
/// window chrome). Never launches cold (attaches to the running app), never
/// types, never injects appearance state.
final class AppearanceProbe: XCTestCase {

  private let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")

  private func mark(_ text: String) {
    print("[flow] \(text)")
    Thread.sleep(forTimeInterval: 0.3)
  }

  private func capture(_ name: String) {
    let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    shot.name = name
    shot.lifetime = .keepAlways
    add(shot)
  }

  func testAppearanceFlow() {
    guard app.state != .notRunning else { XCTFail("attach-only probe refuses a dead target"); return }
    app.activate()
    guard app.state == .runningForeground else { XCTFail("Target is not foreground"); return }

    let close = app.buttons["Close Lookup"]
    if close.exists { close.tap(); sleep(1) }

    let row = app.buttons["Word Boundaries for Lookup, Not started."]
    guard row.waitForExistence(timeout: 10) else {
      XCTFail("Word Boundaries Library row missing")
      return
    }
    row.tap()
    let more = app.buttons["More actions"]
    guard more.waitForExistence(timeout: 12) else {
      XCTFail("Reader did not open (More actions missing)")
      return
    }
    sleep(3) // settle the first page render
    mark("doc-open")
    capture("before-closed-screen")
    mark("before-captured")
    sleep(6) // hold for the phase's active-display capture and harness reads

    more.tap()
    let appearance = app.buttons["Appearance"]
    guard appearance.waitForExistence(timeout: 8) else {
      XCTFail("Appearance row missing in the reader menu")
      return
    }
    appearance.tap()
    let plus = app.buttons["Increase font size"]
    guard plus.waitForExistence(timeout: 8) else {
      XCTFail("Appearance drawer did not open (Font Size stepper missing)")
      return
    }
    mark("drawer-open")
    capture("opened-screen")
    mark("opened-captured")
    sleep(6) // hold for the phase's capture and harness reads

    let minus = app.buttons["Decrease font size"]
    guard minus.waitForExistence(timeout: 8) else {
      XCTFail("Decrease stepper missing")
      return
    }
    minus.tap()
    sleep(2) // reflow + live harness read window
    capture("decreased-screen")
    mark("decreased")
    sleep(6) // hold the changed state for the phase's harness reads
    mark("decreased-hold-done")

    plus.tap()
    sleep(2)
    capture("restored-screen")
    mark("restored")
    sleep(6) // hold for the phase's harness reads
    let value = app.staticTexts["24"]
    XCTAssertTrue(value.exists || value.waitForExistence(timeout: 5),
                  "Font Size stepper value 24 not shown after the restore")
    mark("done")
  }
}
