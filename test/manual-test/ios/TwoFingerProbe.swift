import ObjectiveC
import XCTest

/// Two-finger drags, which XCTest's public API cannot make (#57).
///
/// `XCUICoordinate` drags with one finger and `pinch`/`rotate` move two fingers
/// apart or around each other; nothing moves two fingers together. XCTest's own
/// synthesis does, and keeps it private in XCUIAutomation: an
/// `XCPointerEventPath` per finger, added to an `XCSynthesizedEventRecord`, and
/// played by the device's `eventSynthesizer`. The selectors were read out of
/// Xcode 27.0's XCUIAutomation binary; the calls go through their
/// implementations because the arguments are points and numbers, which
/// `perform(_:)` cannot pass.
enum Fingers {
  typealias InitTouch = @convention(c) (AnyObject, Selector, CGPoint, Double) -> AnyObject
  typealias MoveTo = @convention(c) (AnyObject, Selector, CGPoint, Double) -> Void
  typealias LiftUp = @convention(c) (AnyObject, Selector, Double) -> Void
  typealias InitRecord = @convention(c) (AnyObject, Selector, NSString, Int) -> AnyObject
  typealias AddPath = @convention(c) (AnyObject, Selector, AnyObject) -> Void
  // `@escaping`: the synthesizer keeps the block, and a non-escaping one traps with "closure argument passed as @noescape to Objective-C has escaped".
  typealias Synthesize = @convention(c) (AnyObject, Selector, AnyObject, @escaping @convention(block) (Bool, NSError?) -> Void) -> Void

  static func method<T>(_ cls: AnyClass, _ name: String, _ type: T.Type) -> (T, Selector) {
    let selector = NSSelectorFromString(name)
    guard let found = class_getInstanceMethod(cls, selector) else { fatalError("\(cls) has no \(name)") }
    return (unsafeBitCast(method_getImplementation(found), to: type), selector)
  }

  /// One finger: down at the first point at its time, through each later point at its time, up at `lift`. Times are seconds from the start of the record.
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

  /// Two fingers `spread` points apart side by side, both following `track` (points and times for the midpoint between them).
  static func pair(_ track: [(CGPoint, Double)], lift: Double, spread: CGFloat = 36) -> [AnyObject] {
    let left = track.map { (CGPoint(x: $0.0.x - spread / 2, y: $0.0.y), $0.1) }
    let right = track.map { (CGPoint(x: $0.0.x + spread / 2, y: $0.0.y), $0.1) }
    return [finger(left, lift: lift), finger(right, lift: lift)]
  }

  /// A straight move from `from` to `to` over `seconds`, in small steps, starting at `start`.
  static func line(_ from: CGPoint, _ to: CGPoint, start: Double, seconds: Double, steps: Int = 20) -> [(CGPoint, Double)] {
    (0...steps).map { index in
      let t = Double(index) / Double(steps)
      return (CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t), start + seconds * t)
    }
  }

  /// Plays the fingers together and waits for the device to have done so.
  static func play(_ fingers: [AnyObject], name: String, in test: XCTestCase) {
    let cls: AnyClass = NSClassFromString("XCSynthesizedEventRecord")!
    let (record, recordSelector) = method(cls, "initWithName:interfaceOrientation:", InitRecord.self)
    let (add, addSelector) = method(cls, "addPointerEventPath:", AddPath.self)
    let event = record(class_createInstance(cls, 0) as AnyObject, recordSelector, name as NSString, 1)
    for finger in fingers { add(event, addSelector, finger) }
    let synthesizer = XCUIDevice.shared.perform(NSSelectorFromString("eventSynthesizer"))!.takeUnretainedValue()
    let (synthesize, synthesizeSelector) = method(object_getClass(synthesizer)!, "synthesizeEvent:completion:", Synthesize.self)
    let done = test.expectation(description: name)
    synthesize(synthesizer, synthesizeSelector, event) { ok, error in
      if !ok { print("TWO-FINGER SYNTHESIS FAILED \(name): \(String(describing: error))") }
      done.fulfill()
    }
    test.wait(for: [done], timeout: 60)
  }
}

