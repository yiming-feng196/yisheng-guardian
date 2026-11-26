"""Development-only bitmap exports. Requires Pillow; no app runtime dependency.

Run this first, then export-glass-vectors.cjs to composite the editable curves.
The existing portrait, logo and observation task image are never overwritten.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
W, H = 600, 1200
scene = Image.new('RGB', (W, H), '#dce6f5')
glows = [
    ((-120, -150, 600, 500), (228, 238, 249, 210)),
    ((220, 200, 820, 850), (220, 218, 244, 150)),
    ((-220, 600, 400, 1300), (201, 230, 250, 190)),
    ((280, 650, 850, 1120), (244, 225, 220, 210)),
    ((-300, 350, 100, 850), (248, 237, 229, 150)),
    ((100, 950, 650, 1500), (238, 236, 250, 230)),
]
for box, color in glows:
    mask = Image.new('L', (W, H))
    ImageDraw.Draw(mask).ellipse(box, fill=color[3])
    mask = mask.filter(ImageFilter.GaussianBlur(100))
    scene = Image.composite(Image.new('RGB', (W, H), color[:3]), scene, mask)
scene.save(ROOT / 'assets/scene-atmosphere.png', optimize=True)
art = Image.open(ROOT / 'design/observation-glass-original.png').convert('RGBA')
art.thumbnail((640, 480), Image.Resampling.LANCZOS)
art.save(ROOT / 'assets/illustrations/observation-glass.png', optimize=True)
print('Exported ambient background and transparent illustration; composite vectors next.')
