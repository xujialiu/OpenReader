#!/usr/bin/env python3
# The #331 first-frame jump check for shapes player-opening-measure.py cannot
# take: any simulator width and any text size (it templates two glyphs from the
# settled last frame instead of assuming the 402-point dark default layout).
# Same method and verdict: mask to the lightest ink, match each glyph against
# its settled silhouette over a vertical shift range, fail on a matched anchor
# whose mover is missing or displaced more than 3 pt. Frames where even the
# anchor does not match (collapsed player, other screens, mid-transition) are
# not comparable and are skipped.
#
#   python3 player-jump-check.py 'FRAMES/*.png' POINTS_WIDTH ANCHOR_BOX MOVER_BOX \
#     [--threshold 0.72] [--shift 30]
#
# ANCHOR_BOX and MOVER_BOX are x0,y0,x1,y1 in points from the frame's top-left,
# each enclosing exactly one glyph of the row (page text excluded). POINTS_WIDTH
# is the screen's width in points, for the pixel scale. Exit 0 PASS, 1 visual
# failure, 2 setup/measurement failure.
from PIL import Image, ImageChops
import sys,glob,json,argparse

parser=argparse.ArgumentParser()
parser.add_argument('frames'); parser.add_argument('points_width',type=float)
parser.add_argument('anchor'); parser.add_argument('mover')
parser.add_argument('--threshold',type=float,default=0.72)
parser.add_argument('--shift',type=int,default=30)
args=parser.parse_args()

def blocked(message):
 print('BLOCKED: '+message, file=sys.stderr)
 raise SystemExit(2)

def box(spec,scale,height):
 x0,y0,x1,y1=(round(float(v)*scale) for v in str(spec).split(','))
 return (x0,max(0,min(y0,height-1)),x1,max(1,min(y1,height)))

files=sorted(glob.glob(args.frames))
if len(files)<2: blocked('no video frames')
last=Image.open(files[-1]).convert('RGB'); w,h=last.size
scale=w/args.points_width

def mask(im):
 r,g,b=im.split()
 return ImageChops.darker(ImageChops.darker(r,g),b).point(lambda p:255 if p>135 else 0)
def count(im): return im.histogram()[255]

templates={}
for key,spec in (('anchor',args.anchor),('mover',args.mover)):
 t=mask(last.crop(box(spec,scale,h)))
 if count(t)<50: blocked(f'settled {key} glyph missing from its box')
 templates[key]=t
rows=[]; missing=[]
for path in files:
 im=mask(Image.open(path).convert('RGB')); matches={}
 for key,spec in (('anchor',args.anchor),('mover',args.mover)):
  template=templates[key]; best=(-1,None)
  bx=box(spec,scale,h)
  for shift in range(-args.shift,args.shift+1):
   # The sweep and verdict are in points; Pillow's crop is in pixels.
   pixel_shift=round(shift*scale)
   candidate=im.crop((bx[0],bx[1]+pixel_shift,bx[2],bx[3]+pixel_shift))
   union=count(ImageChops.lighter(template,candidate)); common=count(ImageChops.darker(template,candidate))
   score=common/union if union else 0
   if score>best[0]:best=(score,shift)
  matches[key]=best
 if matches['anchor'][0]>=args.threshold and matches['mover'][0]<args.threshold:
  missing.append(int(path.split('/')[-1].split('.')[0]))
 if all(m[0]>=args.threshold for m in matches.values()):
  rows.append({'frame':int(path.split('/')[-1].split('.')[0]),'deltaPt':matches['mover'][1]-matches['anchor'][1], 'score':round(min(m[0] for m in matches.values()),2)})
spans=[]
for r in rows:
 if spans and spans[-1]['last']==r['frame']-1 and spans[-1]['deltaPt']==r['deltaPt']:
  spans[-1]['last']=r['frame']
 else:spans.append({'first':r['frame'],'last':r['frame'],'deltaPt':r['deltaPt']})
print(json.dumps(spans))
if not rows: blocked('no comparable frames')
bad=[r for r in rows if abs(r['deltaPt'])>3]
print('FAIL' if bad or missing else 'PASS',f'{len(bad)}/{len(rows)} comparable frames misaligned; mover minus anchor shift = {min(r["deltaPt"] for r in rows)}..{max(r["deltaPt"] for r in rows)} pt; anchor visible but mover missing: {missing}')
raise SystemExit(1 if bad or missing else 0)
