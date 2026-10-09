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

    // purchased, pending (Ask to Buy) or cancelled. A verified purchase is
    // finished here; its entitlement is read back with `entitlements`.
    AsyncFunction("purchase") { (id: String) async throws -> String in
      guard let product = try await Product.products(for: [id]).first else {
        throw Exception(name: "ProductMissing", description: "The App Store has no product \(id).")
      }
      switch try await OpenReaderStoreModule.buy(product) {
      case .success(let verification):
        guard case .verified(let transaction) = verification else {
          throw Exception(name: "Unverified", description: "The App Store's answer for \(id) could not be verified.")
        }
        await transaction.finish()
        return "purchased"
      case .pending:
        return "pending"
      case .userCancelled:
        return "cancelled"
      @unknown default:
        return "cancelled"
      }
    }

    // What the person owns now: verified, not revoked. Purchase dates in
    // milliseconds since 1970, as JavaScript counts them.
    AsyncFunction("entitlements") { () async -> [[String: Any]] in
      var owned: [[String: Any]] = []
      for await result in StoreKit.Transaction.currentEntitlements {
        guard case .verified(let transaction) = result, transaction.revocationDate == nil else { continue }
        owned.append([
          "productId": transaction.productID,
          "purchaseDate": transaction.purchaseDate.timeIntervalSince1970 * 1000,
        ])
      }
      return owned
    }

    // The products whose latest verified transaction was revoked (a refund),
    // so that a revocation that happened while the app was closed is seen.
    AsyncFunction("revoked") { (ids: [String]) async -> [String] in
      var revoked: [String] = []
      for id in ids {
        if case .verified(let transaction)? = await StoreKit.Transaction.latest(for: id), transaction.revocationDate != nil {
          revoked.append(id)
        }
      }
      return revoked
    }

    // Restore Purchase. It may ask the person to sign in.
    AsyncFunction("sync") { () async throws in
      try await AppStore.sync()
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

  private static func describe(_ transaction: StoreKit.Transaction) -> [String: Any?] {
    [
      "productId": transaction.productID,
      "purchaseDate": transaction.purchaseDate.timeIntervalSince1970 * 1000,
      "revoked": transaction.revocationDate != nil,
    ]
  }
}
