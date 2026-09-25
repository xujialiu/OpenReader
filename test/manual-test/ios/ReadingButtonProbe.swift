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
}
