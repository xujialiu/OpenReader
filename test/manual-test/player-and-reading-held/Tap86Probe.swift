import XCTest

/// Real touches for #86: a tap on a sentence and each of the four Skip buttons
/// while a Reading plays must stop the sound at the press and seek at once (no
/// 600 ms debounce), and while paused must move the highlight and start no
/// sound. The measured facts themselves — press-to-fetch gap, the utterance the
/// press landed on — are read outside, from the app's Debug Log and the fake
/// provider's request log (`skips-while-playing.md`); this probe's job is the real touches
/// and their order, with each tap's time printed.
///
/// Needs the issue-86 fixture open, the fake Kokoro provider chosen
/// (`fake-kokoro.cjs`), the reading paused where the caller wants Play to start
/// (the walkthrough harness's `{"do":"seek"}`), and the simulator silenced.
/// `.activate()` only, never `.terminate()/.launch()`, so this book, this
/// position and this Voice stay loaded.
///
/// Params (`/tmp/openreader-tap86-params.txt`, `KEY=VALUE`):
/// - `TAP_NX`, `TAP_NY` — normalized tap point in the app window, from the
///   WebView rect probe (`skips-while-playing.md`); default the middle of the fixture's
///   first-chapter sentence `#s23`.
final class Tap86Probe: XCTestCase {
  func param(_ key: String, _ fallback: String) -> String {
    if let text = try? String(contentsOfFile: "/tmp/openreader-tap86-params.txt", encoding: .utf8) {
      for line in text.split(separator: "\n") where line.hasPrefix(key + "=") {
        return String(line.dropFirst(key.count + 1)).trimmingCharacters(in: .whitespaces)
      }
    }
    return ProcessInfo.processInfo.environment[key] ?? fallback
  }

