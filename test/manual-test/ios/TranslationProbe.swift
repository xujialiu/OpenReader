import XCTest

/// Real iOS touches for #73. This probe keeps the network result visible as an
/// app result rather than replacing it with a mock, and photographs every
/// selection surface it reaches. The WebView gestures are coordinate touches;
/// accessibility is used only to operate the native settings and drawer after
/// the gesture has opened them.
final class TranslationProbe: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")

  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func capture(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"
    tree.lifetime = .keepAlways
    add(tree)
  }

  func any(label: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
  }

  func openSettings() {
    if app.buttons["Back"].exists { app.buttons["Back"].tap() }
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 15), "Library did not appear")
    app.buttons["Settings"].tap()
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5), "Settings did not open")
  }

  func back() {
    app.navigationBars.buttons.element(boundBy: 0).tap()
  }

  func openTranslationSettings() {
    openSettings()
    let row = app.buttons["Word Lookup & Translation"]
    XCTAssertTrue(row.waitForExistence(timeout: 5), "Lookup settings row missing")
    row.tap()
    XCTAssertTrue(app.navigationBars["Word Lookup & Translation"].waitForExistence(timeout: 5), "Lookup settings did not open")
  }

  func choose(_ rowLabel: String, _ option: String) {
    let row = any(label: rowLabel)
    XCTAssertTrue(row.waitForExistence(timeout: 3), "Missing choice row \(rowLabel)")
    row.tap()
    let choice = any(label: option)
    XCTAssertTrue(choice.waitForExistence(timeout: 3), "Missing menu option \(option)")
    choice.tap()
  }

  func setLookupEnabled(_ value: Bool) {
    openTranslationSettings()
    let toggle = app.switches["Long-press lookup"]
    XCTAssertTrue(toggle.waitForExistence(timeout: 3))
    let current = (toggle.value as? String) == "1"
    if current != value { toggle.tap() }
    let deadline = Date().addingTimeInterval(3)
    while ((app.switches["Long-press lookup"].value as? String) == "1") != value && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.1)
    }
    XCTAssertEqual((app.switches["Long-press lookup"].value as? String) == "1", value)
    back()
    back()
  }

  func ensureLibrary() {
    if app.navigationBars["Word Lookup & Translation"].exists { back() }
    if app.navigationBars["Settings"].exists { back() }
    if app.buttons["Back"].exists { app.buttons["Back"].tap() }
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 15), "Library did not appear")
  }

  func openBook() {
    ensureLibrary()
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'A Short Test of Reading Aloud'" )).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10), "Translation fixture is missing")
    row.tap()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 15), "Reader did not open")
    // The EPUB's first section can finish React Native mounting before the
    // WebView has painted any text. Long press is meaningless against that
    // placeholder, so wait for the reader's own layout signal to disappear.
    let loading = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS 'Laying the document out'")).firstMatch
    let deadline = Date().addingTimeInterval(60)
    while loading.exists && Date() < deadline { Thread.sleep(forTimeInterval: 0.5) }
    XCTAssertFalse(loading.exists, "Reader layout did not finish")
    Thread.sleep(forTimeInterval: 0.5)
    capture("translation-reader-before-gesture")
  }

  func bodyPoint(_ y: CGFloat = 0.31) -> XCUICoordinate {
    // The fixture's first chapter begins below the status/header area and above
    // the floating player. This is a real coordinate in the WebView, not a
    // JavaScript or React handler call.
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: y))
  }

  func longPressWord(at y: CGFloat = 0.31) {
    bodyPoint(y).press(forDuration: 1.0)
    XCTAssertTrue(app.buttons["Close lookup"].waitForExistence(timeout: 20), "Long press did not open lookup drawer")
    capture("translation-dictionary-open")
  }

  func longPressAnUnhighlightedLine() {
    // With lookup disabled, iOS keeps the reader's existing tap behavior. That
    // can leave the tapped sentence highlighted after the negative assertion;
    // try several visible lines so the positive touch is independent of that
    // remembered reading position.
    let lines: [CGFloat] = [0.22, 0.31, 0.48, 0.60]
    for y in lines {
      bodyPoint(y).press(forDuration: 1.0)
      if app.buttons["Close lookup"].waitForExistence(timeout: 2) {
        capture("translation-dictionary-open")
        return
      }
    }
    XCTFail("Long press did not open lookup drawer on any visible line")
  }

  func testSettingsDefaultsMenusAndPersistence() throws {
    app.terminate()
    app.launch()
    openTranslationSettings()
    let lookup = app.switches["Long-press lookup"]
    XCTAssertTrue(lookup.waitForExistence(timeout: 3))
    print("TRANSLATION defaults enabled=\(lookup.value ?? "nil") pause=\(app.switches["Pause reading during lookup"].value ?? "nil")")
    XCTAssertEqual((lookup.value as? String) ?? "", "0", "Lookup must default off on a fresh device")
    XCTAssertEqual((app.switches["Pause reading during lookup"].value as? String) ?? "", "1")

    choose("Direction, English → Chinese", "Chinese → English")
    choose("Translate into, Simplified Chinese", "English")
    choose("Service, Youdao", "Google")
    let afterDirection = any(label: "Direction, Chinese → English")
    let afterTarget = any(label: "Translate into, English")
    let afterService = any(label: "Service, Google")
    XCTAssertTrue(afterDirection.exists && afterTarget.exists && afterService.exists, "Menu choices did not remain selected")
    capture("translation-settings-chosen")

    // Enable the feature, leave the stack, and cold-launch again. The setting
    // belongs to the device, so this proves persistence through the app's file.
    lookup.tap()
    XCTAssertEqual((lookup.value as? String) ?? "", "1")
    back(); back()
    app.terminate(); app.launch()
    openTranslationSettings()
    XCTAssertEqual((app.switches["Long-press lookup"].value as? String) ?? "", "1")
    XCTAssertTrue(any(label: "Direction, Chinese → English").exists)
    XCTAssertTrue(any(label: "Translate into, English").exists)
    XCTAssertTrue(any(label: "Service, Google").exists)
    capture("translation-settings-persisted")
  }

  func testLongPressDisabledThenEnabledDrawerAndCopy() throws {
    app.terminate(); app.launch()
    setLookupEnabled(false)
    openBook()
    bodyPoint().press(forDuration: 1.0)
    XCTAssertFalse(app.buttons["Close lookup"].waitForExistence(timeout: 2), "Disabled lookup opened a result")
    capture("translation-disabled-long-press")

    app.terminate(); app.launch()
    setLookupEnabled(true)
    openBook()
    longPressAnUnhighlightedLine()
    XCTAssertTrue(app.buttons["Dictionary"].exists)
    XCTAssertTrue(app.buttons["Translation"].exists)

    // The drawer is non-modal. Its native adjustable header can be dragged up
    // and down while the document remains behind it.
    let panel = any(label: "Lookup panel height")
    XCTAssertTrue(panel.waitForExistence(timeout: 3), "Drawer header is not accessible")
    let collapsed = panel.frame.minY
    let origin = app.coordinate(withNormalizedOffset: .zero)
    let dragStart = origin.withOffset(CGVector(dx: app.frame.midX, dy: panel.frame.midY))
    let dragUp = origin.withOffset(CGVector(dx: app.frame.midX, dy: max(40, panel.frame.minY - 300)))
    dragStart.press(forDuration: 0.2, thenDragTo: dragUp)
    Thread.sleep(forTimeInterval: 0.4)
    let expanded = panel.frame.minY
    print("TRANSLATION drawer top collapsed=\(collapsed) expanded=\(expanded)")
    XCTAssertLessThan(expanded, collapsed, "Drawer did not expand from a real drag")
    let dragDown = origin.withOffset(CGVector(dx: app.frame.midX, dy: min(app.frame.maxY - 80, expanded + 300)))
    origin.withOffset(CGVector(dx: app.frame.midX, dy: panel.frame.midY))
      .press(forDuration: 0.2, thenDragTo: dragDown)
    Thread.sleep(forTimeInterval: 0.4)

    let copy = app.buttons["Copy result"]
    XCTAssertTrue(copy.waitForExistence(timeout: 10), "Dictionary result never arrived")
    XCTAssertTrue(app.buttons["Play UK pronunciation"].exists, "Youdao result did not expose UK audio")
    XCTAssertTrue(app.buttons["Play US pronunciation"].exists, "Youdao result did not expose US audio")
    copy.tap()
    // The button keeps its stable accessibility label (Copy result) while its
    // visible child changes to Copied; verify the real clipboard after this
    // XCTest run with simctl pbpaste, and keep the drawer evidence here.
    Thread.sleep(forTimeInterval: 0.5)
    capture("translation-dictionary-copied")

    // Change result kind through the real drawer control. The current settings
    // service is Google from the prior test, so a refusal should be visible;
    // switching explicitly to Youdao is the recovery path, never an automatic
    // fallback.
    app.buttons["Translation"].tap()
    let currentService = any(label: "Service, Google").exists ? any(label: "Service, Google") : any(label: "Service, Youdao")
    XCTAssertTrue(currentService.waitForExistence(timeout: 3), "Translation service row missing")
    if currentService.label.contains("Youdao") {
      currentService.tap()
      XCTAssertTrue(any(label: "Google").waitForExistence(timeout: 3), "Google menu option missing")
      any(label: "Google").tap()
    }
    XCTAssertTrue(any(label: "Service, Google").waitForExistence(timeout: 3), "Google service choice did not stick")
    XCTAssertTrue(app.buttons["Retry"].waitForExistence(timeout: 20) || app.buttons["Copy result"].waitForExistence(timeout: 20), "Translation result did not resolve or show Retry")
    capture("translation-mode-google")
    any(label: "Service, Google").tap()
    XCTAssertTrue(any(label: "Youdao").waitForExistence(timeout: 3), "Youdao menu option missing")
    any(label: "Youdao").tap()
    XCTAssertTrue(app.buttons["Copy result"].waitForExistence(timeout: 20) || app.buttons["Retry"].waitForExistence(timeout: 20), "Explicit Youdao switch did not produce a result or Retry")
    capture("translation-mode-youdao")
    app.buttons["Close lookup"].tap()
  }

  /// A short follow-up for diagnosing a cold remount versus a live reader. The
  /// preceding test leaves the feature enabled and the reader open even when a
  /// later assertion fails, so this method performs only the real gesture.
  func testLongPressWhenEnabledAndReaderOpen() throws {
    app.activate()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 10))
    let loading = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS 'Laying the document out'")).firstMatch
    let deadline = Date().addingTimeInterval(20)
    while loading.exists && Date() < deadline { Thread.sleep(forTimeInterval: 0.5) }
    longPressAnUnhighlightedLine()
    capture("translation-enabled-follow-up")
  }

  func testPronunciationButtonsTouchDictionaryAudio() throws {
    app.terminate(); app.launch()
    openBook()
    longPressAnUnhighlightedLine()
    XCTAssertTrue(app.buttons["Play UK pronunciation"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Play US pronunciation"].waitForExistence(timeout: 5))

    // The simulator is silenced by the shell before this XCTest starts. The
    // transient indicator is the app's own audio-controller state; a very short
    // response may finish before XCTest observes it, so the durable failure
    // surface is the absence of the audio-error label.
    app.buttons["Play UK pronunciation"].tap()
    let started = any(label: "Playing pronunciation").waitForExistence(timeout: 3)
    print("TRANSLATION pronunciation UK started=\(started)")
    Thread.sleep(forTimeInterval: 0.8)
    XCTAssertFalse(any(label: "Pronunciation could not be played. Try again.").exists, "UK pronunciation reported an audio error")
    let ukFinished = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: any(label: "Playing pronunciation"))
    XCTAssertEqual(XCTWaiter.wait(for: [ukFinished], timeout: 10), .completed, "UK pronunciation did not finish naturally")
    capture("translation-pronunciation-uk")

    app.buttons["Play US pronunciation"].tap()
    Thread.sleep(forTimeInterval: 0.8)
    XCTAssertFalse(any(label: "Pronunciation could not be played. Try again.").exists, "US pronunciation reported an audio error")
    let usFinished = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: any(label: "Playing pronunciation"))
    XCTAssertEqual(XCTWaiter.wait(for: [usFinished], timeout: 10), .completed, "US pronunciation did not finish naturally")
    app.buttons["Close lookup"].tap()
  }

  func testSelectionHandleExpansionTranslatesSentence() throws {
    app.terminate(); app.launch()
    openTranslationSettings()
    let lookup = app.switches["Long-press lookup"]
    if (lookup.value as? String) != "1" { lookup.tap() }
    let pause = app.switches["Pause reading during lookup"]
    if (pause.value as? String) != "1" { pause.tap() }
    if any(label: "Direction, Chinese → English").exists { choose("Direction, Chinese → English", "English → Chinese") }
    if any(label: "Direction, English → English").exists { choose("Direction, English → English", "English → Chinese") }
    if any(label: "Translate into, English").exists { choose("Translate into, English", "Simplified Chinese") }
    if any(label: "Service, Google").exists { choose("Service, Google", "Youdao") }
    back(); back()
    openBook()

    longPressAnUnhighlightedLine()
    // On the iPhone 17 fixture at its first sentence, the visible right handle
    // for the initial `This` selection is around (0.125, 0.205). Dragging it to
    // the line's right side is a real native selection handle touch; the drawer
    // remains nonmodal above the lower content.
    let origin = app.coordinate(withNormalizedOffset: .zero)
    let handle = origin.withOffset(CGVector(dx: app.frame.width * 0.125, dy: app.frame.height * 0.205))
    let sentenceEnd = origin.withOffset(CGVector(dx: app.frame.width * 0.36, dy: app.frame.height * 0.23))
    handle.press(forDuration: 0.5, thenDragTo: sentenceEnd)
    XCTAssertTrue(any(label: "Service, Youdao").waitForExistence(timeout: 5), "Expanded selection did not switch to Translation")
    XCTAssertTrue(app.buttons["Translation"].isSelected, "Translation mode was not selected after handle release")
    XCTAssertTrue(app.buttons["Copy result"].waitForExistence(timeout: 25), "Youdao sentence translation did not return a result")
    let values = app.staticTexts.allElementsBoundByIndex.map(\.label).filter { !$0.isEmpty }
    print("TRANSLATION sentence results: \(values.filter { $0.count > 8 }.prefix(12))")
    capture("translation-sentence-expanded-light")
    // Leave the drawer open so the shell can photograph the same real result
    // after switching the simulator appearance to dark.
  }

  func testHandleDragOnPreparedReader() throws {
    app.activate()
    longPressAnUnhighlightedLine()
    let origin = app.coordinate(withNormalizedOffset: .zero)
    let handle = origin.withOffset(CGVector(dx: app.frame.width * 0.125, dy: app.frame.height * 0.205))
    let sentenceEnd = origin.withOffset(CGVector(dx: app.frame.width * 0.36, dy: app.frame.height * 0.23))
    handle.press(forDuration: 0.5, thenDragTo: sentenceEnd)
    XCTAssertTrue(any(label: "Service, Youdao").waitForExistence(timeout: 5), "Prepared native handle drag did not switch to Translation")
    XCTAssertTrue(app.buttons["Translation"].isSelected, "Prepared native handle drag did not select Translation")
    XCTAssertTrue(app.buttons["Copy result"].waitForExistence(timeout: 25), "Prepared sentence translation did not return")
    capture("translation-sentence-expanded-prepared")
  }

  func testSecondHandleDragExpandsTheWholeSentence() throws {
    app.activate()
    XCTAssertTrue(app.buttons["Close lookup"].waitForExistence(timeout: 5), "Prepared translation drawer is not open")
    // The prepared fixture's current selection is `is a`; its right handle is
    // about (0.18, 0.205). Drag to the line's right side.
    let origin = app.coordinate(withNormalizedOffset: .zero)
    let right = origin.withOffset(CGVector(dx: app.frame.width * 0.18, dy: app.frame.height * 0.205))
    let sentenceEnd = origin.withOffset(CGVector(dx: app.frame.width * 0.36, dy: app.frame.height * 0.23))
    right.press(forDuration: 0.5, thenDragTo: sentenceEnd)
    XCTAssertTrue(any(label: "Service, Youdao").waitForExistence(timeout: 5), "Second handle drag lost Translation mode")
    XCTAssertTrue(app.buttons["Copy result"].waitForExistence(timeout: 25), "Whole sentence translation did not return")
    let text = app.staticTexts.allElementsBoundByIndex.map(\.label).filter { $0.count > 8 }
    print("TRANSLATION expanded sentence result: \(text.prefix(12))")
    capture("translation-whole-sentence-expanded")
  }

  // Run after testSelectionHandleExpansionTranslatesSentence on the fixture.
  // Unlike the older probe, assert that the actual selection changed too.
  func testPreparedHandleReleaseFinishesRequest() throws {
    app.activate()
    XCTAssertTrue(app.buttons["Translation"].isSelected, "Prepare the fixture selection first")
    Thread.sleep(forTimeInterval: 0.5)
    let beforeLabels = Set(app.staticTexts.allElementsBoundByIndex.map(\.label).filter { !$0.isEmpty })
    let origin = app.coordinate(withNormalizedOffset: .zero)
    let handle = origin.withOffset(CGVector(dx: app.frame.width * 0.18, dy: app.frame.height * 0.205))
    let end = origin.withOffset(CGVector(dx: app.frame.width * 0.36, dy: app.frame.height * 0.23))
    handle.press(forDuration: 0.5, thenDragTo: end)
    let deadline = Date().addingTimeInterval(5)
    var changed = false
    while Date() < deadline {
      let afterLabels = Set(app.staticTexts.allElementsBoundByIndex.map(\.label).filter { !$0.isEmpty })
      if afterLabels != beforeLabels { changed = true; break }
      Thread.sleep(forTimeInterval: 0.2)
    }
    XCTAssertTrue(changed, "Handle drag did not change selected text")
    XCTAssertTrue(app.buttons["Copy result"].waitForExistence(timeout: 18) || app.buttons["Retry"].exists,
                  "Released selection never settled into a result or bounded failure")
    capture("translation-handle-release-bounded")
  }

  func testCloseCurrentLookupDrawer() throws {
    app.activate()
    if app.buttons["Close lookup"].exists { app.buttons["Close lookup"].tap() }
    XCTAssertFalse(app.buttons["Close lookup"].exists)
  }
}
