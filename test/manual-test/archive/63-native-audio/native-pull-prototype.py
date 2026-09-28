from pathlib import Path
import sys
import hashlib
# EXPERIMENT ONLY: generate an isolated copy; never alter installed/app sources.
root=Path(sys.argv[1])/'audioapi/dsp'
out=Path(sys.argv[2])/'audioapi/dsp'
out.mkdir(parents=True,exist_ok=True)
h=(root/'WsolaTimeStretcher.h').read_text();c=(root/'WsolaTimeStretcher.cpp').read_text()
assert hashlib.sha256(c.encode()).hexdigest()=='95f40d6323c1ea6319953f8a387c42310e0ee70e81ed055e428a9623bf3ba009', 'Re-audit the prototype against this WSOLA revision'
h=h.replace('#include <vector>','#include <vector>\n#include <functional>')
h=h.replace(' private:', '''  // EXPERIMENT ONLY: pull input when an output iteration actually needs it.
  size_t pull(DSPAudioBuffer &output, size_t frames, float rate,
      const std::function<size_t(DSPAudioBuffer &, size_t)> &supply);
  const std::vector<double> &outputPositions() const { return renderedPositions_; }
  double maxSourceSpan() const { return maxSourceSpan_; }
 private:
  double inputOrigin_ = 0, maxSourceSpan_ = 0;
  std::vector<double> overlapMin_, overlapMax_;
  bool haveOverlapPosition_ = false;
  std::vector<double> positionQueue_, overlapPositions_, renderedPositions_;
''',1)
c=c.replace('  outputTime_ = 0.0;', '''  inputOrigin_ = 0; maxSourceSpan_ = 0;
  overlapMin_.assign(hopSize_,0); overlapMax_.assign(hopSize_,0);
  haveOverlapPosition_ = false;
  positionQueue_.clear(); renderedPositions_.clear();
  overlapPositions_.assign(hopSize_, 0);
  outputTime_ = 0.0;''',1)
c=c.replace('  outputReadIndex_ += frames;', '''  if (renderedPositions_.size() >= outputOffset + frames) {
    std::copy_n(positionQueue_.begin() + outputReadIndex_, frames, renderedPositions_.begin() + outputOffset);
  }
  outputReadIndex_ += frames;''',1)
c=c.replace('    outputReadIndex_ = 0;\n    return;', '    positionQueue_.clear();\n    outputReadIndex_ = 0;\n    return;',1)
needle='  for (auto &queue : outputQueue_) {\n    queue.erase'
c=c.replace(needle,'  positionQueue_.erase(positionQueue_.begin(), positionQueue_.begin() + outputReadIndex_);\n'+needle,1)
needle='  for (size_t channel = 0; channel < channels_; ++channel) {\n    auto &output = outputQueue_[channel];'
metadata='''  // Track the source coordinates with the same overlap/transition weights as PCM.
  compactOutputQueueIfNeeded();
  std::vector<double> blockPositions(windowSize_), blockMin(windowSize_), blockMax(windowSize_);
  for (size_t frame=0; frame<windowSize_; ++frame) {
    double pos = inputOrigin_ + (optimalIndex + static_cast<double>(frame)) * pitchFactor_;
    blockMin[frame]=pos; blockMax[frame]=pos;
    if (transitionNeeded) {
      const double target = inputOrigin_ + (targetBlockIndex_ + static_cast<double>(frame)) * pitchFactor_;
      blockMin[frame]=std::min(pos,target); blockMax[frame]=std::max(pos,target);
      const double w = transitionWindow_[frame], t = transitionWindow_[windowSize_ + frame];
      pos = (pos*w + target*t)/(w+t);
    }
    blockPositions[frame]=pos;
  }
  for (size_t frame=0; frame<hopSize_; ++frame) {
    const double oldWeight=olaWindow_[hopSize_+frame], newWeight=olaWindow_[frame];
    positionQueue_.push_back(haveOverlapPosition_
      ? (overlapPositions_[frame]*oldWeight + blockPositions[frame]*newWeight)/(oldWeight+newWeight)
      : blockPositions[frame]);
    const double lo=haveOverlapPosition_?std::min(overlapMin_[frame],blockMin[frame]):blockMin[frame];
    const double hi=haveOverlapPosition_?std::max(overlapMax_[frame],blockMax[frame]):blockMax[frame];
    maxSourceSpan_=std::max(maxSourceSpan_,hi-lo);
    overlapMin_[frame]=blockMin[hopSize_+frame]; overlapMax_[frame]=blockMax[hopSize_+frame];
    overlapPositions_[frame]=blockPositions[hopSize_+frame];
  }
  haveOverlapPosition_=true;

'''
assert needle in c;c=c.replace(needle,metadata+needle,1)
c=c.replace('  const int removedFrames = static_cast<int>(synthesisFramesToRemove);','  inputOrigin_ += queueFramesToRemove;\n  const int removedFrames = static_cast<int>(synthesisFramesToRemove);',1)
method='''
size_t WsolaTimeStretcher::pull(DSPAudioBuffer &output, size_t frames, float rate,
    const std::function<size_t(DSPAudioBuffer &, size_t)> &supply) {
  output.zero(); renderedPositions_.assign(frames, -1);
  pitchFactor_=1;
  size_t rendered=0;
  while (rendered < frames) {
    rendered += writeOutput(output, rendered, frames-rendered);
    if (rendered==frames) break;
    if (!canRunIteration()) {
      const int searchBlockSize=static_cast<int>(searchIntervalFrames_+windowSize_-1);
      const int last=std::max(maxSourceIndexForBlock(targetBlockIndex_),
          maxSourceIndexForBlock(searchBlockIndex_+searchBlockSize-1));
      const size_t needed=std::max(0, last+1-static_cast<int>(inputQueue_[0].size()));
      DSPAudioBuffer input(needed,channels_,sampleRate_);
      const size_t supplied=supply(input,needed);
      if (supplied==0) break;
      appendInput(input,supplied);
    }
    if (!runOneIteration(rate)) break;
  }
  return rendered;
}
'''
c=c.replace('\n} // namespace audioapi',method+'\n} // namespace audioapi')
(out/'WsolaTimeStretcher.h').write_text(h);(out/'WsolaTimeStretcher.cpp').write_text(c)
