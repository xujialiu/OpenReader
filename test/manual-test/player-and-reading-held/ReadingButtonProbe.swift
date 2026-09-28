import XCTest

/// Real touches for #67: collapsing the player takes the navigation bar with it,
/// the Reading Button left in its place brings both back without playing or
/// pausing, a pause from the lock screen brings both back, and the edge swipe
/// still leaves the reader while they are hidden.
///
/// Expects `A Short Test of Reading Aloud` in the Library with a Voice that can
/// play (README, "Real books" for loading it), and the app already running
/// against this tree's Metro: `.activate()` only, never a relaunch. Each method
/// starts from the reader, paused, with the player shown, and leaves it so.
///
/// "The text did not move" is read off screenshots (`inkRows`): the first row
/// of text below the bar, and every row's ink down to the player, before and
/// after. It is measured at the top of the fixture, where the voice's centring
/// scrolls nothing for the first sentences (their middle is above the screen's),
/// so a move is the bar's and not the reading's.
final class ReadingButtonProbe: XCTestCase {
  let title = "A Short Test of Reading Aloud"

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  /// A screenshot alone, for the moments the voice is playing: the tree takes seconds.
  func shot(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func until(_ timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    repeat {
      if condition() { return true }
      Thread.sleep(forTimeInterval: 0.2)
    } while Date() < deadline
    return false
  }

  func readingButton(_ app: XCUIApplication) -> XCUIElement { app.buttons["Show the player"] }

  /// The bar is shown: its back arrow and More actions can be pressed.
  func barShown(_ app: XCUIApplication) -> Bool {
    app.buttons["More actions"].exists && app.buttons["More actions"].isHittable
  }

  /// The player is shown in full: its collapse chevron is there.
  func playerShown(_ app: XCUIApplication) -> Bool { app.buttons["Collapse the player"].exists }

  /// Where the text is, read off a screenshot: for each point row between the
  /// bar's bottom and the top of the player, how many sampled pixels differ from
  /// the page by more than ink does. The web page's text is not in the
  /// accessibility tree (its sections are iframes), so the screen is the only
  /// witness. The highlight is a pale fill and does not count as ink.
  func inkRows(_ app: XCUIApplication) -> [Int] {
    guard let image = XCUIScreen.main.screenshot().image.cgImage else { return [] }
    let width = image.width, height = image.height
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    guard let context = CGContext(data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return [] }
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    let scale = CGFloat(height) / app.frame.height
    func luminance(_ x: Int, _ y: Int) -> Int {
      let i = (y * width + x) * 4
      return (Int(pixels[i]) * 299 + Int(pixels[i + 1]) * 587 + Int(pixels[i + 2]) * 114) / 1000
    }
    // The page's own colour, from the margin beside the text.
    let page = luminance(Int(6 * scale), Int(400 * scale))
    var rows: [Int] = []
    for point in 120..<700 {
      let y = Int(CGFloat(point) * scale)
      var count = 0
      for x in stride(from: Int(24 * scale), to: Int(378 * scale), by: 3) where abs(luminance(x, y) - page) > 110 { count += 1 }
      rows.append(count)
    }
    return rows
  }

  /// The text once the page has stopped changing: the waiting line gone, then
  /// three readings half a second apart that agree. A reader just opened is
  /// still laying its sections out, and a reading taken then compares a
  /// waiting line with a full page.
  func settledInk(_ app: XCUIApplication, timeout: TimeInterval = 30) -> [Int] {
    // The reader's own waiting line ("Laying the document out…") is ink too, and
    // it stays put for seconds on a fresh open.
    let waiting = app.staticTexts.matching(NSPredicate(
      format: "label BEGINSWITH 'Laying the document out' OR label BEGINSWITH 'Opening ' OR label BEGINSWITH 'Reading '")).firstMatch
    _ = until(timeout) { !waiting.exists }
    var last = inkRows(app)
    var agreed = 0
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      Thread.sleep(forTimeInterval: 0.5)
      let now = inkRows(app)
      agreed = firstInk(now) != nil && zip(last, now).filter({ abs($0 - $1) > 4 }).count == 0 ? agreed + 1 : 0
      if agreed >= 2 { return now }
      last = now
    }
    return last
  }

  /// The first point row, from 120, with text on it.
  func firstInk(_ rows: [Int]) -> Int? { rows.firstIndex { $0 > 2 }.map { $0 + 120 } }

