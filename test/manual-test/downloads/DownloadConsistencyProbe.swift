import XCTest

/// Real-touch coverage for the Download-consistency batch (#253, #171, #277,
/// #172, #278) on the `test/manual-test/fixtures/download-consistency-fixture.ts`
/// books, against a controlled fake Kokoro the settings already point at.
///
/// Every method is parameterized through the kit's Probe-Info.plist channel
/// (`DC<Name>` keys the shell inserts with plutil before a run; see `env`
/// below for why the environment is not used), so the shell can stage state
/// between runs: the download of a book keeps
/// running after a method exits, and a later method attaches to the app as it
/// stands. Books are opened from the Library by real touches (row, More
/// actions, Download); selections and starts are real button touches; every
/// claim carries a screenshot and a tree attachment.
///
/// What a timed Pause all cannot do here: the method cannot wait on the fake
/// provider's request log. The shell watches that log and touches Pause all
/// itself (`axe touch` at coordinates read from a tree taken in the same
/// screen state); this probe's `testWatchSettled` then asserts the outcome.
/// That split — probe touches for everything with a stable target, shell
/// touches for the one timed tap — is recorded in the verification note.
final class DownloadConsistencyProbe: XCTestCase {
  let bundle = "top.xujialiu.openreader"

  // MARK: helpers

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func env(_ name: String) -> String? {
    // Xcode 27's xcodebuild no longer forwards TEST_RUNNER_-prefixed caller
    // environment (or same-named command-line arguments) to the test runner
    // process, so parameters travel the kit's plist channel instead:
    // run-probe.sh's generated Probe-Info.plist is this bundle's
    // INFOPLIST_FILE, and the shell inserts `DC<Name>` keys into it before a
    // run (plutil -remove DC<Name> || true; plutil -insert DC<Name> -string …).
    // The incremental build reprocesses the plist; a stale value shows up
    // immediately in testEnvDump and the assertions.
    Bundle(for: Self.self).object(forInfoDictionaryKey: "DC" + name) as? String
  }

