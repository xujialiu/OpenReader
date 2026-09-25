#pragma once
// Host-only session, graph ownership and event delivery. The queue source,
// buffer processor and WSOLA under test are the production C++ files.
#include <audioapi/utils/AudioBuffer.hpp>
#include <atomic>
#include <memory>
#include <vector>
#include <cstdint>
namespace audioapi {
struct BufferEndedPayload { size_t bufferId; bool isLastBufferInQueue; };
enum class AudioEvent { BUFFER_ENDED };
struct AudioEventHandlerRegistry {
  struct End { size_t id; size_t frame; bool last; };
  size_t frame=0;
  std::vector<End> ends;
  std::vector<double> positions;
};
template<AudioEvent E> struct EventCaller {
  std::shared_ptr<AudioEventHandlerRegistry> events;
  explicit EventCaller(std::shared_ptr<AudioEventHandlerRegistry> e):events(e){}
  void assignCallbackId(uint64_t){}
  void dispatchFromAudioThread(BufferEndedPayload p){events->ends.push_back({p.bufferId,events->frame,p.isLastBufferInQueue});}
};
struct AudioGraphManager { void addAudioBufferForDestruction(std::shared_ptr<AudioBuffer>){} };
struct BaseAudioContext {
  float hz=48000; size_t frame=0;
  std::shared_ptr<AudioGraphManager> graph=std::make_shared<AudioGraphManager>();
  std::shared_ptr<AudioEventHandlerRegistry> events=std::make_shared<AudioEventHandlerRegistry>();
  float getSampleRate()const{return hz;}
  double getCurrentTime()const{return frame/double(hz);}
  size_t getCurrentSampleFrame()const{return frame;}
  auto getGraphManager()const{return graph;}
  auto getAudioEventHandlerRegistry()const{return events;}
};
struct AudioParam { float value=1; float processKRateParam(int,double)const{return value;} };
struct BaseAudioBufferSourceOptions { bool pitchCorrection=true; };
enum class PlaybackState { UNSCHEDULED };
struct AudioScheduledSourceNode {
  std::weak_ptr<BaseAudioContext> context_;
  std::atomic<bool> isInitialized_{false};
  int channelCount_=1; std::shared_ptr<DSPAudioBuffer> audioBuffer_;
  double stopTime_=-1,startTime_=-1; PlaybackState playbackState_=PlaybackState::UNSCHEDULED;
  bool playing_=false;
  explicit AudioScheduledSourceNode(std::shared_ptr<BaseAudioContext> c):context_(c){}
  virtual ~AudioScheduledSourceNode()=default;
  virtual void stop(double){playing_=false;}
  virtual void start(double){playing_=true;}
  virtual void disable(){playing_=false;}
  bool isPlaying()const{return playing_;} bool isStopScheduled()const{return false;}
  float getContextSampleRate()const{return context_.lock()->hz;}
  void updatePlaybackInfo(const std::shared_ptr<DSPAudioBuffer>&,int frames,size_t &offset,size_t &length,float,size_t){offset=0;length=playing_?frames:0;}
};
struct AudioBufferBaseSourceNode:AudioScheduledSourceNode {
  double vReadIndex_=0;
  std::shared_ptr<AudioParam> rate=std::make_shared<AudioParam>(),detune=std::make_shared<AudioParam>();
  AudioBufferBaseSourceNode(std::shared_ptr<BaseAudioContext> c,const BaseAudioBufferSourceOptions&):AudioScheduledSourceNode(c){detune->value=0;}
  virtual void initStretch(size_t,float,const std::shared_ptr<DSPAudioBuffer>&){}
  auto getPlaybackRateParam()const{return rate;} auto getDetuneParam()const{return detune;}
  void reportOutputPosition(int){context_.lock()->events->positions.push_back(getCurrentPosition());}
  virtual double getCurrentPosition()const=0;
  virtual bool isEmpty()const=0;
  virtual void processWithPitchCorrection(const std::shared_ptr<DSPAudioBuffer>&,int)=0;
  virtual void runBufferProcessor(const std::shared_ptr<DSPAudioBuffer>&,size_t,size_t,float,bool)=0;
};
}
