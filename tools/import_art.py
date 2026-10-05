"""Копирует арт из «Загрузок» под рабочими именами и собирает контрольный лист."""
import shutil
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

DL = Path.home() / "Downloads"
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "src"
SRC.mkdir(parents=True, exist_ok=True)

MAP = {
    "Тонкий готический витражный бордюр.png": "bg_front.png",
    "Рубиново-индиговая готическая витражная рамка.png": "bg_back.png",
    "Витражный триптих со старинным городом.png": "header_front.png",
    "Готический ночной витраж с рогатой тенью.png": "header_back.png",
    "Готический медальон_ фонарь и рогатая тень.png": "sec_townsfolk.png",
    "Одинокая фигура под двухцветным полумесяцем.png": "sec_outsider.png",
    "Четырёхлистный готический витраж с мрачными эмблемами.png": "sec_demon.png",
    "Реверсивный король в готическом витраже.png": "night_center.png",
    "Рубиновый рогатый силуэт в готическом витраже.png": "demoninfo.png",
    "Готическая фрактурная надпись с витражной буквой E-1.png": "title_1.png",
    "Готическая фрактура с английской надписью-2.png": "title_2.png",
    "Готическая фрактура с витражной первой буквой-1.png": "title_3.png",
    "Фрактурная надпись с витражной буквой-2.png": "title_4.png",
}

for src, dst in MAP.items():
    shutil.copy2(DL / src, SRC / dst)

cell = 420
names = list(MAP.values())
cols = 4
rows = (len(names) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cell, rows * (cell + 28)), (128, 128, 128))
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype("arial.ttf", 20)
for i, name in enumerate(names):
    im = Image.open(SRC / name).convert("RGB")
    print(f"{name:20s} {im.size}")
    im.thumbnail((cell - 10, cell - 10))
    x, y = (i % cols) * cell, (i // cols) * (cell + 28)
    sheet.paste(im, (x + (cell - im.width) // 2, y + 28 + (cell - im.height) // 2))
    draw.text((x + 6, y + 4), name, fill=(255, 255, 255), font=font)
out = ROOT / "art" / "contact.jpg"
sheet.save(out, quality=85)
print(out)
