import XCTest

/// Real-touch coverage for issues #13 and #14 that the existing probes do not
/// reach: configuring Fish Audio from empty settings, downloading the two
/// fixtures used by that verification, and the two "actually confirm the
/// destructive alert" variants of Manage downloads' "Delete all saved audio"
/// and the Library's "Delete this book" (the existing `GeneralFontsProbe` and
/// `LibraryActionsProbe` methods always cancel those alerts by design and are
/// left unchanged). Each method is run as its own `-only-testing` invocation
/// from the shell so host-side sqlite/backup steps can run between them.
final class OfflineFixProbe: XCTestCase {
  let shortTitle = "A Short Test of Reading Aloud"
  let miniTitle = "OpenReader Deletion Fixture"

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  /// Types into whichever kind of field React Native's `secureTextEntry` produced.
  func type(_ text: String, into field: XCUIElement) {
    field.tap()
    field.typeText(text)
  }

  // MARK: - Provider configuration

  /// Reads the key from a host-only file so it never appears in this source file
  /// or in the test's own console output. The field stays masked throughout:
  /// "Show API key" is never tapped, so no screenshot here can reveal it.
  func testConfigureFishProvider() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()

    // A fixed, predictable host path rather than one under a session's own
    // scratchpad directory, so the file only has to be dropped there once
    // per host before this method is run again: `chmod 600` it and never
    // print its contents, log it, or check it in.
    let keyPath = "/tmp/openreader-fish-key.txt"
    let key = (try? String(contentsOfFile: keyPath, encoding: .utf8))?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    XCTAssertFalse(key.isEmpty, "Fish API key file was empty or unreadable at \(keyPath)")

    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
    app.buttons["Settings"].tap()
    let providersRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Providers'")).firstMatch
    XCTAssertTrue(providersRow.waitForExistence(timeout: 5))
    providersRow.tap()

    let fishRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Fish Audio,'")).firstMatch
    XCTAssertTrue(fishRow.waitForExistence(timeout: 5))
    let alreadyEnabled = fishRow.label.contains("enabled") && !fishRow.label.contains("disabled")
    fishRow.tap()

