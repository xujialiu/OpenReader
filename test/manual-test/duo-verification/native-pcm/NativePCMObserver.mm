// Test-only existing-node observer. The installer alone adds this translation
// unit to an external diagnostic project. It is inert on devices/Release and
// without BOTH the Debug-role receipt and an explicit expiring launch token.
#import <TargetConditionals.h>
#if TARGET_OS_SIMULATOR && DEBUG && OPENREADER_PCM_TEST_ONLY
#import <AVFoundation/AVFoundation.h>
#import <CommonCrypto/CommonDigest.h>
#import <Foundation/Foundation.h>
#import <audioapi/ios/system/AudioEngine.h>
#import <mach/mach_time.h>
#if __IPHONE_OS_VERSION_MAX_ALLOWED < 270000
#error "Native PCM observer requires the public iOS 27 tap error selector SDK."
#endif

#include "CaptureBuffer.hpp"
#include <chrono>
#include <memory>
#include <thread>

using namespace openreader::pcm;

static NSString *const ORPCMSchema = @"OpenReaderNativePCM-v1";
static NSString *ORPCMIdentity(id object) {
  return [NSString stringWithFormat:@"%p", (__bridge void *)object];
}
static BOOL ORPCMToken(id value) {
  if (![value isKindOfClass:NSString.class] || [value length] == 0 || [value length] > 64) return NO;
  NSCharacterSet *allowed = [NSCharacterSet characterSetWithCharactersInString:
      @"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"];
  return [value rangeOfCharacterFromSet:allowed.invertedSet].location == NSNotFound;
}
static NSDictionary *ORPCMClock(void) {
  const uint64_t before = mach_absolute_time();
  const double wall = NSDate.date.timeIntervalSince1970 * 1000;
  const uint64_t continuous = mach_continuous_time();
  const uint64_t after = mach_absolute_time();
  return @{@"beforeHostTime": @(before).stringValue, @"wallMs": @(wall),
           @"continuousTime": @(continuous).stringValue, @"afterHostTime": @(after).stringValue};
}
static NSDictionary *ORPCMFormat(AVAudioFormat *format) {
  return @{@"sampleRate": @(format.sampleRate), @"channels": @(format.channelCount),
           @"interleaved": @(format.interleaved), @"commonFormat": @(format.commonFormat)};
}
static NSString *ORPCMHash(NSData *data) {
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
  NSMutableString *result = [NSMutableString stringWithCapacity:64];
  for (unsigned char byte : digest) [result appendFormat:@"%02x", byte];
  return result;
}

@interface ORNativePCMController : NSObject {
  std::shared_ptr<CaptureBuffer> _buffer;
  AudioEngine *_owner;
  AVAudioEngine *_engine;
  AVAudioSourceNode *_source;
  AVAudioFormat *_format;
  NSString *_run;
  NSURL *_directory;
  NSDictionary *_build;
  NSDictionary *_attribution;
  NSMutableArray *_anchors;
  NSMutableArray *_volumeSamples;
  dispatch_source_t _timer;
  id _configurationObserver;
  BOOL _ownsTap, _removed, _removalAttempted, _exported, _shutdown;
  uint64_t _seen;
  double _expires, _captureExpires, _maximumSeconds;
  mach_timebase_info_data_t _timebase;
}
- (instancetype)initWithRun:(NSString *)run build:(NSDictionary *)build;
- (void)tick;
@end

@implementation ORNativePCMController

+ (void)load {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSDictionary *info = NSBundle.mainBundle.infoDictionary;
    NSDictionary *build = info[@"OpenReaderNativePCMObserver"];
    NSArray *arguments = NSProcessInfo.processInfo.arguments;
    NSUInteger index = [arguments indexOfObject:@"-ORNativePCMRun"];
    if (![info[@"OpenReaderBuildVariant"] isEqual:@"debug"] ||
        ![build isKindOfClass:NSDictionary.class] || ![build[@"schema"] isEqual:ORPCMSchema] ||
        ![build[@"testOnly"] isEqual:@YES] || index == NSNotFound || index + 1 >= arguments.count ||
        !ORPCMToken(arguments[index + 1])) return;
    if (@available(iOS 27.0, *)) {
      static ORNativePCMController *controller;
      controller = [[ORNativePCMController alloc] initWithRun:arguments[index + 1] build:build];
      (void)controller; // retain safe storage even if removal ever becomes uncertain
    }
  });
}

- (BOOL)writeJSON:(NSDictionary *)value name:(NSString *)name {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:nil];
  return data && [data writeToURL:[_directory URLByAppendingPathComponent:name]
                         options:NSDataWritingAtomic error:nil];
}

