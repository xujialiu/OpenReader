import XCTest

/// Real touches for #106: `reading-view.tsx`'s `play` waits for the pre-Play
/// sync for at most 2 s (`use-sync.ts` `WAIT_MS`) and then calls `reading.play()`.
/// With `sync/delaying-webdav.cjs` holding every Positions-File GET and PUT for
/// 4 000 ms, the wait always runs out its full bound, so the continuation fires
/// almost exactly 2 s after the Play press — a window a second tap can land in.
///
/// The host stages every run (harness `open`/`collapse`, labelled handler-level
/// in the report): the reader is already open, paused, with the player shown,
/// so each method's taps land early in the XCUITest session — on this simulator
/// synthetic input has silently died later in a session (README Pitfalls), and
/// a landed Play tap is verifiable in the server's own request log.
///
/// The app-side log lines (`play after the reading ended: ignored`, and no
/// `play at utterance` after the leave), the fake Kokoro requests and the
/// server's requests are read by the host afterwards.
///
/// Prerequisites: `A Short Test of Reading Aloud` and `Boundary Fixture` in the
/// Library; sync ON against the delaying server (throwaway credentials); the
/// Local Provider enabled against `player-and-reading-held/fake-kokoro.cjs`
/// with voice `af_bella`; the app against this tree's Metro. Every method that
/// presses Play runs after the runner's volume check (kit/run-probe.sh) and
/// ends with playback stopped or leaves the stopping to the host's next step.
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

  func returnButton(_ app: XCUIApplication) -> XCUIElement { app.buttons["Return to the reading"] }
  func inLibrary(_ app: XCUIApplication) -> Bool { app.navigationBars["Library"].exists }
  func row(_ title: String, _ app: XCUIApplication) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title + ",")).firstMatch
  }

  /// The staged reader: in front, paused, its Play button hittable.
  func stagedReader(_ app: XCUIApplication) {
    app.activate()
    XCTAssertTrue(until(10) { self.inReaderPaused(app) }, "Not staged: the reader is not in front paused")
  }

  func inReaderPaused(_ app: XCUIApplication) -> Bool {
    app.buttons["Collapse the player"].exists || app.buttons["Show the player"].exists
  }

  /// Case 1: Play, Back inside the 2 s wait. The Reading ends, and the late
  /// `play` — whose continuation fires ~2 s after the press — starts nothing:
  /// no Reading Button, no Pause, in the Library, past the wait and beyond.
  func testLeaveInsideSyncWaitStartsNothing() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    stagedReader(app)
    let play = app.buttons["Play"]
    let playAt = Date()
    play.tap()
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

  /// Case 2: Play, Back, and the other Document's row, back to back inside the
  /// wait. The first book's late play starts nothing; the second reader is
  /// paused and its own Play works afterwards.
  func testOpenAnotherInsideSyncWait() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    stagedReader(app)
    let playAt = Date()
    app.buttons["Play"].tap()
    app.buttons["BackButton"].tap()
    let backAt = Date()
    let otherRow = row(other, app)
    XCTAssertTrue(otherRow.waitForExistence(timeout: 3), "The other document's row is not in the Library")
    otherRow.tap()
    let otherAt = Date()
    print("TIMING play=\(playAt.timeIntervalSince1970) back=\(backAt.timeIntervalSince1970) other=\(otherAt.timeIntervalSince1970) gaps=\(backAt.timeIntervalSince(playAt))/\(otherAt.timeIntervalSince(playAt))")
    XCTAssertTrue(until(20) { app.buttons["Play"].exists && !self.reloadingNow(app) }, "The other document did not open paused")
    // Past the first Play's continuation: still nothing playing over the second reader.
    Thread.sleep(forTimeInterval: 4)
    XCTAssertFalse(app.buttons["Pause"].exists, "Audio started for the abandoned first Reading")
    XCTAssertTrue(app.buttons["Play"].exists, "The second document's reader lost its own Play")
    capture("21-second-reader-paused-past-continuation", app)
    // The second book's own Play is undisturbed: it starts, and is stopped again.
    let secondPlayAt = Date()
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 12), "The second document's Play did not start")
    print("TIMING secondPlayStarted=\(Date().timeIntervalSince1970) gap=\(Date().timeIntervalSince(secondPlayAt))")
    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause the second reading")
  }

  func reloadingNow(_ app: XCUIApplication) -> Bool {
    app.staticTexts.matching(NSPredicate(
      format: "label BEGINSWITH 'Laying the document out' OR label BEGINSWITH 'Opening ' OR label BEGINSWITH 'Reading '")).firstMatch.exists
  }

  /// Cases 3 and 4 (held): Play starts normally after the held sync's wait ran
  /// out; Back to the Library keeps it playing with the Reading Button (#68).
  /// The host pauses what this leaves playing (harness `pause`, labelled).
  func testPlayAfterHeldSyncKeepsPlayingInLibrary() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    stagedReader(app)
    let playAt = Date()
    app.buttons["Play"].tap()
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
  }

  /// Case 4 (fast): with the server answering at once (DELAY_MS 0), Play starts
  /// promptly after a sync that reports `ok`. Ends paused.
  func testPlayAfterFastSyncStarts() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    stagedReader(app)
    let playAt = Date()
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 8), "Play did not start after the fast sync")
    print("TIMING case4fast play=\(playAt.timeIntervalSince1970) playing=\(Date().timeIntervalSince1970) delay=\(Date().timeIntervalSince(playAt))")
    shot("40-playing-after-fast-sync")
    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause after the fast-sync play")
  }
}
