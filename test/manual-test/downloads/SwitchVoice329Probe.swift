import XCTest

/// Real-touch verification of #329's `Switch voice` on the Download and Manage
/// pages: the phone's own SwiftUI `Menu` (`ChoiceMenu`) that AXe and
/// mobilebuildmcp taps do not open (#311 "Sentences at once", #325 "Sleep
/// Timer"). Attaches to the already running app; the caller leaves it on the
/// Download or Manage page with the wanted Document and one Voice. Plays
/// nothing.
///
///   bash test/manual-test/kit/run-probe.sh SwitchVoice329Probe SIMULATOR_UDID OUT_DIR \
///     -only-testing:testSwitchVoice -collect-test-diagnostics never
///
/// Environment (all optional except where said):
///   SV_NO_LINK=1        assert no `Switch voice` button at all (absence).
///   SV_EXPECT_BUTTON=L  the button's exact label (e.g. the `Switch voice, X` form).
///   SV_TAP_EDGE=1       open the menu by tapping the button frame's right
///                       edge (inside the 8 pt padding ring, outside the words).
///   SV_OPEN=1           open the menu by tapping the button (default flow).
///   SV_EXPECT_ENTRIES=a,b,…  each entry exists, in this top-to-bottom order.
///   SV_CHOSEN=L         the entry that must carry the menu's checkmark.
///   SV_DUMP=1           print every menu item's type/label/value/selected.
///   SV_CHOOSE=L         tap this entry and wait for the menu to close.
///   SV_EXPECT_LINE=L    the `Voice · …` staticText to expect afterwards.
///   SV_EXPECT_COUNT=L   the count line (`N chapters downloaded`) to expect.
///   SV_MANAGE=1         first tap `Manage downloads` (from Download).
///   SV_BACK=1           first tap `Back from Manage` (from Manage).
///   SV_NO_OLD_ROWS=1    assert no `Use downloaded voice ·` / `Manage · ` row.
final class SwitchVoice329Probe: XCTestCase {

  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  func capture(_ name: String, _ app: XCUIApplication) {
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = name + "-tree"; tree.lifetime = .keepAlways; add(tree)
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func menuItem(_ app: XCUIApplication, _ title: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", title)).firstMatch
  }

  func switchButton(_ app: XCUIApplication) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Switch voice'")).firstMatch
  }

  func testSwitchVoice() throws {
    let raw = ProcessInfo.processInfo.environment
    // xcodebuild forwards the caller's TEST_RUNNER_<name> to the runner with the prefix stripped.
    let env = Dictionary(uniqueKeysWithValues: raw.map { (key, value) in
      (key.hasPrefix("TEST_RUNNER_") ? String(key.dropFirst("TEST_RUNNER_".count)) : key, value)
    })
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()

    // Staging from a known state (AXe's tree can be empty after relaunches; XCTest is the independent path):
    // relaunch to the Library, open the Document whose row starts with SV_STAGE, then More actions > Download.
    if let stage = env["SV_STAGE"] {
      app.terminate()
      app.launch()
      let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", stage)).firstMatch
      XCTAssertTrue(row.waitForExistence(timeout: 20), "No Library row starting '\(stage)'")
      row.tap()
      let more = app.buttons["More actions"]
      XCTAssertTrue(more.waitForExistence(timeout: 10), "No More actions in the reader")
      more.tap()
      let download = app.buttons["Download"]
      XCTAssertTrue(download.waitForExistence(timeout: 8), "No Download row in the actions drawer")
      download.tap()
    }

    if env["SV_BACK"] == "1" {
      let back = app.buttons["Back from Manage"]
      XCTAssertTrue(back.waitForExistence(timeout: 8), "No Back from Manage: is the Manage page open?")
      back.tap()
    }
    if env["SV_MANAGE"] == "1" {
      let manage = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Manage downloads'")).firstMatch
      XCTAssertTrue(manage.waitForExistence(timeout: 8), "No Manage downloads link: is the Download page open?")
      manage.tap()
      // Manage lists only chapters with audio, and offers Delete all audio.
      XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Delete all'")).firstMatch
        .waitForExistence(timeout: 8), "Manage page did not appear")
    }

    let link = switchButton(app)
    if env["SV_NO_LINK"] == "1" {
      Thread.sleep(forTimeInterval: 1.5)
      XCTAssertFalse(link.exists, "Switch voice is offered but must not be")
      capture("sv-absent", app)
      return
    }
    XCTAssertTrue(link.waitForExistence(timeout: 10), "No Switch voice button: is the Download/Manage page open?")

