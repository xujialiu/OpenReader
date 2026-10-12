import XCTest

/// Turns the Sync switch on against the WebDAV test folder, for a verification
/// run (#155 fix, ios-test 2026-10-13). Unlike `SyncProbe`, this is setup, not
/// a test of the screen: it asserts only that the check passed and the fields
/// hold the caller's values, prints the status line, and leaves sync on.
///
/// The Address and Username are **not typed**: a probe run on 2026-10-13 lost
/// characters typing the 79-character URL in ten-character chunks
/// (`https://…` read back `hs://…`; the app's own check refused with "The
/// WebDAV URL must start with http:// or https://."). The caller puts
/// `sync.url` and `sync.username` in the settings with the walkthrough harness
/// (`{"do":"settings","patch":{…}}`) and this probe asserts the fields show
/// them. Only the password is typed, per character with a pause — the recipe
/// of `test/manual-test/README.md`, "Release-check credential input diagnosis".
///
/// Credentials are read from files the caller writes with mode 600 — never
/// typed into this source, printed, or captured. This probe points at the test
/// folder in `~/.secrets/openreader/` only; never the owner's real folder.
///
/// The launch carries `-RCT_jsLocation` (`OPENREADER_METRO_PORT`, handed to
/// the runner by xcodebuild from the caller's `TEST_RUNNER_`-prefixed
/// variable), per test/manual-test/pitfalls/metro.md: a probe's own relaunch
/// drops simctl's launch argument and a fresh container defaults to port 8081.
final class SyncSetupProbe: XCTestCase {
  let addressPath = "/tmp/openreader-sync-url.txt"
  let usernamePath = "/tmp/openreader-sync-user.txt"
  let passwordPath = "/tmp/openreader-sync-pass.txt"

  func secret(_ path: String) -> String {
    guard let text = try? String(contentsOfFile: path, encoding: .utf8) else {
      XCTFail("Write the credential to \(path) (mode 600) before running this probe.")
      return ""
    }
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  func isOn(_ element: XCUIElement) -> Bool { (element.value as? String) == "1" }

  func typeSlowly(_ field: XCUIElement, _ text: String) {
    field.tap()
    for character in text {
      field.typeText(String(character))
      Thread.sleep(forTimeInterval: 0.08)
    }
  }

  func openSync(_ app: XCUIApplication) {
    if app.buttons["Back"].exists { app.buttons["Back"].tap() }
    let settings = app.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 15), "Library header did not appear")
    settings.tap()
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sync'")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5), "Settings has no Sync row")
    row.tap()
  }

  func testTypePasswordAndSwitchOn() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    if let port = ProcessInfo.processInfo.environment["OPENREADER_METRO_PORT"], !port.isEmpty {
      app.launchArguments = ["-RCT_jsLocation", "localhost:\(port)"]
    }
    app.terminate(); app.launch()
    openSync(app)

    let address = app.textFields["Address"]
    let username = app.textFields["Username"]
    let password = app.secureTextFields["Password"]
    let toggle = app.switches["Keep my place across devices"]
    XCTAssertTrue(address.waitForExistence(timeout: 5), "Sync screen did not load")
    XCTAssertTrue(username.exists && password.exists && toggle.exists, "Sync screen is missing a control")
    XCTAssertFalse(isOn(toggle), "Start this probe with the switch off")

    XCTAssertEqual(address.value as? String ?? "", secret(addressPath),
                   "The Address field does not show the caller's url; patch settings.sync.url with the harness first")
    XCTAssertEqual(username.value as? String ?? "", secret(usernamePath),
                   "The Username field does not show the caller's username; patch settings.sync.username with the harness first")

    typeSlowly(password, secret(passwordPath))
    if app.keyboards.count > 0 {
      let done = app.keyboards.buttons["Done"]
      if done.waitForExistence(timeout: 1) { done.tap() }
    }
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "count == 0"), object: app.keyboards)], timeout: 3)

    toggle.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "value == '1'"), object: toggle)], timeout: 20)
    XCTAssertTrue(isOn(toggle), "The check did not pass; status: \(app.staticTexts.allElementsBoundByIndex.map { $0.label })")
    Thread.sleep(forTimeInterval: 8)
    print("SYNC-SETUP on, status lines: \(app.staticTexts.allElementsBoundByIndex.map { $0.label })")
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = "sync-setup-tree"; tree.lifetime = .keepAlways; add(tree)
    // Leave the app on the Settings screen; the caller navigates on from there.
    app.buttons["Back"].tap()
  }
}
