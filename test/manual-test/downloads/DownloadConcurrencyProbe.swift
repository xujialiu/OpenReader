import XCTest

/// Real-touch verification of #64: the Downloads card's "Sentences at once"
/// menu on a Provider page (offered 1-10, chosen with the switch left alone,
/// persisting across a relaunch), and — against the real book `mvs-1-250` in
/// this device's own Library, never the short fixture — that the chosen
/// number actually governs a download, plus the carried-over pause/Pause all/
/// Resume all/playback-interrupt/Manage-downloads-delete checks while several
/// requests are genuinely out at once. Never leaves playback running.
final class DownloadConcurrencyProbe: XCTestCase {

  /// The drawer is the phone's sheet with no close button (#117): a swipe down
  /// from its header puts it away. The drawer rests at the Drawer Height (50 %).
  func closeSheet(_ app: XCUIApplication) {
    let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.52))
    let bottom = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.97))
    top.press(forDuration: 0.15, thenDragTo: bottom)
  }
  // The Library named this entry after its file, "mvs-1-250", until this
  // suite's own first real open retitled it from the EPUB's own metadata —
  // the README's own documented pitfall ("The title `add` gives an entry
  // lasts only until the book's first open"), measured here 2026-09-25.
  let bookTitle = "My Vampire System — Chapters 1–250"
  /// The voice nav.102/nav.103's saved audio already exists under (downloaded
  /// earlier through the CDP-based `download-chapter.cjs`, which calls the
  /// runtime directly and so never ran `library.voiced()`): a fresh real open
  /// of the book has no voice chosen at all ("Choose a voice in the player",
  /// "0 chapters downloaded", even with two chapters actually saved), so
  /// `openDownloadDrawer` picks this one for real with the drawer's own "Use
  /// downloaded voice" link before anything else.
  let voiceLabel = "en/179b5cc736974d96913c7849d0bb68c5"
  /// nav.104: about 95 sentences, never downloaded before this run.
  let newChapterOneTitle = "Chapter 103: Buying from the shop"
  /// nav.105: about 95 sentences, never downloaded before this run.
  let newChapterTwoTitle = "Chapter 104: Combination skills"
  /// The shared two-chapter fixture (README, "Real books"/short-test-fixture.ts):
  /// used for #65 (OpenAI Compatible) and the Speechify queue-width follow-up,
  /// so neither needs the real book's own pre-seeded download state.
  let shortTitle = "A Short Test of Reading Aloud"

  override func setUpWithError() throws {
    // A real assertion failure should stop the method rather than cascade
    // through several more wrong-state steps (AzureProviderProbe, README).
    continueAfterFailure = false
  }

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func ensureAtLibrary(_ app: XCUIApplication) {
    if app.buttons["Back"].waitForExistence(timeout: 3) { app.buttons["Back"].tap() }
  }

  /// Types into whichever kind of field React Native's `secureTextEntry`
  /// produced; fields here start empty. In chunks of ten
  /// (`AzureProviderProbe.clearAndType`'s fix for "typeText with a long value
  /// kills a settings screen", README Pitfalls) — measured here 2026-09-25: a
  /// single `typeText` call on the Address field's `url`-keyboard TextInput
  /// silently dropped five characters mid-string ("https://" arrived as
  /// "h//"), which chunking avoids.
  func type(_ text: String, into field: XCUIElement) {
    field.tap()
    // Idempotent against a field a previous, failed attempt already left
    // text in (the phone's own clear button since #48, README).
    if field.buttons["Clear text"].exists { field.buttons["Clear text"].tap() }
    let characters = Array(text)
    var at = 0
    while at < characters.count {
      let end = min(at + 10, characters.count)
      field.typeText(String(characters[at..<end]))
      at = end
    }
  }

  /// Chips are accessibilityRole="radio", which iOS 27 does not expose as
  /// .radioButton (test/manual-test/README.md, Pitfalls): find by label.
  func chip(_ app: XCUIApplication, _ label: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
  }

  func openProvider(_ app: XCUIApplication, _ label: String) {
    let providersRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Providers'")).firstMatch
    XCTAssertTrue(providersRow.waitForExistence(timeout: 10), "Settings did not show Providers")
    providersRow.tap()
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label + ",")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5), "No \(label) row")
    row.tap()
  }

  func back(_ app: XCUIApplication) { app.navigationBars.buttons.element(boundBy: 0).tap() }

  /// A menu item by its title, any element type (a SwiftUI `Toggle` inside a
  /// `Menu` is not always a `.button` to XCTest — PauseMenuProbe).
  func menuItem(_ app: XCUIApplication, _ title: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", title)).firstMatch
  }

  func sentencesRow(_ app: XCUIApplication) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sentences at once,'")).firstMatch
  }

  static let counts = (1...10).map(String.init)

  /// Every value 1-10 present, in top-to-bottom screen order.
  func assertMenuOrder(_ app: XCUIApplication, _ order: [String], _ context: String) {
    var lastY = -CGFloat.greatestFiniteMagnitude
    for label in order {
      let item = menuItem(app, label)
      XCTAssertTrue(item.waitForExistence(timeout: 3), "\(context): menu is missing '\(label)'")
      XCTAssertGreaterThan(item.frame.origin.y, lastY, "\(context): '\(label)' is not below the previous item")
      lastY = item.frame.origin.y
    }
  }

  /// Items 1-3: the version line, Fish Audio's Downloads card at its own
  /// default (5), the ten-value menu in order, choosing 2 without disturbing
  /// Enabled, Azure's own page still reading 1, and the choice surviving a
  /// real relaunch. Leaves Fish Audio's Sentences at once at 2 — the next
  /// method relies on that to prove the setting, not just the row, drives the
  /// following real download.
  func testSentencesAtOnceSettingsRealTouches() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    ensureAtLibrary(app)

    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 15))
    app.buttons["Settings"].tap()
    XCTAssertTrue(app.staticTexts["Version 0.0.2-beta32"].waitForExistence(timeout: 5), "Settings did not show the version line")
    capture("01-settings-version", app)

    openProvider(app, "Fish Audio")
    XCTAssertTrue(app.staticTexts["Downloads"].waitForExistence(timeout: 5), "No Downloads card on Fish Audio")
    let row = sentencesRow(app)
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    XCTAssertEqual(row.label, "Sentences at once, 5", "Fish Audio's own default is 5")
    XCTAssertTrue(app.staticTexts["Turn off to edit."].waitForExistence(timeout: 5), "Fish Audio must already be enabled")
    capture("02-fish-downloads-card", app)

    row.tap()
    assertMenuOrder(app, Self.counts, "sentences-at-once menu")
    XCTAssertTrue(menuItem(app, "5").isSelected, "5 is Fish Audio's default and should read checked")
    capture("03-sentences-menu-open", app)

    menuItem(app, "2").tap()
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertEqual(sentencesRow(app).label, "Sentences at once, 2")
    XCTAssertTrue(app.staticTexts["Turn off to edit."].exists, "Choosing Sentences at once must not disturb Fish Audio's own enabled state")
    capture("04-sentences-chose-2", app)

    back(app) // Fish -> Providers
    let fishRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Fish Audio,'")).firstMatch
    XCTAssertTrue(fishRow.waitForExistence(timeout: 5))
    XCTAssertEqual(fishRow.label, "Fish Audio, enabled", "Fish Audio must stay enabled")

    let azureRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Azure,'")).firstMatch
    XCTAssertTrue(azureRow.waitForExistence(timeout: 5))
    azureRow.tap()
    let azureSentences = sentencesRow(app)
    XCTAssertTrue(azureSentences.waitForExistence(timeout: 5))
    XCTAssertEqual(azureSentences.label, "Sentences at once, 1", "Azure's own default is 1, unaffected by Fish Audio's change")
    capture("05-azure-sentences-still-1", app)
    back(app) // Azure -> Providers
    back(app) // Providers -> Settings
    back(app) // Settings -> Library

    app.terminate()
    app.launch()
    ensureAtLibrary(app)
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 15))
    app.buttons["Settings"].tap()
    openProvider(app, "Fish Audio")
    let rowAfterRelaunch = sentencesRow(app)
    XCTAssertTrue(rowAfterRelaunch.waitForExistence(timeout: 5))
    XCTAssertEqual(rowAfterRelaunch.label, "Sentences at once, 2", "The chosen value did not survive a relaunch")
    XCTAssertTrue(app.staticTexts["Turn off to edit."].exists, "Fish Audio must still be enabled after relaunch")
    capture("06-persisted-after-relaunch", app)
  }

  func openBook(_ app: XCUIApplication) {
    ensureAtLibrary(app)
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", bookTitle + ",")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10), "No \(bookTitle) row in the Library")
    row.tap()
    if app.buttons["Pause"].waitForExistence(timeout: 10) { app.buttons["Pause"].tap() }
  }

  func openDownloadDrawer(_ app: XCUIApplication) {
    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 10))
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 3))
    app.buttons["Download"].tap()
    // Real touch: pick the voice nav.102/103 are already saved under, offered
    // whenever the drawer's own choice does not already match it. Absent once
    // this run has already switched.
    let useDownloadedVoice = app.buttons.matching(NSPredicate(format: "label == %@", "Use downloaded voice · \(voiceLabel)")).firstMatch
    if useDownloadedVoice.waitForExistence(timeout: 3) {
      useDownloadedVoice.tap()
      Thread.sleep(forTimeInterval: 0.6)
    }
  }

  /// Real drags confined to the chapter list's own frame, found live from the
  /// "chapters downloaded"/"saved" line above it and the footer button below
  /// it — the list has a fixed height (`download-sheet.tsx`, `list: {height:
  /// 330}`) and neither sibling moves while it scrolls, so the anchors stay
  /// valid across the whole scroll. Never the sheet's own drag-to-close (that
  /// gesture lives only on the grip/title row, `sheet.tsx`). `title` is
  /// matched with CONTAINS so it finds the row whichever marker (checkbox,
  /// ring or the done ", downloaded" suffix) it currently carries.
  @discardableResult
  func scrollChapterList(_ app: XCUIApplication, toChapterTitled title: String, maxDrags: Int = 45) -> Bool {
    let target = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
    if target.exists && target.isHittable { return true }
    // The list's own ScrollView, not a sibling: measured 2026-09-25, the
    // "chapters downloaded" line and the footer button sit well outside its
    // frame (list {y:411.7, height:330} against a button at y:792.7), so a
    // drag between those two labels starts and ends outside the ScrollView
    // and never scrolls it — the touch's start point is what gesture
    // arbitration hit-tests, not anything the drag merely passes over.
    let list = app.scrollViews.firstMatch
    guard list.waitForExistence(timeout: 5) else { return false }
    let origin = app.coordinate(withNormalizedOffset: .zero)
    let x = list.frame.midX
    let start = origin.withOffset(CGVector(dx: x, dy: list.frame.maxY - 12))
    let end = origin.withOffset(CGVector(dx: x, dy: list.frame.minY + 12))
    for _ in 0..<maxDrags {
      if target.exists && target.isHittable { return true }
      start.press(forDuration: 0.05, thenDragTo: end)
      Thread.sleep(forTimeInterval: 0.2)
    }
    return target.exists && target.isHittable
  }

  /// The ring on the row titled `title` (`DownloadRingProbe`'s own technique):
  /// a ring's label says what a tap does, not which chapter, so it is found
  /// beside the plain title text at the same height.
  func ring(beside title: String, _ app: XCUIApplication) -> XCUIElement? {
    let names = app.staticTexts.matching(NSPredicate(format: "label == %@", title))
    let rings = app.buttons.matching(NSPredicate(format: "label == 'Pause download' OR label == 'Resume download'"))
    for n in 0..<names.count {
      let name = names.element(boundBy: n).frame
      for r in 0..<rings.count {
        let ringEl = rings.element(boundBy: r)
        if abs(ringEl.frame.midY - name.midY) < 22 && ringEl.frame.minX > name.minX { return ringEl }
      }
    }
    return nil
  }

  func until(_ timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    repeat { if condition() { return true }; Thread.sleep(forTimeInterval: 0.25) } while Date() < deadline
    return false
  }

  /// Item 4: one new chapter, real Download-drawer touches, at whatever
  /// `testSentencesAtOnceSettingsRealTouches` left Fish Audio's Sentences at
  /// once (2). This method makes no timing claim itself — the caller reads
  /// the saved clips' own file birth times from the host afterward, which is
  /// what actually times a download to the millisecond (test/README.md,
  /// "Timing a chapter download on the simulator"); the printed ISO instants
  /// below are only for correlating this run's log with that measurement.
  func testDownloadOneNewChapterAtTwo() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    openBook(app)
    openDownloadDrawer(app)

    XCTAssertTrue(scrollChapterList(app, toChapterTitled: newChapterOneTitle), "Could not scroll to \(newChapterOneTitle)")
    let checkbox = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", newChapterOneTitle)).firstMatch
    XCTAssertTrue(checkbox.exists, "\(newChapterOneTitle) is not an undownloaded checkbox row")
    capture("10-scrolled-to-chapter-103", app)
    checkbox.tap()
    let start = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Download selected ('")).firstMatch
    XCTAssertEqual(start.label, "Download selected (1)")
    capture("11-chapter-103-selected", app)
    start.tap()
    print("REAL BOOK DOWNLOAD START (Sentences at once = 2): \(ISO8601DateFormatter().string(from: Date()))")

    XCTAssertTrue(until(20) { self.ring(beside: self.newChapterOneTitle, app)?.label == "Pause download" }, "Chapter 103 never showed a running ring")
    capture("12-chapter-103-running", app)

    let doneLabel = "\(newChapterOneTitle), downloaded"
    let done = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", doneLabel))
    XCTAssertTrue(done.firstMatch.waitForExistence(timeout: 320), "Chapter 103 did not finish downloading at Sentences at once = 2")
    print("REAL BOOK DOWNLOAD DONE (Sentences at once = 2): \(ISO8601DateFormatter().string(from: Date()))")
    capture("13-chapter-103-done", app)
  }

  /// Item 4's second chapter (Sentences at once back to 5, real touch) and
  /// item 5's carried-over checks, layered onto this same real download so
  /// they are exercised with several requests genuinely out at once: pausing
  /// the chapter's own ring with no failure recorded, Pause all/Resume all,
  /// an at-most-5s real playback interrupting the download and letting it
  /// resume by itself, and Manage downloads deleting the chapter
  /// `testDownloadOneNewChapterAtTwo` just finished.
  func testDownloadSecondChapterAtFiveWithPauseInterruptAndManageDelete() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()

    ensureAtLibrary(app)
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 15))
    app.buttons["Settings"].tap()
    openProvider(app, "Fish Audio")
    let row = sentencesRow(app)
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    XCTAssertEqual(row.label, "Sentences at once, 2", "Expected the value testSentencesAtOnceSettingsRealTouches left")
    row.tap()
    XCTAssertTrue(menuItem(app, "5").waitForExistence(timeout: 3))
    menuItem(app, "5").tap()
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertEqual(sentencesRow(app).label, "Sentences at once, 5")
    capture("20-sentences-back-to-5", app)
    back(app) // Fish -> Providers
    back(app) // Providers -> Settings
    back(app) // Settings -> Library

    openBook(app)
    openDownloadDrawer(app)
    XCTAssertTrue(scrollChapterList(app, toChapterTitled: newChapterTwoTitle), "Could not scroll to \(newChapterTwoTitle)")
    let checkbox = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", newChapterTwoTitle)).firstMatch
    XCTAssertTrue(checkbox.exists, "\(newChapterTwoTitle) is not an undownloaded checkbox row")
    checkbox.tap()
    let start = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Download selected ('")).firstMatch
    XCTAssertEqual(start.label, "Download selected (1)")
    start.tap()
    print("REAL BOOK DOWNLOAD START (Sentences at once = 5): \(ISO8601DateFormatter().string(from: Date()))")

    XCTAssertTrue(until(20) { self.ring(beside: self.newChapterTwoTitle, app)?.label == "Pause download" }, "Chapter 104 never showed a running ring")
    capture("21-chapter-104-running", app)

    // Pausing the chapter's own ring stops it, with no failure. With one
    // chapter in the task, pausing it also pauses the whole task (pausing.ts,
    // tapChapter), so Resume all appears too.
    try XCTUnwrap(ring(beside: newChapterTwoTitle, app)).tap()
    XCTAssertTrue(until(5) { self.ring(beside: self.newChapterTwoTitle, app)?.label == "Resume download" }, "The tapped ring did not turn to Resume download")
    XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Failed'")).firstMatch.exists, "Pausing must not record a failure")
    XCTAssertTrue(app.buttons["Resume all"].waitForExistence(timeout: 5), "With one chapter, pausing its ring pauses the whole task")
    capture("22-chapter-104-paused-by-ring", app)

    // Resume all / Pause all, the whole-task controls.
    app.buttons["Resume all"].tap()
    XCTAssertTrue(until(5) { self.ring(beside: self.newChapterTwoTitle, app)?.label == "Pause download" }, "Resume all did not resume the chapter")
    XCTAssertTrue(app.buttons["Pause all"].waitForExistence(timeout: 5))
    capture("23-resumed-by-resume-all", app)

    app.buttons["Pause all"].tap()
    XCTAssertTrue(until(5) { self.ring(beside: self.newChapterTwoTitle, app)?.label == "Resume download" }, "Pause all did not pause the ring")
    XCTAssertTrue(app.buttons["Resume all"].waitForExistence(timeout: 5))
    capture("24-paused-by-pause-all", app)

    app.buttons["Resume all"].tap()
    XCTAssertTrue(until(5) { self.ring(beside: self.newChapterTwoTitle, app)?.label == "Pause download" }, "Resume all did not resume the chapter a second time")
    capture("25-resumed-again", app)

    // A real, brief playback: the download yields (Interrupted), and resumes by itself.
    closeSheet(app)
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
    let playStarted = Date()
    app.buttons["Play"].tap()
    openDownloadDrawer(app)
    let sawInterrupted = until(3.0) { app.staticTexts["Interrupted · continues when available"].exists }
    capture("26-interrupted-while-playing", app)
    closeSheet(app)
    if app.buttons["Pause"].waitForExistence(timeout: 3) { app.buttons["Pause"].tap() }
    let playedFor = Date().timeIntervalSince(playStarted)
    print("PLAYBACK DURATION: \(playedFor) s; SAW INTERRUPTED WHILE PLAYING: \(sawInterrupted)")

    openDownloadDrawer(app)
    XCTAssertTrue(scrollChapterList(app, toChapterTitled: newChapterTwoTitle), "Could not scroll back to \(newChapterTwoTitle) after the interruption")
    let doneLabel = "\(newChapterTwoTitle), downloaded"
    XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", doneLabel)).firstMatch.waitForExistence(timeout: 320), "Chapter 104 did not finish downloading after the interruption")
    print("REAL BOOK DOWNLOAD DONE (Sentences at once = 5): \(ISO8601DateFormatter().string(from: Date()))")
    capture("27-chapter-104-done-after-interruption", app)

    // Manage downloads can delete a chapter: the one this run already timed (Chapter 103).
    app.buttons["Manage downloads"].tap()
    let manageLabel = "\(newChapterOneTitle), downloaded"
    XCTAssertTrue(scrollChapterList(app, toChapterTitled: newChapterOneTitle), "Could not find Chapter 103 in Manage downloads")
    let manageRow = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", manageLabel)).firstMatch
    XCTAssertTrue(manageRow.exists)
    manageRow.tap()
    let delete = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Delete selected ('")).firstMatch
    XCTAssertEqual(delete.label, "Delete selected (1)")
    capture("29-chapter-103-selected-for-delete", app)
    delete.tap()
    XCTAssertTrue(app.alerts["Delete downloaded audio?"].waitForExistence(timeout: 3))
    app.alerts["Delete downloaded audio?"].buttons["Delete"].tap()
    let stillListed = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", manageLabel))
    XCTAssertTrue(until(5) { !stillListed.firstMatch.exists }, "Chapter 103 should be unlisted in Manage once its audio is deleted")
    capture("30-chapter-103-deleted", app)

    app.buttons["Back from Manage"].tap()
    XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'chapters downloaded'")).firstMatch.waitForExistence(timeout: 5))
    capture("31-final-left-open", app)
    closeSheet(app)
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5) || app.buttons["Play"].waitForExistence(timeout: 5), "Reader did not settle after closing Download")
  }

  // MARK: #65/#64 follow-up — OpenAI Compatible's 422->MP3 fallback and Speechify's RequestQueue, on the short fixture

  /// Item 2: fills a fresh OpenAI Compatible screen from host-only files
  /// (never printed, logged or checked in — same discipline as
  /// `OfflineFixProbe.testConfigureFishProvider`) and enables it for real. The
  /// switch itself runs the connection check (`use-provider-connection.ts`);
  /// before #65 this failed every time with the 422 PCM refusal.
  func testConfigureCompatibleProviderRealTouches() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    ensureAtLibrary(app)

    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 15))
    app.buttons["Settings"].tap()
    XCTAssertTrue(app.staticTexts["Version 0.0.2-beta32"].waitForExistence(timeout: 5), "Settings did not show Version 0.0.2-beta32")
    openProvider(app, "OpenAI Compatible")
    XCTAssertTrue(app.navigationBars["OpenAI Compatible"].waitForExistence(timeout: 5))

    let alreadyEnabled = app.staticTexts["Turn off to edit."].exists
    if !alreadyEnabled {
      let baseURL = (try? String(contentsOfFile: "/tmp/openreader-compat-baseurl.txt", encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      let model = (try? String(contentsOfFile: "/tmp/openreader-compat-model.txt", encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      let headers = (try? String(contentsOfFile: "/tmp/openreader-compat-headers.txt", encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      XCTAssertFalse(baseURL.isEmpty, "Compatible baseURL file was empty or unreadable")
      XCTAssertFalse(model.isEmpty, "Compatible model file was empty or unreadable")
      XCTAssertFalse(headers.isEmpty, "Compatible headers file was empty or unreadable")

      let addressField = app.textFields["Address"]
      XCTAssertTrue(addressField.waitForExistence(timeout: 5), "Address field missing")
      type(baseURL, into: addressField)

      let modelField = app.textFields["Model"]
      XCTAssertTrue(modelField.exists, "Model field missing")
      type(model, into: modelField)

      let headersField = app.textFields["Extra headers"].exists ? app.textFields["Extra headers"] : app.secureTextFields["Extra headers"]
      XCTAssertTrue(headersField.exists, "Extra headers field missing")
      type(headers, into: headersField)
      capture("40-compatible-fields-entered-masked", app)

      let enableSwitch = app.switches["Enable OpenAI Compatible"]
      XCTAssertTrue(enableSwitch.waitForExistence(timeout: 3))
      // With a field still focused, a tap on the switch first only dismisses
      // the keyboard (`keyboardShouldPersistTaps`, OfflineFixProbe's own note
      // that "the switch would never see it"); measured 2026-09-25 that no
      // single tap elsewhere reliably dismissed it first either. Check the
      // switch's own value rather than the keyboard's presence, and tap again
      // if the first tap did not actually toggle it.
      let before = enableSwitch.value as? String
      enableSwitch.tap()
      Thread.sleep(forTimeInterval: 0.4)
      if (enableSwitch.value as? String) == before { enableSwitch.tap() }
      let passed = app.staticTexts["Turn off to edit."].waitForExistence(timeout: 20)
      if !passed {
        let failureNote = app.scrollViews.staticTexts.matching(NSPredicate(
          format: "label == 'Connection successful' OR label BEGINSWITH 'OpenAI' OR label CONTAINS 'Cannot reach' OR label CONTAINS 'HTTP' OR label CONTAINS '\"'"
        )).firstMatch
        print("COMPATIBLE ENABLE FAILURE NOTE: \(failureNote.exists ? failureNote.label : "none found")")
        capture("41-compatible-enable-failed", app)
      }
      XCTAssertTrue(passed, "OpenAI Compatible did not report Enabled after the connection check")
    }
    capture("42-compatible-enabled-masked", app)

    // Extra headers and API key must stay masked throughout (never revealed,
    // "Show API key" never tapped): proven by their not being plain text fields.
    XCTAssertFalse(app.textFields["Extra headers"].exists, "Extra headers must not render as a plain text field")
    XCTAssertFalse(app.textFields["API key"].exists, "API key must not render as a plain text field")
  }

  /// Item 2: chooses the server's `Emily.wav` voice for the short fixture and
  /// establishes only that audio plays and the highlight moves — about 5 s,
  /// two captures apart, then stop at once (AGENTS.md, "The length of a test
  /// comes from what it establishes").
  func testChooseEmilyVoiceAndPlayShortFixture() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    ensureAtLibrary(app)

    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", shortTitle + ",")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10), "No \(shortTitle) row in the Library")
    row.tap()

    let choose = app.buttons["Choose a Voice"]
    if choose.waitForExistence(timeout: 5) {
      choose.tap()
      let compatibleChip = chip(app, "OpenAI Compatible")
      XCTAssertTrue(compatibleChip.waitForExistence(timeout: 5), "No OpenAI Compatible chip in the Voice sheet")
      compatibleChip.tap()
      let multilingual = chip(app, "multilingual")
      XCTAssertTrue(multilingual.waitForExistence(timeout: 10), "No multilingual level for OpenAI Compatible")
      multilingual.tap()
      let emily = app.buttons["Emily.wav"]
      XCTAssertTrue(emily.waitForExistence(timeout: 10), "Emily.wav not offered by the configured server")
      capture("43-compatible-voice-list", app)
      emily.tap()
      XCTAssertTrue(app.buttons["Close Voice"].waitForExistence(timeout: 3))
      app.buttons["Close Voice"].tap()
    } else if app.buttons["Pause"].exists {
      app.buttons["Pause"].tap()
    }

    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
    let playStarted = Date()
    app.buttons["Play"].tap()
    let started = app.buttons["Pause"].waitForExistence(timeout: 15)
    let errorNote = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'HTTP' OR label CONTAINS 'refused' OR label CONTAINS 'Cannot reach' OR label CONTAINS '422'")).firstMatch
    print("COMPATIBLE PLAY ERROR NOTE: \(errorNote.exists ? errorNote.label : "none")")
    capture("44-compatible-playing-1", app)
    XCTAssertTrue(started, "Play never turned into Pause for OpenAI Compatible")
    Thread.sleep(forTimeInterval: 2.4)
    capture("45-compatible-playing-2", app)
    app.buttons["Pause"].tap()
    let playedFor = Date().timeIntervalSince(playStarted)
    print("COMPATIBLE PLAYBACK DURATION: \(playedFor) s")
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
    capture("46-compatible-paused", app)
  }

  /// Item 3: Sentences at once to 5 on OpenAI Compatible's own page, then a
  /// real Select all / Download selected (2) on the short fixture — a fresh
  /// voice directory, never downloaded before this run — with no failure.
  func testCompatibleSentencesAtOnceFiveAndDownloadShortFixture() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    ensureAtLibrary(app)
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 15))
    app.buttons["Settings"].tap()
    openProvider(app, "OpenAI Compatible")
    let row = sentencesRow(app)
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    if row.label != "Sentences at once, 5" {
      row.tap()
      XCTAssertTrue(menuItem(app, "5").waitForExistence(timeout: 3))
      menuItem(app, "5").tap()
      Thread.sleep(forTimeInterval: 0.6)
    }
    XCTAssertEqual(sentencesRow(app).label, "Sentences at once, 5")
    capture("47-compatible-sentences-at-5", app)
    back(app) // OpenAI Compatible -> Providers
    back(app) // Providers -> Settings
    back(app) // Settings -> Library

    let row2 = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", shortTitle + ",")).firstMatch
    XCTAssertTrue(row2.waitForExistence(timeout: 10))
    row2.tap()
    if app.buttons["Pause"].waitForExistence(timeout: 10) { app.buttons["Pause"].tap() }

    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 10))
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 3))
    app.buttons["Download"].tap()

    XCTAssertTrue(app.staticTexts["0 chapters downloaded"].waitForExistence(timeout: 10), "Expected a fresh, undownloaded voice directory for OpenAI Compatible")
    let select = app.buttons["Select all"]
    XCTAssertTrue(select.waitForExistence(timeout: 5))
    select.tap()
    let start = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Download selected ('")).firstMatch
    XCTAssertEqual(start.label, "Download selected (2)")
    capture("48-compatible-selected-both-chapters", app)
    print("COMPATIBLE DOWNLOAD START: \(ISO8601DateFormatter().string(from: Date()))")
    start.tap()

    let complete = app.staticTexts["2 chapters downloaded"]
    XCTAssertTrue(complete.waitForExistence(timeout: 120), "OpenAI Compatible download did not finish with no failure")
    print("COMPATIBLE DOWNLOAD DONE: \(ISO8601DateFormatter().string(from: Date()))")
    capture("49-compatible-download-complete", app)
    XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Failed' OR label CONTAINS 'failed'")).firstMatch.exists, "A failure appeared during the OpenAI Compatible download")

    closeSheet(app)
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5) || app.buttons["Play"].waitForExistence(timeout: 5))
  }

  /// Item 4: Speechify from empty settings, key read from a host-only file.
  /// Confirms Sentences at once still reads its own default, 1 — untouched by
  /// #64's Speechify `RequestQueue` change.
  func testConfigureSpeechifyRealTouches() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    ensureAtLibrary(app)
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 15))
    app.buttons["Settings"].tap()
    openProvider(app, "Speechify")
    XCTAssertTrue(app.navigationBars["Speechify"].waitForExistence(timeout: 5))

    let alreadyEnabled = app.staticTexts["Turn off to edit."].exists
    if !alreadyEnabled {
      let key = (try? String(contentsOfFile: "/tmp/openreader-speechify-key.txt", encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      XCTAssertFalse(key.isEmpty, "Speechify key file was empty or unreadable")
      let field = app.textFields["API key"].exists ? app.textFields["API key"] : app.secureTextFields["API key"]
      XCTAssertTrue(field.waitForExistence(timeout: 5), "API key field missing")
      type(key, into: field)
      let enableSwitch = app.switches["Enable Speechify"]
      XCTAssertTrue(enableSwitch.waitForExistence(timeout: 3))
      // See `testConfigureCompatibleProviderRealTouches`: a tap on the switch
      // while a field is still focused can spend itself dismissing the
      // keyboard instead of toggling the switch, so the switch's own value
      // is checked and it is tapped again if the first tap did not move it.
      let before = enableSwitch.value as? String
      enableSwitch.tap()
      Thread.sleep(forTimeInterval: 0.4)
      if (enableSwitch.value as? String) == before { enableSwitch.tap() }
      let passed = app.staticTexts["Turn off to edit."].waitForExistence(timeout: 20)
      if !passed {
        let failureNote = app.scrollViews.staticTexts.matching(NSPredicate(
          format: "label == 'Connection successful' OR label BEGINSWITH 'Speechify' OR label CONTAINS 'Cannot reach' OR label CONTAINS 'fetch failed' OR label CONTAINS 'HTTP'"
        )).firstMatch
        print("SPEECHIFY ENABLE FAILURE NOTE: \(failureNote.exists ? failureNote.label : "none found")")
        capture("50-speechify-enable-failed", app)
      }
      XCTAssertTrue(passed, "Speechify did not report Enabled after the connection check")
    }
    capture("51-speechify-enabled-masked", app)

    let row = sentencesRow(app)
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    XCTAssertEqual(row.label, "Sentences at once, 1", "Speechify's own default is 1")
    capture("52-speechify-sentences-default-1", app)
  }

  /// Item 4: a real Speechify voice, chosen by real touch, which becomes the
  /// short fixture's own voice and the global default. Sends nothing (a
  /// preference only, while paused).
  ///
  /// `VoiceListProbe`'s own known en-US voice, "Dax — Casual US male (EN)",
  /// is gone from Speechify's own catalog — measured here 2026-09-25: en-US
  /// now lists "Alfonso (male)", "Alicia (female)", … "Emily (female)",
  /// "Erin (female)", … alphabetically, no "Dax" among them (README
  /// Pitfalls). The first row, whichever it is, is enough for this mechanics
  /// check (not a locale/voice-quality pick).
  func testChooseSpeechifyVoiceRealTouches() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    ensureAtLibrary(app)

    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", shortTitle + ",")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10))
    row.tap()
    if app.buttons["Pause"].waitForExistence(timeout: 10) { app.buttons["Pause"].tap() }

    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 5))
    app.buttons["Choose a Voice"].tap()
    let speechifyChip = chip(app, "Speechify")
    XCTAssertTrue(speechifyChip.waitForExistence(timeout: 5), "No Speechify chip in the Voice sheet")
    speechifyChip.tap()
    let enUS = chip(app, "en-US")
    XCTAssertTrue(enUS.waitForExistence(timeout: 15), "No en-US level for Speechify")
    enUS.tap()
    let firstVoice = app.scrollViews.buttons.firstMatch
    XCTAssertTrue(firstVoice.waitForExistence(timeout: 10), "No Speechify en-US voice rows appeared")
    capture("53-speechify-voice-list", app)
    let chosenLabel = firstVoice.label
    print("SPEECHIFY VOICE CHOSEN: \(chosenLabel)")
    firstVoice.tap()
    XCTAssertTrue(app.buttons["Close Voice"].waitForExistence(timeout: 3))
    app.buttons["Close Voice"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
  }

  /// Item 4: a real Select all / Download selected (2) at Sentences at once =
  /// 1 (unchanged), then at most 5 s of real Speechify playback. api.speechify.ai
  /// had network drops from this Mac earlier the same day; a failure here is
  /// reported with whatever note the app showed, not assumed to be the app.
  func testSpeechifyDownloadAndPlayShortFixture() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    ensureAtLibrary(app)

    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", shortTitle + ",")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10))
    row.tap()
    if app.buttons["Pause"].waitForExistence(timeout: 10) { app.buttons["Pause"].tap() }

    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 10))
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 3))
    app.buttons["Download"].tap()
    XCTAssertTrue(app.staticTexts["0 chapters downloaded"].waitForExistence(timeout: 10), "Expected a fresh, undownloaded voice directory for Speechify")
    let select = app.buttons["Select all"]
    XCTAssertTrue(select.waitForExistence(timeout: 5))
    select.tap()
    let start = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Download selected ('")).firstMatch
    XCTAssertEqual(start.label, "Download selected (2)")
    capture("54-speechify-selected-both-chapters", app)
    print("SPEECHIFY DOWNLOAD START: \(ISO8601DateFormatter().string(from: Date()))")
    start.tap()

    let complete = app.staticTexts["2 chapters downloaded"]
    let finishedOK = complete.waitForExistence(timeout: 90)
    if !finishedOK {
      let failureNote = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Failed' OR label CONTAINS 'failed' OR label CONTAINS 'fetch failed' OR label CONTAINS 'network'")).firstMatch
      print("SPEECHIFY DOWNLOAD FAILURE NOTE: \(failureNote.exists ? failureNote.label : "none found, just timed out")")
      capture("55-speechify-download-not-complete", app)
    }
    print("SPEECHIFY DOWNLOAD DONE: \(ISO8601DateFormatter().string(from: Date())) finishedOK=\(finishedOK)")
    XCTAssertTrue(finishedOK, "Speechify download did not finish with no failure")
    capture("55-speechify-download-complete", app)

    closeSheet(app)
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
    let playStarted = Date()
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 15), "Play did not start for Speechify")
    capture("56-speechify-playing", app)
    Thread.sleep(forTimeInterval: 2.5)
    capture("57-speechify-playing-2", app)
    app.buttons["Pause"].tap()
    let playedFor = Date().timeIntervalSince(playStarted)
    print("SPEECHIFY PLAYBACK DURATION: \(playedFor) s")
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
    capture("58-speechify-paused", app)
  }

  /// Item 5, end state: every provider's Sentences at once back to its own
  /// default. Fish is already 5 (this file's first two methods); Speechify
  /// was never changed from 1. Only OpenAI Compatible (set to 5 above) needs
  /// resetting, to 1.
  func testResetCompatibleSentencesAtOnceToDefault() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    ensureAtLibrary(app)
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 15))
    app.buttons["Settings"].tap()
    openProvider(app, "OpenAI Compatible")
    let row = sentencesRow(app)
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    if row.label != "Sentences at once, 1" {
      row.tap()
      XCTAssertTrue(menuItem(app, "1").waitForExistence(timeout: 3))
      menuItem(app, "1").tap()
      Thread.sleep(forTimeInterval: 0.6)
    }
    XCTAssertEqual(sentencesRow(app).label, "Sentences at once, 1", "OpenAI Compatible must end back at its own default")
    capture("59-compatible-sentences-reset-to-1", app)
    back(app) // OpenAI Compatible -> Providers
    back(app) // Providers -> Settings
    back(app) // Settings -> Library
    XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Actions for '")).firstMatch.waitForExistence(timeout: 5), "Did not settle back at the Library")
  }


  /// beta28: Downloads is the last card on Fish Audio's page too (below Voice
  /// sources), and Extra headers has the same eye as the API key. Never taps an
  /// eye, so every capture stays masked; ends on OpenAI Compatible's page.
  func testDownloadsCardLastAndHeadersEye() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
    app.buttons["Settings"].tap()
    openProvider(app, "Fish Audio")
    let sources = app.staticTexts["Voice sources"].firstMatch
    XCTAssertTrue(sources.waitForExistence(timeout: 5))
    app.swipeUp()
    let downloads = app.staticTexts["Downloads"].firstMatch
    XCTAssertTrue(downloads.waitForExistence(timeout: 5))
    XCTAssertGreaterThan(downloads.frame.minY, sources.frame.maxY, "Downloads must sit below Voice sources")
    capture("fish-downloads-last", app)
    back(app)
    let compatible = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'OpenAI Compatible,'")).firstMatch
    XCTAssertTrue(compatible.waitForExistence(timeout: 5))
    compatible.tap()
    XCTAssertTrue(app.buttons["Show Extra headers"].waitForExistence(timeout: 5), "Extra headers has no eye")
    XCTAssertTrue(app.buttons["Show API key"].exists, "API key lost its eye")
    capture("compatible-headers-eye", app)
  }
}
