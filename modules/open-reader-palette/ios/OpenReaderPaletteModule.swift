import ExpoModulesCore
import UIKit

struct PaletteSelection: Record {
  @Field var color: String = "#000000ff"
  @Field var eventCount: Int = 0
}

public final class OpenReaderPaletteModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenReaderPalette")
    View(PaletteView.self) {
      Events("onSelectionChange")
      Prop("selection") { (view: PaletteView, selection: PaletteSelection) in view.select(selection) }
      Prop("scheme") { (view: PaletteView, scheme: String) in
        view.picker.overrideUserInterfaceStyle = scheme == "dark" ? .dark : .light
      }
    }
  }
}

/** Public UIKit containment only. No presenting sheet, private subviews or header cropping. */
final class PaletteView: ExpoView, UIColorPickerViewControllerDelegate {
  let picker = UIColorPickerViewController()
  let onSelectionChange = EventDispatcher()
  private var eventCount = 0
  private var lastColor = "#000000ff"

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    picker.title = ""
    picker.supportsAlpha = true
    if #available(iOS 26.0, *) { picker.supportsEyedropper = false }
    picker.selectedColor = .black
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      detach()
    } else {
      attach()
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // SwiftUI's RNHost can acquire its controller after didMoveToWindow.
    if window != nil, picker.parent == nil { attach() }
    picker.view.frame = bounds
  }

  private func attach() {
    guard picker.parent == nil else { return }
    var responder: UIResponder? = next
    while let current = responder {
      if let parent = current as? UIViewController {
        parent.addChild(picker)
        addSubview(picker.view)
        picker.view.frame = bounds
        picker.didMove(toParent: parent)
        picker.delegate = self
        return
      }
      responder = current.next
    }
  }

  private func detach() {
    picker.delegate = nil
    guard picker.parent != nil else { return }
    picker.willMove(toParent: nil)
    picker.view.removeFromSuperview()
    picker.removeFromParent()
  }

  func select(_ selection: PaletteSelection) {
    guard selection.eventCount >= eventCount,
          let color = Self.color(selection.color) else { return }
    let hex = Self.hex(color)
    guard hex != lastColor else { return }
    lastColor = hex
    // selectedColor does not ordinarily call the delegate; lastColor also
    // suppresses an echo if UIKit does notify on a programmatic update.
    picker.selectedColor = color
  }

  func colorPickerViewController(_ controller: UIColorPickerViewController, didSelect color: UIColor, continuously: Bool) {
    publish(color)
  }

  private func publish(_ color: UIColor) {
    let hex = Self.hex(color)
    guard hex != lastColor else { return }
    lastColor = hex
    eventCount += 1
    onSelectionChange(["color": hex, "eventCount": eventCount])
  }

  /** The bridge accepts only an explicit sRGB RGBA byte string. */
  private static func color(_ hex: String) -> UIColor? {
    guard hex.count == 9, hex.first == "#", let rgba = UInt32(hex.dropFirst(), radix: 16) else { return nil }
    return UIColor(red: CGFloat((rgba >> 24) & 255) / 255,
                   green: CGFloat((rgba >> 16) & 255) / 255,
                   blue: CGFloat((rgba >> 8) & 255) / 255,
                   alpha: CGFloat(rgba & 255) / 255)
  }

  private static func hex(_ color: UIColor) -> String {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    // getRed handles grey-space UIColors as well; never index CGColor.components
    // as RGBA because a grey-space colour has only white and alpha.
    color.getRed(&r, green: &g, blue: &b, alpha: &a)
    func byte(_ component: CGFloat) -> Int {
      guard component.isFinite else { return 0 }
      return Int((min(1, max(0, component)) * 255).rounded())
    }
    return String(format: "#%02x%02x%02x%02x", byte(r), byte(g), byte(b), byte(a))
  }
}
