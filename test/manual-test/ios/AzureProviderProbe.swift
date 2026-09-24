import XCTest

/// Real-touch coverage for issue #39 (ADR/design 0037): Azure Speech as a
/// Provider, synthesizing over its WebSocket route with word-level
/// highlighting. Each method is its own `-only-testing` invocation, run in
/// the order below, because later methods depend on state earlier ones leave
/// (Azure enabled, a voice chosen) the same way `OfflineFixProbe`'s do.
///
/// Credentials are read from host-only files so the key never appears in
/// this source, in `test.log`, or in a screenshot: `Show API key` is tapped
/// only once, before any real key has been typed, and never again.
final class AzureProviderProbe: XCTestCase {
  let englishTitle = "A Short Test of Reading Aloud"
  let chineseTitle = "仙逆"

  override func setUpWithError() throws {
    // A real assertion failure should stop the method rather than cascade
    // through several more wrong-state steps (see README Pitfalls).
    continueAfterFailure = false
  }

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func chip(_ app: XCUIApplication, _ label: String) -> XCUIElement {
    // Chips are accessibilityRole="radio", which iOS 27 does not expose as
    // .radioButton (test/manual-test/README.md, Pitfalls): find by label.
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
  }

  /// Clears a plain (non-secure) controlled field and retypes it in chunks of
  /// ten, the fix for "typeText with a long value kills a settings screen"
  /// (README Pitfalls). Verified empty by comparing to the placeholder.
  func clearAndType(_ field: XCUIElement, _ text: String) {
    field.tap()
    field.typeText(String(repeating: "\u{8}", count: 40))
    XCTAssertEqual((field.value as? String) ?? "", (field.placeholderValue ?? ""), "The field did not clear before typing")
    let characters = Array(text)
    var at = 0
    while at < characters.count {
      let end = min(at + 10, characters.count)
      field.typeText(String(characters[at..<end]))
      at = end
    }
  }

  /// The secure key field: no placeholder-equality check (a secure field's
  /// `.value` is not the plain string), so clearing is verified only by the
  /// connection result that follows, never by reading the field back.
  func clearAndTypeSecure(_ field: XCUIElement, _ text: String, clear: Bool) {
    field.tap()
    if clear { field.typeText(String(repeating: "\u{8}", count: 120)) }
    let characters = Array(text)
    var at = 0
    while at < characters.count {
      let end = min(at + 10, characters.count)
      field.typeText(String(characters[at..<end]))
      at = end
    }
  }

  func goToLibrary(_ app: XCUIApplication) {
    if app.buttons["Back"].waitForExistence(timeout: 2) { app.buttons["Back"].tap() }
  }

  func openAzureScreen(_ app: XCUIApplication) {
    goToLibrary(app)
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
    app.buttons["Settings"].tap()
    let providersRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Providers'")).firstMatch
    XCTAssertTrue(providersRow.waitForExistence(timeout: 5))
    providersRow.tap()
    let azureRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Azure,'")).firstMatch
    XCTAssertTrue(azureRow.waitForExistence(timeout: 5))
    azureRow.tap()
  }

  /// Waits for the connection check to settle (the Test connection row is
  /// enabled again; its label no longer changes to "Testing…", #48) and
  /// returns whatever Note text is now showing.
  func waitForNote(_ app: XCUIApplication, timeout: TimeInterval = 15) -> String {
    let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == 1"), object: app.buttons["Test connection"])
    _ = XCTWaiter.wait(for: [settled], timeout: timeout)
    // Scoped to the screen's own ScrollView (provider-screen.tsx), because
    // `app.staticTexts` unscoped also matches the navigation bar's own title
    // ("Azure"), which collided with `label BEGINSWITH 'Azure'` below and
    // made every wording assertion read the header instead of the note
    // (test/manual-test/README.md, Pitfalls).
    let note = app.scrollViews.staticTexts.matching(NSPredicate(
      format: "label == 'Connection successful' OR label BEGINSWITH 'Azure' OR label CONTAINS 'Cannot reach' OR label BEGINSWITH '\"'"
    )).firstMatch
    XCTAssertTrue(note.waitForExistence(timeout: 5), "No connection note appeared")
    return note.label
  }

