import XCTest

/// The pre-Play sync wait of #304, driven with real XCUITest touches: the
/// press must show at once (spinner with Pause) while Play waits up to 2 s,
/// a Pause inside the wait takes the press back, and a Play after a run that
/// could not reach the server starts without waiting. The host stages the
/// sync server (delaying-webdav.cjs) and reads the Debug Log for the
/// app-side times; this probe prints its own instants so the two join.
///
/// Attaches to the running app and never relaunches it: the hung GET, the
/// Metro connection and the sync state are the measurement's setup. The host
/// must stage the open reader paused with the expanded player, with a saved
/// voice, before each run.
///
/// Because xcodebuild does not pass the caller's environment through, run
/// parameters come from `/tmp/openreader-sync-params.txt` (`KEY=VALUE`
/// lines), as `SyncProbe`'s do.
final class PlayWaitProbe: XCTestCase {
  /// Seconds of playback after a press that is meant to start, before the probe pauses.
  var playSeconds: Double {
    (Double(param("PLAY_SECONDS", "3")) ?? 3).bounded(1...8)
  }

  // MARK: helpers (the shape of SyncProbe's)

  func param(_ key: String, _ fallback: String) -> String {
    if let text = try? String(contentsOfFile: "/tmp/openreader-sync-params.txt", encoding: .utf8) {
      for line in text.split(separator: "\n") where line.hasPrefix(key + "=") {
        return String(line.dropFirst(key.count + 1)).trimmingCharacters(in: .whitespaces)
      }
    }
    return ProcessInfo.processInfo.environment[key] ?? fallback
  }

  /// A screenshot only, kept always: the full `debugDescription` tree takes
  /// about a second, which would push the first capture past the 500 ms the
  /// press-shot must answer for. The tree goes into a later attachment.
  func shot(_ name: String, _ app: XCUIApplication) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func tree(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
  }

