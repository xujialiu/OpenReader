import XCTest

/// One real XCUITest touch on the reader's page at given points, for when the
/// AXe's synthetic input does not land on the WebView's text (pitfalls/mcp.md:
/// "A zero-delay single-call touch --down --up silently no-ops on the reader's
/// WebView text, and --tap-style physical can no-op there too" — measured again
/// 2026-10-12, ADR 0077 verification, where all three `axe tap` styles and
/// `touch` no-op'd on the page across a reboot while native buttons answered a
/// label-resolved touch).
///
/// Reads the environment (xcodebuild hands TEST_RUNNER_-prefixed keys to the
/// runner without the prefix, so invoke with TEST_RUNNER_OPENREADER_TOUCH_X=…):
///
///   OPENREADER_METRO_PORT  this tree's Metro port, when a cold launch is
///                          needed (default 8081; the installed build has an
///                          empty RCTMetroPort — pitfalls/metro.md)
///   OPENREADER_TOUCH_X / OPENREADER_TOUCH_Y  the point in app coordinates
///                          (points, the space ax.py tree prints), default 0/0
///   OPENREADER_TOUCH_MODE  `tap` (default) or `press`
///   OPENREADER_PRESS_SECONDS  press duration for `press` (default 1.0)
///
/// The running app is brought to the foreground without a cold launch when it
/// is already running (`activate()`), so `simctl launch`'s pinned
/// `-RCT_jsLocation` is not lost; a cold launch pins the port itself. Asserts
/// nothing about the reading — the caller reads the app's own status (harness
/// `say`, Debug Log) and the screen. Leaves the app on the reader.
final class ReaderTouchProbe: XCTestCase {
  func testTouchPoint() throws {
    let env = ProcessInfo.processInfo.environment
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    if app.state == .runningBackground || app.state == .runningForeground {
      app.activate()
    } else {
      let port = env["OPENREADER_METRO_PORT"] ?? "8081"
      app.launchArguments = ["-RCT_jsLocation", "localhost:" + port]
      app.launch()
    }
    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 20), "The app never showed its chrome")
    Thread.sleep(forTimeInterval: 2) // the page's text and its handlers settle
    let x = Double(env["OPENREADER_TOUCH_X"] ?? "0") ?? 0
    let y = Double(env["OPENREADER_TOUCH_Y"] ?? "0") ?? 0
    let mode = env["OPENREADER_TOUCH_MODE"] ?? "tap"
    let coordinate = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
      .withOffset(CGVector(dx: x, dy: y))
    if mode == "press" {
      let seconds = Double(env["OPENREADER_PRESS_SECONDS"] ?? "1.0") ?? 1.0
      coordinate.press(forDuration: seconds)
    } else {
      coordinate.tap()
    }
    print("READERTOUCH mode=\(mode) at=(\(x), \(y))")
    Thread.sleep(forTimeInterval: 3) // let a started reading report itself
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = "tree-after-touch"
    tree.lifetime = .keepAlways
    add(tree)
  }

  /// Answers the consent alert that holds a first Play ("Send text to …?") by
  /// XCUITest's own alert query — the way ConsentProbe does — because a
  /// coordinate tap does not reach the alert's window (measured 2026-10-12,
  /// ADR 0077 verification: a tap at the Allow button's own centre left the
  /// alert up). Reads OPENREADER_CONSENT_ANSWER: `Allow` (default) or
  /// `Don't Allow`. Succeeds only when the alert is gone afterwards.
  func testAnswerConsent() throws {
    let env = ProcessInfo.processInfo.environment
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    if app.state == .runningBackground || app.state == .runningForeground {
      app.activate()
    } else {
      let port = env["OPENREADER_METRO_PORT"] ?? "8081"
      app.launchArguments = ["-RCT_jsLocation", "localhost:" + port]
      app.launch()
    }
    let answer = env["OPENREADER_CONSENT_ANSWER"] ?? "Allow"
    let alert = app.alerts.firstMatch
    XCTAssertTrue(alert.waitForExistence(timeout: 10), "No consent alert is up")
    let button = alert.buttons[answer]
    XCTAssertTrue(button.exists, "The alert has no \(answer)")
    button.tap()
    Thread.sleep(forTimeInterval: 1)
    XCTAssertFalse(app.alerts.firstMatch.exists, "The alert stayed up after \(answer)")
    print("READERTOUCH consent answered: \(answer)")
  }
}
