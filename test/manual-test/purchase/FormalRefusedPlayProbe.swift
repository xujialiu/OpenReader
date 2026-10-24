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
    app.terminate()
    app.launch() // cold launch: empty clip cache
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'A Short Test of Reading Aloud'")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 20), "Library row did not appear")
    print("FORMAL row label: \(row.label)")
    row.tap()

    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 20), "Reader Play button did not appear")
    play.tap()

    let gate = app.alerts.matching(NSPredicate(format:
      "label == 'Read Aloud Free for 30 Days' OR label == 'Your Free Trial Has Ended' OR label == 'Purchases Unavailable'")).firstMatch
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
}