- (instancetype)initWithRun:(NSString *)run build:(NSDictionary *)build {
  if ((self = [super init])) {
    _run = run; _build = build; _anchors = [NSMutableArray new]; _volumeSamples = [NSMutableArray new];
    mach_timebase_info(&_timebase);
    _expires = NSProcessInfo.processInfo.systemUptime + 120;
    NSURL *support = [NSFileManager.defaultManager URLsForDirectory:NSApplicationSupportDirectory
                                                        inDomains:NSUserDomainMask].firstObject;
    _directory = [[support URLByAppendingPathComponent:@"duo-native-pcm" isDirectory:YES]
                         URLByAppendingPathComponent:run isDirectory:YES];
    // A reused launch token is not allowed to replay an old arm command.
    if ([NSFileManager.defaultManager fileExistsAtPath:_directory.path]) return nil;
    if (![NSFileManager.defaultManager createDirectoryAtURL:_directory withIntermediateDirectories:YES
                                                 attributes:@{NSFilePosixPermissions: @0700} error:nil]) return nil;
    [_directory setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nil];
    [self writeJSON:@{@"schema": ORPCMSchema, @"run": _run, @"build": _build,
        @"pid": @(NSProcessInfo.processInfo.processIdentifier), @"expiresAfterSeconds": @120,
        @"clock": ORPCMClock(), @"state": @"ready", @"simulatorOnly": @YES} name:@"ready.json"];
    _timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(_timer, dispatch_time(DISPATCH_TIME_NOW, 0), 50 * NSEC_PER_MSEC, 5 * NSEC_PER_MSEC);
    __weak ORNativePCMController *weakSelf = self;
    dispatch_source_set_event_handler(_timer, ^{ [weakSelf tick]; });
    dispatch_resume(_timer);
  }
  return self;
}

// Use Apple's attachedNodes snapshot instead of enumerating the library's
// mutable, privately locked sourceNodes/sourceFormats dictionaries. Object
// identity is the source identity here, NOT its unexported registration UUID.
- (AVAudioSourceNode *)soleSource:(AVAudioEngine *)engine {
  AVAudioSourceNode *source = nil;
  for (AVAudioNode *node in engine.attachedNodes) {
    if ([node isKindOfClass:AVAudioSourceNode.class]) {
      if (source) return nil;
      source = (AVAudioSourceNode *)node;
    }
  }
  return source;
}

- (BOOL)identityUnchanged {
  AudioEngine *current = AudioEngine.sharedInstance;
  return current == _owner && current.audioEngine == _engine && _source.engine == _engine &&
      [self soleSource:_engine] == _source &&
      [[_source outputFormatForBus:0] isEqual:_format];
}

- (void)addAnchor:(NSString *)label {
  if (_anchors.count >= 64) { if (_buffer) _buffer->invalidate(MetadataOverflow); return; }
  [_anchors addObject:@{@"label": label, @"clock": ORPCMClock()}];
}

- (void)sampleVolume {
  AVAudioSession *session = AVAudioSession.sharedInstance;
  if (_volumeSamples.count < 256) [_volumeSamples addObject:@{
      @"hostTime": @(mach_absolute_time()).stringValue, @"outputVolume": @(session.outputVolume),
      @"sampleRate": @(session.sampleRate), @"outputLatency": @(session.outputLatency),
      @"IOBufferDuration": @(session.IOBufferDuration), @"engineRunning": @(_engine.running)}];
  else if (_buffer) _buffer->invalidate(MetadataOverflow);
  if (_buffer && session.outputVolume != 0) _buffer->invalidate(VolumeNotZero);
}

- (NSDictionary *)describe {
  AudioEngine *owner = AudioEngine.sharedInstance;
  AVAudioEngine *engine = owner.audioEngine;
  AVAudioSourceNode *source = [self soleSource:engine];
  if (!owner || !engine || !source || source.engine != engine)
    return @{@"eligible": @NO, @"reason": @"missing-or-ambiguous-existing-source"};
  return @{@"eligible": @YES, @"ownerIdentity": ORPCMIdentity(owner),
      @"engineIdentity": ORPCMIdentity(engine), @"sourceIdentity": ORPCMIdentity(source),
      @"format": ORPCMFormat([source outputFormatForBus:0]), @"engineRunning": @(engine.running),
      @"outputVolume": @(AVAudioSession.sharedInstance.outputVolume)};
}

