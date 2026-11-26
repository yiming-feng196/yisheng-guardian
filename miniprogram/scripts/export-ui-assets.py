"""Export existing artwork and original line icons for the mini-program.

Development-only helper (Pillow); no Python dependency is added to the app.
The portrait is the existing project character, without retouching.
"""
from pathlib import Path
from PIL import Image, ImageDraw
import math

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "assets" / "icons"
ICONS.mkdir(exist_ok=True)
GREEN, GRAY, WHITE = "#168773", "#7c8597", "#ffffff"
SIZE, SCALE = 81, 12


def icon(name, color):
    im = Image.new("RGBA", (24*SCALE, 24*SCALE))
    d = ImageDraw.Draw(im)
    def points(p): return [(round(x*SCALE), round(y*SCALE)) for x, y in p]
    def line(p, width=1.65):
        w = round(width*SCALE)
        q = points(p)
        d.line(q, fill=color, width=w, joint="curve")
        r = w / 2
        for x, y in q:
            d.ellipse((round(x-r), round(y-r), round(x+r), round(y+r)), fill=color)
    def circle(x, y, r, fill=False):
        box = tuple(round(v*SCALE) for v in (x-r,y-r,x+r,y+r))
        d.ellipse(box, fill=color if fill else None, outline=None if fill else color, width=round(1.65*SCALE))
    def rect(box, radius=2):
        d.rounded_rectangle(tuple(round(v*SCALE) for v in box), radius=round(radius*SCALE), outline=color, width=round(1.65*SCALE))
    if name == "companion":
        rect((3,3,21,17),5); line([(6,17),(5,21),(11,17)])
        for x in (8,12,16): circle(x,10,.7,True)
    elif name == "observation":
        rect((3,4,21,20),3); line([(7,2),(7,6)]); line([(17,2),(17,6)])
        line([(7,14),(10,17),(17,10)])
    elif name in ("records","document"):
        rect((5,3,19,21),2.5)
        line([(9,8),(15,8)]); line([(9,12),(15,12)]); line([(9,16),(13,16)])
    elif name == "profile":
        circle(12,7,3.4)
        d.arc((4*SCALE,12*SCALE,20*SCALE,26*SCALE),180,360,fill=color,width=round(1.65*SCALE))
        line([(4,19),(20,19)])
    elif name == "microphone":
        rect((9,2,15,15),3)
        d.arc((6*SCALE,7*SCALE,18*SCALE,19*SCALE),0,180,fill=color,width=round(1.65*SCALE))
        line([(6,11),(6,13)]); line([(18,11),(18,13)]); line([(12,19),(12,22)]); line([(9,22),(15,22)])
    elif name == "sun":
        circle(12,12,4)
        for a in range(0,360,45):
            r=math.radians(a); line([(12+7*math.cos(r),12+7*math.sin(r)),(12+9*math.cos(r),12+9*math.sin(r))])
    elif name == "book":
        line([(12,6),(12,21)])
        line([(12,6),(8,4),(3,4),(3,18),(8,18),(12,21),(16,18),(21,18),(21,4),(16,4),(12,6)])
    elif name == "arrow-up": line([(12,19),(12,5)]); line([(6,11),(12,5),(18,11)])
    elif name == "arrow-right": line([(4,12),(20,12)]); line([(14,6),(20,12),(14,18)])
    elif name == "chevron": line([(9,5),(16,12),(9,19)])
    elif name == "chevron-down": line([(6,9),(12,15),(18,9)])
    elif name == "check-circle": circle(12,12,9); line([(7,12),(11,16),(17,9)])
    elif name == "connection":
        line([(3,7),(3,12)]); line([(7,3),(12,3)]); line([(17,3),(21,7),(21,12)]); line([(3,17),(7,21),(12,21)]); line([(17,21),(21,17)])
        circle(12,12,3)
    elif name == "settings":
        for y, x in ((6,8),(12,16),(18,10)):
            line([(3,y),(x-2,y)]); line([(x+2,y),(21,y)]); circle(x,y,2)
    elif name == "text-size":
        line([(3,18),(8,5),(13,18)]); line([(5,13),(11,13)]); line([(15,9),(22,9)]); line([(18.5,9),(18.5,18)])
    elif name == "heart":
        # Original polygonal heart; consistent stroke and rounded joins.
        line([(12,20),(3.5,12),(3,8),(5,4),(9,4),(12,7),(15,4),(19,4),(21,8),(20.5,12),(12,20)])
    else: raise ValueError(name)
    return im.resize((SIZE,SIZE),Image.Resampling.LANCZOS)


for name in ("companion","observation","records","profile"):
    icon(name,GRAY).save(ICONS/f"{name}.png",optimize=True)
    icon(name,GREEN).save(ICONS/f"{name}-active.png",optimize=True)
for name in ("document","microphone","sun","book","arrow-right","chevron-down","check-circle","connection","settings","text-size","heart"):
    color = "#b98249" if name == "sun" else "#6489bf" if name == "book" else GREEN
    icon(name,color).save(ICONS/f"{name}.png",optimize=True)
icon("chevron",GRAY).save(ICONS/"chevron.png",optimize=True)
icon("arrow-up",WHITE).save(ICONS/"arrow-up.png",optimize=True)
icon("arrow-right",WHITE).save(ICONS/"arrow-right-white.png",optimize=True)

# Size/encoding export only: keep the character and the alpha channel intact.
portrait = Image.open(ROOT.parent/"backend/src/main/resources/static/avatar-hero-v1.png")
portrait.thumbnail((680,1020),Image.Resampling.LANCZOS)
portrait.save(ROOT/"assets/avatar-companion.png",optimize=True,compress_level=9)
logo = Image.open(ROOT/"assets/logo.png")
logo.thumbnail((256,256),Image.Resampling.LANCZOS)
logo.quantize(colors=256,method=Image.Quantize.FASTOCTREE).save(ROOT/"assets/logo.png",optimize=True)
print("Exported project portrait, logo and 22 original UI icons.")
