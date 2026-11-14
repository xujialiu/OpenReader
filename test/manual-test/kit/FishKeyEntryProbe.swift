import XCTest

// HOST-TESTABLE CLASSIFIER — exact block begin; extracted verbatim by
// test/manual-test/duo-verification/fish-classifier-red-green.sh. Keep this
// block free of XCTest and every other framework symbol so the same text
// compiles unchanged on the host.
/// Classifier for one accessibility read of the masked API key field.
///
/// Pure over the raw `XCUIElement.value` (taken as `Any?`): no app, no
/// logging, no assertion and no Keychain on this path. It classifies the READ
/// only and is never evidence of what the Keychain holds; original credential
/// presence is the caller's independent gate, where unknown, held and refused
/// are not absence.
///
/// - `.unavailable`: nil, or a value that is not a String — the read says
///   nothing usable and every caller must stop before a tap or typing.
/// - `.empty`: an actual String with no characters, including the legacy
///   placeholder String "Not set" this runtime reports for an empty field.
/// - `.nonempty`: any other actual String — observed content, never logged.
enum FishKeyEntryFieldRead: Equatable {
  case empty
  case nonempty
  case unavailable
}

func classifyFishKeyEntryFieldValue(_ raw: Any?) -> FishKeyEntryFieldRead {
  guard let text = raw as? String else { return .unavailable }
  return text.isEmpty || text == "Not set" ? .empty : .nonempty
}
// HOST-TESTABLE CLASSIFIER — exact block end

/// Credential setup only. Native log privacy must be qualified with the public
/// sentinel before the caller authorizes the real-input method; see the guide.
final class FishKeyEntryProbe: XCTestCase {
  private let attemptPath = "/tmp/openreader-fish-key-entry-duo-8437-attempt-02"
  private let publicSentinel = "OPENREADER_PUBLIC_FISH_SENTINEL_8437"

  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  private func require(_ condition: Bool, _ message: String) throws {
    guard condition else {
      XCTFail(message)
      throw NSError(domain: "FishKeyEntryProbe", code: 1, userInfo: nil)
    }
  }

  private func requireMode(_ mode: String) throws {
    try require(Bundle(for: Self.self).object(forInfoDictionaryKey: "ManualMode") as? String == mode,
                "Explicit credential setup mode required")
  }

  private func readPrivateInput() throws -> String {
    let path = attemptPath + "/fish-api-key.txt"
    let files = FileManager.default
    guard let parent = try? files.attributesOfItem(atPath: attemptPath),
          parent[.type] as? FileAttributeType == .typeDirectory,
          (parent[.posixPermissions] as? NSNumber)?.intValue == 0o700,
          let file = try? files.attributesOfItem(atPath: path),
          file[.type] as? FileAttributeType == .typeRegular,
          (file[.posixPermissions] as? NSNumber)?.intValue == 0o600,
          (file[.referenceCount] as? NSNumber)?.intValue == 1 else {
      try require(false, "Private input file or directory is unavailable or unsafe")
      return ""
    }
    try require((file[.size] as? NSNumber).map { $0.intValue <= 512 } == true,
                "Private input length is invalid")
    guard let input = try? String(contentsOfFile: path, encoding: .utf8) else {
      try require(false, "Private input file is unreadable")
      return ""
    }
    try require(!input.isEmpty, "Private input is empty")
    try require(input.utf8.count <= 512, "Private input length is invalid")
    try require(input.unicodeScalars.allSatisfy { (33...126).contains(Int($0.value)) },
                "Private input contains unsupported characters")
    return input
  }

  private func disabledFishField(_ app: XCUIApplication) throws -> XCUIElement {
    try require(app.wait(for: .runningForeground, timeout: 3), "OpenReader must already be running in front")
    let switches = app.switches.matching(identifier: "Enable Fish Audio")
    try require(switches.count == 1, "Disabled Fish Audio screen required")
    let enabled = switches.firstMatch
    try require(enabled.isEnabled && (enabled.value as? String) == "0",
                "Fish Audio must be disabled and idle")
    try require(!app.staticTexts["Turn off to edit."].exists && !app.staticTexts["Testing…"].exists,
                "Fish Audio must be disabled and idle")
    // A footnote here means the credential read or save failed; the field state
    // is then untrustworthy and the caller must stop before tap or typing.
    try require(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "API key: ")).count == 0,
                "API key error footnote present")
    try require(app.textFields.matching(identifier: "API key").count == 0,
                "Revealed API key field refused")
    let fields = app.secureTextFields.matching(identifier: "API key")
    try require(fields.count == 1, "One secure API key field required")
    let field = fields.firstMatch
    try require(field.isEnabled && field.isHittable, "Secure API key field must be editable")
    try require(field.placeholderValue == "Not set", "Expected API key placeholder required")
    return field
  }

  // One classified read of the field. This classifies this accessibility read
  // only; it is not a Keychain presence claim, and its content is never logged
  // or asserted. Nil and non-String fail closed here, before any input.
  private func classifiedRead(_ field: XCUIElement) throws -> FishKeyEntryFieldRead {
    let read = classifyFishKeyEntryFieldValue(field.value)
    guard read != .unavailable else {
      try require(false, "Secure API key state is unavailable")
      return read
    }
    return read
  }

  // Requires an empty read. Observed content is a stop, never a clearance.
  private func requireEmpty(_ field: XCUIElement, _ message: String) throws {
    let read = try classifiedRead(field)
    guard read == .empty else {
      try require(false, message)
      return
    }
  }

  // Requires observed content from this read, as a boolean, never its value.
  private func requireContent(_ field: XCUIElement, _ message: String) throws {
    let read = try classifiedRead(field)
    guard read == .nonempty else {
      try require(false, message)
      return
    }
  }

  func testPublicSentinelIntoEmptyAndClearOwn() throws {
    try requireMode("public-sentinel-originally-absent")
    let input = try readPrivateInput()
    try require(input == publicSentinel, "Public sentinel input required")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    let field = try disabledFishField(app)
    try requireEmpty(field, "Empty secure API key field required")
    field.tap()
    field.typeText(input)
    _ = try disabledFishField(app)
    try requireContent(field, "Public sentinel entry was not observed")
    // Only this method's own public input, typed from empty with no intervening
    // navigation or retap. The deletion count is NOT a masked AX value's length.
    field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: publicSentinel.count))
    _ = try disabledFishField(app)
    try requireEmpty(field, "Own public sentinel did not clear to the placeholder")
  }

  func testPrivateInputIntoEmpty() throws {
    try requireMode("real-input-privacy-qualified")
    let input = try readPrivateInput()
    try require(input != publicSentinel, "Real input must replace the staged public sentinel")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    let field = try disabledFishField(app)
    try requireEmpty(field, "Empty secure API key field required")
    field.tap()
    field.typeText(input)
    _ = try disabledFishField(app)
    try requireContent(field, "Private input entry was not observed")
  }
}
