import XCTest

/// Real touches for #70: the player's head row is `headEnd` (44 pt, empty) —
/// `voiceSlot` (flex, the Voice name centred in it) — the collapse arrow (44
/// pt). Only the name opens Voice; a tap on the empty slot or in the gap
/// beside a short name must land on plain `View`s and do nothing; the arrow
/// still collapses the player (test/manual-test/README.md, "Player: the
/// Voice name's horizontal centre…").
///
/// Needs a Document already open, the player expanded (`collapsed=false`)
/// with a short Voice name chosen (the harness sets this up — see the
/// method's own doc comment), and iOS 27's simulator, which sometimes shows a
/// Keychain "Save Password?" sheet left over from typing into a secure field
/// earlier in the run (README Pitfalls, "A Keychain save-password sheet
/// outlives the screen it was typed on").
///
/// `.activate()` only, never `.terminate()/.launch()`: the point is the app's
/// *current* in-memory state (the book already open, the theme, the voice),
/// the same reason `BrowseTouchProbe`/`LineColourProbe` use it.
final class PlayerTouchProbe: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  /// A left-over Keychain "Save Password?" sheet can sit over the app from an
  /// earlier method that typed into a secure field (`AzureProviderProbe`).
  /// Observed both hosted in the app's own process and, on other iOS
  /// versions, in SpringBoard's — try both, best-effort.
  func dismissSystemAlerts(_ app: XCUIApplication) {
    let inApp = app.buttons["Not Now"]
    if inApp.waitForExistence(timeout: 2) { inApp.tap(); return }
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let sbNotNow = springboard.buttons["Not Now"]
    if sbNotNow.waitForExistence(timeout: 2) { sbNotNow.tap() }
  }

  func closeDrawer(_ app: XCUIApplication) {
    let close = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Close '")).firstMatch
    XCTAssertTrue(close.waitForExistence(timeout: 3), "No drawer to close")
    close.tap()
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: close)], timeout: 3)
  }

  /// Needs: a Document open, the player expanded, Azure's "Andrew" (a short
  /// label) the current Voice — the harness sets all three up before this
  /// runs (`hx.sh`: `add`, `open`, `settings` theme, `ask`+`voice` Azure/
  /// Andrew). Leaves the player collapsed; the harness re-expands it
  /// afterwards (`{"do":"collapse","on":false}`), since only a real Pause
  /// re-opens it by touch and this method's job is Play-free.
  func testHeadRowTouches() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    dismissSystemAlerts(app)

    let voiceBtn = app.buttons["Choose a Voice"]
    let chevronBtn = app.buttons["Collapse the player"]
    XCTAssertTrue(voiceBtn.waitForExistence(timeout: 15), "Expanded player with a Voice chosen must already be showing")
    XCTAssertTrue(chevronBtn.exists, "Collapse arrow missing")
    // The Pressable's own accessibilityLabel is the fixed "Choose a Voice"
    // (player.tsx), not the Voice name inside it, so the name itself is read
    // from its Text descendant rather than asserted through `.label` here;
    // the harness's own `{"do":"say"}` already confirmed voiceInUse before
    // this method ran.
    let nameText = voiceBtn.staticTexts.firstMatch
    print("PlayerTouchProbe voice button label=\(voiceBtn.label) name text=\(nameText.exists ? nameText.label : "<none>")")

    let win = app.windows.firstMatch.frame
    print("PlayerTouchProbe window frame: \(win)")
    print("PlayerTouchProbe voice button frame: \(voiceBtn.frame)")
    print("PlayerTouchProbe chevron frame: \(chevronBtn.frame)")
    capture("head-row-before", app)

    let headY = chevronBtn.frame.midY
    // The centre of the 44 pt empty `headEnd` slot, left of the name.
    let leftSlotX = win.minX + 12 + 22
    // Midway between the name button's own right edge and the arrow's left
    // edge — inside `voiceSlot` but off the Pressable a short name leaves.
    let gapX = (voiceBtn.frame.maxX + chevronBtn.frame.minX) / 2
    XCTAssertGreaterThan(gapX, voiceBtn.frame.maxX + 8, "Andrew's button must leave a real gap to tap, not touch the arrow")
    print("PlayerTouchProbe leftSlotX=\(leftSlotX) gapX=\(gapX) headY=\(headY)")

    func tapPoint(_ x: CGFloat, _ y: CGFloat) {
      app.coordinate(withNormalizedOffset: CGVector(dx: x / win.width, dy: y / win.height)).tap()
    }

    // 1. The empty left slot: nothing opens, nothing changes.
    tapPoint(leftSlotX, headY)
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertFalse(app.buttons["Close Voice"].exists, "Left slot tap opened Voice")
    XCTAssertFalse(app.buttons["Close Contents"].exists, "Left slot tap opened Contents")
    XCTAssertTrue(voiceBtn.exists && chevronBtn.exists, "Left slot tap left the expanded player")
    capture("head-row-after-left-slot-tap", app)

    // 2. The gap between the (short) name and the arrow: nothing opens.
    tapPoint(gapX, headY)
    Thread.sleep(forTimeInterval: 0.6)
    XCTAssertFalse(app.buttons["Close Voice"].exists, "Gap tap opened Voice")
    XCTAssertFalse(app.buttons["Close Contents"].exists, "Gap tap opened Contents")
    XCTAssertTrue(voiceBtn.exists && chevronBtn.exists, "Gap tap left the expanded player")
    capture("head-row-after-gap-tap", app)

    // 3. The name: opens Voice.
    voiceBtn.tap()
    XCTAssertTrue(app.buttons["Close Voice"].waitForExistence(timeout: 5), "Tapping the name did not open Voice")
    Thread.sleep(forTimeInterval: 0.8) // let the sheet's slide-in rest (README Pitfalls, "Screenshots of a sheet")
    capture("voice-sheet-opened-by-name-tap", app)
    closeDrawer(app)
    XCTAssertTrue(voiceBtn.waitForExistence(timeout: 5), "Player did not return after closing Voice")

    // 4. The arrow: collapses the player.
    chevronBtn.tap()
    let collapsedExpectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: voiceBtn)
    _ = XCTWaiter.wait(for: [collapsedExpectation], timeout: 5)
    XCTAssertFalse(voiceBtn.exists, "Arrow tap did not collapse the player (Choose a Voice still present)")
    XCTAssertFalse(chevronBtn.exists, "Arrow tap did not collapse the player (arrow itself still present)")
    XCTAssertTrue(app.buttons["Play"].exists || app.buttons["Pause"].exists, "Collapsed player must still offer one transport button")
    capture("collapsed-after-arrow-tap", app)
  }
}
