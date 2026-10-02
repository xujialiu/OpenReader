import Foundation
import Vision
import ImageIO
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["en-US"]
try VNImageRequestHandler(url: url).perform([request])
let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
print(text)
for expected in CommandLine.arguments.dropFirst(2) {
  if !text.contains(expected) { print("FAIL: visible text missing: \(expected)"); exit(1) }
}
print("PASS: required visible text found")
