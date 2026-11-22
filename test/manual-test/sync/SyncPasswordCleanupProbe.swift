import XCTest

/// Turns Sync off, removes its saved password through the Sync screen, and
/// verifies the empty field after a cold launch. This is a cleanup control for
/// sessions that use disposable WebDAV credentials; it never types or prints a
/// credential and captures no Sync screen.
final class SyncPasswordCleanupProbe: XCTestCase {
  let bundleId = "top.xujialiu.openreader"

  func isOn(_ element: XCUIElement) -> Bool { (element.value as? String) == "1" }

  func launchWithMetro(_ app: XCUIApplication) {
    if let port = ProcessInfo.processInfo.environment["OPENREADER_METRO_PORT"], !port.isEmpty {
      app.launchArguments = ["-RCT_jsLocation", "localhost:\(port)"]
    }
    app.terminate()
    app.launch()
  }

  func openSync(_ app: XCUIApplication) {
    let toggle = app.switches["Keep my place across devices"]
    if toggle.exists { return }
    if app.buttons["Back"].exists { app.buttons["Back"].tap() }
    let settings = app.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 15), "Library header did not appear")
    settings.tap()
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sync'")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5), "Settings has no Sync row")
    row.tap()
  }

  func isEmpty(_ field: XCUIElement) -> Bool {
    let value = field.value as? String ?? ""
    return value.isEmpty || value == (field.placeholderValue ?? "Not set")
  }

  func testTurnSyncOffClearPasswordAndVerifyColdLaunch() {
    let app = XCUIApplication(bundleIdentifier: bundleId)
    app.activate()
    openSync(app)

    let toggle = app.switches["Keep my place across devices"]
    let password = app.secureTextFields["Password"]
    XCTAssertTrue(toggle.waitForExistence(timeout: 10), "Sync screen did not load")
    XCTAssertTrue(password.waitForExistence(timeout: 10), "Sync password field did not load")
    let oldValue = password.value as? String ?? ""
    let hadPassword = !oldValue.isEmpty && oldValue != (password.placeholderValue ?? "Not set")
    print("CLEANUP starting syncOn=\(isOn(toggle)) passwordPresent=\(hadPassword) maskedLength=\(hadPassword ? oldValue.count : 0)")

    if isOn(toggle) {
      toggle.tap()
      _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
        predicate: NSPredicate(format: "value == '0'"), object: toggle)], timeout: 10)
    }
    XCTAssertFalse(isOn(toggle), "Sync did not turn off")
    if hadPassword {
      XCTAssertTrue(password.isEnabled, "The password field stayed locked after Sync was turned off")
      password.tap()
      let clear = password.buttons["Clear text"]
      XCTAssertTrue(clear.waitForExistence(timeout: 3), "The editable password field has no Clear text button")
      clear.tap()
      let clearDeadline = Date().addingTimeInterval(5)
      while !isEmpty(password) && Date() < clearDeadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))
      }
      XCTAssertTrue(isEmpty(password), "The password field did not clear")
      Thread.sleep(forTimeInterval: 1.0)
    }

    launchWithMetro(app)
    openSync(app)
    let relaunchedToggle = app.switches["Keep my place across devices"]
    let relaunchedPassword = app.secureTextFields["Password"]
    XCTAssertTrue(relaunchedToggle.waitForExistence(timeout: 10), "Sync screen did not load after cold launch")
    XCTAssertFalse(isOn(relaunchedToggle), "Sync was still on after cleanup")
    XCTAssertTrue(relaunchedPassword.waitForExistence(timeout: 10), "Sync password field did not load after cold launch")
    XCTAssertTrue(isEmpty(relaunchedPassword), "The Keychain still returned the disposable Sync password after cold launch")
    print("CLEANUP coldLaunch syncOff=true passwordEmpty=true")
  }
}
