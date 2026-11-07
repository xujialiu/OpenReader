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

  /// C3 diagnosis: type via typeText (proven), then ONE independent calibrated
  /// coordinate press on the visible Create button's own frame (a raw synthetic
  /// coordinate event, not an element action). Records submit/created state.
  func testCreateFolderCoordinatePress() {
    ensureLibrary()
    app.buttons["Library actions"].tap()
    let create = app.buttons["Create folder"]
    XCTAssertTrue(create.waitForExistence(timeout: 5), "no Create folder menu row")
    create.tap()
    let field = app.textFields["Name"]
    XCTAssertTrue(field.waitForExistence(timeout: 8), "no Name field")
    field.tap()
    field.typeText("DuoFold42")
    print("PROBE-DIAG typed=\(field.value as? String ?? "?")")
    let createButton = app.buttons["Create"]
    XCTAssertTrue(createButton.waitForExistence(timeout: 4), "no Create button in the alert")
    let frame = createButton.frame
    print("PROBE-DIAG createFrame=\(frame) enabled=\(createButton.isEnabled)")
    let s = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    s.withOffset(CGVector(dx: frame.midX, dy: frame.midY)).tap()
    sleep(3)
    let fieldGone = !field.exists
    let row = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Folder, DuoFold42")).firstMatch
    print("PROBE-DIAG afterCoordinatePress fieldGone=\(fieldGone) rowExists=\(row.exists) alertCreateStill=\(createButton.exists)")
  }

  /// C4: selection via the Library actions' Select entry, then two real taps on
  /// the two existing Document rows (the selection contract, not two fingers).
  /// Leaves selection ACTIVE for an external fold.
  func testMenuSelectTwoDocuments() {
    ensureLibrary()
    XCTAssertNil(selectedCount(), "must start outside selection mode")
    app.buttons["Library actions"].tap()
    let select = app.buttons["Select"]
    XCTAssertTrue(select.waitForExistence(timeout: 5), "no Select entry in the Library actions")
    // drawer rows ignore XCUITest element taps (the Create-alert finding); press by frame
    let sf = select.frame
    let sp = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    sp.withOffset(CGVector(dx: sf.midX, dy: sf.midY)).tap()
    XCTAssertTrue(waitCount(0), "selection mode did not open")
    var labels: [String] = []
    let allButtons = app.buttons.allElementsBoundByIndex
    for r in allButtons.prefix(24) { labels.append(String("\(r.elementType.rawValue):\(r.label.prefix(38))")) }
    print("PROBE-ROWSCAN buttons=\(allButtons.count) labels=\(labels)")
    let texts = app.staticTexts.allElementsBoundByIndex
    var tlabels: [String] = []
    for r in texts.prefix(8) { tlabels.append(String(r.label.prefix(38))) }
    print("PROBE-ROWSCAN staticTexts=\(texts.count) labels=\(tlabels)")
    // Selection mode hides the row buttons from XCUITest (only the toolbar is
    // exposed); tap the rows by the title text's own coordinates instead.
    var titles = app.staticTexts.matching(NSPredicate(
      format: "label CONTAINS 'A Short Test of Reading Aloud' OR label CONTAINS 'Word Boundaries for Lookup'")).allElementsBoundByIndex
      .filter { $0.exists && $0.frame.minY >= 82 && $0.frame.width > 100 }
      .sorted { $0.frame.minY < $1.frame.minY }
    if titles.count < 2 {
      var cl: [String] = []
      for c in app.cells.allElementsBoundByIndex.prefix(8) { cl.append(String(c.label.prefix(40))) }
      print("PROBE-ROWSCAN cells=\(app.cells.count) labels=\(cl)")
      var ol: [String] = []
      for c in app.otherElements.allElementsBoundByIndex.prefix(14) { ol.append(String("\(c.elementType.rawValue):\(c.label.prefix(30)) f=\(c.frame)")) }
      print("PROBE-ROWSCAN otherElements sample=\(ol)")
      titles = app.staticTexts.matching(NSPredicate(
        format: "label CONTAINS 'A Short Test' OR label CONTAINS 'Word Boundaries'")).allElementsBoundByIndex
        .filter { $0.exists && $0.frame.minY >= 82 }
        .sorted { $0.frame.minY < $1.frame.minY }
    }
    guard titles.count >= 2 else {
      XCTFail("PRECONDITION FAILED: need two visible row titles, found \(titles.count)")
      return
    }
    let s = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    let f0 = titles[0].frame
    let f1 = titles[1].frame
    print("PROBE-ROWTAPS t0=\(f0) t1=\(f1)")
    s.withOffset(CGVector(dx: f0.midX, dy: f0.midY)).tap()
    sleep(1)
    s.withOffset(CGVector(dx: f1.midX, dy: f1.midY)).tap()
    XCTAssertTrue(waitCount(2), "two taps must select exactly the two Documents")
    print("PROBE-SELECTED-2 tapped=\(titles[0].label.prefix(40)) and \(titles[1].label.prefix(40))")
    shoot("duo-menu-select-two")
  }

  /// C4: the Create-folder alert's typed text and caret survive an EXTERNAL fold
  /// (the fold happened before this invocation); then submit via the known-good
  /// coordinate press and require the exact persisted name.
  func testCreateFolderInputSurvivedFoldThenSubmit() {
    ensureLibrary()
    let field = app.textFields["Name"]
    XCTAssertTrue(field.waitForExistence(timeout: 6),
                  "PRECONDITION FAILED: the Create-folder alert is not up (was it left open before the fold?)")
    let value = field.value as? String ?? "?"
    print("PROBE-FOLD-INPUT afterFold=\(value)")
    XCTAssertEqual(value, "DuoFold43", "the typed name did not survive the fold")
    let createButton = app.buttons["Create"]
    XCTAssertTrue(createButton.waitForExistence(timeout: 4), "Create button missing after fold")
    let frame = createButton.frame
    let s = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    s.withOffset(CGVector(dx: frame.midX, dy: frame.midY)).tap()
    sleep(3)
    let row = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Folder, DuoFold43")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 8), "no Folder DuoFold43 row after submit")
    print("PROBE-FOLD-INPUT persisted=\(row.label)")
  }

  /// Stage for the fold-input case: open the Create-folder alert and type the
  /// name; leaves the alert up for the caller's external fold.
  func testOpenCreateFolderAlertAndType() {
    ensureLibrary()
    XCTAssertNil(selectedCount(), "must not be in selection mode for the input case")
    app.buttons["Library actions"].tap()
    let create = app.buttons["Create folder"]
    XCTAssertTrue(create.waitForExistence(timeout: 5), "no Create folder menu row")
    create.tap()
    let field = app.textFields["Name"]
    XCTAssertTrue(field.waitForExistence(timeout: 8), "no Name field")
    field.tap()
    field.typeText("DuoFold43")
    let value = field.value as? String ?? "?"
    print("PROBE-FOLD-INPUT typed=\(value)")
    XCTAssertEqual(value, "DuoFold43", "typed name readback")
    print("PROBE-FOLD-INPUT alertLeftUp fieldExists=\(field.exists)")
    XCTAssertTrue(value == "DuoFold43", "leave the alert up with the typed name")
  }

  /// C4 with AXE-read coordinates (AXE input is unreliable; AXE reads + XCTest
  /// coordinate synthesis are not). TEST_RUNNER_DUO_TAPS = JSON [[x,y],…] in app
  /// points: [Select-row, Document-row-1, Document-row-2]. Taps the Select row,
  /// asserts selection mode opened, taps the two rows, asserts exactly two
  /// selected, leaves selection ACTIVE for an external fold.
  func testTapPointsSelectTwoDocuments() throws {
    ensureLibrary()
    XCTAssertNil(selectedCount(), "must start outside selection mode")
    let tapsRaw = ProcessInfo.processInfo.environment["DUO_TAPS"] ?? "[]"
    guard let data = tapsRaw.data(using: .utf8),
          let taps = try? JSONSerialization.jsonObject(with: data) as? [[CGFloat]], taps.count >= 3 else {
      XCTFail("PRECONDITION FAILED: DUO_TAPS must be [[x,y],[x,y],[x,y]]")
      return
    }
    let s = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    s.withOffset(CGVector(dx: taps[0][0], dy: taps[0][1])).tap()
    XCTAssertTrue(waitCount(0), "selection mode did not open after tapping the Select row")
    s.withOffset(CGVector(dx: taps[1][0], dy: taps[1][1])).tap()
    sleep(1)
    s.withOffset(CGVector(dx: taps[2][0], dy: taps[2][1])).tap()
    XCTAssertTrue(waitCount(2), "the two row taps must select exactly two entries")
    print("PROBE-SELECTED-2 via points \(taps)")
    shoot("duo-points-select-two")
  }

  /// Fold-input: tap the Create button by an AXE-read point
  /// (TEST_RUNNER_DUO_TAPS = [[x,y]] on the still-present alert) after an
  /// external fold, then require the exact persisted row.
  func testTapPointSubmitFoldedInput() throws {
    let field = app.textFields["Name"]
    XCTAssertTrue(field.waitForExistence(timeout: 6),
                  "PRECONDITION FAILED: the Create-folder alert is not up")
    let value = field.value as? String ?? "?"
    print("PROBE-FOLD-INPUT afterFold=\(value)")
    XCTAssertEqual(value, "DuoFold43", "the typed name did not survive the fold")
    let tapsRaw = ProcessInfo.processInfo.environment["DUO_TAPS"] ?? "[]"
    guard let data = tapsRaw.data(using: .utf8),
          let taps = try? JSONSerialization.jsonObject(with: data) as? [[CGFloat]], taps.count >= 1 else {
      XCTFail("PRECONDITION FAILED: DUO_TAPS must be [[x,y]]")
      return
    }
    let s = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    s.withOffset(CGVector(dx: taps[0][0], dy: taps[0][1])).tap()
    sleep(3)
    let row = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Folder, DuoFold43")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 8), "no Folder DuoFold43 row after the folded submit")
    print("PROBE-FOLD-INPUT persisted=\(row.label)")
  }

  /// Generic single-point tap by AXE-read coordinates (DUO_TAPS = [[x,y]]).
  func testTapPoint() {
    ensureLibrary()
    let tapsRaw = ProcessInfo.processInfo.environment["DUO_TAPS"] ?? "[]"
    guard let data = tapsRaw.data(using: .utf8),
          let taps = try? JSONSerialization.jsonObject(with: data) as? [[CGFloat]], taps.count >= 1 else {
      XCTFail("PRECONDITION FAILED: DUO_TAPS must be [[x,y]]")
      return
    }
    let s = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    s.withOffset(CGVector(dx: taps[0][0], dy: taps[0][1])).tap()
    sleep(2)
    print("PROBE-TAP-POINT done at \(taps[0])")
  }

  /// Real long-press at an AXE-read point (DUO_TAPS=[[x,y]], DUO_PRESS_MS=2000):
  /// a synthetic 2-second press, e.g. to open a word's lookup drawer.
  func testTapPointPress() {
    ensureReaderOrLibrary()
    let tapsRaw = ProcessInfo.processInfo.environment["DUO_TAPS"] ?? "[]"
    let ms = Double(ProcessInfo.processInfo.environment["DUO_PRESS_MS"] ?? "2000") ?? 2000
    guard let data = tapsRaw.data(using: .utf8),
          let taps = try? JSONSerialization.jsonObject(with: data) as? [[CGFloat]], taps.count >= 1 else {
      XCTFail("PRECONDITION FAILED: DUO_TAPS must be [[x,y]]")
      return
    }
    let s = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    s.withOffset(CGVector(dx: taps[0][0], dy: taps[0][1])).press(forDuration: ms / 1000)
    sleep(2)
    print("PROBE-PRESS done at \(taps[0]) for \(ms) ms")
  }

  private func ensureReaderOrLibrary() {
    let ok = app.buttons["Library actions"].waitForExistence(timeout: 3)
      || app.buttons["Play"].waitForExistence(timeout: 5)
      || app.buttons["More actions"].waitForExistence(timeout: 5)
    XCTAssertTrue(ok, "PRECONDITION FAILED: neither Library nor Reader on screen; not launching")
  }

  /// Precondition-free single-point tap for non-continuity navigation (e.g.
  /// Settings screens). The caller owns the app-state assertions.
  func testTapPointFree() {
    let tapsRaw = ProcessInfo.processInfo.environment["DUO_TAPS"] ?? "[]"
    guard let data = tapsRaw.data(using: .utf8),
          let taps = try? JSONSerialization.jsonObject(with: data) as? [[CGFloat]], taps.count >= 1 else {
      XCTFail("PRECONDITION FAILED: DUO_TAPS must be [[x,y]]")
      return
    }
    let s = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    s.withOffset(CGVector(dx: taps[0][0], dy: taps[0][1])).tap()
    sleep(2)
    print("PROBE-TAP-POINT-FREE done at \(taps[0])")
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
