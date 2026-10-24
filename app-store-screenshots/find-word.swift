// Prints the centre of WORD in a screenshot, in pixels, as "x y" — found by
// the system's own text recognition, so the long-press for the Word Lookup
// shot lands on the word whatever the device's layout.
//
//   swift find-word.swift SCREENSHOT.png WORD
import AppKit
import Vision

let args = CommandLine.arguments
guard args.count == 3, let image = NSImage(contentsOfFile: args[1]),
      let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("usage: swift find-word.swift SCREENSHOT.png WORD\n".data(using: .utf8)!)
  exit(2)
}
let word = args[2]
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["en-US"]
try VNImageRequestHandler(cgImage: cg).perform([request])
/// The word in a reading of a line: the whole word, or else a word that starts
/// with its first six letters. The book's serif face is read wrongly at times
/// ("acknowledged" as "Lacknowleulged", the drop cap "I" glued on), and the
/// touch only needs to land on the word.
func wordRange(in text: String) -> Range<String.Index>? {
  if let whole = text.range(of: word, options: .caseInsensitive) { return whole }
  guard word.count > 6, let start = text.range(of: String(word.prefix(6)), options: .caseInsensitive) else { return nil }
  var end = start.upperBound
  while end < text.endIndex, text[end].isLetter { end = text.index(after: end) }
  return start.lowerBound..<end
}

for observation in request.results ?? [] {
  for candidate in observation.topCandidates(3) {
    guard let found = wordRange(in: candidate.string),
          let box = try? candidate.boundingBox(for: found) else { continue }
  // Vision's box is normalised with its origin at the bottom left.
    let rect = box.boundingBox
    let x = (rect.midX) * CGFloat(cg.width)
    // Across, the word's own box; down, the whole line's, which a misread word does not skew.
    let y = (1 - observation.boundingBox.midY) * CGFloat(cg.height)
    print("\(Int(x)) \(Int(y))")
    exit(0)
  }
}
exit(1)
