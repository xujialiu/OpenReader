import XCTest

/// Every settings page, the player and the playback speed bubble, captured
/// for comparison with the phone's own Settings (`native-reference.sh`,
/// design 0042, #48): Settings, General, Providers, two provider pages, Sync
/// empty and filled, and a reader's player with its speed bubble open.
/// `testSpeedBubble` then checks the bubble's taps, its hold, and that a tap
/// outside it only closes it.
/// `design-shots.sh` runs it once per theme. Never presses Play, never turns
/// the Sync switch on, and empties Sync's fields again before it leaves, so a
/// dedicated simulator is left as it was found.
final class DesignShotsProbe: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func capture(_ name: String, _ app: XCUIApplication) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  /// From wherever the last session left the app (state restoration can land
  /// in a reader) to the Library, then into Settings.
  func openSettings(_ app: XCUIApplication) {
    if app.buttons["Back"].exists { app.buttons["Back"].tap() }
    let settings = app.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 15), "Library header did not appear")
    settings.tap()
  }

  /// Every Settings-stack screen's first nav-bar button is its back arrow,
  /// labelled `Back` since #48 whatever is behind it (README Pitfalls).
  func back(_ app: XCUIApplication) {
    app.navigationBars.buttons.element(boundBy: 0).tap()
  }

  /// Ten characters at a time, the fix for "typeText with a long value kills
  /// a settings screen" (README Pitfalls).
  ///
  /// Emptied with the field's own clear button: a tap leaves the caret where
  /// it lands and a backspace deletes only what is before it, so backspaces
  /// cannot be counted on (README Pitfalls).
  func clearAndType(_ field: XCUIElement, _ text: String) {
    field.tap()
    let clear = field.buttons["Clear text"]
    if clear.waitForExistence(timeout: 1) { clear.tap() }
    XCTAssertEqual((field.value as? String) ?? "", (field.placeholderValue ?? ""), "The field did not empty")
    let characters = Array(text)
    var at = 0
    while at < characters.count {
      let end = min(at + 10, characters.count)
      field.typeText(String(characters[at..<end]))
      at = end
    }
  }

  /// Sync's fields sit in a `keyboardShouldPersistTaps="handled"` ScrollView;
  /// a tap on the "Folder" group title (not a field, not the switch row)
  /// resigns the keyboard without touching anything else.
  func dismissKeyboard(_ app: XCUIApplication) {
    // A plain SettingsGroup title renders as two nested StaticTexts with the
    // same label under Fabric (both "Folder"), so the bare subscript throws
    // "Multiple matching elements found"; .firstMatch resolves it.
    if app.keyboards.count > 0 { app.staticTexts.matching(NSPredicate(format: "label == 'Folder'")).firstMatch.tap() }
    _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "count == 0"), object: app.keyboards)], timeout: 3)
  }

  func openReaderFixture(_ app: XCUIApplication) {
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Stat Line Fixture'")).firstMatch
    if row.waitForExistence(timeout: 3) { row.tap() }
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 15), "Reader did not lay out")
    // A fresh WKWebView can screenshot blank right after layout even once
    // React Native's own readiness signal has cleared (README Pitfalls).
    Thread.sleep(forTimeInterval: 2)
    // README Pitfalls: a console warning from opening this reader can raise
    // the "Open debugger to view warnings." banner, which overlaps the
    // bottom of the player and swallows a tap meant for a control there
    // (measured here: the Playback speed button). The banner is global app
    // state and a relaunch is the reliable way to clear it; state
    // restoration reopens this same reader afterward.
    if app.staticTexts["Open debugger to view warnings."].exists {
      app.terminate(); app.launch()
      XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 15), "Reader did not restore after clearing LogBox")
      Thread.sleep(forTimeInterval: 2)
    }
  }

  func speedLabel(_ app: XCUIApplication) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Playback speed,'")).firstMatch
  }

  /// The bubble has no title of its own; its Faster button is what shows it is open.
  func openSpeedBubble(_ app: XCUIApplication) {
    let speed = speedLabel(app)
    XCTAssertTrue(speed.waitForExistence(timeout: 5), "No Playback speed control")
    speed.tap()
    XCTAssertTrue(app.buttons["Faster"].waitForExistence(timeout: 5), "Speed bubble did not open")
  }

  func testCaptureScreens() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()

    openSettings(app)
    let general = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'General'")).firstMatch
    let providers = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Providers'")).firstMatch
    let sync = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sync'")).firstMatch
    XCTAssertTrue(general.waitForExistence(timeout: 10), "Settings did not load")
    XCTAssertTrue(providers.exists && sync.exists, "Settings is missing a row")
    capture("settings-root", app)

    general.tap()
    XCTAssertTrue(app.navigationBars["General"].waitForExistence(timeout: 5), "General did not load")
    capture("general", app)
    back(app)

    XCTAssertTrue(providers.waitForExistence(timeout: 5), "Settings did not return")
    providers.tap()
    XCTAssertTrue(app.navigationBars["Providers"].waitForExistence(timeout: 5), "Providers did not load")
    capture("providers", app)

    let fishRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Fish Audio,'")).firstMatch
    XCTAssertTrue(fishRow.waitForExistence(timeout: 5), "No Fish Audio row")
    fishRow.tap()
    XCTAssertTrue(app.navigationBars["Fish Audio"].waitForExistence(timeout: 5), "Fish Audio did not load")
    capture("provider-fish", app)
    back(app)

    XCTAssertTrue(app.navigationBars["Providers"].waitForExistence(timeout: 5), "Providers did not return")
    let compatRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'OpenAI Compatible,'")).firstMatch
    XCTAssertTrue(compatRow.waitForExistence(timeout: 5), "No OpenAI Compatible row")
    compatRow.tap()
    XCTAssertTrue(app.navigationBars["OpenAI Compatible"].waitForExistence(timeout: 5), "OpenAI Compatible did not load")
    capture("provider-compatible", app)
    back(app)
    XCTAssertTrue(app.navigationBars["Providers"].waitForExistence(timeout: 5), "Providers did not return")
    back(app)

    XCTAssertTrue(sync.waitForExistence(timeout: 5), "Settings did not return")
    sync.tap()
    let address = app.textFields["Address"]
    let username = app.textFields["Username"]
    let password = app.secureTextFields["Password"]
    XCTAssertTrue(address.waitForExistence(timeout: 5), "Sync screen did not load")
    XCTAssertTrue(username.exists && password.exists, "Sync screen is missing a field")
    capture("sync-empty", app)

    clearAndType(address, "https://dav.example.com/remote.php/dav/files/reader/OpenReader")
    clearAndType(username, "reader")
    clearAndType(password, "anything")
    dismissKeyboard(app)
    let toggle = app.switches["Keep my place across devices"]
    XCTAssertTrue(toggle.waitForExistence(timeout: 5), "No sync switch")
    XCTAssertEqual((toggle.value as? String) ?? "0", "0", "The sync switch must stay off")
    capture("sync-filled", app)
    // Empty again: the values above are samples, and the next person to open
    // Sync on this simulator should not find them.
    clearAndType(address, "")
    clearAndType(username, "")
    clearAndType(password, "")
    dismissKeyboard(app)

    back(app) // Sync -> Settings
    // The back button no longer shows the screen behind it (#48); the bar's own
    // title is what says Settings is back.
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5), "Settings did not return")
    back(app) // Settings -> Library

    openReaderFixture(app)
    capture("reader-player", app)
    openSpeedBubble(app)
    capture("speed-bubble", app)
  }

  /// The back arrow shows no words since #48, and VoiceOver calls every one
  /// `Back`, as it already called the reader's. Measured: the phone's own
  /// Settings names the screen behind instead (`native-reference.sh`'s tree,
  /// `BackButton`, label `Settings`), which the navigator's minimal back
  /// button does not offer. A label other than `Back` here means an arrow
  /// has its words again.
  func testBackButtonLabels() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    openSettings(app)
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10), "Settings did not open")
    let settingsBack = app.navigationBars.buttons.element(boundBy: 0).label
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'General'")).firstMatch.tap()
    XCTAssertTrue(app.navigationBars["General"].waitForExistence(timeout: 5), "General did not open")
    let generalBack = app.navigationBars.buttons.element(boundBy: 0).label
    back(app)
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Providers'")).firstMatch.tap()
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Fish Audio,'")).firstMatch.tap()
    XCTAssertTrue(app.navigationBars["Fish Audio"].waitForExistence(timeout: 5), "Fish Audio did not open")
    let providerBack = app.navigationBars.buttons.element(boundBy: 0).label
    print("BACK labels: Settings=\(settingsBack) General=\(generalBack) Provider=\(providerBack)")
    capture("back-arrow-provider", app)
    XCTAssertEqual(settingsBack, "Back")
    XCTAssertEqual(generalBack, "Back")
    XCTAssertEqual(providerBack, "Back")
    back(app); back(app); back(app)
  }

  /// One tap is 0.05 either way, holding repeats, and a tap outside the bubble
  /// only closes it: the Contents button under that tap must not open the
  /// contents (it did, before the player laid a shield over itself). Leaves the
  /// speed where it found it. Never presses Play.
  func testSpeedBubble() throws {
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.terminate(); app.launch()
    openSettings(app)
    back(app) // Settings -> Library
    openReaderFixture(app)
    let before = speedLabel(app).label

    openSpeedBubble(app)
    app.buttons["Faster"].tap()
    XCTAssertNotEqual(speedLabel(app).label, before, "One tap on Faster did not change the speed")
    app.buttons["Slower"].tap()
    XCTAssertEqual(speedLabel(app).label, before, "Slower did not undo Faster")

    app.buttons["Faster"].press(forDuration: 1.5)
    let held = speedLabel(app).label
    print("SPEED held from \(before) to \(held)")
    XCTAssertNotEqual(held, before, "Holding Faster did not repeat")
    capture("speed-bubble-held", app)
    for _ in 0..<80 where speedLabel(app).label != before {
      app.buttons["Slower"].tap()
    }
    XCTAssertEqual(speedLabel(app).label, before, "The speed was not put back")

    // A coordinate tap: while the bubble is open the controls behind it are
    // not hittable to XCTest, which is the point being tested.
    app.buttons["Contents"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    let closed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.buttons["Faster"])
    XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 3), .completed, "A tap outside did not close the bubble")
    XCTAssertFalse(app.buttons["Close Contents"].waitForExistence(timeout: 2), "The tap that closed the bubble also opened the contents")
    capture("speed-bubble-closed", app)

    // The contents still open with a tap of their own once the bubble is gone.
    app.buttons["Contents"].tap()
    XCTAssertTrue(app.buttons["Close Contents"].waitForExistence(timeout: 5), "Contents no longer opens")
    app.buttons["Close Contents"].tap()
  }
}
