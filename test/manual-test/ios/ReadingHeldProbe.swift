import XCTest

/// Real touches for #68: going back to the Library while the reading plays keeps
/// it going, the Library's Reading Button takes the owner back to it as it was,
/// and the Reading ends when the owner leaves it paused, opens another document or
/// deletes it. The Settings screens carry no button.
///
/// Expects `A Short Test of Reading Aloud` and a second Document in the Library,
/// a Voice that can play, and the app running against this tree's Metro:
/// `.activate()` only. The page's words are not in the accessibility tree, so
/// the fixture's Library row, which quotes where the reading got to, is how the
/// probe knows the voice crossed the chapter change with the Library in front.
///
/// `testZDeleteEndsReading` really deletes the fixture, so it is named to run
/// last; the runner adds the fixture back.
final class ReadingHeldProbe: XCTestCase {
  let fixture = "A Short Test of Reading Aloud"

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

  /// React Native's "Open debugger to view warnings." banner, which a warning
  /// raises over the bottom of the screen: over the player and over the
  /// Library's Reading Button. A tap on its body opens React Native DevTools on
  /// the Mac (Metro logs `Launching DevTools...`), so it is dismissed by its own
  /// close button at its right end, and never tapped anywhere else.
  func clearLogBox(_ app: XCUIApplication) {
    let banner = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Open debugger to view warnings'")).firstMatch
    guard banner.exists else { return }
    let frame = banner.frame
    app.coordinate(withNormalizedOffset: .zero)
      .withOffset(CGVector(dx: frame.maxX - 22, dy: frame.midY)).tap()
    _ = until(3) { !banner.exists }
  }

  /// A tap on a control at the bottom of the screen, clear of the banner.
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

  /// The reader's own waiting lines: any of them after a return means the page was opened again.
  func reloading(_ app: XCUIApplication) -> Bool {
    app.staticTexts.matching(NSPredicate(
      format: "label BEGINSWITH 'Laying the document out' OR label BEGINSWITH 'Opening ' OR label BEGINSWITH 'Reading '")).firstMatch.exists
  }

  /// Where the fixture's row says the reading got to. The Library writes the
  /// place at most every ten seconds while the reading plays, and the row quotes
  /// it, so a sentence of the second chapter there is the voice having crossed
  /// the chapter change while the Library was in front.
  func rowInSecondChapter(_ app: XCUIApplication) -> Bool {
    let label = row(fixture, app).label
    return ["Second Chapter", "second chapter begins", "Eight sentences", "A reader moving", "Nothing about this sentence",
            "The middle of the second", "Two sentences remain", "second to last", "That was the last sentence"]
      .contains { label.contains($0) }
  }

