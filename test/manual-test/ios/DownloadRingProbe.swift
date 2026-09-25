import XCTest

/// Real-touch coverage for #37/#38/#56: Manage downloads listing only chapters
/// with saved audio, the App Store style ring that replaces the selection circle
/// on a chapter that belongs to a running download, and pausing one chapter by
/// its ring or all of them by Pause all. Configures Fish Audio and chooses a
/// Voice from an empty settings the same way `OfflineFixProbe` does (this
/// probe's target container starts with neither), then drives a real
/// two-chapter download: nothing saved, the first ring running, pausing that
/// chapter alone while the second goes on, Pause all, Manage downloads while
/// paused, resuming one chapter by its ring and the rest by Resume all, and
/// completion. `testReopenDownloadDrawer` is a second, independent invocation
/// used only to leave the Download drawer open after a later, unrelated
/// `offline.sh management` pass has backed up, mutated and restored the offline
/// directory (test/README.md, "Offline narration and reader actions").
final class DownloadRingProbe: XCTestCase {
  let shortTitle = "A Short Test of Reading Aloud"

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func type(_ text: String, into field: XCUIElement) {
    field.tap()
    field.typeText(text)
  }

  /// Same touches as `OfflineFixProbe.testConfigureFishProvider`; idempotent
  /// against a provider a previous run already enabled.
  func configureFishIfNeeded(_ app: XCUIApplication) throws {
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
      let keyPath = "/tmp/openreader-fish-key.txt"
      let key = (try? String(contentsOfFile: keyPath, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      XCTAssertFalse(key.isEmpty, "Fish API key file was empty or unreadable at \(keyPath)")
      let field = app.textFields["API key"].exists ? app.textFields["API key"] : app.secureTextFields["API key"]
      XCTAssertTrue(field.waitForExistence(timeout: 5), "API key field not found")
      type(key, into: field)
      let enableSwitch = app.switches["Enable Fish Audio"]
      XCTAssertTrue(enableSwitch.waitForExistence(timeout: 3))
      enableSwitch.tap()
      XCTAssertTrue(app.staticTexts["Enabled"].waitForExistence(timeout: 20), "Fish Audio did not report Enabled after the connection check")
    }
    capture("00-fish-enabled", app)
    // Walk back to the Library by what only the Library has, not by a back
    // button's label: the stack is Library -> Settings -> Providers -> Fish
    // Audio, three levels, and each back button is named after the screen
    // behind it rather than literally "Back" (README, "Back is not what the
    // back button is called").
    let anyLibraryRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Actions for '")).firstMatch
    var backs = 0
    while backs < 4 && !anyLibraryRow.exists {
      let back = app.navigationBars.buttons.element(boundBy: 0)
      guard back.exists else { break }
      back.tap()
      backs += 1
      Thread.sleep(forTimeInterval: 0.6)
    }
    if !anyLibraryRow.waitForExistence(timeout: 2) {
      app.terminate(); app.launch()
      _ = anyLibraryRow.waitForExistence(timeout: 20)
    }
  }

  /// Same touches as `OfflineFixProbe.testChooseVoiceForShortFixture`, without
  /// its own relaunch so it composes with a caller already inside this run.
  func chooseVoiceIfNeeded(_ app: XCUIApplication) throws {
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", shortTitle + ",")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10))
    row.tap()
    let choose = app.buttons["Choose a Voice"]
    if !choose.waitForExistence(timeout: 5) {
      if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
      return
    }
    choose.tap()
    let heading = app.staticTexts.matching(NSPredicate(format: "label == 'Voice'")).firstMatch
    XCTAssertTrue(heading.waitForExistence(timeout: 5))
    let anyVoice = app.buttons.matching(NSPredicate(format: "label CONTAINS ' - '")).firstMatch
    XCTAssertTrue(anyVoice.waitForExistence(timeout: 15), "No Fish voice rows appeared")
    anyVoice.tap()
    app.buttons["Close Voice"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
  }

  func testDownloadRingLifecycle() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()
    try configureFishIfNeeded(app)
    try chooseVoiceIfNeeded(app)

    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 10))
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 3))
    app.buttons["Download"].tap()

    // #37 step 1: nothing saved yet, plain checkboxes, no Manage downloads link.
    XCTAssertTrue(app.staticTexts["0 chapters downloaded"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["Manage downloads"].exists, "Manage downloads must not render with nothing saved and no download running")
    let firstRow = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'The First Chapter'")).firstMatch
    let secondRow = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'The Second Chapter'")).firstMatch
    XCTAssertTrue(firstRow.waitForExistence(timeout: 3))
    XCTAssertTrue(secondRow.exists)
    capture("01-nothing-saved", app)

    // #56: no download, so nothing to pause.
    XCTAssertFalse(app.buttons["Pause all"].exists)

    // #38/#56 step 2: both chapters. They are written from the top of the list
    // down, so the first chapter's ring is the one that runs first.
    let select = app.buttons["Select all"]
    XCTAssertTrue(select.waitForExistence(timeout: 5))
    select.tap()
    let start = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Download selected ('")).firstMatch
    XCTAssertTrue(start.isEnabled)
    start.tap()
    var sawPreparingText = false
    let firstRunning = until(20) {
      if app.staticTexts["Preparing selected chapter…"].exists { sawPreparingText = true }
      return self.ring(beside: "The First Chapter", app)?.label == "Pause download"
    }
    XCTAssertTrue(firstRunning, "The first chapter never showed a running ring")
    XCTAssertTrue(app.buttons["Pause all"].exists, "Pause all belongs opposite Manage downloads while the download runs")
    capture("02-first-running", app)
    // Recorded for the report rather than asserted: the fixture's per-chapter
    // text is counted in well under one poll (README, "The download ring").
    print("SAW PREPARING TEXT BEFORE THE FIRST RING: \(sawPreparingText)")

    // #56 step 3: the first chapter's own ring pauses that chapter alone, and
    // the second goes on. The task line never says Paused.
    try XCTUnwrap(ring(beside: "The First Chapter", app)).tap()
    XCTAssertTrue(until(5) { self.ring(beside: "The First Chapter", app)?.label == "Resume download" }, "The tapped ring did not turn to Resume download")
    if let second = ring(beside: "The Second Chapter", app) {
      XCTAssertEqual(second.label, "Pause download", "Pausing one chapter must not pause the other")
    }
    XCTAssertFalse(app.staticTexts["Paused"].exists)
    for frame in 0..<3 { capture("03-second-running-\(frame)", app); Thread.sleep(forTimeInterval: 0.6) }

    // #56 step 4: Pause all stops the rest; the control then reads Resume all,
    // and nothing else says Paused. The second chapter may already have
    // finished on a fast connection, in which case the download is paused by
    // now and there is nothing left for Pause all.
    if app.buttons["Pause all"].exists { app.buttons["Pause all"].tap() }
    XCTAssertTrue(app.buttons["Resume all"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["Pause download"].exists, "Every ring should read Resume download once all are paused")
    XCTAssertFalse(app.staticTexts["Paused"].exists, "Resume all already says the download is paused")
    capture("04-all-paused", app)

    // #37: Manage downloads while paused lists only chapters with saved audio.
    XCTAssertTrue(app.buttons["Manage downloads"].waitForExistence(timeout: 3))
    app.buttons["Manage downloads"].tap()
    XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'saved'")).firstMatch.waitForExistence(timeout: 3))
    XCTAssertFalse(app.buttons["Resume all"].exists, "Manage downloads keeps Delete all saved audio in that place")
    capture("05-manage-paused", app)
    app.buttons["Back to downloads"].tap()

    // #56 step 5: the first chapter's ring resumes it alone.
    try XCTUnwrap(ring(beside: "The First Chapter", app)).tap()
    XCTAssertTrue(until(5) { self.ring(beside: "The First Chapter", app)?.label == "Pause download" }, "The first chapter did not resume")
    if let second = ring(beside: "The Second Chapter", app) {
      XCTAssertEqual(second.label, "Resume download", "Resuming one chapter must not resume the other")
    }
    capture("06-first-resumed", app)

    // #56 step 6: once the first is written only the paused second is left, so
    // the download is paused and Resume all is what is offered; it finishes the rest.
    let firstDone = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'The First Chapter, downloaded'")).firstMatch
    XCTAssertTrue(firstDone.waitForExistence(timeout: 60))
    if ring(beside: "The Second Chapter", app) != nil {
      XCTAssertTrue(app.buttons["Resume all"].waitForExistence(timeout: 5))
      XCTAssertFalse(app.staticTexts["Paused"].exists)
      capture("07-only-paused-left", app)
      app.buttons["Resume all"].tap()
    }

    // #38 step 7: completion, both chapters checked, no ring and no Pause all or Resume all.
    let complete = app.staticTexts["2 chapters downloaded"]
    XCTAssertTrue(complete.waitForExistence(timeout: 90))
    capture("08-complete", app)
    XCTAssertFalse(app.buttons["Pause download"].exists)
    XCTAssertFalse(app.buttons["Resume download"].exists)
    XCTAssertFalse(app.buttons["Pause all"].exists)
    XCTAssertFalse(app.buttons["Resume all"].exists)

    // #37: Manage downloads after completion lists both chapters as checkboxes.
    app.buttons["Manage downloads"].tap()
    XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == 'The First Chapter, downloaded'")).firstMatch.waitForExistence(timeout: 3))
    XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == 'The Second Chapter, downloaded'")).firstMatch.exists)
    capture("09-manage-complete", app)
    app.buttons["Back to downloads"].tap()
    // Leave the Download drawer open, finished, on the plain (non-Manage) view.
    XCTAssertTrue(app.staticTexts["2 chapters downloaded"].waitForExistence(timeout: 3))
    capture("10-final-left-open", app)
  }

  /// Polls `condition` until it holds or `timeout` passes.
  func until(_ timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    repeat {
      if condition() { return true }
      Thread.sleep(forTimeInterval: 0.25)
    } while Date() < deadline
    return false
  }

  /// The ring on the row titled `title`. A ring's label names what a tap does,
  /// not the chapter, so it is found beside the title: same height, to its
  /// right. The title may also be on the page behind the drawer, hence every
  /// match is tried.
  func ring(beside title: String, _ app: XCUIApplication) -> XCUIElement? {
    let names = app.staticTexts.matching(NSPredicate(format: "label == %@", title))
    let rings = app.buttons.matching(NSPredicate(format: "label == 'Pause download' OR label == 'Resume download'"))
    for n in 0..<names.count {
      let name = names.element(boundBy: n).frame
      for r in 0..<rings.count {
        let ring = rings.element(boundBy: r)
        if abs(ring.frame.midY - name.midY) < 22 && ring.frame.minX > name.minX { return ring }
      }
    }
    return nil
  }

  /// Reopens the Download drawer on the already-downloaded fixture and leaves it
  /// open. Used after a separate `offline.sh management` pass has restored the
  /// offline directory backup and relaunched the app, to put the simulator back
  /// into the required final state without repeating the real download.
  func testReopenDownloadDrawer() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", shortTitle + ",")).firstMatch
    if row.waitForExistence(timeout: 3) { row.tap() }
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 10))
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 3))
    app.buttons["Download"].tap()
    XCTAssertTrue(app.staticTexts["2 chapters downloaded"].waitForExistence(timeout: 10))
    capture("09-reopened-final", app)
  }

  /// Light re-check after `listedInManage` moved into `download-rows.ts` (#37):
  /// no download, no playback, just Downloads and Manage on the already
  /// completed fixture.
  func testManageAfterRowRuleRefactor() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", shortTitle + ",")).firstMatch
    if row.waitForExistence(timeout: 3) { row.tap() }
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 10))
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 3))
    app.buttons["Download"].tap()
    XCTAssertTrue(app.staticTexts["2 chapters downloaded"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == 'The First Chapter, downloaded'")).firstMatch.exists)
    XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == 'The Second Chapter, downloaded'")).firstMatch.exists)
    capture("10-downloads-after-refactor", app)

    app.buttons["Manage downloads"].tap()
    XCTAssertTrue(app.staticTexts["0.4 MB saved"].waitForExistence(timeout: 3))
    let firstRow = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'The First Chapter, downloaded'")).firstMatch
    let secondRow = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'The Second Chapter, downloaded'")).firstMatch
    XCTAssertTrue(firstRow.exists)
    XCTAssertTrue(secondRow.exists)
    let listedRows = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS ', downloaded'"))
    XCTAssertEqual(listedRows.count, 2, "Manage should list exactly the two chapters, nothing else")
    capture("11-manage-after-refactor", app)

    app.buttons["Back to downloads"].tap()
    XCTAssertTrue(app.staticTexts["2 chapters downloaded"].waitForExistence(timeout: 5))
    capture("12-back-to-downloads-after-refactor", app)

    // Settings version, then return to the Download drawer as the required final state.
    app.buttons["Close Download"].tap()
    XCTAssertTrue(app.buttons["Back"].waitForExistence(timeout: 5))
    app.buttons["Back"].tap()
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
    app.buttons["Settings"].tap()
    XCTAssertTrue(app.staticTexts["Version 0.0.2-beta28"].waitForExistence(timeout: 5))
    app.navigationBars.buttons.element(boundBy: 0).tap() // Settings -> Library
    let bookRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", shortTitle + ",")).firstMatch
    XCTAssertTrue(bookRow.waitForExistence(timeout: 10))
    bookRow.tap()
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 10))
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 3))
    app.buttons["Download"].tap()
    XCTAssertTrue(app.staticTexts["2 chapters downloaded"].waitForExistence(timeout: 10))
    capture("13-final-after-refactor", app)
  }
}
