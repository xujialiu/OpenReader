import XCTest

/// Attach-only, no audio. --mode names an external JSON config, read through
/// the generated probe Info.plist (not unreliable environment forwarding).
/// Native painting still needs active-display screenshot review; coordinates
/// are calibrated to this WebView element, never the Duo's stale app.frame.
final class DuoAcceptanceLookupProbe: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")

  private struct Config: Decodable {
    let runID: String
    let query: String
    let definitionExcerpt: String?
    let webViewFrame: [Double]?
    let handle: [Double]?
    let destination: [Double]?
    let changedQuery: String?
  }

  override func setUp() {
    super.setUp()
    continueAfterFailure = false
  }

  private func config() throws -> Config {
    XCTAssertEqual(app.state, .runningForeground, "PRECONDITION: stage the running foreground Reader; probe never launches/activates it")
    let path = try XCTUnwrap(Bundle(for: Self.self).object(forInfoDictionaryKey: "ManualMode") as? String)
    XCTAssertTrue(path.hasPrefix("/"), "--mode must be the absolute path of the attempt's JSON config")
    let config = try JSONDecoder().decode(Config.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
    XCTAssertFalse(config.runID.isEmpty)
    XCTAssertFalse(config.query.isEmpty)
    print("DuoAcceptanceLookup-v1 runID=\(config.runID) config=\(path)")
    return config
  }

  private func capture(_ name: String) {
    for (index, screen) in XCUIScreen.screens.enumerated() {
      let image = XCTAttachment(screenshot: screen.screenshot())
      image.name = "\(name)-screen\(index)"
      image.lifetime = .keepAlways
      add(image)
    }
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
  }

  func testVisibleDefinition() throws {
    let c = try config()
    let excerpt = try XCTUnwrap(c.definitionExcerpt)
    XCTAssertGreaterThanOrEqual(excerpt.count, 20, "A query or part-of-speech label is not a definition")
    // The Drawer exposes duplicate AX entries at identical frames. Bind one
    // element so ambiguity cannot fail query resolution before the actual
    // visibility check; calibration logs retain the duplicate-frame evidence.
    let query = app.staticTexts.matching(identifier: c.query).element(boundBy: 0)
    let definition = app.staticTexts
      .matching(NSPredicate(format: "label CONTAINS %@", excerpt)).element(boundBy: 0)
    XCTAssertTrue(query.waitForExistence(timeout: 5), "Held query not shown")
    XCTAssertTrue(definition.waitForExistence(timeout: 5), "Actual parsed definition missing from native text")
    XCTAssertTrue(query.isHittable, "Query is not in the exposed Drawer")
    XCTAssertTrue(definition.isHittable, "Definition is offscreen/covered; do not auto-scroll it into a passing state")
    XCTAssertFalse(app.activityIndicators["Looking up selection"].exists, "Lookup still loading/selecting")
    XCTAssertFalse(app.buttons["Retry"].exists, "Lookup ended in an error")
    XCTAssertTrue(app.buttons["Copy result"].exists)
    let observed = "DuoAcceptanceLookup native-definition-observedAt=\(Date().timeIntervalSince1970) runID=\(c.runID) query=\(query.frame) definition=\(definition.frame)"
    print(observed)
    capture(c.runID + "-visible-definition")
    // -collect-test-diagnostics never can omit print output. Keep a typed
    // attachment created only after the assertions and screen captures.
    let receipt = XCTAttachment(string: "DuoAcceptanceLookup-v1 runID=\(c.runID) config=verified\n" + observed)
    receipt.name = c.runID + "-native-definition-receipt"
    receipt.lifetime = .keepAlways
    add(receipt)
    // The full definition's Text may be taller than the exposed area. The
    // retained active-display image must show this exact excerpt, not a spinner.
  }

  func testNativeHandleDrag() throws {
    let c = try config()
    let expected = try XCTUnwrap(c.changedQuery)
    XCTAssertNotEqual(expected, c.query, "Calibrate a deliberately changed selection")
    let web = app.webViews.firstMatch
    XCTAssertTrue(web.exists, "PRECONDITION: no live Reader WebView")
    let frame = try XCTUnwrap(c.webViewFrame)
    let handle = try XCTUnwrap(c.handle)
    let destination = try XCTUnwrap(c.destination)
    guard frame.count == 4, handle.count == 2, destination.count == 2,
          (frame + handle + destination).allSatisfy({ $0.isFinite }) else {
      XCTFail("Calibration requires a finite frame [x,y,width,height] and two [x,y] points")
      return
    }
    let actual = web.frame
    for (a, b) in zip([actual.minX, actual.minY, actual.width, actual.height], frame) {
      XCTAssertLessThan(abs(Double(a) - b), 1, "Stale native WebView calibration")
    }
    let origin = web.coordinate(withNormalizedOffset: .zero)
    func point(_ xy: [Double]) -> XCUICoordinate {
      origin.withOffset(CGVector(dx: CGFloat(xy[0]) - actual.minX, dy: CGFloat(xy[1]) - actual.minY))
    }
    for xy in [handle, destination] {
      XCTAssertTrue(actual.contains(CGPoint(x: CGFloat(xy[0]), y: CGFloat(xy[1]))), "Handle/destination outside calibrated WebView")
    }
    XCTAssertTrue(app.staticTexts[c.query].exists, "PRECONDITION: original lookup query missing")
    capture(c.runID + "-before-native-handle")
    print("DuoAcceptanceLookup dragAt=\(Date().timeIntervalSince1970) runID=\(c.runID) handle=\(handle) to=\(destination) web=\(actual)")
    point(handle).press(forDuration: 0.5, thenDragTo: point(destination))
    XCTAssertTrue(app.staticTexts[expected].waitForExistence(timeout: 5), "Native handle release did not change the query as calibrated")
    capture(c.runID + "-after-native-handle")
    // Host page/traffic snapshots must additionally establish a changed CFI
    // and exactly one changed-selection request. This assertion alone cannot.
  }
}
