import XCTest

/// THROWAWAY (branch xujialiu/highlight--sheet-probe, not for merge). Taps the
/// SwiftUI ColorPicker wells of `src/app/sheet-probe.tsx` with real XCTest
/// touches, because AXe taps on the well opened nothing, on the page and in the
/// sheet alike. The probe screen must already be up; the app is activated, not
/// relaunched, so it keeps its Metro.
final class SheetColorProbe: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")

  private func shot(_ name: String) {
    let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    a.name = name; a.lifetime = .keepAlways; add(a)
  }

  private func stamp(_ what: String) {
    print("SHEETCOLOR \(what) at \(Date().timeIntervalSince1970)")
  }

  /// The picker the system presents: printed whole, so its controls can be read.
  private func dumpTree(_ label: String) {
    print("SHEETCOLOR tree \(label)\n\(app.debugDescription)")
  }

  /// Opacity, by whatever name the system picker gives its slider.
  private func dragOpacity(_ label: String) {
    let slider = app.sliders.matching(NSPredicate(format: "label CONTAINS[c] 'opacity'")).firstMatch
    guard slider.waitForExistence(timeout: 3) else { print("SHEETCOLOR no opacity slider"); return }
    print("SHEETCOLOR opacity slider frame \(slider.frame) value \(String(describing: slider.value))")
    // From the thumb (at the current value), slowly, so a live callback has time to fire.
    let from = slider.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    let to = slider.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.5))
    stamp("drag start \(label)")
    from.press(forDuration: 0.3, thenDragTo: to, withVelocity: 60, thenHoldForDuration: 0.5)
    stamp("drag end \(label)")
    Thread.sleep(forTimeInterval: 1)
    print("SHEETCOLOR opacity value after drag \(String(describing: slider.value))")
    shot("\(label)-after-opacity-drag")
    stamp("adjust start \(label)")
    slider.adjust(toNormalizedSliderPosition: 0.8)
    stamp("adjust end \(label)")
    Thread.sleep(forTimeInterval: 1)
    print("SHEETCOLOR opacity value after adjust \(String(describing: slider.value))")
    shot("\(label)-after-opacity-adjust")
    let close = app.buttons["close"]
    if close.exists { close.tap(); Thread.sleep(forTimeInterval: 1.5); stamp("closed picker \(label)") }
    shot("\(label)-after-close")
  }

  func testPageWell() throws {
    app.activate()
    if !app.sliders["Opacity"].exists {
      let row = app.buttons["Page colour"]
      XCTAssertTrue(row.waitForExistence(timeout: 5), "no Page colour row; is the probe screen up with no sheet?")
      stamp("tap page well")
      row.coordinate(withNormalizedOffset: CGVector(dx: 0.962, dy: 0.5)).tap()
      Thread.sleep(forTimeInterval: 2.5)
    }
    shot("page-picker")
    dumpTree("page")
    dragOpacity("page")
  }

  func testSheetWell() throws {
    app.activate()
    let grabber = app.buttons["Sheet Grabber"]
    if !grabber.exists { app.otherElements["Open probe sheet"].tap(); Thread.sleep(forTimeInterval: 2.5) }
    let row = app.buttons["Highlight"]
    XCTAssertTrue(row.waitForExistence(timeout: 5), "no Highlight row in the sheet")
    // At medium the row can sit below the screen's edge; the grabber's tap takes the sheet to large.
    if row.frame.maxY > 860 { grabber.tap(); Thread.sleep(forTimeInterval: 2) }
    print("SHEETCOLOR Highlight frame \(row.frame)")
    stamp("tap sheet well")
    row.coordinate(withNormalizedOffset: CGVector(dx: 0.959, dy: 0.5)).tap()
    Thread.sleep(forTimeInterval: 2.5)
    shot("sheet-picker")
    dumpTree("sheet")
    dragOpacity("sheet")
  }
}
