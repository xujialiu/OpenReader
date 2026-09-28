import XCTest

/// A pinch, or a double tap, on the reading page (#79). Run it through
/// `zoom.sh`, which opens the Document and waits for its first section to be
/// laid out before each method: a gesture made while "Laying the document
/// out…" covers the page lands on that placeholder and magnifies nothing, and
/// the placeholder is not in the accessibility tree, so the probe cannot wait
/// for it itself (2026-09-28). The probe only `activate()`s, so a device kept
/// on a non-default port by its launch argument stays on it (pitfalls/metro.md).
/// Nothing is played.
///
/// It makes the gesture, photographs the page before and after, and prints the
/// player's Following mark before and after (a pinch must leave A alone, #79);
/// whether the page magnified is read afterwards by `zoom.sh`, from the page's
/// own `visualViewport.scale`. The reading page's text is not in the accessibility
/// tree either — `app.webViews` matched nothing on iOS 27.0 — so there is no
/// frame for XCTest to compare.
final class ZoomProbe: XCTestCase {
  func capture(_ name: String, _ app: XCUIApplication) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func reader() -> XCUIApplication {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 15), "The reader is not open")
    return app
  }

  /// The player's Following mark: A is a text labelled "Following the
  /// reading", M a button labelled "Return to the reading" (#71).
  func mark(_ app: XCUIApplication) -> String {
    if app.buttons["Return to the reading"].exists { return "M" }
    if app.descendants(matching: .any)["Following the reading"].exists { return "A" }
    return "?"
  }

  func testPinch() throws {
    let app = reader()
    let before = mark(app)
    capture("pinch-before", app)
    // At the middle of the screen, which is the page: the player floats at the bottom.
    app.pinch(withScale: 3, velocity: 2)
    sleep(2)
    capture("pinch-after", app)
    // Since #79 a pinch does nothing, Browsing included; zoom.sh reads this line.
    print("ZOOM mark pinch before=\(before) after=\(mark(app))")
  }

  func testDoubleTap() throws {
    let app = reader()
    let before = mark(app)
    capture("doubletap-before", app)
    // A quarter of the way down, on the first chapter's text.
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).doubleTap()
    sleep(2)
    capture("doubletap-after", app)
    print("ZOOM mark doubletap before=\(before) after=\(mark(app))")
  }

  /// The control: the same pinch on Safari, on a page with the reader's own
  /// viewport that writes `visualViewport.scale` into its heading (`zoom.sh
  /// SIMULATOR_UDID control` serves and opens it). Measured 2026-09-28: 1.00
  /// became 2.39. If this does not magnify, a pinch that leaves the reader
  /// alone proves nothing.
  func testPinchSafari() throws {
    let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
    safari.activate()
    let heading = safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'scale '")).firstMatch
    XCTAssertTrue(heading.waitForExistence(timeout: 15), "The control page is not open in Safari")
    sleep(1)
    capture("safari-before", safari)
    let before = heading.label
    safari.webViews.firstMatch.pinch(withScale: 3, velocity: 2)
    sleep(2)
    capture("safari-after", safari)
    print("ZOOM safari before=\(before) after=\(heading.label)")
    XCTAssertNotEqual(heading.label, "scale 1.00", "The pinch did not magnify even Safari's page")
  }
}
