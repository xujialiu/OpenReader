// A small app for the owner's phone: lists every voice
// AVSpeechSynthesisVoice.speechVoices() offers there, then writes one sentence
// through AVSpeechSynthesizer.write for each voice and records the buffer
// format, the length, the time the synthesis took and every word marker.
// Nothing is played. Results go to the app's Documents (voices.tsv,
// summary.txt, markers.tsv, done.txt) and are shown on screen. Every English
// voice then writes a longer passage, introduced by its own name, to
// Documents/samples/*.wav, for listening on the Mac. A tap on a voice's row
// speaks that passage (or the voice's own-language sentence) on the phone.
// Built by system-voices-app.rb; recipe in system-voices.md.
import AVFoundation
import SwiftUI

let english = "The quick brown fox jumps over the lazy dog."
let sentences: [String: String] = [
  "en": english,
  "zh": "敏捷的棕色狐狸跳过了懒狗。",
  "ja": "素早い茶色の狐がのろまな犬を飛び越える。",
  "ko": "빠른 갈색 여우가 게으른 개를 뛰어넘는다.",
  "de": "Der schnelle braune Fuchs springt über den faulen Hund.",
  "fr": "Le rapide renard brun saute par-dessus le chien paresseux.",
  "es": "El rápido zorro marrón salta sobre el perro perezoso.",
  "ru": "Быстрая бурая лиса перепрыгивает через ленивую собаку.",
]
/// What a listener hears: a book's first lines, with an abbreviation and quotation marks in them.
let englishPassage = "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. \u{201C}My dear Mr. Bennet,\u{201D} said his lady to him one day, \u{201C}have you heard that Netherfield Park is let at last?\u{201D}"
let traditional = "敏捷的棕色狐狸跳過了懶狗。"
let cantonese = "敏捷嘅啡色狐狸跳過咗隻懶狗。"

/// The sentence for a voice's language, and whether it is in that language.
func sentence(for language: String) -> (String, Bool) {
  if language == "zh-TW" || language == "zh-HK" { return (traditional, true) }
  if language.hasPrefix("yue") { return (cantonese, true) }
  let primary = String(language.split(separator: "-").first ?? "")
  if let s = sentences[primary] { return (s, true) }
  return (english, false)
}

func primaryLanguage(_ language: String) -> String {
  String(language.split(separator: "-").first ?? "")
}

func qualityName(_ v: AVSpeechSynthesisVoice) -> String {
  switch v.quality {
  case .default: return "default"
  case .enhanced: return "enhanced"
  case .premium: return "premium"
  @unknown default: return "q\(v.quality.rawValue)"
  }
}

func genderName(_ v: AVSpeechSynthesisVoice) -> String {
  switch v.gender {
  case .male: return "male"
  case .female: return "female"
  case .unspecified: return "unspecified"
  @unknown default: return "g\(v.gender.rawValue)"
  }
}

func traitsName(_ v: AVSpeechSynthesisVoice) -> String {
  var traits: [String] = []
  if v.voiceTraits.contains(.isNoveltyVoice) { traits.append("novelty") }
  if v.voiceTraits.contains(.isPersonalVoice) { traits.append("personal") }
  return traits.joined(separator: "+")
}

/// What kind of voice an identifier is, as the sample files are named.
func familyName(_ v: AVSpeechSynthesisVoice) -> String {
  let id = v.identifier
  if id.contains(".eloquence.") { return "eloquence" }
  if id.contains("ttsbundle.siri") { return "siri" }
  if id.contains(".super-compact.") { return "super-compact" }
  if id.contains(".voice.compact.") { return "compact" }
  if id.contains(".voice.enhanced.") { return "enhanced" }
  if id.contains(".voice.premium.") { return "premium" }
  if id.contains("speech.synthesis.voice") { return v.voiceTraits.contains(.isNoveltyVoice) ? "novelty" : "macintalk" }
  return "other"
}

