"""Собирает приложение в один файл: app/dist/grimoire.html (для публикации) и preview.html (для локального просмотра)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "app" / "src"
DIST = ROOT / "app" / "dist"
DIST.mkdir(exist_ok=True)

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
         'family=Alegreya+Sans:ital,wght@0,400;0,500;0,700;0,800;1,400&display=swap">')

import base64
import io
import json
from PIL import Image

CUT = ROOT / "art" / "cut"
ART_SRC = ROOT / "art" / "src"
# графика приложения: (файл, ширина в px) — размеры под экран телефона с запасом на ретину
ART = {
    "night": (CUT / "header_back.png", 900), "day": (CUT / "header_front.png", 900),
    "win_good": (CUT / "win_good.png", 1000), "win_evil": (CUT / "win_evil.png", 1000),
    "dusk": (CUT / "dusk.png", 160), "dawn": (CUT / "dawn.png", 160),
    "minioninfo": (CUT / "minioninfo.png", 160), "demoninfo": (CUT / "demoninfo.png", 160),
    "nominate": (CUT / "ui_nominate.png", 160), "vote": (CUT / "ui_vote.png", 160),
    "execute": (CUT / "ui_execute.png", 160), "dead": (CUT / "ui_dead.png", 160),
    "icon": (ART_SRC / "app_icon.png", 128), "twoface": (CUT / "night_center.png", 160),
    "traveller": (CUT / "sec_traveller.png", 160), "fabled": (CUT / "sec_fabled.png", 160),
}


def webp_uri(path, width):
    im = Image.open(path)
    im = im.convert("RGBA") if im.mode in ("RGBA", "LA", "P") else im.convert("RGB")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=82, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


art = {k: webp_uri(p, w) for k, (p, w) in ART.items() if p.exists()}
art_js = "const ART = " + json.dumps(art, separators=(",", ":")) + ";\n"
missing = [k for k, (p, _) in ART.items() if not p.exists()]
if missing:
    print("нет графики:", ", ".join(missing))

css = (SRC / "style.css").read_text(encoding="utf-8")
js = "\n".join([(SRC / "data.js").read_text(encoding="utf-8"), (SRC / "icons.js").read_text(encoding="utf-8"), art_js]
               + [(SRC / f).read_text(encoding="utf-8") for f in ("engine.js", "morning.js", "ui.js")])
assert "</script" not in js.lower()

body = (f'<title>Гримуар рассказчика</title>\n{FONTS}\n<style>\n{css}\n</style>\n'
        f'<div id="app"></div>\n<script>\n{js}\n</script>\n')
(DIST / "grimoire.html").write_text(body, encoding="utf-8")
(DIST / "preview.html").write_text(
    '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>'
    + body + '</body></html>', encoding="utf-8")
print("grimoire.html", round((DIST / "grimoire.html").stat().st_size / 1024), "КБ")
