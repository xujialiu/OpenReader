import XCTest

/// Issue #25's offline half and its switch, with real touches: a download of
/// `Stat Line Fixture` (stat-line-fixture.ts) is named by each line's Speech
/// Text, so turning "Remove enclosing brackets when reading" off makes its
/// chapter need downloading again and turning it back on makes the saved audio
/// count again (design 0028). Never presses Play; the caller plays, briefly,
/// with stop-on-word.cjs between these methods.
///
/// - `testDownloadStatLines`: a cold launch, the Library's `...`, Download,
///   Select all, Download selected, and wait for `1 chapters downloaded`.
/// - `testFlipBracketSwitch`: attaches to the running app, which must be on
///   General (the harness's `{"do":"go","route":"General"}` pushes it over an
///   open reader, which the UI itself never does), flips the switch once, and
///   goes back.
/// - `testReadDownloadCount`: attaches to an open reader and prints the
///   Download drawer's count line.
final class BracketsProbe: XCTestCase {
  let book = "Stat Line Fixture"
  let switchLabel = "Remove enclosing brackets when reading"

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  var countLine: XCUIElementQuery {
    XCUIApplication(bundleIdentifier: "top.xujialiu.openreader").staticTexts
      .matching(NSPredicate(format: "label LIKE '* chapters downloaded'"))
  }

  func testDownloadStatLines() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()
    let ellipsis = app.buttons["Actions for " + book]
    if !ellipsis.waitForExistence(timeout: 10), app.buttons["Back"].exists { app.buttons["Back"].tap() }
    XCTAssertTrue(ellipsis.waitForExistence(timeout: 10), "\(book) must be in the Library")
    ellipsis.tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 5))
    app.buttons["Download"].tap()
    let select = app.buttons["Select all"]
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: select)
    XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed, "Select all never became available")
    select.tap()
    let start = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Download selected ('")).firstMatch
    XCTAssertTrue(start.isEnabled)
    let began = Date()
    start.tap()
    XCTAssertTrue(app.staticTexts["1 chapters downloaded"].waitForExistence(timeout: 90), "The fixture did not finish downloading")
    print("PROBE downloaded in \(String(format: "%.1f", Date().timeIntervalSince(began))) s")
    capture("stat-lines-downloaded", app)
    app.buttons["Close Download"].tap()
  }

  func testFlipBracketSwitch() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let flip = app.switches[switchLabel]
    XCTAssertTrue(flip.waitForExistence(timeout: 5), "General is not on screen")
    let before = flip.value as? String ?? "?"
    flip.tap()
    let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value != %@", before), object: flip)
    XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 3), .completed, "The switch did not change")
    print("PROBE bracket switch \(before) -> \(flip.value as? String ?? "?")")
    capture("general-after-flip", app)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 5), "Back did not return to a paused reader")
    capture("reader-after-flip", app)
  }

  func testReadDownloadCount() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 5), "No reader is open")
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 3))
    app.buttons["Download"].tap()
    XCTAssertTrue(countLine.firstMatch.waitForExistence(timeout: 10), "The Download drawer shows no count")
    Thread.sleep(forTimeInterval: 1)
    print("PROBE count: \(countLine.firstMatch.label)")
    capture("download-count", app)
    app.buttons["Close Download"].tap()
  }
}
