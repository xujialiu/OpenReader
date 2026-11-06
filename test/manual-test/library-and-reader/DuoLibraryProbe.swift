import ObjectiveC
import XCTest

/// Issue #346 C3: Library input and two-finger selection across an EXTERNAL
/// fold on the owned Duo. Attaches to the RUNNING app only — a missing Library
/// is a failed precondition, never relaunch-and-continue. The fold itself is
/// performed by the caller between invocations; `testSelectionRetainedAfterExternalFold`
/// asserts the selection count is unchanged after it.
///
//  bash test/manual-test/kit/run-probe.sh DuoLibraryProbe SIM_UDID OUT_DIR \
//    -only-testing:DuoLibraryProbe/testCreateFolderTypedNativeReadback
/// (TEST_RUNNER_DUO_EXPECT_SELECTED=<n> for the retention assertion.)
enum Fingers {
  typealias InitTouch = @convention(c) (AnyObject, Selector, CGPoint, Double) -> AnyObject
  typealias MoveTo = @convention(c) (AnyObject, Selector, CGPoint, Double) -> Void
  typealias LiftUp = @convention(c) (AnyObject, Selector, Double) -> Void
  typealias InitRecord = @convention(c) (AnyObject, Selector, NSString, Int) -> AnyObject
  typealias AddPath = @convention(c) (AnyObject, Selector, AnyObject) -> Void
  typealias Synthesize = @convention(c) (AnyObject, Selector, AnyObject, @escaping @convention(block) (Bool, NSError?) -> Void) -> Void

  static func method<T>(_ cls: AnyClass, _ name: String, _ type: T.Type) -> (T, Selector) {
    let selector = NSSelectorFromString(name)
    guard let found = class_getInstanceMethod(cls, selector) else { fatalError("\(cls) has no \(name)") }
    return (unsafeBitCast(method_getImplementation(found), to: type), selector)
  }

  static func finger(_ points: [(CGPoint, Double)], lift: Double) -> AnyObject {
    let cls: AnyClass = NSClassFromString("XCPointerEventPath")!
    let (touch, touchSelector) = method(cls, "initForTouchAtPoint:offset:", InitTouch.self)
    let (move, moveSelector) = method(cls, "moveToPoint:atOffset:", MoveTo.self)
    let (up, upSelector) = method(cls, "liftUpAtOffset:", LiftUp.self)
    let path = touch(class_createInstance(cls, 0) as AnyObject, touchSelector, points[0].0, points[0].1)
    for (point, at) in points.dropFirst() { move(path, moveSelector, point, at) }
    up(path, upSelector, lift)
    return path
  }

  static func pair(_ track: [(CGPoint, Double)], lift: Double, spread: CGFloat = 36) -> [AnyObject] {
    let left = track.map { (CGPoint(x: $0.0.x - spread / 2, y: $0.0.y), $0.1) }
    let right = track.map { (CGPoint(x: $0.0.x + spread / 2, y: $0.0.y), $0.1) }
    return [finger(left, lift: lift), finger(right, lift: lift)]
  }

  static func line(_ from: CGPoint, _ to: CGPoint, start: Double, seconds: Double, steps: Int = 20) -> [(CGPoint, Double)] {
    (0...steps).map { index in
      let t = Double(index) / Double(steps)
      return (CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t), start + seconds * t)
    }
  }

  static func play(_ paths: [AnyObject], name: String, in tc: XCTestCase) {
    let cls: AnyClass = NSClassFromString("XCSynthesizedEventRecord")!
    let (initRecord, initSelector) = method(cls, "initWithName:interfaceOrientation:", InitRecord.self)
    let (add, addSelector) = method(cls, "addPointerEventPath:", AddPath.self)
    let record = initRecord(class_createInstance(cls, 0) as AnyObject, initSelector, name as NSString, 1)
    for path in paths { add(record, addSelector, path) }
    let synthesizer = XCUIDevice.shared.perform(NSSelectorFromString("eventSynthesizer"))!.takeUnretainedValue()
    let (synthesize, synthesizeSelector) = method(object_getClass(synthesizer)!, "synthesizeEvent:completion:", Synthesize.self)
    let done = tc.expectation(description: name)
    synthesize(synthesizer, synthesizeSelector, record) { ok, error in
      if !ok { print("DUO SYNTHESIS FAILED \(name): \(String(describing: error))") }
      done.fulfill()
    }
    tc.wait(for: [done], timeout: 10)
  }
}

final class DuoLibraryProbe: XCTestCase {
  private var app: XCUIApplication {
    XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
  }

