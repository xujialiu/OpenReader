// Test-only existing-node observer. The installer alone adds this translation
// unit to an external diagnostic project. It is inert on devices/Release and
// without BOTH the Debug-role receipt and an explicit expiring launch token.
#import <TargetConditionals.h>
#if TARGET_OS_SIMULATOR && DEBUG && OPENREADER_PCM_TEST_ONLY
#if !__has_feature(objc_arc)
#error "Native PCM observer requires ARC strong pending-description ownership."
#endif
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

// Public-getter adapter: only these bounded read-only buffer/time/format
// getters are permitted during Apple's valid callback lifetime. Borrowed ARC
// references do not manage ownership here. The portable append path below has
// no Objective-C calls; actual getter/ARC allocation and latency remain HOLD.
static void ORPCMCopyPublicTap(CaptureBuffer &storage, AVAudioPCMBuffer *__unsafe_unretained pcm,
                             AVAudioTime *__unsafe_unretained when,
                             const AudioStreamBasicDescription &expectedASBD) {
  auto lease = storage.callbackLease();
  if (!lease) return;
  const uint64_t arrival = mach_absolute_time();
  AVAudioFormat *__unsafe_unretained actualFormat = pcm.format;
  const AudioStreamBasicDescription *description = actualFormat.streamDescription;
  if (!description) { storage.invalidate(FormatChanged); return; }
  const AudioStreamBasicDescription actualASBD = *description;
  if (actualASBD.mSampleRate != expectedASBD.mSampleRate ||
      actualASBD.mFormatID != expectedASBD.mFormatID || actualASBD.mFormatFlags != expectedASBD.mFormatFlags ||
      actualASBD.mBytesPerPacket != expectedASBD.mBytesPerPacket || actualASBD.mFramesPerPacket != expectedASBD.mFramesPerPacket ||
      actualASBD.mBytesPerFrame != expectedASBD.mBytesPerFrame || actualASBD.mChannelsPerFrame != expectedASBD.mChannelsPerFrame ||
      actualASBD.mBitsPerChannel != expectedASBD.mBitsPerChannel) {
    storage.invalidate(FormatChanged); return;
  }
  const Format actual{actualASBD.mSampleRate, actualASBD.mChannelsPerFrame,
                      !(actualASBD.mFormatFlags & kAudioFormatFlagIsNonInterleaved)};
  const AVAudioFrameCount frames = pcm.frameLength;
  const AudioBufferList *list = pcm.audioBufferList;
  const Timestamp timestamp{(bool)when.sampleTimeValid, (bool)when.hostTimeValid, when.sampleTime,
                            when.sampleRate, when.hostTime};
  std::array<const float *, CaptureBuffer::maxChannels> planes{};
  const uint32_t buffers = actual.interleaved ? 1 : actual.channels;
  if (!list || actual.channels > CaptureBuffer::maxChannels || list->mNumberBuffers != buffers) {
    storage.invalidate(InvalidSamples); return;
  }
  for (uint32_t c = 0; c < buffers; ++c) {
    const uint32_t channels = actual.interleaved ? actual.channels : 1;
    if (list->mBuffers[c].mNumberChannels != channels ||
        list->mBuffers[c].mDataByteSize < (uint64_t)frames * channels * sizeof(float)) {
      storage.invalidate(InvalidSamples); return;
    }
    planes[c] = static_cast<const float *>(list->mBuffers[c].mData);
  }
  storage.append(planes, frames, actual, timestamp, arrival);
}

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
  std::shared_ptr<DescriptionState> _descriptionState;
  AVAudioEngine *_describedEngine;
  AVAudioSourceNode *_describedSource;
  AVAudioFormat *_describedFormat;
  NSDictionary *_description;
  NSString *_descriptionToken;
  uint64_t _descriptionGeneration;
  id _descriptionConfigurationObserver, _descriptionLifecycleObserver;
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
  id _configurationObserver, _lifecycleObserver;
  BOOL _ownsTap, _removed, _removalAttempted, _exported, _shutdown;
  uint64_t _seen;
  double _expires, _captureExpires, _maximumSeconds;
  mach_timebase_info_data_t _timebase;
}
- (instancetype)initWithRun:(NSString *)run build:(NSDictionary *)build;
- (void)tick;
- (void)removeGraphObservers;
- (void)clearDescription;
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
  return _engine.running && _source.engine == _engine && [self soleSource:_engine] == _source &&
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

