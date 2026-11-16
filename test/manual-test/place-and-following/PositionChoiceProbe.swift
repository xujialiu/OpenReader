import XCTest

/// Qualified real XCUITest input for the #367 verification. The AXe tree on
/// this device went hollow twice (bare Application node; one recorded
/// shutdown+boot recovery restored it once, then it recurred), so every input
/// here is XCTest: tap a native button/switch/row by label (exact or prefix),
/// toggle a switch with its before/after value asserted, answer the Consent
/// alert through the native alert query after checking its recipient, or tap /
/// press one point in the reader's page. Attaches to the already running app
/// (`.activate()` only — a cold launch would drop the pinned `-RCT_jsLocation`;
/// the caller relaunches through `simctl` with the argument). Plays nothing by
/// itself; the caller reads the app's own state (harness `say`/`shelf` over
/// CDP, the Debug Log, `library.json`/`settings.json`, screenshots) after each
/// action.
///
///   bash test/manual-test/kit/run-probe.sh PositionChoiceProbe SIMULATOR_UDID OUT_DIR \
///     -only-testing:PositionChoiceProbe/testRunAction -collect-test-diagnostics never
///
/// Environment (xcodebuild hands TEST_RUNNER_-prefixed keys to the runner
/// without the prefix, so invoke with TEST_RUNNER_POS_...):
///   POS_ACTION   `button` (default) | `toggle` | `alert` | `point` | `query` | `swipe` | `type`
///   POS_DIRECTION  `down` (default) | `up` | `left` | `right` for `swipe`
///   POS_TEXT     the text for `type` (synthetic test values only — XCTest
///                typing echoes a prefix into raw logs; never real credentials)
///   POS_LABEL    exact label (or the prefix for POS_MATCH=begins) of the
///                element to touch
///   POS_KIND     `any` (default) | `button` | `switch` | `cell`
///   POS_MATCH    `exact` (default) | `begins`
///   POS_X / POS_Y  the point in app points for `point` (ax.py tree's space)
///   POS_MODE     `tap` (default) | `press`; POS_PRESS_SECONDS (default 1.0)
///   POS_SETTLE   seconds to wait after the action (default 1.2)
///   POS_EXPECT_SWITCH  `label=value` asserted AFTER the action (a mismatch
///                fails the run, so the zero-failure line covers the flip)
///   POS_EXPECT_LABEL   a label (POS_MATCH applies) that must exist afterwards
///   POS_EXPECT_ABSENT  a label (POS_MATCH applies) that must not exist
///   POS_ASSERT_PAUSED  1 → `Play` must exist and `Pause` must not afterwards
///   POS_ALERT_TITLE    `alert`: a substring of the approved recipient's title
///   POS_ALERT_ANSWER   `alert`: `Allow` or `Don't Allow`
final class PositionChoiceProbe: XCTestCase {

  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func element(_ app: XCUIApplication, label: String, kind: String, begins: Bool) -> XCUIElement {
    let predicate = begins
      ? NSPredicate(format: "label BEGINSWITH %@", label)
      : NSPredicate(format: "label == %@", label)
    switch kind {
    case "button": return app.buttons.matching(predicate).firstMatch
    case "switch": return app.switches.matching(predicate).firstMatch
    case "cell": return app.cells.matching(predicate).firstMatch
    default: return app.descendants(matching: .any).matching(predicate).firstMatch
    }
  }

  func switchValue(_ app: XCUIApplication, _ label: String, begins: Bool) -> String? {
    let one = app.switches.matching(
      begins ? NSPredicate(format: "label BEGINSWITH %@", label) : NSPredicate(format: "label == %@", label)
    ).firstMatch
    return one.exists ? (one.value as? String) : nil
  }