/// Measures the phone's own two-finger selection in Files (#57), so the
/// download drawer can copy it rather than a memory of it, and then drives the
/// drawer's copy the same way. `two-finger.sh` stages the Files rows and runs
/// one method at a time.
final class TwoFingerProbe: XCTestCase {
  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  /// Files, in the staged `Rows` folder of On My iPhone, shown as a list.
  func openRows() -> XCUIApplication {
    let files = XCUIApplication(bundleIdentifier: "com.apple.DocumentsApp")
    files.terminate()
    files.launch()
    let browse = files.buttons["Browse"]
    XCTAssertTrue(browse.waitForExistence(timeout: 10))
    browse.tap()
    capture("files-browse", files)
    let onPhone = files.descendants(matching: .any).matching(NSPredicate(format: "label == 'On My iPhone'")).firstMatch
    XCTAssertTrue(onPhone.waitForExistence(timeout: 10))
    onPhone.tap()
    let rows = files.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Rows'")).firstMatch
    XCTAssertTrue(rows.waitForExistence(timeout: 10))
    rows.tap()
    XCTAssertTrue(row(1, files).waitForExistence(timeout: 20))
    // Files opens a folder as icons; the rows of a list are what the drawer has.
    if row(1, files).frame.width < 200 {
      let more = files.buttons["More"]
      XCTAssertTrue(more.waitForExistence(timeout: 5), "No More button to switch Files to a list")
      more.tap()
      capture("files-more-menu", files)
      let list = files.buttons.matching(NSPredicate(format: "label == 'List' OR label BEGINSWITH 'List,'")).firstMatch
      XCTAssertTrue(list.waitForExistence(timeout: 5), "No List in the More menu")
      list.tap()
      XCTAssertTrue(until(5) { self.row(1, files).frame.width >= 200 }, "Files did not switch to a list")
    }
    capture("files-rows", files)
    return files
  }

  /// Polls `condition` until it holds or `timeout` passes.
  func until(_ timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    repeat {
      if condition() { return true }
      Thread.sleep(forTimeInterval: 0.25)
    } while Date() < deadline
    return false
  }

  /// The row named `Row NN`, wherever Files exposes its label.
  func row(_ number: Int, _ app: XCUIApplication) -> XCUIElement {
    app.cells.matching(NSPredicate(format: "label BEGINSWITH %@", String(format: "Row %02d", number))).firstMatch
  }

  /// Which staged rows Files reports selected, by number.
  func selected(_ app: XCUIApplication) -> [Int] {
    let cells = app.cells.matching(NSPredicate(format: "label BEGINSWITH 'Row '"))
    var numbers: [Int] = []
    for index in 0..<cells.count {
      let cell = cells.element(boundBy: index)
      if cell.isSelected, let n = Int(cell.label.dropFirst(4).prefix(2)) { numbers.append(n) }
    }
    return numbers.sorted()
  }

  /// Files' own count of what is selected, from its title (`5 Items`), which counts rows scrolled out of view too.
  func count(_ app: XCUIApplication) -> String {
    let title = app.staticTexts.matching(NSPredicate(format: "label ENDSWITH ' Items' OR label ENDSWITH ' Item' OR label == 'Select Items'")).firstMatch
    return title.exists ? title.label : "(no count)"
  }

  /// The number of the first row whose top is on screen below the search field.
  func firstVisible(_ app: XCUIApplication) -> Int {
    let cells = app.cells.matching(NSPredicate(format: "label BEGINSWITH 'Row '"))
    var numbers: [Int] = []
    for index in 0..<cells.count {
      let cell = cells.element(boundBy: index)
      if cell.frame.minY >= 150, let n = Int(cell.label.dropFirst(4).prefix(2)) { numbers.append(n) }
    }
    return numbers.min() ?? -1
  }

  func centre(_ number: Int, _ app: XCUIApplication) -> CGPoint {
    let frame = row(number, app).frame
    return CGPoint(x: frame.midX, y: frame.midY)
  }

  func report(_ name: String, _ app: XCUIApplication) {
    Thread.sleep(forTimeInterval: 1)
    capture(name, app)
    print("MEASURE \(name): selected=\(selected(app)) count=\(count(app)) firstVisible=\(firstVisible(app))")
  }

