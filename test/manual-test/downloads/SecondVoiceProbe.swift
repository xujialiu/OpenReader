import XCTest
import Vision

/// Checks indexed progress for a second voice whose one saved clip is shared
/// with the fixture's second chapter. The shell wrapper creates and removes the
/// synthetic catalog rows; this probe only performs real UI touches.
final class SecondVoiceProbe: XCTestCase {
  func recognizedText(_ screenshot: XCUIScreenshot) -> String {
    guard let cgImage = screenshot.image.cgImage else { return "" }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(cgImage: cgImage)
    try? handler.perform([request])
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
  }

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func testSecondVoiceIndexedProgress() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()

    let book = app.buttons.matching(
      NSPredicate(format: "label BEGINSWITH 'A Short Test of Reading Aloud,'"),
    ).firstMatch
    XCTAssertTrue(book.waitForExistence(timeout: 10))
    book.tap()
    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 10))
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 5))
    app.buttons["Download"].tap()

    let synthetic = app.buttons.matching(
      NSPredicate(format: "label CONTAINS 'Synthetic second voice'"),
    ).firstMatch
    XCTAssertTrue(synthetic.waitForExistence(timeout: 10))
    synthetic.tap()

    XCTAssertTrue(app.staticTexts["0 chapters downloaded"].waitForExistence(timeout: 10))
    let row = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'The Second Chapter'" )).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10))
    let screenshot = XCUIScreen.main.screenshot()
    let text = recognizedText(screenshot)
    let compact = text.replacingOccurrences(of: " ", with: "")
    XCTAssertTrue(compact.contains("1/7"), "Visible progress was not 1 / 7: \(text)")
    let attachment = XCTAttachment(screenshot: screenshot)
    attachment.name = "second-voice-progress"; attachment.lifetime = .keepAlways; add(attachment)
    capture("second-voice-progress-tree", app)
  }
}