  /// The transport's primary button is the only one labelled Play or Pause.
  func transport(_ app: XCUIApplication) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label == 'Play' OR label == 'Pause'")).firstMatch
  }

  func label(_ app: XCUIApplication) -> String {
    transport(app).exists ? transport(app).label : "none"
  }

  @discardableResult
  func attachReader() -> XCUIApplication {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let transport = app.buttons.matching(NSPredicate(format: "label == 'Play' OR label == 'Pause'")).firstMatch
    XCTAssertTrue(transport.waitForExistence(timeout: 10),
                  "Stage first: the reader open, paused, player expanded (harness open/collapse, no relaunch)")
    // A tap fired inside the activation's transition is not delivered (the
    // dismissal shape of README Pitfalls, #213): settle before pressing.
    let settle = (Double(param("SETTLE", "3")) ?? 3).bounded(0...90)
    if settle > 0 { Thread.sleep(forTimeInterval: settle); print("PW settled \(settle) s after activate") }
    return app
  }

  func ms(_ from: Date) -> String { String(format: "+%.0f ms", Date().timeIntervalSince(from) * 1000) }

  /// Presses Play, photographs the press at once, samples the transport's
  /// label across the 2 s wait, then plays `PLAY_SECONDS` and pauses. One run
  /// serves (a) wait-with-spinner, (c) no-wait-after-failure and (d) the
  /// control, which differ only in what the host staged and what the Debug
  /// Log must show; the label samples say which of the two shapes this run
  /// took (Pause with the spinner early, or Pause with no spinner at +0.4 s).
  func testPlaySpinThenStart() {
    let app = attachReader()
    let play = app.buttons["Play"]
    tree("before", app)

    let tapped = Date()
    print("PW tap Play at \(tapped)")
    play.tap()
    shot("spin-0", app)
    print("PW spin-0 shot \(ms(tapped)) label=\(label(app))")
    let labels0 = label(app)
    Thread.sleep(forTimeInterval: 0.4)
    let labels400 = label(app)
    print("PW +400 ms label=\(labels400)")
    Thread.sleep(forTimeInterval: 0.6)
    print("PW +1000 ms label=\(label(app))")
    Thread.sleep(forTimeInterval: 0.5)
    shot("spin-1500", app)
    print("PW spin-1500 shot \(ms(tapped)) label=\(label(app))")
    Thread.sleep(forTimeInterval: 0.4)
    print("PW +1900 ms label=\(label(app))")
    Thread.sleep(forTimeInterval: 1.1)
    let labels3000 = label(app)
    print("PW +3000 ms label=\(labels3000)")
    tree("after-start", app)

    // The press shows as Pause from the first moments (a)/(d); with no wait
    // (c) it is already the playing Pause at +400 ms. Either way the
    // transport must not be back on Play at +3 s: that would be a press the
    // app dropped on the floor.
    XCTAssertNotEqual(labels0, "none")
    XCTAssertNotEqual(labels3000, "Play", "Nothing had started 3 s after the press (see the Debug Log for play at)")

    let pause = app.buttons["Pause"]
    let paused = Date()
    print("PW tap Pause at \(paused)")
    pause.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "label == 'Play'"), object: transport(app))], timeout: 10)
    print("PW transport back on Play \(ms(paused))")
    Thread.sleep(forTimeInterval: 0.8)
    XCTAssertEqual(label(app), "Play", "Playback must be stopped when this probe returns")
    tree("paused", app)
  }

  /// Presses Play and presses Pause inside the 2 s wait: the press is taken
  /// back (transport returns to Play) and nothing starts when the wait ends.
  /// The Debug Log must then hold no `play at` for this press.
  func testPauseDuringWait() {
    let app = attachReader()
    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 10), "Stage the reader paused first")
    tree("before", app)

    let tapped = Date()
    print("PW tap Play at \(tapped)")
    play.tap()
    shot("wait-0", app)
    print("PW wait-0 shot \(ms(tapped)) label=\(label(app))")

    let pause = app.buttons["Pause"]
    XCTAssertTrue(pause.waitForExistence(timeout: 2), "The press was not shown as Pause inside the wait")
    let pausedAt = Date()
    print("PW tap Pause inside the wait at \(pausedAt) (\(ms(tapped)))")
    pause.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "label == 'Play'"), object: transport(app))], timeout: 5)
    print("PW transport back on Play \(ms(pausedAt))")

    // Across the wait's end (+2 s) and four more: a taken-back press starts
    // nothing, so the label must stay Play throughout.
    for step in 1...10 {
      Thread.sleep(forTimeInterval: 0.4)
      let at = ms(tapped)
      let now = label(app)
      print("PW taken-back sample \(at) label=\(now)")
      XCTAssertEqual(now, "Play", "The reading started \(at) after a press Pause had taken back")
    }
    tree("taken-back", app)
  }

  /// Phase 2 of the #303 verification, self-staging: the probe session can
  /// leave the target app freshly relaunched on the Library, so the method
  /// opens the book natively, presses Play (the Reading holds the audio),
  /// then activates Safari and taps its play control — another app taking
  /// the audio while the Reading plays. The host reads OpenReader's Debug
  /// Log for `interruption.began` and `pause.interrupted`. Safari serves a
  /// tone page from the Mac; the host has already opened it once in Safari
  /// so the page is loaded.
  func testInterruptWithSafari() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let transport = app.buttons.matching(NSPredicate(format: "label == 'Play' OR label == 'Pause'")).firstMatch
    if !transport.waitForExistence(timeout: 6) {
      openBook(app, "A Short Test of Reading Aloud")
    }
    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 10), "No Play button after staging")
    play.tap()
    let playingPause = app.buttons["Pause"]
    XCTAssertTrue(playingPause.waitForExistence(timeout: 15), "The Reading did not start")
    print("PW OpenReader playing at \(Date())")
    Thread.sleep(forTimeInterval: 3)

    let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
    safari.activate()
    let safariPlay = safari.buttons["Play"]
    var found = safariPlay.waitForExistence(timeout: 8)
    if found {
      safariPlay.tap()
    } else {
      let labels = safari.buttons.allElementsBoundByIndex.prefix(25).map(\.label)
      print("PW safari buttons labels=\(labels)")
      let anyPlay = safari.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'play'")).firstMatch
      found = anyPlay.exists
      if found { anyPlay.tap() }
    }
    print("PW safari play tapped at \(Date()) found=\(found)")
    Thread.sleep(forTimeInterval: 10)
    print("PW safari done at \(Date())")
  }

  /// SyncProbe's open walk, inlined: back to the rows, then the title's row.
  func openBook(_ app: XCUIApplication, _ title: String) {
    let anyRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Actions for '")).firstMatch
    var backs = 0
    while backs < 4 && !anyRow.exists && app.buttons["Back"].exists {
      app.buttons["Back"].tap()
      backs += 1
      Thread.sleep(forTimeInterval: 0.8)
    }
    if !anyRow.waitForExistence(timeout: 2) {
      app.terminate(); app.launch()
      if app.buttons["Back"].waitForExistence(timeout: 10) { app.buttons["Back"].tap() }
      _ = anyRow.waitForExistence(timeout: 20)
    }
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 20), "\(title) is not on the shelf")
    row.tap()
    let play = app.buttons.matching(NSPredicate(format: "label == 'Play' OR label == 'Pause'")).firstMatch
    XCTAssertTrue(play.waitForExistence(timeout: 90), "The player never appeared for \(title)")
    Thread.sleep(forTimeInterval: 1.5)
  }

  /// The plain regression: Play, Pause, Play, Pause with no server trouble —
  /// each press answered, and the probe returns with playback stopped.
  func testPlayPausePlay() {
    let app = attachReader()
    tree("before", app)
    for round in 1...2 {
      let play = app.buttons["Play"]
      XCTAssertTrue(play.waitForExistence(timeout: 10), "Round \(round): no Play button")
      let tapped = Date()
      print("PW round \(round) tap Play at \(tapped)")
      play.tap()
      shot("plain-\(round)-pressed", app)
      print("PW round \(round) press shot \(ms(tapped)) label=\(label(app))")
      Thread.sleep(forTimeInterval: playSeconds)
      let pause = app.buttons["Pause"]
      XCTAssertTrue(pause.exists, "Round \(round): not playing \(playSeconds) s after the press")
      let paused = Date()
      print("PW round \(round) tap Pause at \(paused)")
      pause.tap()
      _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
        predicate: NSPredicate(format: "label == 'Play'"), object: transport(app))], timeout: 10)
      print("PW round \(round) back on Play \(ms(paused))")
      Thread.sleep(forTimeInterval: 0.8)
    }
    XCTAssertEqual(label(app), "Play", "Playback must be stopped when this probe returns")
    tree("paused", app)
  }
}

extension Double {
  func bounded(_ range: ClosedRange<Double>) -> Double { min(max(self, range.lowerBound), range.upperBound) }
}