- (void)clearDescription {
  if (_descriptionState) _descriptionState->retire();
  // Do not keep observer tokens in an autoreleased array across a same-turn
  // disarm/drain; their block-owned leases must be free to retire now.
  if (_descriptionConfigurationObserver) [NSNotificationCenter.defaultCenter removeObserver:_descriptionConfigurationObserver];
  _descriptionConfigurationObserver = nil;
  if (_descriptionLifecycleObserver) [NSNotificationCenter.defaultCenter removeObserver:_descriptionLifecycleObserver];
  _descriptionLifecycleObserver = nil;
  _describedEngine = nil; _describedSource = nil; _describedFormat = nil;
  _description = nil; _descriptionToken = nil; _descriptionState.reset();
}

- (NSDictionary *)describe {
  [self clearDescription];
  if (_buffer) return @{@"eligible": @NO, @"reason": @"one-capture-per-launch"};
  if (!_timebase.numer || !_timebase.denom) return @{@"eligible": @NO, @"reason": @"invalid-mach-timebase"};
  if (![AudioEngine respondsToSelector:@selector(or_pcmTestEngineSnapshot)])
    return @{@"eligible": @NO, @"reason": @"test-build-locked-snapshot-accessor-missing"};
  const uint64_t deadline = mach_absolute_time() + (uint64_t)(5e9L * _timebase.denom / _timebase.numer);
  auto descriptionState = std::make_shared<DescriptionState>(++_descriptionGeneration, deadline);
  _descriptionState = descriptionState;
  // Block-owned registrations account for dispatch before callback entry and
  // survive ticket retirement; capture keeps the SAME cancellation state.
  auto descriptionConfigurationLease = descriptionState->lifecycle()->observe();
  auto descriptionLifecycleLease = descriptionState->lifecycle()->observe();
  if (!descriptionConfigurationLease || !descriptionLifecycleLease) {
    [self clearDescription]; return @{@"eligible": @NO, @"reason": @"notification-registration-closed"};
  }
  _descriptionConfigurationObserver = [NSNotificationCenter.defaultCenter
      addObserverForName:AVAudioEngineConfigurationChangeNotification object:nil queue:nil
      usingBlock:^(NSNotification *note) {
        auto notification = descriptionConfigurationLease->callback();
        notification.cancel();
      }];
  _descriptionLifecycleObserver = [NSNotificationCenter.defaultCenter
      addObserverForName:@"OpenReaderAudioTrace" object:nil queue:nil usingBlock:^(NSNotification *note) {
        auto notification = descriptionLifecycleLease->callback();
        NSString *event = note.userInfo[@"event"];
        if ([event hasPrefix:@"engine."] || [event hasPrefix:@"interruption."]) notification.cancel();
      }];
  // Strong ivars keep these precise objects alive across file commands, so a
  // retired source's address cannot be recycled into the pending description.
  _describedEngine = [AudioEngine or_pcmTestEngineSnapshot];
  _describedSource = [self soleSource:_describedEngine];
  _describedFormat = [_describedSource outputFormatForBus:0];
  if (!_describedEngine || !_describedSource || _describedSource.engine != _describedEngine ||
      [self soleSource:_describedEngine] != _describedSource || !_describedEngine.running ||
      !descriptionState->usable(_descriptionGeneration, mach_absolute_time())) {
    [self clearDescription];
    return @{@"eligible": @NO, @"reason": @"missing-ambiguous-or-changed-existing-source"};
  }
  _descriptionToken = NSUUID.UUID.UUIDString;
  _description = @{@"eligible": @YES, @"descriptionToken": _descriptionToken,
      @"descriptionGeneration": @(_descriptionGeneration), @"validForSeconds": @5,
      @"engineIdentity": ORPCMIdentity(_describedEngine), @"sourceIdentity": ORPCMIdentity(_describedSource),
      @"format": ORPCMFormat(_describedFormat), @"engineRunning": @(_describedEngine.running),
      @"outputVolume": @(AVAudioSession.sharedInstance.outputVolume)};
  return _description;
}