  func testRunAction() throws {
    let raw = ProcessInfo.processInfo.environment
    let env = Dictionary(uniqueKeysWithValues: raw.map { (key, value) in
      (key.hasPrefix("TEST_RUNNER_") ? String(key.dropFirst("TEST_RUNNER_".count)) : key, value)
    })
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    guard app.state == .runningBackground || app.state == .runningForeground else {
      XCTFail("Attach to the running app with its pinned -RCT_jsLocation; relaunch through simctl first")
      return
    }
    app.activate()
    let action = env["POS_ACTION"] ?? "button"
    let settle = Double(env["POS_SETTLE"] ?? "1.2") ?? 1.2
    let begins = env["POS_MATCH"] == "begins"

    if action == "query" {
      guard let label = env["POS_LABEL"] else { XCTFail("POS_LABEL names the element to query"); return }
      let kind = env["POS_KIND"] ?? "any"
      let one = element(app, label: label, kind: kind, begins: begins)
      XCTAssertTrue(one.waitForExistence(timeout: 8), "No \(kind) element '\(label)' to query")
      let value = (one.value as? String) ?? "<none>"
      print("POS-QUERY label='\(label)' kind=\(kind) value=\(value)")
      capture("query-\(label)", app)
      return
    }

    if action == "alert" {
      let title = try XCTUnwrap(env["POS_ALERT_TITLE"], "Name the approved recipient's title substring")
      let answer = try XCTUnwrap(env["POS_ALERT_ANSWER"], "Choose the Consent answer explicitly")
      XCTAssertTrue(["Allow", "Don't Allow"].contains(answer), "Unknown Consent answer")
      let alert = app.alerts.firstMatch
      XCTAssertTrue(alert.waitForExistence(timeout: 15), "No alert is up")
      let titleText = alert.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
      XCTAssertTrue(titleText.exists, "The pending alert is not for '\(title)'")
      capture("alert-before", app)
      let button = alert.buttons[answer]
      XCTAssertTrue(button.exists, "The alert has no \(answer)")
      button.tap()
      Thread.sleep(forTimeInterval: 1)
      XCTAssertFalse(app.alerts.firstMatch.exists, "The alert stayed up after \(answer)")
      print("POS-ALERT answered '\(answer)' for '\(title)'")
      capture("alert-after", app)
      Thread.sleep(forTimeInterval: settle)
      assertAfter(app, env)
      return
    }

    if action == "point" {
      let x = Double(env["POS_X"] ?? "") ?? 0
      let y = Double(env["POS_Y"] ?? "") ?? 0
      let mode = env["POS_MODE"] ?? "tap"
      let coordinate = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
        .withOffset(CGVector(dx: x, dy: y))
      capture("point-before", app)
      if mode == "press" {
        let seconds = Double(env["POS_PRESS_SECONDS"] ?? "1.0") ?? 1.0
        coordinate.press(forDuration: seconds)
        print("POS-PRESS at=(\(x), \(y)) seconds=\(seconds)")
      } else {
        coordinate.tap()
        print("POS-TAP at=(\(x), \(y))")
      }
      Thread.sleep(forTimeInterval: settle)
      capture("point-after", app)
      assertAfter(app, env)
      return
    }

    if action == "swipe" {
      let direction = env["POS_DIRECTION"] ?? "down"
      capture("swipe-before", app)
      switch direction {
      case "up": app.swipeUp(velocity: .fast)
      case "left": app.swipeLeft()
      case "right": app.swipeRight()
      default: app.swipeDown()
      }
      print("POS-SWIPE \(direction)")
      Thread.sleep(forTimeInterval: settle)
      capture("swipe-after", app)
      return
    }

    if action == "toggle" {
      guard let label = env["POS_LABEL"] else { XCTFail("POS_LABEL names the switch"); return }
      let one = app.switches[label].firstMatch
      XCTAssertTrue(one.waitForExistence(timeout: 10), "No switch '\(label)'")
      let before = (one.value as? String) ?? "<none>"
      capture("toggle-before-\(label)", app)
      one.tap()
      print("POS-TOGGLE switch='\(label)' before=\(before)")
      Thread.sleep(forTimeInterval: settle)
      capture("toggle-after-\(label)", app)
      assertAfter(app, env)
      return
    }

    if action == "type" {
      guard let label = env["POS_LABEL"] else { XCTFail("POS_LABEL names the text field"); return }
      let text = try XCTUnwrap(env["POS_TEXT"], "POS_TEXT carries the text to type")
      let expect = env["POS_EXPECT_FIELD"]
      let plain = app.textFields[label].firstMatch
      let secure = app.secureTextFields[label].firstMatch
      let field = plain.exists ? plain : secure
      XCTAssertTrue(field.waitForExistence(timeout: 10), "No text field '\(label)' (plain or secure)")
      XCTAssertTrue(field.isHittable, "Text field '\(label)' is not hittable")
      capture("type-before-\(label)", app)
      // RN controlled inputs duplicate fast per-character typing, and focus can
      // land after early keystrokes: tap, clear, type in ONE call, then verify
      // the field's value and retry the whole round up to three times.
      var got = (field.value as? String) ?? ""
      var round = 0
      while got != (expect ?? text) && round < 3 {
        round += 1
        field.tap()
        Thread.sleep(forTimeInterval: 0.8)
        got = (field.value as? String) ?? ""
        if !got.isEmpty {
          field.typeText(String(repeating: "\u{8}", count: min(got.count + 8, 160)))
          Thread.sleep(forTimeInterval: 0.5)
        }
        field.typeText(text)
        Thread.sleep(forTimeInterval: settle)
        got = (field.value as? String) ?? ""
        print("POS-TYPE field='\(label)' round=\(round) value='\(got)'")
      }
      if let want = expect {
        XCTAssertEqual(got, want, "Field '\(label)' reads '\(got)' after \(round) typing rounds, expected '\(want)'")
      }
      capture("type-after-\(label)", app)
      return
    }

    // action == "button"
    guard let label = env["POS_LABEL"] else { XCTFail("POS_LABEL names the button to touch"); return }
    let kind = env["POS_KIND"] ?? "button"
    let one = element(app, label: label, kind: kind, begins: begins)
    XCTAssertTrue(one.waitForExistence(timeout: 10), "No \(kind) element '\(label)' to touch")
    let labelSeen = (one.value as? String) ?? label
    XCTAssertTrue(one.isHittable, "'\(labelSeen)' exists but is not hittable (covered or off-screen)")
    capture("button-before-\(label)", app)
    one.tap()
    print("POS-TAP-BUTTON label='\(labelSeen)' kind=\(kind) match=\(begins ? "begins" : "exact")")
    Thread.sleep(forTimeInterval: settle)
    capture("button-after-\(label)", app)
    assertAfter(app, env)
  }

