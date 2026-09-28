// EXPERIMENT ONLY. No app integration. Fixed rate, pitch unchanged, mono 48 kHz.
#include <audioapi/dsp/WsolaTimeStretcher.h>
#include <audioapi/utils/AudioBuffer.hpp>
#include <fstream>
#include <iostream>
#include <vector>
#include <cmath>
#include <algorithm>
#include <string>
#include <cstdlib>
using namespace audioapi;
int main(int argc,char**argv){
 if(argc<4 || argc>6)return 2;
 const std::string dir=argv[1], tag=argv[3];const float rate=std::stof(argv[2]);
 const int repeats=argc>4?std::stoi(argv[4]):1;const bool reset=argc>5&&std::string(argv[5])=="reset";
 if(!std::isfinite(rate) || rate<.5f || rate>4 || repeats<1 || repeats>100)return 2;
 std::ifstream f(dir+"/source.f32",std::ios::binary|std::ios::ate);
 if(!f)return 2;
 const auto byteCount=f.tellg(); if(byteCount<=0 || byteCount%4!=0)return 2;
 size_t bytes=static_cast<size_t>(byteCount);f.seekg(0);
 std::vector<float> source(bytes/4);f.read(reinterpret_cast<char*>(source.data()),bytes); if(!f)return 2;
 const size_t length=source.size(),hz=48000;
 std::ofstream audio(dir+"/"+tag+".f32",std::ios::binary),pos(dir+"/"+tag+"-positions.csv"),samples(dir+"/"+tag+"-snippets.f32",std::ios::binary),samplePos(dir+"/"+tag+"-snippets.csv");
 if(!audio || !pos || !samples || !samplePos)return 2;
 pos<<"outputFrame,sourcePosition\n";samplePos<<"outputFrame,sourcePosition,expectedSource,chapter\n";
 size_t globalOut=0,maxInput=0,maxOutput=0,suppliedTotal=0;double firstPosition=0,lastPosition=0,maxSpan=0;
 std::vector<float> snippet;std::vector<double> snippetMap;size_t snippetStart=0;double snippetExpected=0;int snippetChapter=0;
 const bool saveFull=repeats==1 || std::getenv("PULL_SAVE_FULL");
 const int stages=reset?repeats:1;
 for(int stage=0;stage<stages;++stage){
  WsolaTimeStretcher w;w.configure(1,hz);DSPAudioBuffer out(128,1,hz);
  size_t inputCursor=0,localOut=0;const size_t target=length*(reset?1:repeats),origin=reset?stage*length:0;
  bool done=false;
  while(!done){
   const auto n=w.pull(out,128,rate,[&](DSPAudioBuffer &in,size_t needed){
    if(inputCursor+needed>target+hz/5)throw std::runtime_error("unexpected unbounded tail demand");
    auto a=in.getChannel(0)->span();for(size_t i=0;i<needed;++i){size_t at=inputCursor+i;a[i]=at<target?source[at%length]:0;}
    inputCursor+=needed;suppliedTotal+=needed;return needed;
   });
   if(n!=128)throw std::runtime_error("underfilled output");
   const auto &m=w.outputPositions();const auto a=out.getChannel(0)->span();
   maxSpan=std::max(maxSpan,w.maxSourceSpan());
   maxInput=std::max(maxInput,w.getBufferedInputFrames());maxOutput=std::max(maxOutput,w.getBufferedOutputFrames());
   if(saveFull){audio.write(reinterpret_cast<const char*>(a.data()),128*sizeof(float));for(size_t i=0;i<128;i+=32)pos<<globalOut+i<<","<<std::fixed<<origin+m[i]<<"\n";}
   // One independent acoustic sample per second, with a 10 ms window.
   if(globalOut%hz==0){snippet.clear();snippetMap.clear();snippetStart=globalOut;snippetExpected=origin+localOut*static_cast<double>(rate);snippetChapter=stage;}
   if(globalOut%hz<512){snippet.insert(snippet.end(),a.begin(),a.end());for(double v:m)snippetMap.push_back(origin+v);}
   if(snippet.size()==512){
    samples.write(reinterpret_cast<const char*>(snippet.data()),480*sizeof(float));
    samplePos<<snippetStart+240<<","<<std::fixed<<snippetMap[240]<<","<<snippetExpected+240*rate<<","<<snippetChapter<<"\n";
    snippet.clear();snippetMap.clear();
   }
   if(globalOut==0)firstPosition=m[0];lastPosition=origin+m.back();
   localOut+=128;globalOut+=128;
   done=m.back()>=target+hz*.05; // emit the chapter tail before disposing the stretcher
  }
  if(reset&&stage+1<stages){
   // Tail flushing above adds about 50 ms; explicit silence adds another 50 ms.
   const size_t pauseFrames=static_cast<size_t>(std::ceil(.05*hz/128))*128;
   if(saveFull){std::vector<float> silence(pauseFrames,0);audio.write(reinterpret_cast<const char*>(silence.data()),pauseFrames*sizeof(float));}
   globalOut+=pauseFrames;
   // Align snippet cadence after the pause by discarding an unfinished capture.
   snippet.clear();snippetMap.clear();
  }
 }
 std::cout<<"rate="<<rate<<" chapters="<<repeats<<" reset="<<reset<<" renderedSeconds="<<globalOut/double(hz)<<" maxInputFrames="<<maxInput<<" maxOutputFrames="<<maxOutput<<" suppliedFrames="<<suppliedTotal<<" maxSourceSpanMs="<<maxSpan/hz/rate*1000<<" lastSourceFrame="<<lastPosition<<"\n";
}
