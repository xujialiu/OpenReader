import XCTest

/// The #177 recovery on the real Sync screen: a failed sync, then off → correct
/// password → on inside the 60 s retry window, with the switch-on run's own
/// status line as the proof that a run (not only the check) followed.
///
/// Caller staging (host side):
///   - the stub restricts accepted passwords to the NEW one
///     (`/__accept?list=...`), so the app's saved password is rejected;
///   - sync is already ON with the OLD password saved;
///   - credential files written mode 600:
///       /tmp/openreader-sync-pass.txt   the OLD password (only its length is
///                                       read, to clear the field)
///       /tmp/openreader-sync-pass2.txt  the NEW password to type
///   - OPENREADER_METRO_PORT in the environment for `-RCT_jsLocation`.
///
/// The method relaunches the app itself, so the launch sync moment is the
/// failure: the whole correction happens inside one run, far inside the 60 s
/// window. Passwords are never printed; the address on this screen is the
/// local stub's. The 45 s idle tail is the "staying enabled must not
/// continuously sync" phase — the host reads the server's counters around it.
final class SyncRecoveryProbe: XCTestCase {
  let oldPasswordPath = "/tmp/openreader-sync-pass.txt"
  let newPasswordPath = "/tmp/openreader-sync-pass2.txt"

  func secret(_ path: String) -> String {
    guard let text = try? String(contentsOfFile: path, encoding: .utf8) else {
      XCTFail("Write the credential to \(path) (mode 600) before running this probe.")
      return ""
    }
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  func typeSlowly(_ field: XCUIElement, _ text: String) {
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

  func statusLabels(_ app: XCUIApplication) -> [String] {
    app.staticTexts.allElementsBoundByIndex.map { $0.label }
  }

  func testFailThenRecoverInWindow() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    if let port = ProcessInfo.processInfo.environment["OPENREADER_METRO_PORT"], !port.isEmpty {
      app.launchArguments = ["-RCT_jsLocation", "localhost:\(port)"]
    }
    // The relaunch's launch sync moment meets the stub's 401: the failure the
    // correction then answers, timed from here.
    print("RECOVERY t0 relaunch at \(Date().timeIntervalSince1970)")
    app.terminate(); app.launch()

    openSync(app)
    let toggle = app.switches["Keep my place across devices"]
    XCTAssertTrue(toggle.waitForExistence(timeout: 10), "Sync screen did not load")

    // The launch sync's failure on the status line (poll past the run).
    var failedLine: String?
    for _ in 0..<30 {
      let labels = statusLabels(app)
      if let line = labels.first(where: { $0.contains("failed") }) { failedLine = line; break }
      Thread.sleep(forTimeInterval: 1)
    }
    XCTAssertTrue(failedLine != nil, "No failed line appeared; status: \(statusLabels(app))")
    XCTAssertTrue((toggle.value as? String) == "1", "The switch did not come back on after the relaunch")
    print("RECOVERY failure line: \(failedLine ?? "") at \(Date().timeIntervalSince1970)")

    // Off — the fields unlock.
    toggle.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "value == '0'"), object: toggle)], timeout: 10)
    XCTAssertTrue((toggle.value as? String) == "0", "The switch did not go off")
    print("RECOVERY switched off at \(Date().timeIntervalSince1970)")

    // Correct the password: clear the old one, type the new one.
    let password = app.secureTextFields["Password"]
    XCTAssertTrue(password.waitForExistence(timeout: 5), "No password field")
    password.tap()
    let oldLength = secret(oldPasswordPath).count
    for _ in 0..<max(oldLength, 1) {
      password.typeText(XCUIKeyboardKey.delete.rawValue)
      Thread.sleep(forTimeInterval: 0.05)
    }
    typeSlowly(password, secret(newPasswordPath))
    if app.keyboards.count > 0 {
      let done = app.keyboards.buttons["Done"]
      if done.waitForExistence(timeout: 1) { done.tap() }
    }
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "count == 0"), object: app.keyboards)], timeout: 3)
    print("RECOVERY password retyped at \(Date().timeIntervalSince1970)")

    // On again: the check passes and the switch-on run is forced past the
    // failure's retry window (#177). The status line must then say the run
    // happened — a completed run, not only the passing check.
    toggle.tap()
    XCTAssertTrue((toggle.value as? String) == "1", "The check refused the corrected password; status: \(statusLabels(app))")
    print("RECOVERY switched on at \(Date().timeIntervalSince1970)")
    var syncedLine: String?
    for _ in 0..<30 {
      let labels = statusLabels(app)
      if let line = labels.first(where: { $0.contains("Synced at") }) { syncedLine = line; break }
      Thread.sleep(forTimeInterval: 1)
    }
    XCTAssertTrue(syncedLine != nil, "No Synced-at line after the switch-on; status: \(statusLabels(app))")
    print("RECOVERY synced line: \(syncedLine ?? "") at \(Date().timeIntervalSince1970)")

    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = "recovery-sync-screen"; tree.lifetime = .keepAlways; add(tree)

    // Staying enabled: idle on the Sync screen. The host reads the stub's
    // counters across this window; nothing here syncs by itself.
    Thread.sleep(forTimeInterval: 45)
    print("RECOVERY after idle 45 s: \(statusLabels(app))")
    let tree2 = XCTAttachment(string: app.debugDescription)
    tree2.name = "recovery-after-idle"; tree2.lifetime = .keepAlways; add(tree2)
  }
}
