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
  func testRefusedPlay() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    if app.state == .runningForeground { app.terminate() }
    app.launch() // cold launch: empty clip cache
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'A Short Test of Reading Aloud'")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 20), "Library row did not appear")
    print("FORMAL row label: \(row.label)")
    row.tap()

    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 20), "Reader Play button did not appear")
    play.tap()

    Thread.sleep(forTimeInterval: 5)
    let stillPlay = app.buttons["Play"].exists
    print("FORMAL after 5s: centre button is \(stillPlay ? "Play (refused)" : "Pause (started!)")")
    let note = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'could not' OR label CONTAINS 'Purchase' OR label CONTAINS 'verified' OR label CONTAINS 'unavailable'")).firstMatch
    if note.exists { print("FORMAL note: \(note.label)") }

    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = "formal-refused-play"; image.lifetime = .keepAlways; add(image)
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = "formal-refused-tree"; tree.lifetime = .keepAlways; add(tree)

    XCTAssertTrue(stillPlay, "The formal copy started playback without a verifiable purchase state")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
  }
}