  /// Down from row 2 to row 8, back up to row 5, lift: a range from where it began, or everything the fingers crossed?
  func testFilesBackTowardStart() throws {
    let files = openRows()
    let track = Fingers.line(centre(2, files), centre(8, files), start: 0, seconds: 1.2)
      + Fingers.line(centre(8, files), centre(5, files), start: 1.3, seconds: 0.8).dropFirst()
    Fingers.play(Fingers.pair(track, lift: 2.3), name: "back", in: self)
    report("back-2-8-5", files)
  }

  /// Down from row 5 to row 7, then up past the start to row 3: which side of the start stays selected?
  func testFilesPastTheStart() throws {
    let files = openRows()
    let track = Fingers.line(centre(5, files), centre(7, files), start: 0, seconds: 0.6)
      + Fingers.line(centre(7, files), centre(3, files), start: 0.7, seconds: 1.0).dropFirst()
    Fingers.play(Fingers.pair(track, lift: 1.9), name: "past", in: self)
    report("past-5-7-3", files)
  }

  /// Rows 3–6 selected by one drag; then a drag that starts on selected row 4 and goes to row 8, and one that starts on unselected row 10 and goes up to row 8.
  func testFilesStartingRowDecides() throws {
    let files = openRows()
    Fingers.play(Fingers.pair(Fingers.line(centre(3, files), centre(6, files), start: 0, seconds: 0.8), lift: 1.0), name: "first", in: self)
    report("decide-1-select-3-6", files)
    Fingers.play(Fingers.pair(Fingers.line(centre(4, files), centre(8, files), start: 0, seconds: 1.0), lift: 1.2), name: "second", in: self)
    report("decide-2-from-selected-4-to-8", files)
    Fingers.play(Fingers.pair(Fingers.line(centre(10, files), centre(8, files), start: 0, seconds: 0.6), lift: 0.8), name: "third", in: self)
    report("decide-3-from-unselected-10-to-8", files)
  }

  /// Two fingers from row 2 to row 4, then the left one lifts and the right one goes on to row 9.
  func testFilesOneFingerGoesOn() throws {
    let files = openRows()
    let spread: CGFloat = 36
    let together = Fingers.line(centre(2, files), centre(4, files), start: 0, seconds: 0.6)
    let alone = Fingers.line(centre(4, files), centre(9, files), start: 0.8, seconds: 1.0).dropFirst()
    let left = Fingers.finger(together.map { (CGPoint(x: $0.0.x - spread / 2, y: $0.0.y), $0.1) }, lift: 0.7)
    let right = Fingers.finger((together + alone).map { (CGPoint(x: $0.0.x + spread / 2, y: $0.0.y), $0.1) }, lift: 2.0)
    Fingers.play([left, right], name: "one-goes-on", in: self)
    report("one-finger-2-4-then-9", files)
  }

  /// Two fingers moved sideways across row 3.
  func testFilesSideways() throws {
    let files = openRows()
    let y = centre(3, files).y
    Fingers.play(Fingers.pair(Fingers.line(CGPoint(x: 90, y: y), CGPoint(x: 330, y: y), start: 0, seconds: 0.8), lift: 1.0), name: "sideways", in: self)
    report("sideways-row-3", files)
  }

  /// Held at `end` from `from` for `seconds`, trembling a point and a half every tenth of a second as a held finger does. Perfectly still holds sometimes stopped Files scrolling at all (notes 2026-09-24, 02:47).
  func held(_ end: CGPoint, from: Double, seconds: Double) -> [(CGPoint, Double)] {
    stride(from: 0.1, through: seconds, by: 0.1).enumerated().map { index, t in
      (CGPoint(x: end.x, y: end.y + (index % 2 == 0 ? 1.5 : -1.5)), from + t)
    }
  }