- (NSDictionary *)arm:(NSDictionary *)command API_AVAILABLE(ios(27.0)) {
  if (_buffer) return @{@"error": @"one-capture-per-launch"};
  NSDictionary *description = [self describe];
  double seconds = [command[@"maximumSeconds"] doubleValue];
  if (![description[@"eligible"] isEqual:@YES] || ![description[@"engineRunning"] isEqual:@YES] ||
      ![description[@"sourceIdentity"] isEqual:command[@"sourceIdentity"]] ||
      ![description[@"engineIdentity"] isEqual:command[@"engineIdentity"]] ||
      !ORPCMToken(command[@"readingToken"]) ||
      ![command[@"attribution"] isEqual:@"sole-current-reading-no-other-audio"] ||
      !std::isfinite(seconds) || seconds <= 0 || seconds > 10 ||
      AVAudioSession.sharedInstance.outputVolume != 0)
    return @{@"error": @"source-attribution-running-format-duration-or-volume-control"};
  _owner = AudioEngine.sharedInstance; _engine = _owner.audioEngine;
  _source = [self soleSource:_engine]; _format = [_source outputFormatForBus:0];
  if (!_source || ![[self describe] isEqual:description] ||
      _format.commonFormat != AVAudioPCMFormatFloat32)
    return @{@"error": @"source-changed-or-non-float32-format"};
  try {
    _buffer = std::make_shared<CaptureBuffer>(
        Format{_format.sampleRate, _format.channelCount, (bool)_format.interleaved}, seconds,
        Timebase{_timebase.numer, _timebase.denom});
  } catch (...) { return @{@"error": @"unsupported-format-or-preallocation-failed"}; }
  _maximumSeconds = seconds;
  _attribution = @{@"readingToken": command[@"readingToken"], @"declaration": command[@"attribution"],
      @"description": description, @"bus": @0, @"target": @"existing-sole-AVAudioSourceNode-output",
      @"registrationUUID": @"not-read-mutable-library-dictionary",
      @"limit": @"Caller must independently prove sole current Reading; not device/acoustic output."};
  [self addAnchor:@"arm-before-install"];
  auto storage = _buffer;
  const Format expected{_format.sampleRate, _format.channelCount, (bool)_format.interleaved};
  NSError *error = nil;
  BOOL installed = [_source installTapOnBus:0 bufferSize:(AVAudioFrameCount)std::ceil(expected.sampleRate * .1)
      format:nil error:&error block:^(AVAudioPCMBuffer *pcm, AVAudioTime *when) {
        // No Objective-C collection construction, logging, JS, file access or
        // retained Apple pointers here. shared_ptr ownership survives late calls.
        auto lease = storage->callbackLease();
        if (!lease) return;
        const uint64_t arrival = mach_absolute_time();
        AVAudioFormat *format = pcm.format;
        Format actual{format.sampleRate, format.channelCount, (bool)format.interleaved};
        if (format.commonFormat != AVAudioPCMFormatFloat32 || actual.channels > CaptureBuffer::maxChannels) {
          storage->invalidate(FormatChanged); return;
        }
        std::array<const float *, CaptureBuffer::maxChannels> planes{};
        const AudioBufferList *list = pcm.audioBufferList;
        const uint32_t buffers = actual.interleaved ? 1 : actual.channels;
        if (list->mNumberBuffers != buffers) { storage->invalidate(InvalidSamples); return; }
        for (uint32_t c = 0; c < buffers; ++c) {
          const uint32_t channels = actual.interleaved ? actual.channels : 1;
          if (list->mBuffers[c].mNumberChannels != channels ||
              list->mBuffers[c].mDataByteSize < (uint64_t)pcm.frameLength * channels * sizeof(float)) {
            storage->invalidate(InvalidSamples); return;
          }
          planes[c] = static_cast<const float *>(list->mBuffers[c].mData);
        }
        storage->append(planes, pcm.frameLength, actual,
            Timestamp{(bool)when.sampleTimeValid, (bool)when.hostTimeValid, when.sampleTime,
                      when.sampleRate, when.hostTime}, arrival);
      }];
  if (!installed) {
    _buffer->stop();
    // Never remove a tap after a failed install: it may belong to somebody else.
    return @{@"error": @"public-tap-install-failed", @"errorDomain": error.domain ?: @"none",
             @"errorCode": @(error.code)};
  }
  _ownsTap = YES;
  _configurationObserver = [NSNotificationCenter.defaultCenter
      addObserverForName:AVAudioEngineConfigurationChangeNotification object:_engine queue:nil
      usingBlock:^(NSNotification *note) { storage->invalidate(ConfigurationChanged); }];
  _captureExpires = NSProcessInfo.processInfo.systemUptime + seconds;
  [self addAnchor:@"arm-after-install"]; [self sampleVolume];
  if (![self identityUnchanged]) _buffer->invalidate(IdentityChanged);
  return @{@"armed": @YES, @"format": ORPCMFormat(_format), @"maximumSeconds": @(seconds),
      @"capacityFrames": @(_buffer->capacity()), @"requestedTapFrames": @(std::ceil(expected.sampleRate * .1))};
}

