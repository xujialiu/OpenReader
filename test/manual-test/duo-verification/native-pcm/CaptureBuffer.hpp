#pragma once

// Portable storage shared verbatim by the test-only AVAudioNode tap and host
// tests. Only append/invalidate/stop touch callback state. Inspect storage only
// after stop + quiescent; a late callback then cannot write, even after removal.
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace openreader::pcm {

struct Format {
  double sampleRate;
  uint32_t channels;
  bool interleaved;
};

struct Timebase { uint32_t numer, denom; };
struct Timestamp {
  bool sampleTimeValid, hostTimeValid;
  int64_t sampleTime;
  double sampleRate;
  uint64_t hostTime;
};
struct Record {
  uint64_t frameOffset;
  uint32_t frames;
  Timestamp time;
  uint64_t arrivalHostTime;
};

enum Failure : uint32_t {
  Overflow = 1 << 0,
  MetadataOverflow = 1 << 1,
  FormatChanged = 1 << 2,
  InvalidTimestamp = 1 << 3,
  SampleTimeGap = 1 << 4,
  HostTimeGap = 1 << 5,
  InvalidSamples = 1 << 6,
  ConcurrentCallback = 1 << 7,
  IdentityChanged = 1 << 8,
  VolumeNotZero = 1 << 9,
  CleanupUncertain = 1 << 10,
  DeadlineExceeded = 1 << 11,
  ConfigurationChanged = 1 << 12,
};

class CaptureBuffer {
 public:
  static constexpr uint32_t maxChannels = 8;
  static constexpr uint32_t maxRecords = 4096;
  // Two PCM frames is an instrumentation clock-consistency bound, NOT a
  // speech/Word Timing acceptance tolerance. Both clocks are preserved raw.
  static constexpr double timestampToleranceFrames = 2;

  CaptureBuffer(Format format, double maximumSeconds, Timebase timebase)
      : format_(format), timebase_(timebase) {
    if (!std::isfinite(format.sampleRate) || format.sampleRate < 1000 ||
        format.sampleRate > 192000 || format.channels == 0 || format.channels > maxChannels ||
        !std::isfinite(maximumSeconds) || maximumSeconds <= 0 || maximumSeconds > 10 ||
        !timebase.numer || !timebase.denom)
      throw std::invalid_argument("unsupported capture format, duration or timebase");
    capacity_ = static_cast<uint64_t>(std::ceil(format.sampleRate * maximumSeconds));
    samples_.resize(capacity_ * format.channels); // all allocation before install
    records_.resize(maxRecords);
    static_assert(std::atomic<uint32_t>::is_always_lock_free);
    static_assert(std::atomic<bool>::is_always_lock_free);
  }

  CaptureBuffer(const CaptureBuffer &) = delete;
  CaptureBuffer &operator=(const CaptureBuffer &) = delete;

  // Count the whole native callback, including its scalar/pointer validation,
  // so stop/quiescent also bounds work before append. A stopped late callback
  // has no lease and must return without inspecting or invalidating anything.
  class CallbackLease {
   public:
    explicit CallbackLease(CaptureBuffer &owner) noexcept : owner_(owner) {
      owner_.writers_.fetch_add(1);
      entered_ = owner_.accepting_.load();
      if (!entered_) owner_.writers_.fetch_sub(1);
    }
    ~CallbackLease() { if (entered_) owner_.writers_.fetch_sub(1); }
    CallbackLease(const CallbackLease &) = delete;
    explicit operator bool() const noexcept { return entered_; }
   private:
    CaptureBuffer &owner_;
    bool entered_;
  };
  CallbackLease callbackLease() noexcept { return CallbackLease(*this); }

  void stop() noexcept { accepting_.store(false); }
  void invalidate(uint32_t reason) noexcept { failures_.fetch_or(reason); stop(); }
  bool quiescent() const noexcept { return !accepting_.load() && writers_.load() == 0; }
  bool accepting() const noexcept { return accepting_.load(); }
  uint32_t failures() const noexcept { return failures_.load(); }
  uint64_t frameCount() const noexcept { return frames_; }
  uint32_t recordCount() const noexcept { return count_; }
  const float *samples() const noexcept { return samples_.data(); }
  const Record *records() const noexcept { return records_.data(); }
  uint64_t capacity() const noexcept { return capacity_; }
  uint64_t observedFrameCount() const noexcept { return publishedFrames_.load(); }
  uint64_t coverageEndHostTime() const noexcept { return publishedHostEnd_.load(); }

  // Apple pointers are borrowed only for this call. No allocation, mutex,
  // waiting, logging, files, encoding or JS on this path; never partially copy.
  void append(const std::array<const float *, maxChannels> &planes, uint32_t frames,
              Format actual, Timestamp time, uint64_t arrival) noexcept {
    writers_.fetch_add(1);
    if (!accepting_.load()) { writers_.fetch_sub(1); return; }
    if (copying_.test_and_set()) {
      invalidate(ConcurrentCallback);
      writers_.fetch_sub(1);
      return;
    }
    auto done = [&] { copying_.clear(); writers_.fetch_sub(1); };
    if (actual.sampleRate != format_.sampleRate || actual.channels != format_.channels ||
        actual.interleaved != format_.interleaved) {
      invalidate(FormatChanged); done(); return;
    }
    if (frames == 0) { invalidate(InvalidSamples); done(); return; }
    if (frames > capacity_ - frames_) {
      invalidate(Overflow); done(); return;
    }
    if (count_ == maxRecords) { invalidate(MetadataOverflow); done(); return; }
    for (uint32_t c = 0; c < (actual.interleaved ? 1 : actual.channels); ++c) {
      if (!planes[c]) { invalidate(InvalidSamples); done(); return; }
    }

    const bool validTime = time.sampleTimeValid && time.hostTimeValid && time.hostTime != 0 &&
        std::isfinite(time.sampleRate) && time.sampleRate > 0;
    if (!validTime) invalidate(InvalidTimestamp);
    if (count_ && validTime) {
      const auto &previous = records_[count_ - 1];
      const auto &before = previous.time;
      const long double seconds = previous.frames / format_.sampleRate;
      const long double tolerance = timestampToleranceFrames / format_.sampleRate;
      if (time.sampleRate != before.sampleRate ||
          std::abs((static_cast<long double>(time.sampleTime) - before.sampleTime) /
                   time.sampleRate - seconds) > tolerance)
        invalidate(SampleTimeGap);
      const long double hostSeconds = (static_cast<long double>(time.hostTime) - before.hostTime) *
          timebase_.numer / timebase_.denom / 1e9L;
      if (time.hostTime <= before.hostTime || std::abs(hostSeconds - seconds) > tolerance)
        invalidate(HostTimeGap);
    }
    records_[count_++] = {frames_, frames, time, arrival};
    for (uint32_t f = 0; f < frames; ++f) {
      for (uint32_t c = 0; c < actual.channels; ++c) {
        const float value = actual.interleaved ? planes[0][f * actual.channels + c] : planes[c][f];
        if (!std::isfinite(value)) invalidate(InvalidSamples);
        samples_[(frames_ + f) * actual.channels + c] = value;
      }
    }
    frames_ += frames;
    publishedFrames_.store(frames_);
    if (validTime) {
      const long double end = time.hostTime + static_cast<long double>(frames) / format_.sampleRate *
          1e9L * timebase_.denom / timebase_.numer;
      if (end < static_cast<long double>(UINT64_MAX)) publishedHostEnd_.store(static_cast<uint64_t>(end));
      else invalidate(InvalidTimestamp);
    }
    done();
  }

 private:
  Format format_;
  Timebase timebase_;
  uint64_t capacity_ = 0, frames_ = 0;
  uint32_t count_ = 0;
  std::vector<float> samples_;
  std::vector<Record> records_;
  std::atomic<bool> accepting_{true};
  std::atomic<uint32_t> writers_{0}, failures_{0};
  std::atomic<uint64_t> publishedFrames_{0}, publishedHostEnd_{0};
  static_assert(std::atomic<uint64_t>::is_always_lock_free);
  std::atomic_flag copying_ = ATOMIC_FLAG_INIT;
};

} // namespace openreader::pcm
