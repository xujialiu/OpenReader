import XCTest

/// Real-input create loop for #123. Every iteration records the native value
/// before submitting and requires the exact resulting Library row. Run only
/// against a disposable test Library; successful runs leave their named folders.
final class InputIntegrityProbe: XCTestCase {
  func testCreateExactNames() throws {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    let run = String(Int(Date().timeIntervalSince1970))
    for index in 0..<5 {
      let intended = "Input123-\(run)-\(index)x"
      XCTAssertTrue(app.buttons["Add"].waitForExistence(timeout: 10), "Start in Library")
      app.buttons["Add"].tap()
      XCTAssertTrue(app.buttons["Create folder"].waitForExistence(timeout: 10))
      app.buttons["Create folder"].tap()
      let box = app.textFields.firstMatch
      XCTAssertTrue(box.waitForExistence(timeout: 10))
      box.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
      XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 8))
      let initial = box.value as? String ?? ""
      XCTAssertTrue(initial.isEmpty || initial == "Name", "Expected fresh blank field, got \(initial)")
      box.typeText(intended)
      let native = box.value as? String ?? ""
      let snapshot = XCTAttachment(string: "intended=\(intended) native=\(native)\n\(app.debugDescription)")
      snapshot.name = "input-\(index)-before-submit"; snapshot.lifetime = .keepAlways; add(snapshot)
      XCTAssertEqual(native, intended, "Input delivery mismatch; do not submit or retry")
      app.buttons["Create"].tap()
      XCTAssertTrue(app.buttons["Actions for folder \(intended)"].waitForExistence(timeout: 10), "Submitted name differs from intended/native value")
    }
  }
}