- (void)disarm {
  if (!_buffer || _removalAttempted) return;
  _removalAttempted = YES;
  [self addAnchor:@"disarm-before-remove"];
  if (_ownsTap && ![self identityUnchanged]) _buffer->invalidate(IdentityChanged);
  [self sampleVolume];
  _buffer->stop();
  if (_ownsTap) {
    @try { [_source removeTapOnBus:0]; _ownsTap = NO; }
    @catch (NSException *exception) { _buffer->invalidate(CleanupUncertain); }
  }
  if (_configurationObserver) {
    [NSNotificationCenter.defaultCenter removeObserver:_configurationObserver]; _configurationObserver = nil;
  }
  _removed = !_ownsTap;
  [self addAnchor:@"disarm-after-remove"];
}

- (NSDictionary *)drain {
  if (!_buffer || !_removed) return @{@"error": @"disarm-owned-tap-first"};
  if (_exported) return @{@"exported": @YES, @"file": @"capture.json"};
  // Off render thread. Stopped storage never accepts a new writer, and the
  // block owns its memory even if AVFAudio delivers a delayed stopped callback.
  const double end = NSProcessInfo.processInfo.systemUptime + .25;
  while (!_buffer->quiescent() && NSProcessInfo.processInfo.systemUptime < end)
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  if (!_buffer->quiescent()) {
    _buffer->invalidate(CleanupUncertain);
    return @{@"error": @"quiescence-timeout-storage-retained"};
  }
  NSMutableArray *records = [NSMutableArray new];
  for (uint32_t i = 0; i < _buffer->recordCount(); ++i) {
    const auto &r = _buffer->records()[i];
    [records addObject:@{@"frameOffset": @(r.frameOffset), @"frames": @(r.frames),
        @"sampleTimeValid": @(r.time.sampleTimeValid), @"hostTimeValid": @(r.time.hostTimeValid),
        @"sampleTime": @(r.time.sampleTime).stringValue,
        @"timestampSampleRate": std::isfinite(r.time.sampleRate) ? @(r.time.sampleRate) : NSNull.null,
        @"hostTime": @(r.time.hostTime).stringValue, @"arrivalHostTime": @(r.arrivalHostTime).stringValue}];
  }
  NSData *pcm = [NSData dataWithBytes:_buffer->samples()
      length:_buffer->frameCount() * _format.channelCount * sizeof(float)];
  NSURL *file = [_directory URLByAppendingPathComponent:@"capture.f32le"];
  if ([NSFileManager.defaultManager fileExistsAtPath:file.path] ||
      ![pcm writeToURL:file options:NSDataWritingAtomic error:nil])
    return @{@"error": @"pcm-export-failed-or-existing"};
  NSDictionary *receipt = @{@"schema": ORPCMSchema, @"run": _run, @"build": _build,
      @"status": _buffer->failures() || !_buffer->frameCount() ? @"INCOMPLETE" : @"CAPTURED_QUALIFICATION_PENDING",
      @"failureBits": @(_buffer->failures()), @"frameCount": @(_buffer->frameCount()),
      @"format": ORPCMFormat(_format), @"storage": @"float32-little-endian-interleaved",
      @"maximumSeconds": @(_maximumSeconds), @"metadataCapacity": @(CaptureBuffer::maxRecords),
      @"timestampToleranceFrames": @(CaptureBuffer::timestampToleranceFrames),
      @"machTimebase": @{@"numer": @(_timebase.numer), @"denom": @(_timebase.denom)},
      @"attribution": _attribution ?: @{}, @"anchors": _anchors, @"volumeSamples": _volumeSamples,
      @"records": records, @"pcmSHA256": ORPCMHash(pcm), @"tapRemoved": @YES, @"quiescent": @YES,
      @"coordinate": @"output frames / actual buffer sample rate; NOT content cursor or multiplied by playback rate",
      @"identityCheck": @"retained objects + public attachedNodes/format checked at 50ms polls and disarm; config notification invalidates",
      @"limit": @"Pre-mixer/pre-device-gain PCM, not acoustic proof. Native no-change/mutation qualification required."};
  _exported = [self writeJSON:receipt name:@"capture.json"];
  return _exported ? @{@"exported": @YES, @"file": @"capture.json", @"failureBits": @(_buffer->failures())}
                   : @{@"error": @"metadata-export-failed-pcm-retained"};
}

