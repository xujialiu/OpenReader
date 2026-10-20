import Foundation

/// Host filesystem tests of the actual iOS replacement primitive; no copied model.
@main
struct AtomicFileTest {
  static func expectBytes(_ url: URL, _ expected: Data) throws {
    let actual = try Data(contentsOf: url)
    precondition(actual == expected, "unexpected bytes at \(url.lastPathComponent)")
  }

  static func main() throws {
    let manager = FileManager.default
    let root = manager.temporaryDirectory.appendingPathComponent("openreader-atomic-\(UUID().uuidString)")
    try manager.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? manager.removeItem(at: root) }
    let kept = root.appendingPathComponent("kept 文档.epub")
    let staged = root.appendingPathComponent("pending.epub")
    let old = Data("OLD EPUB".utf8)
    let new = Data("NEW EPUB".utf8)
    try old.write(to: kept)

    // The old Expo sequence removes `kept` before this missing-source failure.
    do {
      try replaceFileAtomically(source: staged.absoluteString, destination: kept.absoluteString)
      fatalError("a missing source must fail")
    } catch {
      try expectBytes(kept, old)
    }

    try new.write(to: staged)
    try replaceFileAtomically(source: staged.absoluteString, destination: kept.absoluteString)
    try expectBytes(kept, new)
    precondition(!manager.fileExists(atPath: staged.path))

    // Same path is a harmless no-op, not a remove followed by a failed copy.
    try replaceFileAtomically(source: kept.absoluteString, destination: kept.absoluteString)
    try expectBytes(kept, new)

    // First import / restoration of a missing kept file.
    try new.write(to: staged)
    let missing = root.appendingPathComponent("restored.epub")
    try replaceFileAtomically(source: staged.absoluteString, destination: missing.absoluteString)
    try expectBytes(missing, new)

    // A native refusal must preserve both files, not merely the destination.
    try new.write(to: staged)
    let directory = root.appendingPathComponent("not-a-file")
    try manager.createDirectory(at: directory, withIntermediateDirectories: true)
    let marker = directory.appendingPathComponent("marker")
    try old.write(to: marker)
    do {
      try replaceFileAtomically(source: staged.absoluteString, destination: directory.absoluteString)
      fatalError("a file cannot replace a directory")
    } catch {
      try expectBytes(marker, old)
      try expectBytes(staged, new)
    }

    do {
      try replaceFileAtomically(source: "https://example.invalid/source", destination: kept.absoluteString)
      fatalError("non-file URLs must be refused")
    } catch {
      try expectBytes(kept, new)
    }
    print("AtomicFile: 6 checks passed (real host filesystem, shared iOS source)")
  }
}
