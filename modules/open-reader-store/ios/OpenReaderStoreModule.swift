import ExpoModulesCore
import StoreKit
import UIKit

/// StoreKit 2 for the Trial and the Unlock (#148, ADR 0075).
///
/// Thin on purpose: it asks StoreKit and reports what it said. What a
/// transaction means, how long the Trial lasts and what is locked are decided
/// in `src/purchase/`, where a test can reach them.
///
/// Only verified transactions count. An unverified one is passed over on its
/// own, so one bad transaction never empties a read of the others.
public final class OpenReaderStoreModule: Module {
  private var updates: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("OpenReaderStore")
    Events("transaction")

    // Apple asks for the listener from the start: a transaction that arrives
    // with no purchase waiting on it (Ask to Buy approved, a purchase on
    // another device, a refund) is otherwise never finished or seen.
    OnCreate {
      self.listen()
    }
    OnDestroy {
      self.updates?.cancel()
      self.updates = nil
    }

    AsyncFunction("products") { (ids: [String]) async throws -> [[String: Any]] in
      let products = try await Product.products(for: ids)
      return products.map { ["id": $0.id, "displayName": $0.displayName, "displayPrice": $0.displayPrice] }
    }

    // Carry verified provenance and the signed date back with the purchase itself.
    AsyncFunction("purchase") { (id: String) async throws -> [String: Any] in
      guard let product = try await Product.products(for: [id]).first else {
        throw Exception(name: "ProductMissing", description: "The App Store has no product \(id).")
      }
      switch try await OpenReaderStoreModule.buy(product) {
      case .success(let verification):
        guard case .verified(let transaction) = verification else {
          throw Exception(name: "Unverified", description: "The App Store's answer for \(id) could not be verified.")
        }
        await transaction.finish()
        return ["outcome": "purchased", "transaction": OpenReaderStoreModule.describe(transaction)]
      case .pending:
        return ["outcome": "pending"]
      case .userCancelled:
        return ["outcome": "cancelled"]
      @unknown default:
        return ["outcome": "cancelled"]
      }
    }

    AsyncFunction("snapshot") { (ids: [String]) async throws -> [String: Any] in
      let before = await OpenReaderStoreModule.appSource()
      var owned: [[String: Any]] = []
      var sources: [[String: String]] = []
      for await result in StoreKit.Transaction.currentEntitlements {
        guard case .verified(let transaction) = result,
              ids.contains(transaction.productID), transaction.revocationDate == nil else { continue }
        owned.append(OpenReaderStoreModule.describe(transaction))
        if let source = OpenReaderStoreModule.source(transaction.environment, transaction.appTransactionID),
           !sources.contains(source) { sources.append(source) }
      }
      var refunds: [StoreKit.Transaction] = []
      for id in ids {
        if case .verified(let transaction)? = await StoreKit.Transaction.latest(for: id), transaction.revocationDate != nil {
          refunds.append(transaction)
        }
      }
      let after = await OpenReaderStoreModule.appSource()
      guard sources.count <= 1, before == nil || after == nil || before == after else {
        throw Exception(name: "PurchaseSourceChanged", description: "The purchase source changed while it was being read. Try again.")
      }
      // A live entitlement is authoritative. With none, the verified app transaction
      // can still identify an empty read's source (including when an IAP is omitted).
      let app = after ?? before
      let source = sources.first ?? app
      if let live = sources.first, let app, live["environment"] != app["environment"] {
        throw Exception(name: "PurchaseSourceChanged", description: "The purchase and app environments do not agree. Try again.")
      }
      let revoked = refunds.filter {
        OpenReaderStoreModule.source($0.environment, $0.appTransactionID) == source
      }.map { $0.productID }
      return ["source": source as Any? ?? NSNull(), "owned": owned, "revoked": revoked]
    }

    // Keep cancellation typed before Expo turns thrown errors into descriptions (#164).
    AsyncFunction("sync") { () async throws -> String in
      try await StoreRestore.run { try await AppStore.sync() }
    }

    // For the Debug Log: production, sandbox or xcode.
    AsyncFunction("environment") { () async -> String in
      do {
        switch try await AppTransaction.shared {
        case .verified(let app): return app.environment.rawValue
        case .unverified(let app, _): return "unverified \(app.environment.rawValue)"
        }
      } catch {
        return "unavailable"
      }
    }
  }

  private func listen() {
    updates = Task.detached { [weak self] in
      for await result in StoreKit.Transaction.updates {
        guard case .verified(let transaction) = result else { continue }
        await transaction.finish()
        self?.sendEvent("transaction", OpenReaderStoreModule.describe(transaction))
      }
    }
  }

  /// From iOS 18.2 StoreKit wants the scene the sheet belongs to.
  @MainActor
  private static func buy(_ product: Product) async throws -> Product.PurchaseResult {
    if #available(iOS 18.2, *),
       let scene = UIApplication.shared.connectedScenes
         .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
      return try await product.purchase(confirmIn: scene)
    }
    return try await product.purchase()
  }

  private static func source(_ environment: AppStore.Environment, _ appTransactionID: String) -> [String: String]? {
    guard !appTransactionID.isEmpty else { return nil }
    let name: String
    switch environment {
    case .production: name = "production"
    case .sandbox: name = "sandbox"
    case .xcode: name = "xcode"
    default: return nil
    }
    return ["environment": name, "appTransactionId": appTransactionID]
  }

  private static func appSource() async -> [String: String]? {
    guard let result = try? await AppTransaction.shared,
          case .verified(let app) = result else { return nil }
    return source(app.environment, app.appTransactionID)
  }

  private static func describe(_ transaction: StoreKit.Transaction) -> [String: Any] {
    [
      "productId": transaction.productID,
      "purchaseDate": transaction.purchaseDate.timeIntervalSince1970 * 1000,
      "revoked": transaction.revocationDate != nil,
      "source": source(transaction.environment, transaction.appTransactionID) as Any? ?? NSNull(),
    ]
  }
}
