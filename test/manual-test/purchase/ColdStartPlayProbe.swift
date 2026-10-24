import XCTest

/// Cold-start offline-narration control for the release-copy verification (#324).
/// The app is cold-launched by the probe itself, so no in-memory clip cache can
/// serve the Reading: the provider must be unreachable while this runs, and the
/// clips can only come from the saved narration on disk. Real XCUITest touches:
/// the Library's document row, the reader's Play, then Pause.
///
///   silence.sh check UDID && fake provider STOPPED, then:
///   bash test/manual-test/kit/run-probe.sh ColdStartPlayProbe UDID OUT \
///     -only-testing:testColdStartOfflinePlay
///
/// Prints COLDSTART lines; asserts the centre button turned to Pause while the
/// document had a saved chapter, and back to Play after the pause. Nothing here
/// reads or writes app data.
final class ColdStartPlayProbe: XCTestCase {
  func testColdStartOfflinePlay() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    if app.state == .runningForeground { app.terminate() }
    app.launch() // cold launch: empty clip cache
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'A Short Test of Reading Aloud'")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 20), "Library row did not appear")
    print("COLDSTART row label: \(row.label)")
    row.tap()

    var play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 20), "Reader Play button did not appear")
    print("COLDSTART before: centre button label=\(play.label)")

    let imageBefore = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    imageBefore.name = "coldstart-before-play"; imageBefore.lifetime = .keepAlways; add(imageBefore)

    play.tap()
    let paused = app.buttons["Pause"]
    XCTAssertTrue(paused.waitForExistence(timeout: 8), "Play did not turn the centre button to Pause")
    print("COLDSTART playing: centre button label=Pause (real touch accepted)")

    let imageDuring = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    imageDuring.name = "coldstart-playing"; imageDuring.lifetime = .keepAlways; add(imageDuring)

    Thread.sleep(forTimeInterval: 6) // a few saved clips' worth of progression
    XCTAssertTrue(app.buttons["Pause"].exists, "Playback did not stay playing while offline")
    app.buttons["Pause"].tap()
    play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 8), "Pause did not return the centre button to Play")
    print("COLDSTART after: centre button label=Play (real touch pause accepted)")

    let imageAfter = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    imageAfter.name = "coldstart-paused"; imageAfter.lifetime = .keepAlways; add(imageAfter)
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = "coldstart-tree"; tree.lifetime = .keepAlways; add(tree)
  }
}