    if let expectedButton = env["SV_EXPECT_BUTTON"] {
      XCTAssertEqual(link.label, expectedButton, "The Switch voice button's label")
    }
    if env["SV_NO_OLD_ROWS"] == "1" {
      XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Use downloaded voice'")).firstMatch.exists,
        "An old 'Use downloaded voice' row is still here")
      XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Manage ·'")).firstMatch.exists,
        "An old 'Manage ·' row is still here")
    }
    // The link hangs at the right end of the Voice line: the `Voice · …` text
    // is the flex:1 word beside it, so it must end at or before the link's left
    // edge, and the two must share the line's band.
    let voiceText = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Voice ·'")).firstMatch
    XCTAssertTrue(voiceText.waitForExistence(timeout: 5), "No Voice · line")
    // Without a menu choice, the expected line is the page's own state (e.g. after Back from Manage).
    if let expectedLine = env["SV_EXPECT_LINE"], env["SV_CHOOSE"] == nil {
      XCTAssertEqual(voiceText.label, expectedLine, "The Voice line")
    }
    let line = voiceText.frame, tail = link.frame
    XCTAssertLessThanOrEqual(line.maxX, tail.minX + 1, "The Voice text runs under Switch voice")
    XCTAssertLessThanOrEqual(abs(tail.midY - line.midY), 14, "Switch voice does not sit on the Voice line")
    capture("sv-line", app)

    if env["SV_TAP_EDGE"] == "1" {
      // The words end ~8 pt inside the button's frame (`switchWords` padding);
      // a hit 3 pt from the frame's right edge is past the words and lands
      // only if the padding ring is touchable.
      link.coordinate(withNormalizedOffset: CGVector(dx: 0.985, dy: 0.5)).tap()
    } else if env["SV_OPEN"] == "1" || env["SV_EXPECT_ENTRIES"] != nil || env["SV_CHOOSE"] != nil {
      link.tap()
    } else {
      return
    }

    let names = env["SV_EXPECT_ENTRIES"]?.components(separatedBy: "|").filter { !$0.isEmpty } ?? []
    var lastY = -CGFloat.greatestFiniteMagnitude
    for name in names {
      let item = menuItem(app, name)
      XCTAssertTrue(item.waitForExistence(timeout: 5), "The menu has no '\(name)'")
      XCTAssertGreaterThan(item.frame.origin.y, lastY, "'\(name)' is not below the previous entry")
      lastY = item.frame.origin.y
    }
    if let chosen = env["SV_CHOSEN"] {
      let item = menuItem(app, chosen)
      XCTAssertTrue(item.waitForExistence(timeout: 5), "The menu has no '\(chosen)' to check")
      let checked = item.isSelected || item.value as? String == "1"
      XCTAssertTrue(checked, "'\(chosen)' does not carry the checkmark (isSelected=\(item.isSelected), value=\(item.value ?? "nil"))")
    }
    if env["SV_DUMP"] == "1" {
      for i in 0..<app.descendants(matching: .any).count {
        let e = app.descendants(matching: .any).element(boundBy: i)
        guard e.label.contains("af_") || e.label.contains("Voice") || e.label.contains("Kokoro") || e.label.contains("OpenAI") else { continue }
        print("SVITEM[\(i)] type=\(e.elementType.rawValue) label='\(e.label)' value='\(e.value ?? "nil")' selected=\(e.isSelected) frame=\(e.frame)")
      }
    }
    capture("sv-menu-open", app)

    if let choose = env["SV_CHOOSE"] {
      let item = menuItem(app, choose)
      XCTAssertTrue(item.waitForExistence(timeout: 5), "The menu has no '\(choose)' to choose")
      item.tap()
      let gone = NSPredicate(format: "exists == false")
      expectation(for: gone, evaluatedWith: item, handler: nil)
      waitForExpectations(timeout: 8, handler: nil)
      if let expectedLine = env["SV_EXPECT_LINE"] {
        let line = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Voice ·'")).firstMatch
        XCTAssertTrue(line.waitForExistence(timeout: 8), "No Voice · line after choosing")
        XCTAssertEqual(line.label, expectedLine, "The Voice line after choosing")
      }
      if let expectedCount = env["SV_EXPECT_COUNT"] {
        let count = app.staticTexts.matching(NSPredicate(format: "label == %@", expectedCount)).firstMatch
        XCTAssertTrue(count.waitForExistence(timeout: 8), "No count line '\(expectedCount)' after choosing")
      }
      capture("sv-after-choose", app)
      print("SVPROBE voice line now: \(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Voice ·'")).firstMatch.label)")
    }
  }
}