  func capture(_ name: String, _ app: XCUIApplication) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  /// Waits for the reader chrome (Play or Pause present).
  @discardableResult
  func waitForReaderReady(_ app: XCUIApplication, timeout: TimeInterval = 30) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if app.buttons["Play"].exists || app.buttons["Pause"].exists { return true }
      Thread.sleep(forTimeInterval: 0.3)
    }
    return false
  }

  /// Waits for the Pause button's `busy` accessibility state to clear — the
  /// first Clip's cue (GlideTouchProbe's signal).
  func waitForCue(_ app: XCUIApplication, timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      guard app.buttons["Pause"].exists else { return false }
      if (app.buttons["Pause"].value as? String)?.contains("busy") != true { return true }
      Thread.sleep(forTimeInterval: 0.1)
    }
    return false
  }

  /// A real tap on the page's sentence, mid-clip of the sentence before it.
  /// PRE_WAIT_MS after the cue aims the press into the second Clip (the read
  /// window of cursor 1 covers Utterances 2–4, so the tapped Utterance 6 is not
  /// cached); the exact moment is printed and aligned with the logs outside.
  func testTapSentenceWhilePlaying() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(waitForReaderReady(app), "Reader was not ready")
    XCTAssertTrue(app.buttons["Play"].exists, "Start paused: the probe presses Play itself")
    let playAt = Date()
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play did not start")
    let cued = waitForCue(app, timeout: 20)
    XCTAssertTrue(cued, "The first Clip's cue never arrived")
    print("TAP86 cue after \(Date().timeIntervalSince(playAt))s")

    Thread.sleep(forTimeInterval: (Double(param("PRE_WAIT_MS", "3000")) ?? 3000) / 1000)
    XCTAssertTrue(app.buttons["Pause"].exists, "Must still be playing just before the tap")

    let nx = Double(param("TAP_NX", "0.5")) ?? 0.5
    let ny = Double(param("TAP_NY", "0.4371")) ?? 0.4371
    let point = app.coordinate(withNormalizedOffset: CGVector(dx: nx, dy: ny))
    let tapAt = Date()
    point.tap()
    print("TAP86 page-tap issued at \(tapAt.timeIntervalSince1970)")
    Thread.sleep(forTimeInterval: 1.5)
    XCTAssertTrue(app.buttons["Pause"].exists, "A page tap must not pause playback")
    capture("tap86-tap-while-playing", app)
    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause at the end")
  }

  /// Five quick presses of Next sentence from a paused start. The start is
  /// where the caller seeked to; the end position and each press's `skip …
  /// from` line are read from the logs outside.
  func testFiveNextSentencePresses() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(waitForReaderReady(app), "Reader was not ready")
    XCTAssertTrue(app.buttons["Play"].exists, "Start paused: the probe presses Play itself")
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play did not start")
    XCTAssertTrue(waitForCue(app, timeout: 20), "The first Clip's cue never arrived")

    let next = app.buttons["Next sentence"]
    XCTAssertTrue(next.waitForExistence(timeout: 5), "No Next sentence button")
    for i in 1...5 {
      let at = Date()
      next.tap()
      print("TAP86 five-press \(i) issued at \(at.timeIntervalSince1970)")
    }
    Thread.sleep(forTimeInterval: 1.5)
    XCTAssertTrue(app.buttons["Pause"].exists, "Skips must not pause playback")
    capture("tap86-five-presses", app)
    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause at the end")
  }

  /// Each of the other three Skips once, while playing, about a second apart:
  /// Previous sentence first (the press whose target the read-ahead cannot
  /// have cached), then Next sentence, Next paragraph, Previous paragraph.
  func testEachSkipWhilePlaying() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(waitForReaderReady(app), "Reader was not ready")
    XCTAssertTrue(app.buttons["Play"].exists, "Start paused: the probe presses Play itself")
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play did not start")
    XCTAssertTrue(waitForCue(app, timeout: 20), "The first Clip's cue never arrived")

    for (label, wait) in [("Previous sentence", 1.2), ("Next sentence", 1.2), ("Next paragraph", 1.2), ("Previous paragraph", 1.2)] {
      let button = app.buttons[label]
      XCTAssertTrue(button.waitForExistence(timeout: 5), "No \(label) button")
      let at = Date()
      button.tap()
      print("TAP86 skip \(label) issued at \(at.timeIntervalSince1970)")
      Thread.sleep(forTimeInterval: wait)
      XCTAssertTrue(app.buttons["Pause"].exists, "\(label) must not pause playback")
    }
    capture("tap86-each-skip", app)
    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause at the end")
  }

  /// A page tap while paused moves the highlight and starts no sound: Play
  /// must still be Play 1.5 s later (no fetch, proved by the provider log
  /// outside).
  func testTapWhilePausedDoesNotStart() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(waitForReaderReady(app), "Reader was not ready")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap(); _ = app.buttons["Play"].waitForExistence(timeout: 5) }
    XCTAssertTrue(app.buttons["Play"].exists, "Start paused")
    Thread.sleep(forTimeInterval: 0.5)

    let nx = Double(param("TAP_NX", "0.5")) ?? 0.5
    let ny = Double(param("TAP_NY", "0.4371")) ?? 0.4371
    let at = Date()
    app.coordinate(withNormalizedOffset: CGVector(dx: nx, dy: ny)).tap()
    print("TAP86 paused-tap issued at \(at.timeIntervalSince1970)")
    Thread.sleep(forTimeInterval: 1.5)
    XCTAssertTrue(app.buttons["Play"].exists, "A paused tap must not start the reading")
    XCTAssertTrue(!app.buttons["Pause"].exists, "A paused tap must not start the reading")
    capture("tap86-tap-while-paused", app)
  }

  /// Skip buttons while paused: two presses move the highlight twice and start
  /// no sound. End position read from the logs outside.
  func testSkipWhilePausedDoesNotStart() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(waitForReaderReady(app), "Reader was not ready")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap(); _ = app.buttons["Play"].waitForExistence(timeout: 5) }
    XCTAssertTrue(app.buttons["Play"].exists, "Start paused")
    Thread.sleep(forTimeInterval: 0.5)

    for label in ["Next sentence", "Previous sentence"] {
      let button = app.buttons[label]
      XCTAssertTrue(button.waitForExistence(timeout: 5), "No \(label) button")
      let at = Date()
      button.tap()
      print("TAP86 paused-skip \(label) issued at \(at.timeIntervalSince1970)")
      Thread.sleep(forTimeInterval: 1.0)
      XCTAssertTrue(app.buttons["Play"].exists, "A paused skip must not start the reading")
    }
    capture("tap86-skip-while-paused", app)
  }
}