  /// Back to the Library, ending nothing: from the reader only while paused.
  func toLibrary(_ app: XCUIApplication) {
    app.activate()
    var steps = 0
    while !inLibrary(app) && steps < 6 {
      if app.buttons["Show the player"].exists { press(app.buttons["Show the player"], app) }
      if app.buttons["Pause"].exists { press(app.buttons["Pause"], app) }
      if app.buttons["BackButton"].exists { app.buttons["BackButton"].tap() }
      steps += 1
      Thread.sleep(forTimeInterval: 0.8)
    }
    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5), "Could not get back to the Library")
  }

  /// Into the fixture's reader, paused, the player shown, the reading at `sentence`
  /// (0 is the first chapter's heading, 10 the second's).
  func openFixture(_ app: XCUIApplication, at sentence: Int) {
    if returnButton(app).exists { press(returnButton(app), app) } else {
      let book = row(fixture, app)
      XCTAssertTrue(book.waitForExistence(timeout: 10), "The fixture is not in the Library")
      book.tap()
    }
    XCTAssertTrue(until(20) { self.inReader(app) && !self.reloading(app) }, "The reader did not open")
    if app.buttons["Show the player"].exists { press(app.buttons["Show the player"], app) }
    if app.buttons["Pause"].exists { press(app.buttons["Pause"], app) }
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Expected the reader paused")
    // 19 Utterances, so 20 skips back is the first; then forward to `sentence`.
    for _ in 0..<20 { press(app.buttons["Previous paragraph"], app) }
    for _ in 0..<sentence { press(app.buttons["Next sentence"], app) }
    Thread.sleep(forTimeInterval: 0.5)
  }

  /// Play, the back arrow, and the voice crosses into the second chapter with the
  /// Library in front; Settings has no button; the button goes back to the same
  /// Reading, still playing and not opened again.
  func testBackWhilePlayingKeepsReading() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    toLibrary(app)
    XCTAssertFalse(returnButton(app).exists, "A Reading was already held before this test")
    // Four sentences before the chapter change: the place written about ten
    // seconds in is in the second chapter, and eight sentences are left to hear.
    openFixture(app, at: 6)
    press(app.buttons["Play"], app)
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play did not start")
    app.buttons["BackButton"].tap()
    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5), "The back arrow did not return to the Library")
    XCTAssertTrue(returnButton(app).waitForExistence(timeout: 3), "No Reading Button in the Library after leaving while playing")
    XCTAssertTrue((returnButton(app).value as? String)?.hasSuffix("Playing") == true, "The Library's Reading Button does not say the reading plays")
    shot("01-library-playing")

    // The voice crosses the chapter change with the Library in front.
    let crossed = until(20) { self.rowInSecondChapter(app) }
    print("ROW \(row(fixture, app).label)")
    XCTAssertTrue(crossed, "The reading did not reach the second chapter while the Library was in front")
    XCTAssertTrue(returnButton(app).exists, "The Reading Button went while the reading played on")

    // Settings carries no button; back in the Library it is there again.
    app.buttons["Settings"].tap()
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5), "Settings did not open")
    XCTAssertFalse(returnButton(app).exists && returnButton(app).isHittable, "Settings shows the Reading Button")
    shot("02-settings")
    app.buttons["BackButton"].tap()
    XCTAssertTrue(returnButton(app).waitForExistence(timeout: 5), "The Reading Button did not come back with the Library")

    press(returnButton(app), app)
    XCTAssertTrue(until(5) { self.inReader(app) }, "The Reading Button did not return to the reader")
    let reopened = until(1.5) { self.reloading(app) }
    XCTAssertFalse(reopened, "The reader opened the document again instead of taking back the Reading")
    XCTAssertTrue(app.buttons["Pause"].exists, "The reading is not playing after the return")
    shot("03-back-in-reader")
    press(app.buttons["Pause"], app)
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause at the end")
    capture("04-paused", app)
  }

  /// Collapsed, the edge swipe keeps the Reading too; a Pause from the lock
  /// screen's card in the Library keeps the button; the button goes back into the
  /// reader still collapsed, without opening the document again.
  func testEdgeSwipeCollapsedAndLockScreenPauseInLibrary() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    toLibrary(app)
    openFixture(app, at: 1)
    press(app.buttons["Play"], app)
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play did not start")
    press(app.buttons["Collapse the player"], app)
    XCTAssertTrue(app.buttons["Show the player"].waitForExistence(timeout: 3), "No Reading Button after collapsing")
    // The bar slides away over about a twelfth of a second (notes 2026-09-25
    // 22:35); a person's swipe does not start inside it.
    Thread.sleep(forTimeInterval: 0.8)
    shot("10-collapsed-playing")
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.0, dy: 0.5))
      .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)))
    let swiped = app.navigationBars["Library"].waitForExistence(timeout: 5)
    if !swiped { capture("10-after-swipe", app) }
    XCTAssertTrue(swiped, "The edge swipe did not return to the Library")
    XCTAssertTrue(returnButton(app).waitForExistence(timeout: 3), "No Reading Button in the Library after the edge swipe")

    // Back in, it is as it was left: collapsed, and still playing.
    press(returnButton(app), app)
    XCTAssertTrue(app.buttons["Show the player"].waitForExistence(timeout: 5), "The reader did not come back collapsed")
    XCTAssertFalse(app.buttons["More actions"].exists && app.buttons["More actions"].isHittable, "The bar came back with a collapsed player")
    XCTAssertFalse(until(1.5) { self.reloading(app) }, "The reader opened the document again instead of taking back the Reading")
    XCTAssertTrue((app.buttons["Show the player"].value as? String)?.hasSuffix("Playing") == true, "The reading is not playing after the return")
    shot("11-back-collapsed")
    Thread.sleep(forTimeInterval: 0.8)
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.0, dy: 0.5))
      .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)))
    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5), "The second edge swipe did not return to the Library")
    XCTAssertTrue(returnButton(app).waitForExistence(timeout: 3), "No Reading Button after the second edge swipe")

    app.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.01))
      .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.7)))
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let center = springboard.buttons["UIA.MediaControls.NowPlaying.CenterButton"]
    guard center.waitForExistence(timeout: 5), center.label == "Pause" else {
      shot("11-no-lock-screen-pause")
      app.activate()
      if returnButton(app).exists { press(returnButton(app), app) }
      if app.buttons["Show the player"].exists { press(app.buttons["Show the player"], app) }
      if app.buttons["Pause"].exists { press(app.buttons["Pause"], app) }
      XCTFail("The lock screen offered no Pause with the Library in front")
      return
    }
    center.tap()
    let paused = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "Play"), object: center)
    XCTAssertEqual(XCTWaiter.wait(for: [paused], timeout: 3), .completed, "The lock screen's Pause did not take")
    app.activate()
    XCTAssertTrue(returnButton(app).waitForExistence(timeout: 5), "The Reading Button went with the lock screen's Pause")
    XCTAssertTrue(until(3) { (self.returnButton(app).value as? String)?.hasSuffix("Paused") == true }, "The Reading Button does not say the reading is paused")
    capture("12-library-paused", app)

    press(returnButton(app), app)
    XCTAssertTrue(until(5) { self.inReader(app) }, "The Reading Button did not return to the reader")
    XCTAssertFalse(until(1.5) { self.reloading(app) }, "The reader opened the document again instead of taking back the Reading")
    // A pause brings the player back (#67), so it returns shown, and paused.
    XCTAssertTrue(app.buttons["Play"].exists, "Expected the reading still paused after the return")
    capture("13-back-in-reader", app)
  }

  /// Leaving while paused ends the Reading, as it always did.
  func testLeaveWhilePausedEndsReading() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    toLibrary(app)
    openFixture(app, at: 1)
    app.buttons["BackButton"].tap()
    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5), "The back arrow did not return to the Library")
    XCTAssertFalse(until(2) { self.returnButton(app).exists }, "A Reading Button appeared after leaving while paused")
    capture("21-library-no-button", app)
  }

  /// Opening another document ends the Reading first.
  func testOpenAnotherEndsReading() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    toLibrary(app)
    openFixture(app, at: 1)
    press(app.buttons["Play"], app)
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play did not start")
    app.buttons["BackButton"].tap()
    XCTAssertTrue(returnButton(app).waitForExistence(timeout: 5), "No Reading Button after leaving while playing")
    // A Library row is its title and where its reading got to.
    let other = app.buttons.matching(NSPredicate(
      format: "NOT (label BEGINSWITH %@) AND (label CONTAINS ', Last read: ' OR label ENDSWITH ', Not started.')", fixture + ",")).firstMatch
    XCTAssertTrue(other.exists, "No second document in the Library")
    other.tap()
    XCTAssertTrue(until(20) { self.inReader(app) && !self.reloading(app) }, "The other document did not open")
    XCTAssertTrue(app.buttons["Play"].exists, "The other document's reader is playing: the first Reading did not end")
    app.buttons["BackButton"].tap()
    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5), "The back arrow did not return to the Library")
    XCTAssertFalse(until(2) { self.returnButton(app).exists }, "A Reading Button is still shown after another document was opened and left paused")
    capture("31-library-after-other", app)
  }

  /// Deleting the document being read ends the Reading, and the button goes.
  func testZDeleteEndsReading() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    toLibrary(app)
    openFixture(app, at: 1)
    press(app.buttons["Play"], app)
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play did not start")
    app.buttons["BackButton"].tap()
    XCTAssertTrue(returnButton(app).waitForExistence(timeout: 5), "No Reading Button after leaving while playing")
    app.buttons["Actions for \(fixture)"].tap()
    XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 5), "No Delete in the actions drawer")
    app.buttons["Delete"].tap()
    let alert = app.alerts["Delete this book?"]
    XCTAssertTrue(alert.waitForExistence(timeout: 5), "No confirmation")
    alert.buttons["Delete"].tap()
    XCTAssertTrue(until(5) { !self.returnButton(app).exists }, "The Reading Button stayed after its document was deleted")
    XCTAssertTrue(until(5) { !self.row(self.fixture, app).exists }, "The fixture is still in the Library")
    capture("41-library-after-delete", app)
  }
}
