import XCTest

/// Reproduces Library opening without starting playback or modifying downloads.
final class LibraryOpenProbe: XCTestCase {
  func testOpenDocument() {
    let title = Bundle(for: Self.self).object(forInfoDictionaryKey: "ManualMode") as? String ?? "仙逆"
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate()
    app.launch()
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title + ",")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5), "Document must already be in Library")
    row.tap()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 15), "Document did not reach the reader within 15 seconds")
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = "library-open-result-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = "library-open-result"; image.lifetime = .keepAlways; add(image)
  }
}
