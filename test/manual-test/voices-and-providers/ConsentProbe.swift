import XCTest

/// Real touches for #109 (`consent.md`): a long press on a word of the reading
/// page is the owner asking for Word Lookup, and the phone's own alert asks
/// before the selection leaves the phone. The gesture is a coordinate touch in
/// the reader's WebView (an AXe long press does not start a lookup,
/// `pitfalls/mcp.md`); the alert and its buttons are read through XCUITest, and
/// every alert's title, message and buttons are printed as `CONSENT` lines so
/// the words, and not only a screenshot, are the evidence.
///
/// Prerequisites: the reader open on `A Short Test of Reading Aloud`, Word
/// Lookup on (`lookup.enabled`, set through the harness), and the recipient's
/// answer cleared or kept as the method needs. Nothing here plays.
final class ConsentProbe: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")

  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func capture(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"
    tree.lifetime = .keepAlways
    add(tree)
  }

  /// The alert's words, from the accessibility tree: what the phone drew.
  func say(_ alert: XCUIElement, _ what: String) {
    let texts = alert.staticTexts.allElementsBoundByIndex.map(\.label)
    let buttons = alert.buttons.allElementsBoundByIndex.map(\.label)
    print("CONSENT \(what) alert label=\(alert.label.debugDescription) texts=\(texts.debugDescription) buttons=\(buttons.debugDescription)")
  }

  /// Presses on the reading page at each visible line in turn until an alert or
  /// the lookup drawer answers, so the test does not depend on where the
  /// reading's own highlight happens to be. Returns "alert" when the alert came
  /// within `wait` seconds of the press (the drawer opens first and the alert a
  /// moment later, so the drawer alone is not an answer), "drawer" when only the
  /// drawer did, and "nothing" otherwise.
  @discardableResult
  func longPressUntilSomethingAnswers(wait: TimeInterval = 5) -> String {
    app.activate()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 10), "The reader is not open")
    let loading = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS 'Laying the document out'")).firstMatch
    let deadline = Date().addingTimeInterval(20)
    while loading.exists && Date() < deadline { Thread.sleep(forTimeInterval: 0.5) }
    for y: CGFloat in [0.31, 0.22, 0.48, 0.60] {
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: y)).press(forDuration: 1.0)
      let end = Date().addingTimeInterval(wait)
      while Date() < end {
        if app.alerts.firstMatch.exists { return "alert" }
        Thread.sleep(forTimeInterval: 0.1)
      }
      if app.buttons["Close lookup"].exists { return "drawer" }
    }
    return "nothing"
  }

  /// The first lookup with a service: asked, "Don't Allow" sends nothing and
  /// closes the drawer.
  func testLookupDontAllow() throws {
    let answered = longPressUntilSomethingAnswers()
    XCTAssertEqual(answered, "alert", "A long press did not raise the alert (it raised \(answered))")
    let alert = app.alerts.firstMatch
    say(alert, "lookup before answering")
    // The alert is in the tree before it has finished drawing; a screenshot taken at once shows the page without it.
    Thread.sleep(forTimeInterval: 1.2)
    capture("consent-lookup-alert")
    let refuse = alert.buttons["Don't Allow"]
    XCTAssertTrue(refuse.exists, "The alert has no Don't Allow")
    XCTAssertTrue(alert.buttons["Allow"].exists, "The alert has no Allow")
    refuse.tap()
    let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.buttons["Close lookup"])
    let closed = XCTWaiter.wait(for: [gone], timeout: 4) == .completed
    print("CONSENT lookup after Don't Allow: drawer closed=\(closed) alertGone=\(!app.alerts.firstMatch.exists)")
    capture("consent-lookup-after-dont-allow")
    XCTAssertTrue(closed, "Don't Allow left the lookup drawer open")
    XCTAssertFalse(app.alerts.firstMatch.exists, "The alert came back by itself")
  }

  /// The next lookup asks again (a no is not remembered), and "Allow" shows the result.
  func testLookupAllow() throws {
    let answered = longPressUntilSomethingAnswers()
    XCTAssertEqual(answered, "alert", "A long press did not raise the alert (it raised \(answered))")
    let alert = app.alerts.firstMatch
    say(alert, "lookup before answering")
    Thread.sleep(forTimeInterval: 1.2)
    capture("consent-lookup-alert-again")
    alert.buttons["Allow"].tap()
    let result = app.buttons["Copy result"]
    let retry = app.buttons["Retry"]
    let end = Date().addingTimeInterval(25)
    while Date() < end && !result.exists && !retry.exists { Thread.sleep(forTimeInterval: 0.25) }
    print("CONSENT lookup after Allow: result=\(result.exists) retry=\(retry.exists)")
    capture("consent-lookup-after-allow")
    XCTAssertTrue(result.exists || retry.exists, "Allow showed neither a result nor a Retry")
    XCTAssertTrue(result.exists, "Allow reached no result (Retry showing = the service was unreachable)")
    app.buttons["Close lookup"].tap()
  }

  /// A yes is kept: the same service is not asked about again.
  func testLookupNotAskedAgain() throws {
    let answered = longPressUntilSomethingAnswers()
    print("CONSENT lookup with a kept yes: answered=\(answered)")
    XCTAssertEqual(answered, "drawer", "A kept yes was asked about again (or nothing opened): \(answered)")
    let result = app.buttons["Copy result"]
    let retry = app.buttons["Retry"]
    let end = Date().addingTimeInterval(25)
    while Date() < end && !result.exists && !retry.exists { Thread.sleep(forTimeInterval: 0.25) }
    print("CONSENT lookup with a kept yes: result=\(result.exists) retry=\(retry.exists) alert=\(app.alerts.firstMatch.exists)")
    capture("consent-lookup-kept")
    XCTAssertFalse(app.alerts.firstMatch.exists)
    app.buttons["Close lookup"].tap()
  }
}
