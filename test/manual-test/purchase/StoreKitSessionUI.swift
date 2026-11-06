import XCTest
import StoreKitTest

/// GENUINE local StoreKit purchases for the FORMAL OpenReader app, run as a UI
/// test target ATTACHED to the app (TEST_TARGET_NAME=OpenReader) with the
/// scheme LaunchAction naming `storekit/OpenReader.storekit`, so xcodebuild
/// launches the app under the activated local StoreKit test environment
/// (WWDC2020/10659 arrangement). Measured working 2026-11-06: the Release
/// formal app's Purchase row read 'Unlocked' from SKTestSession purchases; an
/// UNATTACHED runner-process session did NOT govern the app (row stayed empty).
///
/// Mode is FAIL-CLOSED: TEST_RUNNER_PROBE_MODE must be passed explicitly
/// (establish|verify); without it every test skips and the run is void. xcodebuild
/// forwards caller environment to the runner only with the TEST_RUNNER_ prefix,
/// and whether it actually did is verified from the raw log markers, never assumed.
final class StoreKitSessionUI: XCTestCase {

  static let trialProduct = "top.xujialiu.openreader.trial"
  static let unlockProduct = "top.xujialiu.openreader.unlock"

  /// Mode and the expected transaction ledger arrive in the scheme's TestAction
  /// EnvironmentVariables (set-scheme-env.rb). xcodebuild's TEST_RUNNER_ prefix
  /// forwarding was measured NOT to reach the runner here, so plain names that
  /// only the scheme can supply keep the arrangement deterministic and
  /// fail-closed: no variable, no run.
  private var mode: String { ProcessInfo.processInfo.environment["PROBE_MODE"] ?? "" }

  private func require(_ wanted: String) throws {
    guard mode == wanted else {
      print("PROBE-MODE-MISMATCH got=\(mode.isEmpty ? "MISSING" : mode) wanted=\(wanted)")
      throw XCTSkip("probe mode got=\(mode.isEmpty ? "MISSING" : mode); this test runs in \(wanted) mode only")
    }
  }

  /// Stable transaction identity: product + originalTransactionIdentifier.
  private func ledger(_ txs: [SKTestTransaction]) -> String {
    let parts = txs.map { "\($0.productIdentifier)#id\($0.identifier)#orig\($0.originalTransactionIdentifier)" }.sorted()
    return parts.joined(separator: ",")
  }

  private func makeSession() throws -> SKTestSession {
    let url = Bundle(for: StoreKitSessionUI.self).url(forResource: "OpenReader", withExtension: "storekit")
    let unwrapped = try XCTUnwrap(url, "OpenReader.storekit resource missing from the UI test bundle")
    return try SKTestSession(contentsOf: unwrapped)
  }

  @MainActor
  private func shoot(_ app: XCUIApplication, name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.lifetime = .keepAlways
    attachment.name = name
    add(attachment)
  }

  /// Cold start (a warm app can sit anywhere), open Settings, read the Purchase
  /// row. After a purchase the row's LABEL carries the value ('Purchase, 30 days
  /// left' / 'Purchase, Unlocked'), so match by prefix/contains, never equality.
  @MainActor
  private func readPurchaseRow(_ app: XCUIApplication) throws -> String {
    app.terminate()
    app.launch()
    let settings = app.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 30), "Settings button not found on the Library")
    settings.tap()
    let purchase = app.descendants(matching: .any).matching(
      NSPredicate(format: "identifier == 'Purchase' OR label BEGINSWITH 'Purchase'")).firstMatch
    let appeared = purchase.waitForExistence(timeout: 25)
    if !appeared { shoot(app, name: "purchase-row-missing") }
    XCTAssertTrue(appeared, "Purchase row not found in Settings (a formal-role app is required)")
    let rowValue = (purchase.value as? String) ?? ""
    let candidates = app.descendants(matching: .any).matching(NSPredicate(
      format: "label CONTAINS 'Trial ended' OR label CONTAINS 'Unlocked' OR label CONTAINS 'Unavailable' OR (label CONTAINS 'day' AND label CONTAINS 'left')"))
    var seen = rowValue
    if seen.isEmpty, candidates.count > 0, candidates.firstMatch.exists {
      seen = candidates.firstMatch.label
    }
    shoot(app, name: "purchase-row")
    return seen
  }

  @MainActor
  func test01BuyTrialAndSeeDaysLeft() throws {
    try require("establish")
    let session = try makeSession()
    session.disableDialogs = true
    session.clearTransactions()
    let before = session.allTransactions()
    print("PROBE-MODE establish")
    print("PROBE-TRANSACTIONS-BEFORE \(before.count)")
    try session.buyProduct(productIdentifier: Self.trialProduct)
    let after = session.allTransactions()
    print("PROBE-TRANSACTIONS-AFTER \(after.count) [\(ledger(after))]")
    XCTAssertTrue(after.contains { $0.productIdentifier == Self.trialProduct },
                  "buyProduct produced no StoreKitTest transaction for the Trial product")
    let app = XCUIApplication()
    let row = try readPurchaseRow(app)
    print("PROBE-PURCHASE-ROW \(row)")
    XCTAssertTrue(row.contains("day") && row.contains("left"),
                  "Purchase row did not show the Trial's days left; read: '\(row)'")
  }

  @MainActor
  func test02BuyUnlockAndSeeUnlocked() throws {
    try require("establish")
    let session = try makeSession()
    session.disableDialogs = true
    try session.buyProduct(productIdentifier: Self.unlockProduct)
    let kept = session.allTransactions()
    print("PROBE-TX-LEDGER [\(ledger(kept))]")
    XCTAssertTrue(kept.contains { $0.productIdentifier == Self.unlockProduct }, "Unlock transaction missing")
    XCTAssertTrue(kept.contains { $0.productIdentifier == Self.trialProduct }, "Trial transaction no longer kept after the Unlock purchase")
    let app = XCUIApplication()
    let row = try readPurchaseRow(app)
    print("PROBE-PURCHASE-ROW-UNLOCK \(row)")
    XCTAssertTrue(row.contains("Unlocked"), "Purchase row did not read 'Unlocked' after buying the Unlock; read: '\(row)'")
  }

  @MainActor
  func test03RetainedPurchasesWithoutANewPurchase() throws {
    try require("verify")
    print("PROBE-MODE verify")
    let session = try makeSession()
    let kept = session.allTransactions()
    print("PROBE-KEPT-TX \(kept.count) [\(ledger(kept))]")
    XCTAssertTrue(kept.contains { $0.productIdentifier == Self.trialProduct },
                  "The Trial transaction is no longer kept; kept: \(ledger(kept))")
    XCTAssertTrue(kept.contains { $0.productIdentifier == Self.unlockProduct },
                  "The Unlock transaction is no longer kept; kept: \(ledger(kept))")
    // Identity-level retention when the host passed the establish ledger through.
    if let expected = ProcessInfo.processInfo.environment["EXPECTED_TX"], !expected.isEmpty {
      let got = Set(ledger(kept).components(separatedBy: ","))
      let want = Set(expected.components(separatedBy: ","))
      XCTAssertEqual(got, want, "Retained transaction identities differ from the establish ledger; got \(got), want \(want)")
    }
    let app = XCUIApplication()
    let row = try readPurchaseRow(app)
    print("PROBE-PURCHASE-ROW-AFTER-OVERLAY \(row)")
    XCTAssertTrue(row.contains("Unlocked"), "The earlier purchases are no longer visible; read: '\(row)'")
  }
}
