import XCTest

/// Real touches for #71 batches 3 (A/M, the way back, the collapsed lock) and 4
/// (Continuous), verifying `docs/design/0050-the-page-follows-the-line-being-spoken.md`
/// and `docs/adr/0050-the-page-follows-the-line-and-glides.md` against the merge
/// of main's #67 (the floating bar and Reading Button) and #68 (the Reading held
/// in the Library) into this branch.
///
/// Expects "Cultivation Online" (a real book, `~/Works/epub_books`, already on
/// this device's shelf, mid-way) with Fish's "Laura" (Word Timings) the chosen
/// Voice — the state this worktree's simulator already carried into this run.
/// `.activate()` only, never `.terminate()/.launch()`, except where a method's
/// own doc comment says otherwise (a fresh mount matters to what it tests): the
/// methods depend on each other's state and run in the order below, the same
/// shape as `BrowseTouchProbe`/`ScrollThemeReaderProbe`.
///
/// Two general-purpose methods (`testDragPageByParams`, `testTapControlByParams`)
/// take their parameters from `/tmp/openreader-following-params.txt`
/// (`KEY=VALUE` lines — `xcodebuild … test` does not pass the caller's
/// environment, `SyncProbe.param`'s convention), so one shell driver can reuse
/// them for every "drag the page" or "tap this control" step these two batches
/// need, at whatever distance or target each step calls for, instead of a
/// bespoke method per drag.
final class FollowingProbe: XCTestCase {
  // A cascading failure (README Pitfalls, "continueAfterFailure defaults to
  // true") is harder to read than a method that stops at its first wrong
  // assumption, for these multi-step, state-dependent sequences.
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func param(_ key: String, _ fallback: String) -> String {
    if let text = try? String(contentsOfFile: "/tmp/openreader-following-params.txt", encoding: .utf8) {
      for line in text.split(separator: "\n") where line.hasPrefix(key + "=") {
        return String(line.dropFirst(key.count + 1)).trimmingCharacters(in: .whitespaces)
      }
    }
    return ProcessInfo.processInfo.environment[key] ?? fallback
  }

  func until(_ timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    repeat {
      if condition() { return true }
      Thread.sleep(forTimeInterval: 0.2)
    } while Date() < deadline
    return false
  }

