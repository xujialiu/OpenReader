import sys,json
from pathlib import Path
import numpy as np
from scipy.signal import correlate
# Compare rendered audio with source audio, independently of reported positions.
# Inputs: DIR TAG RATE [SOURCE_BIAS_SECONDS], float32 mono at 48000 Hz.
if len(sys.argv) not in (4,5):
    raise SystemExit('usage: native-audio-match.py DIR TAG RATE [SOURCE_BIAS_SECONDS]')
r=Path(sys.argv[1]);tag=sys.argv[2];rate=float(sys.argv[3]);hz=48000
source=np.memmap(r/'source.f32',dtype='<f4',mode='r');out=np.memmap(r/(tag+'.f32'),dtype='<f4',mode='r')
pos=np.loadtxt(r/(tag+'-positions.csv'),delimiter=',',skiprows=1)
bias=float(sys.argv[4]) if len(sys.argv)>4 else 0
width=480;rows=[]
for t in np.arange(2,len(out)/hz-2,.25):
 at=int(t*hz); y=np.asarray(out[at:at+width],dtype=np.float64);y-=y.mean();energy=np.dot(y,y)
 if energy/width<1e-5:continue
 begin=max(0,int((t*rate-bias-.3)*hz));end=min(len(source),int((t*rate-bias+.06)*hz)+width)
 x=np.asarray(source[begin:end],dtype=np.float64)
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
 reported=float(np.interp(at+width/2,pos[:,0],pos[:,1]))
 rows.append({'outputSeconds':t,'confidence':confidence,'leadMs':(reported-actual)/hz/rate*1000,'contentSeconds':actual/hz})
(r/(tag+'-matches.json')).write_text(json.dumps(rows))
print(tag,'matches',len(rows),'duration',round(len(out)/hz,3))
for a,b in [(2,22),(len(out)/hz/2-10,len(out)/hz/2+10),(len(out)/hz-22,len(out)/hz-2)]:
 v=[x['leadMs'] for x in rows if a<=x['outputSeconds']<b]
 if len(v)<10:raise SystemExit('HARNESS ERROR: too few waveform matches in a measurement window')
 print('window',round(a,1),round(b,1),'n',len(v),'median ms',round(float(np.median(v)),1),'p10-p90',np.round(np.percentile(v,[10,90]),1).tolist() if v else [])
if len(rows)<40:raise SystemExit('not enough matches')
early=np.median([x['leadMs'] for x in rows if x['outputSeconds']<22]);late=np.median([x['leadMs'] for x in rows if x['outputSeconds']>len(out)/hz-22]);growth=float(late-early)
print(('RED' if abs(growth)>100 else 'GREEN')+': median lead growth '+str(round(growth,1))+' ms')
raise SystemExit(1 if abs(growth)>100 else 0)