  /// `.exists` with no wait raced the screen settling right after
  /// `openAzureScreen`'s navigation tap: it read false on an Azure that was
  /// in fact enabled, skipped the disabling tap, and every following
  /// `typeText` then failed against a still-locked field ("Neither element
  /// nor any descendant has keyboard focus" — test/manual-test/README.md,
  /// Pitfalls). Fixed by reading the switch's own value, with a wait, and by
  /// waiting for the field to actually report enabled before returning.
  func ensureAzureDisabled(_ app: XCUIApplication) {
    let enableSwitch = app.switches["Enable Azure"]
    XCTAssertTrue(enableSwitch.waitForExistence(timeout: 5), "Enable Azure switch missing")
    if (enableSwitch.value as? String) == "1" {
      enableSwitch.tap()
    }
    let keyField = app.textFields["API key"].exists ? app.textFields["API key"] : app.secureTextFields["API key"]
    let unlocked = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == 1"), object: keyField)
    _ = XCTWaiter.wait(for: [unlocked], timeout: 5)
    XCTAssertTrue(keyField.isEnabled, "API key field is still locked after disabling Azure")
  }

  // MARK: 1. The Providers list order, and the Azure screen's controls

  func testProvidersOrderAndAzureScreenControls() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()
    goToLibrary(app)

    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
    app.buttons["Settings"].tap()
    let versionLine = app.staticTexts.matching(NSPredicate(format: "label == 'Version 0.0.2-beta16'")).firstMatch
    XCTAssertTrue(versionLine.waitForExistence(timeout: 5), "Settings did not show Version 0.0.2-beta16")

    let providersRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Providers'")).firstMatch
    XCTAssertTrue(providersRow.waitForExistence(timeout: 5))
    providersRow.tap()

    let rows = app.buttons.matching(NSPredicate(format: "label ENDSWITH 'disabled' OR label ENDSWITH 'enabled'"))
    let labels = rows.allElementsBoundByIndex.map { $0.label }
    XCTAssertEqual(labels, [
      "OpenAI, disabled", "OpenAI Compatible, disabled", "Azure, disabled",
      "Speechify, disabled", "Fish Audio, disabled", "Kokoro FastAPI, disabled",
    ], "Azure must sit between OpenAI Compatible and Speechify")
    capture("providers-list-order", app)

    let azureRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Azure,'")).firstMatch
    azureRow.tap()

    // The switch's label is always "Enabled" now (#48); its value is the state.
    let enableSwitch = app.switches["Enable Azure"]
    XCTAssertTrue(enableSwitch.waitForExistence(timeout: 5), "Enable switch missing")
    XCTAssertEqual(enableSwitch.value as? String, "0", "Azure must start disabled")

    let keyField = app.textFields["API key"].exists ? app.textFields["API key"] : app.secureTextFields["API key"]
    XCTAssertTrue(keyField.waitForExistence(timeout: 5), "API key field missing")
    XCTAssertEqual(keyField.placeholderValue, "Not set")

    // Show/Hide is exercised now, before any real key exists, so revealing
    // an empty field is harmless and no screenshot is taken while revealed.
    let show = app.buttons["Show API key"]
    XCTAssertTrue(show.exists, "Show API key control missing")
    show.tap()
    XCTAssertTrue(app.buttons["Hide API key"].waitForExistence(timeout: 3), "Field did not toggle to Hide API key")
    app.buttons["Hide API key"].tap()
    XCTAssertTrue(app.buttons["Show API key"].waitForExistence(timeout: 3))

