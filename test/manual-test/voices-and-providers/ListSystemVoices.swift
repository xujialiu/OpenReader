// Lists every voice AVSpeechSynthesisVoice.speechVoices() offers, one per line:
// language, name, quality, gender, traits (novelty/personal), identifier.
// A plain executable, not an XCTest probe; recipe in system-voices.md.
import AVFoundation
import Foundation

let voices = AVSpeechSynthesisVoice.speechVoices()
func q(_ v: AVSpeechSynthesisVoice) -> String {
  switch v.quality { case .default: return "default"; case .enhanced: return "enhanced"; case .premium: return "premium"; @unknown default: return "q\(v.quality.rawValue)" }
}
func g(_ v: AVSpeechSynthesisVoice) -> String {
  switch v.gender { case .male: return "male"; case .female: return "female"; case .unspecified: return "unspecified"; @unknown default: return "g" }
}
for v in voices.sorted(by: { ($0.language, $0.name) < ($1.language, $1.name) }) {
  var traits: [String] = []
  if v.voiceTraits.contains(.isNoveltyVoice) { traits.append("novelty") }
  if v.voiceTraits.contains(.isPersonalVoice) { traits.append("personal") }
  print([v.language, v.name, q(v), g(v), traits.joined(separator: "+"), v.identifier].joined(separator: "\t"))
}
FileHandle.standardError.write("TOTAL \(voices.count)\n".data(using: .utf8)!)
