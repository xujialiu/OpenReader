import XCTest

/// Real touches for the #323/#274 Preferred Lookup Mode (design 0051 as
/// revised). Complements the interactive verification recorded in the
/// recipe: the renamed Settings entry and header, both switches on with the
/// English → English direction and the English target, and an explicit
/// Translation choice on the drawer's segmented control surviving a cold
/// relaunch and applying to a new single-word selection.
///
/// It needs `Word Boundaries for Lookup` in the Library
/// (`../fixtures/lookup-words-fixture.ts`) and consent for the Free
/// Dictionary API and Youdao already allowed (or it answers the exact
/// expected alerts). It never plays audio and never plants settings; the
/// preserved-old-choices and automatic-multiword checks need file planting
/// and handle drags, which the recipe covers.
final class LookupModeProbe: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")

  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func capture(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
  }

  func any(label: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
  }

  /// The long-press point on `hope` in the fixture's first paragraph: a real
  /// coordinate in the WebView, above the drawer's Half-screen top (432 pt).
  var hopePoint: XCUICoordinate {
    app.coordinate(withNormalizedOffset: CGVector(dx: 56.0 / 402.0, dy: 340.0 / 874.0))
  }

  func answerLookupConsent() {
    let allow = app.alerts.matching(NSPredicate(format: "label BEGINSWITH 'Send selected text to'")).firstMatch.buttons["Allow"]
    if allow.waitForExistence(timeout: 4) { allow.tap() }
  }

  func openLibraryRow(_ prefix: String) {
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 15), "Library row missing: \(prefix)")
    row.tap()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 20), "Reader did not open")
    let loading = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS 'Laying the document out'")).firstMatch
    let deadline = Date().addingTimeInterval(60)
    while loading.exists && Date() < deadline { Thread.sleep(forTimeInterval: 0.5) }
    XCTAssertFalse(loading.exists, "Reader layout did not finish")
  }

  func longPressHopeWord() {
    hopePoint.press(forDuration: 1.2)
    answerLookupConsent()
    XCTAssertTrue(app.buttons["Dictionary"].waitForExistence(timeout: 20), "Long press did not open the lookup drawer")
  }

  func testSettingsEntryHeaderAndCurrentSwitches() throws {
    app.terminate()
    app.launch()
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 20), "Library did not appear")
    app.buttons["Settings"].tap()
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5), "Settings did not open")
    // #323 renamed the entry from "Word Lookup & Translation".
    let row = app.buttons["Dictionary & Translation"]
    XCTAssertTrue(row.waitForExistence(timeout: 5), "The renamed Dictionary & Translation entry is missing")
    XCTAssertFalse(app.buttons["Word Lookup & Translation"].exists, "The old entry name is still present")
    row.tap()
    XCTAssertTrue(app.navigationBars["Dictionary & Translation"].waitForExistence(timeout: 5), "The renamed header is missing")
    XCTAssertEqual((app.switches["Long-press lookup"].value as? String) ?? "", "1", "Lookup switch must be on (fresh default or saved on)")
    XCTAssertEqual((app.switches["Pause reading during lookup"].value as? String) ?? "", "1", "Pause-during-lookup must be on")
    XCTAssertTrue(any(label: "Direction, English → English").exists, "Direction must read English → English")
    XCTAssertTrue(any(label: "Translate into, English").exists, "Translation target must read English")
    capture("lookupmode-settings-entry-and-choices")
  }

  func testExplicitTranslationPersistsAcrossRelaunch() throws {
    app.terminate()
    app.launch()
    openLibraryRow("Word Boundaries for Lookup")
    longPressHopeWord()
    XCTAssertTrue(app.buttons["Dictionary"].isSelected, "The drawer must open on the saved preferred mode first")
    app.buttons["Translation"].tap()
    answerLookupConsent()
    let deadline = Date().addingTimeInterval(5)
    while !app.buttons["Translation"].isSelected && Date() < deadline { Thread.sleep(forTimeInterval: 0.2) }
    XCTAssertTrue(app.buttons["Translation"].isSelected, "The explicit Translation touch did not select Translation")
    capture("lookupmode-explicit-translation")

    // Cold relaunch: the choice is device-local, so a new selection must open
    // Translation without touching the segmented control again.
    app.terminate()
    app.launch()
    openLibraryRow("Word Boundaries for Lookup")
    longPressHopeWord()
    XCTAssertTrue(app.buttons["Translation"].isSelected, "The preferred Translation did not survive the relaunch")
    capture("lookupmode-preferred-after-relaunch")
  }
}
