import XCTest
import StoreKitTest

/// GENUINE local StoreKit purchases for the FORMAL OpenReader app, run as a UI
/// test target ATTACHED to the formal app target (TEST_TARGET_NAME=OpenReader)
/// with the shared scheme `StoreKitUI` naming `storekit/OpenReader.storekit`,
/// so `xcodebuild test` builds the formal app and the local StoreKit test
/// environment applies to it (the WWDC2020/10659 arrangement).
///
/// Mode and the expected transaction ledger travel in the scheme's TestAction
/// EnvironmentVariables, written per run by `purchase/set-scheme-env.rb`.
/// Plain `TEST_RUNNER_`-prefixed environment did NOT reach the runner on this
/// setup (measured 2026-11-06), so this probe reads no environment other than
/// the scheme's `PROBE_MODE` and `EXPECTED_TX` — and a missing or invalid
/// `PROBE_MODE` FAILS the tests (never skips: an all-skip run must not exit 0).
///
/// Modes: `establish` clears the session store and buys the Trial then the
/// Unlock; `verify` buys nothing, requires nonempty `EXPECTED_TX`, and asserts
/// both original transaction identities are still kept and the row still
/// reads 'Unlocked'.
final class StoreKitSessionUI: XCTestCase {

  static let trialProduct = "top.xujialiu.openreader.trial"
  static let unlockProduct = "top.xujialiu.openreader.unlock"

  private var mode: String { ProcessInfo.processInfo.environment["PROBE_MODE"] ?? "" }
  private var expectedTx: String { ProcessInfo.processInfo.environment["EXPECTED_TX"] ?? "" }

  /// Fail closed on missing/invalid mode: an all-skipped run must not read as
  /// a pass (XCTSkip would exit 0).
  private func require(_ wanted: String) throws {
    guard mode == wanted else {
      XCTFail("PROBE_MODE is \(mode.isEmpty ? "MISSING" : mode); this test requires \(wanted)")
      return
    }
  }

  /// Stable transaction identity: product + SKTestTransaction.identifier.
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
    guard mode == "establish" else { return }
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
    guard mode == "establish" else { return }
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
    guard mode == "verify" else { return }
    print("PROBE-MODE verify")
    // Identity retention is REQUIRED in verify mode: the ledger must be present.
    XCTAssertTrue(!expectedTx.isEmpty, "EXPECTED_TX (the establish ledger) is required in verify mode")
    let session = try makeSession()
    let kept = session.allTransactions()
    print("PROBE-KEPT-TX \(kept.count) [\(ledger(kept))]")
    XCTAssertTrue(kept.contains { $0.productIdentifier == Self.trialProduct },
                  "The Trial transaction is no longer kept; kept: \(ledger(kept))")
    XCTAssertTrue(kept.contains { $0.productIdentifier == Self.unlockProduct },
                  "The Unlock transaction is no longer kept; kept: \(ledger(kept))")
    let got = Set(ledger(kept).components(separatedBy: ","))
    let want = Set(expectedTx.components(separatedBy: ","))
    XCTAssertEqual(got, want, "Retained transaction identities differ from the establish ledger; got \(got), want \(want)")
    let app = XCUIApplication()
    let row = try readPurchaseRow(app)
    print("PROBE-PURCHASE-ROW-AFTER-OVERLAY \(row)")
    XCTAssertTrue(row.contains("Unlocked"), "The earlier purchases are no longer visible; read: '\(row)'")
  }
}
