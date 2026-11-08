import XCTest

/// Credential setup only. Native log privacy must be qualified with the public
/// sentinel before the caller authorizes the real-input method; see the guide.
final class FishKeyEntryProbe: XCTestCase {
  private let attemptPath = "/tmp/openreader-fish-key-entry-duo-8437-attempt-01"
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
    try require(app.textFields.matching(identifier: "API key").count == 0,
                "Revealed API key field refused")
    let fields = app.secureTextFields.matching(identifier: "API key")
    try require(fields.count == 1, "One secure API key field required")
    let field = fields.firstMatch
    try require(field.isEnabled && field.isHittable, "Secure API key field must be editable")
    try require(field.placeholderValue == "Not set", "Expected API key placeholder required")
    return field
  }

  // Compare internally; never pass the field's value to an assertion or log.
  private func isEmpty(_ field: XCUIElement) throws -> Bool {
    guard let value = field.value as? String, !value.isEmpty else {
      try require(false, "Secure API key state is unavailable")
      return false
    }
    return value == "Not set"
  }

  func testPublicSentinelIntoEmptyAndClearOwn() throws {
    try requireMode("public-sentinel-originally-absent")
    let input = try readPrivateInput()
    try require(input == publicSentinel, "Public sentinel input required")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    let field = try disabledFishField(app)
    try require(isEmpty(field), "Empty secure API key field required")
    field.tap()
    field.typeText(input)
    _ = try disabledFishField(app)
    try require(!isEmpty(field), "Public sentinel entry was not observed")
    // Only this method's own public input, typed from empty with no intervening
    // navigation or retap. The deletion count is NOT a masked AX value's length.
    field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: publicSentinel.count))
    _ = try disabledFishField(app)
    try require(isEmpty(field), "Own public sentinel did not clear to the placeholder")
  }

  func testPrivateInputIntoEmpty() throws {
    try requireMode("real-input-privacy-qualified")
    let input = try readPrivateInput()
    try require(input != publicSentinel, "Real input must replace the staged public sentinel")
    let app = XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")
    let field = try disabledFishField(app)
    try require(isEmpty(field), "Empty secure API key field required")
    field.tap()
    field.typeText(input)
    _ = try disabledFishField(app)
    try require(!isEmpty(field), "Private input entry was not observed")
  }
}
