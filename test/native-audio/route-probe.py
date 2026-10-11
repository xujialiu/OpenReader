from pathlib import Path
import sys
root = Path.cwd()
out = Path(sys.argv[1])
out.mkdir(exist_ok=True)
lib = root / 'node_modules/react-native-audio-api/ios/audioapi/ios/system'
def method(file, signature):
    text = (lib / file).read_text()
    start = text.index(signature + '\n{')
    begin = text.index('{', start)
    depth = 1
    end = begin + 1
    while depth:
        depth += (text[end] == '{') - (text[end] == '}')
        end += 1
    return text[start:end]
engine = '\n'.join(method('AudioEngine.mm', s) for s in [
    '- (void)rebuildAudioEngineAndResumeIfNeeded', '- (void)restartAudioEngine', '- (void)pauseIfNecessary',
    '- (void)onInterruptionBegin', '- (void)onInterruptionEnd:(bool)shouldResume', '- (void)stopEngine'])
notification = '\n'.join(method('SystemNotificationManager.mm', s) for s in [
    '- (void)handleRouteChange:(NSNotification *)notification', '- (void)handleEngineConfigurationChange:(NSNotification *)notification'])
(out/'methods.inc').write_text(engine+'\n'+notification)
import shutil
shutil.copytree(root/'test/native-audio/stubs',out/'stubs',dirs_exist_ok=True)
stub=out/'stubs/support.hpp'
stub.write_text(stub.read_text().replace('enum class AudioEvent { BUFFER_ENDED };','enum class AudioEvent { BUFFER_ENDED, ROUTE_CHANGE };'))
source = r'''
#import <Foundation/Foundation.h>
#include <mutex>
#include <vector>
#include <functional>
QUEUE_ADAPTER
// Native diagnostics transport is outside this route/queue behavior test.
static void ORAudioTrace(NSString *, NSInteger, BOOL) {}
static std::vector<std::function<void()>> tasks;
static void *hostMainQueue() { return nullptr; }
static void hostDispatch(void *, void (^block)(void)) { tasks.push_back([block]{ block(); }); }
#define dispatch_get_main_queue hostMainQueue
#define dispatch_async hostDispatch
static void drainMain() { while(!tasks.empty()) { auto task=tasks.front();tasks.erase(tasks.begin());task(); } }
static NSString *AVAudioSessionRouteChangeReasonKey = @"reason";
enum { AVAudioSessionRouteChangeReasonUnknown, AVAudioSessionRouteChangeReasonNewDeviceAvailable,
AVAudioSessionRouteChangeReasonOldDeviceUnavailable, AVAudioSessionRouteChangeReasonCategoryChange,
AVAudioSessionRouteChangeReasonOverride, AVAudioSessionRouteChangeReasonWakeFromSleep,
AVAudioSessionRouteChangeReasonNoSuitableRouteForCategory, AVAudioSessionRouteChangeReasonRouteConfigurationChange };
namespace audioapi { struct StringPayload { std::string name, reason; }; }
enum class AudioEngineState { AudioEngineStateIdle, AudioEngineStateRunning, AudioEngineStatePaused, AudioEngineStateInterrupted };
@interface Hardware : NSObject
@property BOOL running;
- (BOOL)isRunning;
- (void)stop;
- (void)pause;
- (void)prepare;
- (BOOL)startAndReturnError:(NSError **)error;
@end
@implementation Hardware
- (BOOL)isRunning { return self.running; }
- (void)stop { self.running=NO; }
- (void)pause { self.running=NO; }
- (void)prepare {}
- (BOOL)startAndReturnError:(NSError **)error { self.running=YES; return YES; }
@end
@interface AudioEngine : NSObject { std::recursive_mutex _engineLock; BOOL _isRebuildingAudioEngine; }
@property AudioEngineState state;
@property BOOL sessionDeactivationInvalidatedGraph;
@property(strong) Hardware *audioEngine;
- (void)rebuildAudioEngine;
- (bool)startEngine;
- (void)notifyConfigurationChanges;
- (void)restartAudioEngine;
- (void)rebuildAudioEngineAndResumeIfNeeded;
- (void)pauseIfNecessary;
- (void)onInterruptionBegin;
- (void)onInterruptionEnd:(bool)shouldResume;
- (void)stopEngine;
@end
@implementation AudioEngine
- (void)rebuildAudioEngine { self.audioEngine=[Hardware new]; }
- (bool)startEngine { self.audioEngine.running=YES; self.state=AudioEngineState::AudioEngineStateRunning; return true; }
- (void)notifyConfigurationChanges {}
ENGINE_METHODS
@end
@interface AudioSessionManager : NSObject
- (void)markInactive;
@end
@implementation AudioSessionManager
- (void)markInactive {}
@end
@interface AudioAPIModule : NSObject
@property(strong) AudioEngine *audioEngine;
@property(strong) AudioSessionManager *audioSessionManager;
@property BOOL outputLostPending;
- (void)invokeHandlerWithEventName:(audioapi::AudioEvent)event payload:(audioapi::StringPayload)payload;
@end
@implementation AudioAPIModule
- (void)invokeHandlerWithEventName:(audioapi::AudioEvent)event payload:(audioapi::StringPayload)payload {
 if(payload.reason=="OldDeviceUnavailable")self.outputLostPending=YES;
}
@end
@interface SystemNotificationManager : NSObject
@property(strong) AudioAPIModule *audioAPIModule;
- (void)handleRouteChange:(NSNotification *)notification;
- (void)handleEngineConfigurationChange:(NSNotification *)notification;
@end
@implementation SystemNotificationManager
NOTIFICATION_METHODS
@end
int main(int argc, char **argv) { @autoreleasepool { try {
 auto c=std::make_shared<audioapi::BaseAudioContext>(); Queue q(c); q.rate->value=1.55;
 q.add(1,std::vector<float>(48000*10,.2f));
 for(int i=0;i<375;++i)q.render();
 const double heard=q.position();
 AudioEngine *engine=[AudioEngine new]; [engine rebuildAudioEngine]; [engine startEngine];
 AudioAPIModule *module=[AudioAPIModule new]; module.audioEngine=engine;module.audioSessionManager=[AudioSessionManager new];
 SystemNotificationManager *notifications=[SystemNotificationManager new];notifications.audioAPIModule=module;
 const std::string mode=argc>1?argv[1]:"baseline";
 if(mode=="interruption") {
   [engine.audioEngine stop]; [engine onInterruptionBegin]; [engine onInterruptionEnd:true];
   require(engine.audioEngine.isRunning,"ordinary interruption no longer resumes");
   [engine.audioEngine stop]; [engine onInterruptionBegin]; [engine onInterruptionEnd:false];
   require(!engine.audioEngine.isRunning,"interruption without resume permission started");
   std::cout<<"PASS ordinary interruption resume policy\n"; return 0;
 }
 // iOS stops the old hardware; the library's desired state is still Running.
 [engine.audioEngine stop];
 NSNotification *lost=[NSNotification notificationWithName:@"route" object:nil userInfo:@{AVAudioSessionRouteChangeReasonKey:@(AVAudioSessionRouteChangeReasonOldDeviceUnavailable)}];
 if(mode!="no-route") [notifications handleRouteChange:lost];
 if(mode=="immediate-js" && module.outputLostPending) { q.pause(); [engine pauseIfNecessary]; }
 drainMain();
 // JS route delivery is delayed. Render ~0.9 s on replacement output, not the departed headphones.
 for(int i=0;i<338;++i)if(engine.audioEngine.isRunning)q.render();
 if(module.outputLostPending) { q.pause(); [engine pauseIfNecessary]; }
 const double resumed=q.position();
 std::cout<<"last headphone content="<<heard<<" resume content="<<resumed<<" skipped="<<resumed-heard<<" s ("<<(resumed-heard)/.25<<" synthetic 250ms words)\n";
 require(std::abs(resumed-heard)<.001,"output loss skipped unheard content before JS pause");
 if(mode=="no-route") { std::cout<<"PASS no route rebuild control\n"; return 0; }
 // Reconnection/configuration and a late interruption end must not auto-play.
 [notifications handleRouteChange:[NSNotification notificationWithName:@"route" object:nil userInfo:@{AVAudioSessionRouteChangeReasonKey:@(AVAudioSessionRouteChangeReasonNewDeviceAvailable)}]];
 drainMain(); [engine onInterruptionBegin]; [engine onInterruptionEnd:true];
 require(!engine.audioEngine.isRunning,"reconnection or late interruption reclaimed output");
 [engine startEngine]; q.start(0,-1); q.render();
 require(engine.audioEngine.isRunning && q.position()>resumed,"explicit Play did not resume retained content");
 std::cout<<"PASS output loss, reconnect, late interruption and explicit Play\n";
 }catch(const std::exception&e){std::cerr<<"FAIL "<<e.what()<<"\n";return 1;} } }
'''
queue_adapter=(root/'test/native-audio/queue.cpp').read_text().split('int main(',1)[0]
assert 'struct Queue:' in queue_adapter
source=source.replace('QUEUE_ADAPTER',queue_adapter).replace('ENGINE_METHODS',engine).replace('NOTIFICATION_METHODS',notification)
(out/'probe.mm').write_text(source)
