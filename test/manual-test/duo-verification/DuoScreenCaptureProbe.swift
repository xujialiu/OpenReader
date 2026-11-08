import XCTest

/// Attach-only capture helper for the owned Duo: captures ONLY the device's
/// own panels — XCUIScreen index 0 (outer LCD) and index 1 (inner display).
/// Any further screen (e.g. a Mac display appearing in XCUIScreen.screens) is
/// NOT captured, read or exported; the run log notes the skip as metadata
/// only. Privacy repair, beta18-three-testers task-1 continuation
/// (restricted-v2): the earlier all-screen loop also exported a 7680x4320
/// Mac display attachment. Attaches to the already-running OpenReader; no
/// interaction, never launches, never taps. The method name is unchanged so
/// existing -only-testing selections keep matching (zero-test stale product
/// guard, kit README).
///
///   bash test/manual-test/kit/run-probe.sh DuoScreenCaptureProbe SIMULATOR_UDID OUT_DIR \
///     -only-testing:DuoScreenCaptureProbe/testCaptureAllScreens -collect-test-diagnostics never
final class DuoScreenCaptureProbe: XCTestCase {

  /// Owned panels only. Deliberately not the full XCUIScreen.screens list.
  private static let ownedPanelIndexes: [Int] = [0, 1]

  func testCaptureAllScreens() {
    // restricted-v2 marker: the caller greps the fresh test log for this line
    // to prove the rebuilt restricted binary ran, never a stale cached one.
    print("[capture] restricted-v2 owned-panels-only started")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    guard app.state != .notRunning else {
      XCTFail("Attach-only probe refuses to launch a dead target")
      return
    }
    let screens = XCUIScreen.screens
    guard screens.count >= 2 else {
      XCTFail("Owned Duo panels unavailable: XCUIScreen.screens.count=\(screens.count), need 0 and 1")
      return
    }
    for index in Self.ownedPanelIndexes {
      let image = XCTAttachment(screenshot: screens[index].screenshot())
      image.name = "screen-\(index)"
      image.lifetime = .keepAlways
      add(image)
      print("[capture] screen \(index) captured")
    }
    if screens.count > Self.ownedPanelIndexes.count {
      // Metadata only: note the skipped non-owned display indexes, never capture
      // them or read their geometry (XCUIScreen exposes no safe bounds here).
      let skipped = (Self.ownedPanelIndexes.count..<screens.count).map(String.init).joined(separator: ",")
      print("[capture] skipped non-owned screens (metadata only, not captured): indexes \(skipped)")
    }
    print("[capture] restricted-v2 owned-panels-only done")
  }
}