    let regionField = app.textFields["Region"]
    XCTAssertTrue(regionField.exists, "Region field missing")
    XCTAssertEqual(regionField.placeholderValue, "eastasia")

    XCTAssertTrue(app.buttons["Test connection"].exists, "Test connection control missing")
    capture("azure-screen-controls", app)
  }

  // MARK: 2. Failure wordings (all free: voice-list checks or client-side format checks), then enable for real

  func testAzureConnectionWordingsAndEnable() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()
    openAzureScreen(app)
    ensureAzureDisabled(app) // idempotent: an earlier run may have left Azure enabled

    let realKey = (try? String(contentsOfFile: "/tmp/openreader-azure-key.txt", encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let realRegion = (try? String(contentsOfFile: "/tmp/openreader-azure-region.txt", encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    XCTAssertFalse(realKey.isEmpty, "Azure key file was empty or unreadable")
    XCTAssertFalse(realRegion.isEmpty, "Azure region file was empty or unreadable")

    let keyField = app.textFields["API key"].exists ? app.textFields["API key"] : app.secureTextFields["API key"]
    let regionField = app.textFields["Region"]

    // (a) a wrong key, valid-format region: 401 naming the region. Cleared
    // unconditionally: a re-run of this method (or one resumed after an
    // earlier run left Azure configured) starts with the real key already
    // in the field, and an unconditional clear is harmless on an empty one.
    clearAndTypeSecure(keyField, "wrong-test-key-0000000000000000", clear: true)
    clearAndType(regionField, "eastasia")
    app.buttons["Test connection"].tap()
    var note = waitForNote(app)
    print("AzureProviderProbe wrong-key note: \(note)")
    XCTAssertEqual(note, "Azure refused the API key for the region eastasia (401). Check the key and the region.")

    // (c) an invalid region id, format rejected before any network call.
    clearAndType(regionField, "east-asia")
    app.buttons["Test connection"].tap()
    note = waitForNote(app)
    print("AzureProviderProbe bad-region-format note: \(note)")
    XCTAssertEqual(note, "Azure needs a region id such as eastasia.")

    // (d) a region that is not Azure's, so the host cannot be reached.
    clearAndType(regionField, "eastasiaa")
    app.buttons["Test connection"].tap()
    note = waitForNote(app, timeout: 20)
    print("AzureProviderProbe unreachable-region note: \(note)")
    XCTAssertTrue(note.contains("eastasiaa.tts.speech.microsoft.com"), "Note did not name the host: \(note)")

    // Switch to the real key now, once, for the remaining two checks.
    clearAndTypeSecure(keyField, realKey, clear: true)

    // (b) the real key, wrong region: 401 naming that region.
    clearAndType(regionField, "westus")
    app.buttons["Test connection"].tap()
    note = waitForNote(app)
    print("AzureProviderProbe wrong-region note: \(note)")
    XCTAssertTrue(note.contains("westus") && note.contains("401"), "Note did not name westus/401: \(note)")

    // (e) the real key and region: success, then Enable.
    clearAndType(regionField, realRegion)
    app.buttons["Test connection"].tap()
    note = waitForNote(app)
    XCTAssertEqual(note, "Connection successful")
    capture("azure-connection-successful-masked", app)

    let enableSwitch = app.switches["Enable Azure"]
    enableSwitch.tap()
    // "Turn off to edit." is drawn only once the check has passed and Azure is
    // enabled; the label reads "Enabled" throughout (#48).
    XCTAssertTrue(app.staticTexts["Turn off to edit."].waitForExistence(timeout: 20), "Azure did not report Enabled")
    XCTAssertEqual(enableSwitch.value as? String, "1", "Azure's switch is not on after the check")
    capture("azure-enabled-masked", app)
  }

  // MARK: 3. The voice sheet: Azure's size, the zh-CN/multilingual/MAI groups, and choosing the English voice

  func testVoiceSheetShowsAzureAndChoosesEnglishVoice() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()
    goToLibrary(app)

    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", englishTitle + ",")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10))
    book.tap()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 10))
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }

    let openedAt = Date()
    app.buttons["Choose a Voice"].tap()
    let azureChip = chip(app, "Azure")
    XCTAssertTrue(azureChip.waitForExistence(timeout: 5))
    azureChip.tap()
    let sheetAt = Date()

    let enUS = chip(app, "en-US")
    XCTAssertTrue(enUS.waitForExistence(timeout: 15), "en-US locale chip did not appear")
    let listedAt = Date()
    print("AzureProviderProbe voice sheet: opened \(openedAt), Azure tapped \(sheetAt), en-US visible \(listedAt), elapsed \(listedAt.timeIntervalSince(sheetAt))s")
    capture("azure-voice-sheet-default-locale", app)

    // The full tree, for a host-side count of locale chips (~154 expected).
    let tree = app.debugDescription
    let attachment = XCTAttachment(string: tree)
    attachment.name = "azure-voice-sheet-tree"; attachment.lifetime = .keepAlways; add(attachment)

    // zh-CN: 晓晓 is listed by its LocalName.
    let zhCN = chip(app, "zh-CN")
    XCTAssertTrue(zhCN.waitForExistence(timeout: 5))
    zhCN.tap()
    XCTAssertTrue(app.buttons["晓晓"].waitForExistence(timeout: 5), "晓晓 missing from zh-CN")
    capture("azure-voice-sheet-zh-cn", app)

    // multilingual: e.g. Ava Multilingual and 晓晓 多语言.
    let multilingual = chip(app, "multilingual")
    XCTAssertTrue(multilingual.waitForExistence(timeout: 5))
    multilingual.tap()
    XCTAssertTrue(app.buttons["Ava Multilingual"].waitForExistence(timeout: 5), "Ava Multilingual missing")
    XCTAssertTrue(app.buttons["晓晓 多语言"].waitForExistence(timeout: 3), "晓晓 多语言 missing")
    capture("azure-voice-sheet-multilingual", app)

    // Scroll behaviour on the locale row, noted rather than judged.
    let localeArea = app.scrollViews.firstMatch
    if localeArea.exists { localeArea.swipeLeft() }
    capture("azure-voice-sheet-after-scroll", app)

    // Back to en-US, choose Andrew (a Neural voice) and confirm MAI sits in the same locale.
    let enUSAgain = chip(app, "en-US")
    XCTAssertTrue(enUSAgain.waitForExistence(timeout: 5))
    enUSAgain.tap()
    // Exact labels: en-US also holds "Andrew Dragon Latest" and "Ethan
    // MAI-Voice-2-Flash", both of which share a string prefix with these.
    let andrew = app.buttons["Andrew"]
    XCTAssertTrue(andrew.waitForExistence(timeout: 5), "Andrew missing from en-US")
    let ethanMAI = app.buttons["Ethan MAI-Voice-2"]
    XCTAssertTrue(ethanMAI.exists, "Ethan MAI-Voice-2 missing from en-US")
    capture("azure-voice-sheet-en-us-with-mai", app)

    andrew.tap()
    // Choosing while paused is a preference and leaves the sheet open (ADR/Fish pattern).
    XCTAssertTrue(app.buttons["Close Voice"].waitForExistence(timeout: 3))
    app.buttons["Close Voice"].tap()
    capture("azure-english-voice-chosen", app)
  }

  // MARK: 4. English Neural voice: audio plays, the highlight moves word by word

  func testPlayEnglishAzureVoiceHighlightsWord() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()
    goToLibrary(app)
    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", englishTitle + ",")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10))
    book.tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10))

    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play did not start")
    capture("azure-en-playing-1", app)
    Thread.sleep(forTimeInterval: 2.5)
    capture("azure-en-playing-2", app)
    Thread.sleep(forTimeInterval: 2.5)
    capture("azure-en-playing-3", app)
    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
    capture("azure-en-paused", app)
  }

  // MARK: 5. Chinese voice: word-level highlight

  func testChineseAzureVoiceHighlightsWord() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()
    goToLibrary(app)
    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", chineseTitle + ",")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10))
    book.tap()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 15))
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }

    app.buttons["Choose a Voice"].tap()
    let azureChip = chip(app, "Azure")
    XCTAssertTrue(azureChip.waitForExistence(timeout: 5))
    azureChip.tap()
    let zhCN = chip(app, "zh-CN")
    XCTAssertTrue(zhCN.waitForExistence(timeout: 15))
    zhCN.tap()
    let xiaoxiao = app.buttons["晓晓"]
    XCTAssertTrue(xiaoxiao.waitForExistence(timeout: 5))
    xiaoxiao.tap()
    XCTAssertTrue(app.buttons["Close Voice"].waitForExistence(timeout: 3))
    app.buttons["Close Voice"].tap()

    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play did not start")
    capture("azure-zh-playing-1", app)
    Thread.sleep(forTimeInterval: 2.5)
    capture("azure-zh-playing-2", app)
    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
    capture("azure-zh-paused", app)
  }

  // MARK: 6. MAI-Voice-2: audio plays, the whole Utterance is highlighted

  func testMAIVoiceHighlightsWholeUtterance() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()
    goToLibrary(app)
    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", englishTitle + ",")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10))
    book.tap()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 10))
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }

    app.buttons["Choose a Voice"].tap()
    let azureChip = chip(app, "Azure")
    XCTAssertTrue(azureChip.waitForExistence(timeout: 5))
    azureChip.tap()
    let enUS = chip(app, "en-US")
    XCTAssertTrue(enUS.waitForExistence(timeout: 15))
    enUS.tap()
    // Exact label: en-US also holds "Ethan MAI-Voice-2-Flash", which shares
    // this string as a prefix.
    let ethanMAI = app.buttons["Ethan MAI-Voice-2"]
    XCTAssertTrue(ethanMAI.waitForExistence(timeout: 5))
    ethanMAI.tap()
    XCTAssertTrue(app.buttons["Close Voice"].waitForExistence(timeout: 3))
    app.buttons["Close Voice"].tap()

    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play did not start")
    capture("azure-mai-playing-1", app)
    Thread.sleep(forTimeInterval: 2.5)
    capture("azure-mai-playing-2", app)
    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
    capture("azure-mai-paused", app)
  }

  // MARK: 7. Backgrounding during an Azure reading

  func testBackgroundDuringAzureReading() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()
    goToLibrary(app)
    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", englishTitle + ",")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10))
    book.tap()
    // Reuses whatever Azure voice is currently in use (Ethan MAI-Voice-2, left by test 6).
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10))
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play did not start")
    // Wait past buffering (the "Pause" label exists as soon as the app enters
    // the playing state, before the first clip has arrived — test 4 showed
    // this by its own "playing-1" capture) so "before" shows audio actually
    // sounding, not just the loading spinner, and so it is a real baseline
    // to compare against "after".
    var waited = 0.0
    while ((app.buttons["Pause"].value as? String)?.contains("busy") ?? false) && waited < 8 {
      Thread.sleep(forTimeInterval: 0.5); waited += 0.5
    }
    capture("azure-background-before", app)

    XCUIDevice.shared.press(.home)
    Thread.sleep(forTimeInterval: 30)
    app.activate()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
    capture("azure-background-after", app)

    // No red-box / error note, and the transport still knows about playback.
    XCTAssertFalse(app.otherElements["RCTRedBox"].exists, "A red box appeared after backgrounding")
    let transportKnown = app.buttons["Pause"].exists || app.buttons["Play"].exists
    XCTAssertTrue(transportKnown, "Transport lost its Play/Pause state after backgrounding")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
    capture("azure-background-paused", app)
  }
}
