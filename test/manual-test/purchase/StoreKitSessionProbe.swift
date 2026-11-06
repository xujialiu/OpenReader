import XCTest
import StoreKitTest

/// GENUINE local StoreKit transactions against `storekit/OpenReader.storekit`
/// (WWDC2020/10659 arrangement: SKTestSession in an XCTest), read back through
/// the installed FORMAL app's own Settings Purchase row.
///
/// test01 buys the 30-day Trial through SKTestSession.buyProduct with dialogs
/// disabled, then launches the formal app and REQUIRES the Purchase row to show
/// the Trial's days left — that is the proof the runner-process session reaches
/// the app (the environment is "genuinely established", not assumed).
/// test02 buys the Unlock and requires the row to read 'Unlocked' with BOTH
/// transactions kept. test03 re-opens the same configuration WITHOUT buying
/// (the overlay-retention run) and requires BOTH earlier transactions still
/// kept and the row still 'Unlocked' — an unrelated unlock would not count.
final class StoreKitSessionProbe: XCTestCase {

  static let trialProduct = "top.xujialiu.openreader.trial"
  static let unlockProduct = "top.xujialiu.openreader.unlock"

  /// `TEST_RUNNER_PROBE_MODE=establish` runs the buying tests; `verify` runs
  /// only the no-purchase retention test. xcodebuild forwards caller
  /// environment to the runner only with the TEST_RUNNER_ prefix.
  private var mode: String { ProcessInfo.processInfo.environment["TEST_RUNNER_PROBE_MODE"] ?? "establish" }
  private func require(_ wanted: String) throws {
    if mode != wanted { throw XCTSkip("probe mode is \(mode); this test runs in \(wanted) mode only") }
  }

  /// `OpenReader.storekit` is added to the target as a resource by
  /// project-storekit.rb.
  private func makeSession() throws -> SKTestSession {
    let url = Bundle(for: StoreKitSessionProbe.self).url(forResource: "OpenReader", withExtension: "storekit")
    let unwrapped = try XCTUnwrap(url, "OpenReader.storekit resource missing from the probe bundle")
    return try SKTestSession(contentsOf: unwrapped)
  }

  @MainActor
  private func shoot(_ app: XCUIApplication, name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.lifetime = .keepAlways
    attachment.name = name
    add(attachment)
  }

  /// Launches the formal app, opens Settings, and reads the Purchase row.
  /// Returns the row's own value if it carries one, else the visible value text.
  @MainActor
  private func readPurchaseRow(_ app: XCUIApplication) throws -> String {
    let settings = app.buttons["Settings"]
    XCTAssertTrue(settings.waitForExistence(timeout: 25), "Settings button not found on the Library")
    settings.tap()
    // The Purchase row renders as a Button (AX tree 2026-11-06: "Button | Purchase"),
    // not a StaticText — query any element kind.
    let purchase = app.descendants(matching: .any).matching(identifier: "Purchase").firstMatch
    let appeared = purchase.waitForExistence(timeout: 20)
    if !appeared {
      shoot(app, name: "purchase-row-missing")
    }
    XCTAssertTrue(appeared, "Purchase row not found in Settings (a formal-role app is required)")
    let rowValue = (purchase.value as? String) ?? ""
    var seen = rowValue
    if seen.isEmpty {
      let candidates = app.descendants(matching: .any).matching(NSPredicate(
        format: "label == 'Trial ended' OR label == 'Unlocked' OR label == 'Unavailable' OR (label CONTAINS 'day' AND label CONTAINS 'left')"))
      if candidates.count > 0 && candidates.firstMatch.exists {
        seen = candidates.firstMatch.label
      }
    }
    shoot(app, name: "purchase-row")
    return seen
  }

