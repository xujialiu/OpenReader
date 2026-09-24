# Independent waveform checks of sparse output captured during long native runs.
# Usage: uv run --with numpy --with scipy python native-long-match.py DIR TAG RATE
import sys,json
from pathlib import Path
import numpy as np
from scipy.signal import correlate
r=Path(sys.argv[1]);tag=sys.argv[2];rate=float(sys.argv[3]);hz=48000; width=480
source=np.memmap(r/'source.f32',dtype='<f4',mode='r');audio=np.memmap(r/(tag+'-snippets.f32'),dtype='<f4',mode='r');positions=np.loadtxt(r/(tag+'-snippets.csv'),delimiter=',',skiprows=1)
assert len(audio)==len(positions)*width
rows=[];voiced=0
for i,(at,reported,expected,chapter) in enumerate(positions):
 if at/hz<2:continue
 y=np.asarray(audio[i*width:(i+1)*width],dtype=np.float64);y-=y.mean();energy=np.dot(y,y)
 if energy/width<1e-5:continue
 voiced+=1
 begin=int(expected-width/2*rate-.3*hz);end=int(expected-width/2*rate+.06*hz)+width
 x=np.asarray(source[np.arange(begin,end)%len(source)],dtype=np.float64)
 sums=np.cumsum(np.r_[0.,x]);squares=np.cumsum(np.r_[0.,x*x]);var=squares[width:]-squares[:-width]-(sums[width:]-sums[:-width])**2/width
 # Near-silent source windows amplify FFT/cumulative-sum roundoff into
 # impossible correlation >1. Reject them independently of any clock error.
 valid=var>max(width*1e-8,energy*1e-4)
 corr=np.full(len(var),-np.inf)
 dots=correlate(x,y,mode='valid',method='fft')
 corr[valid]=dots[valid]/np.sqrt(var[valid]*energy)
 index=int(np.argmax(corr));confidence=float(corr[index])
 if confidence<.90:continue
 actual=begin+index+width/2
 rows.append({'outputSeconds':at/hz,'confidence':confidence,'leadMs':(reported-actual)/hz/rate*1000,'contentSeconds':actual/hz,'chapter':int(chapter)})
end=positions[-1,0]/hz
summary={'tag':tag,'lastSampleSeconds':end,'samples':len(positions),'voicedSamples':voiced,'accepted':len(rows)}
for name,a,b in [('start',2,62),('middle',end/2-30,end/2+30),('end',end-62,end)]:
 v=[x['leadMs'] for x in rows if a<=x['outputSeconds']<b]
 if len(v)<15:raise SystemExit('HARNESS ERROR: too few matches '+name)
 summary[name]={'matches':len(v),'medianMs':float(np.median(v)),'p10p90Ms':np.percentile(v,[10,90]).tolist()}
v=np.array([x['leadMs'] for x in rows]);summary['absoluteErrorPercentilesMs']=np.percentile(abs(v),[50,90,95,99,100]).tolist();summary['growthMs']=summary['end']['medianMs']-summary['start']['medianMs']
summary['tenMinuteMediansMs']=[float(np.median([x['leadMs'] for x in rows if a<=x['outputSeconds']<a+600])) for a in range(0,int(end),600)]
(r/(tag+'-long-matches.json')).write_text(json.dumps(rows));(r/(tag+'-summary.json')).write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
assert abs(summary['growthMs'])<10
assert np.percentile(abs(v),95)<10
