import XCTest

final class OfflineProbe: XCTestCase {
  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }
  func testOfflineControls() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let dismiss = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Close '")).firstMatch
    if dismiss.exists && dismiss.isHittable { dismiss.tap() }
    let mode = Bundle(for: Self.self).object(forInfoDictionaryKey: "ManualMode") as? String ?? "inspect"
    if mode == "background" {
      XCUIDevice.shared.press(.home)
      // Long enough to observe the bounded UIKit task expire, without playback.
      Thread.sleep(forTimeInterval: 40)
      app.activate()
      capture("background-return", app)
      return
    }
    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'A Short Test of Reading Aloud,'")).firstMatch
    if book.waitForExistence(timeout: 2) { book.tap() }
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 10))
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
    capture("reader-actions", app)
    if mode == "alias" {
      app.buttons["Rename"].tap()
      let field = app.textFields["Display name"]
      XCTAssertTrue(field.waitForExistence(timeout: 3))
      field.buttons["Clear text"].tap()
      field.typeText("Cold Restart Alias")
      app.buttons["Save"].tap()
      app.terminate()
      app.launch()
      let aliased = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Cold Restart Alias,'")).firstMatch
      XCTAssertTrue(aliased.waitForExistence(timeout: 10))
      aliased.tap()
      XCTAssertTrue(app.staticTexts["Cold Restart Alias"].waitForExistence(timeout: 10))
      if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
      app.buttons["More actions"].tap()
      app.buttons["Rename"].tap()
      XCTAssertTrue(field.waitForExistence(timeout: 3))
      field.buttons["Clear text"].tap()
      field.typeText("A Short Test of Reading Aloud")
      app.buttons["Save"].tap()
      capture("alias-after-restart", app)
      return
    }
    if mode == "management" {
      app.buttons["Download"].tap()
      XCTAssertTrue(app.staticTexts["2 chapters downloaded"].waitForExistence(timeout: 10))
      app.buttons["Manage downloads"].tap()
      XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'saved'")).firstMatch.waitForExistence(timeout: 3))
      let first = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'The First Chapter, downloaded'")).firstMatch
      XCTAssertTrue(first.waitForExistence(timeout: 3))
      first.tap()
      let delete = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Delete selected ('")).firstMatch
      XCTAssertTrue(delete.isEnabled)
      delete.tap()
      XCTAssertTrue(app.alerts["Delete downloaded audio?"].waitForExistence(timeout: 3))
      app.alerts["Delete downloaded audio?"].buttons["Delete"].tap()
      XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'saved'")).firstMatch.waitForExistence(timeout: 5))
      XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == 'The First Chapter'")).firstMatch.waitForExistence(timeout: 3))
      capture("managed-delete-first-chapter", app)
      return
    }
    if mode == "inspect" {
      app.buttons["Appearance"].tap()
      XCTAssertTrue(app.buttons["Increase font size"].waitForExistence(timeout: 3))
      app.buttons["Increase font size"].tap()
      capture("appearance-stepper", app)
      app.buttons["Use document appearance"].tap()
      app.buttons["Close Appearance"].tap()
      app.buttons["More actions"].tap()
      app.buttons["Rename"].tap()
      let field = app.textFields["Display name"]
      XCTAssertTrue(field.waitForExistence(timeout: 3))
      field.buttons["Clear text"].tap()
      field.typeText("Offline Test Name")
      capture("rename-keyboard", app)
      app.buttons["Save"].tap()
      capture("renamed-reader", app)
      app.buttons["More actions"].tap()
      XCTAssertTrue(app.staticTexts["Offline Test Name"].waitForExistence(timeout: 3))
      app.buttons["Rename"].tap()
      field.buttons["Clear text"].tap()
      field.typeText("A Short Test of Reading Aloud")
      app.buttons["Save"].tap()
      app.buttons["More actions"].tap()
    }
    app.buttons["Download"].tap()
    if mode == "inspect" && app.staticTexts["2 chapters downloaded"].waitForExistence(timeout: 3) {
      capture("persisted-downloads", app)
      return
    }
    XCTAssertTrue(app.buttons["Select all"].waitForExistence(timeout: 30))
    let select = app.buttons["Select all"]
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: select)
    XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed)
    select.tap()
    let start = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Download selected ('")).firstMatch
    XCTAssertTrue(start.isEnabled)
    capture("chapters-selected", app)
    if mode == "download" {
      start.tap()
      let complete = app.staticTexts["2 chapters downloaded"]
      XCTAssertTrue(complete.waitForExistence(timeout: 90))
      capture("download-complete", app)
    }
  }
}
