import XCTest

/// Real Fish narration touches for #73's speech interruption coverage. The
/// caller configures Fish and loads its voice list before this `.activate()`
/// only probe; it never terminates the app, because the current reader and its
/// in-memory provider state are the thing being measured.
final class FishNarrationProbe: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")

  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func capture(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
  }

  func dismissLogBox() {
    let warning = app.staticTexts["Open debugger to view warnings."]
    for _ in 0..<5 {
      guard warning.exists else { return }
      // iOS 27 exposes the LogBox close glyph as a child without a stable
      // accessibility label; this is the real touch at its measured point.
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.918, dy: 0.933)).tap()
      Thread.sleep(forTimeInterval: 0.5)
    }
  }

  func any(_ label: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
  }

  func chooseFishVoiceIfNeeded() {
    let chooser = app.buttons["Choose a Voice"]
    XCTAssertTrue(chooser.waitForExistence(timeout: 15), "Reader/player is not open")
    chooser.tap()
    let voice = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS 'jjk narrator'" )).firstMatch
    XCTAssertTrue(voice.waitForExistence(timeout: 20), "Fish voice list did not contain jjk narrator")
    voice.tap()
    if app.buttons["Close Voice"].waitForExistence(timeout: 3) { app.buttons["Close Voice"].tap() }
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10), "Fish voice choice did not leave a paused reader")
  }

  func bodyPoint(_ y: CGFloat = 0.22) -> XCUICoordinate {
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: y))
  }

  func openLookupFromLine() {
    let lines: [CGFloat] = [0.22, 0.31, 0.48, 0.60]
    for line in lines {
      bodyPoint(line).press(forDuration: 1.0)
      if app.buttons["Close lookup"].waitForExistence(timeout: 2) { return }
    }
    XCTFail("No visible line opened lookup")
  }

  func openLookupOnBodyWord() {
    // The real book's first page has a numbered chapter heading near 0.22;
    // pronunciation needs a body word, so skip the heading and require the
    // dictionary's audio controls before accepting the selection.
    for line in [CGFloat(0.50), 0.60, 0.70] {
      bodyPoint(line).press(forDuration: 1.0)
      if app.buttons["Close lookup"].waitForExistence(timeout: 2) {
        if app.buttons["Play UK pronunciation"].waitForExistence(timeout: 20) { return }
        closeLookup()
      }
    }
    XCTFail("No body word with pronunciation opened lookup")
  }

  func closeLookup() {
    if app.buttons["Close lookup"].exists { app.buttons["Close lookup"].tap() }
  }

  func tapPlay() {
    dismissLogBox()
    let button = app.buttons["Play"]
    if button.isHittable { button.tap() }
    else if button.frame.width > 0 {
      let window = app.frame
      app.coordinate(withNormalizedOffset: CGVector(dx: button.frame.midX / window.width, dy: button.frame.midY / window.height)).tap()
    } else { app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.90)).tap() }
  }

  func tapPause() {
    dismissLogBox()
    let button = app.buttons["Pause"]
    if button.isHittable { button.tap() }
    else if button.frame.width > 0 {
      let window = app.frame
      app.coordinate(withNormalizedOffset: CGVector(dx: button.frame.midX / window.width, dy: button.frame.midY / window.height)).tap()
    } else { app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.90)).tap() }
  }

  func setPauseReading(_ wanted: Bool, titlePrefix: String = "A Short Test of Reading Aloud") {
    if app.buttons["Back"].exists { app.buttons["Back"].tap() }
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10), "Library did not appear before changing lookup pause")
    app.buttons["Settings"].tap()
    app.buttons["Word Lookup & Translation"].tap()
    let pause = app.switches["Pause reading during lookup"]
    XCTAssertTrue(pause.waitForExistence(timeout: 5))
    let current = (pause.value as? String) == "1"
    if current != wanted { pause.tap() }
    let deadline = Date().addingTimeInterval(3)
    while ((app.switches["Pause reading during lookup"].value as? String) == "1") != wanted && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.1)
    }
    XCTAssertEqual((app.switches["Pause reading during lookup"].value as? String) == "1", wanted)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", titlePrefix)).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10), "Translation fixture missing after settings change")
    row.tap()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 15))
    Thread.sleep(forTimeInterval: 2)
    chooseFishVoiceIfNeeded()
  }

  func waitForPronunciationToFinish() {
    let indicator = any("Playing pronunciation")
    _ = indicator.waitForExistence(timeout: 3)
    let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: indicator)
    XCTAssertEqual(XCTWaiter.wait(for: [done], timeout: 10), .completed, "Pronunciation did not finish")
    XCTAssertFalse(any("Pronunciation could not be played. Try again.").exists, "Pronunciation reported an audio error")
  }

  /// Establishes real Fish playback for five seconds, then stops it. The
  /// five-second window is enough to prove that the provider request returned,
  /// the native player became active, and a real Pause touch stopped it.
  func testRealFishPlayThenPause() throws {
    app.activate()
    dismissLogBox()
    chooseFishVoiceIfNeeded()
    capture("fish-paused-before-play")
    tapPlay()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 30), "Fish narration did not start")
    let start = Date()
    while ((app.buttons["Pause"].value as? String)?.contains("busy") == true) && Date().timeIntervalSince(start) < 30 {
      Thread.sleep(forTimeInterval: 0.2)
    }
    print("FISH play became active after \(Date().timeIntervalSince(start))s")
    Thread.sleep(forTimeInterval: 5)
    XCTAssertTrue(app.buttons["Pause"].exists, "Fish narration did not stay active for the measured five seconds")
    tapPause()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10), "Real Pause touch did not stop Fish narration")
    capture("fish-paused-after-play")
  }

  /// While Fish is speaking, the lookup option defaults on: opening lookup
  /// pauses it, and closing the result leaves the reader paused. This is a
  /// separate five-second touch run so the result is not inferred from state.
  func testLookupPausesPreviouslyPlayingFish() throws {
    app.activate()
    dismissLogBox()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10), "Expected the reader paused before this run")
    tapPlay()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 30), "Fish narration did not start")
    Thread.sleep(forTimeInterval: 2)
    openLookupOnBodyWord()
    closeLookup()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10), "Closing lookup resumed narration despite pause option")
    capture("fish-lookup-paused-and-still-paused")
  }

  /// Turns the setting off through the real Settings switch. Lookup stays
  /// visible while Fish continues, proving the option controls the narration
  /// interruption rather than merely the drawer.
  func testPauseOptionOffKeepsFishPlaying() throws {
    app.activate()
    dismissLogBox()
    setPauseReading(false, titlePrefix: "Cultivation Online")
    tapPlay()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 30))
    // Fish's short fixture can reach its final sentence quickly; place the
    // selection touch while the first active page is still visible.
    Thread.sleep(forTimeInterval: 0.2)
    openLookupOnBodyWord()
    closeLookup()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Pause option off did not keep Fish narration playing")
    tapPause()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10))
    capture("fish-pause-option-off-continued")
  }

  /// When Fish was playing, dictionary pronunciation interrupts it and lets it
  /// resume after the real audio completes. When Fish was paused beforehand,
  /// pronunciation completion leaves it paused. Closing, restarting with the
  /// other accent, and changing the selected line all exercise cancellation.
  func testPronunciationInterruptionResumeAndCancellation() throws {
    app.activate()
    dismissLogBox()
    // Keep the option off to prove pronunciation owns only its temporary pause.
    setPauseReading(false, titlePrefix: "Cultivation Online")
    tapPlay()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 30))
    Thread.sleep(forTimeInterval: 2)
    openLookupOnBodyWord()
    XCTAssertTrue(app.buttons["Play UK pronunciation"].waitForExistence(timeout: 20))
    app.buttons["Play UK pronunciation"].tap()
    waitForPronunciationToFinish()
    closeLookup()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Pronunciation did not resume previously playing Fish")
    tapPause()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10))

    // Already-paused narration must remain paused after pronunciation.
    openLookupOnBodyWord()
    XCTAssertTrue(app.buttons["Play US pronunciation"].waitForExistence(timeout: 20))
    app.buttons["Play US pronunciation"].tap()
    waitForPronunciationToFinish()
    closeLookup()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10), "Pronunciation resumed Fish that was already paused")

    // Close cancels the active graph; restarting with the other accent transfers
    // the interruption without allowing the first graph to overlap it.
    openLookupOnBodyWord()
    XCTAssertTrue(app.buttons["Play UK pronunciation"].waitForExistence(timeout: 20))
    app.buttons["Play UK pronunciation"].tap()
    _ = any("Playing pronunciation").waitForExistence(timeout: 3)
    closeLookup()
    XCTAssertTrue(any("Playing pronunciation").waitForNonExistence(timeout: 3), "Closing lookup did not cancel pronunciation")

    openLookupOnBodyWord()
    XCTAssertTrue(app.buttons["Play US pronunciation"].waitForExistence(timeout: 20))
    app.buttons["Play US pronunciation"].tap()
    _ = any("Playing pronunciation").waitForExistence(timeout: 3)
    // A new selection while the drawer remains open invalidates the old audio.
    bodyPoint(0.60).press(forDuration: 1.0)
    XCTAssertTrue(any("Playing pronunciation").waitForNonExistence(timeout: 3), "Changing the selected line did not cancel pronunciation")
    closeLookup()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10))
    capture("fish-pronunciation-resume-and-cancel")
  }

  /// Runs against the already-open long book and settings prepared by the
  /// shell, avoiding a navigation remount between the Fish transport and the
  /// pronunciation interruption. This is the direct runtime path for the
  /// remaining resume/cancel assertions.
  func testPronunciationInterruptionOnCurrentReader() throws {
    app.activate()
    dismissLogBox()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 15), "Long reader is not open")
    if app.buttons["Choose a Voice"].exists {
      chooseFishVoiceIfNeeded()
    }
    // The real-book harness opens on its Contents spine item. A real tap on a
    // visible chapter row enters body text before the narration touch; on an
    // already-open body this simply places the reading position there.
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35)).tap()
    Thread.sleep(forTimeInterval: 3)
    tapPlay()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 30), "Fish narration did not start")
    Thread.sleep(forTimeInterval: 0.2)
    openLookupOnBodyWord()
    XCTAssertTrue(app.buttons["Play UK pronunciation"].waitForExistence(timeout: 20))
    app.buttons["Play UK pronunciation"].tap()
    waitForPronunciationToFinish()
    closeLookup()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Pronunciation did not resume previously playing Fish")
    tapPause()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10))

    openLookupOnBodyWord()
    XCTAssertTrue(app.buttons["Play US pronunciation"].waitForExistence(timeout: 20))
    app.buttons["Play US pronunciation"].tap()
    waitForPronunciationToFinish()
    closeLookup()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10), "Pronunciation resumed Fish that was already paused")

    openLookupOnBodyWord()
    app.buttons["Play UK pronunciation"].tap()
    _ = any("Playing pronunciation").waitForExistence(timeout: 3)
    closeLookup()
    XCTAssertTrue(any("Playing pronunciation").waitForNonExistence(timeout: 3), "Closing lookup did not cancel pronunciation")
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10))
  }
}
