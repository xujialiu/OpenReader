import XCTest

/// Rename as the phone's alert over a Document's actions drawer (#117), with
/// real touches:
///
/// - The reader's menu keeps Appearance and has no Delete; the Library's has
///   Delete and no Appearance (#22).
/// - The alert rises over the drawer, whose menu is still mounted behind it
///   (the drawer keeps its height).
/// - The field starts with the current name, unselected.
/// - A blank name disables Save; typing enables it. Screenshots carry the
///   colours (the disabled Save must read grey, not amber — Q52).
/// - Cancel returns to the menu; Save renames and closes the drawer.
///
/// The original title is restored at the end of each method that renames, and
/// every clear is verified against the field's own value before the new name
/// is typed: an earlier run's delete keys were partly lost while the alert's
/// keyboard was still coming up, and one book left renamed. Never plays
/// anything. Run by `run-probe.sh` (kit README).
final class RenameProbe: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
  let title = "Shadow Slave — Chapters 1–250"
  let longTitle = "Shadow Slave — Chapters 1–250 of a Deliberately Very Long Name That Must Wrap"
  /// The title the Library row carries now: the original, a name a previous
  /// interrupted run left, or the long name this probe is mid-way through.
  var current = "Shadow Slave — Chapters 1–250"
  /// The alert the @expo/ui SwiftUI Alert presents as: an alert, or a sheet.
  var renameAlert: XCUIElement { app.alerts["Rename"].exists ? app.alerts["Rename"] : app.sheets["Rename"] }

  func capture(_ name: String) {
    let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    image.name = name; image.lifetime = .keepAlways; add(image)
  }

  func field() -> XCUIElement {
    let alert = renameAlert
    return alert.textFields.firstMatch.exists ? alert.textFields.firstMatch : alert.otherElements.firstMatch
  }

  /// The first book's ellipsis: Shadow Slave is the Library's first row, and a
  /// stray name from an interrupted run can be anything ("X" included).
  func actionsRow() -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Actions for '")).element(boundBy: 0)
  }

  func until(_ timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
    let end = Date().addingTimeInterval(timeout)
    repeat { if condition() { return true }; Thread.sleep(forTimeInterval: 0.2) } while Date() < end
    return condition()
  }

  /// Empties the alert's field, verifies it is empty, types `text`, and
  /// verifies that too. The caret goes where the field is tapped, so the tap
  /// is at its right edge — a tap at the centre leaves the caret mid-text,
  /// where backward deletes never empty the field, and the retried typing
  /// trips XCUITest's interruption monitor, which cancels the alert.
  func replaceFieldText(_ box: XCUIElement, with text: String) {
    XCTAssertTrue(box.waitForExistence(timeout: 5), "The alert has no field")
    box.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 8), "The alert's keyboard did not come up")
    box.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 80))
    let emptied = (box.value as? String) ?? ""
    // An empty field reads its placeholder.
    XCTAssertTrue(emptied.isEmpty || emptied == "Name", "The field did not empty (value \(emptied))")
    if !text.isEmpty {
      box.typeText(text)
      XCTAssertEqual((box.value as? String) ?? "", text, "The field does not hold the name typed")
    }
  }

  /// In an open actions drawer: rename through the alert to `new`, and wait
  /// for the drawer it sits on to close, which is what Save does.
  func renameTo(_ new: String) {
    XCTAssertTrue(app.buttons["Rename"].waitForExistence(timeout: 4), "The actions menu is not open")
    app.buttons["Rename"].tap()
    XCTAssertTrue(renameAlert.waitForExistence(timeout: 5), "Rename did not raise the alert")
    replaceFieldText(field(), with: new)
    let save = renameAlert.buttons["Save"]
    XCTAssertTrue(save.waitForExistence(timeout: 3), "The alert has no Save")
    save.tap()
    XCTAssertTrue(until(8) { !self.renameAlert.exists && !self.app.buttons["Rename"].exists },
                  "Save did not close the alert and the drawer")
    if new != title && new != longTitle { current = new }
  }

  /// Restores `title` through whatever actions drawer is open.
  func restoreTitleFromDrawer() {
    renameTo(title)
    current = title
  }

  /// From wherever a cold launch landed: to the Library's list of books.
  func toLibrary() {
    if actionsRow().waitForExistence(timeout: 3) { return }
    // State restoration can open the reader; leave it, drawer included.
    if app.buttons["Choose a Voice"].waitForExistence(timeout: 4) || app.buttons["More actions"].exists {
      if app.buttons["Rename"].exists {
        app.buttons["Back"].tap()
        _ = until(4) { !self.app.buttons["Rename"].exists }
      }
      app.buttons["Back"].tap()
    }
    XCTAssertTrue(actionsRow().waitForExistence(timeout: 10), "Neither the Library nor the reader came up")
  }

  /// Repairs a name a previous interrupted run left behind: opens the stray
  /// row's actions drawer and renames the book back to `title`. Leaves the
  /// Library showing the original row.
  func repairTitle() {
    let stray = actionsRow()
    XCTAssertTrue(stray.waitForExistence(timeout: 6), "Library row not found")
    stray.tap()
    XCTAssertTrue(app.buttons["Rename"].waitForExistence(timeout: 5), "The actions menu did not open")
    restoreTitleFromDrawer()
    current = title
    XCTAssertTrue(app.buttons["Actions for \(title)"].waitForExistence(timeout: 8), "The repaired row is missing")
  }

  /// Opens a Document's actions menu in the Library, repairing a name a
  /// previous interrupted run left behind.
  func openLibraryActions() {
    toLibrary()
    if !app.buttons["Actions for \(current)"].waitForExistence(timeout: 4) { repairTitle() }
    XCTAssertTrue(app.buttons["Actions for \(current)"].waitForExistence(timeout: 4), "The Library row's ellipsis is missing")
    app.buttons["Actions for \(current)"].tap()
    XCTAssertTrue(app.buttons["Rename"].waitForExistence(timeout: 5), "The actions menu did not open")
  }

  /// The reader: menu shape, the alert over the drawer, blank disables Save,
  /// Cancel returns, Save renames and closes. Renames back.
  func testReaderRenameAlert() throws {
    app.terminate(); app.launch()
    toLibrary()
    // A previous interrupted run can have left the book under another name.
    if app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", current + ",")).firstMatch.exists == false { repairTitle() }
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", current + ",")).firstMatch.tap()
    XCTAssertTrue(app.buttons["Choose a Voice"].waitForExistence(timeout: 20), "Reader did not open")

    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 15), "No More actions: is the Reader in front?")
    app.buttons["More actions"].tap()
    XCTAssertTrue(app.buttons["Rename"].waitForExistence(timeout: 5), "The actions menu did not open")
    XCTAssertTrue(app.buttons["Appearance"].exists, "The reader's menu keeps Appearance")
    XCTAssertTrue(app.buttons["Download"].exists)
    XCTAssertFalse(app.buttons["Delete"].exists, "The reader's menu must not offer Delete")
    XCTAssertTrue(app.buttons["Share"].exists, "The menu keeps Share at its right")
    capture("reader-menu-light")

    app.buttons["Rename"].tap()
    XCTAssertTrue(renameAlert.waitForExistence(timeout: 5), "Rename did not raise the alert")
    XCTAssertTrue(app.buttons["Rename"].exists, "The drawer's menu is gone under the alert")
    let box = field()
    XCTAssertTrue(box.waitForExistence(timeout: 5))
    XCTAssertEqual((box.value as? String) ?? "", current, "The field does not start with the current name")
    let save = renameAlert.buttons["Save"]
    XCTAssertTrue(save.waitForExistence(timeout: 3))
    XCTAssertTrue(save.isEnabled, "Save is disabled with the current name in the field")
    capture("rename-alert-prefilled")

    box.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 8), "The alert's keyboard did not come up")
    box.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 80))
    let emptied = (box.value as? String) ?? ""
    // An empty field reads its placeholder.
    XCTAssertTrue(emptied.isEmpty || emptied == "Name", "The field did not empty (value \(emptied))")
    XCTAssertFalse(save.isEnabled, "Save is enabled while the name is blank")
    capture("rename-alert-blank-save-disabled")

    box.typeText("X")
    XCTAssertTrue(save.isEnabled, "Typing did not enable Save")
    XCTAssertEqual((box.value as? String) ?? "", "X")
    capture("rename-alert-typed-save-enabled")

    // The alert's buttons answer a touch pair and not a quick tap (#109), and
    // the point that hits Cancel is the frame the tree carries — XCUITest's
    // element tap and element press both resolve points that miss. Measured
    // with axe touches: (127, 359) closes Cancel under the keyboard, (127,
    // 506) without it; the drawn capsule sits ~86 pt above the first.
    let cancelPoint = app.keyboards.firstMatch.exists
      ? CGVector(dx: 127.0 / 402.0, dy: 359.0 / 874.0)
      : CGVector(dx: 127.0 / 402.0, dy: 506.0 / 874.0)
    app.coordinate(withNormalizedOffset: cancelPoint).press(forDuration: 0.2)
    // A dismissed alert can linger in the accessibility tree as a remnant
    // (pitfalls, the tree after a close); capture the screen if it lingers here.
    var gone = false
    for poll in 0..<20 {
      if !renameAlert.exists { gone = true; break }
      if poll == 10 { capture("cancel-dismiss-still-listed") }
      Thread.sleep(forTimeInterval: 0.5)
    }
    XCTAssertTrue(gone, "Cancel did not put the alert away")
    XCTAssertTrue(app.buttons["Rename"].waitForExistence(timeout: 3), "Cancel did not return to the menu")

    renameTo("X")
    XCTAssertFalse(app.buttons["Rename"].exists, "Save did not close the drawer")
    XCTAssertTrue(app.staticTexts["X"].waitForExistence(timeout: 5), "The reader's title did not become the new name")
    capture("reader-renamed-closed")

    XCTAssertTrue(app.buttons["More actions"].waitForExistence(timeout: 8))
    app.buttons["More actions"].tap()
    renameTo(title)
    XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 5), "The title was not restored")
  }

  /// The Library: Delete in the menu, no Appearance, the alert rename, and the
  /// long name wrapping in the menu's header. Renames back.
  func testLibraryRenameAndWrappedHeader() throws {
    app.terminate(); app.launch()
    openLibraryActions()
    XCTAssertTrue(app.buttons["Delete"].exists, "The Library's menu must offer Delete")
    XCTAssertFalse(app.buttons["Appearance"].exists, "#22: the Library's menu offers no Appearance")
    XCTAssertTrue(app.buttons["Share"].exists, "Share is offered wherever the drawer is")
    capture("library-menu-light")

    renameTo(longTitle)
    current = longTitle
    let longRow = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", longTitle + ",")).firstMatch
    XCTAssertTrue(longRow.waitForExistence(timeout: 8), "The renamed Library row did not appear")
    capture("library-renamed-row")

    openLibraryActions()
    // The menu's header now carries the long name, over two lines.
    let header = app.staticTexts[longTitle].firstMatch
    XCTAssertTrue(header.waitForExistence(timeout: 4), "The menu header does not show the long name")
    XCTAssertGreaterThan(header.frame.height, 30, "The long name did not wrap to two lines: \(header.frame)")
    capture("library-header-wrapped")

    restoreTitleFromDrawer()
    let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title + ",")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 8), "The title was not restored")
    current = title
  }
}
