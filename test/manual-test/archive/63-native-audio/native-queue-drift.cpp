// Native audio regression fixture. native-queue-drift.sh extracts the installed
// production processing/position/clear methods verbatim into production.inc.
// The queue processor, WSOLA and vector operations are compiled from the library.
// Only graph/session/event plumbing is replaced: this is not an iOS/AirPods test.
//
//   bash test/manual-test/archive/63-native-audio/native-queue-drift.sh RATE SECONDS MODE [SAMPLE_RATE] [DRAIN_MS]
//   MODE = download | stream | clear (assert seek discards all pending audio)
//
// Reports, at word boundaries across the run, how long before the boundary was
// heard the node reported it (onBufferEnded: what the app cues the highlight on).
#include <audioapi/core/utils/Constants.h>
#include <audioapi/core/utils/buffer/QueueBufferProcessor.h>
#include <audioapi/dsp/WsolaTimeStretcher.h>
#include <audioapi/utils/AudioBuffer.hpp>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <list>
#include <memory>
#include <vector>
#include <fstream>
#include <string>

using namespace audioapi;

// Session and graph lifetime are irrelevant to this render-thread fixture.
namespace audioapi {
struct ProbeGraph {
  void addAudioBufferForDestruction(std::shared_ptr<AudioBuffer>) {}
};
struct BaseAudioContext {
  float sampleRate; long frame = 0;
  std::shared_ptr<ProbeGraph> graph = std::make_shared<ProbeGraph>();
  double getCurrentTime() const { return frame / sampleRate; }
  float getSampleRate() const { return sampleRate; }
  long getCurrentSampleFrame() const { return frame; }
  auto getGraphManager() const { return graph; }
};
struct ProbeParam {
  float value;
  float processKRateParam(int, double) const { return value; }
};
struct ProbePositionEvent { void advance(int, double) {} };
struct Node {
  float sr;
  std::shared_ptr<BaseAudioContext> owner;
  std::weak_ptr<BaseAudioContext> context_;
  std::shared_ptr<ProbeParam> playbackRateParam_ = std::make_shared<ProbeParam>(ProbeParam{1});
  std::shared_ptr<ProbeParam> detuneParam_ = std::make_shared<ProbeParam>(ProbeParam{0});
  ProbePositionEvent positionChanged_;
  std::list<std::pair<size_t, std::shared_ptr<AudioBuffer>>> buffers_;
  double vReadIndex_ = 0, playedBuffersDuration_ = 0;
  // Adapter field for the production base node's fractional input-frame carry.
  double pitchCorrectionFrameRemainder_ = 0;
  bool addExtraTailFrames_ = true, stretchHasBeenInit_ = false;
  std::shared_ptr<AudioBuffer> tailBuffer_;
  std::unique_ptr<QueueBufferProcessor> processor_;
  WsolaTimeStretcher wsolaStretcher_;
  std::shared_ptr<DSPAudioBuffer> playbackRateBuffer_;
  long outFrame = 0;
  std::vector<std::pair<size_t, long>> ended;
  explicit Node(float s) : sr(s), owner(std::make_shared<BaseAudioContext>()) {
    owner->sampleRate=s; context_=owner;
    processor_ = std::make_unique<QueueBufferProcessor>(&buffers_, [this](size_t &id, const std::shared_ptr<AudioBuffer> &b, bool &, bool &fire) {
      playedBuffersDuration_ += b->getDuration();
      if (fire) ended.emplace_back(id, outFrame);
    });
  }
  // Mirrors host-object buffer initialization; no audio algorithm lives here.
  void enqueue(size_t id, std::shared_ptr<AudioBuffer> b) {
    if (!stretchHasBeenInit_) {
      wsolaStretcher_.configure(1, sr);
      playbackRateBuffer_ = std::make_shared<DSPAudioBuffer>(static_cast<size_t>(WsolaTimeStretcher::MAX_PLAYBACK_RATE * RENDER_QUANTUM_SIZE), 1, sr);
      tailBuffer_ = std::make_shared<AudioBuffer>(static_cast<size_t>(0.030 * sr), 1, sr);
      tailBuffer_->zero(); stretchHasBeenInit_ = true;
    }
    buffers_.emplace_back(id, b); addExtraTailFrames_ = true;
  }
  float getContextSampleRate() const { return sr; }
  bool isPlaying() const { return true; }
  bool isStopScheduled() const { return false; }
  void updatePlaybackInfo(const std::shared_ptr<DSPAudioBuffer>&, int frames,
    size_t &start, size_t &length, float, long) { start=0; length=frames; }
  void processWithPitchCorrection(const std::shared_ptr<DSPAudioBuffer>&, int);
  void runBufferProcessor(const std::shared_ptr<DSPAudioBuffer>&, size_t, size_t, float, bool);
  double getCurrentPosition() const;
  void clearBuffers();
  void resetPitchCorrection();
  void render(DSPAudioBuffer &out, float rate) {
    playbackRateParam_->value=rate;
    if(buffers_.empty()) out.zero();
    else {
      auto view=std::shared_ptr<DSPAudioBuffer>(&out, [](DSPAudioBuffer*){});
      processWithPitchCorrection(view, RENDER_QUANTUM_SIZE);
    }
    outFrame+=RENDER_QUANTUM_SIZE; owner->frame=outFrame;
  }
};
#include "production.inc"
} // namespace audioapi

