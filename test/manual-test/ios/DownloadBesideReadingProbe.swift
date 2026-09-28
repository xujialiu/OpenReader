import XCTest

/// The Download drawer beside a Reading (#75), with real touches on an app that
/// is already running: nothing here terminates or launches it, and nothing
/// here plays or pauses the Reading. `download-drawer.sh` runs one method at a
/// time; between them the caller may scroll the drawer's list (the ring of a
/// chapter far down a long book is off screen) and pause the Reading.
final class DownloadBesideReadingProbe: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")

  func capture(_ name: String) {
    let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    shot.name = name; shot.lifetime = .keepAlways; add(shot)
  }
  func note(_ name: String, _ text: String) {
    let item = XCTAttachment(string: text)
    item.name = name; item.lifetime = .keepAlways; add(item)
  }
  func labelled(_ label: String) -> XCUIElementQuery {
    app.buttons.matching(NSPredicate(format: "label == %@", label))
  }
  /// The drawer's line above the list: the download's state.
  func stateLine() -> String {
    let lines = ["Downloading…", "Preparing selected chapter…", "Queued", "Interrupted · continues when available", "Needs attention"]
    return lines.first { app.staticTexts[$0].exists } ?? "(none of the known lines)"
  }

  /// Opens More actions › Download from the Reader.
  func testOpenDrawer() throws {
    app.activate()
    note("reading-before", "Pause exists: \(app.buttons["Pause"].exists); Show the player exists: \(app.buttons["Show the player"].exists)")
    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 10), "No More actions: is the Reader in front?")
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Download"].waitForExistence(timeout: 3))
    app.buttons["Download"].tap()
    XCTAssertTrue(app.buttons["Close Download"].waitForExistence(timeout: 5), "The Download drawer did not open")
    _ = app.staticTexts["Downloading…"].waitForExistence(timeout: 5)
    note("state-line", stateLine())
    capture("01-drawer-opened")
  }

  /// Reads the drawer as it is: its state line, its rings, and two screenshots
  /// three seconds apart, in which a ring being written should have moved;
  /// then closes it.
  func testReadDrawer() throws {
    app.activate()
    XCTAssertTrue(app.buttons["Close Download"].waitForExistence(timeout: 5), "The Download drawer is not open")
    let first = stateLine()
    let pausing = labelled("Pause download").count, resuming = labelled("Resume download").count
    capture("02-drawer-a")
    Thread.sleep(forTimeInterval: 3)
    capture("03-drawer-b")
    let second = stateLine()
    note("drawer", "state line: \(first) then \(second); rings on screen: \(pausing) Pause download, \(resuming) Resume download; Pause all: \(labelled("Pause all").count); Resume all: \(labelled("Resume all").count)")
    XCTAssertNotEqual(first, "Interrupted · continues when available")
    XCTAssertNotEqual(second, "Interrupted · continues when available")
    XCTAssertTrue(["Downloading…", "Preparing selected chapter…"].contains(first), "State line: \(first)")
    XCTAssertGreaterThan(pausing, 0, "No ring reads Pause download")
    app.buttons["Close Download"].tap()
  }

  /// A ring's pause, then Pause all and Resume all, with the Reading paused.
  /// Leaves the download paused by Pause all and the drawer closed.
  func testRingThenPauseAllAndResumeAll() throws {
    app.activate()
    XCTAssertTrue(app.buttons["Close Download"].waitForExistence(timeout: 5), "The Download drawer is not open")
    let ring = labelled("Pause download").allElementsBoundByIndex.first { $0.isHittable }
    let found = try XCTUnwrap(ring, "No hittable ring reads Pause download")
    let place = found.frame
    let at = { () -> XCUIElement? in
      self.app.buttons.allElementsBoundByIndex.first { $0.frame.midY.distance(to: place.midY).magnitude < 4 && $0.frame.midX.distance(to: place.midX).magnitude < 4 }
    }
    found.tap()
    XCTAssertTrue(until(3) { at()?.label == "Resume download" }, "The tapped ring did not turn to Resume download")
    let others = labelled("Pause download").count
    note("ring", "tapped the ring at y=\(place.midY); it reads \(at()?.label ?? "nothing"); \(others) other rings still read Pause download; Pause all: \(labelled("Pause all").count)")
    capture("04-ring-paused")
    XCTAssertTrue(labelled("Pause all").firstMatch.waitForExistence(timeout: 3), "Pause all is not offered while other chapters go on")
    labelled("Pause all").firstMatch.tap()
    XCTAssertTrue(labelled("Resume all").firstMatch.waitForExistence(timeout: 5), "Pause all did not turn to Resume all")
    XCTAssertTrue(until(3) { self.labelled("Pause download").count == 0 }, "A ring still reads Pause download after Pause all")
    capture("05-paused-all")
    labelled("Resume all").firstMatch.tap()
    XCTAssertTrue(labelled("Pause all").firstMatch.waitForExistence(timeout: 5), "Resume all did not turn to Pause all")
    XCTAssertTrue(until(3) { at()?.label == "Pause download" }, "Resume all did not resume the chapter its ring had paused")
    note("resume-all", "after Resume all: the tapped ring reads \(at()?.label ?? "nothing"); state line: \(stateLine())")
    capture("06-resumed-all")
    labelled("Pause all").firstMatch.tap()
    XCTAssertTrue(labelled("Resume all").firstMatch.waitForExistence(timeout: 5))
    capture("07-paused-all-again")
    app.buttons["Close Download"].tap()
  }

  func until(_ timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
    let end = Date().addingTimeInterval(timeout)
    repeat { if condition() { return true }; Thread.sleep(forTimeInterval: 0.1) } while Date() < end
    return condition()
  }
}
