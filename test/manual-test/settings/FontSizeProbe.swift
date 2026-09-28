import XCTest

/// Verifies issue #17 / ADR 0030 on the device: the stepper's exact ladder and
/// disabled ends, that the Font and Fonts page still work from Appearance, that
/// a font-size change leaves an existing highlight painted and re-centred, and
/// that Font Size and ordinary reader behaviour hold on the iPad's patched
/// content mode. Never presses Play.
///
/// Two of the Library's sized fixtures (`Sized Fixture Small`/`Sized Fixture
/// Rem`, the "v2" ones referred to in the verification brief) share their
/// title with an older, differently-built fixture of the same name, so a
/// Library row cannot be matched by title alone. Those two Documents are
/// opened by the walkthrough harness's `open` (exact Document Id, the same
/// `navigationRef.navigate('Reader', { id })` a Library tap makes) from
/// outside this file; the methods below then pick up from an already-open
/// reader. Every method that opens `A Short Test of Reading Aloud` or `仙逆`
/// does so with a real tap, since those titles are unique in the Library.
final class FontSizeProbe: XCTestCase {
  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  /// A cold launch can restore the last-viewed Reader (native-stack's own iOS
  /// state restoration) instead of landing on Library. The reader's back
  /// button's accessibility label is exactly "Back" regardless of which
  /// Document it names (observed on-device), so one conditional tap always
  /// returns to Library from there.
  func ensureAtLibrary(_ app: XCUIApplication) {
    if app.buttons["Back"].waitForExistence(timeout: 3) {
      app.buttons["Back"].tap()
    }
  }