  /// Explicit Objective-C names: this Xcode bridges Swift `throws` test
  /// methods as `…AndReturnError:`, which breaks `-only-testing` filters that
  /// name the Swift name (2026-11-06: a run selected 0 tests that way). The
  /// bare `@objc(name)` also refuses to compile on a throwing method — the
  /// selector must carry `AndReturnError:` for the bridged error parameter.
  @MainActor
  @objc(test01BuyTrialAndReturnError:)
  func test01BuyTrialThroughStoreKitTestSessionAndSeeItInSettings() throws {
    try require("establish")
    let session = try makeSession()
    session.disableDialogs = true
    session.clearTransactions()
    let before = session.allTransactions()
    print("PROBE-TRANSACTIONS-BEFORE \(before.count) \(before.map { $0.productIdentifier })")
    try session.buyProduct(productIdentifier: Self.trialProduct)
    let after = session.allTransactions()
    print("PROBE-TRANSACTIONS-AFTER \(after.count) \(after.map { $0.productIdentifier })")
    XCTAssertTrue(after.contains { $0.productIdentifier == Self.trialProduct },
                  "buyProduct produced no StoreKitTest transaction for the Trial product")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.launch()
    let row = try readPurchaseRow(app)
    print("PROBE-PURCHASE-ROW \(row)")
    XCTAssertTrue(row.contains("day") && row.contains("left"),
                  "Purchase row did not show the Trial's days left; read: '\(row)'")
  }

  @MainActor
  @objc(test02BuyUnlockAndReturnError:)
  func test02BuyUnlockAndSeeUnlocked() throws {
    // An existing Unlock buyer is its own access state: the row must read
    // 'Unlocked' (the Unlock outranks a running Trial), and both transactions
    // stay kept for the overlay-retention check.
    try require("establish")
    let session = try makeSession()
    session.disableDialogs = true
    try session.buyProduct(productIdentifier: Self.unlockProduct)
    let kept = session.allTransactions()
    print("PROBE-TRANSACTIONS-AFTER-UNLOCK \(kept.count) \(kept.map { $0.productIdentifier })")
    XCTAssertTrue(kept.contains { $0.productIdentifier == Self.unlockProduct }, "Unlock transaction missing")
    XCTAssertTrue(kept.contains { $0.productIdentifier == Self.trialProduct }, "Trial transaction no longer kept after the Unlock purchase")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.launch()
    let row = try readPurchaseRow(app)
    print("PROBE-PURCHASE-ROW-UNLOCK \(row)")
    XCTAssertTrue(row.contains("Unlocked"), "Purchase row did not read 'Unlocked' after buying the Unlock; read: '\(row)'")
  }

  @MainActor
  @objc(test03RetainedPurchasesAndReturnError:)
  func test03RetainedPurchasesVisibleWithoutANewPurchase() throws {
    try require("verify")
    // The SAME configuration, re-opened; nothing is bought here. The SAME
    // transaction (product id) the earlier test bought must still be kept by
    // the local StoreKitTest store and still visible in the app. An unrelated
    // 'Unlocked' row is NOT acceptance: the retained purchase must be the Trial.
    let session = try makeSession()
    let kept = session.allTransactions()
    print("PROBE-KEPT-TRANSACTIONS \(kept.count) \(kept.map { $0.productIdentifier })")
    XCTAssertTrue(kept.contains { $0.productIdentifier == Self.trialProduct },
                  "The Trial transaction bought earlier is no longer kept by the StoreKitTest store; kept: \(kept.map { $0.productIdentifier })")
    XCTAssertTrue(kept.contains { $0.productIdentifier == Self.unlockProduct },
                  "The Unlock transaction bought earlier is no longer kept by the StoreKitTest store; kept: \(kept.map { $0.productIdentifier })")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    app.launch()
    let row = try readPurchaseRow(app)
    print("PROBE-PURCHASE-ROW-AFTER-OVERLAY \(row)")
    XCTAssertTrue(row.contains("Unlocked") || (row.contains("day") && row.contains("left")),
                  "The earlier purchases are no longer visible in the app; read: '\(row)'")
    XCTAssertTrue(row.contains("Unlocked"),
                  "After buying the Unlock the row must read 'Unlocked' after the overlay; read: '\(row)'")
  }
}
