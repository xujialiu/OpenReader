import XCTest

/// Real touches for #106: `reading-view.tsx`'s `play` waits for the pre-Play
/// sync for at most 2 s (`use-sync.ts` `WAIT_MS`) and then calls `reading.play()`.
/// With `sync/delaying-webdav.cjs` holding every Positions-File GET and PUT for
/// 4 000 ms, the wait always runs out its full bound, so the continuation fires
/// almost exactly 2 s after the Play press — a window a second tap can land in.
///
/// Leaving the paused Reader inside that window (Back, or opening another
/// Document) must end the Reading, and the late `play` must start nothing: no
/// engine, no audio, no Reading Button in the Library. The app-side log lines
/// (`play after the reading ended: ignored`, and no `play at utterance` after
/// the leave) are read from the Debug Log by the host afterwards; so are the
/// fake Kokoro requests (`fake-kokoro.cjs`'s own log) and the server's
/// requests (`delaying-webdav.cjs`'s).
///
/// Prerequisites: `A Short Test of Reading Aloud` and `Boundary Fixture` in the
/// Library; sync ON against the delaying server (any throwaway credentials);
/// the Local Provider enabled against `player-and-reading-held/fake-kokoro.cjs`
/// with voice `af_bella`; the app running against this tree's Metro.
/// `.activate()` only. Every method that presses Play is run after the runner's
/// volume check (kit/run-probe.sh) and ends with playback stopped.
final class Issue106Probe: XCTestCase {
  let fixture = "A Short Test of Reading Aloud"
  let other = "Boundary Fixture"

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
  /// Library's Reading Button. Dismissed by its own close button, never by a
  /// tap on its body (that opens DevTools on the Mac).
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

  /// Into the fixture's reader, paused, the player shown.
  func openFixture(_ app: XCUIApplication) {
    if returnButton(app).exists { press(returnButton(app), app) } else {
      let book = row(fixture, app)
      XCTAssertTrue(book.waitForExistence(timeout: 10), "The fixture is not in the Library")
      book.tap()
    }
    XCTAssertTrue(until(20) { self.inReader(app) && !self.reloading(app) }, "The reader did not open")
    if app.buttons["Show the player"].exists { press(app.buttons["Show the player"], app) }
    if app.buttons["Pause"].exists { press(app.buttons["Pause"], app) }
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Expected the reader paused")
  }

