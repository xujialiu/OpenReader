#!/usr/bin/env python3
# Actual native pixels, not the Yoga/mocked layout. Fixed 402-point phone layout.
# Match each glyph against its settled silhouette; page text is not part of it.
from PIL import Image, ImageChops
import sys,glob,json
def blocked(message):
 print('BLOCKED: '+message, file=sys.stderr)
 raise SystemExit(2)

files=sorted(glob.glob(sys.argv[1]))
if len(files)<2: blocked('no video frames')
last=Image.open(files[-1]).convert('RGB'); w,h=last.size; scale=w/402
if (w,h)!=(1206,2622): blocked('requires a 402x874 pt, 3x simulator')

def mask(im):
 r,g,b=im.split()
 return ImageChops.darker(ImageChops.darker(r,g),b).point(lambda p:255 if p>135 else 0)
def box(x0,x1,shift=0):
 return tuple(round(v*scale) for v in (x0,h/scale-114+shift,x1,h/scale-86+shift))
def count(im): return im.histogram()[255]
regions={'lock':(75,98),'moon':(302,329)}
templates={key:mask(last.crop(box(*region))) for key,region in regions.items()}
if any(count(t)<50 for t in templates.values()): blocked('settled glyph missing')
rows=[]; missing=[]
for path in files:
 im=mask(Image.open(path).convert('RGB')); matches={}
 for key,region in regions.items():
  template=templates[key]; best=(-1,None)
  for shift in range(-30,4):
   candidate=im.crop(box(*region,shift))
   union=count(ImageChops.lighter(template,candidate)); common=count(ImageChops.darker(template,candidate))
   score=common/union if union else 0
   if score>best[0]:best=(score,shift)
  matches[key]=best
 if matches['lock'][0]>=0.72 and matches['moon'][0]<0.72:
  missing.append(int(path.split('/')[-1].split('.')[0]))
 if all(m[0]>=0.72 for m in matches.values()):
  rows.append({'frame':int(path.split('/')[-1].split('.')[0]),'deltaPt':matches['moon'][1]-matches['lock'][1], 'score':round(min(m[0] for m in matches.values()),2)})
spans=[]
for r in rows:
 if spans and spans[-1]['last']==r['frame']-1 and spans[-1]['deltaPt']==r['deltaPt']:
  spans[-1]['last']=r['frame']
 else:spans.append({'first':r['frame'],'last':r['frame'],'deltaPt':r['deltaPt']})
print(json.dumps(spans))
if not rows: blocked('no comparable Player frames')
bad=[r for r in rows if abs(r['deltaPt'])>3]
print('FAIL' if bad or missing else 'PASS',f'{len(bad)}/{len(rows)} comparable frames misaligned; moon minus lock shift = {min(r["deltaPt"] for r in rows)}..{max(r["deltaPt"] for r in rows)} pt; lock visible but moon missing: {missing}')
raise SystemExit(1 if bad or missing else 0)