  /// From row 2 down to `inset` points above the screen's bottom edge, held there for `hold` seconds: how far the list scrolls and how many rows are selected.
  func autoScroll(inset: CGFloat, hold: Double, tremble: Bool = false) {
    let files = openRows()
    let bottom = XCUIScreen.main.screenshot().image.size.height
    let start = centre(2, files)
    let end = CGPoint(x: start.x, y: bottom - inset)
    let track = Fingers.line(start, end, start: 0, seconds: 0.8) + (tremble ? held(end, from: 0.8, seconds: hold) : [(end, 0.8 + hold)])
    Fingers.play(Fingers.pair(track, lift: 0.9 + hold), name: "edge", in: self)
    report("edge-inset-\(Int(inset))-hold-\(hold)\(tremble ? "-trembling" : "")", files)
  }
  func testFilesEdgeProfile() throws {
    for inset in [110.0, 100.0, 90.0, 60.0] as [CGFloat] { autoScroll(inset: inset, hold: 1.5) }
  }
  func testFilesEdgeTime() throws {
    for hold in [0.5, 3.0] { autoScroll(inset: 60, hold: hold) }
  }
  /// The same at the top: the list scrolled down by one-finger drags first, then two fingers held `y` points from the screen's top.
  func autoScrollTop(y: CGFloat, hold: Double, tremble: Bool = false) {
    let files = openRows()
    for _ in 0..<3 {
      Fingers.play([Fingers.finger(Fingers.line(CGPoint(x: 300, y: 700), CGPoint(x: 300, y: 300), start: 0, seconds: 0.5), lift: 0.55)], name: "down", in: self)
      Thread.sleep(forTimeInterval: 1.5)
    }
    let first = firstVisible(files)
    let start = centre(first + 5, files)
    let end = CGPoint(x: start.x, y: y)
    let track = Fingers.line(start, end, start: 0, seconds: 0.8) + (tremble ? held(end, from: 0.8, seconds: hold) : [(end, 0.8 + hold)])
    Fingers.play(Fingers.pair(track, lift: 0.9 + hold), name: "top", in: self)
    print("MEASURE top-before: firstVisible=\(first)")
    report("top-y-\(Int(y))-hold-\(hold)\(tremble ? "-trembling" : "")", files)
  }
  func testFilesEdgeTrembling() throws {
    for (inset, hold) in [(30.0, 1.0), (70.0, 1.0), (70.0, 2.0)] as [(CGFloat, Double)] { autoScroll(inset: inset, hold: hold, tremble: true) }
    for y in [175.0, 150.0] as [CGFloat] { autoScrollTop(y: y, hold: 1.0, tremble: true) }
  }
  func testFilesTopEdge() throws {
    for y in [260.0, 220.0, 190.0] as [CGFloat] { autoScrollTop(y: y, hold: 1.0) }
  }
  func testFilesEdgeBand() throws {
    for inset in [12.0, 40.0, 80.0, 120.0, 180.0] as [CGFloat] { autoScroll(inset: inset, hold: 2) }
  }
  func testFilesEdgeSpeed() throws {
    for hold in [1.0, 3.0] { autoScroll(inset: 12, hold: hold) }
  }

  // MARK: - OpenReader's download drawer