func listeningText(_ v: AVSpeechSynthesisVoice) -> String {
  primaryLanguage(v.language) == "en" ? "\(v.name). " + englishPassage : sentence(for: v.language).0
}

func formatName(_ f: AVAudioCommonFormat) -> String {
  switch f {
  case .pcmFormatFloat32: return "float32"
  case .pcmFormatFloat64: return "float64"
  case .pcmFormatInt16: return "int16"
  case .pcmFormatInt32: return "int32"
  default: return "other\(f.rawValue)"
  }
}

func clean(_ s: String) -> String {
  s.replacingOccurrences(of: "\t", with: " ").replacingOccurrences(of: "\n", with: " ")
}

final class Collector: @unchecked Sendable {
  let lock = NSLock()
  var frames: AVAudioFrameCount = 0
  var sampleRate = 0.0
  var format = ""
  var bytesPerFrame: UInt32 = 0
  var words: [(Int, String)] = []
  var otherMarks = 0
  var finished = false
  var resumed = false
}

final class SampleWriter: @unchecked Sendable {
  let lock = NSLock()
  var file: AVAudioFile?
  var resumed = false
  var timedOut = false
}

@MainActor
final class Probe: ObservableObject {
  @Published var voices: [AVSpeechSynthesisVoice] = []
  @Published var results: [String: String] = [:]
  @Published var summary = ""
  @Published var progress = ""
  @Published var busy = true
  /// A synthesizer that has timed out once was seen to time out on every later
  /// voice too (2026-09-29, 21:19), so a timeout replaces it.
  private var synth = AVSpeechSynthesizer()
  private let speaker = AVSpeechSynthesizer()
  private var started = false
  private let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]

  var groups: [(String, [AVSpeechSynthesisVoice])] {
    Dictionary(grouping: voices, by: \.language).sorted { $0.key < $1.key }
  }

  private func save(_ name: String, _ text: String) {
    try? text.write(to: documents.appendingPathComponent(name), atomically: true, encoding: .utf8)
  }

  func start() async {
    guard !started else { return }
    started = true
    UIApplication.shared.isIdleTimerDisabled = true
    defer { UIApplication.shared.isIdleTimerDisabled = false }
    try? FileManager.default.removeItem(at: documents.appendingPathComponent("done.txt"))

    let all = AVSpeechSynthesisVoice.speechVoices().sorted {
      ($0.language, $0.name, $0.identifier) < ($1.language, $1.name, $1.identifier)
    }
    voices = all
    var tsv = "language\tname\tquality\tgender\ttraits\tidentifier\n"
    for v in all {
      tsv += [v.language, v.name, qualityName(v), genderName(v), traitsName(v), v.identifier].joined(separator: "\t") + "\n"
    }
    save("voices.tsv", tsv)

    let locales = Set(all.map(\.language))
    let languages = Set(all.map { primaryLanguage($0.language) })
    var lines = [
      "iOS \(UIDevice.current.systemVersion), \(UIDevice.current.model)",
      "\(all.count) voices, \(locales.count) locales, \(languages.count) languages",
    ]
    for q in ["default", "enhanced", "premium"] {
      lines.append("\(q): \(all.filter { qualityName($0) == q }.count)")
    }
    lines.append("novelty: \(all.filter { $0.voiceTraits.contains(.isNoveltyVoice) }.count)")
    lines.append("personal: \(all.filter { $0.voiceTraits.contains(.isPersonalVoice) }.count)")
    lines.append("personal voice authorization: \(AVSpeechSynthesizer.personalVoiceAuthorizationStatus.rawValue)")
    summary = lines.joined(separator: "\n")
    save("summary.txt", summary + "\n")
    print(summary)

    // The marker run only when launched with --measure (system-voices.md);
    // otherwise the last run's results are shown.
    if ProcessInfo.processInfo.arguments.contains("--measure") {
      var markers = "identifier\tlanguage\tnativeText\tformat\tbytesPerFrame\tframes\tseconds\tsynthSeconds\twordMarks\totherMarks\tfinished\tmarks\n"
      save("markers.tsv", markers)
      for (i, v) in all.enumerated() {
        progress = "Writing \(i + 1) of \(all.count): \(v.name)"
        let (line, short) = await measure(v)
        markers += line + "\n"
        results[v.identifier] = short
        save("markers.tsv", markers)
      }
    } else if let saved = try? String(contentsOf: documents.appendingPathComponent("markers.tsv"), encoding: .utf8) {
      for row in saved.split(separator: "\n").dropFirst() {
        let f = row.split(separator: "\t", omittingEmptySubsequences: false).map(String.init)
        guard f.count >= 11 else { continue }
        results[f[0]] = f[10] == "yes" ? "\(f[8]) word marks \u{00B7} \(f[3])" : "timed out"
      }
    }
    let samples = documents.appendingPathComponent("samples")
    try? FileManager.default.removeItem(at: samples)
    try? FileManager.default.createDirectory(at: samples, withIntermediateDirectories: true)
    let english = all.filter { primaryLanguage($0.language) == "en" }
    for (i, v) in english.enumerated() {
      progress = "Sample \(i + 1) of \(english.count): \(v.name)"
      let name = "\(familyName(v))-\(v.language)-\(v.name.replacingOccurrences(of: " ", with: "_")).wav"
      await writeSample(v, to: samples.appendingPathComponent(name))
    }
    progress = "Tap a voice to hear it."
    busy = false
    save("done.txt", ISO8601DateFormatter().string(from: Date()) + "\n")
  }

  /// Speaks the voice's listening text on the phone; a second tap stops it.
  func speak(_ v: AVSpeechSynthesisVoice) {
    if speaker.isSpeaking {
      speaker.stopSpeaking(at: .immediate)
      return
    }
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
    try? AVAudioSession.sharedInstance().setActive(true)
    let utterance = AVSpeechUtterance(string: listeningText(v))
    utterance.voice = v
    speaker.speak(utterance)
  }

  private func writeSample(_ v: AVSpeechSynthesisVoice, to url: URL) async {
    let utterance = AVSpeechUtterance(string: listeningText(v))
    utterance.voice = v
    let w = SampleWriter()
    let synth = self.synth
    await withCheckedContinuation { (k: CheckedContinuation<Void, Never>) in
      let finish: @Sendable () -> Void = {
        w.lock.lock()
        let go = !w.resumed
        w.resumed = true
        w.file = nil
        w.lock.unlock()
        if go { k.resume() }
      }
      synth.write(utterance, toBufferCallback: { buffer in
        guard let pcm = buffer as? AVAudioPCMBuffer else { return }
        if pcm.frameLength == 0 { finish(); return }
        w.lock.lock()
        defer { w.lock.unlock() }
        if w.resumed { return }
        if w.file == nil {
          w.file = try? AVAudioFile(forWriting: url, settings: pcm.format.settings,
            commonFormat: pcm.format.commonFormat, interleaved: pcm.format.isInterleaved)
        }
        try? w.file?.write(from: pcm)
      }, toMarkerCallback: { _ in })
      DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
        w.lock.lock()
        let pending = !w.resumed
        w.lock.unlock()
        guard pending else { return }
        w.timedOut = true
        synth.stopSpeaking(at: .immediate)
        finish()
      }
    }
    if w.timedOut { self.synth = AVSpeechSynthesizer() }
  }

  private func measure(_ v: AVSpeechSynthesisVoice) async -> (String, String) {
    let (text, native) = sentence(for: v.language)
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = v
    let c = Collector()
    let synth = self.synth
    let t0 = Date()
    await withCheckedContinuation { (k: CheckedContinuation<Void, Never>) in
      let finish: @Sendable () -> Void = {
        c.lock.lock()
        let go = !c.resumed
        c.resumed = true
        c.lock.unlock()
        if go { k.resume() }
      }
      synth.write(utterance, toBufferCallback: { buffer in
        guard let pcm = buffer as? AVAudioPCMBuffer else { return }
        c.lock.lock()
        if pcm.frameLength == 0 {
          c.finished = true
          c.lock.unlock()
          finish()
          return
        }
        c.frames += pcm.frameLength
        let f = pcm.format
        c.sampleRate = f.sampleRate
        c.format = "\(Int(f.sampleRate))Hz ch\(f.channelCount) \(formatName(f.commonFormat))\(f.isInterleaved ? " interleaved" : "")"
        c.bytesPerFrame = f.streamDescription.pointee.mBytesPerFrame
        c.lock.unlock()
      }, toMarkerCallback: { marks in
        c.lock.lock()
        for m in marks {
          if m.mark == .word {
            let word = Range(m.textRange, in: text).map { String(text[$0]) } ?? "?"
            c.words.append((m.byteSampleOffset, word))
          } else {
            c.otherMarks += 1
          }
        }
        c.lock.unlock()
      })
      DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
        c.lock.lock()
        let pending = !c.resumed
        c.lock.unlock()
        guard pending else { return }
        synth.stopSpeaking(at: .immediate)
        finish()
      }
    }
    let synthSeconds = Date().timeIntervalSince(t0)
    if !c.lock.withLock({ c.finished }) { self.synth = AVSpeechSynthesizer() }
    return c.lock.withLock { summarize(v, c, native, synthSeconds) }
  }

  private nonisolated func summarize(_ v: AVSpeechSynthesisVoice, _ c: Collector, _ native: Bool, _ synthSeconds: Double) -> (String, String) {
    let seconds = c.sampleRate > 0 ? Double(c.frames) / c.sampleRate : 0
    let marks = c.words.map { "\($0.0):\(clean($0.1))" }.joined(separator: " ")
    let line = [
      v.identifier, v.language, native ? "yes" : "no", c.format, "\(c.bytesPerFrame)", "\(c.frames)",
      String(format: "%.3f", seconds), String(format: "%.3f", synthSeconds),
      "\(c.words.count)", "\(c.otherMarks)", c.finished ? "yes" : "timeout", marks,
    ].joined(separator: "\t")
    let short = c.finished
      ? "\(c.words.count) word marks · \(c.format) · \(String(format: "%.1f", seconds)) s in \(String(format: "%.1f", synthSeconds)) s"
      : "timed out after 30 s"
    return (line, short)
  }
}

struct ContentView: View {
  @StateObject private var probe = Probe()

  var body: some View {
    NavigationStack {
      List {
        Section {
          Text(probe.summary.isEmpty ? "Listing voices…" : probe.summary)
            .font(.callout.monospaced())
          if !probe.progress.isEmpty {
            Text(probe.progress).foregroundStyle(.secondary)
          }
        }
        ForEach(probe.groups, id: \.0) { language, voices in
          Section("\(Locale.current.localizedString(forIdentifier: language) ?? language) · \(language)") {
            ForEach(voices, id: \.identifier) { v in
              Button { probe.speak(v) } label: {
              VStack(alignment: .leading, spacing: 2) {
                Text(v.name).foregroundStyle(.primary)
                Text([familyName(v), traitsName(v), probe.results[v.identifier] ?? ""]
                  .filter { !$0.isEmpty }.joined(separator: " · "))
                  .font(.caption)
                  .foregroundStyle(.secondary)
              }
              }
              .disabled(probe.busy)
            }
          }
        }
      }
      .navigationTitle("System Voices")
    }
    .task { await probe.start() }
  }
}

@main
struct SystemVoicesApp: App {
  var body: some Scene {
    WindowGroup { ContentView() }
  }
}
