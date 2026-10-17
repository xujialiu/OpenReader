import StoreKit

/// Classify while the errors still have their StoreKit types, before the Expo bridge.
/// Keeping the operation injectable lets the same code be checked without signing in.
enum StoreRestore {
  static func run(_ sync: () async throws -> Void) async throws -> String {
    do {
      try await sync()
      return "restored"
    } catch StoreKitError.userCancelled {
      return "cancelled"
    } catch let error as SKError where error.code == .paymentCancelled {
      return "cancelled"
    }
  }
}
