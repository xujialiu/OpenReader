import XCTest

/// Real iOS touches for #73. This probe keeps the network result visible as an
/// app result rather than replacing it with a mock, and photographs every
/// selection surface it reaches. The WebView gestures are coordinate touches;
/// accessibility is used only to operate the native settings and drawer after
/// the gesture has opened them.
final class TranslationProbe: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
  /// The app's harness file (run-probe call with MANUAL_HARNESS_PATH passed
  /// through TEST_RUNNER_…): the harness's breakfetch lives in the app's
  /// JavaScript runtime, which a relaunch resets, so the lookups this probe
  /// raises re-arm it after every launch — that is what keeps this run from
  /// sending the selection to Youdao while its consent is answered Allow.
  let harnessPath = ProcessInfo.processInfo.environment["MANUAL_HARNESS_PATH"]

  func breakFetchAgain() {
    guard let path = harnessPath else { return }
    let previous = (try? String(contentsOfFile: path, encoding: .utf8))
      .flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
    let seq = (previous?["seq"] as? Int ?? 0) + 1
    let body: [String: Any] = ["seq": seq, "do": "breakfetch", "host": "youdao.com", "from": 1]
    guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
    try? data.write(to: URL(fileURLWithPath: path))
    Thread.sleep(forTimeInterval: 0.8)
  }

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
    answerLookupConsent()
    XCTAssertTrue(lookupDrawer().waitForExistence(timeout: 20), "Long press did not open lookup drawer")
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
      answerLookupConsent()
      if lookupDrawer().waitForExistence(timeout: 2) {
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
    XCTAssertFalse(lookupDrawer().waitForExistence(timeout: 2), "Disabled lookup opened a result")
    capture("translation-disabled-long-press")

    app.terminate(); app.launch()
    setLookupEnabled(true)
    openBook()
    longPressAnUnhighlightedLine()
    XCTAssertTrue(app.buttons["Dictionary"].exists)
    XCTAssertTrue(app.buttons["Translation"].exists)

    // The drawer is non-modal, on the phone's sheet (#117): a drag on the
    // header beside the segmented control grows it while the document remains
    // behind it, and a drag back down returns it to the Drawer Height.
    XCTAssertTrue(lookupDrawer().waitForExistence(timeout: 3), "Drawer header is not accessible")
    let collapsed = lookupDrawer().frame.minY
    let origin = app.coordinate(withNormalizedOffset: .zero)
    let dragStart = origin.withOffset(CGVector(dx: 56, dy: collapsed + 24))
    let dragUp = origin.withOffset(CGVector(dx: 56, dy: 80))
    dragStart.press(forDuration: 0.2, thenDragTo: dragUp)
    Thread.sleep(forTimeInterval: 0.8)
    let expanded = lookupDrawer().frame.minY
    print("TRANSLATION drawer top collapsed=\(collapsed) expanded=\(expanded)")
    XCTAssertLessThan(expanded, collapsed, "Drawer did not expand from a real drag")
    origin.withOffset(CGVector(dx: 56, dy: expanded + 24))
      .press(forDuration: 0.2, thenDragTo: origin.withOffset(CGVector(dx: 56, dy: collapsed + 24)))
    Thread.sleep(forTimeInterval: 0.8)
    XCTAssertGreaterThanOrEqual(lookupDrawer().frame.minY, collapsed - 2, "The drag down did not return the drawer")

    // The harness's breakfetch refuses every youdao.com request, so the lookup
    // cannot answer: the drawer stays up with its error and Retry, and nothing
    // was sent. The result-bearing asserts (Copy result, the pronunciations)
    // wait for a run with the fetch whole.
    let retry = app.buttons["Retry"]
    XCTAssertTrue(retry.waitForExistence(timeout: 10) || app.buttons["Copy result"].exists,
                  "Neither Retry (fetch deliberately broken) nor a result arrived")
    capture("translation-dictionary-broken-fetch")
    closeLookupDrawer()
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
    XCTAssertTrue(lookupDrawer().waitForExistence(timeout: 5), "Prepared translation drawer is not open")
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

  /// Since #117 batch 3 the lookup drawer is the phone's sheet: no close
  /// button, no panel-height adjustable. It is there when its segmented
  /// header's first segment is, and a swipe down from the header puts it away.
  /// Its lookups are asked about before the text leaves (#109); this probe
  /// runs with the harness's `breakfetch` on youdao.com, so an Allow sends
  /// nothing and the drawer stays up with its error and Retry.
  func lookupDrawer() -> XCUIElement { app.buttons["Dictionary"].firstMatch }
  func answerLookupConsent() {
    let allow = app.alerts.matching(NSPredicate(format: "label BEGINSWITH 'Send selected text to'")).firstMatch.buttons["Allow"]
    if allow.waitForExistence(timeout: 4) { allow.tap() }
  }
  func closeLookupDrawer() {
    let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.52))
    let bottom = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.97))
    top.press(forDuration: 0.15, thenDragTo: bottom)
  }
  func waitForLookupDrawerToDisappear(_ timeout: TimeInterval) -> TimeInterval? {
    let started = Date()
    while Date().timeIntervalSince(started) < timeout {
      if !lookupDrawer().exists { return Date().timeIntervalSince(started) }
      Thread.sleep(forTimeInterval: 0.05)
    }
    return nil
  }
  /// A fresh query on every pass matters here. The old one-shot assertion could
  /// pass without a tap when the previous test had already closed the drawer,
  /// and it could read the same accessibility snapshot immediately after the
  /// tap. Record the elapsed time until a new query says the drawer is gone.
  func waitForCloseLookupToDisappear(_ timeout: TimeInterval) -> TimeInterval? {
    waitForLookupDrawerToDisappear(timeout)
  }

  /// Leave a real selection drawer open before the close measurement. If the
  /// preceding test left the reader behind it, keep that state; otherwise cold
  /// open the fixture and let its WebView paint before the long press.
  func prepareLookupDrawerForCloseMeasurement() throws {
    app.activate()
    if lookupDrawer().exists { return }
    if !app.buttons["Choose a Voice"].exists && !app.buttons["Play"].exists && !app.buttons["Pause"].exists {
      app.terminate(); app.launch()
      breakFetchAgain()
      openBook()
    }
    let loading = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS 'Laying the document out'"))
      .firstMatch
    let deadline = Date().addingTimeInterval(20)
    while loading.exists && Date() < deadline { Thread.sleep(forTimeInterval: 0.5) }
    XCTAssertFalse(loading.exists, "Reader layout did not finish before close measurement")
    Thread.sleep(forTimeInterval: 3.0)
    longPressAnUnhighlightedLine()
    XCTAssertTrue(lookupDrawer().exists, "Close measurement did not open a drawer")
  }

  /// Three real close/reopen cycles. The precondition makes a no-op impossible;
  /// the bounded wait records whether close is immediate, delayed, or absent.
  /// #117: no close button — the swipe down from the header is the close.
  func testCloseCurrentLookupDrawer() throws {
    try prepareLookupDrawerForCloseMeasurement()
    for cycle in 1...3 {
      XCTAssertTrue(lookupDrawer().waitForExistence(timeout: 5), "Lookup drawer was not open for cycle \(cycle)")
      capture("lookup-close-\(cycle)-before")

      let started = Date()
      closeLookupDrawer()
      let elapsed = waitForCloseLookupToDisappear(5.0)
      let measured = elapsed.map { String(format: "%.3f", $0) } ?? "timeout"
      print("LOOKUP_CLOSE cycle=\(cycle) disappearedAfter=\(measured)")
      capture("lookup-close-\(cycle)-after")
      XCTAssertNotNil(elapsed, "The drawer remained visible for 5 seconds in cycle \(cycle)")

      if cycle < 3 {
        Thread.sleep(forTimeInterval: 0.4)
        longPressAnUnhighlightedLine()
        XCTAssertTrue(lookupDrawer().waitForExistence(timeout: 5), "Reopen did not produce a drawer for cycle \(cycle + 1)")
      }
    }
  }

  /// #117 batch 3's drawer facts on the fixture, with the harness's
  /// `breakfetch` on youdao.com so nothing is sent (the consent is answered
  /// Allow; the requests die at the fetch layer): the header is the system's
  /// segmented control with no close arrow and no height adjustable; a drag on
  /// the segmented control does not move the drawer; a drag of a selection
  /// handle — which axe cannot do — expands the selection into Translation;
  /// the Service menu leaves the drawer on screen; a swipe down closes.
  func testLookupStructureHandleDragAndSwipeClose() throws {
    app.terminate(); app.launch()
    breakFetchAgain()
    openTranslationSettings()
    let lookup = app.switches["Long-press lookup"]
    if (lookup.value as? String) != "1" { lookup.tap() }
    let pause = app.switches["Pause reading during lookup"]
    if (pause.value as? String) != "1" { pause.tap() }
    if any(label: "Direction, Chinese → English").exists { choose("Direction, Chinese → English", "English → Chinese") }
    if any(label: "Translate into, English").exists { choose("Translate into, English", "Simplified Chinese") }
    if any(label: "Service, Google").exists { choose("Service, Google", "Youdao") }
    back(); back()
    openBook()

    longPressAnUnhighlightedLine()
    XCTAssertTrue(app.buttons["Dictionary"].exists, "No Dictionary segment")
    XCTAssertTrue(app.buttons["Translation"].exists, "No Translation segment")
    XCTAssertFalse(app.buttons["Close lookup"].exists, "The down-arrow close button is back")
    XCTAssertFalse(app.staticTexts["Lookup panel height"].exists, "The height adjustable is back")
    capture("lookup-drawer-dictionary-segmented")

    // A drag that starts on the segmented control does not move the drawer.
    let before = lookupDrawer().frame.minY
    let segment = app.buttons["Dictionary"]
    let origin = app.coordinate(withNormalizedOffset: .zero)
    origin.withOffset(CGVector(dx: segment.frame.midX, dy: segment.frame.midY))
      .press(forDuration: 0.2, thenDragTo: origin.withOffset(CGVector(dx: segment.frame.midX, dy: segment.frame.midY + 200)))
    Thread.sleep(forTimeInterval: 0.8)
    XCTAssertLessThan(abs(lookupDrawer().frame.minY - before), 2, "A drag on the segmented control moved the drawer")

    // The page stays usable at the Drawer Height: dragging a selection handle
    // expands the selection, which switches to Translation.
    answerLookupConsent()
    let handle = origin.withOffset(CGVector(dx: app.frame.width * 0.125, dy: app.frame.height * 0.205))
    let sentenceEnd = origin.withOffset(CGVector(dx: app.frame.width * 0.36, dy: app.frame.height * 0.23))
    handle.press(forDuration: 0.5, thenDragTo: sentenceEnd)
    answerLookupConsent()
    XCTAssertTrue(any(label: "Service, Youdao").waitForExistence(timeout: 6), "The expanded selection did not switch to Translation")
    XCTAssertTrue(app.buttons["Translation"].isSelected, "Translation was not selected after the handle drag")
    capture("lookup-handle-drag-translation")

    // The Service menu leaves the drawer on screen.
    any(label: "Service, Youdao").tap()
    XCTAssertTrue(any(label: "Google").waitForExistence(timeout: 3), "The Service menu did not open")
    XCTAssertTrue(lookupDrawer().exists, "The drawer went away under the Service menu")
    any(label: "Youdao").tap()
    capture("lookup-service-menu-open")

    // A swipe down closes the drawer.
    closeLookupDrawer()
    XCTAssertNotNil(waitForLookupDrawerToDisappear(5), "The swipe down did not close the drawer")
    capture("lookup-after-swipe-close")
  }
}