- (NSDictionary *)handle:(NSDictionary *)command API_AVAILABLE(ios(27.0)) {
  NSString *action = command[@"do"];
  NSSet *common = [NSSet setWithArray:@[@"seq", @"do", @"run"]];
  NSMutableSet *allowed = [common mutableCopy];
  if ([action isEqual:@"arm"]) [allowed addObjectsFromArray:@[@"maximumSeconds", @"sourceIdentity",
      @"engineIdentity", @"readingToken", @"attribution"]];
  if ([action isEqual:@"anchor"]) [allowed addObject:@"label"];
  if (![[NSSet setWithArray:command.allKeys] isSubsetOfSet:allowed]) return @{@"error": @"unknown-field"};
  if ([action isEqual:@"describe"]) return [self describe];
  if ([action isEqual:@"arm"]) return [self arm:command];
  if ([action isEqual:@"state"]) return @{@"collecting": @(_buffer && _buffer->accepting()),
      @"failureBits": @(_buffer ? _buffer->failures() : 0), @"ownsTap": @(_ownsTap), @"exported": @(_exported),
      @"observedFrames": @(_buffer ? _buffer->observedFrameCount() : 0),
      @"outputCoverageEndHostTime": @(_buffer ? _buffer->coverageEndHostTime() : 0).stringValue};
  if ([action isEqual:@"anchor"]) {
    if (![@[@"measurement-start", @"display-start", @"display-end", @"measurement-end"] containsObject:command[@"label"]])
      return @{@"error": @"unknown-anchor"};
    [self addAnchor:command[@"label"]]; return @{@"anchor": _anchors.lastObject};
  }
  if ([action isEqual:@"disarm"]) { [self disarm]; return @{@"tapRemoved": @(_removed)}; }
  if ([action isEqual:@"drain"]) return [self drain];
  if ([action isEqual:@"shutdown"]) {
    [self disarm]; NSDictionary *result = _buffer ? [self drain] : @{@"noCapture": @YES};
    _shutdown = YES; dispatch_source_cancel(_timer); _timer = nil;
    return @{@"shutdown": @YES, @"drain": result, @"ownsTap": @(_ownsTap)};
  }
  return @{@"error": @"unknown-command"};
}

- (void)tick {
  @autoreleasepool {
    if (_shutdown) return;
    const double now = NSProcessInfo.processInfo.systemUptime;
    if (_buffer && _ownsTap && !_removalAttempted) {
      if (![self identityUnchanged]) _buffer->invalidate(IdentityChanged);
      [self sampleVolume];
      if (now >= _captureExpires) _buffer->invalidate(DeadlineExceeded);
      if (!_buffer->accepting()) [self disarm];
    }
    if (now >= _expires) {
      [self disarm]; NSDictionary *drain = _buffer ? [self drain] : @{@"noCapture": @YES};
      [self writeJSON:@{@"expired": @YES, @"ownsTap": @(_ownsTap), @"drain": drain} name:@"expired.json"];
      _shutdown = YES; dispatch_source_cancel(_timer); _timer = nil; return;
    }
    NSURL *file = [_directory URLByAppendingPathComponent:@"command.json"];
    NSDictionary *attributes = [NSFileManager.defaultManager attributesOfItemAtPath:file.path error:nil];
    if (!attributes || [attributes[NSFileSize] unsignedLongLongValue] > 4096) return;
    NSData *data = [NSData dataWithContentsOfURL:file];
    id command = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    if (![command isKindOfClass:NSDictionary.class] || ![command[@"run"] isEqual:_run] ||
        ![command[@"seq"] isKindOfClass:NSNumber.class]) return;
    const double seq = [command[@"seq"] doubleValue];
    if (!std::isfinite(seq) || seq < 1 || seq > 1000000 || std::floor(seq) != seq || seq <= _seen) return;
    _seen = (uint64_t)seq;
    NSDictionary *answer;
    @try {
      if (@available(iOS 27.0, *)) answer = [self handle:command];
      else answer = @{@"error": @"iOS-27-required"};
    } @catch (NSException *exception) {
      if (_buffer) _buffer->invalidate(CleanupUncertain);
      [self disarm]; answer = @{@"error": @"native-control-exception-inspect-private-artifacts"};
    }
    [self writeJSON:@{@"schema": ORPCMSchema, @"run": _run, @"seq": @(_seen),
        @"clock": ORPCMClock(), @"answer": answer} name:[NSString stringWithFormat:@"answer-%llu.json", (unsigned long long)_seen]];
  }
}
@end
#endif
