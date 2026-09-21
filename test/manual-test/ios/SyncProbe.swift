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
    // exactly like a folder that is empty. Clear far past the longest value, and
    // check what the field holds afterwards.
    field.typeText(String(repeating: "\u{8}", count: 300))
    XCTAssertEqual((field.value as? String) ?? "", (field.placeholderValue ?? ""), "The field did not clear before typing")
    let characters = Array(text)
    var at = 0
    while at < characters.count {
      let end = min(at + 10, characters.count)
      field.typeText(String(characters[at..<end]))
      at = end
    }
  }

  /// The keyboard covers the switch; `keyboardShouldPersistTaps="handled"`
  /// means a tap on the plain group header dismisses it without doing anything.
  func dismissKeyboard(_ app: XCUIApplication) {
    if app.keyboards.count > 0 { app.staticTexts.matching(identifier: "FOLDER").firstMatch.tap() }
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
}
