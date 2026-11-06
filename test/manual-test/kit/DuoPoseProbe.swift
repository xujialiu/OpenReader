import UIKit
import XCTest

// Issue #346 checkpoint B: the iPhone Duo's hinge state, read through the
// system's own UIHingeInteraction (iOS 27.1+, and per the expo-hinge
// documentation the build must be made with Xcode 27.1 or later), plus the
// test runner's own UIScreen list. The runner is its own process on the
// device; the app under test is never attached or touched. Run it with the
// task-local Xcode 27.1 so the SDK carries the API:
//
//   DEVELOPER_DIR=/Applications/Xcode-27.1.0.app/Contents/Developer \
//     bash test/manual-test/kit/run-probe.sh DuoPoseProbe SIMULATOR_UDID OUT_DIR
//
// Test contract: a missing window or an out-of-range hinge observation is a
// FAILURE; no hinge on the hierarchy, an old OS, or a non-finite/unknown
// observation is a distinct XCTSkip; a real observation prints
// `PROBE-HINGE angle=<radians> status=<rawValue>` (0 unknown, 1 closed,
// 2 partiallyOpen, 3 fullyOpen per the SDK 27.1 UIHinge.h) and passes once.
// The interaction is removed from the view when the test ends.
final class DuoPoseProbe: XCTestCase {
  func testHingeState() throws {
    guard #available(iOS 27.1, *) else {
      throw XCTSkip("UIHingeInteraction needs iOS 27.1")
    }
    let scenes = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
    let windows = scenes.flatMap({ $0.windows })
    guard let window = windows.first(where: { $0.isKeyWindow }) ?? windows.first else {
      XCTFail("runner has no window to attach UIHingeInteraction to")
      return
    }
    let root = window.rootViewController?.view ?? window
    let got = expectation(description: "hinge update")
    var observation: String?
    var settled = false
    var interaction: UIHingeInteraction?
    DispatchQueue.main.async {
      let i = UIHingeInteraction { _, update in
        guard !settled else { return } // one observation per run
        guard let hinge = update.hinge else {
          observation = "hinge null (no hinge on this hierarchy/device)"
          settled = true
          got.fulfill()
          return
        }
        let status = hinge.status.rawValue
        guard hinge.angle.isFinite, (0...3).contains(status) else {
          observation = "invalid hinge observation angle=\(hinge.angle) status=\(status)"
          settled = true
          got.fulfill()
          return
        }
        observation = "hinge angle=\(String(format: "%.2f", hinge.angle)) rad status=\(status)"
        settled = true
        got.fulfill()
      }
      root.addInteraction(i)
      interaction = i
    }
    wait(for: [got], timeout: 8)
    DispatchQueue.main.async {
      if let i = interaction { root.removeInteraction(i) }
    }
    guard let out = observation else {
      XCTFail("no hinge observation recorded within 8 s")
      return
    }
    if out.contains("null") || out.contains("invalid") {
      throw XCTSkip("no usable hinge provided: \(out)")
    }
    print("PROBE-HINGE \(out)")
    let screensDone = expectation(description: "screen observation")
    DispatchQueue.main.async {
      let parts = UIScreen.screens.map { screen in
        "bounds=\(screen.bounds) native=\(screen.nativeBounds) scale=\(screen.scale)"
      }
      print("PROBE-SCREENS count=\(UIScreen.screens.count) " + parts.joined(separator: " | "))
      print("PROBE-DEVICE idiom=\(UIDevice.current.userInterfaceIdiom.rawValue) orientation=\(UIDevice.current.orientation.rawValue)")
      screensDone.fulfill()
    }
    wait(for: [screensDone], timeout: 5)
  }
}