    if !alreadyEnabled {
      let field = app.textFields["API key"].exists ? app.textFields["API key"] : app.secureTextFields["API key"]
      XCTAssertTrue(field.waitForExistence(timeout: 5), "API key field not found")
      // A key left by an earlier run would have this one appended to it.
      field.tap()
      if field.buttons["Clear text"].exists { field.buttons["Clear text"].tap() }
      field.typeText(key)
      capture("fish-key-entered-masked", app)
      // A tap outside the focused field only puts the software keyboard away:
      // the page's ScrollView keeps React Native's default
      // `keyboardShouldPersistTaps`, so the switch would never see it (README).
      if app.keyboards.firstMatch.exists {
        app.staticTexts["Voice sources"].firstMatch.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 3), "The keyboard stayed up")
      }

      let enableSwitch = app.switches["Enable Fish Audio"]
      XCTAssertTrue(enableSwitch.waitForExistence(timeout: 3))
      enableSwitch.tap()
      // The row is labelled "Enabled" whether or not it is (#48); only an
      // enabled provider draws this note.
      XCTAssertTrue(app.staticTexts["Turn off to edit."].waitForExistence(timeout: 20), "Fish Audio did not report Enabled after the connection check")
    }
    capture("fish-provider-enabled", app)
  }

  // MARK: - Choosing a Voice for the first time (ADR 0010: also becomes the default)

  /// Picking any Fish voice is enough for a mechanical download/playback check;
  /// this is not a voice-quality or locale-picker test (`reader.sh fish` already
  /// covers real navigation to a specific locale). Chosen while paused, so the
  /// picker stays open (by design) and is dismissed with the same drag gesture
  /// `ReaderProbe.testReaderSheets` uses. Because a Voice choice becomes the
  /// global default too, doing this once for the short fixture is also what the
  /// mini fixture's own first open inherits.
  func testChooseVoiceForShortFixture() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()

    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", shortTitle + ",")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10))
    row.tap()
    let choose = app.buttons["Choose a Voice"]
    if !choose.waitForExistence(timeout: 5) {
      capture("voice-already-chosen", app)
      return // A previous run already chose one; nothing left to do.
    }
    choose.tap()
    let heading = app.staticTexts.matching(NSPredicate(format: "label == 'Voice'")).firstMatch
    XCTAssertTrue(heading.waitForExistence(timeout: 5))
    let anyVoice = app.buttons.matching(NSPredicate(format: "label CONTAINS ' - '")).firstMatch
    XCTAssertTrue(anyVoice.waitForExistence(timeout: 15), "No Fish voice rows appeared")
    let label = anyVoice.label
    anyVoice.tap()
    XCTAssertTrue(heading.exists, "Choosing must leave Voice open (paused choice)")
    capture("voice-chosen", app)
    print("CHOSE VOICE: \(label)")

    // The sheet's own dismiss control, the same shape as "Close Download"/"Close
    // Appearance" elsewhere: a full-bleed backdrop button rather than a small
    // header glyph, so a plain tap closes it (ReaderProbe's drag gesture tests a
    // second, independent way to do the same thing).
    app.buttons["Close Voice"].tap()
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: heading)], timeout: 3), .completed, "Close Voice did not dismiss the sheet")
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
  }

  // MARK: - Diagnostic: retry a blocked download task in place (no relaunch)

  func testRetryBlockedShortFixture() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let continueLink = app.buttons["Continue"]
    XCTAssertTrue(continueLink.waitForExistence(timeout: 10), "Expected a blocked task showing Continue")
    capture("before-retry", app)
    continueLink.tap()
    let done = app.staticTexts["2 chapters downloaded"]
    let blockedAgain = app.staticTexts["Needs attention"]
    let settled = NSPredicate { _, _ in done.exists || blockedAgain.exists }
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: settled, object: nil)], timeout: 90)
    capture("after-retry", app)
  }

  // MARK: - Downloading the fixtures for real (Fish Audio synthesis)

  func testDownloadShortFixture() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()

    let ellipsis = app.buttons["Actions for " + shortTitle]
    XCTAssertTrue(ellipsis.waitForExistence(timeout: 10))
    ellipsis.tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 5))
    app.buttons["Download"].tap()

    if app.staticTexts["2 chapters downloaded"].waitForExistence(timeout: 3) {
      capture("short-already-downloaded", app)
      return
    }
    let select = app.buttons["Select all"]
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: select)
    XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed)
    select.tap()
    let start = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Download selected ('")).firstMatch
    XCTAssertTrue(start.isEnabled)
    start.tap()
    XCTAssertTrue(app.staticTexts["2 chapters downloaded"].waitForExistence(timeout: 120), "Short fixture did not finish downloading")
    capture("short-fixture-downloaded", app)
  }

  func testDownloadMiniFixture() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()

    let ellipsis = app.buttons["Actions for " + miniTitle]
    XCTAssertTrue(ellipsis.waitForExistence(timeout: 10), "Mini fixture must be present in Library")
    ellipsis.tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 5))
    app.buttons["Download"].tap()

    if app.staticTexts["1 chapters downloaded"].waitForExistence(timeout: 3) {
      capture("mini-already-downloaded", app)
      return
    }
    let select = app.buttons["Select all"]
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: select)
    XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed)
    select.tap()
    let start = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Download selected ('")).firstMatch
    XCTAssertTrue(start.isEnabled)
    start.tap()
    XCTAssertTrue(app.staticTexts["1 chapters downloaded"].waitForExistence(timeout: 60), "Mini fixture did not finish downloading")
    capture("mini-fixture-downloaded", app)
  }

  // MARK: - Check C, part 1: Delete all saved audio, actually confirmed

  func testDeleteAllSavedAudioReal() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()

    let ellipsis = app.buttons["Actions for " + miniTitle]
    XCTAssertTrue(ellipsis.waitForExistence(timeout: 10))
    ellipsis.tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 5))
    app.buttons["Download"].tap()
    XCTAssertTrue(app.buttons["Manage downloads"].waitForExistence(timeout: 10))
    app.buttons["Manage downloads"].tap()

    let savedLine = app.staticTexts.matching(NSPredicate(format: "label LIKE '* saved'")).firstMatch
    XCTAssertTrue(savedLine.waitForExistence(timeout: 5))
    print("MINI saved line before delete: \(savedLine.label)")
    let deleteAll = app.buttons["Delete all saved audio"]
    XCTAssertTrue(deleteAll.waitForExistence(timeout: 3))
    deleteAll.tap()

    let alert = app.alerts["Delete all saved audio?"]
    XCTAssertTrue(alert.waitForExistence(timeout: 3))
    let confirmText = alert.staticTexts.matching(NSPredicate(format: "label CONTAINS 'freeing'")).firstMatch
    XCTAssertTrue(confirmText.exists, "Confirmation must name a size")
    print("MINI confirm text: \(confirmText.label)")
    capture("mini-delete-all-confirm", app)
    alert.buttons["Delete"].tap()

    XCTAssertTrue(app.staticTexts["0 chapters downloaded"].waitForExistence(timeout: 10), "Drawer did not re-request and show 0 chapters downloaded")
    capture("mini-delete-all-done", app)
    // The app must stay usable: closing the drawer and returning to Library works.
    app.buttons["Close Download"].tap()
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 5), "Library was not usable after document removal")
  }

  // MARK: - Check C, part 2: Delete this book, actually confirmed

  func testDeleteThisBookReal() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()

    let ellipsis = app.buttons["Actions for " + miniTitle]
    XCTAssertTrue(ellipsis.waitForExistence(timeout: 10))
    ellipsis.tap()
    let deleteRow = app.buttons["Delete"]
    XCTAssertTrue(deleteRow.waitForExistence(timeout: 5))
    deleteRow.tap()
    let alert = app.alerts["Delete this book?"]
    XCTAssertTrue(alert.waitForExistence(timeout: 3))
    capture("mini-delete-book-confirm", app)
    alert.buttons["Delete"].tap()

    let stillThere = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", miniTitle + ",")).firstMatch
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: stillThere)], timeout: 5), .completed, "Book row must be gone from Library")
    // The app stays usable and the other fixture is unaffected.
    let other = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", shortTitle + ",")).firstMatch
    XCTAssertTrue(other.waitForExistence(timeout: 5), "Other Library document must be unaffected")
    capture("mini-deleted-library", app)
  }

  // MARK: - Check D: the app is not stuck behind a pending background cleanup

  /// Real touches, right after a launch whose store has an interrupted removal
  /// still pending cleanup for a *different* document. Doc-Short's own chapter 2
  /// is still saved, but its reading position starts at chapter 1 (its saved
  /// audio was removed by the earlier chapter-deletion check), so this opens it
  /// with Fish enabled and reads chapter 1 over the network rather than from
  /// disk — the fact being established is only that the reader is not hung
  /// waiting behind the pending cleanup, which is why "Play works promptly" is
  /// enough and no particular audio source is asserted.
  func testReaderRespondsPromptlyAfterInterrupt() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let play = app.buttons["Play"]
    if !play.waitForExistence(timeout: 3) {
      let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", shortTitle + ",")).firstMatch
      XCTAssertTrue(row.waitForExistence(timeout: 10), "Library did not open promptly")
      row.tap()
    }
    XCTAssertTrue(play.waitForExistence(timeout: 10), "Reader did not open promptly")
    let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: play)
    XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 10), .completed, "Play stayed disabled")
    let started = Date()
    play.tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5), "Play did not respond promptly")
    let elapsed = Date().timeIntervalSince(started)
    print("PLAY RESPONDED IN \(elapsed)s")
    capture("prompt-after-interrupt", app)
    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
  }

  // MARK: - Move the reading position into the chapter that still has saved audio

  /// Chapter 1's saved audio was removed by the chapter-deletion check; the
  /// saved-audio-replay probe needs the current position inside chapter 2,
  /// which still has all 7 of its clips. Real touches: Contents, tap the row.
  func testSeekToSecondChapter() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    if !app.buttons["Play"].waitForExistence(timeout: 3) {
      let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", shortTitle + ",")).firstMatch
      XCTAssertTrue(row.waitForExistence(timeout: 10))
      row.tap()
      XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10))
    }
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    app.buttons["Contents"].tap()
    let secondChapter = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'The Second Chapter'")).firstMatch
    XCTAssertTrue(secondChapter.waitForExistence(timeout: 5))
    secondChapter.tap()
    let landed = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'This chapter exists so that a second section'")).firstMatch
    XCTAssertTrue(landed.waitForExistence(timeout: 5), "Did not land in the second chapter")
    capture("seeked-to-second-chapter", app)
  }

  // MARK: - Check E: store failure surfaced in the Download drawer

  /// Real touches only; never presses Play. Run after `PRAGMA user_version = 2`
  /// has been set on the stopped app's store.
  func testDownloadDrawerShowsUpgradeMessage() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()

    let ellipsis = app.buttons["Actions for " + shortTitle]
    XCTAssertTrue(ellipsis.waitForExistence(timeout: 10))
    ellipsis.tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 5))
    app.buttons["Download"].tap()

    let message = app.staticTexts["Update the app to read this offline database."]
    XCTAssertTrue(message.waitForExistence(timeout: 10), "Download drawer did not show the store-upgrade message")
    capture("store-failure-download-drawer", app)
    // Select-all is enabled with nothing selected either way; the authoritative
    // disable is the primary button, which downloads.downloadError() gates.
    let primary = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Download selected ('")).firstMatch
    XCTAssertTrue(primary.waitForExistence(timeout: 5))
    XCTAssertFalse(primary.isEnabled, "Download selected must be disabled while the store cannot be read")
  }

  // MARK: - Check E: reading continues over the network despite the broken store

  /// Real touches: open the Document and press Play. Stops as soon as a second
  /// highlighted word is observed, which is what "the highlight moves" needs.
  func testNetworkReadingHighlightMoves() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()

    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", shortTitle + ",")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10))
    row.tap()

    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 15), "Play control did not appear")
    let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: play)
    XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 10), .completed, "Play stayed disabled")
    play.tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5), "Play did not start (network synthesis did not begin)")
    // Two samples a couple of fixture-sentence-lengths apart. Long enough for a
    // network round trip and at least one word boundary; no longer than needed.
    Thread.sleep(forTimeInterval: 2.5)
    capture("network-reading-sample-1", app)
    Thread.sleep(forTimeInterval: 2.5)
    capture("network-reading-sample-2", app)
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Reader did not pause")
  }
}