  /// The player footer can mount before epub.js has actually laid the section
  /// out (`LibraryActionsProbe`'s Contents note records the same gap for
  /// `status.rendered`), so a tap right after "More actions" appears can land
  /// on an empty page. Wait for the "Laying the document out…" placeholder to
  /// be gone before treating the page as tappable.
  func waitForLayout(_ app: XCUIApplication, timeout: TimeInterval = 30) {
    // This label lives on the WebView's own scroll-view accessibility element
    // ("Horizontal scroll bar, 1 page, Laying the document out…" — observed
    // on-device), an `Other`, not a `staticTexts` element; querying
    // `staticTexts` for it matches nothing and silently never waits.
    let loading = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS 'Laying the document out'")).firstMatch
    // The placeholder itself can take a moment to appear after Play/Choose-a-
    // Voice mounts (a separate, later render pass), so checking `exists` once
    // right away can miss it entirely and return before layout has actually
    // finished. Give it a moment to show up, then poll until it is gone.
    Thread.sleep(forTimeInterval: 0.6)
    let deadline = Date().addingTimeInterval(timeout)
    while loading.exists && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.5)
    }
  }

  /// "More actions" is set on the header as soon as `ReaderScreen` mounts, even
  /// while it is still showing its own "Reading <title>…" placeholder — before
  /// the Document's bytes are read and `ReadingView` (the player footer) exists
  /// at all (34 MB for 仙逆). Waiting on it alone under-waits. The player
  /// footer's Play/Choose-a-Voice button is the honest readiness signal; poll
  /// for it rather than trust a single existence check's timing.
  @discardableResult
  func waitForReaderReady(_ app: XCUIApplication, timeout: TimeInterval = 40) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if app.buttons["Play"].exists || app.buttons["Choose a Voice"].exists { return true }
      Thread.sleep(forTimeInterval: 0.3)
    }
    return app.buttons["Play"].exists || app.buttons["Choose a Voice"].exists
  }

  /// The full ladder in both directions, the disabled ends, the removed reset
  /// line, and that Font/Fonts still work from the same sheet. Leaves the
  /// Appearance sheet open at 16 on purpose: an external theme check runs
  /// against this exact screen before `testCloseAppearanceSheet` closes it.
  func testStepperLadderDisabledEndsAndFontPage() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    ensureAtLibrary(app)
    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'A Short Test of Reading Aloud,'")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10))
    book.tap()
    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 10))
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
    app.buttons["Appearance"].tap()
    XCTAssertTrue(app.staticTexts["Font Size"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.staticTexts["16"].waitForExistence(timeout: 3), "Default Font Size must read 16")
    XCTAssertFalse(app.buttons["Use document appearance"].exists, "#17 removed the reset line")
    XCTAssertFalse(app.staticTexts["Use document appearance"].exists, "#17 removed the reset line's words too")
    capture("stepper-default-16", app)

    let decrease = app.buttons["Decrease font size"]
    let increase = app.buttons["Increase font size"]
    XCTAssertTrue(decrease.isEnabled, "Decrease must start enabled")
    XCTAssertTrue(increase.isEnabled, "Increase must start enabled")

    // 16 -> 12, one step at a time: 15, 14, 13, 12.
    for expect in ["15", "14", "13", "12"] {
      decrease.tap()
      XCTAssertTrue(app.staticTexts[expect].waitForExistence(timeout: 2), "Expected \(expect) after Decrease")
    }
    XCTAssertFalse(decrease.isEnabled, "Decrease must disable at the ladder's low end (12)")
    XCTAssertTrue(increase.isEnabled, "Increase must stay enabled at the low end")
    capture("stepper-min-12", app)

    // 12 -> 32, the exact ladder: 1px to 24, then 2px to 32.
    for expect in ["13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "26", "28", "30", "32"] {
      increase.tap()
      XCTAssertTrue(app.staticTexts[expect].waitForExistence(timeout: 2), "Expected \(expect) after Increase")
    }
    XCTAssertFalse(increase.isEnabled, "Increase must disable at the ladder's high end (32)")
    XCTAssertTrue(decrease.isEnabled, "Decrease must stay enabled at the high end")
    capture("stepper-max-32", app)

    // 32 -> 16, back down the same ladder, restoring the owner's default.
    for expect in ["30", "28", "26", "24", "23", "22", "21", "20", "19", "18", "17", "16"] {
      decrease.tap()
      XCTAssertTrue(app.staticTexts[expect].waitForExistence(timeout: 2), "Expected \(expect) stepping back down")
    }
    capture("stepper-restored-16", app)

    // The Font row and the Fonts page it opens still work from here.
    let fontRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Font, '")).firstMatch
    XCTAssertTrue(fontRow.exists, "Font row must still be present")
    fontRow.tap()
    XCTAssertTrue(app.buttons["Back from Fonts"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.buttons["Original Book Font"].exists)
    capture("fonts-page-still-opens", app)
    app.buttons["Back from Fonts"].tap()
    XCTAssertTrue(app.staticTexts["Font Size"].waitForExistence(timeout: 3), "Back from Fonts must return to Appearance")
    XCTAssertTrue(app.staticTexts["16"].exists, "Size must be unaffected by a visit to Fonts")
    // Deliberately left open here; see the class comment.
  }

  /// Closes the sheet `testStepperLadderDisabledEndsAndFontPage` left open,
  /// after the external light/dark screenshots have been taken against it.
  func testCloseAppearanceSheet() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    if app.buttons["Close Appearance"].waitForExistence(timeout: 5) {
      app.buttons["Close Appearance"].tap()
    }
    capture("appearance-closed", app)
  }

  /// #17/ADR 0030: a tap sets the highlight with no playback, and a font-size
  /// change afterwards leaves it painted and re-centred (`highlighter.ts`'s
  /// 'appearance' case restyles, then calls `settle`/`centre`).
  ///
  /// Uses the short fixture rather than 仙逆: opening 仙逆 from a cold launch
  /// was observed on-device to leave "Laying the document out…" showing for
  /// well over 40 seconds before its first chapter (with an embedded image)
  /// finished laying out, though the player footer (Play/Choose a Voice, this
  /// file's own readiness signal) mounts long before that. The short fixture
  /// has none of that delay and this interaction does not need 仙逆's text.
  func testHighlightPersistsAndRecentersAfterFontSizeChange() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    ensureAtLibrary(app)
    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'A Short Test of Reading Aloud,'")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10))
    book.tap()
    XCTAssertTrue(waitForReaderReady(app), "Reader did not become ready in time")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    waitForLayout(app)
    capture("highlight-before-tap", app)

    // A real coordinate tap on rendered body text: the reading page is a
    // WebView, so individual words are not separately accessible elements.
    // This point (the "This chapter exists…" paragraph under The Second
    // Chapter, near the bottom of the initially-visible text) was chosen
    // from this fixture's own screenshots taken earlier in this run, low
    // enough on the page that an 8-step reflow below has room to show a
    // visible move if `centre()` runs, rather than a one-step change too
    // small to tell from noise.
    let word = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
    word.tap()
    Thread.sleep(forTimeInterval: 0.8)
    capture("highlight-after-word-tap", app)

    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
    app.buttons["Appearance"].tap()
    XCTAssertTrue(app.buttons["Increase font size"].waitForExistence(timeout: 3))
    let increase = app.buttons["Increase font size"]
    for _ in 0..<8 { increase.tap() } // 16 -> 24: a big enough reflow to see re-centring, not just survive it
    app.buttons["Close Appearance"].tap()
    // A font change reflows and re-centres; give the settle frames and the
    // scroll itself time before looking.
    Thread.sleep(forTimeInterval: 1.0)
    capture("highlight-after-font-size-change", app)

    // Restore the owner's Font Size before leaving.
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
    app.buttons["Appearance"].tap()
    XCTAssertTrue(app.buttons["Decrease font size"].waitForExistence(timeout: 3))
    let decrease = app.buttons["Decrease font size"]
    for _ in 0..<8 { decrease.tap() } // 24 -> 16
    app.buttons["Close Appearance"].tap()
    capture("highlight-size-restored", app)
  }

  /// Real touches moving Font Size from 16 to 32, for the cross-Document
  /// page-scaling comparison (#17 item 2). Font Size is the app's setting, not
  /// the open Document's, so whichever Document the harness has already
  /// opened is used as-is.
  func testStepFontSizeUpTo32() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(waitForReaderReady(app), "Expected a reader already open")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
    app.buttons["Appearance"].tap()
    XCTAssertTrue(app.staticTexts["16"].waitForExistence(timeout: 3), "Expected to start from 16")
    let increase = app.buttons["Increase font size"]
    for _ in 0..<16 { increase.tap() }
    XCTAssertTrue(app.staticTexts["32"].waitForExistence(timeout: 3))
    app.buttons["Close Appearance"].tap()
    capture("stepped-to-32", app)
  }

  /// iPad: Font Size and ordinary reader behaviour with the mobile
  /// content-mode patch applied. Opened beforehand by the harness (see the
  /// class comment); starts from an already-open reader at Font Size 16.
  func testFontSizeAndReaderBehaviourOnIPad() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(waitForReaderReady(app), "Harness open did not land in a ready reader")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    waitForLayout(app)
    capture("ipad-reader-16", app)

    // Contents still opens and closes normally at this size.
    XCTAssertTrue(app.buttons["Contents"].exists)
    app.buttons["Contents"].tap()
    XCTAssertTrue(app.buttons["Close Contents"].waitForExistence(timeout: 5))
    capture("ipad-contents-sheet", app)
    app.buttons["Close Contents"].tap()

    // A real word tap sets the highlight here too. This point (the first
    // line of body text) was chosen from this exact fixture's own
    // "ipad-reader-16"/"ipad-after-word-tap" screenshots from an earlier
    // run: a normalized dy of 0.35 landed between two lines (no glyphs
    // there) and produced no highlight, the same line-gap miss found on the
    // iPhone (#17 verification) before that test was corrected the same way.
    let origin = app.coordinate(withNormalizedOffset: .zero)
    let word = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.132))
    word.tap()
    Thread.sleep(forTimeInterval: 0.6)
    capture("ipad-after-word-tap", app)

    // Scrolling/paging still works: a real, slightly slower swipe over the text.
    let start = origin.withOffset(CGVector(dx: app.frame.midX, dy: app.frame.maxY * 0.7))
    let end = origin.withOffset(CGVector(dx: app.frame.midX, dy: app.frame.maxY * 0.3))
    start.press(forDuration: 0.15, thenDragTo: end)
    Thread.sleep(forTimeInterval: 0.4)
    capture("ipad-after-swipe", app)

    // Font Size: a real stepper touch must actually change the drawn size
    // here too (ADR 0030's content-mode patch is what makes this possible).
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
    app.buttons["Appearance"].tap()
    XCTAssertTrue(app.staticTexts["16"].waitForExistence(timeout: 3))
    let increase = app.buttons["Increase font size"]
    for _ in 0..<8 { increase.tap() } // 16 -> 24
    XCTAssertTrue(app.staticTexts["24"].waitForExistence(timeout: 3))
    capture("ipad-appearance-24", app)
    app.buttons["Close Appearance"].tap()
    capture("ipad-body-text-24", app)

    // Restore to 16 before leaving.
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
    app.buttons["Appearance"].tap()
    let decrease = app.buttons["Decrease font size"]
    for _ in 0..<8 { decrease.tap() } // 24 -> 16
    XCTAssertTrue(app.staticTexts["16"].waitForExistence(timeout: 3))
    app.buttons["Close Appearance"].tap()
    capture("ipad-restored-16", app)
  }
}
