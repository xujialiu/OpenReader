import ExpoModulesCore
import os

/// ADR 0054. Each Debug Log line also goes to the system log at the default
/// level, which the phone keeps (INFO, where React Native's console lines
/// go, is held only while a stream is attached), so that a collected archive
/// lines the app's lines up with WebKit's and UIKit's. Public, because a
/// private argument is collected as `<private>`.
public final class OpenReaderDebugLogModule: Module {
  private let logger = Logger(subsystem: "top.xujialiu.openreader", category: "debug-log")

  public func definition() -> ModuleDefinition {
    Name("OpenReaderDebugLog")
    Constant("nativeVersion") { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "" }
    Constant("nativeBuild") { Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "" }
    Function("systemLog") { (line: String) in
      self.logger.notice("\(line, privacy: .public)")
    }
  }
}
