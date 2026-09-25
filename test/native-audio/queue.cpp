#include <audioapi/core/sources/AudioBufferQueueSourceNode.h>
#include <cmath>
#include <fstream>
#include <iostream>
#include <string>
#include <stdexcept>
using namespace audioapi;
struct Queue:AudioBufferQueueSourceNode {
 std::shared_ptr<BaseAudioContext> ctx;
 std::shared_ptr<DSPAudioBuffer> out;
 explicit Queue(std::shared_ptr<BaseAudioContext> c):AudioBufferQueueSourceNode(c,{true}),ctx(c),out(std::make_shared<DSPAudioBuffer>(128,1,c->hz)){
  setChannelCount(1);initStretch(1,c->hz,out);start(0,-1);
 }
 void render(){ctx->events->frame=ctx->frame;if(isEmpty())out->zero();else processWithPitchCorrection(out,128);ctx->frame+=128;}
 double position()const{return getCurrentPosition();}
 bool empty()const{return isEmpty();}
 void add(size_t id,const std::vector<float>&v){auto b=std::make_shared<AudioBuffer>(v.size(),1,ctx->hz);std::copy(v.begin(),v.end(),b->getChannel(0)->begin());enqueueBuffer(b,id,nullptr);}
};
void require(bool yes,const char*why){if(!yes)throw std::runtime_error(why);}
int main(int argc,char**argv){try{
 auto c=std::make_shared<BaseAudioContext>();Queue q(c);
 if(argc==5 && std::string(argv[1])=="render"){
  float rate=std::stof(argv[2]);std::string dir=argv[3],tag=argv[4];q.rate->value=rate;
  std::ifstream source(dir+"/source.f32",std::ios::binary),parts(dir+"/parts.txt");require(bool(source)&&bool(parts),"fixture missing");
  size_t n,id=0,total=0;while(parts>>n){std::vector<float> a(n);source.read(reinterpret_cast<char*>(a.data()),n*4);require(bool(source),"short fixture");q.add(id++,a);total+=n;}
  std::ofstream audio(dir+"/"+tag+".f32",std::ios::binary),pos(dir+"/"+tag+"-positions.csv");pos<<"outputFrame,sourcePosition\n";
  while(!q.empty() && c->frame < (total/rate+48000)*1.1){q.render();audio.write(reinterpret_cast<char*>(q.out->getChannel(0)->begin()),128*4);pos<<c->frame-1<<","<<std::fixed<<q.position()*48000<<"\n";}
  require(q.empty(),"queue did not drain");require(c->events->ends.size()==id,"end callbacks missing");
  std::cout<<"PASS rendered "<<c->frame/48000.0<<" seconds; "<<id<<" output-ended callbacks; final content "<<q.position()<<"\n";return 0;
 }
 if(argc==6 && std::string(argv[1])=="long") {
  const float rate=std::stof(argv[2]);const std::string dir=argv[3],tag=argv[5];const size_t repeats=std::stoul(argv[4]);q.rate->value=rate;
  std::ifstream input(dir+"/source.f32",std::ios::binary|std::ios::ate),cuts(dir+"/parts.txt");require(bool(input)&&bool(cuts),"fixture missing");
  size_t bytes=input.tellg();input.seekg(0);std::vector<float> source(bytes/4);input.read(reinterpret_cast<char*>(source.data()),bytes);
  std::vector<std::pair<size_t,size_t>> parts;size_t count,offset=0;while(cuts>>count){parts.push_back({offset,count});offset+=count;}require(offset==source.size(),"bad cuts");
  const size_t total=parts.size()*repeats;size_t next=0;
  std::ofstream samples(dir+"/"+tag+"-snippets.f32",std::ios::binary),positions(dir+"/"+tag+"-snippets.csv");positions<<"outputFrame,sourcePosition,expectedSource,chapter\n";
  std::vector<float> snippet;double midPosition=0;size_t snippetStart=0;
  while(c->frame < (source.size()*repeats/rate+5*48000)) {
   // Keep the fixture bounded in memory, like the application's read-ahead.
   while(next<total && next-c->events->ends.size()<64){auto [at,n]=parts[next%parts.size()];q.add(next,std::vector<float>(source.begin()+at,source.begin()+at+n));++next;}
   if(next==total&&q.empty())break;
   const size_t start=c->frame;const double before=q.position();q.render();c->events->positions.clear();
   if(start%48000==0){snippet.clear();snippetStart=start;}
   if(start%48000<512){auto a=q.out->getChannel(0)->span();snippet.insert(snippet.end(),a.begin(),a.end());}
   if(start%48000==128)midPosition=(before+(q.position()-before)*113.0/128)*48000;
   if(snippet.size()==512){samples.write(reinterpret_cast<char*>(snippet.data()),480*4);positions<<snippetStart+240<<","<<std::fixed<<midPosition<<","<<(snippetStart+240)*double(rate)<<",0\n";snippet.clear();}
  }
  require(q.empty()&&c->events->ends.size()==total,"long run did not finish every buffer");
  require(std::abs(q.position()-source.size()*repeats/48000.0)<1e-5,"long run content endpoint drift");
  std::cout<<"PASS "<<repeats<<" complete chapters; output "<<c->frame/48000.0<<" s; content "<<q.position()<<" s; "<<total<<" ended buffers\n";return 0;
 }
 std::vector<float> tone(48000);for(size_t i=0;i<tone.size();++i)tone[i]=.4f*std::sin(2*3.141592653589793*1000*i/48000);
 q.rate->value=1.55;q.add(1,tone);q.add(2,tone);
 for(int i=0;i<20;++i)q.render();auto before=q.position();q.pause();for(int i=0;i<20;++i)q.render();require(q.position()==before,"pause advanced position");q.start(0,-1);q.render();require(q.position()>before,"resume did not advance");
 q.clearBuffers();q.render();require(q.empty(),"clear retained output");for(float v:q.out->getChannel(0)->span())require(v==0,"clear leaked old audio");
 auto anchor=q.position();q.add(3,tone);for(int i=0;i<1000&&!q.empty();++i)q.render();require(q.empty(),"tail never drained");require(std::abs(q.position()-anchor-1)<1e-6,"padding entered content clock");require(c->events->ends.back().id==3,"seek retained old end events");
 q.add(4,tone);q.add(5,tone);q.render();q.dequeueBuffer(5);q.add(6,tone);for(int i=0;i<1500&&!q.empty();++i)q.render();require(q.empty(),"replacement never drained");for(auto e:c->events->ends)require(e.id!=5,"removed buffer ended");require(c->events->ends.back().id==6,"replacement missing");
 for(size_t removedFrames: {size_t(96),size_t(240),size_t(2400)}) {
  auto ctx=std::make_shared<BaseAudioContext>();Queue replacement(ctx);replacement.rate->value=1.55;
  std::vector<float> first(3000,.1f),discarded(removedFrames,.3f),kept(4800,-.2f);
  replacement.add(11,first);replacement.add(12,discarded);replacement.add(13,kept);
  replacement.render(); // first 70 ms have already been pulled, but not output
  replacement.dequeueBuffer(12);
  for(int i=0;i<1000&&!replacement.empty();++i)replacement.render();
  require(replacement.empty(),"pre-read replacement did not finish");
  require(std::abs(replacement.position()-7800.0/48000)<1e-6,"removed lookahead entered clock");
  for(auto e:ctx->events->ends)require(e.id!=12,"discarded pre-read buffer ended");
  require(ctx->events->ends.size()==2,"retained output boundary missing");
 }
 // Supply new audio during the flush of a temporarily empty queue. The tail
 // must finish before that new audio, with no phantom content-time padding.
 {auto ctx=std::make_shared<BaseAudioContext>();Queue stream(ctx);stream.rate->value=1.55;
  stream.add(21,std::vector<float>(960,.2f));stream.render();
  stream.add(22,std::vector<float>(4800,-.2f));
  for(int i=0;i<1000&&!stream.empty();++i)stream.render();
  require(stream.empty(),"starved queue did not recover");
  require(ctx->events->ends.size()==2,"starvation lost end event");
  require(std::abs(stream.position()-.12)<1e-6,"starvation added phantom time");
 }
 // Playback-rate changes retain source mapping and stop exactly at the PCM end.
 {auto ctx=std::make_shared<BaseAudioContext>();Queue rates(ctx);rates.add(31,tone);rates.add(32,tone);
  double previous=0;for(int i=0;i<2000&&!rates.empty();++i){rates.rate->value=i<100?1.55f:i<200?.5f:4.0f;rates.render();require(rates.position()>=previous,"rate change reversed clock");previous=rates.position();}
  require(rates.empty()&&std::abs(rates.position()-2)<1e-6,"rate-change end mismatch");
 }
 std::cout<<"PASS pause/resume, seek, output tail, pre-read removal, starvation and rate changes\n";
}catch(const std::exception&e){std::cerr<<"FAIL "<<e.what()<<"\n";return 1;}}
