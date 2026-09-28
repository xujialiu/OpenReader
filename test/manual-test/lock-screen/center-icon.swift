import AppKit

// A narrow visual regression check for the dark lock-screen card measured on
// 2026-09-20. This is not a general icon detector: a bright wallpaper can confound
// it. Always inspect the screenshot alongside the accessibility attachment.
guard CommandLine.arguments.count == 3 else {
  fputs("Usage: swift center-icon.swift SCREENSHOT_PNG CENTER_BUTTON_JSON\n", stderr)
  exit(2)
}
let image = NSBitmapImageRep(data: try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))!
let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
let geometry = try JSONSerialization.jsonObject(with: data) as! [String: Any]
func number(_ key: String) -> Double { (geometry[key] as! NSNumber).doubleValue }
let scale = Double(image.pixelsWide) / number("screenWidth")
let x0 = Int(number("x") * scale), y0 = Int(number("y") * scale)
let x1 = Int((number("x") + number("width")) * scale)
let y1 = Int((number("y") + number("height")) * scale)
guard x0 >= 0 && y0 >= 0 && x1 <= image.pixelsWide && y1 <= image.pixelsHigh && x1 > x0 && y1 > y0 else {
  fputs("Button rectangle is outside the screenshot\n", stderr); exit(2)
}
var bright = 0, maximum = 0.0
for y in y0..<y1 { for x in x0..<x1 {
  let color = image.colorAt(x: x, y: y)!.usingColorSpace(.deviceRGB)!
  let value = min(color.redComponent, color.greenComponent, color.blueComponent)
  maximum = max(maximum, value)
  if value > 195.0 / 255 { bright += 1 }
}}
print("center icon: bright pixels=\(bright), max=\(maximum), \(bright > 10 ? "PASS" : "FAIL")")
exit(bright > 10 ? 0 : 1)