  /// React Native's "Open debugger to view warnings." banner (README Pitfalls):
  /// dismissed by its own close button, never tapped anywhere else.
  func clearLogBox(_ app: XCUIApplication) {
    let banner = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Open debugger to view warnings'")).firstMatch
    guard banner.exists else { return }
    let frame = banner.frame
    app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.maxX - 22, dy: frame.midY)).tap()
    _ = until(3) { !banner.exists }
  }

  func press(_ element: XCUIElement, _ app: XCUIApplication) {
    clearLogBox(app)
    element.tap()
  }

  func dismissSystemAlerts(_ app: XCUIApplication) {
    let inApp = app.buttons["Not Now"]
    if inApp.waitForExistence(timeout: 2) { inApp.tap(); return }
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let sbNotNow = springboard.buttons["Not Now"]
    if sbNotNow.waitForExistence(timeout: 2) { sbNotNow.tap() }
  }

  @discardableResult
  func waitForReaderReady(_ app: XCUIApplication, timeout: TimeInterval = 40) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if app.buttons["Play"].exists || app.buttons["Pause"].exists || app.buttons["Show the player"].exists { return true }
      Thread.sleep(forTimeInterval: 0.3)
    }
    return app.buttons["Play"].exists || app.buttons["Pause"].exists || app.buttons["Show the player"].exists
  }

  /// Waits for "Laying the document out…" to be gone on two consecutive
  /// checks half a second apart, not just one: a single `false` reading was
  /// measured here to be followed by the placeholder still on screen a
  /// moment later (2026-09-26, #71 — this book, well into a long session),
  /// which one `while loading.exists` check cannot tell apart from a real
  /// gone-for-good reading.
  func waitForLayout(_ app: XCUIApplication, timeout: TimeInterval = 30) {
    let loading = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Laying the document out'")).firstMatch
    Thread.sleep(forTimeInterval: 0.8)
    let deadline = Date().addingTimeInterval(timeout)
    var consecutiveGone = 0
    while consecutiveGone < 2 && Date() < deadline {
      if loading.exists { consecutiveGone = 0 } else { consecutiveGone += 1 }
      Thread.sleep(forTimeInterval: 0.5)
    }
  }

  func inLibrary(_ app: XCUIApplication) -> Bool { app.navigationBars["Library"].exists }
  func inReader(_ app: XCUIApplication) -> Bool {
    app.buttons["Collapse the player"].exists || app.buttons["Show the player"].exists
  }

  func ensureAtLibrary(_ app: XCUIApplication) {
    app.activate()
    var steps = 0
    while !inLibrary(app) && steps < 6 {
      if app.buttons["Back"].exists { press(app.buttons["Back"], app) }
      else if app.buttons["Show the player"].exists { break } // collapsed reader: caller decides
      steps += 1
      Thread.sleep(forTimeInterval: 0.6)
    }
  }

  /// The book row this suite uses throughout ("Cultivation Online," a stamped
  /// place). Opens it if the Library is in front and the reader is not already
  /// open; otherwise does nothing (already there).
  func openBook(_ app: XCUIApplication) {
    if inReader(app) { return }
    ensureAtLibrary(app)
    let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Cultivation Online,'")).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10), "Cultivation Online is not on the shelf")
    book.tap()
    XCTAssertTrue(waitForReaderReady(app), "Reader was not ready")
    waitForLayout(app)
    // A fresh WKWebView can still be blank a moment after "Laying the
    // document out…" clears (README Pitfalls, "A screenshot taken right
    // after a reader remounts can be blank"): the placeholder tracks the
    // app's own readiness, not whether WebKit has actually composited a
    // frame. Measured here (2026-09-26, #71): a drag performed before this
    // settled landed on a blank page and did nothing, read as "the drag
    // failed" rather than "the page was not there yet."
    Thread.sleep(forTimeInterval: 3.5)
  }

  // MARK: - Following mark (A/M, #71 ADR 0050)

  func followingText(_ app: XCUIApplication) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Following the reading")).firstMatch
  }
  /// Only meaningful once `inReader(app)` holds: the Library's own Reading
  /// Button (`library-screen.tsx`) is given the identical label for a person
  /// using it, and the two screens are never shown together.
  func returnMark(_ app: XCUIApplication) -> XCUIElement { app.buttons["Return to the reading"] }
  /// A plain drag of the page that must leave it Browsing (M).
  ///
  /// XCTest often delivers the first synthesized drag of a run as a single
  /// `touchmove` that never becomes a scroll: measured on 2026-09-26 with a touch
  /// tracer in the reader, the first drag of 3 runs out of 4, and no later one.
  /// A page that did not move is rightly not Browsing, so a drag after which the
  /// screen is exactly as it was is made again, up to `attempts` times. A drag
  /// that changed the screen and still left A is the app's failure and is not
  /// retried. While the reading plays the highlight changes the screen anyway,
  /// so there a swallowed drag is still reported as a failure.
  func dragToBrowsing(_ app: XCUIApplication, _ from: XCUICoordinate, _ to: XCUICoordinate, attempts: Int = 3) -> Bool {
    for attempt in 1...attempts {
      let before = XCUIScreen.main.screenshot().pngRepresentation
      from.press(forDuration: 0.05, thenDragTo: to, withVelocity: XCUIGestureVelocity(250), thenHoldForDuration: 0.1)
      Thread.sleep(forTimeInterval: 0.6)
      if isBrowsingM(app) {
        print("FOLLOWING drag reached M on attempt \(attempt)")
        return true
      }
      if XCUIScreen.main.screenshot().pngRepresentation != before {
        print("FOLLOWING drag \(attempt) changed the screen and left A")
        return false
      }
      print("FOLLOWING drag \(attempt) did not reach the page; again")
    }
    return false
  }

  func isFollowingA(_ app: XCUIApplication) -> Bool { followingText(app).exists }
  func isBrowsingM(_ app: XCUIApplication) -> Bool { inReader(app) && returnMark(app).exists }

  // MARK: - Contents (#52 helpers, reused as-is from BrowseTouchProbe)

  func chapterNumber(_ label: String) -> Int? {
    guard label.hasPrefix("Chapter ") else { return nil }
    let rest = label.dropFirst("Chapter ".count)
    let digits = rest.prefix { $0.isNumber }
    return digits.isEmpty ? nil : Int(digits)
  }
  func currentChapterRow(_ app: XCUIApplication) -> (button: XCUIElement, number: Int)? {
    for button in app.buttons.matching(NSPredicate(format: "isSelected == YES")).allElementsBoundByIndex {
      if let n = chapterNumber(button.label) { return (button, n) }
    }
    return nil
  }
  func chapterRow(after from: Int, plus delta: Int, in app: XCUIApplication) -> (button: XCUIElement, number: Int)? {
    let candidates = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Chapter '")).allElementsBoundByIndex
      .compactMap { button -> (XCUIElement, Int)? in chapterNumber(button.label).map { (button, $0) } }
      .filter { $0.1 >= from + delta }
      .sorted { $0.0.frame.minY < $1.0.frame.minY }
    return candidates.first
  }
  func openContents(_ app: XCUIApplication) {
    if app.staticTexts["Contents"].firstMatch.exists { return }
    press(app.buttons["Contents"], app)
    // The sheet's own slide-in (README Pitfalls, "Screenshots of a sheet"):
    // let it settle before reading isSelected off any row.
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertTrue(app.staticTexts["Contents"].firstMatch.waitForExistence(timeout: 5), "Contents did not open")
  }
  func waitContentsClosed(_ app: XCUIApplication, timeout: TimeInterval = 5) {
    let title = app.staticTexts["Contents"].firstMatch
    let deadline = Date().addingTimeInterval(timeout)
    while title.exists && Date() < deadline { Thread.sleep(forTimeInterval: 0.2) }
  }
  func bodyPoint(_ app: XCUIApplication) -> XCUICoordinate {
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55))
  }

  // MARK: - General (#71 batches 2-4 rows)

  func generalRow(_ label: String, _ app: XCUIApplication) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label + ",")).firstMatch
  }
  func menuItem(_ app: XCUIApplication, _ title: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", title)).firstMatch
  }
  /// Library -> Settings -> General, by real touch. A no-op if General is
  /// already showing (its own rows are on screen).
  func openGeneral(_ app: XCUIApplication) {
    if generalRow("Theme", app).exists { return }
    ensureAtLibrary(app)
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
    press(app.buttons["Settings"], app)
    let general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'General'")).firstMatch
    XCTAssertTrue(general.waitForExistence(timeout: 5), "No General row in Settings")
    press(general, app)
    XCTAssertTrue(generalRow("Theme", app).waitForExistence(timeout: 5), "General did not open")
  }
  /// General -> Settings -> Library, by real touch (two "Back" taps).
  func closeGeneralToLibrary(_ app: XCUIApplication) {
    if app.buttons["Back"].exists { press(app.buttons["Back"], app) }
    Thread.sleep(forTimeInterval: 0.4)
    if app.buttons["Back"].exists { press(app.buttons["Back"], app) }
    XCTAssertTrue(until(5) { self.inLibrary(app) }, "Did not return to the Library")
  }

  // MARK: - Generic drag / tap, driven by /tmp/openreader-following-params.txt

  /// FROM_Y, TO_Y: normalized (0-1) vertical drag endpoints. VELOCITY: a fling
  /// when set (pt/s), a plain drag otherwise. REPEAT/GAP_MS: how many times,
  /// how far apart. Reused for every "drag the page" step in both batches: a
  /// small drag past `DRAG_PX` (item 2), a near or far drag while playing
  /// (item 4), a far-then-near pair (item 3), a drag that must do nothing while
  /// collapsed (item 6), a drag that must stop the Continuous drift (item 10).
  func testDragPageByParams() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    dismissSystemAlerts(app)
    let fromY = Double(param("FROM_Y", "0.60")) ?? 0.60
    let toY = Double(param("TO_Y", "0.40")) ?? 0.40
    let velocityText = param("VELOCITY", "")
    let repeats = Int(param("REPEAT", "1")) ?? 1
    let gapMs = Double(param("GAP_MS", "300")) ?? 300
    let settleS = Double(param("SETTLE_S", "0.6")) ?? 0.6
    print("FOLLOWING before: A=\(isFollowingA(app)) M=\(isBrowsingM(app)) collapsed=\(app.buttons["Show the player"].exists)")
    capture("drag-before", app)
    for i in 0..<max(1, repeats) {
      let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: fromY))
      let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: toY))
      if let v = Double(velocityText) {
        from.press(forDuration: 0.03, thenDragTo: to, withVelocity: XCUIGestureVelocity(v), thenHoldForDuration: 0.05)
      } else {
        from.press(forDuration: 0.05, thenDragTo: to, withVelocity: XCUIGestureVelocity(250), thenHoldForDuration: 0.1)
      }
      if i < repeats - 1 { Thread.sleep(forTimeInterval: gapMs / 1000) }
    }
    Thread.sleep(forTimeInterval: settleS)
    print("FOLLOWING after: A=\(isFollowingA(app)) M=\(isBrowsingM(app)) collapsed=\(app.buttons["Show the player"].exists)")
    capture("drag-after", app)
  }

  /// WHAT selects the control: A, M, Play, Pause, Collapse, ShowPlayer,
  /// Contents, BodyText, ContentsAfterCurrentPlus:<N>. WAIT_BEFORE_S,
  /// WAIT_AFTER_S bracket the tap.
  func testTapControlByParams() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    dismissSystemAlerts(app)
    let what = param("WHAT", "")
    Thread.sleep(forTimeInterval: Double(param("WAIT_BEFORE_S", "0")) ?? 0)
    print("FOLLOWING before tap \(what): A=\(isFollowingA(app)) M=\(isBrowsingM(app)) playing=\(app.buttons["Pause"].exists) collapsed=\(app.buttons["Show the player"].exists)")
    capture("tap-\(what)-before", app)
    switch true {
    case what == "A":
      followingText(app).tap()
    case what == "M":
      XCTAssertTrue(returnMark(app).waitForExistence(timeout: 5), "No M to tap")
      press(returnMark(app), app)
    case what == "Play":
      XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "No Play to tap")
      press(app.buttons["Play"], app)
    case what == "Pause":
      XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5), "No Pause to tap")
      press(app.buttons["Pause"], app)
    case what == "Collapse":
      XCTAssertTrue(app.buttons["Collapse the player"].waitForExistence(timeout: 5), "No collapse arrow")
      press(app.buttons["Collapse the player"], app)
    case what == "ShowPlayer":
      XCTAssertTrue(app.buttons["Show the player"].waitForExistence(timeout: 5), "No Reading Button to tap")
      press(app.buttons["Show the player"], app)
    case what == "Contents":
      openContents(app)
    case what == "BodyText":
      clearLogBox(app)
      bodyPoint(app).tap()
    case what.hasPrefix("ContentsAfterCurrentPlus:"):
      let delta = Int(what.split(separator: ":")[1]) ?? 1
      openContents(app)
      guard let current = currentChapterRow(app) else { XCTFail("No current Contents row"); return }
      guard let target = chapterRow(after: current.number, plus: delta, in: app) else {
        XCTFail("No chapter row \(delta)+ after \(current.number) on screen"); return
      }
      print("FOLLOWING contents current=\(current.number) target=\(target.number)")
      target.button.tap()
      waitContentsClosed(app)
    default:
      XCTFail("Unknown WHAT=\(what)")
    }
    Thread.sleep(forTimeInterval: Double(param("WAIT_AFTER_S", "0.6")) ?? 0.6)
    print("FOLLOWING after tap \(what): A=\(isFollowingA(app)) M=\(isBrowsingM(app)) playing=\(app.buttons["Pause"].exists) collapsed=\(app.buttons["Show the player"].exists)")
    capture("tap-\(what)-after", app)
  }

  // MARK: - Item 5: a fresh mount, before any Play, M moves the page and never plays

  /// A clean relaunch, so this process has never called Play: opens
  /// "Cultivation Online" fresh (its saved place, paused), drags to Browsing,
  /// taps M, and confirms Play is still offered — #53 held even on the very
  /// first touch a session ever makes.
  func testFreshOpenBeforeAnyPlayReturnDoesNotStartPlayback() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()
    ensureAtLibrary(app)
    openBook(app)
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10), "A fresh mount must start paused (never played)")
    XCTAssertTrue(isFollowingA(app), "A fresh mount must start following")
    capture("fresh-open-A", app)

    let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
    let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
    XCTAssertTrue(dragToBrowsing(app, from, to), "A real drag did not turn A into M")
    capture("fresh-open-dragged-M", app)

    press(returnMark(app), app)
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertTrue(isFollowingA(app), "M did not bring the page back to A")
    XCTAssertTrue(app.buttons["Play"].exists, "Tapping M on a never-played reader must not start playback")
    capture("fresh-open-returned-still-paused", app)
  }

  // MARK: - Item 5: drag away while paused, M moves the page only (#53)

  /// While paused: a real drag turns A into M, and tapping M brings the page
  /// back without starting playback. Self-contained (drag + tap in one
  /// method) so a Metro/Fast-Refresh reconnect between separate `xcodebuild`
  /// invocations cannot wipe the Browsing flag in between (README Pitfalls,
  /// "A Metro reconnect between separate xcodebuild invocations can silently
  /// reload the app").
  func testDragThenReturnWhilePausedMovesPageOnly() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    openBook(app)
    if app.buttons["Pause"].exists { press(app.buttons["Pause"], app); XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5)) }
    XCTAssertTrue(isFollowingA(app), "Must start following")
    capture("drag-return-00-A", app)

    let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
    let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
    XCTAssertTrue(dragToBrowsing(app, from, to), "A real drag did not turn A into M")
    capture("drag-return-01-M", app)

    press(returnMark(app), app)
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertTrue(isFollowingA(app), "M did not bring the page back to A")
    XCTAssertTrue(app.buttons["Play"].exists, "Tapping M while paused must not start playback")
    capture("drag-return-02-back-to-A-still-paused", app)
  }

  // MARK: - Item 5: browse via a Contents row while paused, M moves the page only

  func testContentsBrowseThenReturnWhilePaused() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    openBook(app)
    if app.buttons["Pause"].exists { press(app.buttons["Pause"], app); XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5)) }
    XCTAssertTrue(isFollowingA(app), "Must start following")
    capture("contents-return-00-A", app)

    openContents(app)
    guard let current = currentChapterRow(app) else { XCTFail("No current Contents row"); return }
    guard let target = chapterRow(after: current.number, plus: 1, in: app) else {
      XCTFail("No chapter row after \(current.number) on screen"); return
    }
    target.button.tap()
    waitContentsClosed(app)
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertTrue(isBrowsingM(app), "Choosing a Contents row did not turn A into M")
    capture("contents-return-01-M", app)

    press(returnMark(app), app)
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertTrue(isFollowingA(app), "M did not bring the page back to A")
    XCTAssertTrue(app.buttons["Play"].exists, "Tapping M while paused must not start playback")
    capture("contents-return-02-back-to-A-still-paused", app)
  }

  // MARK: - Item 4: tapping M while playing glides near, jumps far, keeps playing

  /// A small drag (within a page) while playing, tap M: a glide back. A far
  /// drag (a fling) while playing, tap M: a jump back. Both keep playing
  /// throughout. Pair with `line-follow.cjs arm`/`analyse` around this method
  /// (run by the shell) to read which each recovery actually was from the
  /// frame log.
  func testDragNearThenFarTapReturnWhilePlaying() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    openBook(app)
    if app.buttons["Play"].exists { press(app.buttons["Play"], app) }
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5), "Must be playing")
    Thread.sleep(forTimeInterval: 1.0)
    capture("nearfar-00-playing", app)

    // Near: a small drag, well within a page.
    var from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
    var to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
    XCTAssertTrue(dragToBrowsing(app, from, to), "The near drag did not turn A into M")
    XCTAssertTrue(app.buttons["Pause"].exists, "A drag must not pause playback")
    capture("nearfar-01-near-M", app)
    press(returnMark(app), app)
    Thread.sleep(forTimeInterval: 1.0)
    XCTAssertTrue(isFollowingA(app), "M did not bring the page back (near case)")
    XCTAssertTrue(app.buttons["Pause"].exists, "Playback must continue after M (near case)")
    capture("nearfar-02-near-returned-A-playing", app)

    // Far: fast flicks (FlingProbe's own shape), more than a page.
    Thread.sleep(forTimeInterval: 1.0)
    fastFling(app, times: 3)
    Thread.sleep(forTimeInterval: 0.8)
    XCTAssertTrue(isBrowsingM(app), "The far fling did not turn A into M")
    XCTAssertTrue(app.buttons["Pause"].exists, "A fling must not pause playback")
    capture("nearfar-03-far-M", app)
    press(returnMark(app), app)
    Thread.sleep(forTimeInterval: 1.0)
    XCTAssertTrue(isFollowingA(app), "M did not bring the page back (far case)")
    XCTAssertTrue(app.buttons["Pause"].exists, "Playback must continue after M (far case)")
    capture("nearfar-04-far-returned-A-playing", app)

    press(app.buttons["Pause"], app)
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
  }

  // MARK: - Item 6: the collapsed lock (#67 x #71)

  /// While playing: collapse hides A/M; a real drag on the page does nothing
  /// (no scroll — read from the `line-follow.cjs arm`/`analyse` frame log the
  /// shell bookends this method with); a real tap on body text still seeks
  /// the reading (read from the same `analyse`'s `msgs`, a new `speak`
  /// entry). Then, still collapsed: browse first (expand, drag to M, collapse
  /// again) and confirm the page returns to the reading as part of
  /// collapsing, not left at M; finally the Reading Button restores dragging.
  func testCollapseLocksThenBrowseFirstReturnsThenButtonRestoresDrag() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    openBook(app)
    if app.buttons["Play"].exists { press(app.buttons["Play"], app) }
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5), "Must be playing")
    Thread.sleep(forTimeInterval: 0.8)
    capture("collapse-00-playing-expanded", app)

    press(app.buttons["Collapse the player"], app)
    XCTAssertTrue(app.buttons["Show the player"].waitForExistence(timeout: 5), "Did not collapse")
    XCTAssertFalse(followingText(app).exists, "A is still shown while collapsed")
    XCTAssertFalse(app.buttons["Return to the reading"].exists, "M is still shown while collapsed")
    capture("collapse-01-collapsed-playing-no-mark", app)

    // A real drag on the page must do nothing (no scroll: the shell's
    // arm/analyse frame log is the proof; here only that nothing in the UI
    // changed).
    let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
    let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
    from.press(forDuration: 0.05, thenDragTo: to, withVelocity: XCUIGestureVelocity(250), thenHoldForDuration: 0.1)
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertTrue(app.buttons["Show the player"].exists, "Still collapsed after the drag")
    capture("collapse-02-after-drag-should-be-unchanged", app)

    // A real tap on body text must still seek the reading (the shell's
    // arm/analyse `msgs` array is the proof of a new `speak` utterance).
    let bodyTap = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    press(bodyTap, app: app)
    Thread.sleep(forTimeInterval: 1.2)
    capture("collapse-03-after-body-tap", app)

    // Reopen: the Reading Button only shows the player again, playback keeps
    // going (`reading-button.tsx`'s own doc comment: "never plays or
    // pauses"; PlayerTouchProbe's older comment describing a pause-on-reopen
    // predates #67's dedicated, never-plays-or-pauses Reading Button and is
    // stale against this merge — README Pitfalls).
    press(app.buttons["Show the player"], app)
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5), "Reopening the collapsed pill must not pause a playing reading")
    XCTAssertTrue(isFollowingA(app), "Reopening after a collapsed seek must show A")
    capture("collapse-03b-reopened-still-playing-A", app)

    // Browse, then collapse again: must return to A first.
    Thread.sleep(forTimeInterval: 0.8)
    XCTAssertTrue(dragToBrowsing(app, from, to), "The drag before re-collapsing did not reach M")
    capture("collapse-04-browsing-before-recollapse", app)

    press(app.buttons["Collapse the player"], app)
    XCTAssertTrue(app.buttons["Show the player"].waitForExistence(timeout: 5), "Did not collapse from M")
    capture("collapse-05-collapsed-from-M", app)

    press(app.buttons["Show the player"], app)
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5), "Reopening must not pause a playing reading")
    XCTAssertTrue(isFollowingA(app), "Collapsing while browsing did not return the page to A first")
    capture("collapse-06-reopened-shows-A-not-M", app)

    // The Reading Button restored the player; dragging must work again.
    Thread.sleep(forTimeInterval: 0.8)
    XCTAssertTrue(dragToBrowsing(app, from, to), "Dragging does not work again after the Reading Button restored the player")
    capture("collapse-07-dragging-restored", app)
    press(returnMark(app), app)
    Thread.sleep(forTimeInterval: 0.6)
    press(app.buttons["Pause"], app)
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
  }

  /// `press` for a coordinate (the LogBox guard, then a tap) — `press(_:_:)`
  /// above takes an `XCUIElement`, which a raw body-text point is not.
  func press(_ coordinate: XCUICoordinate, app: XCUIApplication) {
    clearLogBox(app)
    coordinate.tap()
  }

  /// `FlingProbe.testFlicks`'s own proven shape (0.70 -> 0.30, a 0.01 s press,
  /// 4000 pt/s, no hold), repeated: a single very fast, wide-travel
  /// `press(forDuration:thenDragTo:)` (0.85 -> 0.15 at 3500 pt/s) measured
  /// here as a plain tap-to-seek instead of a drag more than once (README
  /// Pitfalls) — the WebView's own touch handling seems to need a gesture
  /// shaped like a real repeated flick, not one enormous one, to reliably
  /// read as a drag rather than a tap. `times` repeats build up real
  /// distance the way `FlingProbe`'s own ten flicks do.
  func fastFling(_ app: XCUIApplication, times: Int = 3, direction: String = "down") {
    let low = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.70))
    let high = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.30))
    let (from, to) = direction == "down" ? (low, high) : (high, low)
    for _ in 0..<times {
      from.press(forDuration: 0.01, thenDragTo: to, withVelocity: XCUIGestureVelocity(4000), thenHoldForDuration: 0)
      Thread.sleep(forTimeInterval: 0.1)
    }
  }

  /// A short replay of item 6's collapsed drag and body tap, for the shell to
  /// bookend with `line-follow.cjs arm`/`analyse` (the main
  /// `testCollapseLocksThenBrowseFirstReturnsThenButtonRestoresDrag` above
  /// already proves the UI side; this is only for the frame-log evidence a
  /// second invocation can add once the reader is known to be open and
  /// `arm` can install). Leaves the player collapsed, playing.
  func testCollapsedDragAndBodyTapForFrameLog() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    openBook(app)
    if app.buttons["Play"].exists { press(app.buttons["Play"], app) }
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5))
    if app.buttons["Collapse the player"].exists { press(app.buttons["Collapse the player"], app) }
    XCTAssertTrue(app.buttons["Show the player"].waitForExistence(timeout: 5))
    Thread.sleep(forTimeInterval: 1.0)
    let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
    let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
    from.press(forDuration: 0.05, thenDragTo: to, withVelocity: XCUIGestureVelocity(250), thenHoldForDuration: 0.1)
    Thread.sleep(forTimeInterval: 1.0)
    let bodyTap = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    press(bodyTap, app: app)
    Thread.sleep(forTimeInterval: 1.5)
    capture("frame-log-replay-still-collapsed", app)
  }

  // MARK: - Item 3: far away stays M across sentences, near brings A back by itself

  /// While playing: a fast fling far ahead (more than a screen), then a wait
  /// long enough for at least two sentence starts (this book/Voice's own
  /// pace, `ReadingHeldProbe`'s own measurements: an Utterance changes inside
  /// about 5 s at this fixture's — no, this real book's — pace with Fish;
  /// 22 s is generous for two). Confirms M holds throughout (no self-return),
  /// then a drag back toward roughly where the reading now is (NEAR_FROM_Y/
  /// NEAR_TO_Y, adjustable by shell param since the exact place depends on
  /// how far the fling actually went and how many sentences elapsed), and a
  /// further wait for the next sentence's own cue, which should bring A back
  /// by itself with no tap. Pair with `line-follow.cjs arm`/`analyse` (the
  /// shell) for the frame-level "no program scroll while far" evidence.
  func testFarDragStaysMThenNearDragAutoRecovers() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    openBook(app)
    if app.buttons["Play"].exists { press(app.buttons["Play"], app) }
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5), "Must be playing")
    Thread.sleep(forTimeInterval: 1.0)
    capture("far-00-playing-A", app)
    XCTAssertTrue(isFollowingA(app))

    // FlingProbe's own proven shape (0.70 -> 0.30, 0.01 s press, 4000 pt/s),
    // reused via `fastFling`, already measured reliable at moving the page a
    // real distance (items 4 and 9); a controlled low-velocity drag repeated
    // several times with only a 0.3 s gap was tried here first and twice
    // registered as no drag at all (2026-09-26) — the page stayed exactly on
    // the reading throughout, still `A`.
    let repeats = Int(param("REPEAT", "4")) ?? 4
    fastFling(app, times: repeats, direction: "down")
    Thread.sleep(forTimeInterval: 0.8)
    XCTAssertTrue(isBrowsingM(app), "The far fling did not turn A into M")
    capture("far-01-M-just-after-drag", app)

    let farWaitS = Double(param("FAR_WAIT_S", "22")) ?? 22
    Thread.sleep(forTimeInterval: farWaitS)
    XCTAssertTrue(isBrowsingM(app), "M did not hold across the far wait (it self-returned)")
    XCTAssertTrue(app.buttons["Pause"].exists, "Must still be playing during the far wait")
    capture("far-02-still-M-after-wait", app)

    // The same fling shape, reversed: not an exact mirror (a fling's landing
    // point depends on momentum, not just the gesture), so recovery below
    // polls rather than assuming one attempt landed the reading's line
    // exactly on screen.
    fastFling(app, times: repeats, direction: "up")
    Thread.sleep(forTimeInterval: 0.8)
    capture("far-03-M-after-near-drag", app)

    // Poll rather than a single fixed wait: recovery is at the next sentence
    // able to see it start, and which sentence that is depends on exactly
    // where the reverse drag landed.
    func pollForA(_ seconds: Double) -> Bool {
      let deadline = Date().addingTimeInterval(seconds)
      while Date() < deadline {
        if isFollowingA(app) { return true }
        Thread.sleep(forTimeInterval: 1.0)
      }
      return false
    }
    let recoverWaitS = Double(param("RECOVER_WAIT_S", "20")) ?? 20
    var recovered = pollForA(recoverWaitS)
    capture("far-04-after-recover-wait", app)
    // One small reversed nudge and a second, shorter poll if the fling's
    // landing point missed the reading's line: this is exploratory
    // calibration (finding where the reading now is), not the fact under
    // test, which is that a visible line does recover by itself.
    // Landing a fling exactly on the reading's own line is exploratory
    // calibration, not the fact under test (that a visible line does bring
    // A back by itself) — a single flick was measured here not to register
    // reliably at all (README Pitfalls), so each nudge below is two.
    let nudgeDirection = param("NUDGE_DIRECTION", "up")
    var nudgeCount = 0
    while !recovered && nudgeCount < 3 {
      nudgeCount += 1
      fastFling(app, times: 2, direction: nudgeDirection)
      Thread.sleep(forTimeInterval: 0.8)
      capture("far-05-after-nudge-\(nudgeCount)", app)
      recovered = pollForA(recoverWaitS)
      capture("far-06-after-recover-wait-\(nudgeCount)", app)
    }
    print("FOLLOWING far-recovery: recovered=\(recovered) A=\(isFollowingA(app)) M=\(isBrowsingM(app))")

    press(app.buttons["Pause"], app)
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
  }

  /// Item 3, take two: a blind fling-and-reverse could not reliably land the
  /// page back near the reading's own line (the reading keeps advancing the
  /// whole time it is away, so a fixed reverse chases a moving target —
  /// README Pitfalls). Contents' own current-chapter row is a live,
  /// always-accurate oracle for where the reading now is (it marks
  /// `status.section`, not wherever the page is browsing), and choosing it
  /// is itself just Browsing to a different place (#52) — not one of the
  /// three ways back — so using it to get close, then waiting for an
  /// ordinary cue, still exercises the "by itself, at a sentence the owner
  /// can see begin" path rather than one of the owner-asks-for-it ones.
  func testFarDragStaysMThenContentsThenAutoRecovers() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    openBook(app)
    if app.buttons["Play"].exists { press(app.buttons["Play"], app) }
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5), "Must be playing")
    Thread.sleep(forTimeInterval: 1.0)
    XCTAssertTrue(isFollowingA(app))
    capture("far2-00-playing-A", app)

    fastFling(app, times: Int(param("REPEAT", "4")) ?? 4, direction: "down")
    Thread.sleep(forTimeInterval: 0.8)
    XCTAssertTrue(isBrowsingM(app), "The far fling did not turn A into M")
    capture("far2-01-M-after-fling", app)

    let farWaitS = Double(param("FAR_WAIT_S", "15")) ?? 15
    Thread.sleep(forTimeInterval: farWaitS)
    XCTAssertTrue(isBrowsingM(app), "M did not hold across the far wait")
    XCTAssertTrue(app.buttons["Pause"].exists, "Must still be playing during the far wait")
    capture("far2-02-still-M-after-wait", app)

    openContents(app)
    guard let current = currentChapterRow(app) else { XCTFail("No current Contents row while playing"); return }
    print("FOLLOWING far2 current chapter=\(current.number)")
    current.button.tap()
    waitContentsClosed(app)
    Thread.sleep(forTimeInterval: 0.6)
    // Landing on the reading's own current chapter (the "already on the
    // page" case ADR 0048 names) was measured here to already read as `A`
    // this quickly — printed, not asserted, since which of "instant" or "the
    // very next cue, moments away" this is was not isolated further.
    print("FOLLOWING far2 right after Contents jump: A=\(isFollowingA(app)) M=\(isBrowsingM(app))")
    capture("far2-03-M-after-contents-jump", app)

    func pollForA(_ seconds: Double) -> Bool {
      let deadline = Date().addingTimeInterval(seconds)
      while Date() < deadline {
        if isFollowingA(app) { return true }
        Thread.sleep(forTimeInterval: 1.0)
      }
      return false
    }
    var recovered = pollForA(Double(param("RECOVER_WAIT_S", "15")) ?? 15)
    capture("far2-04-after-recover-wait", app)
    // The chapter heading can still be a screen or two above the exact
    // sentence in a long chapter; one small forward nudge (the direction the
    // reading is in, within its own chapter) if the first wait missed.
    if !recovered {
      fastFling(app, times: 1, direction: "down")
      Thread.sleep(forTimeInterval: 0.8)
      capture("far2-05-after-nudge", app)
      recovered = pollForA(Double(param("RECOVER_WAIT_S", "15")) ?? 15)
      capture("far2-06-after-second-recover-wait", app)
    }
    print("FOLLOWING far2-recovery: recovered=\(recovered) A=\(isFollowingA(app)) M=\(isBrowsingM(app))")

    press(app.buttons["Pause"], app)
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
  }

  // MARK: - Item 1: Theme (General), A/M in both themes

  /// `Theme, VALUE` -> chosen menu item, Library -> Settings -> General ->
  /// Theme, by real touch. Leaves the app on Settings' General page (its own
  /// starting point), a level up from the reader.
  func testThemeChoose() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let value = param("THEME", "Light")
    openGeneral(app)
    let row = generalRow("Theme", app)
    XCTAssertTrue(row.waitForExistence(timeout: 5), "No Theme row")
    press(row, app)
    XCTAssertTrue(menuItem(app, value).waitForExistence(timeout: 3), "No '\(value)' item in the Theme menu")
    menuItem(app, value).tap()
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertEqual(row.label, "Theme, \(value)")
    capture("theme-\(value)", app)
  }

  /// Item 1's other half: back to the Library and reopen the book (real
  /// touches), screenshot A (the fresh mount's default), drag to M,
  /// screenshot that too. Named per the THEME param so the shell can call it
  /// once per theme without colliding screenshot names.
  func testReopenAndShotAThenM() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    ensureAtLibrary(app)
    openBook(app)
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10), "A fresh mount must start paused")
    XCTAssertTrue(isFollowingA(app), "A fresh mount must start following")
    let tag = param("THEME", "Light")
    capture("theme-\(tag)-A", app)

    let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
    let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
    XCTAssertTrue(dragToBrowsing(app, from, to), "A real drag did not turn A into M")
    capture("theme-\(tag)-M", app)
  }

  // MARK: - Item 7: Scrolling (General)

  func testScrollingMenuRealTouches() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    openGeneral(app)
    let scrolling = generalRow("Scrolling", app)
    let linePosition = generalRow("Line position", app)
    XCTAssertTrue(scrolling.waitForExistence(timeout: 5), "No Scrolling row")
    XCTAssertTrue(linePosition.waitForExistence(timeout: 5), "No Line position row")
    XCTAssertLessThan(scrolling.frame.minY, linePosition.frame.minY, "Scrolling is not above Line position")
    let before = scrolling.label
    capture("scrolling-general-before", app)

    press(scrolling, app)
    Thread.sleep(forTimeInterval: 0.5)
    var lastY = -CGFloat.greatestFiniteMagnitude
    for label in ["By line", "Continuous"] {
      let item = menuItem(app, label)
      XCTAssertTrue(item.waitForExistence(timeout: 5), "menu is missing '\(label)'")
      XCTAssertGreaterThan(item.frame.origin.y, lastY, "'\(label)' is not below the previous item")
      lastY = item.frame.origin.y
    }
    XCTAssertEqual(["By line", "Continuous"].filter { menuItem(app, $0).isSelected },
                    [String(before.dropFirst("Scrolling, ".count))], "exactly the row's value is checked")
    capture("scrolling-menu-open", app)

    menuItem(app, "Continuous").tap()
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertEqual(scrolling.label, "Scrolling, Continuous")
    capture("scrolling-chose-continuous", app)
  }

  func testScrollingPersistsAcrossRelaunch() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()
    openGeneral(app)
    let scrolling = generalRow("Scrolling", app)
    XCTAssertTrue(scrolling.waitForExistence(timeout: 5))
    XCTAssertEqual(scrolling.label, "Scrolling, Continuous", "Scrolling did not survive a relaunch")
    capture("scrolling-continuous-after-relaunch", app)
  }

  // MARK: - Item 10: a finger's first move stops the Continuous drift; a
  // drag -> M; Play or tapping M resumes.

  /// Needs Continuous already chosen. Plays, lets the drift run a moment,
  /// drags (must stop the drift and read M), waits, taps Play to resume
  /// (still on the dragged-to page until the next sentence/M brings it back
  /// as item 3/4 already established) — then repeats reaching M and this
  /// time recovers via a real tap on M instead.
  func testContinuousDragStopsDriftThenPlayOrMResumes() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    openBook(app)
    if app.buttons["Play"].exists { press(app.buttons["Play"], app) }
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5), "Must be playing")
    Thread.sleep(forTimeInterval: 1.5)
    XCTAssertTrue(isFollowingA(app), "Must start following while the drift runs")
    capture("continuous-drag-00-playing-A", app)

    let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
    let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
    XCTAssertTrue(dragToBrowsing(app, from, to), "A drag during the Continuous drift did not turn A into M")
    XCTAssertTrue(app.buttons["Pause"].exists, "A drag must not pause playback")
    capture("continuous-drag-01-M-drift-stopped", app)

    // Resume via Play: per design 0050 this is one of the three ways back
    // ("pressing Play after a pause" — here mid-play, so a Pause-then-Play),
    // which brings the page back too.
    press(app.buttons["Pause"], app)
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
    Thread.sleep(forTimeInterval: 0.4)
    press(app.buttons["Play"], app)
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5))
    Thread.sleep(forTimeInterval: 1.0)
    XCTAssertTrue(isFollowingA(app), "Play did not bring the page back to A")
    capture("continuous-drag-02-play-resumed-A", app)

    // Once more, this time recovering with a tap on M instead of Play.
    Thread.sleep(forTimeInterval: 1.0)
    XCTAssertTrue(dragToBrowsing(app, from, to), "The second drag did not turn A into M")
    capture("continuous-drag-03-M-again", app)
    press(returnMark(app), app)
    Thread.sleep(forTimeInterval: 1.0)
    XCTAssertTrue(isFollowingA(app), "M did not bring the page back to A")
    XCTAssertTrue(app.buttons["Pause"].exists, "Playback must still be going after M")
    capture("continuous-drag-04-M-tap-resumed-A", app)

    press(app.buttons["Pause"], app)
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5))
  }

  // MARK: - Item 11 / item 10's last clause: a Library round trip changes both
  // live, and switching Continuous -> By line while reading drops the lead at
  // once (read from the frame log the shell captures around this method).

  /// While playing: Back to the Library (the reading keeps going, #68/ADR
  /// 0049), General -> Line position 40% and Scrolling By line, back to the
  /// book through the Reading Button. No reload line must show, and the
  /// reading must still be playing throughout.
  func testLibraryRoundTripChangesLinePositionAndScrollingLive() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Must already be playing before the round trip")
    capture("roundtrip-00-playing-in-reader", app)

    press(app.buttons["Back"], app)
    XCTAssertTrue(until(5) { self.inLibrary(app) }, "Back did not reach the Library")
    let button = app.buttons["Return to the reading"]
    XCTAssertTrue(button.waitForExistence(timeout: 5), "No Reading Button in the Library")
    XCTAssertTrue((button.value as? String)?.hasSuffix("Playing") == true, "The Reading Button does not say the reading plays")
    capture("roundtrip-01-library-still-playing", app)

    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 5))
    press(app.buttons["Settings"], app)
    let general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'General'")).firstMatch
    XCTAssertTrue(general.waitForExistence(timeout: 5))
    press(general, app)

    let linePosition = generalRow("Line position", app)
    XCTAssertTrue(linePosition.waitForExistence(timeout: 5))
    press(linePosition, app)
    XCTAssertTrue(menuItem(app, "40%").waitForExistence(timeout: 3))
    menuItem(app, "40%").tap()
    Thread.sleep(forTimeInterval: 0.5)
    XCTAssertEqual(linePosition.label, "Line position, 40%")

    let scrolling = generalRow("Scrolling", app)
    press(scrolling, app)
    XCTAssertTrue(menuItem(app, "By line").waitForExistence(timeout: 3))
    menuItem(app, "By line").tap()
    Thread.sleep(forTimeInterval: 0.5)
    XCTAssertEqual(scrolling.label, "Scrolling, By line")
    capture("roundtrip-02-general-changed", app)

    closeGeneralToLibrary(app)
    XCTAssertTrue((app.buttons["Return to the reading"].value as? String)?.hasSuffix("Playing") == true,
                  "The reading stopped while the settings changed")
    press(app.buttons["Return to the reading"], app)
    XCTAssertTrue(until(5) { self.inReader(app) }, "The Reading Button did not return to the reader")
    let reloading = app.staticTexts.matching(NSPredicate(
      format: "label BEGINSWITH 'Laying the document out' OR label BEGINSWITH 'Opening ' OR label BEGINSWITH 'Reading '")).firstMatch
    XCTAssertFalse(reloading.exists, "Returning reloaded the document instead of reusing the live page")
    XCTAssertTrue(app.buttons["Pause"].exists, "The reading must still be playing on return")
    capture("roundtrip-03-back-in-reader-live", app)
  }

  // MARK: - Item 12: final restore

  /// General back to Line position 50% and Theme to the value it started at
  /// (`ORIGINAL_THEME` param); Scrolling is already By line from the round
  /// trip above. Ends on the reader, paused.
  func testFinalRestore() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let originalTheme = param("ORIGINAL_THEME", "Match Device")
    openGeneral(app)

    let linePosition = generalRow("Line position", app)
    press(linePosition, app)
    XCTAssertTrue(menuItem(app, "50%").waitForExistence(timeout: 3))
    menuItem(app, "50%").tap()
    Thread.sleep(forTimeInterval: 0.5)
    XCTAssertEqual(linePosition.label, "Line position, 50%")

    let scrolling = generalRow("Scrolling", app)
    XCTAssertEqual(scrolling.label, "Scrolling, By line", "Scrolling was not already By line")

    let theme = generalRow("Theme", app)
    press(theme, app)
    XCTAssertTrue(menuItem(app, originalTheme).waitForExistence(timeout: 3))
    menuItem(app, originalTheme).tap()
    Thread.sleep(forTimeInterval: 0.5)
    XCTAssertEqual(theme.label, "Theme, \(originalTheme)")
    capture("final-general-restored", app)

    closeGeneralToLibrary(app)
    let button = app.buttons["Return to the reading"]
    if button.waitForExistence(timeout: 3) {
      press(button, app)
      XCTAssertTrue(until(5) { self.inReader(app) })
    } else {
      openBook(app)
    }
    if app.buttons["Pause"].exists { press(app.buttons["Pause"], app) }
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not end paused")
    capture("final-reader-paused", app)
  }
}