// Optional whole-chapter fixture: float32 mono PCM at 48 kHz and real buffer cuts.
// The caller supplies private source.f32 + parts.txt outside the repository.
int renderChapter(float rate, const std::string &dir, const std::string &tag) {
  if (!(rate >= 0.5f && rate <= 4)) return 2;
  const float sr=48000;
  std::ifstream source(dir+"/source.f32",std::ios::binary), parts(dir+"/parts.txt");
  if (!source || !parts) return 2;
  std::ofstream output(dir+"/"+tag+".f32",std::ios::binary), positions(dir+"/"+tag+"-positions.csv");
  if (!output || !positions) return 2;
  Node node(sr); size_t size,id=0,total=0;
  while (parts >> size) {
    if (size == 0 || size > 48000*600) return 2;
    auto b=std::make_shared<AudioBuffer>(size,1,sr);
    source.read(reinterpret_cast<char*>(b->getChannel(0)->span().data()),size*sizeof(float));
    if (!source) return 2;
    node.enqueue(id++,b);total+=size;
  }
  if (total==0) return 2;
  auto out=std::make_shared<DSPAudioBuffer>(RENDER_QUANTUM_SIZE,1,sr);
  positions << "outputFrame,sourcePosition\n";
  const long limit=static_cast<long>((total/rate+sr)*1.05);
  while (node.outFrame < limit && !node.buffers_.empty()) {
    node.render(*out,rate); auto a=out->getChannel(0)->span();
    output.write(reinterpret_cast<const char*>(a.data()),a.size()*sizeof(float));
    positions << node.outFrame << "," << std::fixed << node.getCurrentPosition()*sr << "\n";
  }
  std::printf("rate %.8f, %zu parts, content %.3f s, output %.3f s\n",rate,id,total/sr,node.outFrame/sr);
  return output && positions ? 0 : 2;
}

