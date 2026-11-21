import UIKit
import XCTest

// Final verification #349/#359 helper: the Settings version line at the Duo.
// SettingsVersionProbe's rows/themes round trip fails on the Duo because its
// backToSettings helper taps navigationBars.buttons element 0, and the Duo's
// landscape navigation bar exposes no buttons to XCUITest (measured 17:16:
// "No matches found for Descendants matching type Button"). This probe checks
// only what the acceptance needs: the exact version line (derived from
// src/build/app-version.ts at run time, Debug role = base + 2 and -debug suffix), from a
// real navigation into Settings. Attaches to the RUNNING app; never launches,
// never terminates, never taps Play, changes no setting.
//
//   bash test/manual-test/kit/run-probe.sh DuoSettingsVersionProbe \
//     SIMULATOR_UDID OUT_DIR -only-testing:DuoSettingsVersionProbe/testVersionLineVisible \
//     -collect-test-diagnostics never
final class DuoSettingsVersionProbe: XCTestCase {
  private var app: XCUIApplication {
    XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
  }

  private func shoot(_ name: String) {
    for (index, screen) in XCUIScreen.screens.enumerated() {
      let attachment = XCTAttachment(screenshot: screen.screenshot())
      attachment.name = "\(name)-screen\(index)"
      attachment.lifetime = .keepAlways
      add(attachment)
    }
  }

  func workingTreeVersion() -> String? {
    let root = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
    guard let text = try? String(contentsOf: root.appendingPathComponent("src/build/app-version.ts"), encoding: .utf8),
          let line = text.split(separator: "\n").first(where: { $0.hasPrefix("export const APP_VERSION = ") })
    else { return nil }
    return line.split(separator: "'").dropFirst().first.map(String.init)
  }

  func testVersionLineVisible() throws {
    // Leave the Reader for the Library with the stable native BackButton.
    if app.buttons["Play"].exists {
      let back = app.buttons.matching(identifier: "BackButton").firstMatch
      XCTAssertTrue(back.waitForExistence(timeout: 6), "Reader has no BackButton to leave by")
      back.tap()
    }
    let settings = app.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 10), "Library header did not appear")
    settings.tap()

    guard let beta = workingTreeVersion() else {
      return XCTFail("Could not read APP_VERSION from src/build/app-version.ts")
    }
    // Debug role: formal base + 2 with the -debug suffix (ADR 0086, #324).
    guard let open = beta.firstIndex(of: "("), let close = beta[open...].firstIndex(of: ")"),
          let build = Int(beta[beta.index(after: open)..<close]) else {
      return XCTFail("APP_VERSION has no base build number: \(beta)")
    }
    let expected = beta.replacingCharacters(in: open...close, with: "(\(build + 2))") + "-debug"
    let version = app.staticTexts["Version \(expected)"]
    XCTAssertTrue(version.waitForExistence(timeout: 8), "No element labelled 'Version \(expected)'")
    print("PROBE-VERSION line='Version \(expected)' exists=\(version.exists)")
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = "duo-settings-tree"; tree.lifetime = .keepAlways; add(tree)
    shoot("duo-settings-version")
    XCTAssertTrue(version.exists, "version line vanished before capture")
  }
}
