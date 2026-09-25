import XCTest

/// Real touches for #68 against a real, long book instead of the small
/// fixture: "hundreds of spine items, chapters several screens tall and a
/// real navigation document" (README, "Real books"), which is what a section
/// boundary and #68's held Reading meet in the owner's actual reading.
///
/// Expects the runner script to have already opened "Shadow Slave — Chapters
/// 1–250" and left it paused, live (not persisted — leaving while paused did
/// not reliably save a harness seek to the saved place in testing), a few
/// Utterances short of the edge of what that fresh mount had rendered — by
/// the harness's own `open`/`say`/`seek` commands (a handler action, not a
/// touch: reaching a chosen sentence in a 250-chapter book by real taps alone
/// is impractical, and a fresh mount's Utterance count is session-relative,
/// so the runner re-derives the target each run rather than trusting a
/// stored number: test/manual-test/README.md Pitfalls). Every touch this
/// probe itself performs — Play, the back arrow, the Reading Button, Pause —
/// is real, and this method never assumes which chapter that edge falls in:
/// it only checks that the Library row's own quote of the reading's place
/// changes at all, which at that edge is only possible by rendering fresh
/// content.
final class ReadingHeldBookProbe: XCTestCase {
  let book = "Shadow Slave \u{2014} Chapters 1\u{2013}250"

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    shot(name)
  }

  func shot(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func until(_ timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    repeat {
      if condition() { return true }
      Thread.sleep(forTimeInterval: 0.2)
    } while Date() < deadline
    return false
  }

  /// Same banner as `ReadingHeldProbe`: dismissed by its own close button, never tapped elsewhere.
  func clearLogBox(_ app: XCUIApplication) {
    let banner = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Open debugger to view warnings'")).firstMatch
    guard banner.exists else { return }
    let frame = banner.frame
    app.coordinate(withNormalizedOffset: .zero)
      .withOffset(CGVector(dx: frame.maxX - 22, dy: frame.midY)).tap()
    _ = until(3) { !banner.exists }
  }

  func press(_ element: XCUIElement, _ app: XCUIApplication) {
    clearLogBox(app)
    element.tap()
  }

  func returnButton(_ app: XCUIApplication) -> XCUIElement { app.buttons["Return to the reading"] }
  func inLibrary(_ app: XCUIApplication) -> Bool { app.navigationBars["Library"].exists }
  func inReader(_ app: XCUIApplication) -> Bool {
    app.buttons["Collapse the player"].exists || app.buttons["Show the player"].exists
  }
  func row(_ title: String, _ app: XCUIApplication) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title + ",")).firstMatch
  }
  func reloading(_ app: XCUIApplication) -> Bool {
    app.staticTexts.matching(NSPredicate(
      format: "label BEGINSWITH 'Laying the document out' OR label BEGINSWITH 'Opening ' OR label BEGINSWITH 'Reading '")).firstMatch.exists
  }

  func testRealBookCrossesUnrenderedSectionWhileParked() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(until(10) { self.inReader(app) && !self.reloading(app) }, "The runner script did not leave the book open and laid out")
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Expected the reader paused at the seeded place")
    shot("90-book-paused-near-boundary")

    press(app.buttons["Play"], app)
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play did not start")
    app.buttons["BackButton"].tap()
    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5), "The back arrow did not return to the Library")
    XCTAssertTrue(returnButton(app).waitForExistence(timeout: 3), "No Reading Button in the Library after leaving while playing")
    let atLeave = row(book, app).label
    shot("91-library-playing")

    // The runner seeded this place a few Utterances short of the edge of what
    // a fresh mount had rendered, so the row's quote can only move past this
    // exact text by the parked page rendering fresh content — whichever
    // chapter that turns out to be. Place written at most every ten seconds.
    let crossed = until(45) { self.row(self.book, app).label != atLeave && !self.row(self.book, app).label.isEmpty }
    print("ROW before=\(atLeave) after=\(row(book, app).label)")
    XCTAssertTrue(crossed, "The reading did not reach the unrendered section while the Library was in front")
    XCTAssertTrue(returnButton(app).exists, "The Reading Button went while the reading played on")
    capture("92-library-crossed", app)

    press(returnButton(app), app)
    XCTAssertTrue(until(5) { self.inReader(app) }, "The Reading Button did not return to the reader")
    let reopened = until(1.5) { self.reloading(app) }
    XCTAssertFalse(reopened, "The reader opened the document again instead of taking back the Reading")
    XCTAssertTrue(app.buttons["Pause"].exists, "The reading is not playing after the return")
    shot("93-back-in-reader")
    press(app.buttons["Pause"], app)
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause")
    capture("94-paused", app)
  }
}