int main(int argc, char **argv) {
  if (argc == 5 && std::strcmp(argv[1], "render") == 0) return renderChapter(std::atof(argv[2]),argv[3],argv[4]);
  if (argc < 4) { std::fprintf(stderr, "usage: native-drift RATE SECONDS download|stream|clear [HZ] [DRAIN_MS]\n"); return 2; }
  const float rateParam = std::atof(argv[1]);
  const double wallSeconds = std::atof(argv[2]);
  const bool stream = std::strcmp(argv[3], "stream") == 0;
  if (!stream && std::strcmp(argv[3], "download") != 0 && std::strcmp(argv[3], "clear") != 0) return 2;
  const float sr = argc > 4 ? std::atof(argv[4]) : 48000.0f;
  const double drainMs = argc > 5 ? std::atof(argv[5]) : 300.0;
  if (!(rateParam >= 0.5f && rateParam <= 4 && wallSeconds >= 10 && wallSeconds <= 900 && sr >= 8000 && sr <= 96000)) return 2;
  const int Q = RENDER_QUANTUM_SIZE;
  const float freq[2] = {500.0f, 1000.0f};

  unsigned seed = 12345;
  auto rnd = [&]() { seed = seed * 1103515245u + 12345u; return (seed >> 8) & 0xFFFF; };
  // Sentences of 4-12 words; words 0.15-0.6 s of content.
  std::vector<std::vector<size_t>> sentences;
  double total = 0;
  while (total < wallSeconds * rateParam + 10) {
    std::vector<size_t> s;
    int words = 4 + rnd() % 9;
    for (int w = 0; w < words; ++w) { double len = 0.15 + 0.45 * (rnd() / 65535.0); s.push_back(static_cast<size_t>(len * sr)); total += len; }
    sentences.push_back(s);
  }
  Node node(sr);
  size_t id = 0, word = 0;
  auto enqueueSentence = [&](const std::vector<size_t> &s) {
    for (size_t frames : s) {
      auto b = std::make_shared<AudioBuffer>(frames, 1, sr);
      auto ch = b->getChannel(0)->span();
      for (size_t i = 0; i < frames; ++i) ch[i] = 0.5f * std::sin(2.0 * M_PI * freq[word % 2] * i / sr);
      node.enqueue(id++, b);
      ++word;
    }
  };
  size_t next = 0;
  if (stream) enqueueSentence(sentences[next++]);
  else for (; next < sentences.size(); ++next) enqueueSentence(sentences[next]);

  auto out = std::make_shared<DSPAudioBuffer>(Q, 1, sr);
  std::vector<float> heard;
  long emptySince = -1;
  const long quanta = static_cast<long>(wallSeconds * sr / Q);
  for (long q = 0; q < quanta; ++q) {
    if (stream) {
      if (node.buffers_.empty()) {
        if (emptySince < 0) emptySince = node.outFrame;
        if (node.outFrame - emptySince >= drainMs / 1000.0 * sr && next < sentences.size()) { enqueueSentence(sentences[next++]); emptySince = -1; }
      }
    }
    node.render(*out, rateParam);
    auto o = out->getChannel(0)->span();
    for (int i = 0; i < Q; ++i) heard.push_back(o[i]);
  }

  if (std::strcmp(argv[3], "clear") == 0) {
    const auto pending = node.wsolaStretcher_.getBufferedInputFrames();
    node.clearBuffers();
    const bool clean = node.wsolaStretcher_.getBufferedInputFrames() == 0 && node.wsolaStretcher_.getBufferedOutputFrames() == 0;
    std::printf("%s: clearBuffers input before %zu, after %zu; output after %zu\n", clean ? "GREEN" : "RED", pending, node.wsolaStretcher_.getBufferedInputFrames(), node.wsolaStretcher_.getBufferedOutputFrames());
    return clean ? 0 : 1;
  }
  // Heard word boundaries: the dominant frequency switching, 5 ms windows, 1 ms hop.
  const int win = static_cast<int>(sr * 0.005), hop = static_cast<int>(sr * 0.001);
  auto power = [&](long at, float f) {
    double s0 = 0, s1 = 0, s2 = 0, c = 2 * std::cos(2 * M_PI * f / sr);
    for (int i = 0; i < win; ++i) { s0 = heard[at + i] + c * s1 - s2; s2 = s1; s1 = s0; }
    return s1 * s1 + s2 * s2 - c * s1 * s2;
  };
  auto loud = [&](long at) { double e = 0; for (int i = 0; i < win; ++i) e += heard[at + i] * heard[at + i]; return e / win > 0.01; };
  std::vector<long> heardAt;
  size_t k = 0;
  int streak = 0;
  for (long at = 0; at + win < static_cast<long>(heard.size()) && k + 1 < node.ended.size(); at += hop) {
    const bool next = loud(at) && power(at, freq[(k + 1) % 2]) > power(at, freq[k % 2]);
    streak = next ? streak + 1 : 0;
    if (streak == 3) { heardAt.push_back(at - 2 * hop + win / 2); ++k; streak = 0; }
  }
  const size_t n = std::min(heardAt.size(), node.ended.size());
  std::printf("%s, rate %.2f, %.0f Hz, nominal input frames %.8f per quantum, %zu word boundaries in %.0f s\n",
      stream ? "stream (drain before each sentence)" : "download (queue never drains)", rateParam, sr,
      rateParam * Q, n, node.outFrame / sr);
  for (size_t i : {size_t(0), n / 4, n / 2, 3 * n / 4, n - 1}) {
    if (i >= n) continue;
    std::printf("  boundary %4zu heard at %6.1f s: reported %7.1f ms before it was heard\n", i, heardAt[i] / sr,
        (heardAt[i] - node.ended[i].second) * 1000.0 / sr);
  }
  if (n < 20) { std::fprintf(stderr, "HARNESS ERROR: too few matched boundaries\n"); return 2; }
  auto medianLead = [&](size_t begin, size_t end) {
    std::vector<double> leads;
    for (size_t i = begin; i < end; ++i) leads.push_back((heardAt[i] - node.ended[i].second) * 1000.0 / sr);
    std::sort(leads.begin(), leads.end());
    return leads[leads.size() / 2];
  };
  const size_t sample = std::min(size_t(40), n / 4);
  const double early = medianLead(0, sample), late = medianLead(n - sample, n);
  const bool pass = std::abs(late - early) < 100;
  std::printf("%s: early median %.1f ms, late median %.1f ms, growth %.1f ms (limit 100 ms)\n", pass ? "GREEN" : "RED", early, late, late - early);
  return pass ? 0 : 1;
}
