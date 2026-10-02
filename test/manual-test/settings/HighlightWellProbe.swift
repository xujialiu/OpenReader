import XCTest

/// Appearance's Sentence and Word wells (#118): the phone's own `ColorPicker`
/// in the drawer, opened by a real XCTest tap, because no AXe or
/// mobilebuildmcp tap opens a SwiftUI well (`../pitfalls/mcp.md`). Never
/// presses Play.
///
/// The Appearance drawer must already be up in the reader
/// (`hx.cjs UDID '{"do":"appearsheet","on":true}'`). The app is activated, not
/// relaunched, so it keeps its Metro. Each test takes the drawer to `large`
/// when the well is below the screen, opens the well, screenshots the picker
/// over the drawer, moves the opacity, closes the picker, and checks the
/// drawer is back where it was: a SwiftUI control in a host as wide as the
/// drawer took the drawer off the screen while what it opened was up (#117).
final class HighlightWellProbe: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")

  private func shot(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  private func say(_ what: String) {
    print("HIGHLIGHTWELL \(what)")
  }

  /// The drawer's title, whose frame says where the drawer is.
  private var title: XCUIElement { app.staticTexts["Appearance"].firstMatch }

  private func openWell(_ label: String) -> XCUIElement {
    app.activate()
    let well = app.buttons[label]
    XCTAssertTrue(well.waitForExistence(timeout: 10), "no \(label) well; is the Appearance drawer up?")
    if well.frame.maxY > 860 {
      app.buttons["Sheet Grabber"].tap()
      Thread.sleep(forTimeInterval: 2)
    }
    say("\(label) well \(well.frame) value \(String(describing: well.value)) title \(title.frame)")
    well.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    Thread.sleep(forTimeInterval: 2.5)
    if !app.sliders.matching(NSPredicate(format: "label CONTAINS[c] 'opacity'")).firstMatch.exists {
      say("\(label) a tap opened nothing; pressing for 0.2 s")
      well.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.2)
      Thread.sleep(forTimeInterval: 2.5)
    }
    return well
  }

  private func opacity() -> XCUIElement {
    let slider = app.sliders.matching(NSPredicate(format: "label CONTAINS[c] 'opacity'")).firstMatch
    XCTAssertTrue(slider.waitForExistence(timeout: 5), "the picker has no opacity slider")
    say("opacity \(slider.frame) value \(String(describing: slider.value))")
    return slider
  }

  private func closePicker(_ label: String, titleBefore: CGRect) {
    let close = app.buttons["close"]
    if close.exists { close.tap() } else { say("no close button"); }
    Thread.sleep(forTimeInterval: 2)
    shot("\(label)-after-close")
    say("\(label) title after close \(title.frame), before \(titleBefore)")
    XCTAssertTrue(title.exists, "the drawer did not come back")
    XCTAssertEqual(title.frame.minY, titleBefore.minY, accuracy: 1, "the drawer came back somewhere else")
  }

  /// The presets' names and selected states as VoiceOver gets them (AXe lists no traits).
  func testPresetStates() throws {
    app.activate()
    for name in ["Amber", "Blue"] {
      let tile = app.buttons[name]
      XCTAssertTrue(tile.waitForExistence(timeout: 10), "no \(name) tile; is the Appearance drawer up?")
      say("preset \(name) selected \(tile.isSelected) frame \(tile.frame)")
    }
  }

  /// A grey from the grid's top row, the sixth cell (mid grey), at the well's opacity, then the opacity moved:
  /// what the well reports for a grey, read in Metro's log from a temporary `console.log` (notes, 2026-10-02).
  func testGreyFromGrid() throws {
    let well = openWell("Word")
    let before = title.frame
    // The picker over a drawer at `large` on a 402 × 874 phone: the grid's grey row is at y 362, its sixth cell at x 187.
    let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    origin.withOffset(CGVector(dx: 187, dy: 362)).tap()
    Thread.sleep(forTimeInterval: 1.5)
    shot("grey-picked")
    let slider = opacity()
    slider.adjust(toNormalizedSliderPosition: 0.5)
    Thread.sleep(forTimeInterval: 1)
    say("grey opacity after adjust \(String(describing: slider.value))")
    shot("grey-opacity-50")
    closePicker("grey", titleBefore: before)
    say("grey well after \(String(describing: well.value))")
  }

  /// The picker's black swatch, under the grid, then the opacity moved: the system's black may be a grey colour.
  func testBlackSwatch() throws {
    let well = openWell("Word")
    let before = title.frame
    let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    origin.withOffset(CGVector(dx: 130.5, dy: 773)).tap()
    Thread.sleep(forTimeInterval: 1.5)
    shot("black-picked")
    let slider = opacity()
    say("black opacity after the swatch \(String(describing: slider.value))")
    slider.adjust(toNormalizedSliderPosition: 0.5)
    Thread.sleep(forTimeInterval: 1)
    say("black opacity after adjust \(String(describing: slider.value))")
    shot("black-opacity-50")
    closePicker("black", titleBefore: before)
    say("black well after \(String(describing: well.value))")
  }

  /// Sentence's opacity set to 0 by the slider's own adjustment.
  func testSentenceOpacityToZero() throws {
    let well = openWell("Sentence")
    let before = title.frame
    shot("sentence-picker")
    let slider = opacity()
    slider.adjust(toNormalizedSliderPosition: 0)
    Thread.sleep(forTimeInterval: 1)
    say("sentence opacity after adjust \(String(describing: slider.value))")
    shot("sentence-opacity-0")
    closePicker("sentence", titleBefore: before)
    say("sentence well after \(String(describing: well.value))")
  }

  /// Word's opacity dragged down slowly from its thumb, with a screenshot held mid-drag.
  func testWordOpacityDrag() throws {
    let well = openWell("Word")
    let before = title.frame
    shot("word-picker")
    let slider = opacity()
    // From the thumb, where the value puts it: a press beside it moves nothing.
    let now = Double((slider.value as? String ?? "50%").filter(\.isNumber)).map { $0 / 100 } ?? 0.5
    let from = slider.coordinate(withNormalizedOffset: CGVector(dx: now, dy: 0.5))
    let to = slider.coordinate(withNormalizedOffset: CGVector(dx: now > 0.5 ? now - 0.3 : now + 0.3, dy: 0.5))
    from.press(forDuration: 0.3, thenDragTo: to, withVelocity: 60, thenHoldForDuration: 0.5)
    Thread.sleep(forTimeInterval: 1)
    say("word opacity after drag \(String(describing: slider.value))")
    shot("word-after-drag")
    closePicker("word", titleBefore: before)
    say("word well after \(String(describing: well.value))")
  }
}
