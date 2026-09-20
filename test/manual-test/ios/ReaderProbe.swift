import XCTest

final class ReaderProbe: XCTestCase {
  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func testReaderSheets() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    // This probe never presses Play and needs no provider credentials.
    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'A Short Test of Reading Aloud,'")).firstMatch
    if book.waitForExistence(timeout: 2) { book.tap() }
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 10))
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    if Bundle(for: Self.self).object(forInfoDictionaryKey: "ManualMode") as? String == "fish" {
      app.buttons["Choose a Voice"].tap()
      let region = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'en-IN'")).firstMatch
      XCTAssertTrue(region.waitForExistence(timeout: 15))
      region.tap()
      let aarav = app.buttons["Aarav — Male Indian multilingual (EN)"]
      XCTAssertTrue(aarav.waitForExistence(timeout: 3), "Aarav is missing from en-IN")
      capture("fish-en-IN", app)
      return
    }
    if Bundle(for: Self.self).object(forInfoDictionaryKey: "ManualMode") as? String == "loading" {
      // voice-playback.cjs installs a delayed, silent response and a watchdog.
      app.buttons["Play"].tap()
      XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 2))
      // The button is one accessible element; its native spinner is a child,
      // so iOS exposes the busy value instead of a separate activity indicator.
      XCTAssertTrue((app.buttons["Pause"].value as? String)?.contains("busy") == true, "Loading state is missing")
      capture("loading-touch", app)
      app.buttons["Pause"].tap()
      XCTAssertTrue(app.buttons["Play"].exists)
      XCTAssertFalse((app.buttons["Play"].value as? String)?.contains("busy") == true)
      capture("loading-touch-paused", app)
      return
    }

    func dragClosed(_ title: String) {
      let heading = app.staticTexts[title].firstMatch
      XCTAssertTrue(heading.waitForExistence(timeout: 3))
      capture(title + "-open", app)
      let origin = app.coordinate(withNormalizedOffset: .zero)
      let start = origin.withOffset(CGVector(dx: app.frame.midX, dy: heading.frame.minY - 15))
      let end = origin.withOffset(CGVector(dx: app.frame.midX, dy: min(app.frame.maxY - 20, heading.frame.minY + 200)))
      start.press(forDuration: 0.3, thenDragTo: end)
      let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: heading)
      XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 3), .completed, "Drag did not dismiss " + title)
    }

    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed,'")).firstMatch.tap()
    XCTAssertFalse(app.buttons["Done"].exists)
    dragClosed("Playback speed")
    app.buttons["Contents"].tap()
    dragClosed("Contents")
    app.buttons["More actions"].tap()
    app.buttons["Appearance"].tap()
    dragClosed("Appearance")
    app.buttons["Choose a Voice"].tap()
    XCTAssertFalse(app.buttons["Done"].exists)
    let adrian = app.buttons["Adrian"]
    if adrian.waitForExistence(timeout: 5) {
      adrian.tap()
      XCTAssertTrue(app.staticTexts["Voice"].exists, "Choosing must leave Voice open")
      XCTAssertTrue(adrian.isSelected, "Paused choice must get its check mark immediately")
      capture("voice-paused-choice", app)
      app.buttons["Sarah"].tap()
    }
    dragClosed("Voice")
    XCTAssertTrue(app.buttons["Play"].exists)
    capture("reader-final-paused", app)
  }
}
