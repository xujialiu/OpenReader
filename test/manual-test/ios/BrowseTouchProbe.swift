import XCTest

/// Real touches for #52: while the reading is paused, choosing a chapter in
/// Contents only moves the page (Browsing); a tap on a sentence still moves the
/// reading; a finger drag is Browsing too; and a chapter chosen while playing,
/// or in a book with no place yet, keeps today's behaviour.
///
/// `browse-probe.cjs` already covers the React Native and WebView halves by
/// calling `reading.goToSection` itself; what it cannot do is a real Contents
/// row tap, a real sentence tap, or a real finger drag, which is what these
/// methods add (test/manual-test/README.md, "A Contents row while paused only
/// moves the page (#52)"). A companion host script, `browse-touch-state.cjs`,
/// reads the same status line, Library place and painted highlights
/// `browse-probe.cjs` does, run from the shell immediately before and after
/// each method so a real touch's effect can be diffed the same way.
///
/// `.activate()` only, never `.terminate()/.launch()`: the methods depend on
/// each other's state (which chapter the reading is in, where the page is),
/// the same shape as `ScrollThemeReaderProbe`, and run in the order below.
/// This device's Debug app reaches this worktree's Metro through its container
/// plist rather than a launch argument, so either form would reach the right
/// Metro — `.activate()` is chosen only to keep the app's in-memory state.
final class BrowseTouchProbe: XCTestCase {
  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  /// From wherever the last method left the app to the Library. Every back
  /// button reads "Back" since #48, whatever screen is behind it.
  func ensureAtLibrary(_ app: XCUIApplication) {
    if app.buttons["Back"].exists { app.buttons["Back"].tap() }
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 15), "Library header did not appear")
  }

  @discardableResult
  func waitForReaderReady(_ app: XCUIApplication, timeout: TimeInterval = 40) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if app.buttons["Play"].exists || app.buttons["Pause"].exists { return true }
      Thread.sleep(forTimeInterval: 0.3)
    }
    return app.buttons["Play"].exists || app.buttons["Pause"].exists
  }

  /// The player footer can exist before epub.js has laid the section out
  /// (FontSizeProbe's own note on the same gap). Wait for the WebView's own
  /// scroll-view placeholder, an `Other`, to be gone.
  func waitForLayout(_ app: XCUIApplication, timeout: TimeInterval = 30) {
    let loading = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS 'Laying the document out'")).firstMatch
    Thread.sleep(forTimeInterval: 0.6)
    let deadline = Date().addingTimeInterval(timeout)
    while loading.exists && Date() < deadline { Thread.sleep(forTimeInterval: 0.5) }
  }

  /// A normalized point inside this book's dense body-text paragraphs, well
  /// below a chapter's own heading line (PausedTransportProbe's `wordPoint`
  /// uses 0.35 against an ordinary mid-chapter page; a page freshly browsed to
  /// a chapter's top shows the heading first, so this sits lower to clear it).
  func bodyPoint(_ app: XCUIApplication) -> XCUICoordinate {
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55))
  }

  /// `"Chapter 2018: Entering the Starry Sky"` -> `2018`; `"Chapter 1751
  /// Embroidery"` (the second book's own EPUB source has no colon) -> `1751`.
  /// The number is whatever digits directly follow "Chapter ", however the rest
  /// of the row is punctuated. Nil for a row that is not a numbered chapter (a
  /// volume's own title page, say).
  func chapterNumber(_ label: String) -> Int? {
    guard label.hasPrefix("Chapter ") else { return nil }
    let rest = label.dropFirst("Chapter ".count)
    let digits = rest.prefix { $0.isNumber }
    return digits.isEmpty ? nil : Int(digits)
  }

  /// The Contents row marked as the reading's own chapter (`isSelected`, the
  /// same trait `ReaderProbe` reads off a chosen Voice). Contents must already
  /// be open.
  func currentChapterRow(_ app: XCUIApplication) -> (button: XCUIElement, number: Int)? {
    for button in app.buttons.matching(NSPredicate(format: "isSelected == YES")).allElementsBoundByIndex {
      if let n = chapterNumber(button.label) { return (button, n) }
    }
    return nil
  }

  /// The first "Chapter " row at least `delta` chapters after `from`, nearest
  /// the top of the list. Contents must already be open. Filtering to rows
  /// whose label parses as a chapter (not a volume heading) and comparing
  /// numbers, rather than counting rows, is what makes "two or more chapters
  /// after" hold even if a heading row sits between them.
  func chapterRow(after from: Int, plus delta: Int, in app: XCUIApplication) -> (button: XCUIElement, number: Int)? {
    let candidates = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Chapter '")).allElementsBoundByIndex
      .compactMap { button -> (XCUIElement, Int)? in chapterNumber(button.label).map { (button, $0) } }
      .filter { $0.1 >= from + delta }
      .sorted { $0.0.frame.minY < $1.0.frame.minY }
    return candidates.first
  }

  /// The `n`th (1-based) "Chapter " row from the top of whatever Contents has
  /// rendered, for the unread book where nothing is marked current yet.
  func nthChapterRow(_ n: Int, in app: XCUIApplication) -> (button: XCUIElement, number: Int)? {
    let rows = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Chapter '")).allElementsBoundByIndex
      .compactMap { button -> (XCUIElement, Int)? in chapterNumber(button.label).map { (button, $0) } }
      .sorted { $0.0.frame.minY < $1.0.frame.minY }
    return rows.count >= n ? rows[n - 1] : nil
  }

  /// Waits for the Contents sheet to be gone (it closes itself on a row tap;
  /// `contents-sheet.tsx`'s `onPress` calls `onClose()` right after `onGo`).
  func waitContentsClosed(_ app: XCUIApplication, timeout: TimeInterval = 5) {
    let title = app.staticTexts["Contents"].firstMatch
    let deadline = Date().addingTimeInterval(timeout)
    while title.exists && Date() < deadline { Thread.sleep(forTimeInterval: 0.2) }
  }

  /// Opens Contents with the real button, unless a previous method's run
  /// already left it open. Back-to-back `-only-testing` runs against the same
  /// live app inherit whatever the previous run left on screen (README
  /// Pitfalls): a failed earlier method can leave Contents open sitting right
  /// over the player, so a blind tap on the "Contents" button's own screen
  /// point can land on whatever Contents row is there instead — measured here
  /// 2026-09-24, where it silently chose a row in the book meant to stay
  /// unread. The sheet's title is a `staticTexts` element; the player's own
  /// button is a same-labelled `buttons` element, so the two do not collide.
  func openContents(_ app: XCUIApplication) {
    if app.staticTexts["Contents"].firstMatch.exists { return }
    app.buttons["Contents"].tap()
  }

  // MARK: - Book 1: "Cultivation Online", a stored place already on it (#52 items 1-5)

  /// Item 1: reopen the book (real tap), confirm paused, then open Contents
  /// with the real button and tap a real chapter row two or more chapters
  /// after the reading's. `browse-touch-state.cjs` run by the shell right
  /// before and right after this method is what proves the highlight, the
  /// status line and the stored place did not move; this method only performs
  /// and screenshots the touches.
  func testOpenBookThenBrowseTwoChaptersAhead() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    // A clean relaunch, not .activate(): this is the sequence's first method, and
    // a session that has already logged a warning leaves React Native's "Open
    // debugger to view warnings." banner sitting over the floating player,
    // overlapping Contents/Play/Playback speed closely enough that a real tap
    // there can be swallowed by the banner instead of the button underneath
    // (README Pitfalls, "A real, accessibility-matched tap can land on a debug
    // overlay"). Measured here 2026-09-24: Contents at {12.3, 797.7, 44, 44} sat
    // entirely inside the banner's {10, 787.7, 382, 48}, and the tap that
    // followed opened nothing.
    app.terminate()
    app.launch()
    ensureAtLibrary(app)
    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Cultivation Online,'")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10), "Book 1 row not found on Library")
    book.tap()
    XCTAssertTrue(waitForReaderReady(app), "Reader was not ready")
    waitForLayout(app)
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Expected paused after reopening a stored place")
    capture("bt-01-opened-paused", app)

    openContents(app)
    guard let current = currentChapterRow(app) else {
      XCTFail("No Contents row is marked as the reading's own chapter"); return
    }
    print("BROWSE-TOUCH current chapter=\(current.number)")
    guard let target = chapterRow(after: current.number, plus: 2, in: app) else {
      XCTFail("No chapter row at least two chapters after \(current.number) is on screen"); return
    }
    print("BROWSE-TOUCH target chapter=\(target.number)")
    capture("bt-02-contents-open", app)
    target.button.tap()
    waitContentsClosed(app)
    Thread.sleep(forTimeInterval: 1.0) // epub.js's own neighbour fill/trim (README Pitfalls, ~350 ms) to settle first.
    XCTAssertTrue(app.buttons["Play"].exists, "A browse must not start playback")
    capture("bt-03-browsed", app)
  }

  /// Item 2: with the page browsed away, a real tap on Play. The reading
  /// continues from the paused sentence and the page returns at the first
  /// cue — read here from the Play/Pause button's own `busy` accessibility
  /// state (`player.tsx`'s `accessibilityState={{busy: loading}}`, the same
  /// signal `ReaderProbe`'s loading-mode check reads), which clears once the
  /// first Clip's cue lands (`use-reading.ts` clears `buffering` there) with
  /// no need to poll the Metro log. Stops the instant it clears.
  func testPlayAfterBrowseReturnsAtFirstCue() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Expected paused before this test")
    let start = Date()
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5), "Play did not start")
    let deadline = Date().addingTimeInterval(25)
    while Date() < deadline {
      guard app.buttons["Pause"].exists else { break }
      let busy = (app.buttons["Pause"].value as? String)?.contains("busy") == true
      if !busy { break }
      Thread.sleep(forTimeInterval: 0.1)
    }
    let elapsed = Date().timeIntervalSince(start)
    print("BROWSE-TOUCH play-to-first-cue elapsed=\(elapsed)s")
    capture("bt-04-first-cue", app)
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause back")
    Thread.sleep(forTimeInterval: 0.3)
    capture("bt-05-paused-again", app)
  }

  /// Item 3: browse to another chapter again, then a real tap (not a drag —
  /// `.tap()` is a stationary touch, well under the WebView's own 10 px
  /// `DRAG_PX`) on a sentence in it. The tap must move the reading and its
  /// highlight there — `browse-touch-state.cjs` confirms the Utterance and
  /// section actually changed — then a brief real Play confirms it reads from
  /// there.
  func testTapSentenceInBrowsedChapterThenPlays() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Expected paused before this test")
    openContents(app)
    guard let current = currentChapterRow(app) else { XCTFail("No current Contents row"); return }
    guard let target = chapterRow(after: current.number, plus: 2, in: app) else {
      XCTFail("No chapter row at least two chapters after \(current.number)"); return
    }
    print("BROWSE-TOUCH re-browse target chapter=\(target.number)")
    target.button.tap()
    waitContentsClosed(app)
    Thread.sleep(forTimeInterval: 1.0)
    capture("bt-06-rebrowsed", app)

    bodyPoint(app).tap()
    Thread.sleep(forTimeInterval: 0.8)
    XCTAssertTrue(app.buttons["Play"].exists, "A sentence tap while paused must not itself start playback")
    capture("bt-07-tapped-sentence", app)

    let start = Date()
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5), "Play did not start from the tapped sentence")
    let deadline = Date().addingTimeInterval(25)
    while Date() < deadline {
      guard app.buttons["Pause"].exists else { break }
      if (app.buttons["Pause"].value as? String)?.contains("busy") != true { break }
      Thread.sleep(forTimeInterval: 0.1)
    }
    print("BROWSE-TOUCH play-from-tap elapsed=\(Date().timeIntervalSince(start))s")
    capture("bt-08-playing-from-tap", app)
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
    Thread.sleep(forTimeInterval: 0.3)
    capture("bt-09-paused-again", app)
  }

  /// Item 4, part 1: a real finger drag away from the reading while paused, a
  /// few screens (four fast flings, the same gesture and count
  /// `ScrollThemeReaderProbe.testFastFlingBothDirections` uses).
  func testDragAwayFromReading() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Expected paused before this test")
    for _ in 0..<4 { app.swipeUp(velocity: .fast) }
    Thread.sleep(forTimeInterval: 1.5)
    capture("bt-10-dragged-away", app)
  }

  /// Item 4, part 2: change the font size for real from the reader's own
  /// Appearance drawer while the page is still where the drag left it.
  func testFontSizeWhileBrowsing() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Appearance"].waitForExistence(timeout: 3))
    app.buttons["Appearance"].tap()
    XCTAssertTrue(app.buttons["Increase font size"].waitForExistence(timeout: 3))
    app.buttons["Increase font size"].tap()
    Thread.sleep(forTimeInterval: 0.5)
    capture("bt-11-font-increased", app)
    app.buttons["Decrease font size"].tap() // restore the owner's size
    Thread.sleep(forTimeInterval: 0.5)
    if app.buttons["Close Appearance"].exists { app.buttons["Close Appearance"].tap() }
    Thread.sleep(forTimeInterval: 0.5)
    capture("bt-12-font-restored-closed", app)
  }

  /// Item 4, part 3: drag back into the reading's section. No snap-centring —
  /// `browse-touch-state.cjs` taken immediately after this method and again a
  /// couple of seconds later (from the shell) must agree, proving nothing
  /// recentres the page on a delay once it arrives.
  func testDragBackToReadingSection() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    for _ in 0..<4 { app.swipeDown(velocity: .fast) }
    Thread.sleep(forTimeInterval: 1.5)
    XCTAssertTrue(app.buttons["Play"].exists, "Still expected paused after dragging back")
    capture("bt-13-dragged-back", app)
  }

  /// Item 5: while playing, a real Contents row tap. The reading must jump to
  /// that chapter and keep playing from its heading — confirmed here by the
  /// Pause button (the playing state) still showing a moment after the jump;
  /// `browse-touch-state.cjs` confirms the Utterance/section actually moved to
  /// the target's heading, which is the opposite of Items 1 and 3.
  func testContentsRowWhilePlayingJumpsAndKeepsPlaying() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Expected paused before this test")
    let start = Date()
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5), "Play did not start")
    openContents(app)
    guard let current = currentChapterRow(app) else { XCTFail("No current Contents row"); return }
    guard let target = chapterRow(after: current.number, plus: 2, in: app) else {
      XCTFail("No chapter row at least two chapters after \(current.number)"); return
    }
    print("BROWSE-TOUCH while-playing target chapter=\(target.number)")
    target.button.tap()
    waitContentsClosed(app)
    capture("bt-14-jumped-while-playing", app)
    Thread.sleep(forTimeInterval: 1.5)
    XCTAssertTrue(app.buttons["Pause"].exists, "Must still be playing after a Contents row while playing")
    capture("bt-15-still-playing-after-jump", app)
    print("BROWSE-TOUCH while-playing elapsed=\(Date().timeIntervalSince(start))s")
    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
    Thread.sleep(forTimeInterval: 0.3)
    capture("bt-16-stopped", app)
  }

  // MARK: - Book 2: "Cultivation Online — Chapters 1751-2000", never played (#52 item 6)

  /// Item 6, opening half: leave book 1, open the never-played book for the
  /// first time and confirm it is ready. A separate method from the Contents
  /// choice below so the shell can snapshot the freshly opened, still-blank
  /// state in between.
  func testOpenUnreadBook() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    ensureAtLibrary(app)
    let book = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Chapters 1751'")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10), "Book 2 row not found on Library")
    book.tap()
    XCTAssertTrue(waitForReaderReady(app), "Reader was not ready")
    waitForLayout(app)
    XCTAssertTrue(app.buttons["Play"].exists, "An unread book must open paused, not playing")
    capture("bt-17-unread-opened", app)
  }

  /// Item 6, the choice: a real Contents row tap must highlight that chapter's
  /// heading. `browse-touch-state.cjs` confirms the Library's place for this
  /// book id is still null afterwards.
  func testUnreadBookContentsRowHighlightsHeading() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    openContents(app)
    guard let target = nthChapterRow(3, in: app) else { XCTFail("Fewer than 3 chapter rows on screen"); return }
    print("BROWSE-TOUCH unread target chapter=\(target.number)")
    capture("bt-18-unread-contents-open", app)
    target.button.tap()
    waitContentsClosed(app)
    Thread.sleep(forTimeInterval: 1.0)
    XCTAssertTrue(app.buttons["Play"].exists, "Choosing a chapter must not itself start playback")
    capture("bt-19-unread-heading-highlighted", app)
  }

  /// Item 6, leaving: a real tap on Back. `browse-touch-state.cjs` (or a plain
  /// read of Documents/library.json) taken after this confirms the place is
  /// still null — the choice was never written.
  func testLeaveUnreadBookWithoutPlaying() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(app.buttons["Back"].waitForExistence(timeout: 5))
    app.buttons["Back"].tap()
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10), "Did not return to Library")
    capture("bt-20-left-unread-book", app)
  }
}
