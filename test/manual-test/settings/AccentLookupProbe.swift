import XCTest

/// #118's accent in the Lookup drawer, reached by a real long press on the page
/// (`TranslationProbe.swift`'s gesture). Assumes the reader is open on a
/// document with text and lookup is enabled. The harness's `breakfetch` should
/// be armed for the service's host first, so nothing is sent; with it the
/// drawer answers with its error state (Retry). Never presses Play.
final class AccentLookupProbe: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")

  private func shot(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func testGeneralLinkBracket() throws {
    // General's bracket-pairs reset link (#118's accent): the check runs when
    // the interlock switch is turned on over an invalid list, so turn it on.
    app.activate()
    // Settings › General is assumed open (the host navigated there).
    let settings = app.staticTexts["General"].firstMatch
    XCTAssertTrue(settings.waitForExistence(timeout: 15), "General is not open")
    let probe = app.staticTexts["Remove enclosing brackets when reading"].firstMatch
    XCTAssertTrue(probe.waitForExistence(timeout: 15), "no brackets switch")
    let value = { [weak self] () -> String in (self?.app.switches["Remove enclosing brackets when reading"].value as? String) ?? "" }
    if value() != "0" { app.switches["Remove enclosing brackets when reading"].tap(); Thread.sleep(forTimeInterval: 1.5) }
    app.switches["Remove enclosing brackets when reading"].tap()
    let link = app.buttons["Use <> [] instead"].firstMatch
    let appeared = link.waitForExistence(timeout: 5)
    shot("general-link")
    print("GENERALLINK appeared \(appeared) frame \(appeared ? String(describing: link.frame) : "-")")
    if appeared { link.tap(); Thread.sleep(forTimeInterval: 1.5) }
    shot("general-link-after")
    XCTAssertTrue(appeared, "the reset link did not appear over the invalid list")
  }

  /// Picks a custom colour from the phone's grid for #118's accent: opens the
  /// Word well (the drawer must be up at `large`), taps the grid's red cell,
  /// and closes. The saved values are read back through the harness.
  func testPickCustomWord() throws {
    app.activate()
    let well = app.buttons["Word"]
    XCTAssertTrue(well.waitForExistence(timeout: 10), "no Word well; is the Appearance drawer up at large?")
    well.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    Thread.sleep(forTimeInterval: 2.5)
    let slider = app.sliders.matching(NSPredicate(format: "label CONTAINS[c] 'opacity'")).firstMatch
    if !slider.exists {
      well.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.2)
      Thread.sleep(forTimeInterval: 2.5)
    }
    XCTAssertTrue(slider.waitForExistence(timeout: 5), "the picker did not open")
    shot("custom-picker")
    // The grid's saturated row's red cell, measured on the 402 x 874 phone at large.
    app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0)).withOffset(CGVector(dx: 276, dy: 468)).tap()
    Thread.sleep(forTimeInterval: 1.5)
    shot("custom-picked")
    print("CUSTOMPICK well value \(String(describing: well.value)) slider \(String(describing: slider.value))")
    let close = app.buttons["close"]
    if close.exists { close.tap() }
    Thread.sleep(forTimeInterval: 2)
    shot("custom-after-close")
    XCTAssertTrue(app.buttons["Amber"].waitForExistence(timeout: 5), "the drawer did not come back")
  }

  func testLookupAccents() throws {
    app.activate()
    // The reader must be open: the player's voice button is the reader's own signal.
    let voiceButton = app.buttons["Choose a Voice"].firstMatch
    XCTAssertTrue(voiceButton.waitForExistence(timeout: 20), "the reader is not open (no Choose a Voice); open a Document before this probe")
    let loading = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS 'Laying the document out'")).firstMatch
    let deadline = Date().addingTimeInterval(30)
    while loading.exists && Date() < deadline { Thread.sleep(forTimeInterval: 0.5) }
    Thread.sleep(forTimeInterval: 1)

    let body = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
    body.press(forDuration: 1.0)
    // The consent alert, if the device has not answered it yet: decline, so nothing is sent.
    let dontAllow = app.buttons["Don't Allow"]
    if dontAllow.waitForExistence(timeout: 3) { dontAllow.tap() }
    shot("lookup-opening")
    // TranslationProbe's marker: the drawer's mode Picker, "Dictionary".
    let title = app.buttons["Dictionary"].firstMatch
    XCTAssertTrue(title.waitForExistence(timeout: 20), "the long press did not open the Lookup drawer")
    Thread.sleep(forTimeInterval: 2.5)
    shot("lookup-drawer")
    print("LOOKUPACCENT drawer title \(title.frame)")
    for label in ["Retry", "Copy result", "Play UK pronunciation", "Play US pronunciation", "Looking up selection"] {
      let one = app.buttons[label].firstMatch
      let text = app.staticTexts[label].firstMatch
      let found = one.exists ? one : (text.exists ? text : nil)
      print("LOOKUPACCENT \(label): \(found.map { "\($0.frame)" } ?? "absent")")
    }
  }
}
