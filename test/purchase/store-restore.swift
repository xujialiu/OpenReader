import Foundation
import StoreKit

// Run with the production classifier, without any App Store request:
// xcrun swiftc modules/open-reader-store/ios/StoreRestore.swift test/purchase/store-restore.swift -o /tmp/openreader-store-restore-test
// /tmp/openreader-store-restore-test
@main
struct StoreRestoreTest {
  static func main() async throws {
    let completed = try await StoreRestore.run {}
    precondition(completed == "restored")
    for error in [StoreKitError.userCancelled as Error, SKError(.paymentCancelled) as Error] {
      let outcome = try await StoreRestore.run { throw error }
      precondition(outcome == "cancelled")
    }
    let failures: [Error] = [
      StoreKitError.networkError(URLError(.notConnectedToInternet)),
      StoreKitError.networkError(URLError(.cancelled)),
      StoreKitError.unknown,
      NSError(domain: "NotAStoreKitCancellation", code: 1,
              userInfo: [NSLocalizedDescriptionKey: "Request Canceled"]),
    ]
    for error in failures {
      do {
        _ = try await StoreRestore.run { throw error }
        fatalError("A failed restore was mistaken for a completion or cancellation")
      } catch {
        // The production operation still rejects. Message text is never classified.
      }
    }
    print("StoreRestore: 7 cases passed; no StoreKit request made")
  }
}