- (NSDictionary *)arm:(NSDictionary *)command API_AVAILABLE(ios(27.0)) {
  if (_buffer) return @{@"error": @"one-capture-per-launch"};
  if (!_descriptionState || ![command[@"descriptionGeneration"] isKindOfClass:NSNumber.class] ||
      [command[@"descriptionGeneration"] doubleValue] != _descriptionGeneration ||
      ![_descriptionToken isEqual:command[@"descriptionToken"]] ||
      !_descriptionState->usable(_descriptionGeneration, mach_absolute_time())) {
    [self clearDescription]; return @{@"error": @"description-stale-expired-or-cancelled"};
  }
  NSDictionary *description = _description;
  double seconds = [command[@"maximumSeconds"] doubleValue];
  if (![description[@"eligible"] isEqual:@YES] || ![description[@"engineRunning"] isEqual:@YES] ||
      ![description[@"sourceIdentity"] isEqual:command[@"sourceIdentity"]] ||
      ![description[@"engineIdentity"] isEqual:command[@"engineIdentity"]] ||
      !ORPCMToken(command[@"readingToken"]) ||
      ![command[@"attribution"] isEqual:@"sole-current-reading-no-other-audio"] ||
      !std::isfinite(seconds) || seconds <= 0 || seconds > 10 ||
      AVAudioSession.sharedInstance.outputVolume != 0)
    return @{@"error": @"source-attribution-running-format-duration-or-volume-control"};
  AVAudioEngine *currentEngine = [AudioEngine or_pcmTestEngineSnapshot];
  if (currentEngine != _describedEngine || [self soleSource:currentEngine] != _describedSource ||
      _describedSource.engine != _describedEngine || !_describedEngine.running ||
      ![[_describedSource outputFormatForBus:0] isEqual:_describedFormat] ||
      _describedFormat.commonFormat != AVAudioPCMFormatFloat32) {
    [self clearDescription]; return @{@"error": @"described-object-changed-or-non-float32-format"};
  }
  _engine = _describedEngine; _source = _describedSource; _format = _describedFormat;
  auto lifecycle = _descriptionState->lifecycle();
  try {
    _buffer = std::make_shared<CaptureBuffer>(
        Format{_format.sampleRate, _format.channelCount, (bool)_format.interleaved}, seconds,
        Timebase{_timebase.numer, _timebase.denom}, lifecycle);
  } catch (...) { return @{@"error": @"unsupported-format-or-preallocation-failed"}; }
  _maximumSeconds = seconds;
  _attribution = @{@"readingToken": command[@"readingToken"], @"declaration": command[@"attribution"],
      @"description": description, @"bus": @0, @"target": @"existing-sole-AVAudioSourceNode-output",
      @"registrationUUID": @"not-read-mutable-library-dictionary",
      @"limit": @"Caller must independently prove sole current Reading; not device/acoustic output."};
  [self addAnchor:@"arm-before-install"];
  auto storage = _buffer;
  const Format expected{_format.sampleRate, _format.channelCount, (bool)_format.interleaved};
  const AudioStreamBasicDescription expectedASBD = *_format.streamDescription;
  auto captureConfigurationLease = lifecycle->observe();
  auto captureLifecycleLease = lifecycle->observe();
  if (!captureConfigurationLease || !captureLifecycleLease) {
    _buffer->invalidate(CleanupUncertain); [self clearDescription];
    return @{@"error": @"notification-registration-closed"};
  }
  _configurationObserver = [NSNotificationCenter.defaultCenter
      addObserverForName:AVAudioEngineConfigurationChangeNotification object:_engine queue:nil
      usingBlock:^(NSNotification *note) {
        auto notification = captureConfigurationLease->callback();
        notification.cancel();
      }];
  _lifecycleObserver = [NSNotificationCenter.defaultCenter
      addObserverForName:@"OpenReaderAudioTrace" object:nil queue:nil usingBlock:^(NSNotification *note) {
        auto notification = captureLifecycleLease->callback();
        NSString *event = note.userInfo[@"event"];
        if ([event hasPrefix:@"engine."] || [event hasPrefix:@"interruption."])
          notification.cancel();
      }];
  // Overlap handles new delivery; shared cancellation and block-owned leases
  // also carry already-dispatched pending callbacks through this handover.
  if (!_descriptionState->consume(_descriptionGeneration, mach_absolute_time())) {
    _buffer->invalidate(IdentityChanged); [self removeGraphObservers]; [self clearDescription];
    return @{@"error": @"description-cancelled-before-install"};
  }
  [self clearDescription];
  NSError *error = nil;
  BOOL installed = [_source installTapOnBus:0 bufferSize:(AVAudioFrameCount)std::ceil(expected.sampleRate * .1)
      format:nil error:&error block:^(AVAudioPCMBuffer *__unsafe_unretained pcm, AVAudioTime *__unsafe_unretained when) {
        ORPCMCopyPublicTap(*storage, pcm, when, expectedASBD);
      }];
  if (!installed) {
    _buffer->stop();
    [self removeGraphObservers];
    // Never remove a tap after a failed install: it may belong to somebody else.
    return @{@"error": @"public-tap-install-failed", @"errorDomain": error.domain ?: @"none",
             @"errorCode": @(error.code)};
  }
  _ownsTap = YES;
  _captureExpires = NSProcessInfo.processInfo.systemUptime + seconds;
  [self addAnchor:@"arm-after-install"]; [self sampleVolume];
  if (![self identityUnchanged]) _buffer->invalidate(IdentityChanged);
  return @{@"armed": @YES, @"failureBits": @(_buffer->failures()),
      @"format": ORPCMFormat(_format), @"maximumSeconds": @(seconds),
      @"capacityFrames": @(_buffer->capacity()), @"requestedTapFrames": @(std::ceil(expected.sampleRate * .1))};
}