  /// OpenReader, already running on the reader of the staged book, with its
  /// Download drawer open. `activate`, not `launch`: a relaunch from here
  /// drops the `-RCT_jsLocation` that points a worktree's device at its Metro
  /// (README, Pitfalls › Metro and the bundle).
  func openDrawer() -> XCUIApplication {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    // Closed and opened again, so each method starts from a drawer mounted afresh on the code Metro serves now.
    if app.buttons["Close Download"].exists {
      app.buttons["Close Download"].tap()
      _ = until(5) { !app.buttons["Close Download"].exists }
      Thread.sleep(forTimeInterval: 0.5)
    }
    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 10))
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 3))
    app.buttons["Download"].tap()
    XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label ENDSWITH 'chapters downloaded'")).firstMatch.waitForExistence(timeout: 20))
    return app
  }

  /// The drawer's chapter rows on screen, top to bottom: the checkbox rows and the rows with a ring.
  func drawerRows(_ app: XCUIApplication) -> [XCUIElement] {
    let boxes = app.descendants(matching: .any).matching(NSPredicate(format: "value == 'checkbox' OR value CONTAINS 'checkbox'"))
    var rows: [XCUIElement] = []
    for index in 0..<boxes.count { rows.append(boxes.element(boundBy: index)) }
    return rows.filter { $0.frame.height > 30 && $0.frame.height < 200 }.sorted { $0.frame.minY < $1.frame.minY }
  }

  func drawerReport(_ name: String, _ app: XCUIApplication) {
    Thread.sleep(forTimeInterval: 0.8)
    capture(name, app)
    let rows = drawerRows(app)
    let chosen = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Download selected (' OR label BEGINSWITH 'Delete selected ('")).firstMatch
    print("DRAWER \(name): button=\(chosen.exists ? chosen.label : "none") rows=\(rows.map { "\($0.label)=\($0.isSelected ? 1 : 0)" })")
  }

  /// The first shown row to the third, with two fingers: the smallest check that a sweep reaches the drawer.
  func testDrawerProof() throws {
    let app = openDrawer()
    drawerReport("drawer-before", app)
    let rows = drawerRows(app)
    XCTAssertGreaterThan(rows.count, 3, "Too few rows on screen to sweep")
    let from = CGPoint(x: rows[0].frame.midX, y: rows[0].frame.midY), to = CGPoint(x: rows[2].frame.midX, y: rows[2].frame.midY)
    Fingers.play(Fingers.pair(Fingers.line(from, to, start: 0, seconds: 0.8), lift: 1.0), name: "drawer-proof", in: self)
    drawerReport("drawer-after", app)
  }

  /// The count in `Download selected (N)`.
  func chosenCount(_ app: XCUIApplication) -> Int {
    let button = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Download selected (' OR label BEGINSWITH 'Delete selected ('")).firstMatch
    guard button.exists, let open = button.label.firstIndex(of: "("), let close = button.label.firstIndex(of: ")") else { return -1 }
    return Int(button.label[button.label.index(after: open)..<close]) ?? -1
  }

  /// One finger over the list, six times each as XCTest's swipe and as a slower drag: does a scroll ever choose the row it began on?
  func testDrawerOneFingerNeverChooses() throws {
    let app = openDrawer()
    let list = drawerRows(app).filter { $0.frame.minY > 300 && $0.frame.maxY < 700 }
    XCTAssertFalse(list.isEmpty)
    let x = list[0].frame.midX
    var changes: [String] = []
    for round in 0..<6 {
      let before = chosenCount(app)
      let rows = drawerRows(app).filter { $0.frame.minY > 300 && $0.frame.maxY < 700 }
      if round % 2 == 0 { rows[rows.count / 2].swipeUp() } else { rows[rows.count / 2].swipeDown() }
      Thread.sleep(forTimeInterval: 1.2)
      changes.append("swipe\(round % 2 == 0 ? "Up" : "Down") \(before)->\(chosenCount(app))")
    }
    for round in 0..<6 {
      let before = chosenCount(app)
      let from = CGPoint(x: x, y: round % 2 == 0 ? 560 : 400), to = CGPoint(x: x, y: round % 2 == 0 ? 400 : 560)
      Fingers.play([Fingers.finger(Fingers.line(from, to, start: 0, seconds: 0.5), lift: 0.55)], name: "drag-\(round)", in: self)
      Thread.sleep(forTimeInterval: 1.2)
      changes.append("drag\(round % 2 == 0 ? "Up" : "Down") \(before)->\(chosenCount(app))")
    }
    capture("one-finger-rounds", app)
    print("ONE FINGER ROUNDS: \(changes)")
  }

  /// The drawer's rows wholly inside the list: below the downloaded count, above the footer.
  func shownRows(_ app: XCUIApplication) -> [XCUIElement] {
    let top = app.staticTexts.matching(NSPredicate(format: "label ENDSWITH 'chapters downloaded' OR label ENDSWITH ' saved'")).firstMatch.frame.maxY
    let footer = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Download selected (' OR label BEGINSWITH 'Delete selected (' OR label == 'Manage downloads' OR label == 'Back to downloads'")).allElementsBoundByIndex.map { $0.frame.minY }.min() ?? 874
    return drawerRows(app).filter { $0.frame.minY >= top && $0.frame.maxY <= footer }
  }

  func sweep(_ from: CGPoint, _ to: CGPoint, seconds: Double = 0.8, hold: Double = 0, name: String) {
    let track = Fingers.line(from, to, start: 0, seconds: seconds) + (hold > 0 ? held(to, from: seconds, seconds: hold) : [])
    Fingers.play(Fingers.pair(track, lift: seconds + hold + 0.1), name: name, in: self)
    Thread.sleep(forTimeInterval: 0.8)
  }

  func mid(_ row: XCUIElement) -> CGPoint { CGPoint(x: row.frame.midX, y: row.frame.midY) }

  /// The drawer's copy, against the rules measured in Files.
  func testDrawerSweeps() throws {
    let app = openDrawer()
    var rows = shownRows(app)
    XCTAssertGreaterThanOrEqual(rows.count, 4, "Too few rows inside the list")
    print("DRAWER shown rows: \(rows.map { $0.label })")
    // A run: the first shown row to the fourth.
    sweep(mid(rows[0]), mid(rows[3]), name: "run")
    print("DRAWER run-0-3: \(chosenCount(app))")
    capture("drawer-run", app)
    // Back toward the start gives rows back: rows 0..3 then back to 1, from a clean start.
    let reopened = openDrawer()
    rows = shownRows(reopened)
    sweep(mid(rows[0]), mid(rows[3]), seconds: 0.6, name: "out")
    print("DRAWER after-out: \(chosenCount(reopened))")
    // A second sweep that begins on a selected row takes rows out, and gives back those it leaves on the way back.
    let back = Fingers.line(mid(rows[0]), mid(rows[3]), start: 0, seconds: 0.6) + Fingers.line(mid(rows[3]), mid(rows[1]), start: 0.7, seconds: 0.5).dropFirst()
    Fingers.play(Fingers.pair(Array(back), lift: 1.3), name: "from-selected", in: self)
    Thread.sleep(forTimeInterval: 0.8)
    print("DRAWER from-selected-0-3-1: \(chosenCount(reopened))")
    capture("drawer-from-selected", reopened)
    // One finger carries on: two fingers over rows 0..1, then one lifts and the other goes on to row 3.
    let third = openDrawer()
    rows = shownRows(third)
    let spread: CGFloat = 36
    let together = Fingers.line(mid(rows[0]), mid(rows[1]), start: 0, seconds: 0.5)
    let alone = Fingers.line(mid(rows[1]), mid(rows[3]), start: 0.7, seconds: 0.6).dropFirst()
    let left = Fingers.finger(together.map { (CGPoint(x: $0.0.x - spread / 2, y: $0.0.y), $0.1) }, lift: 0.6)
    let right = Fingers.finger((together + alone).map { (CGPoint(x: $0.0.x + spread / 2, y: $0.0.y), $0.1) }, lift: 1.5)
    Fingers.play([left, right], name: "one-goes-on", in: self)
    Thread.sleep(forTimeInterval: 0.8)
    print("DRAWER one-finger-0-1-then-3: \(chosenCount(third))")
    capture("drawer-one-finger", third)
    // Past the bottom edge onto the footer, held a second: the list scrolls by itself and the run follows.
    let fourth = openDrawer()
    rows = shownRows(fourth)
    let below = CGPoint(x: rows[0].frame.midX, y: rows[rows.count - 1].frame.maxY + 30)
    sweep(mid(rows[0]), below, seconds: 0.6, hold: 1.0, name: "edge")
    print("DRAWER edge-past-bottom-1s: \(chosenCount(fourth)) shown now: \(shownRows(fourth).map { $0.label })")
    capture("drawer-edge", fourth)
    // One finger scrolls and chooses nothing.
    let before = chosenCount(fourth)
    let x = rows[0].frame.midX
    Fingers.play([Fingers.finger(Fingers.line(CGPoint(x: x, y: below.y - 60), CGPoint(x: x, y: below.y - 200), start: 0, seconds: 0.5), lift: 0.55)], name: "one-finger", in: self)
    Thread.sleep(forTimeInterval: 1)
    print("DRAWER one-finger-scroll: \(before)->\(chosenCount(fourth))")
  }

  func testFilesSmoke() throws {
    let files = openRows()
    print("ROW CELLS: \(files.cells.matching(NSPredicate(format: "label BEGINSWITH 'Row '")).count)")
    let a = row(2, files).frame, b = row(6, files).frame
    print("ROW 2 FRAME \(a) ROW 6 FRAME \(b)")
    Fingers.play(Fingers.pair(Fingers.line(CGPoint(x: a.midX, y: a.midY), CGPoint(x: b.midX, y: b.midY), start: 0, seconds: 1.2), lift: 1.4), name: "smoke", in: self)
    Thread.sleep(forTimeInterval: 1)
    capture("files-after-smoke", files)
    print("SELECTED AFTER SMOKE: \(selected(files))")
  }
}
