import XCTest

/**
 * Types the Local provider's gateway headers into the Provider screen, with
 * real touches, for #105's simulator run.
 *
 * The value is the Kokoro gateway's Cloudflare Access pair. The caller stages
 * it host-side at `/tmp/openreader-105/gateway-headers.txt` (`chmod 600`,
 * removed after the run); the simulator process reads that path itself — a
 * simulator app shares the host's filesystem. The value is never printed,
 * never captured: the Extra headers field is masked (`secure`), and nothing
 * here writes it to the log. The probe attaches to the app already on the
 * Provider screen; it does not relaunch it, so no Metro launch argument is
 * needed.
 *
 * Enabling the provider runs the app's own connection check — flush the typed
 * edit to the Keychain, read it back, list the voices through the gateway —
 * and only enables on success, so the note `Connection successful` is the
 * assertion that the typed headers actually work.
 *
 *     bash test/manual-test/kit/run-probe.sh ProviderHeaders105Probe \
 *       SIMULATOR_UDID /tmp/openreader-105/probe
 *
 * What it cannot prove: nothing about sync or the reading — it exists only to
 * put the gateway credential in the Keychain without leaking it, and to prove
 * that credential answers. With no staged file the probe skips.
 */
final class ProviderHeaders105Probe: XCTestCase {

  func testTypeLocalGatewayHeadersAndEnable() throws {
    guard let secret = try? String(contentsOfFile: "/tmp/openreader-105/gateway-headers.txt", encoding: .utf8),
          !secret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw XCTSkip("No /tmp/openreader-105/gateway-headers.txt; stage it host-side to run this probe")
    }
    let headers = secret.trimmingCharacters(in: .whitespacesAndNewlines)

    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.activate()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10), "OpenReader did not come to the front")

    // The field is masked, so it is a secure text field; accept a plain one
    // too, in case a build reveals it by default.
    let field = app.secureTextFields["Extra headers"].exists
      ? app.secureTextFields["Extra headers"]
      : app.textFields["Extra headers"]
    XCTAssertTrue(field.waitForExistence(timeout: 10), "No Extra headers field; is the Provider screen open with the provider disabled?")
    field.tap()
    field.typeText(headers)

    // The switch back on: the app's own enable path flushes the typed edit to
    // the Keychain and checks the connection through the gateway. The note is
    // a group footer; match it by its text element, not by a container query
    // (the first run's `ANY staticTexts` predicate timed out at 30 s while the
    // note was on the screen and the voices request had answered 200).
    let enabled = app.switches["Enable Kokoro FastAPI"]
    XCTAssertTrue(enabled.waitForExistence(timeout: 5), "No Enabled switch")
    enabled.tap()

    let successText = app.staticTexts["Connection successful"]
    XCTAssertTrue(successText.waitForExistence(timeout: 30),
                  "Enabling Kokoro FastAPI must end at 'Connection successful' with the typed headers")
    XCTAssertEqual(enabled.value as? String, "1", "The provider must be enabled after a successful check")

    // Leave the screen somewhere readable; capture nothing but the settled
    // screen (the field is masked in captures — 'secure' — but do not tap the
    // eye that would reveal it).
    let visible = app.staticTexts.allElementsBoundByIndex.prefix(40).compactMap { $0.label }.filter { !$0.isEmpty }
    print("PROVIDER SCREEN TEXTS: \(visible.joined(separator: " | "))")
  }
}