  /// Case 1: Play, Back inside the 2 s wait. The Reading ends, and the late
  /// `play` — whose continuation fires ~2 s after the press — starts nothing:
  /// no Reading Button, no Pause, in the Library, past the wait and beyond.
  func testLeaveInsideSyncWaitStartsNothing() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    toLibrary(app)
    XCTAssertFalse(returnButton(app).exists, "A Reading was already held before this test")
    openFixture(app)
    // Let the open moment's own sync run finish (its GET is held 4 s) so the
    // Play press starts a fresh run and the wait's bound is the whole window.
    Thread.sleep(forTimeInterval: 6)
    let playAt = Date()
    app.buttons["Play"].tap()
    app.buttons["BackButton"].tap()
    let backAt = Date()
    print("TIMING play=\(playAt.timeIntervalSince1970) back=\(backAt.timeIntervalSince1970) gap=\(backAt.timeIntervalSince(playAt))")
    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5), "The back arrow did not return to the Library")
    capture("01-library-right-after-back", app)
    // Still nothing once the wait has run out and the continuation has fired.
    Thread.sleep(forTimeInterval: 4)
    XCTAssertFalse(returnButton(app).exists, "A Reading Button appeared: the late play kept the Reading")
    XCTAssertFalse(app.buttons["Pause"].exists, "Something is playing after the leave")
    capture("02-library-after-continuation", app)
  }

  /// Case 2: Play, Back, and the other Document opened, all inside the wait.
  /// The first book's late play starts nothing; the second reader is paused and
  /// its own Play works afterwards.
  func testOpenAnotherInsideSyncWait() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    toLibrary(app)
    openFixture(app)
    Thread.sleep(forTimeInterval: 6)
    let playAt = Date()
    app.buttons["Play"].tap()
    app.buttons["BackButton"].tap()
    let backAt = Date()
    let otherRow = row(other, app)
    XCTAssertTrue(otherRow.waitForExistence(timeout: 3), "The other document's row is not in the Library")
    otherRow.tap()
    let otherAt = Date()
    print("TIMING play=\(playAt.timeIntervalSince1970) back=\(backAt.timeIntervalSince1970) other=\(otherAt.timeIntervalSince1970) gaps=\(backAt.timeIntervalSince(playAt))/\(otherAt.timeIntervalSince(playAt))")
    XCTAssertTrue(until(20) { self.inReader(app) && !self.reloading(app) }, "The other document did not open")
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "The other document's reader is not paused")
    // Past the first Play's continuation: still nothing playing over the second reader.
    Thread.sleep(forTimeInterval: 4)
    XCTAssertFalse(app.buttons["Pause"].exists, "Audio started for the abandoned first Reading")
    capture("21-second-reader-paused-past-continuation", app)
    // The second book's own Play is undisturbed: it starts, and is stopped again.
    let secondPlayAt = Date()
    press(app.buttons["Play"], app)
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 12), "The second document's Play did not start")
    print("TIMING secondPlayStarted=\(Date().timeIntervalSince1970) gap=\(Date().timeIntervalSince(secondPlayAt))")
    press(app.buttons["Pause"], app)
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause the second reading")
  }

  /// Cases 3 and 4 (held): Play starts normally after the held sync's wait ran
  /// out; Back to the Library keeps it playing with the Reading Button (#68);
  /// paused from the Library's own media card. Ends with playback stopped.
  func testPlayAfterHeldSyncKeepsPlayingInLibrary() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    toLibrary(app)
    openFixture(app)
    Thread.sleep(forTimeInterval: 6)
    let playAt = Date()
    press(app.buttons["Play"], app)
    // Held sync: the wait runs out at 2 s, then the engine builds and the first
    // Clip arrives from the fake Kokoro — give that 12 s.
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 12), "Play did not start after the held sync ran out")
    print("TIMING case4held play=\(playAt.timeIntervalSince1970) playing=\(Date().timeIntervalSince1970) delay=\(Date().timeIntervalSince(playAt))")
    shot("30-playing-in-reader-after-held-sync")
    let backAt = Date()
    app.buttons["BackButton"].tap()
    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5), "The back arrow did not return to the Library")
    print("TIMING backWhilePlaying=\(backAt.timeIntervalSince1970)")
    let btn = returnButton(app)
    XCTAssertTrue(btn.waitForExistence(timeout: 5), "No Reading Button in the Library after leaving while playing")
    XCTAssertTrue(until(5) { (btn.value as? String)?.hasSuffix("Playing") == true }, "The Reading Button does not say the reading plays")
    // Two more Clips with the Library in front: the reading really keeps playing.
    Thread.sleep(forTimeInterval: 6)
    XCTAssertTrue(btn.exists && (btn.value as? String)?.hasSuffix("Playing") == true, "The reading did not keep playing in the Library")
    capture("31-library-playing", app)

    // Pause it from the Library: the media card's own Pause, as ReadingHeldProbe
    // does it. If the card is not there, fall back to the reader's Pause and say so.
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.01))
      .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.7)))
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let center = springboard.buttons["UIA.MediaControls.NowPlaying.CenterButton"]
    if center.waitForExistence(timeout: 5), center.label == "Pause" {
      center.tap()
      let paused = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "Play"), object: center)
      XCTAssertEqual(XCTWaiter.wait(for: [paused], timeout: 3), .completed, "The media card's Pause did not take")
      print("PAUSED-VIA media-card")
    } else {
      print("PAUSED-VIA reader-fallback (no media card)")
      app.activate()
      press(returnButton(app), app)
      XCTAssertTrue(until(5) { self.inReader(app) }, "The Reading Button did not return to the reader")
      press(app.buttons["Pause"], app)
    }
    app.activate()
    XCTAssertTrue(returnButton(app).waitForExistence(timeout: 5), "The Reading Button went with the pause")
    XCTAssertTrue(until(3) { (self.returnButton(app).value as? String)?.hasSuffix("Paused") == true }, "The Reading Button does not say the reading is paused")
    capture("32-library-paused", app)
  }

  /// Case 4 (fast): with the server answering at once (DELAY_MS 0), Play starts
  /// promptly after a sync that reports `ok`. Ends with playback stopped.
  func testPlayAfterFastSyncStarts() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    toLibrary(app)
    openFixture(app)
    Thread.sleep(forTimeInterval: 3)
    let playAt = Date()
    press(app.buttons["Play"], app)
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 8), "Play did not start after the fast sync")
    print("TIMING case4fast play=\(playAt.timeIntervalSince1970) playing=\(Date().timeIntervalSince1970) delay=\(Date().timeIntervalSince(playAt))")
    shot("40-playing-after-fast-sync")
    press(app.buttons["Pause"], app)
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause after the fast-sync play")
  }
}