  private func ensureLibrary() {
    let actions = app.buttons["Library actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 8),
                  "PRECONDITION FAILED: the Library is not on screen; not launching")
  }

  private func selectedCount() -> Int? {
    let header = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "^\\d+ selected$")).firstMatch
    guard header.exists else { return nil }
    return Int(header.label.components(separatedBy: " ").first ?? "")
  }

  private func waitCount(_ expected: Int?, timeout: TimeInterval = 8) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if selectedCount() == expected { return true }
      sleep(1)
    }
    return selectedCount() == expected
  }

  private func shoot(_ name: String) {
    let shot = XCUIScreen.main.screenshot()
    let attachment = XCTAttachment(screenshot: shot)
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
    if let dir = ProcessInfo.processInfo.environment["DUO_SHOT_DIR"] {
      try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir + "/" + name + ".png"))
    }
  }

  /// Real native input: Library actions -> Create folder -> typed name with a
  /// native readback -> Create. The persisted row is the submitted-text proof.
  func testCreateFolderTypedNativeReadback() {
    ensureLibrary()
    app.buttons["Library actions"].tap()
    let create = app.buttons["Create folder"]
    XCTAssertTrue(create.waitForExistence(timeout: 5), "the Library actions menu has no Create folder")
    create.tap()
    let field = app.textFields["Name"]
    XCTAssertTrue(field.waitForExistence(timeout: 8), "the Create folder alert has no Name field")
    field.tap()
    field.typeText("DuoFold42")
    let read = field.value as? String ?? "?"
    print("PROBE-FOLDER-TYPED read=\(read)")
    if read != "DuoFold42" {
      field.typeText("")
      let clearAll = field.value as? String ?? ""
      _ = clearAll
      field.typeText("DuoFold42")
    }
    let read2 = field.value as? String ?? "?"
    print("PROBE-FOLDER-TYPED read2=\(read2)")
    XCTAssertEqual(read2, "DuoFold42", "native readback of the typed folder name")
    shoot("duo-create-folder-typed")
    app.buttons["Create"].tap()
    let row = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Folder, DuoFold42")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 8), "the Library has no Folder DuoFold42 row after Create")
    print("PROBE-FOLDER-CREATED \(row.label)")
    shoot("duo-create-folder-created")
  }

  /// Real two-finger sweep over the first three root rows; leaves selection mode ACTIVE.
  func testTwoFingerSweepSelectThree() {
    ensureLibrary()
    XCTAssertNil(selectedCount(), "the Library must start outside selection mode")
    let rows = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label BEGINSWITH %@ OR label CONTAINS %@", "Folder,", "Not started."))
      .allElementsBoundByIndex
      .filter { $0.exists && $0.frame.minY >= app.navigationBars.firstMatch.frame.maxY }
      .sorted { $0.frame.minY < $1.frame.minY }
    guard rows.count >= 3 else {
      XCTFail("PRECONDITION FAILED: need three visible root entries, found \(rows.count)")
      return
    }
    let center = app.frame.midX
    Fingers.play(Fingers.pair(Fingers.line(CGPoint(x: center, y: rows[0].frame.midY),
      CGPoint(x: center, y: rows[2].frame.midY), start: 0.1, seconds: 0.8), lift: 1.1),
      name: "duo-fold-sweep", in: self)
    XCTAssertTrue(waitCount(3), "Two fingers must select exactly the three traversed entries")
    print("PROBE-SWEEP-SELECTED 3 of \(rows.count) rows")
    shoot("duo-sweep-selected")
  }

  /// After an EXTERNAL pose change (performed by the caller): the selection
  /// count must be unchanged. TEST_RUNNER_DUO_EXPECT_SELECTED=<n>.
  func testSelectionRetainedAfterExternalFold() {
    ensureLibrary()
    let expected = Int(ProcessInfo.processInfo.environment["DUO_EXPECT_SELECTED"] ?? "3")
    let now = selectedCount()
    print("PROBE-SELECTION-AFTER-FOLD expected=\(expected) now=\(now ?? -1)")
    XCTAssertEqual(now, expected, "selection must survive the external fold")
    shoot("duo-selection-after-fold")
  }

  func testCancelSelection() {
    ensureLibrary()
    let cancel = app.buttons["Cancel"]
    XCTAssertTrue(cancel.waitForExistence(timeout: 5), "No Cancel button to leave selection mode")
    cancel.tap()
    XCTAssertTrue(waitCount(nil), "Cancel did not leave selection mode")
    print("PROBE-SELECTION-CANCELLED")
  }
}
