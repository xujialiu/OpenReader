import XCTest

/// The phone's own Settings, captured as the reference design 0042 measures
/// OpenReader's settings pages against (#48): its front page, General, a page
/// of switches under section headers with footers (General › Keyboard), and a
/// page of labelled fields (VPN's Add Configuration, where the runtime has it).
/// Opens nothing in OpenReader. `native-reference.sh` runs it once per theme.
final class NativeReferenceProbe: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  /// A row's title, scrolled into view: Settings' rows are found by the text
  /// they show, which is the one thing stable across its releases.
  func title(_ app: XCUIApplication, _ predicate: NSPredicate) -> XCUIElement? {
    let text = app.staticTexts.matching(predicate).firstMatch
    for _ in 0..<8 {
      if text.exists && text.isHittable { return text }
      app.swipeUp()
    }
    return nil
  }

  func back(_ app: XCUIApplication) {
    app.navigationBars.buttons.element(boundBy: 0).tap()
  }

  func testCaptureReference() throws {
    let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
    settings.terminate()
    settings.launch()
    let general = try XCTUnwrap(title(settings, NSPredicate(format: "label == 'General'")), "No General row")
    capture("native-root", settings)

    general.tap()
    XCTAssertTrue(settings.navigationBars["General"].waitForExistence(timeout: 5), "General did not open")
    capture("native-general", settings)

    // General › About, first because it is at the top: rows of values, and
    // the phone's own editable name in a card row.
    if let about = title(settings, NSPredicate(format: "label == 'About'")) {
      about.tap()
      capture("native-about", settings)
      back(settings)
    }

    if let keyboard = title(settings, NSPredicate(format: "label == 'Keyboard'")) {
      keyboard.tap()
      XCTAssertTrue(settings.switches.firstMatch.waitForExistence(timeout: 5), "Keyboard has no switches")
      capture("native-keyboard", settings)
      // Lower down: a section header over a card, and a footer under one.
      settings.swipeUp(); settings.swipeUp()
      capture("native-keyboard-lower", settings)
      back(settings)
    }

    // Labelled fields, as a mail or VPN account is set up. Not every runtime
    // has VPN; the other captures stand without it.
    if let devices = title(settings, NSPredicate(format: "label == 'VPN & Device Management'")) {
      devices.tap()
      if let vpn = title(settings, NSPredicate(format: "label == 'VPN'")) {
        vpn.tap()
        if let add = title(settings, NSPredicate(format: "label BEGINSWITH 'Add VPN Configuration'")) {
          add.tap()
          _ = settings.textFields.firstMatch.waitForExistence(timeout: 5)
          capture("native-fields", settings)
        }
      }
    }
  }
}
