import XCTest

/// Real-touch coverage for #37/#38: Manage downloads listing only chapters with
/// saved audio, and the App Store style ring that replaces the selection circle
/// on a chapter that belongs to a running download. Configures Fish Audio and
/// chooses a Voice from an empty settings the same way `OfflineFixProbe` does
/// (this probe's target container starts with neither), then drives a real
/// two-chapter download: nothing saved, the ring appearing and filling, pausing
/// and continuing by tapping the ring itself, Manage downloads while paused, and
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

    // #38 step 2: start the download and watch the first ~10s for the ring.
    let select = app.buttons["Select all"]
    XCTAssertTrue(select.waitForExistence(timeout: 5))
    select.tap()
    let start = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Download selected ('")).firstMatch
    XCTAssertTrue(start.isEnabled)
    start.tap()

    var sawRing = false
    var sawPreparingText = false
    let burstDeadline = Date().addingTimeInterval(10)
    var frame = 0
    while Date() < burstDeadline {
      if app.buttons["Pause download"].firstMatch.exists { sawRing = true }
      if app.staticTexts["Preparing selected chapter…"].exists { sawPreparingText = true }
      capture("02-burst-\(frame)", app)
      frame += 1
      Thread.sleep(forTimeInterval: 0.6)
    }
    XCTAssertTrue(sawRing, "Expected a 'Pause download' ring while the download ran")
    // Recorded for the report rather than asserted: the fixture is small enough
    // that the spinning/preparing phase for either chapter can be shorter than
    // one screenshot interval (test/README.md notes this explicitly).
    print("SAW PREPARING TEXT DURING BURST: \(sawPreparingText)")

    // The old task-line Pause/Continue text link is gone; only the ring toggles.
    XCTAssertFalse(app.buttons["Continue"].exists)

    // #38 step 3: pause via the ring itself, a real touch on the glyph, not a text link.
    let ring = app.buttons["Pause download"].firstMatch
    XCTAssertTrue(ring.waitForExistence(timeout: 30), "No 'Pause download' ring found before the download would have finished")
    let runningRingCount = app.buttons.matching(NSPredicate(format: "label == 'Pause download'")).count
    ring.tap()
    XCTAssertTrue(app.staticTexts["Paused"].waitForExistence(timeout: 5))
    capture("03-paused", app)
    XCTAssertFalse(app.buttons["Pause download"].exists, "Every ring should read Continue download once paused")
    let haltedRingCount = app.buttons.matching(NSPredicate(format: "label == 'Continue download'")).count
    XCTAssertEqual(haltedRingCount, runningRingCount, "Every ring of the paused download should now read Continue download")

    // #37 step 4: Manage downloads while paused lists only chapters with saved audio.
    XCTAssertTrue(app.buttons["Manage downloads"].waitForExistence(timeout: 3))
    app.buttons["Manage downloads"].tap()
    XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'saved'")).firstMatch.waitForExistence(timeout: 3))
    capture("04-manage-paused", app)
    app.buttons["Back to downloads"].tap()

    // Continue by tapping the ring again; best-effort sample of Manage while running.
    let resume = app.buttons["Continue download"].firstMatch
    XCTAssertTrue(resume.waitForExistence(timeout: 5))
    resume.tap()
    if app.buttons["Manage downloads"].waitForExistence(timeout: 2) {
      app.buttons["Manage downloads"].tap()
      capture("05-manage-while-running-attempt", app)
      if app.buttons["Back to downloads"].waitForExistence(timeout: 2) { app.buttons["Back to downloads"].tap() }
    }

    // #38 step 5: completion, both chapters checked, no ring or Pause/Continue left.
    let complete = app.staticTexts["2 chapters downloaded"]
    XCTAssertTrue(complete.waitForExistence(timeout: 90))
    capture("06-complete", app)
    XCTAssertFalse(app.buttons["Pause download"].exists)
    XCTAssertFalse(app.buttons["Continue download"].exists)

    // #37: Manage downloads after completion lists both chapters as checkboxes.
    app.buttons["Manage downloads"].tap()
    XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == 'The First Chapter, downloaded'")).firstMatch.waitForExistence(timeout: 3))
    XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == 'The Second Chapter, downloaded'")).firstMatch.exists)
    capture("07-manage-complete", app)
    app.buttons["Back to downloads"].tap()
    // Leave the Download drawer open, finished, on the plain (non-Manage) view.
    XCTAssertTrue(app.staticTexts["2 chapters downloaded"].waitForExistence(timeout: 3))
    capture("08-final-left-open", app)
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
    XCTAssertTrue(app.staticTexts["Version 0.0.2-beta16"].waitForExistence(timeout: 5))
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
