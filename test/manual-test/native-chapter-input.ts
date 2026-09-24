import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {segmentBlocks} from '../../src/core/segmenter';
import {splitWithSentencex} from '../../src/core/segmenter/sentencex';
import {bufferParts} from '../../src/playback/buffer-parts';
import {startsNewBlock,DEFAULT_GAP,gapContentSeconds,framesFor} from '../../src/playback/gap';
// Private fixture directory: texts.json and numbered MP3/timestamp JSON files.
// BLOCKS_JSON contains renderer-extracted Blocks spanning the complete chapter.
const [dir,blocksPath]=process.argv.slice(2);
if(!dir||!blocksPath)throw Error('usage: native-chapter-input.ts OUT_DIR BLOCKS_JSON');
const hz=48000;
const texts:string[]=JSON.parse(readFileSync(dir+'/texts.json','utf8'));
const blocks=JSON.parse(readFileSync(blocksPath,'utf8'));
const utterances=segmentBlocks(blocks,'en',{splitSentences:splitWithSentencex});
const first=utterances.findIndex(u=>u.text===texts[0]);
if(first<0)throw Error('heading not found');
let last=first,matched=0;const buffers:Buffer[]=[];const sizes:number[]=[];const clipSummary=[];
for(let i=first;i<utterances.length;i++){
 const u=utterances[i];
 if(u.speakable&&u.text!==texts[matched]){if(matched===texts.length)break;throw Error('text sequence mismatch '+matched);}
 let samples:Float32Array,words=null;
 if(u.speakable){
  const index=matched++;
  const raw=execFileSync('ffmpeg',['-v','error','-i',`${dir}/${index}.mp3`,'-f','f32le','-ar',String(hz),'-ac','1','pipe:1'],{maxBuffer:40*1024*1024});
  samples=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
  words=JSON.parse(readFileSync(`${dir}/${index}.json`,'utf8')).timestamps;
 }else samples=new Float32Array(framesFor(0.3,hz));
 const gap=framesFor(gapContentSeconds(DEFAULT_GAP,startsNewBlock(u,utterances[i+1])),hz);
 for(const p of bufferParts(samples.length,hz,words)){
  const segment=new Float32Array(p.end-p.start+(p.final?gap:0));segment.set(samples.subarray(p.start,p.end));
  sizes.push(segment.length);buffers.push(Buffer.from(segment.buffer));
 }
 clipSummary.push({index:i-first,speakable:u.speakable,frames:samples.length,gap});last=i;
}
if(matched!==texts.length)throw Error('missing text '+matched);
writeFileSync(dir+'/source.f32',Buffer.concat(buffers));
writeFileSync(dir+'/parts.txt',sizes.join('\n'));
writeFileSync(dir+'/layout.json',JSON.stringify(clipSummary));
console.log(JSON.stringify({clips:matched,utterances:last-first+1,parts:sizes.length,contentSeconds:sizes.reduce((a,b)=>a+b,0)/hz}));
