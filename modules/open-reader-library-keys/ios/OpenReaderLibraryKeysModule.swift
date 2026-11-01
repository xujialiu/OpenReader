import ExpoModulesCore
import UIKit

/**
 * Command-F and Escape on a Library or Folder page (#332, #339, ADR 0090).
 *
 * The page's JavaScript says which keys apply now; the navigation stack's
 * patched controller (`patches/react-native-screens+4.26.2.patch`) registers
 * them and scopes them to the top page with nothing presented over it and no
 * text being composed. It finds this view in that page by the two selectors
 * below, so their Objective-C names are the contract with the patch.
 */
public final class OpenReaderLibraryKeysModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenReaderLibraryKeys")
    View(LibraryKeysView.self) {
      Events("onKey")
      Prop("find") { (view: LibraryKeysView, on: Bool) in view.find = on }
      Prop("escape") { (view: LibraryKeysView, on: Bool) in view.escape = on }
    }
  }
}

/** Draws nothing and takes no touches; it only answers the page's key commands. */
final class LibraryKeysView: ExpoView {
  let onKey = EventDispatcher()
  var find = false
  var escape = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    isAccessibilityElement = false
    accessibilityElementsHidden = true
  }

  @objc(openReaderLibraryKeys)
  func openReaderLibraryKeys() -> [String] {
    (find ? ["find"] : []) + (escape ? ["escape"] : [])
  }

  @objc(openReaderPerformLibraryKey:)
  func openReaderPerformLibraryKey(_ key: String) {
    onKey(["key": key])
  }
}