  func assertSameText(_ before: [Int], _ app: XCUIApplication, _ context: String) {
    assertSameRows(before, inkRows(app), context)
  }

  func assertSameRows(_ before: [Int], _ after: [Int], _ context: String) {
    let a = firstInk(before), b = firstInk(after)
    print("LINE \(context) first-ink before=\(a.map(String.init) ?? "none") after=\(b.map(String.init) ?? "none")")
    guard let a, let b else { XCTFail("\(context): no text found on screen"); return }
    XCTAssertEqual(a, b, "\(context): the first line moved by \(b - a) points")
    // And the whole band: every row's ink within a few pixels of what it was.
    let differing = zip(before, after).filter { abs($0 - $1) > 4 }.count
    print("LINE \(context) rows-differing=\(differing) of \(before.count)")
    XCTAssertLessThan(differing, 6, "\(context): \(differing) rows of text changed")
  }

  /// Into the fixture's reader, paused, the player shown and the bar with it.
  func openPaused(_ app: XCUIApplication) {
    app.activate()
    if !app.buttons["More actions"].exists && !readingButton(app).exists {
      // Whatever screen an earlier run left on top of the Library.
      var back = 0
      while !app.navigationBars["Library"].exists && app.buttons["BackButton"].exists && back < 6 {
        app.buttons["BackButton"].tap(); back += 1; Thread.sleep(forTimeInterval: 0.6)
      }
      let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title + ",")).firstMatch
      XCTAssertTrue(book.waitForExistence(timeout: 10), "The fixture is not in the Library")
      book.tap()
    }
    XCTAssertTrue(until(20) { app.buttons["Play"].exists || app.buttons["Pause"].exists || self.readingButton(app).exists }, "The reader did not open")
    if readingButton(app).exists { readingButton(app).tap() }
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Expected the reader paused")
    XCTAssertTrue(until(5) { self.barShown(app) }, "Expected the bar shown")
    // Let a page that has just laid out settle before any line is measured.
    _ = settledInk(app)
  }

  func pauseIfPlaying(_ app: XCUIApplication) {
    app.activate()
    if readingButton(app).exists { readingButton(app).tap() }
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
  }

  /// Collapse while playing: the bar and the player go, the text stays, the voice
  /// goes on; the Reading Button brings both back and the voice still goes on.
  ///
  /// Everything slow (the page's ink, the accessibility tree) is read while
  /// paused, before Play and after Pause: what the few seconds of voice have to
  /// establish is only that the reading is still playing after each press.
  func testCollapseWhilePlayingAndRestore() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openPaused(app)
    // Back to the fixture's first sentence, so the centring has nothing to
    // scroll: an earlier run leaves the reading wherever its voice took it. A
    // skip while paused moves the reading and the page with it; this fixture's
    // contents rows cannot be followed (README Pitfalls), and 19 Utterances
    // are fewer than 20 skips back by paragraph.
    for _ in 0..<20 { app.buttons["Previous paragraph"].tap() }
    XCTAssertTrue(app.buttons["Play"].exists, "Skipping while paused started playback")
    let before = settledInk(app)
    capture("01-paused-shown", app)

    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play did not start")
    app.buttons["Collapse the player"].tap()
    XCTAssertTrue(readingButton(app).waitForExistence(timeout: 3), "No Reading Button after collapsing")
    XCTAssertFalse(barShown(app), "The navigation bar stayed after collapsing")
    XCTAssertFalse(playerShown(app), "The player stayed after collapsing")
    XCTAssertFalse(app.buttons["Pause"].exists, "A Pause button is still on screen")
    // "busy, Playing" while the audio is still coming.
    XCTAssertTrue((readingButton(app).value as? String)?.hasSuffix("Playing") == true, "The Reading Button does not say the reading plays")
    shot("02-playing-collapsed")
    let collapsed = inkRows(app)

    readingButton(app).tap()
    XCTAssertTrue(until(3) { self.barShown(app) && self.playerShown(app) }, "The Reading Button did not bring back the bar and the player")
    XCTAssertTrue(app.buttons["Pause"].exists, "The Reading Button stopped the reading")
    shot("03-playing-restored")
    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause at the end")

    assertSameRows(before, collapsed, "collapse while playing")
    assertSameRows(collapsed, inkRows(app), "restore while playing")
    capture("04-paused-after", app)
  }

  /// Collapse while paused and press the Reading Button: both come back and
  /// nothing plays, and the text does not move either way.
  func testCollapseWhilePausedAndRestore() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openPaused(app)
    let before = settledInk(app)
    capture("11-paused-shown", app)

    app.buttons["Collapse the player"].tap()
    XCTAssertTrue(readingButton(app).waitForExistence(timeout: 3), "No Reading Button after collapsing")
    Thread.sleep(forTimeInterval: 0.5)
    capture("12-paused-collapsed", app)
    XCTAssertFalse(barShown(app), "The navigation bar stayed after collapsing")
    XCTAssertTrue((readingButton(app).value as? String)?.hasSuffix("Paused") == true, "The Reading Button does not say the reading is paused")
    assertSameText(before, app, "collapse while paused")

    let collapsedText = inkRows(app)
    readingButton(app).tap()
    XCTAssertTrue(until(3) { self.barShown(app) && self.playerShown(app) }, "The Reading Button did not bring back the bar and the player")
    // Long enough for a Play the press might have started to show as Pause.
    Thread.sleep(forTimeInterval: 1.5)
    capture("13-paused-restored", app)
    XCTAssertTrue(app.buttons["Play"].exists, "The Reading Button started the reading")
    XCTAssertFalse(app.buttons["Pause"].exists, "The Reading Button started the reading")
    assertSameText(collapsedText, app, "restore while paused")
  }

  /// A pause from the lock screen's own transport while collapsed brings back
  /// the bar and the player, as a pause from anywhere does.
  func testLockScreenPauseWhileCollapsed() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openPaused(app)
    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play did not start")
    app.buttons["Collapse the player"].tap()
    XCTAssertTrue(readingButton(app).waitForExistence(timeout: 3), "No Reading Button after collapsing")
    XCTAssertFalse(barShown(app), "The navigation bar stayed after collapsing")

    // The left of the top edge opens Notification Centre's lock-screen surface
    // (`LockScreenProbe`); the right opens Control Centre.
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.01))
      .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.7)))
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let center = springboard.buttons["UIA.MediaControls.NowPlaying.CenterButton"]
    guard center.waitForExistence(timeout: 5), center.label == "Pause" else {
      capture("21-no-lock-screen-pause", app)
      pauseIfPlaying(app)
      XCTFail("The lock screen offered no Pause")
      return
    }
    center.tap()
    let paused = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "Play"), object: center)
    XCTAssertEqual(XCTWaiter.wait(for: [paused], timeout: 3), .completed, "The lock screen's Pause did not take")
    capture("22-lock-screen-paused", app)
    app.activate()
    XCTAssertTrue(until(5) { self.barShown(app) && self.playerShown(app) }, "A lock-screen pause did not bring back the bar and the player")
    Thread.sleep(forTimeInterval: 0.5)
    capture("23-back-in-app", app)
    XCTAssertTrue(app.buttons["Play"].exists, "Expected the reading paused")
    pauseIfPlaying(app)
  }

  /// The platform's edge swipe still goes back to the Library while the bar is
  /// hidden, as the back arrow does.
  func testEdgeSwipeWhileCollapsed() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openPaused(app)
    app.buttons["Collapse the player"].tap()
    XCTAssertTrue(readingButton(app).waitForExistence(timeout: 3), "No Reading Button after collapsing")
    XCTAssertFalse(barShown(app), "The navigation bar stayed after collapsing")
    capture("31-collapsed-before-swipe", app)

    app.coordinate(withNormalizedOffset: CGVector(dx: 0.0, dy: 0.5))
      .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)))
    // Back to whatever was under the reader, which is the Library in use.
    XCTAssertTrue(until(5) { !self.readingButton(app).exists && !app.buttons["Collapse the player"].exists }, "The edge swipe did not leave the reader")
    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 3), "The edge swipe left the reader but not for the Library")
    capture("32-library-after-swipe", app)

    // Back in, for the next method.
    openPaused(app)
  }

  // MARK: - Independent verification beyond the implementer's own run
  // (test/manual-test/README.md, "#67", covers what each of these adds).

  func libraryReturnButton(_ app: XCUIApplication) -> XCUIElement { app.buttons["Return to the reading"] }
  func inLibrary(_ app: XCUIApplication) -> Bool { app.navigationBars["Library"].exists }
  func readerPausedAndShown(_ app: XCUIApplication) -> Bool { app.buttons["Play"].exists && barShown(app) }

  func swipeFromLeftEdge(_ app: XCUIApplication) {
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.0, dy: 0.5))
      .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)))
  }

  /// React Native's "Open debugger to view warnings." banner (ReadingHeldProbe
  /// carries the same helper): it can cover the bottom of the screen — the
  /// player's transport and the Reading Button both sit there — so a run that
  /// logs any warning can turn a later tap into one that lands on the banner
  /// instead. Dismissed by its own close button, never tapped anywhere else.
  func clearLogBox(_ app: XCUIApplication) {
    let banner = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Open debugger to view warnings'")).firstMatch
    guard banner.exists else { return }
    let frame = banner.frame
    app.coordinate(withNormalizedOffset: .zero)
      .withOffset(CGVector(dx: frame.maxX - 22, dy: frame.midY)).tap()
    _ = until(3) { !banner.exists }
  }

  /// A tap that clears the LogBox banner first, and tolerates one element that
  /// existed at the last check but has since gone stale (mid navigation
  /// transition): one retry after a short settle, rather than a hard XCTest
  /// failure ("No matches found") that stops a 40-trial measurement dead
  /// (measured: `testEdgeSwipeReliabilityMeasurement` lost the rest of its run
  /// to exactly that, tapping "Return to the reading" the instant `.exists`
  /// had just gone true).
  func safeTap(_ element: XCUIElement, _ app: XCUIApplication) {
    clearLogBox(app)
    if element.exists {
      element.tap()
    } else {
      Thread.sleep(forTimeInterval: 0.4)
      clearLogBox(app)
      if element.exists { element.tap() }
    }
  }

  /// Back to the reader, paused, the bar and player shown — from wherever a
  /// swipe (a hit or a miss) left the app. A Reading left playing is held in
  /// the Library (#68): its own "Return to the reading" row goes straight
  /// back, still collapsed if it was left so. Paused leaves nothing held, so
  /// the fixture's own row reopens it, which always remounts with `collapsed`
  /// at its default (false, shown). Either way, un-collapse and pause if it
  /// came back otherwise. No ink measurement here: this loop only cares about
  /// the buttons that decide the next trial's start state, not the text.
  func toReaderPausedShown(_ app: XCUIApplication) {
    var guard_ = 0
    while !readerPausedAndShown(app) && guard_ < 14 {
      if inLibrary(app) {
        if libraryReturnButton(app).exists {
          safeTap(libraryReturnButton(app), app)
        } else {
          let book = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title + ",")).firstMatch
          if book.waitForExistence(timeout: 8) { safeTap(book, app) }
        }
        _ = until(15) { self.playerShown(app) || self.readingButton(app).exists }
      } else if readingButton(app).exists {
        safeTap(readingButton(app), app)
      } else if app.buttons["Pause"].exists {
        safeTap(app.buttons["Pause"], app)
      } else if app.buttons["BackButton"].exists {
        // Stuck somewhere else (a sheet, say): the plain way out.
        safeTap(app.buttons["BackButton"], app)
      }
      guard_ += 1
      Thread.sleep(forTimeInterval: 0.4)
    }
  }

  /// The Reading Button's own pixels, cropped to its frame, by the same raw
  /// `CGContext` approach `inkRows` uses — so two frames can be compared for an
  /// exact match without a new image-encoding dependency.
  func buttonPixels(_ app: XCUIApplication) -> [UInt8] {
    guard let image = XCUIScreen.main.screenshot().image.cgImage else { return [] }
    let scale = CGFloat(image.width) / app.frame.width
    let f = readingButton(app).frame
    let rect = CGRect(x: (f.minX * scale).rounded(), y: (f.minY * scale).rounded(),
                       width: (f.width * scale).rounded(), height: (f.height * scale).rounded())
    guard rect.width > 0, rect.height > 0, let cropped = image.cropping(to: rect) else { return [] }
    let width = cropped.width, height = cropped.height
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    guard let context = CGContext(data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return [] }
    context.draw(cropped, in: CGRect(x: 0, y: 0, width: width, height: height))
    return pixels
  }

  /// #67's main open question, measured rather than asserted: how reliably an
  /// XCTest-synthesized left-edge swipe leaves the reader, collapsed against
  /// the bar shown (the pre-#67 shape) as a control, each paused and playing
  /// at varied delays after Play so the trials spread across roughly one
  /// Utterance's own length — a proxy for "did this land near the centring
  /// that runs on a Clip cue" (ADR 0048), since the WebView's own scroll state
  /// is not in the accessibility tree and cannot be read directly. One LINE
  /// per trial and a summary per condition: this is a measurement, not a
  /// pass/fail gate, and the report reads the rate off it.
  func testEdgeSwipeReliabilityMeasurement() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openPaused(app)

    var hits: [String: Int] = [:]
    var totals: [String: Int] = [:]

    func trial(_ condition: String, _ n: Int, _ extra: String) {
      swipeFromLeftEdge(app)
      let left = until(4) { self.inLibrary(app) }
      totals[condition, default: 0] += 1
      if left { hits[condition, default: 0] += 1 }
      print("LINE swipe cond=\(condition) trial=\(n) \(extra)result=\(left ? "hit" : "miss")")
      if !left {
        capture("swipe-miss-\(condition)-\(n)", app)
        if barShown(app), app.buttons["BackButton"].exists {
          safeTap(app.buttons["BackButton"], app)
        } else if readingButton(app).exists {
          safeTap(readingButton(app), app)
          if app.buttons["BackButton"].exists { safeTap(app.buttons["BackButton"], app) }
        }
        _ = until(6) { self.inLibrary(app) }
      }
      toReaderPausedShown(app)
    }

    let delays: [TimeInterval] = [0.1, 0.3, 0.5, 0.8, 1.1, 1.4, 1.8, 2.2, 2.6, 3.0]

    // 1) Collapsed, paused: no auto-scroll in play, the bar already hidden.
    toReaderPausedShown(app)
    for n in 1...10 {
      safeTap(app.buttons["Collapse the player"], app)
      _ = until(3) { self.readingButton(app).exists && !self.barShown(app) }
      trial("collapsed-paused", n, "")
    }

    // 2) Collapsed, playing, at the varied delays.
    toReaderPausedShown(app)
    for _ in 0..<20 { safeTap(app.buttons["Previous paragraph"], app) }
    for (i, delay) in delays.enumerated() {
      toReaderPausedShown(app)
      safeTap(app.buttons["Play"], app)
      _ = until(6) { app.buttons["Pause"].exists }
      safeTap(app.buttons["Collapse the player"], app)
      _ = until(3) { self.readingButton(app).exists && !self.barShown(app) }
      Thread.sleep(forTimeInterval: delay)
      let t = Date().timeIntervalSince1970
      trial("collapsed-playing", i + 1, "delay=\(String(format: "%.2f", delay)) t=\(String(format: "%.3f", t)) ")
    }

    // 3) Bar shown, paused — the pre-#67 control.
    toReaderPausedShown(app)
    for n in 1...10 {
      trial("shown-paused", n, "")
    }

    // 4) Bar shown, playing — the pre-#67 control, same delays.
    toReaderPausedShown(app)
    for _ in 0..<20 { safeTap(app.buttons["Previous paragraph"], app) }
    for (i, delay) in delays.enumerated() {
      toReaderPausedShown(app)
      safeTap(app.buttons["Play"], app)
      _ = until(6) { app.buttons["Pause"].exists }
      Thread.sleep(forTimeInterval: delay)
      let t = Date().timeIntervalSince1970
      trial("shown-playing", i + 1, "delay=\(String(format: "%.2f", delay)) t=\(String(format: "%.3f", t)) ")
    }

    for condition in ["collapsed-paused", "collapsed-playing", "shown-paused", "shown-playing"] {
      print("LINE swipe-summary cond=\(condition) hits=\(hits[condition] ?? 0) of \(totals[condition] ?? 0)")
    }
    toReaderPausedShown(app)
  }

  /// The Reading Button visually: the waveform's `variableColor` effect
  /// moving while the reading plays, still while paused, and pressing it
  /// during buffering (right after Play, before the first Clip can have
  /// arrived over the network) never starts or stops the reading. The
  /// waveform's own SF Symbol pixels are drawn natively and are not in the
  /// accessibility tree (`reading-button.tsx`), so "moving" and "still" are
  /// read off the button's own cropped pixels, two frames apart — the
  /// screenshots are additionally kept for a visual look at the spinner
  /// (buffering has no accessibility trait an XCUIElement can read back, so
  /// catching it is visual evidence, not a programmatic one). This also
  /// prints the button's accessibility label and value at each state: what
  /// VoiceOver would announce, read off the same tree XCTest queries.
  func testReadingButtonDuringBufferingAndWaveform() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openPaused(app)

    app.buttons["Collapse the player"].tap()
    XCTAssertTrue(readingButton(app).waitForExistence(timeout: 3), "No Reading Button after collapsing")
    print("LINE ax label=\"\(readingButton(app).label)\" value=\"\(readingButton(app).value ?? "")\" state=paused")
    let pausedA = buttonPixels(app)
    Thread.sleep(forTimeInterval: 0.6)
    let pausedB = buttonPixels(app)
    shot("40-waveform-paused")
    print("LINE waveform paused frames-identical=\(pausedA == pausedB) bytes=\(pausedA.count)")

    readingButton(app).tap()
    XCTAssertTrue(until(3) { self.barShown(app) }, "The Reading Button did not restore the bar")
    app.buttons["Play"].tap()
    app.buttons["Collapse the player"].tap()
    _ = until(2) { self.readingButton(app).exists }
    shot("41-reading-button-just-after-play")
    print("LINE ax label=\"\(readingButton(app).label)\" value=\"\(readingButton(app).value ?? "")\" state=just-after-play")
    readingButton(app).tap()
    XCTAssertTrue(until(3) { self.barShown(app) && self.playerShown(app) }, "The Reading Button did not restore the bar and the player")
    XCTAssertTrue(app.buttons["Pause"].exists, "Pressing the Reading Button just after Play paused the reading")
    shot("42-restored-after-buffering-press")

    _ = until(6) { app.buttons["Pause"].exists }
    Thread.sleep(forTimeInterval: 1.0)
    app.buttons["Collapse the player"].tap()
    XCTAssertTrue(readingButton(app).waitForExistence(timeout: 3), "No Reading Button after collapsing while playing")
    print("LINE ax label=\"\(readingButton(app).label)\" value=\"\(readingButton(app).value ?? "")\" state=playing")
    let playingA = buttonPixels(app)
    Thread.sleep(forTimeInterval: 0.5)
    let playingB = buttonPixels(app)
    shot("43-waveform-playing")
    print("LINE waveform playing frames-identical=\(playingA == playingB) bytes=\(playingA.count)")

    readingButton(app).tap()
    XCTAssertTrue(until(3) { self.barShown(app) && self.playerShown(app) }, "The Reading Button did not restore the bar and the player")
    XCTAssertTrue(app.buttons["Pause"].exists, "The Reading Button stopped the reading")
    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause")
  }

  /// The text does not move even when an Utterance change's own centring runs
  /// while the player is collapsed. Unlike `testCollapseWhilePlayingAndRestore`,
  /// this does not return to the fixture's first sentence, so the centring has
  /// something to scroll, and stays collapsed for several seconds — long
  /// enough at this fixture's pace to cross at least one Utterance while
  /// hidden. What is compared is each transition's own instant (just before
  /// collapsing against just after, and just before restoring against just
  /// after), not the whole interval in between, which the voice's own
  /// centring is expected to scroll.
  func testCollapseRestoreAcrossUtteranceChange() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openPaused(app)
    for _ in 0..<3 { app.buttons["Next sentence"].tap() }
    Thread.sleep(forTimeInterval: 0.3)

    app.buttons["Play"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 10), "Play did not start")
    // Play's own centring (ADR 0011) can still be settling into whichever
    // Utterance the three skips above landed on — unlike the fixture's first
    // sentence, its middle is not already above the screen. Wait for the page
    // to stop moving on its own before the collapse-instant comparison below,
    // or that settling — not the collapse — would be what gets measured.
    let beforeCollapse = settledInk(app, timeout: 10)

    app.buttons["Collapse the player"].tap()
    XCTAssertTrue(readingButton(app).waitForExistence(timeout: 3), "No Reading Button after collapsing")
    let afterCollapse = inkRows(app)
    assertSameRows(beforeCollapse, afterCollapse, "collapse mid-book, the instant of collapsing")

    Thread.sleep(forTimeInterval: 5.0)
    XCTAssertTrue((readingButton(app).value as? String)?.hasSuffix("Playing") == true, "The reading stopped while collapsed")
    let beforeRestore = inkRows(app)

    readingButton(app).tap()
    XCTAssertTrue(until(3) { self.barShown(app) && self.playerShown(app) }, "The Reading Button did not restore the bar and the player")
    let afterRestore = inkRows(app)
    assertSameRows(beforeRestore, afterRestore, "restore mid-book, the instant of restoring, after Utterances crossed hidden")
    capture("44-restored-mid-book", app)

    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Did not pause")
  }

  /// A Contents row for the chapter already on the page lands its heading
  /// below the bar while the bar is shown — the case ADR 0048 calls out by
  /// name (a chapter already rendered is reached by `offset()`, not `moveTo`,
  /// and only the wrapped `offset()` accounts for the bar's reserve).
  ///
  /// Not on the fixture: measured here first, its own Contents rows are all
  /// `unreachable` (`contents-sheet.tsx`'s own note, "the contents live in a
  /// different folder from the pages... so the list can be read but not
  /// followed") — a pre-existing property of `short-test-fixture.ts`'s
  /// nav.xhtml, unrelated to #67, and a tap on an unreachable row does
  /// nothing: the sheet stayed open on the row tapped. Real books match, so
  /// this uses "Shadow Slave — Chapters 1–250" (README, "Real books"),
  /// returning to the Library paused afterwards.
  ///
  /// Also one confirmatory shot of the fixture's own top, back at Utterance 0,
  /// below the bar: the "book opened fresh" case ADR 0048's own recording
  /// already measured to the pixel (its facts section), so this is a second,
  /// independent look at the shipped build rather than new coverage.
  func testContentsRowLandsBelowBar() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openPaused(app)
    app.buttons["BackButton"].tap()
    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5), "Back did not reach the Library")
    let shadowSlave = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Shadow Slave'")).firstMatch
    XCTAssertTrue(shadowSlave.waitForExistence(timeout: 5), "Shadow Slave is not in the Library")
    shadowSlave.tap()
    XCTAssertTrue(until(20) { app.buttons["Play"].exists || app.buttons["Pause"].exists }, "Shadow Slave did not open")
    if app.buttons["Pause"].exists {
      app.buttons["Pause"].tap()
      _ = until(5) { app.buttons["Play"].exists }
    }
    XCTAssertTrue(until(5) { self.barShown(app) }, "Expected the bar shown")

    app.buttons["Contents"].tap()
    let sheetTitle = app.staticTexts["Contents"].firstMatch
    XCTAssertTrue(sheetTitle.waitForExistence(timeout: 5), "Contents did not open")
    let unreachableNote = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'can be read but not followed'")).firstMatch
    XCTAssertFalse(unreachableNote.exists, "Shadow Slave's own Contents rows are unreachable too; pick a different real book")
    let currentRow = app.buttons.matching(NSPredicate(format: "isSelected == YES")).firstMatch
    let row = currentRow.exists ? currentRow : app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Chapter '")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5), "No Contents row to choose")
    let rowLabel = row.label
    row.tap()
    XCTAssertTrue(until(5) { !sheetTitle.exists }, "Contents did not close after choosing \"\(rowLabel)\"")
    Thread.sleep(forTimeInterval: 0.8)
    let first = firstInk(inkRows(app))
    print("LINE contents-row=\"\(rowLabel)\" first-ink=\(first.map(String.init) ?? "none")")
    XCTAssertNotNil(first, "No text visible after choosing a Contents row")
    capture("45-contents-row-landed", app)

    app.buttons["BackButton"].tap()
    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5), "Back did not reach the Library after Shadow Slave")

    // Back to the fixture's own top, Utterance 0, for the fresh-open
    // comparison ADR 0048's own recording already measured (facts section,
    // y=437px in 289 frames) — a second, independent look at the shipped build.
    openPaused(app)
    for _ in 0..<20 { app.buttons["Previous paragraph"].tap() }
    Thread.sleep(forTimeInterval: 0.5)
    let topFirst = firstInk(inkRows(app))
    print("LINE fresh-top first-ink=\(topFirst.map(String.init) ?? "none")")
    XCTAssertNotNil(topFirst, "No text visible at the book's own top")
    capture("46-fresh-top", app)
  }
}
