import Darwin
import Foundation

/// Commit a completed, app-owned staging file without first removing the kept file.
/// Both URLs must be on the same filesystem: rename(2) refuses EXDEV rather than
/// falling back to a copy that could leave the destination partial (#261).
func replaceFileAtomically(source: String, destination: String) throws {
  guard let from = URL(string: source), from.isFileURL,
        let to = URL(string: destination), to.isFileURL else {
    throw CocoaError(.fileWriteInvalidFileName)
  }
  try from.withUnsafeFileSystemRepresentation { sourcePath in
    guard let sourcePath else { throw CocoaError(.fileWriteInvalidFileName) }
    try to.withUnsafeFileSystemRepresentation { destinationPath in
      guard let destinationPath else { throw CocoaError(.fileWriteInvalidFileName) }
      if Darwin.rename(sourcePath, destinationPath) != 0 {
        let code = errno
        throw NSError(domain: NSPOSIXErrorDomain, code: Int(code))
      }
    }
  }
}
