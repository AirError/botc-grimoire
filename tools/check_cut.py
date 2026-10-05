"""Вырезанный арт на пурпурной подложке (видны дыры и ореолы) + рамка листа ночей."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CUT = ROOT / "art" / "cut"
names = ["header_front", "header_back", "sec_townsfolk", "sec_outsider", "sec_demon",
         "demoninfo", "night_center", "title_1"]
H = 300
tiles = []
for n in names:
    im = Image.open(CUT / f"{n}.png")
    im.thumbnail((700, H))
    bg = Image.new("RGBA", im.size, (200, 40, 160, 255))
    bg.alpha_composite(im)
    tiles.append(bg.convert("RGB"))
night = Image.open(CUT / "bg_night.jpg"); night.thumbnail((700, 990))
row_w = 1500
sheet = Image.new("RGB", (row_w + night.width + 20, max(990, 1400)), (90, 90, 90))
x = y = 0; rh = 0
for t in tiles:
    if x + t.width > row_w:
        x, y = 0, y + rh + 10; rh = 0
    sheet.paste(t, (x, y)); x += t.width + 10; rh = max(rh, t.height)
sheet.paste(night, (row_w + 20, 0))
sheet.save(ROOT / "art" / "check_cut.jpg", quality=85)
