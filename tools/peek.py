"""Склейка фрагментов для осмотра: python peek.py out.jpg file:x0,y0,x1,y1 [...]"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
out, *specs = sys.argv[1:]
tiles = []
for spec in specs:
    name, box = spec.split(":") if ":" in spec else (spec, None)
    im = Image.open(ROOT / name).convert("RGB")
    if box:
        im = im.crop(tuple(int(v) for v in box.split(",")))
    im.thumbnail((1400, 700))
    tiles.append(im)
w = max(t.width for t in tiles)
sheet = Image.new("RGB", (w, sum(t.height + 8 for t in tiles)), (120, 120, 120))
y = 0
for t in tiles:
    sheet.paste(t, (0, y)); y += t.height + 8
sheet.save(ROOT / out, quality=88)
