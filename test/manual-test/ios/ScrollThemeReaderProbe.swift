import XCTest

/// Independent #34 verification: real touches against `Scroll Fixture` (dark
/// theme, Font Size 20), covering what `scroll-theme.cjs` cannot — an actual
/// finger fling, a real tap on a word reached only by one, Theme/Appearance
/// applied live to the page, the re-centre risk the content-hook change
/// introduces, and the Download drawer's chapter list. Attaches to the
/// already-open reader with `.activate()` throughout; never `.terminate()`s
/// or `.launch()`es the app, because this device's Debug build is connected
/// to a non-default Metro port via a launch argument that a plain
/// `app.launch()` would not carry (test/manual-test/README.md Pitfalls,
/// "A launch argument points a Debug app at another Metro port"). Only the
/// two playback methods press Play, for six seconds each; run them through
/// `scroll-theme-reader.sh`, which refuses a simulator whose own volume is not
/// zero.
final class ScrollThemeReaderProbe: XCTestCase {
  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  /// `APP_VERSION` as the working tree has it, read from app-version.ts at run
  /// time (same approach as SettingsVersionProbe.workingTreeVersion()).
  func workingTreeVersion() -> String? {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
    guard let text = try? String(contentsOf: root.appendingPathComponent("app-version.ts"), encoding: .utf8),
          let line = text.split(separator: "\n").first(where: { $0.hasPrefix("export const APP_VERSION = ") })
    else { return nil }
    return line.split(separator: "'").dropFirst().first.map(String.init)
  }

  /// The player footer can mount before epub.js has laid the section out.
  /// Wait for the "Laying the document out…" placeholder (the WebView's own
  /// scroll-view accessibility label, an `Other`) to be gone.
  func waitForLayout(_ app: XCUIApplication, timeout: TimeInterval = 30) {
    let loading = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS 'Laying the document out'")).firstMatch
    Thread.sleep(forTimeInterval: 0.6)
    let deadline = Date().addingTimeInterval(timeout)
    while loading.exists && Date() < deadline { Thread.sleep(forTimeInterval: 0.5) }
  }