  func requiredEnv(_ name: String) -> String {
    guard let value = env(name), !value.isEmpty else {
      XCTFail("param DC\(name) missing (plist-v2)")
      return ""
    }
    return value
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

  /// The drawer is the phone's sheet with no close button (#117): a swipe down
  /// from its header puts it away. The drawer rests at half the screen's height.
  func closeSheet(_ app: XCUIApplication) {
    let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.52))
    let bottom = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.97))
    top.press(forDuration: 0.15, thenDragTo: bottom)
  }

  /// Real touches from wherever the app stands: back to the Library (if the
  /// reader is open), open the book's actions drawer, press Download, wait for
  /// the drawer's plan and rows. Leaves the Download drawer open.
  func openDownloadDrawer(_ app: XCUIApplication, book: String) {
    var backs = 0
    while backs < 4 && !app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", book + ",")).firstMatch.exists {
      let back = app.navigationBars.buttons.element(boundBy: 0)
      guard back.exists else { break }
      back.tap()
      backs += 1
      Thread.sleep(forTimeInterval: 0.6)
    }
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", book + ",")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10), "Library row for \(book) not found")
    row.tap()
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 10), "More actions not found for \(book)")
    app.buttons["More actions"].tap()
    let download = app.buttons["Download"]
    XCTAssertTrue(download.waitForExistence(timeout: 5), "Download action not offered for \(book)")
    download.tap()
    // The drawer's plan load: either the count line (plan ready) or the
    // preparing spinner line must show before the rows matter.
    XCTAssertTrue(until(30) {
      app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'downloaded'")).firstMatch.exists
        || app.staticTexts["Checking saved downloads…"].exists
        || app.staticTexts["Loading contents…"].exists
    }, "The Download drawer for \(book) never showed its plan or a preparing line")
    _ = until(15) { !app.staticTexts["Checking saved downloads…"].exists }
    capture("drawer-open-\(book)", app)
  }

  /// Real touches: Select all, then Download selected. Leaves the download
  /// running with the drawer open.
  func selectAllAndStart(_ app: XCUIApplication) {
    let select = app.buttons["Select all"]
    XCTAssertTrue(select.waitForExistence(timeout: 5), "Select all not found")
    select.tap()
    let start = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Download selected ('")).firstMatch
    XCTAssertTrue(start.waitForExistence(timeout: 5), "Download selected button not found")
    XCTAssertTrue(start.isEnabled, "Download selected is disabled")
    capture("before-start", app)
    start.tap()
  }

  /// The ring on the row titled `title`, as DownloadRingProbe finds it: a
  /// ring's label names the action, not the chapter.
  func ring(beside title: String, _ app: XCUIApplication) -> XCUIElement? {
    let names = app.staticTexts.matching(NSPredicate(format: "label == %@", title))
    let rings = app.buttons.matching(NSPredicate(format: "label == 'Pause download' OR label == 'Resume download'"))
    for n in 0..<names.count {
      let name = names.element(boundBy: n).frame
      for r in 0..<rings.count {
        let ring = rings.element(boundBy: r)
        if abs(ring.frame.midY - name.midY) < 22 && ring.frame.minX > name.minX { return ring }
      }
    }
    return nil
  }

  func rowElement(_ label: String, _ app: XCUIApplication) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
  }

  /// A row's checked label: `, downloaded` with an optional `, being read`
  /// infix when the reader stands on that chapter behind the drawer.
  func rowIsChecked(_ label: String, _ app: XCUIApplication) -> Bool {
    rowElement(label + ", downloaded", app).exists || rowElement(label + ", being read, downloaded", app).exists
  }

  func rowIsListed(_ label: String, _ app: XCUIApplication) -> Bool {
    rowElement(label, app).exists || rowElement(label + ", being read", app).exists
      || rowElement(label + ", downloaded", app).exists || rowElement(label + ", being read, downloaded", app).exists
  }

  /// Diagnostic: prints the resolved parameters and every environment key the
  /// runner sees, so the plist channel and its staleness can be checked before
  /// the assertions. Not a claim.
  func testEnvDump() throws {
    let keys = ProcessInfo.processInfo.environment.keys.filter { $0.contains("DC_") || $0.hasPrefix("TEST_RUNNER") }.sorted()
    print("DC-ENV-SEEN: \(keys)")
    print("DC-PARAM-BOOK: \(env("BOOK") ?? "nil")")
    print("DC-PARAM-COUNT: \(env("COUNT") ?? "nil")")
  }

  // MARK: staged steps

  /// Opens the Download drawer of TEST_RUNNER_DC_BOOK and leaves it open.
  func testOpenDownloadDrawer() throws {
    let app = XCUIApplication(bundleIdentifier: bundle)
    app.activate()
    openDownloadDrawer(app, book: requiredEnv("BOOK"))
  }

  /// Opens the drawer of TEST_RUNNER_DC_BOOK, Select all, Download selected.
  /// Consent and the running download are left to the shell.
  func testSelectAllAndStart() throws {
    let app = XCUIApplication(bundleIdentifier: bundle)
    app.activate()
    openDownloadDrawer(app, book: requiredEnv("BOOK"))
    selectAllAndStart(app)
    // The first download at a new address raises the Consent question before
    // the task exists (startDownload runs consent.ensure first). That alert is
    // this method's other success: the shell reads and answers it (the
    // preflight), and a later method asserts the running download.
    XCTAssertTrue(until(20) {
      if app.alerts.firstMatch.exists { print("CONSENT-UP"); return true }
      // A download over only empty parts settles inside this window.
      if let count = env("COUNT"), !count.isEmpty, app.staticTexts[count].exists { print("ALREADY-SETTLED"); return true }
      return app.buttons["Pause all"].exists
        || app.buttons.matching(NSPredicate(format: "label == 'Pause download'")).firstMatch.exists
        || app.staticTexts["Needs attention"].exists
    }, "The download never showed Pause all, a running ring, Needs attention, the Consent alert, or its settled count")
    capture("started-\(requiredEnv("BOOK"))", app)
  }

  /// Waits for TEST_RUNNER_DC_COUNT (e.g. `2 chapters downloaded`), then
  /// asserts the settled shape: no Resume all, no Pause all, no Needs
  /// attention, no state line left over. TEST_RUNNER_DC_NOCHECK names rows
  /// that must NOT carry `, downloaded` (comma-separated); TEST_RUNNER_DC_CHECK
  /// names rows that must.
  func testWatchSettled() throws {
    print("DC-SETTLED-V3")
    let app = XCUIApplication(bundleIdentifier: bundle)
    app.activate()
    let count = requiredEnv("COUNT")
    let book = requiredEnv("BOOK")
    if !app.staticTexts[count].exists {
      openDownloadDrawer(app, book: book)
    }
    XCTAssertTrue(app.staticTexts[count].waitForExistence(timeout: 90), "\(count) never appeared for \(book)")
    XCTAssertFalse(app.buttons["Resume all"].exists, "A finished download must not offer Resume all")
    XCTAssertFalse(app.buttons["Pause all"].exists, "A finished download must not offer Pause all")
    XCTAssertFalse(app.staticTexts["Needs attention"].exists, "A finished download must not read Needs attention")
    for row in (env("CHECK") ?? "").split(separator: ",").map(String.init) where !row.isEmpty {
      XCTAssertTrue(until(10) { self.rowIsChecked(row, app) }, "\(row) has no downloaded check")
    }
    for row in (env("NOCHECK") ?? "").split(separator: ",").map(String.init) where !row.isEmpty {
      // An inspected empty part is not listed at all (speaks() is false after
      // inspection), which also satisfies "no Downloaded check": print the
      // shape for the record, assert only the absence of a check.
      let listed = rowIsListed(row, app)
      print("DC-NOCHECK-ROW \(row): listed=\(listed) checked=\(rowIsChecked(row, app))")
      XCTAssertFalse(self.rowIsChecked(row, app), "\(row) must not carry a downloaded check")
    }
    capture("settled-\(book)", app)
  }

  /// Pauses while replies are out, then finishes by itself (#171): the shell
  /// has tapped Pause all during the final requests; this method only waits
  /// for TEST_RUNNER_DC_COUNT to appear without any Resume tap, and asserts
  /// every TEST_RUNNER_DC_CHECK row is checked and no Resume all is offered.
  /// `DC_SELF` must be `yes` for the no-Resume-tap claim to be recorded.
  func testWatchSelfFinish() throws {
    let app = XCUIApplication(bundleIdentifier: bundle)
    app.activate()
    let book = requiredEnv("BOOK")
    let count = requiredEnv("COUNT")
    XCTAssertEqual(requiredEnv("SELF"), "yes")
    XCTAssertTrue(app.staticTexts[count].waitForExistence(timeout: 90), "\(count) never appeared for \(book) after the held pause")
    XCTAssertFalse(app.buttons["Resume all"].exists, "#171: the finished download must not offer Resume all")
    XCTAssertFalse(app.buttons["Pause all"].exists)
    for row in requiredEnv("CHECK").split(separator: ",").map(String.init) where !row.isEmpty {
      XCTAssertTrue(until(10) { self.rowIsChecked(row, app) }, "\(row) has no downloaded check")
    }
    XCTAssertFalse(app.staticTexts["Needs attention"].exists)
    capture("self-finished-\(book)", app)
  }

  /// The control pause (#171): the shell tapped Pause all while TEST_RUNNER_DC_PART
  /// still had unsent sentences. Asserts the paused shape: Resume all offered,
  /// TEST_RUNNER_DC_DONE checked, DC_PART present with NO check, and Pause all gone.
  func testWatchPausedControl() throws {
    let app = XCUIApplication(bundleIdentifier: bundle)
    app.activate()
    let book = requiredEnv("BOOK")
    let part = requiredEnv("PART")
    let done = requiredEnv("DONE")
    XCTAssertTrue(app.buttons["Resume all"].waitForExistence(timeout: 60), "The paused download does not offer Resume all")
    XCTAssertFalse(app.buttons["Pause all"].exists, "A paused download must not offer Pause all")
    XCTAssertTrue(until(10) { self.rowIsChecked(done, app) }, "\(done) should carry its check")
    XCTAssertTrue(rowIsListed(part, app), "\(part) is not listed")
    XCTAssertFalse(rowIsChecked(part, app), "\(part) must not carry a check while paused incomplete")
    capture("paused-control-\(book)", app)
  }

  /// #277: in Manage, TEST_RUNNER_DC_PART (paused, partly saved) must show a
  /// checkbox; select it by its row touch, then Delete selected and confirm
  /// the alert. Afterwards the download must read done: TEST_RUNNER_DC_COUNT,
  /// no Resume all, DC_PART gone from the list.
  func testManageDeleteSelected() throws {
    let app = XCUIApplication(bundleIdentifier: bundle)
    app.activate()
    let book = requiredEnv("BOOK")
    let part = requiredEnv("PART")
    let count = requiredEnv("COUNT")
    openDownloadDrawer(app, book: book)
    XCTAssertTrue(app.buttons["Manage downloads"].waitForExistence(timeout: 5), "Manage downloads not offered")
    app.buttons["Manage downloads"].tap()
    let partRow = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", part)).firstMatch
    XCTAssertTrue(partRow.waitForExistence(timeout: 10), "\(part) is not listed in Manage")
    // A selectable partly saved paused chapter: its row is a checkbox, checked state off.
    let checkboxes = app.descendants(matching: .any).matching(NSPredicate(format: "accessibilityRole == 'checkbox'"))
    var found = false
    for n in 0..<checkboxes.count {
      let box = checkboxes.element(boundBy: n)
      if abs(box.frame.minY - partRow.frame.minY) < 22 && box.frame.minX < partRow.frame.minX {
        XCTAssertEqual(box.value as? String, "0", "\(part)'s checkbox should start unchecked")
        box.tap()
        found = true
        break
      }
    }
    XCTAssertTrue(found, "\(part) has no checkbox in Manage — a partly saved paused chapter must be selectable")
    capture("manage-selected-\(book)", app)
    let del = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Delete selected ('")).firstMatch
    XCTAssertTrue(del.waitForExistence(timeout: 5), "Delete selected not enabled")
    del.tap()
    let alertDelete = app.alerts.buttons["Delete"]
    XCTAssertTrue(alertDelete.waitForExistence(timeout: 5), "The delete confirmation alert did not appear")
    capture("delete-confirm-\(book)", app)
    alertDelete.tap()
    // Back from Manage to the plain Download view.
    let back = app.buttons["Back from Manage"]
    if back.waitForExistence(timeout: 5) { back.tap() }
    XCTAssertTrue(app.staticTexts[count].waitForExistence(timeout: 30), "\(count) never appeared after the delete")
    XCTAssertFalse(app.buttons["Resume all"].exists, "#277: a download whose remaining chapters are complete must not offer Resume all")
    XCTAssertFalse(rowIsListed(part, app), "\(part) must be gone from the list")
    capture("after-delete-\(book)", app)
  }

  /// #278: with the app wherever it is, real touches into Settings › General,
  /// toggle `Remove enclosing brackets when reading` (TEST_RUNNER_DC_STRIP `off`
  /// or `on`), then walk back out to the Library. The drawer reopening and the
  /// line assertions are `testWatchSettled`/`testAssertLine` runs.
  func testToggleStripBrackets() throws {
    let app = XCUIApplication(bundleIdentifier: bundle)
    app.activate()
    let wanted = requiredEnv("STRIP") == "on"
    var backs = 0
    while backs < 4 && !app.buttons["Settings"].exists {
      let back = app.navigationBars.buttons.element(boundBy: 0)
      guard back.exists else { break }
      back.tap()
      backs += 1
      Thread.sleep(forTimeInterval: 0.6)
    }
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10), "Settings button not found from the Library")
    app.buttons["Settings"].tap()
    let general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'General'")).firstMatch
    XCTAssertTrue(general.waitForExistence(timeout: 5), "General row not found")
    general.tap()
    let row = app.switches["Remove enclosing brackets when reading"]
    XCTAssertTrue(row.waitForExistence(timeout: 10), "The brackets switch was not found")
    let isOn = row.value as? String == "1"
    if isOn != wanted {
      row.tap()
      XCTAssertTrue(until(5) { (row.value as? String == "1") == wanted }, "The brackets switch did not change")
    }
    capture("brackets-\(requiredEnv("STRIP"))", app)
    // Back out to the Library: General's back, then Settings' back.
    app.navigationBars.buttons.element(boundBy: 0).tap()
    Thread.sleep(forTimeInterval: 0.6)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Bracket Fixture,'")).firstMatch.waitForExistence(timeout: 10), "Did not land back on the Library")
  }

  /// Asserts the drawer's status line and control for one task state, read
  /// from the open Download drawer. TEST_RUNNER_DC_LINE is the exact first
  /// state line (e.g. `Needs attention`); TEST_RUNNER_DC_ERROR, when set, must
  /// appear as a line in the drawer. TEST_RUNNER_DC_RESUME is `yes` when
  /// Resume all must be offered, `no` when it must not.
  func testAssertTaskLine() throws {
    let app = XCUIApplication(bundleIdentifier: bundle)
    app.activate()
    let line = requiredEnv("LINE")
    if !app.staticTexts[line].exists {
      openDownloadDrawer(app, book: requiredEnv("BOOK"))
    }
    XCTAssertTrue(app.staticTexts[line].waitForExistence(timeout: 10), "The line '\(line)' was not found in the drawer")
    if let error = env("ERROR"), !error.isEmpty {
      XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", error)).firstMatch.exists,
                    "The error text '\(error)' was not shown")
    }
    let resume = requiredEnv("RESUME")
    XCTAssertEqual(app.buttons["Resume all"].exists, resume == "yes", "Resume all presence is \(app.buttons["Resume all"].exists), wanted \(resume)")
    // A blocked task must not show any writing: no running ring anywhere.
    if line == "Needs attention" {
      XCTAssertFalse(app.buttons["Pause download"].exists, "A blocked task must not show a running ring")
    }
    capture("taskline-\(line)", app)
  }

  /// Taps Resume all (real touch) and waits for TEST_RUNNER_DC_THEN:
  /// `blocked` (the line comes back) or `done` (TEST_RUNNER_DC_COUNT appears).
  func testTapResumeAll() throws {
    let app = XCUIApplication(bundleIdentifier: bundle)
    app.activate()
    let then = requiredEnv("THEN")
    let resume = app.buttons["Resume all"]
    XCTAssertTrue(resume.waitForExistence(timeout: 10), "Resume all was not offered")
    resume.tap()
    if then == "blocked" {
      XCTAssertTrue(app.staticTexts["Needs attention"].waitForExistence(timeout: 30), "Resume all did not leave the task blocked again")
    } else {
      let count = requiredEnv("COUNT")
      XCTAssertTrue(app.staticTexts[count].waitForExistence(timeout: 90), "\(count) never appeared after Resume all")
      XCTAssertFalse(app.buttons["Resume all"].exists)
    }
    capture("after-resume-\(then)", app)
  }

  /// Restarts the app cold (terminate + launch, no launch argument: the
  /// container plist carries the Metro port) and reopens TEST_RUNNER_DC_BOOK's
  /// Download drawer. What is asserted afterwards is the caller's job via
  /// `testAssertTaskLine`/`testWatchSettled`; this method only proves the
  /// drawer renders again after the restart and attaches a screenshot.
  func testRelaunchAndReopen() throws {
    let app = XCUIApplication(bundleIdentifier: bundle)
    app.terminate()
    Thread.sleep(forTimeInterval: 1.5)
    app.launch()
    XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Library'")).firstMatch.waitForExistence(timeout: 20)
      || app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Actions for '")).firstMatch.waitForExistence(timeout: 20)
      || app.buttons["Settings"].waitForExistence(timeout: 20), "The app did not come back to a Library screen")
    openDownloadDrawer(app, book: requiredEnv("BOOK"))
  }
}
