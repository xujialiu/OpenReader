import XCTest

/// Real-touch verification of #48/design 0041's freeze-while-on rule and the
/// remaining risks the settings redesign did not already cover with an
/// existing probe: a provider's failure path with no credentials, a real
/// enable/disable cycle (Fish Audio, from the key in
/// `/tmp/openreader-fish-key.txt`), Sync's refusal path, the Fish Voices field
/// revealed by Manual voices, and a pressed navigation row's edge-to-edge
/// highlight. Written for this verification and kept here for the next time
/// this rule needs a real-touch check. Leaves every provider disabled with no
/// stored key, and Sync empty and off — the same state `design-shots.sh` and
/// `SettingsVersionProbe` leave the app in.
final class ProviderFreezeProbe: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func capture(_ name: String, _ app: XCUIApplication) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func back(_ app: XCUIApplication) {
    app.navigationBars.buttons.element(boundBy: 0).tap()
  }

  func openSettings(_ app: XCUIApplication) {
    if app.buttons["Back"].exists { app.buttons["Back"].tap() }
    let settings = app.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 15), "Library header did not appear")
    settings.tap()
  }

  func openProvider(_ app: XCUIApplication, _ label: String) {
    let providersRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Providers'")).firstMatch
    XCTAssertTrue(providersRow.waitForExistence(timeout: 10), "Settings did not show Providers")
    providersRow.tap()
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label + ",")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5), "No \(label) row")
    row.tap()
  }

  /// Ten characters at a time (typing faster kills a controlled Field, README
  /// Pitfalls), emptied first with the phone's own clear button (#48).
  func clearAndType(_ field: XCUIElement, _ text: String) {
    field.tap()
    let clear = field.buttons["Clear text"]
    if clear.waitForExistence(timeout: 1) { clear.tap() }
    XCTAssertEqual((field.value as? String) ?? "", (field.placeholderValue ?? ""), "The field did not empty")
    guard !text.isEmpty else { return }
    let characters = Array(text)
    var at = 0
    while at < characters.count {
      let end = min(at + 10, characters.count)
      field.typeText(String(characters[at..<end]))
      at = end
    }
  }

  func dismissKeyboard(_ app: XCUIApplication, header: String) {
    if app.keyboards.count > 0 { app.staticTexts.matching(NSPredicate(format: "label == %@", header)).firstMatch.tap() }
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "count == 0"), object: app.keyboards)], timeout: 3)
  }

  /// Whatever sits under the fields card once a check has settled ("Test
  /// connection" enabled again), scoped to the screen's own ScrollView so the
  /// navigation bar's title (also a plain StaticText) is never matched
  /// (README Pitfalls, `AzureProviderProbe`).
  func waitForNote(_ app: XCUIApplication, timeout: TimeInterval = 20) -> String {
    let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == 1"), object: app.buttons["Test connection"])
    _ = XCTWaiter.wait(for: [settled], timeout: timeout)
    let notes = app.scrollViews.staticTexts.allElementsBoundByIndex.map { $0.label }
    return notes.first { $0 != "Enabled" && $0 != "Test connection" && !$0.isEmpty } ?? ""
  }

  /// A tap must not raise a keyboard while a field is locked, and must while
  /// it is not (the same check `GeneralFontsProbe` uses on the bracket field).
  func isLocked(_ app: XCUIApplication, _ field: XCUIElement) -> Bool {
    field.tap()
    Thread.sleep(forTimeInterval: 0.6)
    let locked = app.keyboards.count == 0
    if !locked { dismissKeyboardByReturn(app) }
    return locked
  }

  func dismissKeyboardByReturn(_ app: XCUIApplication) {
    if app.keyboards.buttons["Return"].exists { app.keyboards.buttons["Return"].tap() }
  }

  /// The failure path needs no credentials: a bad OpenAI key and an
  /// unreachable OpenAI Compatible address must each end the switch back off
  /// with a reason under the first card and the fields still editable (#48).
  /// A third, unrelated failure — Sync against an address that cannot
  /// resolve — must do the same: end off, reason shown, fields editable.
  func testFailurePathsNoCredentials() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()

    openSettings(app)
    openProvider(app, "OpenAI")
    Thread.sleep(forTimeInterval: 0.5)
    let openaiKey = app.textFields["API key"].exists ? app.textFields["API key"] : app.secureTextFields["API key"]
    XCTAssertTrue(openaiKey.waitForExistence(timeout: 5), "No OpenAI API key field")
    clearAndType(openaiKey, "sk-bogus-not-a-real-key-0000000000")
    let openaiSwitch = app.switches["Enable OpenAI"]
    XCTAssertTrue(openaiSwitch.waitForExistence(timeout: 5), "No OpenAI enable switch")
    XCTAssertEqual(openaiSwitch.value as? String, "0", "OpenAI must start disabled")
    openaiSwitch.tap()
    let openaiNote = waitForNote(app)
    XCTAssertFalse(openaiNote.isEmpty, "A bad key must leave a reason under the switch card")
    XCTAssertNotEqual(openaiNote, "Connection successful")
    XCTAssertEqual(openaiSwitch.value as? String, "0", "A bad key must not leave OpenAI enabled")
    XCTAssertTrue(openaiKey.isEnabled, "The key field must stay editable after a refusal")
    print("OPENAI refusal note: \(openaiNote)")
    capture("openai-bad-key-refused", app)
    clearAndType(openaiKey, "") // leave OpenAI as found: no stored key
    back(app) // OpenAI -> Providers
    back(app) // Providers -> Settings

    openProvider(app, "OpenAI Compatible")
    Thread.sleep(forTimeInterval: 0.5)
    let address = app.textFields["Address"]
    XCTAssertTrue(address.waitForExistence(timeout: 5), "No Address field")
    clearAndType(address, "https://openreader-test-unreachable.invalid")
    let compatSwitch = app.switches["Enable OpenAI Compatible"]
    XCTAssertTrue(compatSwitch.waitForExistence(timeout: 5), "No OpenAI Compatible enable switch")
    compatSwitch.tap()
    let compatNote = waitForNote(app)
    XCTAssertFalse(compatNote.isEmpty, "An unreachable address must leave a reason under the switch card")
    XCTAssertNotEqual(compatNote, "Connection successful")
    XCTAssertEqual(compatSwitch.value as? String, "0", "An unreachable address must not leave Compatible enabled")
    XCTAssertTrue(address.isEnabled, "The address field must stay editable after a refusal")
    print("COMPATIBLE refusal note: \(compatNote)")
    capture("compatible-unreachable-refused", app)
    clearAndType(address, "") // leave Compatible as found
    back(app) // Compatible -> Providers
    back(app) // Providers -> Settings

    let syncRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sync'")).firstMatch
    XCTAssertTrue(syncRow.waitForExistence(timeout: 5), "No Sync row")
    syncRow.tap()
    let syncAddress = app.textFields["Address"]
    let syncUsername = app.textFields["Username"]
    let syncPassword = app.secureTextFields["Password"]
    XCTAssertTrue(syncAddress.waitForExistence(timeout: 5), "Sync screen did not load")
    clearAndType(syncAddress, "https://openreader-test-unreachable.invalid/dav")
    clearAndType(syncUsername, "tester")
    clearAndType(syncPassword, "anything")
    dismissKeyboard(app, header: "Folder")
    let syncSwitch = app.switches["Keep my place across devices"]
    XCTAssertTrue(syncSwitch.waitForExistence(timeout: 5), "No sync switch")
    syncSwitch.tap()
    let syncSettled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == 1"), object: syncSwitch)
    XCTAssertEqual(XCTWaiter.wait(for: [syncSettled], timeout: 20), .completed, "Sync's switch stayed disabled/busy too long")
    XCTAssertEqual(syncSwitch.value as? String, "0", "An unreachable folder must not leave Sync on")
    let syncNotes = app.scrollViews.staticTexts.allElementsBoundByIndex.map { $0.label }
    // "Folder" is the second card's own title, always present once the Folder
    // group renders, and must not be read as the switch card's refusal text
    // (measured 2026-09-23: an earlier version of this method did exactly
    // that, because it excluded only the switch's own label).
    let syncNote = syncNotes.first { $0 != "Keep my place across devices" && $0 != "Folder" && !$0.isEmpty } ?? ""
    XCTAssertFalse(syncNote.isEmpty, "A folder check failure must leave a reason under the switch card")
    print("SYNC refusal note: \(syncNote)")
    capture("sync-unreachable-refused", app)
    XCTAssertTrue(syncAddress.isEnabled, "Sync's fields must stay editable after a refusal")
    // Leave Sync empty and off, as found.
    clearAndType(syncAddress, "")
    clearAndType(syncUsername, "")
    clearAndType(syncPassword, "")
    dismissKeyboard(app, header: "Folder")
    XCTAssertEqual(syncSwitch.value as? String, "0")
    back(app) // Sync -> Settings
  }

  /// A real enable needs a key; Fish Audio's is in `/tmp/openreader-fish-key.txt`
  /// (never printed, logged, or checked in — the caller writes it from
  /// `~/.secrets/openreader/`, `chmod 600`s it, and removes it afterward,
  /// AGENTS.md). Covers the Voices field's placeholder and keyboard
  /// clearance (while unlocked, before enabling — the whole Voice sources
  /// card freezes with the rest once Fish is enabled), the enable/disable
  /// freeze cycle, the eye toggle's existence (never tapped, so no capture
  /// here can show the key), and the Providers/Settings counts. Ends with
  /// Fish disabled and no stored key.
  func testFishVoicesFieldAndEnableDisableCycle() throws {
    guard let key = try? String(contentsOfFile: "/tmp/openreader-fish-key.txt", encoding: .utf8), !key.isEmpty else {
      throw XCTSkip("No /tmp/openreader-fish-key.txt; write the Fish key there to run this test")
    }

    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()

    openSettings(app)
    let providersRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Providers'")).firstMatch
    XCTAssertTrue(providersRow.waitForExistence(timeout: 10))
    XCTAssertEqual(providersRow.label, "Providers, 0 enabled", "Providers must start at the baseline this test restores")
    openProvider(app, "Fish Audio")
    Thread.sleep(forTimeInterval: 0.5)

    // --- Voices field, while unlocked ---
    let manualVoices = app.switches["Manual voices"]
    XCTAssertTrue(manualVoices.waitForExistence(timeout: 5), "No Manual voices switch")
    XCTAssertFalse(app.textViews["Voices"].exists || app.textFields["Voices"].exists, "Voices must be hidden until Manual voices is on")
    manualVoices.tap()
    let voices = app.textFields["Voices"].exists ? app.textFields["Voices"] : app.textViews["Voices"]
    XCTAssertTrue(voices.waitForExistence(timeout: 3), "Voices did not appear once Manual voices turned on")
    XCTAssertEqual(voices.placeholderValue, "IDs or links, separated by spaces or commas")
    capture("fish-voices-field-revealed", app)
    voices.tap()
    voices.typeText("test-voice-id")
    XCTAssertTrue(app.keyboards.count > 0, "Typing into Voices must raise the keyboard")
    XCTAssertTrue(voices.isHittable, "The Voices field must stay reachable above the keyboard")
    capture("fish-voices-field-above-keyboard", app)
    clearAndType(voices, "")
    dismissKeyboardByReturn(app)
    manualVoices.tap() // back off: restore the baseline (Manual voices off)
    XCTAssertEqual(manualVoices.value as? String, "0")

    // --- The real enable ---
    let apiKey = app.textFields["API key"].exists ? app.textFields["API key"] : app.secureTextFields["API key"]
    XCTAssertTrue(apiKey.waitForExistence(timeout: 5), "No Fish API key field")
    clearAndType(apiKey, key)
    XCTAssertTrue(app.buttons["Show API key"].exists, "The API key row must offer the eye toggle") // never tapped: no capture can then show the key
    let fishSwitch = app.switches["Enable Fish Audio"]
    XCTAssertTrue(fishSwitch.waitForExistence(timeout: 5))
    XCTAssertEqual(fishSwitch.value as? String, "0", "Fish Audio must start disabled")
    fishSwitch.tap()
    // Best-effort: catch "Testing…" while the check is in flight. Not fatal if
    // a fast reply is already past it by the time this polls.
    if app.staticTexts["Testing…"].waitForExistence(timeout: 2) {
      XCTAssertFalse(app.buttons["Test connection"].isEnabled, "Test connection must be disabled while Testing…")
      print("Caught the Testing… state live")
    } else {
      print("Testing… was not caught live (the check may have already settled)")
    }
    let note = waitForNote(app)
    XCTAssertEqual(note, "Connection successful", "A real key must be accepted")
    XCTAssertTrue(app.staticTexts["Turn off to edit."].waitForExistence(timeout: 5), "Fish Audio did not report Enabled")
    XCTAssertEqual(fishSwitch.value as? String, "1")
    capture("fish-enabled-masked", app)
    XCTAssertTrue(isLocked(app, apiKey), "The key field must lock once enabled")
    XCTAssertFalse(manualVoices.isEnabled, "The whole Voice sources card must freeze with the rest once enabled")

    back(app) // Fish -> Providers
    let fishRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Fish Audio,'")).firstMatch
    XCTAssertTrue(fishRow.waitForExistence(timeout: 5))
    XCTAssertEqual(fishRow.label, "Fish Audio, enabled")
    capture("providers-fish-checked", app)
    back(app) // Providers -> Settings
    XCTAssertTrue(providersRow.waitForExistence(timeout: 5))
    XCTAssertEqual(providersRow.label, "Providers, 1 enabled")
    capture("settings-one-enabled", app)

    // --- Disable again: leave Fish as found ---
    providersRow.tap()
    let fishRow2 = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Fish Audio,'")).firstMatch
    XCTAssertTrue(fishRow2.waitForExistence(timeout: 5))
    fishRow2.tap()
    let fishSwitch2 = app.switches["Enable Fish Audio"]
    XCTAssertTrue(fishSwitch2.waitForExistence(timeout: 5))
    fishSwitch2.tap()
    XCTAssertEqual(fishSwitch2.value as? String, "0")
    XCTAssertFalse(app.staticTexts["Turn off to edit."].exists, "The frozen note must go once disabled")
    let apiKey2 = app.textFields["API key"].exists ? app.textFields["API key"] : app.secureTextFields["API key"]
    XCTAssertFalse(isLocked(app, apiKey2), "The key field must unlock once disabled")
    clearAndType(apiKey2, "") // leave Fish as found: no stored key
    back(app) // Fish -> Providers
    let fishRow3 = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Fish Audio,'")).firstMatch
    XCTAssertTrue(fishRow3.waitForExistence(timeout: 5))
    XCTAssertEqual(fishRow3.label, "Fish Audio, disabled")
    back(app) // Providers -> Settings
    XCTAssertTrue(providersRow.waitForExistence(timeout: 5))
    XCTAssertEqual(providersRow.label, "Providers, 0 enabled")
  }

  /// Recovery + investigation: `testFishVoicesFieldAndEnableDisableCycle`
  /// failed its "Voice sources must freeze" assertion and left Fish enabled
  /// with a real key stored (state read from the device, not assumed). This
  /// starts from that same live state, tells apart a real unlocked switch
  /// from an accessibility trait XCTest reads wrong (a disabled `UISwitch`
  /// ignores a tap outright, so the functional test is the value after
  /// tapping, not `.isEnabled`), then disables Fish and clears the key so the
  /// device ends as found.
  func testVoiceSourcesLockIsFunctionalThenCleanUp() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    openSettings(app)
    openProvider(app, "Fish Audio")
    Thread.sleep(forTimeInterval: 0.5)

    let fishSwitch = app.switches["Enable Fish Audio"]
    XCTAssertTrue(fishSwitch.waitForExistence(timeout: 5))
    XCTAssertEqual(fishSwitch.value as? String, "1", "Expected Fish Audio already enabled from the interrupted run")

    let manualVoices = app.switches["Manual voices"]
    XCTAssertTrue(manualVoices.waitForExistence(timeout: 5))
    let before = manualVoices.value as? String
    print("Manual voices value before tap: \(before ?? "?"), isEnabled trait: \(manualVoices.isEnabled)")
    manualVoices.tap()
    Thread.sleep(forTimeInterval: 0.5)
    let after = manualVoices.value as? String
    print("Manual voices value after tap: \(after ?? "?")")
    if after != before {
      // A real unlock: put it back, and record this as a functional finding
      // rather than an accessibility-trait artifact.
      manualVoices.tap()
      XCTFail("Manual voices actually toggled while Fish Audio was enabled (before=\(before ?? "?"), after=\(after ?? "?")) — the Voice sources card is not functionally locked, only visually dimmed")
    } else {
      print("Confirmed: tapping Manual voices while enabled did not change its value — functionally locked despite isEnabled reading true")
    }
    capture("voice-sources-lock-check", app)

    // Clean up regardless of the outcome above: disable Fish and clear the key.
    fishSwitch.tap()
    XCTAssertEqual(fishSwitch.value as? String, "0")
    XCTAssertFalse(app.staticTexts["Turn off to edit."].exists)
    let apiKey = app.textFields["API key"].exists ? app.textFields["API key"] : app.secureTextFields["API key"]
    XCTAssertTrue(apiKey.waitForExistence(timeout: 5))
    clearAndType(apiKey, "")
    back(app) // Fish -> Providers
    let fishRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Fish Audio,'")).firstMatch
    XCTAssertTrue(fishRow.waitForExistence(timeout: 5))
    XCTAssertEqual(fishRow.label, "Fish Audio, disabled")
    back(app) // Providers -> Settings
    let providersRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Providers'")).firstMatch
    XCTAssertTrue(providersRow.waitForExistence(timeout: 5))
    XCTAssertEqual(providersRow.label, "Providers, 0 enabled")
  }

  /// Sync's refusal path alone, waiting for the check to actually **begin**
  /// (the switch's own `isEnabled` going false) before waiting for it to
  /// settle back — `testFailurePathsNoCredentials`'s combined run raced this
  /// (asserted `isEnabled == 1` right after `.tap()`, which can already be
  /// true from before React processed the tap) and read the "Folder" card
  /// title as the refusal note because no refusal note had rendered yet.
  func testSyncRefusalPathAlone() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    openSettings(app)
    let syncRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sync'")).firstMatch
    XCTAssertTrue(syncRow.waitForExistence(timeout: 10))
    syncRow.tap()
    let syncAddress = app.textFields["Address"]
    let syncUsername = app.textFields["Username"]
    let syncPassword = app.secureTextFields["Password"]
    XCTAssertTrue(syncAddress.waitForExistence(timeout: 5))
    clearAndType(syncAddress, "https://openreader-test-unreachable.invalid/dav")
    dismissKeyboard(app, header: "Folder")
    let syncSwitch = app.switches["Keep my place across devices"]
    XCTAssertTrue(syncSwitch.waitForExistence(timeout: 5))
    XCTAssertEqual(syncSwitch.value as? String, "0")

    syncSwitch.tap()
    let began = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == 0"), object: syncSwitch)
    print("Checking began (switch disabled): \(XCTWaiter.wait(for: [began], timeout: 5) == .completed)")
    let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == 1"), object: syncSwitch)
    let settledResult = XCTWaiter.wait(for: [settled], timeout: 30)
    print("Settled: \(settledResult == .completed ? "completed" : "TIMED OUT after 30s")")
    XCTAssertEqual(settledResult, .completed, "The folder check did not settle within 30s")
    XCTAssertEqual(syncSwitch.value as? String, "0", "An unreachable folder must not leave Sync on")
    let notes = app.scrollViews.staticTexts.allElementsBoundByIndex.map { $0.label }
    let note = notes.first { $0 != "Keep my place across devices" && $0 != "Folder" && !$0.isEmpty && $0 != "Checking the folder…" } ?? ""
    print("SYNC refusal note: \(note)")
    capture("sync-unreachable-refused-alone", app)
    XCTAssertFalse(note.isEmpty, "A folder check failure must leave a reason under the switch card")
    XCTAssertTrue(syncAddress.isEnabled, "Sync's fields must stay editable after a refusal")

    clearAndType(syncAddress, "")
    clearAndType(syncUsername, "")
    clearAndType(syncPassword, "")
    dismissKeyboard(app, header: "Folder")
    XCTAssertEqual(syncSwitch.value as? String, "0")
    back(app)
  }

  /// A visual spot-check at a large Dynamic Type size (set by the caller with
  /// `xcrun simctl ui UDID content_size extra-extra-large` before this runs,
  /// and restored after): the measured label column (`FieldRow`'s `onLayout`)
  /// must not clip a label or a value once text is larger. Captures only;
  /// judged by eye against `design-shots-01`'s default-size captures.
  func testDynamicTypeSpotCheck() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    openSettings(app)
    capture("large-type-settings-root", app)
    openProvider(app, "Fish Audio")
    Thread.sleep(forTimeInterval: 0.5)
    capture("large-type-provider-fish", app)
    back(app) // Fish -> Providers
    back(app) // Providers -> Settings
    let syncRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sync'")).firstMatch
    XCTAssertTrue(syncRow.waitForExistence(timeout: 5))
    syncRow.tap()
    XCTAssertTrue(app.textFields["Address"].waitForExistence(timeout: 5))
    capture("large-type-sync", app)
    back(app) // Sync -> Settings
    let providersRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Providers'")).firstMatch
    XCTAssertTrue(providersRow.waitForExistence(timeout: 5))
    providersRow.tap()
    openProvider2(app, "OpenAI Compatible")
    XCTAssertTrue(app.textFields["Address"].waitForExistence(timeout: 5))
    capture("large-type-provider-compatible", app) // longest label + longest placeholder together
  }

  /// `openProvider` re-opens Providers from Settings; this variant is for when
  /// Providers is already on screen.
  func openProvider2(_ app: XCUIApplication, _ label: String) {
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label + ",")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5), "No \(label) row")
    row.tap()
  }

  /// Walks back to the Library from wherever the app was left, by whatever is
  /// on the nav bar's leading button, a bounded number of times (every back
  /// button is labelled `Back` since #48 — README Pitfalls).
  func testReturnToLibrary() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.launch()
    for _ in 0..<6 {
      if app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Actions for '")).firstMatch.exists { break }
      if app.buttons["Back"].exists { app.buttons["Back"].tap(); continue }
      let leading = app.navigationBars.buttons.element(boundBy: 0)
      if leading.exists { leading.tap() } else { break }
      Thread.sleep(forTimeInterval: 0.3)
    }
    capture("final-library", app)
  }

  /// A pressed `NavigationRow` must highlight edge to edge (design 0041). A
  /// mid-hold screenshot taken from a background queue while the main thread
  /// is inside `press(forDuration:)`, rather than a video recording, since
  /// XCTest's own screenshot API does not need the main thread free.
  func testPressedRowHighlightsEdgeToEdge() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    openSettings(app)
    let providersRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Providers'")).firstMatch
    XCTAssertTrue(providersRow.waitForExistence(timeout: 10))

    let captured = expectation(description: "mid-press screenshot taken")
    var midPress: XCUIScreenshot?
    DispatchQueue.global().asyncAfter(deadline: .now() + 1.0) {
      midPress = XCUIScreen.main.screenshot()
      captured.fulfill()
    }
    providersRow.press(forDuration: 2.0)
    wait(for: [captured], timeout: 5)
    if let shot = midPress {
      let image = XCTAttachment(screenshot: shot)
      image.name = "settings-row-pressed"; image.lifetime = .keepAlways; add(image)
    } else {
      XCTFail("Did not capture a mid-press screenshot")
    }
    capture("settings-root-after-press-released", app)
  }
}
