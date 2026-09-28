import XCTest

/// Issue #24 with real touches: every enabled Provider is asked for its Voices
/// as the app starts, so a voice sheet opened a few seconds after a cold start
/// already lists them, without "Asking Fish Audio for its Voices…". Then the
/// Voice #23 is checked with: Dax, chosen from en-US by touch, which is a
/// preference while paused and sends nothing. Never presses Play.
///
/// Needs `Stat Line Fixture` (stat-line-fixture.ts) in the Library and Fish
/// enabled with its key. What it cannot tell: whether the listing came from the
/// start-up request or from one the sheet sent itself — only that none was
/// being waited for. The Metro log with the harness's `watchfetch` shows the
/// requests.
final class VoiceListProbe: XCTestCase {
  let book = "Stat Line Fixture"
  let asking = "Asking Fish Audio for its Voices…"
  let dax = "Dax — Casual US male (EN)"

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func since(_ start: Date) -> String { String(format: "%.1f", Date().timeIntervalSince(start)) }

  func testColdStartSheetAlreadyListed() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    let launched = Date()
    app.launch()
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", book + ",")).firstMatch
    // State restoration can land in the last reader; its back button is `Back`.
    if !row.waitForExistence(timeout: 10), app.buttons["Back"].exists { app.buttons["Back"].tap() }
    XCTAssertTrue(row.waitForExistence(timeout: 10), "\(book) must already be in the Library")
    print("PROBE library row at \(since(launched)) s")
    // A few seconds, about what it takes a person to reach a book.
    let wait = 5.0 - Date().timeIntervalSince(launched)
    if wait > 0 { Thread.sleep(forTimeInterval: wait) }
    row.tap()
    let voice = app.buttons["Choose a Voice"]
    XCTAssertTrue(voice.waitForExistence(timeout: 15), "The reader did not open")
    voice.tap()
    print("PROBE sheet opened at \(since(launched)) s")
    // At once, before anything could have been fetched for the sheet itself.
    let enUS = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'en-US'")).firstMatch
    XCTAssertTrue(enUS.waitForExistence(timeout: 1), "#24: no locale row as the sheet opened")
    XCTAssertFalse(app.staticTexts[asking].exists, "#24: the sheet was still asking for the Voices")
    // A React Native radio is not a `.radioButton` to XCUI (README Pitfalls), so
    // the provider chips are found by their labels.
    let providers = ["OpenAI", "OpenAI Compatible", "Azure", "Speechify", "Fish Audio", "Kokoro FastAPI"].filter {
      app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", $0)).firstMatch.exists
    }
    print("PROBE provider chips on opening: \(providers.joined(separator: ", "))")
    capture("voice-sheet-on-opening", app)

    enUS.tap()
    let daxRow = app.buttons[dax]
    XCTAssertTrue(daxRow.waitForExistence(timeout: 3), "Dax is missing from en-US")
    daxRow.tap()
    // A paused choice leaves the sheet open and marks the row (ReaderProbe).
    let chosen = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isSelected == true"), object: daxRow)
    XCTAssertEqual(XCTWaiter.wait(for: [chosen], timeout: 5), .completed, "Dax was not marked as chosen")
    XCTAssertFalse(app.staticTexts[asking].exists)
    capture("dax-chosen", app)
    app.buttons["Close Voice"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 3), "The reader is not paused after closing Voice")
    capture("reader-after-choice", app)
  }
}
