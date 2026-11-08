#pragma once

// Portable storage shared verbatim by the test-only AVAudioNode tap and host
// tests. Only append/invalidate/stop touch callback state. Inspect storage only
// after stop + quiescent; a late callback then cannot write, even after removal.
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <utility>
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

// Cancellation survives ticket consumption and capture stop. Each native
// notification block owns an ObserverLease for its ENTIRE lifetime, including
// dispatch before callback entry. Removal alone is not retirement proof.
class LifecycleCancellation : public std::enable_shared_from_this<LifecycleCancellation> {
 public:
  class ObserverLease;
  class CallbackLease {
   public:
    ~CallbackLease() { if (entered_) owner_->callbacks_.fetch_sub(1); }
    CallbackLease(const CallbackLease &) = delete;
    void cancel() noexcept { if (entered_) owner_->cancelled_.store(true); }
   private:
    friend class ObserverLease;
    CallbackLease(std::shared_ptr<LifecycleCancellation> owner, bool entered) noexcept
        : owner_(std::move(owner)), entered_(entered) {
      if (entered_) owner_->callbacks_.fetch_add(1);
    }
    std::shared_ptr<LifecycleCancellation> owner_;
    bool entered_;
  };
  class ObserverLease {
   public:
    explicit ObserverLease(std::shared_ptr<LifecycleCancellation> owner) : owner_(std::move(owner)) {
      uint32_t current = owner_->observers_.load();
      while (!(current & sealed)) {
        if (current == sealed - 1) break;
        if (owner_->observers_.compare_exchange_weak(current, current + 1)) { registered_ = true; break; }
      }
    }
    ~ObserverLease() { if (registered_) owner_->observers_.fetch_sub(1); }
    ObserverLease(const ObserverLease &) = delete;
    CallbackLease callback() noexcept { return CallbackLease(owner_, registered_); }
   private:
    friend class LifecycleCancellation;
    std::shared_ptr<LifecycleCancellation> owner_;
    bool registered_ = false;
  };
  std::shared_ptr<ObserverLease> observe() {
    auto lease = std::make_shared<ObserverLease>(shared_from_this()); // off tap path
    return lease->registered_ ? lease : nullptr;
  }
  bool cancelled() const noexcept { return cancelled_.load(); }
  bool seal() noexcept {
    uint32_t expected = 0;
    observers_.compare_exchange_strong(expected, sealed);
    // A callback entered before its registration retired may still be running.
    // Once sealed, no new registration can be admitted.
    return observers_.load() == sealed && callbacks_.load() == 0;
  }
 private:
  static constexpr uint32_t sealed = uint32_t{1} << 31;
  std::atomic<uint32_t> observers_{0}, callbacks_{0};
  std::atomic<bool> cancelled_{false};
};

// Ticket retirement does NOT cancel its shared lifecycle. Notification leases
// signal cancellation independently, including after retirement/consumption.
class DescriptionState {
 public:
  DescriptionState(uint64_t generation, uint64_t deadline) : generation_(generation), deadline_(deadline),
      lifecycle_(std::make_shared<LifecycleCancellation>()) {}
  bool usable(uint64_t generation, uint64_t now) const noexcept {
    return generation != 0 && generation == generation_ && now <= deadline_ && available_.load() && !lifecycle_->cancelled();
  }
  bool consume(uint64_t generation, uint64_t now) noexcept {
    return usable(generation, now) && available_.exchange(false);
  }
  void retire() noexcept { available_.store(false); }
  const std::shared_ptr<LifecycleCancellation> &lifecycle() const noexcept { return lifecycle_; }
 private:
  uint64_t generation_, deadline_;
  std::atomic<bool> available_{true};
  std::shared_ptr<LifecycleCancellation> lifecycle_;
};

class CaptureBuffer {
 public:
  static constexpr uint32_t maxChannels = 8;
  static constexpr uint32_t maxRecords = 4096;
  // Two PCM frames is an instrumentation clock-consistency bound, NOT a
  // speech/Word Timing acceptance tolerance. Both clocks are preserved raw.
  static constexpr double timestampToleranceFrames = 2;

  CaptureBuffer(Format format, double maximumSeconds, Timebase timebase,
                std::shared_ptr<LifecycleCancellation> lifecycle = std::make_shared<LifecycleCancellation>())
      : format_(format), timebase_(timebase), lifecycle_(std::move(lifecycle)) {
    if (!lifecycle_ || !std::isfinite(format.sampleRate) || format.sampleRate < 1000 ||
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
      entered_ = owner_.accepting();
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
  bool quiescent() const noexcept { return !accepting_.load() && writers_.load() == 0 && lifecycle_->seal(); }
  bool accepting() const noexcept { return accepting_.load() && !lifecycle_->cancelled(); }
  uint32_t failures() const noexcept { return failures_.load() | (lifecycle_->cancelled() ? ConfigurationChanged : 0U); }
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
    if (!accepting()) { writers_.fetch_sub(1); return; }
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
      if (time.sampleTime <= before.sampleTime || time.sampleRate != before.sampleRate ||
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
  std::shared_ptr<LifecycleCancellation> lifecycle_;
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