  @discardableResult
  func waitForReaderReady(_ app: XCUIApplication, timeout: TimeInterval = 40) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if app.buttons["Play"].exists || app.buttons["Choose a Voice"].exists { return true }
      Thread.sleep(forTimeInterval: 0.3)
    }
    return app.buttons["Play"].exists || app.buttons["Choose a Voice"].exists
  }

  func navBack(_ app: XCUIApplication) { app.navigationBars.buttons.element(boundBy: 0).tap() }

  /// A normalized point that lands inside this fixture's dense body-text
  /// paragraphs, not on a heading or between two lines (README Pitfalls: "A
  /// coordinate tap on text does nothing" between lines). Chosen the same way
  /// AlignmentProbe/FontSizeProbe choose theirs, from this run's own screenshots.
  func wordPoint(_ app: XCUIApplication) -> XCUICoordinate {
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
  }

  // MARK: - Item 1 (partial) + item 4 (theme half): Settings version, and
  // Light/Dark switched live on the Scroll Fixture page.
  func testVersionAndThemeLiveOnPage() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    if app.buttons["Back"].waitForExistence(timeout: 5) { app.buttons["Back"].tap() }
    let settings = app.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 15), "Library header did not appear")
    settings.tap()

    guard let expected = workingTreeVersion() else { XCTFail("Could not read APP_VERSION from app-version.ts"); return }
    let version = app.staticTexts["Version \(expected)"]
    XCTAssertTrue(version.waitForExistence(timeout: 5), "No element labelled 'Version \(expected)'")
    capture("01-settings-version", app)

    let general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'General'")).firstMatch
    XCTAssertTrue(general.waitForExistence(timeout: 5))
    general.tap()
    let themeRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Theme,'")).firstMatch
    XCTAssertTrue(themeRow.waitForExistence(timeout: 5), "General has no Theme row")
    themeRow.tap()
    XCTAssertTrue(app.buttons["Light"].waitForExistence(timeout: 3), "Theme menu did not open")
    let initiallyDark = app.buttons["Dark"].isSelected
    let initiallyMatch = app.buttons["Match Device"].isSelected

    func reopenScrollFixture() {
      navBack(app) // General -> Settings
      navBack(app) // Settings -> Library
      let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Scroll Fixture'")).firstMatch
      XCTAssertTrue(book.waitForExistence(timeout: 10), "Scroll Fixture is not on the shelf")
      book.tap()
      XCTAssertTrue(waitForReaderReady(app), "Reader did not become ready")
      if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
      waitForLayout(app)
      // A freshly remounted reader creates a fresh WKWebView. React Native's
      // own "Laying the document out…" placeholder (waitForLayout's signal)
      // clears as soon as epub.js resolves, which can be a beat before WebKit
      // has actually composited a frame to the screen — measured here: two
      // screenshots taken right after waitForLayout returned came back fully
      // blank (page-coloured, no glyphs) although a same-second harness `js`
      // audit found the section's DOM already had its stylesheet and text.
      // Give WebKit's own paint a moment before trusting a screenshot.
      Thread.sleep(forTimeInterval: 2.0)
    }

    app.buttons["Light"].tap()
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: app.buttons["Light"])], timeout: 3), .completed, "Theme menu did not close after Light")
    reopenScrollFixture()
    capture("02-reader-light-theme", app)

    // Back to General > Theme > Dark (and back to the reader) either way, so
    // the device is left in a known theme regardless of what it started in.
    if app.buttons["Back"].waitForExistence(timeout: 5) { app.buttons["Back"].tap() }
    settings.tap()
    general.tap()
    XCTAssertTrue(themeRow.waitForExistence(timeout: 5))
    themeRow.tap()
    XCTAssertTrue(app.buttons["Dark"].waitForExistence(timeout: 3))
    app.buttons["Dark"].tap()
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: app.buttons["Dark"])], timeout: 3), .completed, "Theme menu did not close after Dark")
    reopenScrollFixture()
    capture("03-reader-dark-theme-restored", app)
    _ = (initiallyDark, initiallyMatch) // recorded for the report, not branched on: the brief states the device starts dark
  }

  // MARK: - Item 2: real fast swipes, both directions, several in quick
  // succession, screenshots after each settles.
  func testFastFlingBothDirections() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(waitForReaderReady(app), "Expected an already-open reader")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    waitForLayout(app)
    capture("fling-00-start", app)

    for batch in 1...2 {
      for _ in 0..<5 { app.swipeUp(velocity: .fast) }
      Thread.sleep(forTimeInterval: 1.5) // let epub.js's manager queue settle
      capture("fling-down-batch-\(batch)", app)
    }
    for batch in 1...2 {
      for _ in 0..<5 { app.swipeDown(velocity: .fast) }
      Thread.sleep(forTimeInterval: 1.5)
      capture("fling-up-batch-\(batch)", app)
    }
  }

  // MARK: - Item 3: a real tap on a word in a chapter reached only by a fast
  // fling. Left as the test's final state on purpose, so the Metro log's last
  // `HX … section=` line (read from outside this run) can be matched against
  // the chapter visible in the attached screenshot.
  func testTapWordAfterFling() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(waitForReaderReady(app))
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    waitForLayout(app)
    for _ in 0..<10 { app.swipeUp(velocity: .fast) }
    Thread.sleep(forTimeInterval: 1.5)
    capture("tapword-00-after-fling", app)
    wordPoint(app).tap()
    Thread.sleep(forTimeInterval: 0.8)
    capture("tapword-01-after-tap", app)
  }

  // MARK: - #27: a long run of fast flings, each way, for a screen recording
  // to be read frame by frame for a white page. No screenshots: the recording
  // is the evidence, and a capture would pause the flings it is watching.
  func testLongFlingForRecording() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(waitForReaderReady(app))
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    waitForLayout(app)
    let count = Int(ProcessInfo.processInfo.environment["FLINGS"] ?? "") ?? 15
    for _ in 0..<count { app.swipeUp(velocity: .fast) }
    Thread.sleep(forTimeInterval: 1.0)
    for _ in 0..<count { app.swipeDown(velocity: .fast) }
    Thread.sleep(forTimeInterval: 1.0)
  }

  // MARK: - Item 4 (font-size half): the stepper still reflows this page live.
  func testFontSizeLiveOnPage() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(waitForReaderReady(app))
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    waitForLayout(app)
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
    app.buttons["Appearance"].tap()
    XCTAssertTrue(app.staticTexts["20"].waitForExistence(timeout: 3), "Font Size must start at 20")
    Thread.sleep(forTimeInterval: 0.5)
    capture("fontsize-00-at-20", app)

    let decrease = app.buttons["Decrease font size"]
    let increase = app.buttons["Increase font size"]
    for _ in 0..<4 { decrease.tap() } // 20 -> 16
    XCTAssertTrue(app.staticTexts["16"].waitForExistence(timeout: 2))
    Thread.sleep(forTimeInterval: 0.5)
    capture("fontsize-01-at-16", app)

    for _ in 0..<4 { increase.tap() } // 16 -> 20, restore
    XCTAssertTrue(app.staticTexts["20"].waitForExistence(timeout: 2))
    app.buttons["Close Appearance"].tap()
    Thread.sleep(forTimeInterval: 0.5)
    capture("fontsize-02-restored-20", app)
  }

  // MARK: - Item 5 (first half): select a sentence by tapping while paused,
  // scroll far away, scroll back past it, and capture whether the page jumps
  // back to it. Never presses Play.
  func testHighlightRecenterRisk() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(waitForReaderReady(app))
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    waitForLayout(app)
    wordPoint(app).tap()
    Thread.sleep(forTimeInterval: 0.8)
    capture("recenter-00-selected", app)

    for _ in 0..<20 { app.swipeUp(velocity: .fast) } // several chapters forward
    Thread.sleep(forTimeInterval: 1.5)
    capture("recenter-01-far-away", app)

    for step in 1...4 { // back past the selected sentence, watching for a jump
      for _ in 0..<5 { app.swipeDown(velocity: .fast) }
      Thread.sleep(forTimeInterval: 1.0)
      capture("recenter-02-returning-\(step)", app)
    }
    Thread.sleep(forTimeInterval: 1.0)
    capture("recenter-03-final", app)
  }

  // MARK: - Configures Fish Audio for the optional short playback check below,
  // without OfflineFixProbe.testConfigureFishProvider's `app.terminate();
  // app.launch()` — a bare relaunch drops this device's `-RCT_jsLocation`
  // launch argument and reconnects to whatever Metro its container plist last
  // held (README Pitfalls: measured here, it reconnected to a deleted
  // worktree's server and showed a red ConfigError box; recovered with
  // `xcrun simctl terminate` then `launch … -RCT_jsLocation localhost:8088`
  // from the host, not from inside a test). `.activate()` keeps this run on
  // the same already-connected process throughout.
  func testConfigureFishProviderNoRelaunch() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    if app.buttons["Back"].waitForExistence(timeout: 5) { app.buttons["Back"].tap() }

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
      field.tap()
      field.typeText(key)
      capture("fish-key-entered-masked", app)

      let enableSwitch = app.switches["Enable Fish Audio"]
      XCTAssertTrue(enableSwitch.waitForExistence(timeout: 3))
      enableSwitch.tap()
      // "Turn off to edit." is drawn only once the check has passed; the label
      // reads "Enabled" throughout (#48).
      XCTAssertTrue(app.staticTexts["Turn off to edit."].waitForExistence(timeout: 20), "Fish Audio did not report Enabled after the connection check")
    }
    capture("fish-provider-enabled", app)
  }

  // MARK: - Item 5 (second half): a short, silenced play that crosses a real
  // chapter boundary, to confirm playback keeps working (content-hook sweep on
  // the freshly-displayed next chapter, tap listener, highlight) under the #34
  // change. Starts from wherever the reading was left near a chapter's end
  // (Contents cannot take it there on this fixture; see below) and plays only
  // long enough to cross into the next chapter's first sentence.
  func testShortPlaybackCrossesChapterBoundary() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    // Reuses the position the previous method's tap left the reading on
    // (near a chapter boundary; confirmed by the Library's "Last read" line
    // after a clean relaunch), rather than Contents — Scroll Fixture's own
    // rows cannot be followed (README Pitfalls: epub.js hands its navigation
    // hrefs over with a leading slash, and the spine's have none).
    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Scroll Fixture'")).firstMatch
    if book.waitForExistence(timeout: 8) { book.tap() }
    XCTAssertTrue(waitForReaderReady(app))
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Expected a voice already chosen and Play visible")
    waitForLayout(app)
    Thread.sleep(forTimeInterval: 1.0)
    capture("boundary-00-resumed", app)

    app.buttons["Play"].tap()
    // A real transition to Pause, not just Play reappearing later, is the
    // proof that playback actually started (a stale debug-warning banner
    // covering the transport was found, this run, to swallow a Play tap
    // silently — see README Pitfalls).
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 6), "Play did not start (no Pause button appeared)")
    Thread.sleep(forTimeInterval: 6.0) // enough for a short synthetic sentence or two to cross the boundary
    capture("boundary-01-during-play", app)
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Playback did not pause")
    Thread.sleep(forTimeInterval: 0.5)
    capture("boundary-02-paused", app)
  }

  // MARK: - A same-Utterance retry after a failed Fish request (README
  // Pitfalls: "the first Fish request after a minute or so of quiet fails
  // with 'The network connection was lost'… Play again."). Reuses wherever
  // the previous method's failed attempt left the reading.
  func testRetryPlaybackAfterNetworkFailure() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10))
    capture("retry-00-before", app)
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 6), "Play did not start on retry")
    Thread.sleep(forTimeInterval: 6.0)
    capture("retry-01-during-play", app)
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Playback did not pause")
    Thread.sleep(forTimeInterval: 0.5)
    capture("retry-02-paused", app)
  }

  // MARK: - Item 6: the Download drawer still lists the fixture's chapters.
  // Never downloads anything.
  func testDownloadDrawerListsChapters() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(waitForReaderReady(app))
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 3))
    app.buttons["Download"].tap()
    let countLine = app.staticTexts.matching(NSPredicate(format: "label LIKE '* chapters downloaded'")).firstMatch
    XCTAssertTrue(countLine.waitForExistence(timeout: 15), "Download did not open or list chapters")
    capture("download-01-list-top", app)
    app.swipeUp()
    capture("download-02-list-scrolled", app)
    app.buttons["Close Download"].tap()
  }

  // MARK: - #27 independent verification, against this session's own Library
  // (the owner's book and the short fixture) rather than Scroll Fixture, which
  // this run's Library does not hold. A real tap on the named row, the owner's
  // own trigger for the white flash: the host script starts the screen
  // recording once the Library is already confirmed shown (so the recording
  // holds only the tap and what follows, never Metro's own boot screen), and
  // this method only waits for the row and taps it. No screenshot, so a
  // capture never pauses the transition being recorded.
  func testRealTapOpenForRecording() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let title = ProcessInfo.processInfo.environment["BOOK_TITLE"] ?? "My Vampire System"
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
    var backs = 0
    while backs < 4 && !row.exists && app.buttons["Back"].exists {
      app.buttons["Back"].tap(); backs += 1; Thread.sleep(forTimeInterval: 0.5)
    }
    XCTAssertTrue(row.waitForExistence(timeout: 20), "\(title) row not found in Library")
    row.tap()
    Thread.sleep(forTimeInterval: 2.5)
  }

  // MARK: - #27 independent verification, items 1 and 5: Settings shows the
  // working tree's version, and the light theme on the real book and the
  // short fixture looks as before — white page, black text, white below the
  // fixture's last line — with a live switch back to Dark. Same shape as
  // testVersionAndThemeLiveOnPage, against this session's own Library.
  // "Live" here means without an app relaunch, as that method establishes:
  // Settings and the reader are mutually exclusive on one navigation stack
  // (reaching Settings pops the reader), so the only way to show a theme
  // change on a reader page without a relaunch is to reopen it from the
  // Library right after changing the setting.
  func testVersionAndLightThemeOnRealDocuments() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    if app.buttons["Back"].waitForExistence(timeout: 5) { app.buttons["Back"].tap() }
    let settings = app.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 15), "Library header did not appear")
    settings.tap()

    guard let expected = workingTreeVersion() else { XCTFail("Could not read APP_VERSION from app-version.ts"); return }
    let version = app.staticTexts["Version \(expected)"]
    XCTAssertTrue(version.waitForExistence(timeout: 5), "No element labelled 'Version \(expected)'")
    capture("realdocs-01-settings-version", app)

    let general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'General'")).firstMatch
    XCTAssertTrue(general.waitForExistence(timeout: 5))
    general.tap()
    let themeRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Theme,'")).firstMatch
    XCTAssertTrue(themeRow.waitForExistence(timeout: 5), "General has no Theme row")
    themeRow.tap()
    XCTAssertTrue(app.buttons["Light"].waitForExistence(timeout: 3), "Theme menu did not open")
    app.buttons["Light"].tap()
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: app.buttons["Light"])], timeout: 3), .completed, "Theme menu did not close after Light")
    navBack(app) // General -> Settings
    navBack(app) // Settings -> Library

    func openByTitle(_ title: String) {
      let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
      XCTAssertTrue(book.waitForExistence(timeout: 10), "\(title) is not on the shelf")
      book.tap()
      XCTAssertTrue(waitForReaderReady(app), "Reader did not become ready for \(title)")
      if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
      waitForLayout(app)
      Thread.sleep(forTimeInterval: 2.0)
    }

    openByTitle("My Vampire System")
    capture("realdocs-02-book-light-theme", app)
    navBack(app) // reader -> Library

    openByTitle("Stat Line Fixture")
    // Below the fixture's six lines: a short document may already show its
    // page's end without scrolling; the swipe is a no-op then, harmless.
    app.swipeUp()
    Thread.sleep(forTimeInterval: 1.0)
    capture("realdocs-03-fixture-light-theme-below-lines", app)

    // Restore Dark with this reader open (in the sense established above),
    // and confirm it goes dark without an app relaunch.
    navBack(app) // reader -> Library
    settings.tap()
    general.tap()
    XCTAssertTrue(themeRow.waitForExistence(timeout: 5))
    themeRow.tap()
    XCTAssertTrue(app.buttons["Dark"].waitForExistence(timeout: 3))
    app.buttons["Dark"].tap()
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: app.buttons["Dark"])], timeout: 3), .completed, "Theme menu did not close after Dark")
    navBack(app); navBack(app) // Settings -> Library

    openByTitle("Stat Line Fixture")
    capture("realdocs-04-fixture-dark-theme-restored", app)
  }
}
