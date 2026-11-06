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
// The probe's precondition checks (volume, readiness) come from run-probe.sh.
// The interaction's handler fires when it joins a hierarchy that provides
// hinge updates (Apple's UIHingeInteraction documentation), which is why
// adding it to the runner's root view answers at once.
final class DuoPoseProbe: XCTestCase {
  func testHingeState() {
    if #available(iOS 27.1, *) {
      let got = expectation(description: "hinge update")
      var line = "no hinge update within 8 s"
      DispatchQueue.main.async {
        let scenes = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
        let windows = scenes.flatMap({ $0.windows })
        guard let window = windows.first(where: { $0.isKeyWindow }) ?? windows.first else {
          line = "runner has no window"
          got.fulfill()
          return
        }
        let root = window.rootViewController?.view ?? window
        let interaction = UIHingeInteraction { _, update in
          guard let hinge = update.hinge else {
            line = "hinge null (no hinge on this hierarchy/device)"
            got.fulfill()
            return
          }
          let degrees = hinge.angle * 180 / Double.pi
          line = "hinge angle=\(String(format: "%.2f", hinge.angle)) rad (\(Int(degrees.rounded())) deg) status=\(hinge.status)"
          got.fulfill()
        }
        root.addInteraction(interaction)
        // keep the interaction alive past this closure
        objc_setAssociatedObject(window, "duoHingeProbe", interaction, .OBJC_ASSOCIATION_RETAIN)
      }
      wait(for: [got], timeout: 8)
      print("PROBE-HINGE \(line)")
    } else {
      print("PROBE-HINGE UIHingeInteraction needs iOS 27.1")
    }
    DispatchQueue.main.async {
      let screens = UIScreen.screens
      let parts = screens.map { screen in
        "bounds=\(screen.bounds) native=\(screen.nativeBounds) scale=\(screen.scale)"
      }
      print("PROBE-SCREENS count=\(screens.count) " + parts.joined(separator: " | "))
      print("PROBE-DEVICE idiom=\(UIDevice.current.userInterfaceIdiom.rawValue) orientation=\(UIDevice.current.orientation.rawValue)")
    }
    Thread.sleep(forTimeInterval: 0.5)
  }
}
