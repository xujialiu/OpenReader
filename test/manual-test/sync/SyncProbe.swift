import XCTest

/// Issue #20's Sync screen, with real touches: the three outcomes of the
/// check-then-lock switch (wrong password, a folder that is not there yet,
/// and off again), and that the three fields are frozen exactly while the
/// switch is on.
///
/// Credentials are read from files the caller writes with mode 600 — never
/// typed into this source, printed, or captured. `Password` is a secure field,
/// so a screenshot cannot show it; `Address` and `Username` are photographed,
/// which is why the caller passes a **test subfolder**, not the real one.
/// Never presses Play.
final class SyncProbe: XCTestCase {
  let addressPath = "/tmp/openreader-sync-url.txt"
  let usernamePath = "/tmp/openreader-sync-user.txt"
  let passwordPath = "/tmp/openreader-sync-pass.txt"
  let wrongPasswordPath = "/tmp/openreader-sync-wrongpass.txt"
  /// The next `seq` a harness command written by this run uses (#54/#55 methods below).
  /// Seeded from the clock, not a fixed number: a fresh `SyncProbe` instance
  /// (one per `xcodebuild test` invocation) would otherwise start back at the
  /// same value every run, which can collide with a previous run's last
  /// written `seq` and let a stale command through `seenRef`'s dedup on the
  /// next fresh mount (see `clearHarness`, the actual fix, for what that did).
  var hSeq = Int(Date().timeIntervalSince1970 * 1000) % 1_000_000 + 100_000

  func secret(_ path: String) -> String {
    guard let text = try? String(contentsOfFile: path, encoding: .utf8) else {
      XCTFail("Write the credential to \(path) (mode 600) before running this probe.")
      return ""
    }
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
  }


  /// Run parameters. `xcodebuild` does not pass the caller's environment to the
  /// test process, so the caller writes `KEY=VALUE` lines to this file instead.
  func param(_ key: String, _ fallback: String) -> String {
    if let text = try? String(contentsOfFile: "/tmp/openreader-sync-params.txt", encoding: .utf8) {
      for line in text.split(separator: "\n") where line.hasPrefix(key + "=") {
        return String(line.dropFirst(key.count + 1)).trimmingCharacters(in: .whitespaces)
      }
    }
    return ProcessInfo.processInfo.environment[key] ?? fallback
  }

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func isOn(_ element: XCUIElement) -> Bool { (element.value as? String) == "1" }

  /// Ten characters at a time. One `typeText` of a long value delivers
  /// keystrokes faster than a controlled `Field` backed by `setSettings` can
  /// re-render, and React ends the screen with "Maximum update depth exceeded"
  /// — on this branch's Sync screen and, identically, on `main`'s provider
  /// Address (see `testTypeLongIntoProviderAddress`). Chunking is the probe's
  /// workaround for a machine typing far faster than a person, not a fix.
  func clearAndType(_ field: XCUIElement, _ text: String) {
    field.tap()
    // 140 backspaces were not always enough: measured 2026-09-21, an 88-character
    // address typed over an 88-character one left 155 characters in the field,
    // and the app then synced against a folder that does not exist — which looks
    // exactly like a folder that is empty. A tap leaves the caret where it lands,
    // and a backspace deletes only what is before it, so no count of them is
    // enough (measured again 2026-09-23, README Pitfalls). Since #48 every
    // settings field has the phone's own clear button while it is edited.
    let clear = field.buttons["Clear text"]
    if clear.waitForExistence(timeout: 1) { clear.tap() }
    XCTAssertEqual((field.value as? String) ?? "", (field.placeholderValue ?? ""), "The field did not clear before typing")
    let characters = Array(text)
    var at = 0
    while at < characters.count {
      let end = min(at + 10, characters.count)
      field.typeText(String(characters[at..<end]))
      at = end
    }
  }

