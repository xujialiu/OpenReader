// DEBUG-lp74: temporary diagnostics for issue #74. Remove with the fix.
import ExpoModulesCore
import os

public final class OpenReaderDebugLp74Module: Module {
  private static let logger = Logger(subsystem: "top.xujialiu.openreader.lp74", category: "js")

  public func definition() -> ModuleDefinition {
    Name("OpenReaderDebugLp74")
    OnCreate {
      // The Objective-C half installs itself from +load; this is the fallback
      // should the linker have dropped that class. Installing is idempotent.
      if let hooks = NSClassFromString("ORDebugLp74Hooks") as AnyObject? {
        _ = hooks.perform(NSSelectorFromString("install"))
      }
    }
    Function("mark") { (line: String) in
      Self.logger.notice("[DEBUG-lp74] js \(line, privacy: .public)")
    }
  }
}
