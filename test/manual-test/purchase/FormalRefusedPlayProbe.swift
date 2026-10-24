import XCTest

/// Formal-role refused-Play control (#324): on an account-less simulator with
/// no local StoreKit session, a real Play touch must be refused — the centre
/// button stays Play (or returns to it) and no purchase state may be invented.
/// The player's note is captured from the tree attachments; the fake provider's
/// request log is the caller's "nothing was sent" evidence.
///
///   bash test/manual-test/kit/run-probe.sh FormalRefusedPlayProbe UDID OUT \
///     -only-testing:testRefusedPlay
final class FormalRefusedPlayProbe: XCTestCase {
  private let gate = NSPredicate(format:
    "label == 'Read Aloud Free for 30 Days' OR label == 'Your Free Trial Has Ended' OR label == 'Purchases Unavailable'")

  /// The row is the caller's choice (a genuinely uncached document for the
  /// download refusal); the untouched default is the long-staged fixture.
  private func openRow(_ app: XCUIApplication) {
    let label = ProcessInfo.processInfo.environment["OPENREADER_ROW_LABEL"] ?? "A Short Test of Reading Aloud"
    app.terminate()
    app.launch() // cold launch: empty clip cache
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 20), "Library row '\(label)' did not appear")
    print("FORMAL row label: \(row.label)")
    row.tap()
  }

  func testRefusedPlay() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openRow(app)

    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 20), "Reader Play button did not appear")
    play.tap()

    let gate = app.alerts.matching(self.gate).firstMatch
    guard gate.waitForExistence(timeout: 8) else {
      XCTFail("No purchase gate was observed; a stopped Provider or idle Play button is not refusal evidence")
      return
    }
    print("FORMAL purchase-gate: \(gate.label)")
    let stillPlay = app.buttons["Play"].exists
    print("FORMAL while gate is open: centre button is \(stillPlay ? "Play" : "Pause")")

    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = "formal-refused-play"; image.lifetime = .keepAlways; add(image)
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = "formal-refused-tree"; tree.lifetime = .keepAlways; add(tree)

    XCTAssertTrue(stillPlay, "The formal copy started playback while its purchase gate was open")
    if gate.buttons["Not Now"].exists { gate.buttons["Not Now"].tap() }
    else if gate.buttons["OK"].exists { gate.buttons["OK"].tap() }
    XCTAssertFalse(app.buttons["Pause"].exists, "Cancelling the purchase gate started speech")
  }

  /// A real Download touch on an uncached chapter must meet the same purchase
  /// gate; cancelling leaves that chapter un-downloaded. The chapter is the
  /// caller's choice (default the one staged for the free download proof); the
  /// rest of the drawer may already hold downloaded chapters.
  func testRefusedDownload() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    let chapterLabel = ProcessInfo.processInfo.environment["OPENREADER_CHAPTER_LABEL"] ?? "The Downloaded Chapter"
    openRow(app)
    let more = app.buttons["More actions"]
    XCTAssertTrue(more.waitForExistence(timeout: 10), "Reader actions button did not appear")
    more.tap()
    let download = app.buttons["Download"]
    XCTAssertTrue(download.waitForExistence(timeout: 10), "Download action did not appear")
    download.tap()
    let chapter = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", chapterLabel)).firstMatch
    XCTAssertTrue(chapter.waitForExistence(timeout: 10), "Download drawer did not list \(chapterLabel)")
    chapter.tap()
    let selected = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Download selected'")).firstMatch
    XCTAssertTrue(selected.waitForExistence(timeout: 5), "No 'Download selected' button after selecting the chapter")
    selected.tap()

    let gate = app.alerts.matching(self.gate).firstMatch
    guard gate.waitForExistence(timeout: 10) else {
      XCTFail("No purchase gate met the Download in the formal copy; the download proceeding ungated is a defect")
      return
    }
    print("FORMAL download-gate: \(gate.label)")
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = "formal-refused-download"; image.lifetime = .keepAlways; add(image)

    if gate.buttons["Not Now"].exists { gate.buttons["Not Now"].tap() }
    else if gate.buttons["OK"].exists { gate.buttons["OK"].tap() }
    let after = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", chapterLabel)).firstMatch
    XCTAssertTrue(after.waitForExistence(timeout: 8), "Download drawer did not stay open over \(chapterLabel)")
    XCTAssertFalse(after.label.contains(", downloaded"), "\(chapterLabel) became downloaded although the purchase gate refused it (label: \(after.label))")
    print("FORMAL download-gate: cancelled; \(chapterLabel) still not downloaded (\(after.label))")
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = "formal-refused-download-tree"; tree.lifetime = .keepAlways; add(tree)
    let back = app.buttons["Back from Download"]
    if back.exists { back.tap() }
  }
}
