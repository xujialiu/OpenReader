import ExpoModulesCore
import UIKit

public final class OpenReaderWindowModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenReaderWindow")
    View(WindowTraitsView.self) {
      Events("onVerticalBarChange")
    }
  }
}

/** A noninteractive observer inside the actual reader window. No global window lookup. */
final class WindowTraitsView: ExpoView {
  let onVerticalBarChange = EventDispatcher()
  private var lastEdge: String?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    isAccessibilityElement = false
#if canImport(UIKit, _version: 9127.0.85)
    if #available(iOS 27.1, *) {
      registerForTraitChanges(UITraitCollection.systemTraitsAffectingVerticalBarEdge) {
        (view: WindowTraitsView, _: UITraitCollection) in view.publish()
      }
    }
#endif
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil else { lastEdge = nil; return }
    // Native event props have been attached by the time this queued delivery runs.
    DispatchQueue.main.async { [weak self] in self?.publish() }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    publish()
  }

  private func publish() {
    guard window != nil else { return }
    let edge: String
#if canImport(UIKit, _version: 9127.0.85)
    if #available(iOS 27.1, *) {
      switch traitCollection.verticalBarEdge {
      case .leading: edge = "leading"
      case .trailing: edge = "trailing"
      default: edge = "none"
      }
    } else {
      edge = "none"
    }
#else
    edge = "none"
#endif
    guard edge != lastEdge else { return }
    lastEdge = edge
    onVerticalBarChange(["edge": edge])
  }
}