  /// `keyboardShouldPersistTaps="handled"` means a tap on the plain group
  /// header dismisses the keyboard without doing anything else. The header is
  /// set as written since #48, `Folder` rather than `FOLDER`.
  func dismissKeyboard(_ app: XCUIApplication) {
    if app.keyboards.count > 0 { app.staticTexts.matching(identifier: "Folder").firstMatch.tap() }
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "count == 0"), object: app.keyboards)], timeout: 3)
  }

  func statusLines(_ app: XCUIApplication) -> [String] {
    app.staticTexts.allElementsBoundByIndex.map { $0.label }
  }

  func openSync(_ app: XCUIApplication) {
    if app.buttons["Back"].exists { app.buttons["Back"].tap() }
    let settings = app.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 15), "Library header did not appear")
    settings.tap()
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sync'")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5), "Settings has no Sync row")
    row.tap()
  }

  /// The whole switch narrative in one run, because each step is the previous
  /// step's state: refuse, pass on a missing folder, unlock, and lock again.
  func testSyncSwitchOutcomes() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    openSync(app)

    let address = app.textFields["Address"]
    let username = app.textFields["Username"]
    let password = app.secureTextFields["Password"]
    let toggle = app.switches["Keep my place across devices"]
    XCTAssertTrue(address.waitForExistence(timeout: 5), "Sync screen did not load")
    XCTAssertTrue(username.exists && password.exists && toggle.exists, "Sync screen is missing a control")
    XCTAssertFalse(isOn(toggle), "This probe starts with the switch off")
    XCTAssertTrue(address.isEnabled && username.isEnabled && password.isEnabled, "Fields must be editable while the switch is off")
    capture("sync-1-off", app)

    // --- Outcome one: the wrong password refuses, and the switch goes back off.
    clearAndType(address, secret(addressPath))
    clearAndType(username, secret(usernamePath))
    clearAndType(password, secret(wrongPasswordPath))
    dismissKeyboard(app)
    capture("sync-2-typed", app)

    let beforeWrong = Date()
    toggle.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "label CONTAINS 'rejected' OR label CONTAINS 'HTTP 401' OR label CONTAINS 'HTTP 403'"),
      object: app)], timeout: 20)
    let wrongSeconds = Date().timeIntervalSince(beforeWrong)
    let afterWrong = statusLines(app)
    print("SYNC wrong-password status lines after \(String(format: "%.1f", wrongSeconds)) s: \(afterWrong)")
    capture("sync-3-wrong-password", app)
    XCTAssertFalse(isOn(toggle), "A failed check must flip the switch back off")
    XCTAssertTrue(afterWrong.contains { $0.contains("rejected the username or password") },
                  "The reason must be on the status line; saw \(afterWrong)")
    XCTAssertTrue(address.isEnabled && username.isEnabled && password.isEnabled,
                  "Fields must stay editable after a refused check")

    // --- Outcome two: the right password on a folder that is not there yet.
    clearAndType(password, secret(passwordPath))
    dismissKeyboard(app)
    let beforeRight = Date()
    toggle.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "value == '1'"), object: toggle)], timeout: 20)
    let rightSeconds = Date().timeIntervalSince(beforeRight)
    let afterRight = statusLines(app)
    print("SYNC accepted after \(String(format: "%.1f", rightSeconds)) s: \(afterRight)")
    capture("sync-4-on", app)
    XCTAssertTrue(isOn(toggle), "A passing check must leave the switch on")
    XCTAssertTrue(afterRight.contains { $0.contains("The folder is not there yet") },
                  "A missing folder must say so; saw \(afterRight)")
    XCTAssertFalse(address.isEnabled, "Address must be frozen while the switch is on")
    XCTAssertFalse(username.isEnabled, "Username must be frozen while the switch is on")
    XCTAssertFalse(password.isEnabled, "Password must be frozen while the switch is on")

    let keptAddress = address.value as? String ?? ""
    let keptUsername = username.value as? String ?? ""

    // --- Outcome three: off unfreezes the fields and keeps what was typed.
    toggle.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "value == '0'"), object: toggle)], timeout: 10)
    XCTAssertFalse(isOn(toggle), "Off is always allowed")
    XCTAssertTrue(address.isEnabled && username.isEnabled && password.isEnabled, "Off must unfreeze the fields")
    XCTAssertEqual(address.value as? String ?? "", keptAddress, "Turning sync off must keep the address")
    XCTAssertEqual(username.value as? String ?? "", keptUsername, "Turning sync off must keep the username")
    capture("sync-5-off-again", app)

    // Leave it on for the rest of the run.
    toggle.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "value == '1'"), object: toggle)], timeout: 20)
    XCTAssertTrue(isOn(toggle), "The probe leaves sync on")
    print("SYNC final status lines: \(statusLines(app))")
    capture("sync-6-final-on", app)
  }

  /// Types the address in ten-character chunks and reports the chunk after
  /// which the screen stops answering, to separate "typing at all" from
  /// "typing a long value".
  func testTypeAddressInChunks() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    openSync(app)
    let address = app.textFields["Address"]
    XCTAssertTrue(address.waitForExistence(timeout: 10), "Sync screen did not load")
    address.tap()
    address.typeText(String(repeating: "\u{8}", count: 80))
    let text = Array(secret(addressPath))
    var typed = 0
    while typed < text.count {
      let end = min(typed + 10, text.count)
      address.typeText(String(text[typed..<end]))
      typed = end
      let alive = app.textFields["Address"].exists && app.switches["Keep my place across devices"].exists
      print("TYPE after \(typed) characters: screen alive = \(alive)")
      if !alive {
        capture("type-broke-at-\(typed)", app)
        XCTFail("The Sync screen stopped existing after \(typed) typed characters")
        return
      }
    }
    capture("type-finished", app)
  }

  /// The control for `testTypeAddressInChunks`: the same 107 characters, in one
  /// `typeText`, into a Field that exists on `main` and is wired to `setSettings`
  /// exactly as the Sync screen's is (`provider-screen.tsx`'s Address, for a
  /// provider that is not enabled). It restores the field before it returns.
  func testTypeLongIntoProviderAddress() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    if app.buttons["Back"].exists { app.buttons["Back"].tap() }
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 15))
    app.buttons["Settings"].tap()
    let providers = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Providers'")).firstMatch
    XCTAssertTrue(providers.waitForExistence(timeout: 5)); providers.tap()
    let kokoro = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Kokoro'")).firstMatch
    XCTAssertTrue(kokoro.waitForExistence(timeout: 5)); kokoro.tap()
    let address = app.textFields["Address"]
    XCTAssertTrue(address.waitForExistence(timeout: 5), "Kokoro FastAPI has no Address field")
    let held = address.value as? String ?? ""
    address.tap()
    address.typeText(String(repeating: "\u{8}", count: 80))
    address.typeText(secret(addressPath))
    let alive = app.textFields["Address"].exists
    print("CONTROL provider Address alive after one long typeText = \(alive)")
    capture("control-provider-address", app)
    if alive {
      address.tap(); address.typeText(String(repeating: "\u{8}", count: 140)); address.typeText(held)
    }
    XCTAssertTrue(alive, "A pre-existing settings Field also dies on one long typeText — the defect is not the Sync screen's")
  }

  /// Opens the named Document with a real touch, waits for it to be laid out,
  /// and leaves the reader on screen.
  func openBook(_ app: XCUIApplication, _ title: String) {
    // Back once is not always the Library: a book handed over from Files is
    // pushed onto whatever stack was on screen, so the reader opened over
    // Settings goes back to Settings, whose own back button is labelled
    // "Settings" and not "Back" (measured 2026-09-21, "… is not on the shelf").
    // The Library is the screen that has rows, so that is what to walk towards,
    // and a relaunch is the way out of any stack that has no "Back" left.
    let anyRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Actions for '")).firstMatch
    var backs = 0
    while backs < 4 && !anyRow.exists && app.buttons["Back"].exists {
      app.buttons["Back"].tap()
      backs += 1
      Thread.sleep(forTimeInterval: 0.8)
    }
    if !anyRow.waitForExistence(timeout: 2) {
      app.terminate(); app.launch()
      if app.buttons["Back"].waitForExistence(timeout: 10) { app.buttons["Back"].tap() }
      _ = anyRow.waitForExistence(timeout: 20)
    }
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 20), "\(title) is not on the shelf")
    row.tap()
    let play = app.buttons.matching(NSPredicate(format: "label == 'Play' OR label == 'Pause'")).firstMatch
    XCTAssertTrue(play.waitForExistence(timeout: 90), "The player never appeared for \(title)")
    let laying = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Laying the document out'")).firstMatch
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: laying)], timeout: 120)
    Thread.sleep(forTimeInterval: 1.5)
  }

  /// Issue #20's "pause uploads at once": a real Play touch, the shortest run
  /// that puts a real voice on a real sentence, then a real Pause. The host
  /// checks the server; this side records how long Play took to start, which is
  /// the bound `use-sync.ts` puts on the pre-Play sync.
  ///
  /// The simulator's own volume must already be zero — the caller's job,
  /// with `silence.sh set`, before this launches the app.
  func testPlayPauseUploadsPlace() {
    let seconds = Double(param("PLAY_SECONDS", "5")) ?? 5
    let title = param("BOOK_TITLE", "仙逆")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    openBook(app, title)
    capture("play-0-opened", app)

    // Move off the stored sentence first, so the anchor the pause uploads is
    // provably the sentence being read and not the one that was already there.
    let skips = Int(param("SKIPS", "2")) ?? 2
    let next = app.buttons["Next sentence"]
    if skips > 0 && next.exists { for _ in 0..<skips { next.tap(); Thread.sleep(forTimeInterval: 0.6) } }

    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 30), "No Play button")
    let tapped = Date()
    play.tap()
    let pause = app.buttons["Pause"]
    let started = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: pause)], timeout: 30)
    let toStart = Date().timeIntervalSince(tapped)
    print("PLAY tap-to-playing = \(String(format: "%.2f", toStart)) s (waiter: \(started.rawValue))")
    XCTAssertEqual(started, .completed, "Play never started")

    Thread.sleep(forTimeInterval: seconds)
    capture("play-1-playing", app)
    pause.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Play"])], timeout: 15)
    print("PLAY paused after \(seconds) s of playback at \(Date())")
    Thread.sleep(forTimeInterval: 1.0)
    capture("play-2-paused", app)
    XCTAssertTrue(app.buttons["Play"].exists, "Playback must be stopped when this probe returns")
  }

  /// Presses Play once and stops the moment it starts: the bound on the
  /// pre-Play sync, measured with the server unreachable.
  func testPlayStartsWithinBound() {
    let title = param("BOOK_TITLE", "仙逆")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    openBook(app, title)
    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 30), "No Play button")
    let tapped = Date()
    play.tap()
    let pause = app.buttons["Pause"]
    let started = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: pause)], timeout: 30)
    let toStart = Date().timeIntervalSince(tapped)
    print("PLAY-BOUND tap-to-playing = \(String(format: "%.2f", toStart)) s (waiter: \(started.rawValue))")
    if pause.exists { pause.tap() }
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Play"])], timeout: 15)
    capture("play-bound", app)
    XCTAssertEqual(started, .completed, "Play never started")
    XCTAssertLessThan(toStart, 6.0, "Play must not wait on the server for longer than the bound plus buffering")
  }

  /// Turns the switch on and does nothing else: no launch, no book, no
  /// backgrounding. Whether the first sync happens is then decided entirely by
  /// the switch, which the caller reads off the server.
  func testSwitchOnAndWait() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openSync(app)
    let toggle = app.switches["Keep my place across devices"]
    XCTAssertTrue(toggle.waitForExistence(timeout: 10), "Sync screen did not load")
    XCTAssertFalse(isOn(toggle), "Start this probe with the switch off")
    print("SWITCH-ON tapped at \(Date())")
    toggle.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "value == '1'"), object: toggle)], timeout: 20)
    XCTAssertTrue(isOn(toggle), "The check did not pass")
    Thread.sleep(forTimeInterval: 12)
    print("SWITCH-ON status lines 12 s later: \(statusLines(app))")
    capture("switch-on-waited", app)
  }

  /// Brings the already-open reader to the front without restarting the app,
  /// so a sequence of probe runs can share one open book.
  func reader(_ app: XCUIApplication) -> XCUIApplication {
    app.activate()
    let transport = app.buttons.matching(NSPredicate(format: "label == 'Play' OR label == 'Pause'")).firstMatch
    if !transport.waitForExistence(timeout: 10) {
      openBook(app, param("BOOK_TITLE", "仙逆"))
    }
    return app
  }

  /// Moves the reading `PARAGRAPH_STEPS` paragraphs (negative goes back) and
  /// then plays for `PLAY_SECONDS` and pauses, which is what writes the place
  /// and starts the sync — the reader only writes on its own every ten seconds.
  func testMoveOnParagraphs() {
    let steps = Int(param("PARAGRAPH_STEPS", "3")) ?? 3
    let seconds = Double(param("PLAY_SECONDS", "2")) ?? 2
    let app = reader(XCUIApplication(bundleIdentifier: "top.xujialiu.openreader"))
    let button = app.buttons[steps < 0 ? "Previous paragraph" : "Next paragraph"]
    XCTAssertTrue(button.waitForExistence(timeout: 10), "The expanded transport is not on screen")
    for _ in 0..<abs(steps) { button.tap(); Thread.sleep(forTimeInterval: 0.8) }
    capture("moved-\(steps)", app)
    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 10), "No Play button")
    play.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Pause"])], timeout: 30)
    Thread.sleep(forTimeInterval: seconds)
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Play"])], timeout: 15)
    Thread.sleep(forTimeInterval: 0.8)
    capture("moved-\(steps)-paused", app)
    XCTAssertTrue(app.buttons["Play"].exists, "Playback must be stopped when this probe returns")
  }

  /// Sends the app to the Home screen and brings it back — the `foreground`
  /// sync moment — then photographs what the open, paused book does, and lists
  /// every sentence on screen so the report can say whether one was added.
  func testForegroundAdoption() {
    let app = reader(XCUIApplication(bundleIdentifier: "top.xujialiu.openreader"))
    capture("adopt-0-before", app)
    let before = statusLines(app)
    XCUIDevice.shared.press(.home)
    Thread.sleep(forTimeInterval: 3)
    app.activate()
    Thread.sleep(forTimeInterval: Double(param("SETTLE", "6")) ?? 6)
    capture("adopt-1-after", app)
    let after = statusLines(app)
    print("ADOPT sentences added on screen: \(after.filter { !before.contains($0) })")
    print("ADOPT sentences removed: \(before.filter { !after.contains($0) })")
    XCTAssertTrue(app.buttons["Play"].exists, "The book must still be paused")
  }

  /// #59: one more sync moment after a switch-on upload, so the caller can
  /// confirm nothing more goes out when nothing has changed. Walks back to
  /// the Library first — never the Sync screen, so a capture here never
  /// carries the address or username — then Home and foreground, the same
  /// `background`/`active` pokes `testForegroundAdoption` exercises, without
  /// opening a reader, so the phone's own item is not touched again.
  func testBackgroundForegroundFromLibrary() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    walkToLibrary(app)
    capture("bg-fg-0-library", app)
    XCUIDevice.shared.press(.home)
    Thread.sleep(forTimeInterval: 3)
    app.activate()
    Thread.sleep(forTimeInterval: Double(param("SETTLE", "6")) ?? 6)
    capture("bg-fg-1-after", app)
    print("BG-FG done at \(Date())")
  }

  /// Reads the Sync screen without touching the switch: what the status line
  /// says now, and whether the fields are frozen. Used after a relaunch to show
  /// that sync came back on without a second check.
  func testReadSyncScreen() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openSync(app)
    let toggle = app.switches["Keep my place across devices"]
    XCTAssertTrue(toggle.waitForExistence(timeout: 10), "Sync screen did not load")
    print("SYNC switch=\(isOn(toggle) ? "on" : "off") addressEnabled=\(app.textFields["Address"].isEnabled)")
    print("SYNC status lines: \(statusLines(app))")
    capture("sync-read", app)
  }

  /// Opens `BOOK_TITLE` with a real touch and leaves it on screen, paused: the
  /// `open` sync moment and nothing else, which is the state an idle
  /// measurement needs. Never plays, never backgrounds.
  func testOpenBookOnly() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    print("OPEN-ONLY starting at \(Date())")
    openBook(app, param("BOOK_TITLE", "\u{4ED9}\u{9006}"))
    print("OPEN-ONLY open at \(Date())")
    capture("open-only", app)
    XCTAssertTrue(app.buttons["Play"].exists, "The book must be paused when this probe returns")
  }

  /// The clear-on-seek path (issue #20). The reader is sitting on the sentence a
  /// resume landed on, where nothing is written. One real tap on a word of the
  /// next sentence (`WORD_X`, `WORD_Y`, in points, from a screenshot of the
  /// middle of a line), then one tap on Previous sentence, brings the cursor
  /// back to the same sentence having pointed somewhere in between — so a short
  /// Play and Pause must now write **this** device's Stamp on it.
  func testSeekAwayAndBack() {
    let seconds = Double(param("PLAY_SECONDS", "2")) ?? 2
    let x = Double(param("WORD_X", "261")) ?? 261
    let y = Double(param("WORD_Y", "342")) ?? 342
    let app = reader(XCUIApplication(bundleIdentifier: "top.xujialiu.openreader"))
    capture("seek-0-resumed", app)
    app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
      .withOffset(CGVector(dx: x, dy: y)).tap()
    Thread.sleep(forTimeInterval: 1.5)
    capture("seek-1-word-tapped", app)
    let previous = app.buttons["Previous sentence"]
    XCTAssertTrue(previous.waitForExistence(timeout: 10), "The expanded transport is not on screen")
    previous.tap()
    Thread.sleep(forTimeInterval: 1.5)
    capture("seek-2-back", app)
    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 10), "No Play button")
    play.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Pause"])], timeout: 30)
    Thread.sleep(forTimeInterval: seconds)
    // One tap on Pause is not reliably enough: measured 2026-09-21, a tap three
    // seconds after Play left the reading running to the end of the book, with
    // no pause handler and no sync run. Tap, check, tap again.
    var attempts = 0
    while attempts < 4 && !app.buttons["Play"].exists {
      attempts += 1
      if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
      _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
        predicate: NSPredicate(format: "exists == true"), object: app.buttons["Play"])], timeout: 4)
    }
    print("SEEK-BACK paused at \(Date()) after \(attempts) Pause tap(s)")
    Thread.sleep(forTimeInterval: 1.0)
    capture("seek-3-paused", app)
    XCTAssertTrue(app.buttons["Play"].exists, "Playback must be stopped when this probe returns")
  }

  /// Empties the shelf with real touches — long press, Delete, confirm — for
  /// every row there is. What it is for: before a run against the owner's real
  /// Sync Folder, nothing of this simulator's may be left to upload into it.
  func testRemoveEveryBook() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 20), "Library header did not appear")
    var removed = 0
    while removed < 20 {
      let ellipsis = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Actions for '")).firstMatch
      if !ellipsis.waitForExistence(timeout: 3) { break }
      let title = String(ellipsis.label.dropFirst("Actions for ".count))
      let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title + ",")).firstMatch
      let target = row.exists ? row : app.buttons.matching(NSPredicate(format: "label == %@", title)).firstMatch
      XCTAssertTrue(target.exists, "No row for \(title)")
      target.press(forDuration: 0.7)
      XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 5), "Long press raised no drawer for \(title)")
      app.buttons["Delete"].tap()
      let alert = app.alerts["Delete this book?"]
      XCTAssertTrue(alert.waitForExistence(timeout: 5), "No confirmation for \(title)")
      alert.buttons["Delete"].tap()
      _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
        predicate: NSPredicate(format: "exists == false"), object: alert)], timeout: 5)
      Thread.sleep(forTimeInterval: 1.5)
      removed += 1
      print("REMOVED \(title)")
    }
    capture("shelf-empty", app)
    print("REMOVE-EVERY-BOOK removed \(removed); rows left = \(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Actions for '")).count)")
  }

  /// Types the folder, the username and the password and turns the switch on,
  /// requiring the check to pass and the fields to freeze.
  ///
  /// **Captures nothing.** This is the method the owner's real Sync Folder goes
  /// through, and both a screenshot and an element-tree dump of this screen
  /// would carry the address. Only the status line is printed, which does not.
  func testEnterFolderAndSwitchOn() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    openSync(app)
    let address = app.textFields["Address"]
    let username = app.textFields["Username"]
    let password = app.secureTextFields["Password"]
    let toggle = app.switches["Keep my place across devices"]
    XCTAssertTrue(address.waitForExistence(timeout: 10), "Sync screen did not load")
    if isOn(toggle) {
      toggle.tap()
      _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
        predicate: NSPredicate(format: "value == '0'"), object: toggle)], timeout: 10)
    }
    clearAndType(address, secret(addressPath))
    clearAndType(username, secret(usernamePath))
    clearAndType(password, secret(passwordPath))
    dismissKeyboard(app)
    let before = Date()
    toggle.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "value == '1'"), object: toggle)], timeout: 30)
    print("ENTER-FOLDER on after \(String(format: "%.1f", Date().timeIntervalSince(before))) s, switch on = \(isOn(toggle))")
    print("ENTER-FOLDER status lines: \(statusLines(app))")
    XCTAssertTrue(isOn(toggle), "The check did not pass")
    XCTAssertFalse(address.isEnabled, "Address must be frozen while the switch is on")
  }

  /// Turns the switch off and leaves the screen: the state the owner is handed
  /// back. Captures nothing, for the same reason as `testEnterFolderAndSwitchOn`.
  func testSwitchOffAndLeave() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openSync(app)
    let toggle = app.switches["Keep my place across devices"]
    XCTAssertTrue(toggle.waitForExistence(timeout: 10), "Sync screen did not load")
    if isOn(toggle) {
      toggle.tap()
      _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
        predicate: NSPredicate(format: "value == '0'"), object: toggle)], timeout: 10)
    }
    print("SWITCH-OFF switch on = \(isOn(toggle)); address editable = \(app.textFields["Address"].isEnabled)")
    // The back button is labelled after the screen behind it — "Settings" here,
    // "Library" there — never "Back", so walk out by the navigation bar's own
    // first button instead of by a label.
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Actions for '")).firstMatch
    var backs = 0
    while backs < 4 && !row.exists {
      let back = app.navigationBars.buttons.element(boundBy: 0)
      if !back.exists { break }
      back.tap()
      backs += 1
      Thread.sleep(forTimeInterval: 1.0)
    }
    print("SWITCH-OFF left on the Library: \(row.waitForExistence(timeout: 5))")
  }

  /// The Sync screen's status line, printed and nothing else — no screenshot and
  /// no element-tree dump, so it is safe to run while the owner's real folder is
  /// in the Address field. Leaves the screen where it found it.
  func testReadSyncStatusOnly() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    openSync(app)
    let toggle = app.switches["Keep my place across devices"]
    XCTAssertTrue(toggle.waitForExistence(timeout: 10), "Sync screen did not load")
    print("STATUS switch=\(isOn(toggle) ? "on" : "off")")
    print("STATUS lines: \(statusLines(app))")
  }

  /// Swipes the open reader forward a few pages and reports what the reader says
  /// afterwards. Used to find out whether a place adopted while the book is open
  /// is waiting for the section it names to render.
  func testSwipeForward() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label == 'Play' OR label == 'Pause'")).firstMatch
      .waitForExistence(timeout: 20), "No reader on screen")
    capture("swipe-0-before", app)
    for step in 1...6 {
      app.swipeUp()
      Thread.sleep(forTimeInterval: 1.2)
      print("SWIPE \(step) done at \(Date())")
    }
    Thread.sleep(forTimeInterval: 3)
    capture("swipe-1-after", app)
    XCTAssertTrue(app.buttons["Play"].exists, "The book must still be paused")
  }

  /// Issue #20's **claim rule**, on the device: a place adopted from another
  /// machine is pending because the section it names has not rendered, and the
  /// owner taps a word here before that section arrives. The reading must stay
  /// on the tapped word (`abandonResume`), and the page moving is not the
  /// reading moving.
  ///
  /// The window between "pending" and "rendered" is a few hundred milliseconds
  /// against a real folder (measured 2026-09-21: 1.40 s from foreground to
  /// landed, network round trip included), which no scheduled tap can be placed
  /// inside. So the caller points `sync.url` at the stalling stub
  /// (`slow-webdav.py`), which decides when the place arrives: the tap goes in
  /// at `CLAIM_DELAY` seconds after the activation that pokes the sync, and the
  /// stub's own log says when it served the download. Both times are printed,
  /// so a run that tapped too early is reported as such rather than counted.
  func testClaimBeforeRender() {
    let claimDelay = Double(param("CLAIM_DELAY", "6.2")) ?? 6.2
    let x = Double(param("WORD_X", "133")) ?? 133
    let y = Double(param("WORD_Y", "361")) ?? 361
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label == 'Play' OR label == 'Pause'")).firstMatch
      .waitForExistence(timeout: 20), "No reader on screen")
    capture("claim-0-before", app)
    // The sync that carries the place is the one the **background** poke starts,
    // not the foreground one: `press(.home)` pokes first, the stub stalls that
    // GET, and the app is back in front long before it is served. So the clock
    // for the tap starts at the Home press.
    let backgrounded = Date()
    XCUIDevice.shared.press(.home)
    print("CLAIM home at \(backgrounded)")
    Thread.sleep(forTimeInterval: 3)
    app.activate()
    print("CLAIM activated at \(Date()) (+\(String(format: "%.2f", Date().timeIntervalSince(backgrounded))) s)")
    let activated = backgrounded
    let slept = claimDelay - Date().timeIntervalSince(activated)
    if slept > 0 { Thread.sleep(forTimeInterval: slept) }
    print("CLAIM tapping at \(Date()) (+\(String(format: "%.2f", Date().timeIntervalSince(activated))) s)")
    app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
      .withOffset(CGVector(dx: x, dy: y)).tap()
    print("CLAIM tapped at \(Date()) (+\(String(format: "%.2f", Date().timeIntervalSince(activated))) s)")
    capture("claim-1-tapped", app)
    Thread.sleep(forTimeInterval: 8)
    capture("claim-2-settled", app)
    print("CLAIM status lines: \(statusLines(app))")
    XCTAssertTrue(app.buttons["Play"].exists, "The book must still be paused")
  }

  /// Issue #20's **defect 4**: leaving a book whose place has not moved must
  /// write nothing. ADR 0031 — a position's Stamp moves only when speech stops
  /// somewhere new — and a re-stamp on the way out is how this phone won a
  /// merge it should have lost (`sync-items.ts`, `samePlace`).
  ///
  /// Three steps, each printed with its wall time so the host's poller can be
  /// read against them: play into the next sentence and pause (a new place, so
  /// one upload); wait, then walk out with Back without playing (nothing moved,
  /// so no upload); re-open, play on again and leave (exactly one more).
  ///
  /// `PLAY_SECONDS` must be long enough to cross a sentence boundary — the
  /// pause on the sentence the reading was already on is the case that must
  /// write nothing, and it cannot be told from a defect. The caller silences the
  /// device first.
  func testLeaveUnmovedWritesNothing() {
    let seconds = Double(param("PLAY_SECONDS", "10")) ?? 10
    let title = param("BOOK_TITLE", "\u{4ED9}\u{9006}")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    openBook(app, title)

    print("STEP-A play at \(Date())")
    playFor(app, seconds)
    print("STEP-A paused at \(Date())")
    capture("leave-a-paused", app)
    Thread.sleep(forTimeInterval: 8)

    print("STEP-B leaving at \(Date())")
    leaveReader(app)
    print("STEP-B left at \(Date())")
    capture("leave-b-library", app)
    Thread.sleep(forTimeInterval: 15)

    print("STEP-C reopening at \(Date())")
    openBook(app, title)
    playFor(app, seconds)
    print("STEP-C paused at \(Date())")
    capture("leave-c-paused", app)
    Thread.sleep(forTimeInterval: 5)
    leaveReader(app)
    print("STEP-C left at \(Date())")
    capture("leave-c-library", app)
    Thread.sleep(forTimeInterval: 12)
  }

  /// Play, wait, and stop — with the repeated Pause the transport sometimes
  /// needs (see `testSeekAwayAndBack`'s note and the README's Pitfalls).
  func playFor(_ app: XCUIApplication, _ seconds: Double) {
    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 30), "No Play button")
    play.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Pause"])], timeout: 30)
    Thread.sleep(forTimeInterval: seconds)
    var attempts = 0
    while attempts < 4 && !app.buttons["Play"].exists {
      attempts += 1
      if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
      _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
        predicate: NSPredicate(format: "exists == true"), object: app.buttons["Play"])], timeout: 4)
    }
    XCTAssertTrue(app.buttons["Play"].exists, "Playback did not stop after \(attempts) Pause tap(s)")
  }

  /// The reader's own Back, which is the only one actually labelled "Back".
  func leaveReader(_ app: XCUIApplication) {
    let back = app.buttons["Back"]
    XCTAssertTrue(back.waitForExistence(timeout: 10), "No Back button in the reader")
    back.tap()
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Actions for '")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 15), "Back did not reach the Library")
  }

  // ---------------------------------------------------------------------
  // Issues #54/#55: Play waits for a place still on its way instead of
  // giving it up, and a reopen after an adoption does not ask the renderer
  // to display its section a second time.
  //
  // These methods write `Documents/harness.json` directly — the same file
  // the walkthrough harness (`test/manual-test/README.md`) polls four times
  // a second — because a real touch cannot reach one specific row out of
  // 2,077 Contents rows. `CONTAINER` (the app's data container, from
  // `xcrun simctl get_app_container … data`) is a run parameter, read the
  // same way as the others. Every Play, Pause and reopen below is a real
  // touch; only the deep navigation goes through the harness, and each
  // method says so in its own comment.
  // ---------------------------------------------------------------------

  /// `leaveReader`, tolerant of one swallowed tap. Measured 2026-09-24: right
  /// after a fresh, previously-unrendered deep section's first layout (a raw
  /// `{"do":"section"}` jump, not a Contents tap), one run's first Back tap
  /// registered nothing — `navstate` afterward still showed the Reader on
  /// top, and a harness `{"do":"shut"}` (`goBack()` directly) proved the
  /// navigation itself was healthy the whole time, so the tap was swallowed,
  /// not refused. A settle pause plus one retry is the same shape as the
  /// documented "one tap on Pause is not always a pause".
  func leaveReaderRobust(_ app: XCUIApplication) {
    Thread.sleep(forTimeInterval: 1.5)
    let back = app.buttons["Back"]
    XCTAssertTrue(back.waitForExistence(timeout: 10), "No Back button in the reader")
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Actions for '")).firstMatch
    back.tap()
    if !row.waitForExistence(timeout: 12) {
      print("LEAVE-READER-ROBUST first Back tap did not land; retrying")
      if app.buttons["Back"].exists { app.buttons["Back"].tap() }
      XCTAssertTrue(row.waitForExistence(timeout: 15), "Back did not reach the Library even after a retry")
    }
  }

  /// Picks the first-sorting Fish voice if none is chosen yet — the same
  /// shape as `OfflineFixProbe.testChooseVoiceForShortFixture` — so Play can
  /// actually produce audio instead of stopping at "Enable a provider…".
  func ensureVoiceChosen(_ app: XCUIApplication) {
    let choose = app.buttons["Choose a Voice"]
    if !choose.waitForExistence(timeout: 5) { return }
    choose.tap()
    let heading = app.staticTexts.matching(NSPredicate(format: "label == 'Voice'")).firstMatch
    XCTAssertTrue(heading.waitForExistence(timeout: 5), "Voice sheet did not open")
    let anyVoice = app.buttons.matching(NSPredicate(format: "label CONTAINS ' - '")).firstMatch
    XCTAssertTrue(anyVoice.waitForExistence(timeout: 15), "No Fish voice rows appeared")
    print("ENSURE-VOICE chose \(anyVoice.label)")
    anyVoice.tap()
    app.buttons["Close Voice"].tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: heading)], timeout: 3)
  }

  func containerPath() -> String { param("CONTAINER", "") }

  /// Triggers the host's WebDAV item-crafting script through a file
  /// handshake with `craft_watcher.py`, already polling on the host, right
  /// before the Play tap this feeds.
  ///
  /// Not `Process`/`NSTask`: this target builds for `iphonesimulator` (an iOS
  /// binary), which has no process-spawning API at all ("cannot find
  /// 'Process' in scope" — measured 2026-09-24, not merely a missing
  /// import). A file both sides poll is the substitute.
  ///
  /// Why the gap matters: crafting from the caller's shell and only then
  /// launching `xcodebuild` put 20-40 s of build/attach/launch between the
  /// craft and the Play tap — long enough for the test attach's own
  /// `foreground` poke (an ordinary, unbounded background sync, not the
  /// bounded one `play()` waits on) to already download, merge and adopt the
  /// item before the method's first line ever ran, so the observed "landing"
  /// was that poke's, not Play's `sync.wait('play')`. Separately, four
  /// attempts crafted that way — including ones with a 20-minute-ahead
  /// stamp — never adopted at all, because the phone kept reading locally
  /// after each miss (`reading.play()` always runs after the sync's `.then`,
  /// win or lose) and out-stamped the next craft before it was even written;
  /// see `craft_item.py`'s own comment for that half. This keeps the
  /// craft-to-tap gap to a sub-second file poll on both sides.
  func requestCraft(_ templatePath: String, _ deltaMs: String) {
    hSeq += 1
    let seq = hSeq
    let request: [String: Any] = ["seq": seq, "doc_id": param("DOC_ID", ""), "template": templatePath, "device": param("CRAFT_DEVICE", "desktop-test"), "delta_ms": Int(deltaMs) ?? 300_000]
    guard let data = try? JSONSerialization.data(withJSONObject: request) else { XCTFail("Could not encode craft request"); return }
    try? FileManager.default.removeItem(atPath: "/tmp/openreader-craft-done.json")
    do { try data.write(to: URL(fileURLWithPath: "/tmp/openreader-craft-request.json")) }
    catch { XCTFail("Could not write craft request: \(error)"); return }
    let deadline = Date().addingTimeInterval(15)
    while Date() < deadline {
      if let text = try? String(contentsOfFile: "/tmp/openreader-craft-done.json", encoding: .utf8),
         let obj = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
         (obj["seq"] as? Int) == seq {
        print("CRAFT(\(templatePath)) \(text)")
        XCTAssertEqual(obj["ok"] as? Bool, true, "craft_item.py reported failure")
        return
      }
      Thread.sleep(forTimeInterval: 0.1)
    }
    XCTFail("craft_watcher.py did not answer seq \(seq) within 15 s — is it running?")
  }

  /// Removes any leftover `Documents/harness.json` before a fresh launch.
  ///
  /// Measured 2026-09-24: without this, a fresh reader mount's `seenRef`
  /// (starting at -1, README "The walkthrough harness re-runs its last
  /// command on every launch") replayed a previous run's `{"do":"section"}`
  /// immediately on mount, before the WebView's own bootstrap had defined its
  /// `rendition` global — Metro logged `Error evaluating injectedJavaScript:
  /// … ReferenceError: Can't find variable: rendition`, which raised React
  /// Native's "Open debugger to view warnings." banner over the floating
  /// player (the same overlap the README's XCTest pitfalls already document
  /// for a Play tap) and swallowed the very next Pause tap: the reading kept
  /// playing, unpaused, for the rest of that run. This file's own `hSeq`
  /// restarting at 9000 in every fresh `SyncProbe` instance made a repeat
  /// `{"section":104}` collide with the previous run's `seq`, which is what
  /// let the stale command back in — clearing the file removes the command
  /// a fresh mount would otherwise find.
  func clearHarness() {
    try? FileManager.default.removeItem(atPath: containerPath() + "/Documents/harness.json")
  }

  /// Writes one harness command with a fresh `seq` — the same shape any other
  /// caller of `Documents/harness.json` uses (README, "The walkthrough harness").
  func harness(_ command: [String: Any]) {
    var withSeq = command
    hSeq += 1
    withSeq["seq"] = hSeq
    guard let data = try? JSONSerialization.data(withJSONObject: withSeq) else {
      XCTFail("Could not encode harness command \(command)")
      return
    }
    let path = containerPath() + "/Documents/harness.json"
    do {
      try data.write(to: URL(fileURLWithPath: path))
    } catch {
      XCTFail("Could not write \(path): \(error)")
    }
  }

  /// The on-device Library file, read straight off the host — the same file
  /// #13/#14's fixtures are seeded into directly, here only read.
  func readLibraryJSON() -> String {
    let path = containerPath() + "/Documents/library.json"
    return (try? String(contentsOfFile: path, encoding: .utf8)) ?? "{}"
  }

  /// Walks back towards the Library by the navigation bar's own first button,
  /// bounded — the `testSwitchOffAndLeave` idiom — never by a label, since a
  /// back button is named after the screen behind it and the Sync/Settings
  /// screens have no button actually labelled "Back".
  func walkToLibrary(_ app: XCUIApplication) {
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Actions for '")).firstMatch
    var backs = 0
    while backs < 5 && !row.exists {
      let back = app.navigationBars.buttons.element(boundBy: 0)
      if !back.exists { break }
      back.tap()
      backs += 1
      Thread.sleep(forTimeInterval: 1.0)
    }
  }

  /// Brings the already-open book to a rendered, paused stop at `section`
  /// with a real Play/Pause, so the Library gets a real, document-matching
  /// position there. `{"do":"section"}` is `reading.goToSection`, the same
  /// Contents-row jump the README's "Play with the page scrolled away, and a
  /// place on a chapter heading (#50, #51)" uses as "a cleaner substitute…
  /// unaffected" when a real tap cannot reach the row; it is not `resumeAt`
  /// and does not touch the pending-place machinery under test here.
  /// The tail of Metro's raw log (not the wall-clock-stamped copy a host
  /// tailer keeps) — read directly so a harness `"say"` answer can be
  /// confirmed from inside the Swift method itself.
  func metroLogTail(_ maxChars: Int = 4000) -> String {
    guard let text = try? String(contentsOfFile: param("METRO_LOG", ""), encoding: .utf8) else { return "" }
    return String(text.suffix(maxChars))
  }

  /// Jumps to `section` and **confirms** it, retrying the harness command up
  /// to 3 times. Measured 2026-09-24: a bare `{"do":"section"}` followed by a
  /// fixed sleep silently did nothing once (harvesting section 1600 right
  /// after section 500, same continuous mount) — `library.json` still held
  /// section 500's position afterward, and `Play` existed throughout (left
  /// over from before the jump), so the old unconfirmed version's own wait
  /// passed without the jump having happened at all. Confirms via a harness
  /// `"say"` and Metro's own log rather than `library.json`, whose write is
  /// throttled (`POSITION_INTERVAL_MS`) and can lag a jump that did work.
  func settleAt(_ app: XCUIApplication, _ section: Int) {
    let wantSection = "section=\(section) "
    var confirmed = false
    for attempt in 1...3 {
      harness(["do": "section", "section": section])
      Thread.sleep(forTimeInterval: 3.0)
      harness(["do": "say"])
      Thread.sleep(forTimeInterval: 0.6)
      if metroLogTail().contains(wantSection) { confirmed = true; break }
      print("SETTLE-AT section \(section) not confirmed after attempt \(attempt); retrying")
    }
    XCTAssertTrue(confirmed, "settleAt(\(section)) never showed \(wantSection) in Metro's log after 3 attempts")
    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 15), "No Play button after jumping to section \(section)")
    play.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Pause"])], timeout: 20)
    Thread.sleep(forTimeInterval: 1.2)
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Play"])], timeout: 10)
    Thread.sleep(forTimeInterval: 0.5)
  }

  /// Phase 2 preparation: harvests real locator/anchor templates at three
  /// unvisited sections of 仙逆 (2,077 total) by actually reading each one,
  /// then leaves this device's own place at an early section. The host reads
  /// this run's `test.log` for the `TEMPLATE-N-BEGIN/END` blocks — the
  /// on-device `library.json` at that moment — to build a desktop item with
  /// real, document-matching text rather than a hand-written CFI.
  /// One more template, without a fresh launch — for a section needed after
  /// the three `testHarvestTemplates` harvested have each already been
  /// adopted-and-rendered by a scenario. Reads `HARVEST_SECTION`.
  /// Always a fresh launch. Measured 2026-09-24: chaining a second
  /// `settleAt` onto the same continuous mount right after a first one (two
  /// `testHarvestOneTemplate` calls back to back, neither relaunching) failed
  /// to confirm the second jump three retries running, with the position
  /// stuck in the first jump's section the whole time — cause not isolated
  /// further (a stuck `pendingSectionRef`/`seekingRef` pair is suspected, not
  /// proven). A fresh process every time costs a relaunch but sidesteps it,
  /// and it is what the process-under-test needs to be fresh for anyway.
  func testHarvestOneTemplate() {
    let title = param("BOOK_TITLE", "仙逆")
    let section = Int(param("HARVEST_SECTION", "2000")) ?? 2000
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    clearHarness()
    dismissSavePasswordIfPresent(app)
    openBook(app, title)
    settleAt(app, section)
    print("TEMPLATE-\(section)-BEGIN")
    print(readLibraryJSON())
    print("TEMPLATE-\(section)-END")
  }

  func testHarvestTemplates() {
    let title = param("BOOK_TITLE", "仙逆")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    clearHarness()
    openBook(app, title)
    ensureVoiceChosen(app)
    for section in [700, 1400, 1900] {
      settleAt(app, section)
      print("TEMPLATE-\(section)-BEGIN")
      print(readLibraryJSON())
      print("TEMPLATE-\(section)-END")
    }
    // This device's own place, for the phone-side item: an early section,
    // settled last so it is what the shelf holds when this method returns.
    settleAt(app, 5)
    print("TEMPLATE-EARLY-BEGIN")
    print(readLibraryJSON())
    print("TEMPLATE-EARLY-END")
    capture("templates-done", app)
  }

  /// #54, AGENTS.md phase 1 scenario 3: a place stored deep in the book —
  /// harness section jump to `DEEP_SECTION`, a real Play/Pause — then leave to
  /// the Library and press Play again **at once** with a real tap, before the
  /// saved section can possibly have rendered. Expected: the player shows
  /// starting, nothing plays until the section reports, and the reading then
  /// starts at the saved sentence. This method's own sleeps are a generous,
  /// fixed bound for screenshots; the actual timing is read from the host's
  /// wall-clock-stamped Metro ticker against this method's own printed
  /// `tap-epoch`.
  func testPendingPlacePlayWaitsOnReopen() {
    let title = param("BOOK_TITLE", "仙逆")
    let section = Int(param("DEEP_SECTION", "104")) ?? 104
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    clearHarness()
    openBook(app, title)
    ensureVoiceChosen(app)
    capture("pend3-0-opened", app)
    settleAt(app, section)
    capture("pend3-1-stored-place", app)
    print("PEND3 stored status: \(statusLines(app))")
    print("PEND3 stored library: BEGIN")
    print(readLibraryJSON())
    print("PEND3 stored library: END")

    leaveReaderRobust(app)
    // `settleAt`'s own harness command is still sitting in `harness.json`, and
    // the reopen below is a second fresh `ReadingView` mount, whose `seenRef`
    // also starts at -1 (README, "re-runs its last command on every launch" —
    // true of a remount too, not only an app launch). Left in place, that
    // command replays right as this device's own stored place is loading and
    // can race the library's own `initialLocation` bootstrap (measured
    // 2026-09-24: `Error evaluating injectedJavaScript … Can't find variable:
    // rendition`, below). A real reopen never carries this file.
    clearHarness()
    Thread.sleep(forTimeInterval: 1.0)
    capture("pend3-2-library", app)

    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 20), "\(title) is not on the shelf")
    row.tap()
    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 15), "No Play button on reopen")
    capture("pend3-3-reopened-before-play", app)
    let tapEpoch = Date().timeIntervalSince1970
    print("PEND3 tap-epoch=\(tapEpoch)")
    play.tap()
    capture("pend3-4-tapped-at-once", app)
    print("PEND3 status right after tap: \(statusLines(app))")

    Thread.sleep(forTimeInterval: 1.0); capture("pend3-5-plus1s", app)
    Thread.sleep(forTimeInterval: 2.0); capture("pend3-6-plus3s", app)
    print("PEND3 status +3s: \(statusLines(app))")
    Thread.sleep(forTimeInterval: 3.0); capture("pend3-7-plus6s", app)
    print("PEND3 status +6s: \(statusLines(app))")
    Thread.sleep(forTimeInterval: 4.0); capture("pend3-8-plus10s", app)
    print("PEND3 status +10s: \(statusLines(app))")

    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Play"])], timeout: 10)
    Thread.sleep(forTimeInterval: 0.5)
    capture("pend3-9-paused-final", app)
    print("PEND3 final status: \(statusLines(app))")
    print("PEND3 library after pause: BEGIN")
    print(readLibraryJSON())
    print("PEND3 library after pause: END")
    XCTAssertTrue(app.buttons["Play"].exists, "Playback must be stopped when this method returns")
  }

  /// #54, AGENTS.md phase 1 scenario 4: reopen, press Play at once, then press
  /// Pause **before** the saved place can have landed. Expected: the reading
  /// stays paused, the saved sentence highlights once its section renders, and
  /// the stored place is unchanged (the host diffs `library.json` before and
  /// after against the printed snapshots).
  func testPendingPlacePauseWhileWaiting() {
    let title = param("BOOK_TITLE", "仙逆")
    let section = Int(param("DEEP_SECTION", "104")) ?? 104
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    clearHarness()
    openBook(app, title)
    ensureVoiceChosen(app)
    settleAt(app, section)
    print("PEND4 stored library: BEGIN")
    print(readLibraryJSON())
    print("PEND4 stored library: END")

    leaveReaderRobust(app)
    // See PEND3's identical comment: the reopen below is a second fresh
    // mount that would otherwise replay `settleAt`'s stale command.
    clearHarness()
    Thread.sleep(forTimeInterval: 1.0)
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 20), "\(title) is not on the shelf")
    row.tap()
    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 15), "No Play button on reopen")
    let tapEpoch = Date().timeIntervalSince1970
    print("PEND4 play-tap-epoch=\(tapEpoch)")
    play.tap()
    capture("pend4-0-tapped", app)
    let pauseBtn = app.buttons["Pause"]
    let appeared = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: pauseBtn)], timeout: 5)
    print("PEND4 pause-button-appeared=\(appeared == .completed) at epoch=\(Date().timeIntervalSince1970)")
    if pauseBtn.exists { pauseBtn.tap() } else { play.tap() }
    print("PEND4 pause-tap-epoch=\(Date().timeIntervalSince1970)")
    capture("pend4-1-paused-immediately", app)
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Play"])], timeout: 10)
    Thread.sleep(forTimeInterval: 1.0)
    capture("pend4-2-plus1s", app)
    print("PEND4 status +1s: \(statusLines(app))")
    // Plenty of time for the deep section to land while the book sits paused.
    Thread.sleep(forTimeInterval: 8.0)
    capture("pend4-3-settled", app)
    print("PEND4 settled status: \(statusLines(app))")
    print("PEND4 library after settle: BEGIN")
    print(readLibraryJSON())
    print("PEND4 library after settle: END")
    XCTAssertTrue(app.buttons["Play"].exists, "The book must stay paused")
  }

  /// iOS's own "Save Password?" AutoFill prompt, raised once after the real
  /// password `clearAndType` in `testEnterFolderAndSwitchOn` submits a new
  /// secure field — not this app's UI, and not addressed by any query against
  /// `top.xujialiu.openreader`'s own tree (measured 2026-09-24: it sits over
  /// the Library, an `app.alerts`/`app.buttons["Not Now"]` query against the
  /// OpenReader `XCUIApplication` found nothing). It belongs to the system,
  /// reachable the same way `testAdoptedRemotePlayWhileBackgrounded` reaches
  /// Now Playing: a second `XCUIApplication` for the process actually owning
  /// it. Call before any query that walks the whole tree (`statusLines`) if a
  /// password was just typed; harmless when there is nothing to dismiss.
  func dismissSavePasswordIfPresent(_ app: XCUIApplication) {
    for bundleId in ["com.apple.springboard", "com.apple.PasswordBreachSheet", "com.apple.AuthenticationServicesUI.AutoFillPromptUI"] {
      let owner = XCUIApplication(bundleIdentifier: bundleId)
      let notNow = owner.buttons["Not Now"]
      if notNow.waitForExistence(timeout: 2) {
        notNow.tap()
        print("DISMISS-SAVE-PASSWORD tapped Not Now via \(bundleId)")
        Thread.sleep(forTimeInterval: 0.5)
        app.activate()
        return
      }
    }
  }

  /// #54, AGENTS.md phase 2 scenario A. Assumes `testHarvestTemplates` and
  /// `testEnterFolderAndSwitchOn` already ran, and that the host has since
  /// crafted a newer desktop item into the WebDAV subfolder at one of the
  /// harvested sections — so the book is open, paused, at this device's own
  /// early place, sync on, nothing backgrounded since. A real Play tap must
  /// run the pre-Play sync (`sync.wait('play')`), adopt the desktop item, and
  /// — since its section has not rendered — wait for it rather than reading
  /// this device's old sentence.
  func testAdoptedPlaceScreenPlay() {
    let title = param("BOOK_TITLE", "仙逆")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    dismissSavePasswordIfPresent(app)
    if !app.buttons.matching(NSPredicate(format: "label == 'Play' OR label == 'Pause'")).firstMatch.waitForExistence(timeout: 5) {
      // A fresh mount below; see `testPendingPlacePlayWaitsOnReopen`'s comment
      // on why a leftover harness command must not still be on disk for it.
      clearHarness()
      // `openBook` (not the inline walk this replaced): 15 s was not always
      // enough for the Player to reappear after the dismissed system prompt,
      // and this helper already waits up to 90 s the same way every other
      // method here does, plus the "Laying the document out…" settle for the
      // early, already-rendered chapter the book opens on.
      openBook(app, title)
    }
    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 15), "No Play button")
    capture("adoptA-0-before", app)
    print("ADOPTA status before: \(statusLines(app))")
    // Craft from inside this method, right before the tap it feeds — see
    // `runCraft`'s own comment for why the gap must be this short.
    requestCraft(param("CRAFT_TEMPLATE", ""), param("CRAFT_DELTA_MS", "300000"))
    let tapEpoch = Date().timeIntervalSince1970
    print("ADOPTA tap-epoch=\(tapEpoch)")
    play.tap()
    capture("adoptA-1-tapped", app)
    print("ADOPTA status right after tap: \(statusLines(app))")
    Thread.sleep(forTimeInterval: 2.0); capture("adoptA-2-plus2s", app)
    Thread.sleep(forTimeInterval: 3.0); capture("adoptA-3-plus5s", app)
    print("ADOPTA status +5s: \(statusLines(app))")
    Thread.sleep(forTimeInterval: 5.0); capture("adoptA-4-plus10s", app)
    print("ADOPTA status +10s: \(statusLines(app))")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Play"])], timeout: 10)
    Thread.sleep(forTimeInterval: 0.5)
    capture("adoptA-5-paused", app)
    print("ADOPTA final status: \(statusLines(app))")
    print("ADOPTA library after pause: BEGIN")
    print(readLibraryJSON())
    print("ADOPTA library after pause: END")
  }

  /// Scenario B, part 1: a real Home press — the established way to trigger
  /// the `background` sync poke (see `testClaimBeforeRender`'s own note) —
  /// leaving the host free to craft a still-further desktop item while the
  /// app sits backgrounded.
  /// Scenario B, part 1 (kept for a manual/standalone background step; the
  /// combined method below is what the run actually uses — see its own
  /// comment for why craft and foreground need to be one method).
  func testAdoptedBackgroundNow() {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    print("ADOPTB home-epoch=\(Date().timeIntervalSince1970)")
    XCUIDevice.shared.press(.home)
    Thread.sleep(forTimeInterval: 1.5)
    print("ADOPTB backgrounded, app.state=\(app.state.rawValue)")
  }

  /// Scenario B, part 2: foreground and press Play as fast as XCUITest can —
  /// the foreground activation's own sync poke has already run by the time
  /// this reaches Play, since the app was already open on the reader.
  /// Scenario B, whole: backgrounds for real (Home — the poke this method
  /// wants is the `background` one), crafts a further item through the same
  /// file handshake `requestCraft` uses (still backgrounded — the craft
  /// itself is a host-side PUT and does not care whether the simulator is
  /// foreground), then foregrounds and taps Play as fast as XCUITest can.
  /// One method, not background-then-a-separate-`xcodebuild`-invocation for
  /// foreground: `testAdoptedPlaceScreenPlay`'s own comment measured a
  /// 20-40 s attach gap between separate invocations, long enough for the
  /// attach's own `foreground` poke to adopt before the method even starts.
  func testAdoptedBackgroundCraftForegroundPlay() {
    let title = param("BOOK_TITLE", "仙逆")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    dismissSavePasswordIfPresent(app)
    if !app.buttons.matching(NSPredicate(format: "label == 'Play' OR label == 'Pause'")).firstMatch.waitForExistence(timeout: 5) {
      clearHarness()
      openBook(app, title)
    }
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap(); Thread.sleep(forTimeInterval: 0.5) }
    // A known, already-rendered starting section — not wherever a template
    // harvest for THIS scenario's own craft last settled, which would leave
    // the desktop target already rendered before backgrounding even starts.
    if let resetSection = Int(param("RESET_SECTION", "")) { settleAt(app, resetSection) }
    print("ADOPTB home-epoch=\(Date().timeIntervalSince1970)")
    XCUIDevice.shared.press(.home)
    Thread.sleep(forTimeInterval: 2.0)
    print("ADOPTB backgrounded, app.state=\(app.state.rawValue)")
    requestCraft(param("CRAFT_TEMPLATE", ""), param("CRAFT_DELTA_MS", "300000"))
    let actEpoch = Date().timeIntervalSince1970
    app.activate()
    print("ADOPTB activate-epoch=\(actEpoch), app.state=\(app.state.rawValue)")
    let play = app.buttons["Play"]
    XCTAssertTrue(play.waitForExistence(timeout: 10), "No Play button on foreground")
    let tapEpoch = Date().timeIntervalSince1970
    print("ADOPTB tap-epoch=\(tapEpoch)")
    play.tap()
    capture("adoptB-1-tapped", app)
    print("ADOPTB status right after tap: \(statusLines(app))")
    Thread.sleep(forTimeInterval: 2.0); capture("adoptB-2-plus2s", app)
    Thread.sleep(forTimeInterval: 3.0); capture("adoptB-3-plus5s", app)
    print("ADOPTB status +5s: \(statusLines(app))")
    Thread.sleep(forTimeInterval: 5.0); capture("adoptB-4-plus10s", app)
    print("ADOPTB status +10s: \(statusLines(app))")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Play"])], timeout: 10)
    capture("adoptB-5-paused", app)
    print("ADOPTB final status: \(statusLines(app))")
    print("ADOPTB library after pause: BEGIN")
    print(readLibraryJSON())
    print("ADOPTB library after pause: END")
  }

  /// Scenario C: the same shape as A, but Play is pressed through the
  /// system's remote-command surface while the app sits backgrounded — never
  /// foregrounded until the observation itself. There is no `simctl` command
  /// to lock the simulator's screen (checked: no such subcommand exists), so
  /// this backgrounds for real (Home) and reaches Now Playing through
  /// Notification Centre's swipe, the same surface `LockScreenProbe`
  /// reads; it does not prove behaviour under an actually
  /// locked screen, and says so in its own BLOCKED failure if the surface
  /// cannot be reached.
  /// Scenario C, the way that does not need the remote surface: a remote
  /// Play and the screen's own end in the same `reading-view.tsx` `play()`
  /// (`onIntent` for the lock screen/Control Centre, `onPlay` for the
  /// button), so backgrounding right after a real screen tap — before the
  /// 2 s pre-play sync can finish — answers the same question ("does the
  /// pending section lay out, and the reading start, while the app is
  /// backgrounded?") without depending on the Notification Centre swipe this
  /// file already documents as unreliable. Always a fresh launch (see the
  /// `reportedSectionsRef`-scope pitfall above): opens at a local place,
  /// plays it briefly and pauses — so the engine, the audio session and the
  /// Now Playing registration all exist beforehand, the same state a real
  /// lock-screen Play would find — crafts a target never displayed in this
  /// process, taps Play for real, and backgrounds within about half a second.
  /// Waits for a specific `SYNC {...}` line (the TEMPORARY `onSynced`
  /// diagnostic) to appear in Metro's own log, so the caller knows no run for
  /// `trigger` is still in flight before it acts. Polls the raw log, not the
  /// ticker — the diagnostic is not part of the periodic status line.
  func waitForSyncLine(trigger: String, timeoutSeconds: Double = 10) -> Bool {
    let marker = "\"trigger\":\"\(trigger)\""
    let deadline = Date().addingTimeInterval(timeoutSeconds)
    while Date() < deadline {
      if metroLogTail(8000).contains(marker) { return true }
      Thread.sleep(forTimeInterval: 0.3)
    }
    return false
  }

  /// The foreground control for the #54 background-adoption finding: same
  /// craft-then-tap sequence as `testScreenPlayThenHomeImmediately`, but
  /// never backgrounds — establishes whether the non-adoption measured there
  /// is about backgrounding at all, or present even with the app foreground
  /// throughout. Uses the TEMPORARY `SYNC`/`PLAYWAIT` diagnostics (`use-
  /// sync.ts`, `reading-view.tsx`) to read the sync's own outcome instead of
  /// inferring it from `resume`/section alone.
  func testScreenPlayForegroundControl() {
    let title = param("BOOK_TITLE", "仙逆")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    clearHarness()
    dismissSavePasswordIfPresent(app)
    openBook(app, title)

    // Establish the engine + Now Playing session at the local place, then pause.
    let play0 = app.buttons["Play"]
    XCTAssertTrue(play0.waitForExistence(timeout: 20), "No Play button on open")
    play0.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Pause"])], timeout: 20)
    Thread.sleep(forTimeInterval: 2.0)
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Play"])], timeout: 10)
    print("CONTROL setup-paused status: \(statusLines(app))")

    // Do not craft while the pause's own sync run might still be in flight.
    let pauseSynced = waitForSyncLine(trigger: "pause", timeoutSeconds: 10)
    print("CONTROL pause-sync-line-seen=\(pauseSynced)")
    XCTAssertTrue(pauseSynced, "The setup pause's own SYNC line never appeared — a run may still be in flight")
    Thread.sleep(forTimeInterval: 0.5)

    requestCraft(param("CRAFT_TEMPLATE", ""), param("CRAFT_DELTA_MS", "300000"))

    let play = app.buttons["Play"]
    XCTAssertTrue(play.exists, "No Play button before the tap")
    let tapEpoch = Date().timeIntervalSince1970
    print("CONTROL tap-epoch=\(tapEpoch)")
    play.tap()
    capture("control-1-tapped", app)

    Thread.sleep(forTimeInterval: 5.0)
    print("CONTROL status +5s: \(statusLines(app))")
    capture("control-2-plus5s", app)
    Thread.sleep(forTimeInterval: 5.0)
    print("CONTROL status +10s: \(statusLines(app))")
    capture("control-3-plus10s", app)

    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Play"])], timeout: 10)
    capture("control-4-paused", app)
    print("CONTROL final status: \(statusLines(app))")
    print("CONTROL library after pause: BEGIN")
    print(readLibraryJSON())
    print("CONTROL library after pause: END")
  }

  func testScreenPlayThenHomeImmediately() {
    let title = param("BOOK_TITLE", "仙逆")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    clearHarness()
    dismissSavePasswordIfPresent(app)
    openBook(app, title)

    // Establish the engine + Now Playing session at the local place, then pause.
    let play0 = app.buttons["Play"]
    XCTAssertTrue(play0.waitForExistence(timeout: 20), "No Play button on open")
    play0.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Pause"])], timeout: 20)
    Thread.sleep(forTimeInterval: 2.0)
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Play"])], timeout: 10)
    Thread.sleep(forTimeInterval: 1.0)
    print("HOMEHOME setup-paused status: \(statusLines(app))")
    print("HOMEHOME local library: BEGIN")
    print(readLibraryJSON())
    print("HOMEHOME local library: END")

    // Do not craft while the setup pause's own sync run might still be in
    // flight (README: a craft finishing under ~2s before the tap can miss a
    // GET that started just before the PUT landed — an unrelated in-flight
    // run here would confuse that timing further).
    let pauseSynced = waitForSyncLine(trigger: "pause", timeoutSeconds: 10)
    print("HOMEHOME pause-sync-line-seen=\(pauseSynced)")

    // Craft the target — never displayed in this process — at least 2s
    // before the tap (README: craft-to-tap under ~1s can miss adoption for a
    // reason outside the app's own logic; 2s is comfortably clear of it).
    requestCraft(param("CRAFT_TEMPLATE", ""), param("CRAFT_DELTA_MS", "300000"))
    Thread.sleep(forTimeInterval: 2.0)

    let play = app.buttons["Play"]
    XCTAssertTrue(play.exists, "No Play button before the tap")
    let tapEpoch = Date().timeIntervalSince1970
    print("HOMEHOME tap-epoch=\(tapEpoch)")
    play.tap()
    XCUIDevice.shared.press(.home)
    let homeEpoch = Date().timeIntervalSince1970
    print("HOMEHOME home-epoch=\(homeEpoch) gap-from-tap=\(homeEpoch - tapEpoch)")
    print("HOMEHOME app.state right after home=\(app.state.rawValue)")
    // `app.state`'s ground truth is the whole-screen capture, not the enum
    // alone (measured 2026-09-24: it read .runningForeground, rawValue 4,
    // both right after Home and 15 s later, on a run a screenshot confirmed
    // WAS genuinely on the Home Screen the whole time — logged, not asserted).
    let homeShot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    homeShot.name = "homehome-1-just-after-home"; homeShot.lifetime = .keepAlways; add(homeShot)

    Thread.sleep(forTimeInterval: 7.0)
    print("HOMEHOME app.state at +7s backgrounded=\(app.state.rawValue)")
    let midShot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    midShot.name = "homehome-2-plus7s-backgrounded"; midShot.lifetime = .keepAlways; add(midShot)

    Thread.sleep(forTimeInterval: 8.0)
    print("HOMEHOME app.state after 15s backgrounded=\(app.state.rawValue)")
    let lateShot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    lateShot.name = "homehome-3-plus15s-backgrounded"; lateShot.lifetime = .keepAlways; add(lateShot)

    let fgEpoch = Date().timeIntervalSince1970
    app.activate()
    print("HOMEHOME foreground-epoch=\(fgEpoch)")
    XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label == 'Play' OR label == 'Pause'")).firstMatch
      .waitForExistence(timeout: 10), "App did not come back to the reader")
    capture("homehome-foregrounded", app)
    print("HOMEHOME status right after foreground: \(statusLines(app))")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Play"])], timeout: 10)
    capture("homehome-paused", app)
    print("HOMEHOME final status: \(statusLines(app))")
    print("HOMEHOME library after pause: BEGIN")
    print(readLibraryJSON())
    print("HOMEHOME library after pause: END")
  }

  func testAdoptedRemotePlayWhileBackgrounded() {
    let title = param("BOOK_TITLE", "仙逆")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    dismissSavePasswordIfPresent(app)
    if !app.buttons.matching(NSPredicate(format: "label == 'Play' OR label == 'Pause'")).firstMatch.waitForExistence(timeout: 5) {
      clearHarness()
      openBook(app, title)
    }
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap(); Thread.sleep(forTimeInterval: 0.5) }
    // A known, already-rendered starting section — see the identical
    // comment on the combined scenario B method.
    if let resetSection = Int(param("RESET_SECTION", "")) { settleAt(app, resetSection) }
    capture("adoptC-0-before-bg", app)

    print("ADOPTC home-epoch=\(Date().timeIntervalSince1970)")
    XCUIDevice.shared.press(.home)
    Thread.sleep(forTimeInterval: 1.5)
    // Craft while backgrounded, right before the remote tap it feeds — the
    // same file handshake `testAdoptedBackgroundCraftForegroundPlay` uses,
    // and for the same reason: a craft-then-separate-invocation gap gives an
    // unrelated poke time to adopt first.
    requestCraft(param("CRAFT_TEMPLATE", ""), param("CRAFT_DELTA_MS", "300000"))

    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let center = springboard.buttons["UIA.MediaControls.NowPlaying.CenterButton"]
    // The Notification Centre swipe measured flaky 2026-09-24: two runs in a
    // row found no center button on the first attempt. Retry the gesture
    // itself up to three times, a longer settle first, before calling it
    // BLOCKED — the flakiness is the swipe/surface, not something a longer
    // single wait alone fixed.
    for attempt in 1...3 {
      springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.01))
        .press(forDuration: 0.1, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.7)))
      if center.waitForExistence(timeout: 5) { break }
      print("ADOPTC Notification Centre swipe attempt \(attempt) did not surface the center button; retrying")
      let diag = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
      diag.name = "adoptC-swipe-fail-\(attempt)"; diag.lifetime = .keepAlways; add(diag)
      print("ADOPTC diag tree attempt \(attempt): \(springboard.debugDescription.prefix(2000))")
      Thread.sleep(forTimeInterval: 1.0)
    }
    guard center.exists else {
      XCTFail("BLOCKED: Now Playing center button did not appear from the Home Screen after 3 swipe attempts; cannot deliver a remote Play this way")
      app.activate()
      return
    }
    let image0 = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image0.name = "adoptC-1-remote-before"; image0.lifetime = .keepAlways; add(image0)
    XCTAssertEqual(center.label, "Play", "Start this check with the transport paused")
    print("ADOPTC remote-tap-epoch=\(Date().timeIntervalSince1970), label-before=\(center.label)")
    center.tap()
    Thread.sleep(forTimeInterval: 1.0)
    print("ADOPTC label just after remote tap=\(center.exists ? center.label : "gone")")

    // Stay backgrounded and let the Metro ticker (read by the host afterward)
    // say whether anything happens without foregrounding.
    Thread.sleep(forTimeInterval: 8.0)
    let image1 = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image1.name = "adoptC-2-remote-after-wait"; image1.lifetime = .keepAlways; add(image1)
    print("ADOPTC label after 8s backgrounded=\(center.exists ? center.label : "gone")")

    print("ADOPTC foreground-epoch=\(Date().timeIntervalSince1970)")
    app.activate()
    XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label == 'Play' OR label == 'Pause'")).firstMatch
      .waitForExistence(timeout: 10), "App did not come back to the reader")
    capture("adoptC-3-foregrounded", app)
    print("ADOPTC status right after foreground: \(statusLines(app))")
    Thread.sleep(forTimeInterval: 2.0)
    capture("adoptC-4-plus2s", app)
    print("ADOPTC status +2s after foreground: \(statusLines(app))")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap() }
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == true"), object: app.buttons["Play"])], timeout: 10)
    capture("adoptC-5-paused", app)
    print("ADOPTC final status: \(statusLines(app))")
    print("ADOPTC library after pause: BEGIN")
    print(readLibraryJSON())
    print("ADOPTC library after pause: END")
  }

  /// #55: reopening a book whose place was adopted earlier this session must
  /// not display its section a second time — no visible reset, no flicker —
  /// and must resume centred at once.
  func testReopenAfterAdoptionNoDoubleDisplay() {
    let title = param("BOOK_TITLE", "仙逆")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label == 'Play' OR label == 'Pause'")).firstMatch
      .waitForExistence(timeout: 15), "No reader on screen")
    if app.buttons["Pause"].exists { app.buttons["Pause"].tap(); Thread.sleep(forTimeInterval: 0.5) }
    leaveReaderRobust(app)
    // See `testPendingPlacePlayWaitsOnReopen`'s comment: a leftover harness
    // command would replay on this reopen's fresh mount.
    clearHarness()
    capture("reopen55-0-library", app)
    Thread.sleep(forTimeInterval: 0.8)
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 15), "\(title) is not on the shelf")
    print("REOPEN55 tap-epoch=\(Date().timeIntervalSince1970)")
    row.tap()
    let player = app.buttons.matching(NSPredicate(format: "label == 'Play' OR label == 'Pause'")).firstMatch
    XCTAssertTrue(player.waitForExistence(timeout: 20), "The player never appeared on reopen")
    for i in 0..<8 {
      let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
      image.name = "reopen55-burst-\(i)"; image.lifetime = .keepAlways; add(image)
      Thread.sleep(forTimeInterval: 0.4)
    }
    print("REOPEN55 status after burst: \(statusLines(app))")
    capture("reopen55-settled", app)
    XCTAssertTrue(app.buttons["Play"].exists, "Must stay paused")
  }
}