  /// The asked after-state checks; each failure is a failed assertion of the
  /// run, so `Executed 1 test, with 0 failures` covers them.
  func assertAfter(_ app: XCUIApplication, _ env: [String: String]) {
    if let expect = env["POS_EXPECT_SWITCH"] {
      let parts = expect.split(separator: "=", maxSplits: 1).map(String.init)
      XCTAssertTrue(parts.count == 2, "POS_EXPECT_SWITCH is label=value")
      let (label, want) = (parts[0], parts[1])
      let got = switchValue(app, label, begins: false) ?? "<missing>"
      print("POS-AFTER switch='\(label)' value=\(got) expected=\(want)")
      XCTAssertEqual(got, want, "Switch '\(label)' read \(got) after the action, expected \(want)")
    }
    if let present = env["POS_EXPECT_LABEL"] {
      let begins = env["POS_MATCH"] == "begins"
      let predicate = begins ? NSPredicate(format: "label BEGINSWITH %@", present) : NSPredicate(format: "label == %@", present)
      XCTAssertTrue(app.descendants(matching: .any).matching(predicate).firstMatch.exists,
                    "Expected '\(present)' to exist after the action")
    }
    if let absent = env["POS_EXPECT_ABSENT"] {
      let predicate = NSPredicate(format: "label == %@", absent)
      XCTAssertFalse(app.descendants(matching: .any).matching(predicate).firstMatch.exists,
                     "Expected '\(absent)' to be gone after the action")
    }
    if env["POS_ASSERT_PAUSED"] == "1" {
      XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Expected the reading paused (no Play button)")
      XCTAssertFalse(app.buttons["Pause"].exists, "Expected the reading paused (Pause still showing)")
      print("POS-AFTER paused=true")
    }
  }
}
