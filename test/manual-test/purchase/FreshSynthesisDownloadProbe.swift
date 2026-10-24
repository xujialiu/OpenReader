import XCTest

/// Free-copy fresh-synthesis and fresh-download controls (#324). The document
/// (env `OPENREADER_ROW_LABEL`, default "Boundary Fixture") is staged never to
/// have been spoken or downloaded, so every clip request the fake provider's
/// journal records after these runs is genuinely new. The caller snapshots the
/// journal before and diffs after; these probes assert the app side: a real
/// Play produces speech controls and no purchase gate, and a real Download
/// marks the chapter downloaded — also with no purchase gate, because the free
/// copy has no purchase module at all.
///
///   bash test/manual-test/kit/run-probe.sh FreshSynthesisDownloadProbe UDID OUT \
///     -only-testing:testFreshPlay|testFreshDownload
final class FreshSynthesisDownloadProbe: XCTestCase {
  private let gate = NSPredicate(format:
    "label == 'Read Aloud Free for 30 Days' OR label == 'Your Free Trial Has Ended' OR label == 'Purchases Unavailable'")

  private func openRow(_ app: XCUIApplication) -> XCUIElement {
    let label = ProcessInfo.processInfo.environment["OPENREADER_ROW_LABEL"] ?? "Boundary Fixture"
    app.terminate()
    app.launch() // cold launch: empty clip cache
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 20), "Library row '\(label)' did not appear")
    row.tap()
    return row
  }

  private func assertNoGate(_ app: XCUIApplication, _ where: String) {
    let gate = app.alerts.matching(self.gate).firstMatch
    XCTAssertFalse(gate.exists, "A purchase gate appeared in the free copy at \(`where`)")
  }

  func testFreshPlay() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    _ = openRow(app)
    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 20), "Reader Play button did not appear")
    play.tap()
    let paused = app.buttons["Pause"]
    XCTAssertTrue(paused.waitForExistence(timeout: 10), "Play did not turn the centre button to Pause")
    assertNoGate(app, "fresh play")
    print("FRESH play: centre button=Pause, no purchase gate")

    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = "fresh-playing"; image.lifetime = .keepAlways; add(image)

    let seconds = Double(ProcessInfo.processInfo.environment["OPENREADER_PLAY_SECONDS"] ?? "6") ?? 6
    Thread.sleep(forTimeInterval: seconds)
    XCTAssertTrue(app.buttons["Pause"].exists, "Playback did not stay up for \(seconds)s")
    app.buttons["Pause"].tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 8), "Pause did not restore Play")
    print("FRESH play: paused after \(seconds)s")
  }

  func testFreshDownload() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    _ = openRow(app)
    let more = app.buttons["More actions"]
    XCTAssertTrue(more.waitForExistence(timeout: 10), "Reader actions button did not appear")
    more.tap()
    let download = app.buttons["Download"]
    XCTAssertTrue(download.waitForExistence(timeout: 10), "Download action did not appear")
    download.tap()
    let chapter = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'The Downloaded Chapter'")).firstMatch
    XCTAssertTrue(chapter.waitForExistence(timeout: 10), "Download drawer did not list The Downloaded Chapter")
    chapter.tap()
    let selected = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Download selected'")).firstMatch
    XCTAssertTrue(selected.waitForExistence(timeout: 5), "No 'Download selected' button after selecting the chapter")
    print("FRESH download: selected (\(selected.label))")
    selected.tap()
    assertNoGate(app, "fresh download")

    let counted = NSCompoundPredicate(andPredicateWithSubpredicates: [
      NSPredicate(format: "label CONTAINS 'chapter downloaded'"),
      NSCompoundPredicate(notPredicateWithSubpredicate: NSPredicate(format: "label CONTAINS '0 chapter'"))])
    let done = app.staticTexts.matching(counted).firstMatch
    XCTAssertTrue(done.waitForExistence(timeout: 90), "The download never reported a downloaded chapter")
    print("FRESH download: \(done.label)")
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = "fresh-download-done"; image.lifetime = .keepAlways; add(image)
    let back = app.buttons["Back from Download"]
    if back.exists { back.tap() }
  }
}