- (void)removeGraphObservers {
  if (_configurationObserver) [NSNotificationCenter.defaultCenter removeObserver:_configurationObserver];
  _configurationObserver = nil;
  if (_lifecycleObserver) [NSNotificationCenter.defaultCenter removeObserver:_lifecycleObserver];
  _lifecycleObserver = nil;
}

- (void)disarm {
  [self clearDescription];
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
  [self removeGraphObservers];
  _removed = !_ownsTap;
  [self addAnchor:@"disarm-after-remove"];
}

- (NSDictionary *)drain {
  if (!_buffer || !_removed) return @{@"error": @"disarm-owned-tap-first"};
  if (_exported) return @{@"exported": @YES, @"file": @"capture.json"};
  // Off render thread. quiescent also seals notification registration only
  // after ALL block-owned observer leases and entered callbacks retire. Public
  // observer removal alone is not proof: retained/delayed blocks time out closed.
  const double end = NSProcessInfo.processInfo.systemUptime + .25;
  while (!_buffer->quiescent() && NSProcessInfo.processInfo.systemUptime < end)
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  if (!_buffer->quiescent()) {
    _buffer->invalidate(CleanupUncertain);
    return @{@"error": @"notification-retirement-or-copy-quiescence-timeout-storage-retained"};
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
      @"notificationRetirement": @"all captured registration leases retired and cancellation sealed before export",
      @"coordinate": @"output frames / actual buffer sample rate; NOT content cursor or multiplied by playback rate",
      @"identityCheck": @"test-build locked retained snapshot; public source.engine/attachedNodes/format/running at 50ms polls + disarm; lifecycle/config notifications invalidate",
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
      @"engineIdentity", @"readingToken", @"attribution", @"descriptionToken", @"descriptionGeneration"]];
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
    if (_descriptionState && (!_descriptionState->usable(_descriptionGeneration, mach_absolute_time()) ||
        !_describedEngine.running || _describedSource.engine != _describedEngine ||
        [self soleSource:_describedEngine] != _describedSource ||
        ![[_describedSource outputFormatForBus:0] isEqual:_describedFormat])) [self clearDescription];
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
