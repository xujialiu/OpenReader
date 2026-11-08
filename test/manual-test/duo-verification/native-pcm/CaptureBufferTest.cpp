#include "CaptureBuffer.hpp"

#include <array>
#include <cassert>
#include <cmath>
#include <iostream>
#include <limits>
#include <thread>

using namespace openreader::pcm;

static Timestamp timeAt(int64_t sample, uint64_t host) {
  return {true, true, sample, 1000, host};
}

static void append(CaptureBuffer &buffer, const float *pcm, uint32_t frames,
                   Timestamp time, Format format = {1000, 1, false}) {
  std::array<const float *, 8> channels{};
  channels[0] = pcm;
  buffer.append(channels, frames, format, time, time.hostTime);
}

int main() {
  {
    DescriptionState first(1, 5000);
    assert(first.usable(1, 1000) && !first.consume(2, 1000));
    first.invalidate(); // lifecycle cancellation between describe and arm
    assert(!first.consume(1, 1000));
    DescriptionState expired(2, 5000);
    assert(!expired.consume(2, 5001));
    DescriptionState replacement(3, 6000);
    assert(!replacement.consume(1, 2000)); // old generation cannot arm a replacement
    assert(replacement.consume(3, 2000) && !replacement.consume(3, 2000));
    std::cout << "description ticket: fresh generation, cancellation, expiry and one-shot consume PASS\n";
  }
  const float first[] = {.1f, .2f, .3f, .4f};
  const float second[] = {.5f, .6f, .7f, .8f};
  {
    CaptureBuffer b({1000, 1, false}, .008, {1, 1});
    append(b, first, 4, timeAt(100, 1000000000));
    append(b, second, 4, timeAt(104, 1004000000));
    b.stop();
    assert(b.quiescent());
    assert(b.failures() == 0 && b.frameCount() == 8 && b.recordCount() == 2);
    assert(b.records()[1].frameOffset == 4 && b.records()[1].frames == 4);
    assert(b.samples()[7] == .8f && b.records()[0].time.sampleTime == 100);
    assert(b.observedFrameCount() == 8 && b.coverageEndHostTime() == 1008000000);
    append(b, first, 4, timeAt(108, 1008000000));
    assert(b.frameCount() == 8); // late callback cannot touch the stopped snapshot
    std::cout << "clean: exact samples, actual frame lengths, offsets and late-stop guard PASS\n";
  }
  {
    CaptureBuffer b({1000, 2, false}, .008, {1, 1});
    std::array<const float *, 8> planes{first, second};
    b.append(planes, 4, {1000, 2, false}, timeAt(0, 1000000000), 7);
    b.stop();
    assert(b.failures() == 0 && b.samples()[0] == .1f && b.samples()[1] == .5f);
    assert(b.samples()[6] == .4f && b.samples()[7] == .8f);
    std::cout << "planar stereo: valid frames copied immediately to interleaved storage PASS\n";
  }
  {
    const float stereo[] = {.1f, .5f, .2f, .6f, .3f, .7f, .4f, .8f};
    CaptureBuffer b({1000, 2, true}, .008, {1, 1});
    std::array<const float *, 8> planes{stereo};
    b.append(planes, 4, {1000, 2, true}, timeAt(0, 1000000000), 7);
    b.stop();
    assert(b.failures() == 0 && b.samples()[6] == .4f && b.samples()[7] == .8f);
  }
  {
    CaptureBuffer b({1000, 1, false}, .010, {1, 1});
    {
      auto lease = b.callbackLease();
      assert(lease);
      b.stop();
      assert(!b.quiescent());
    }
    assert(b.quiescent());
    auto late = b.callbackLease();
    assert(!late && b.quiescent());
  }
  {
    CaptureBuffer b({1000, 1, false}, 10, {1, 1});
    for (uint32_t i = 0; i <= CaptureBuffer::maxRecords; ++i)
      append(b, first, 1, timeAt(i, 1000000000 + i * 1000000ULL));
    b.stop();
    assert(b.frameCount() == CaptureBuffer::maxRecords && (b.failures() & MetadataOverflow));
  }
  std::cout << "interleaved stereo / whole-callback lease / bounded metadata overflow PASS\n";
  for (bool interleaved : {false, true}) {
    CaptureBuffer b({1000, 1, interleaved}, .004, {1, 1});
    append(b, first, 4, timeAt(0, 1000000000), {1000, 1, interleaved});
    append(b, second, 4, timeAt(4, 1004000000), {1000, 1, interleaved});
    b.stop();
    assert((b.failures() & Overflow) && b.frameCount() == 4);
  }
  std::cout << "overflow: incomplete, never silent partial truncation PASS\n";
  for (uint32_t frames : {1U, 2U}) {
    for (int64_t delta : {static_cast<int64_t>(frames), int64_t{0}, int64_t{-1}}) {
      CaptureBuffer b({1000, 1, false}, .010, {1, 1});
      append(b, first, frames, timeAt(100, 1000000000));
      append(b, second, frames, timeAt(100 + delta, 1000000000 + frames * 1000000ULL));
      b.stop();
      std::cout << "short packet frames=" << frames << " sample delta=" << delta
                << " failures=" << b.failures() << std::endl;
      if (delta > 0) assert(b.failures() == 0);
      else assert(b.failures() & SampleTimeGap);
    }
  }
  for (auto change : {InvalidTimestamp, SampleTimeGap, HostTimeGap, FormatChanged, InvalidSamples}) {
    CaptureBuffer b({1000, 1, false}, .010, {1, 1});
    append(b, first, 4, timeAt(0, 1000000000));
    auto time = timeAt(4, 1004000000);
    Format format{1000, 1, false};
    const float *data = second;
    if (change == InvalidTimestamp) time.sampleTimeValid = false;
    if (change == SampleTimeGap) time.sampleTime += 10;
    if (change == HostTimeGap) time.hostTime += 10000000;
    if (change == FormatChanged) format.sampleRate = 2000;
    if (change == InvalidSamples) data = nullptr;
    append(b, data, 4, time, format);
    b.stop();
    assert(b.failures() & change);
  }
  std::cout << "invalid timestamp / sample gap / host gap / format / pointers: incomplete PASS\n";
  {
    CaptureBuffer b({1000, 1, false}, .010, {125, 3});
    auto a = timeAt(0, 24000000);
    append(b, first, 4, a);
    append(b, second, 4, timeAt(4, 24096000));
    b.stop();
    assert(b.failures() == 0); // mach ticks are NOT nanoseconds
  }
  {
    CaptureBuffer b({1000, 1, false}, .010, {1, 1});
    b.invalidate(IdentityChanged);
    append(b, first, 4, timeAt(0, 1000000000));
    assert(b.quiescent() && b.frameCount() == 0 && (b.failures() & IdentityChanged));
  }
  {
    CaptureBuffer b({1000, 1, false}, .010, {1, 1});
    const float bad[] = {std::numeric_limits<float>::quiet_NaN()};
    append(b, bad, 1, timeAt(0, 1000000000));
    b.stop();
    assert(b.failures() & InvalidSamples);
  }
  bool rejected = false;
  try { CaptureBuffer b({48000, 2, false}, 10.1, {1, 1}); } catch (...) { rejected = true; }
  assert(rejected);
  std::cout << "10s bound / timebase / identity / finite-sample gates PASS\n";
  {
    CaptureBuffer b({1000, 1, false}, 10, {1, 1});
    std::thread writer([&] {
      for (int i = 0; i < 10000; ++i) append(b, first, 1, timeAt(i, 1000000000ULL + i * 1000000ULL));
    });
    b.stop();
    writer.join();
    assert(b.quiescent());
    const auto count = b.frameCount();
    append(b, first, 1, timeAt(10000, 11000000000));
    assert(b.frameCount() == count);
  }
  std::cout << "concurrent stop: joined/quiescent storage remains immutable PASS\nHOST ONLY; no Apple frameworks or native audio\n";
}
