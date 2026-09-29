// Writes one sentence through AVSpeechSynthesizer.write for a few voices and
// prints the buffer format, the frame count and every word marker as
// byteSampleOffset:text. Nothing is played. Recipe in system-voices.md.
import AVFoundation
import Foundation

let cases: [(String, String)] = [
  ("com.apple.voice.super-compact.en-US.Samantha", "The quick brown fox jumps over the lazy dog."),
  ("com.apple.voice.super-compact.en-GB.Daniel", "The quick brown fox jumps over the lazy dog."),
  ("com.apple.voice.super-compact.de-DE.Anna", "Der schnelle braune Fuchs springt über den faulen Hund."),
  ("com.apple.voice.super-compact.zh-CN.Tingting", "敏捷的棕色狐狸跳过了懒狗。"),
  ("com.apple.voice.super-compact.ja-JP.Kyoko", "素早い茶色の狐がのろまな犬を飛び越える。"),
  ("com.apple.speech.synthesis.voice.Fred", "The quick brown fox jumps over the lazy dog."),
  ("com.apple.speech.synthesis.voice.Albert", "The quick brown fox jumps over the lazy dog."),
]
let synth = AVSpeechSynthesizer()
for (id, text) in cases {
  guard let voice = AVSpeechSynthesisVoice(identifier: id) else { print("\(id)\tMISSING"); continue }
  let u = AVSpeechUtterance(string: text); u.voice = voice
  var frames: AVAudioFrameCount = 0; var fmt = ""; var done = false
  var marks: [String] = []
  synth.write(u, toBufferCallback: { buf in
    guard let pcm = buf as? AVAudioPCMBuffer else { return }
    if pcm.frameLength == 0 { done = true; return }
    frames += pcm.frameLength
    let f = pcm.format; fmt = "\(Int(f.sampleRate))Hz ch\(f.channelCount) \(f.commonFormat.rawValue)"
  }, toMarkerCallback: { ms in
    for m in ms where m.mark == .word {
      let r = Range(m.textRange, in: text).map { String(text[$0]) } ?? "?"
      marks.append("\(m.byteSampleOffset):\(r)")
    }
  })
  let deadline = Date().addingTimeInterval(15)
  while !done && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
  print("\(id)\tdone=\(done)\t\(fmt)\tframes=\(frames)\twordMarks=\(marks.count)\t\(marks.prefix(12).joined(separator: " "))")
}
