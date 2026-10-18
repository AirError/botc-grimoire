"""Собирает приложение в один файл: app/dist/grimoire.html (для публикации) и preview.html (для локального просмотра)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "app" / "src"
DIST = ROOT / "app" / "dist"
DIST.mkdir(exist_ok=True)

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
         'family=Alegreya+Sans:ital,wght@0,400;0,500;0,700;0,800;1,400&family=Alegreya:wght@700;800&family=Kurale'
         '&family=Old+Standard+TT:ital,wght@0,400;0,700;1,400&family=Rubik+Wet+Paint&display=swap">')  # Old Standard TT — «Лунная гравюра», Rubik Wet Paint — «Хэллоуин»

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
    # стена жребия и яд (prep_art.beauty)
    "wall_bg": (CUT / "wall_bg.jpg", 720), "wall_edge": (CUT / "wall_edge.png", 1200),
    "tablet": (CUT / "tablet.png", 300), "tablet_cracked": (CUT / "tablet_cracked.png", 300),
    "wall_glow": (CUT / "wall_glow.png", 360), "fx_open": (CUT / "fx_open.png", 640), "fx_circle": (CUT / "fx_circle.png", 640),
    "poison_drop": (CUT / "poison_drop.png", 72), "poison_drips": (CUT / "poison_drips.png", 900), "poison_frame": (CUT / "poison_frame.png", 600),
    "drunk_mug": (CUT / "drunk_mug.png", 72), "drunk_foam": (CUT / "drunk_foam.png", 900), "drunk_frame": (CUT / "drunk_frame.png", 600),
}
ART.update({f"rune{i}": (CUT / f"rune{i}.png", 128) for i in range(24)})
# рисованные цифры 0–9 для показа чисел игрокам (prep_art.digits)
ART.update({f"digit{i}": (CUT / f"digit{i}.png", 150) for i in range(10)})
# значки Гримуара: саван и 20 значков-напоминаний (prep_art.marks)
ART["shroud"] = (CUT / "shroud.png", 120)
ART.update({f"mark{i}": (CUT / f"mark{i}.png", 72) for i in range(20)})
# карточки для показа игрокам (надпись накладывает приложение — поле в meta.json → cards.box)
ART.update({n: (CUT / f"{n}.png", 800) for n in ["card_demon", "card_minions", "card_notinplay", "card_youare", "card_selected",
                                                  "card_thisplayer", "card_yourrole", "card_yes", "card_no", "card_good", "card_evil",
         "card_general_good", "card_general_evil", "card_general_neither"]})
# стили оформления (prep_art.skins): «Лунная гравюра» — маски туши (цвет задаёт CSS), «Витраж во тьме» — роза
ART.update({"c_engr": (CUT / "c_engr.png", 800), "c_frontis": (CUT / "c_frontis.png", 560), "c_wreath": (CUT / "c_wreath.png", 160),
            "c_fl_short": (CUT / "c_fl_short.png", 200), "c_fl_mid": (CUT / "c_fl_mid.png", 300), "c_fl_long": (CUT / "c_fl_long.png", 320),
            "d_rose": (CUT / "d_rose.png", 600)})
ART.update({f"c_cor_{k}": (CUT / f"c_cor_{k}.png", 110) for k in ("tl", "tr", "bl", "br")})
ART.update({"c_night": (CUT / "c_night.png", 800), "c_dial": (CUT / "c_dial.png", 720),
            "c_win_good": (CUT / "c_win_good.png", 800), "c_win_evil": (CUT / "c_win_evil.png", 800)})
ART.update({f"c_tab_{k}": (CUT / f"c_tab_{k}.png", 96) for k in ("day", "night", "setup", "table", "log", "roles", "menu")})
ART.update({f"d_tab_{k}": (CUT / f"d_tab_{k}.png", 96) for k in ("day", "night", "setup", "table", "log", "roles", "menu")})
ART.update({f"c_g_{k}": (CUT / f"c_g_{k}.png", 128) for k in ("dusk", "dawn", "minioninfo", "demoninfo", "nominate", "vote", "execute", "dead")})
# стиль «Хэллоуин» (prep_art.halloween, prompts_halloween.md): склеп выдачи ролей, нечисть, значки, шапки, показ игроку
_H = {"h_crypt.jpg": 720, "h_splash.jpg": 720, "h_header_day.jpg": 800, "h_header_night.jpg": 800, "h_win_good.jpg": 800, "h_win_evil.jpg": 800,
      "h_ring.png": 640, "h_frame.png": 600, "h_skull.png": 200, "h_chest_open.png": 300, "h_chest_box.png": 300, "h_chest_lid.png": 300,
      "h_spider.png": 80, "h_batline.png": 360, "h_wreath.png": 160, "h_bat_strip.png": 656, "h_raven_strip.png": 400, "h_flame.png": 360,
      "h_burst.png": 360, "h_fog.png": 800}
_H.update({f"h_tab_{k}.png": 96 for k in ("day", "night", "setup", "table", "log", "roles", "menu")})
_H.update({f"h_g_{k}.png": 128 for k in ("dusk", "dawn", "minioninfo", "demoninfo", "nominate", "vote", "execute", "dead")})
_H.update({f"h_em_{k}.png": 220 for k in ("demon", "minions", "notinplay", "youare", "selected", "thisplayer", "yourrole",
                                          "yes", "no", "good", "evil", "general_good", "general_evil", "general_neither", "moon")})
_H.update({f"h_web_{k}.png": 120 for k in ("tl", "tr", "bl", "br")})
_H.update({f"h_ghost{i}.png": 400 for i in (1, 2, 3, 4)})  # призрак в конце броска вырастает в 2,5 раза — нужен запас
_H.update({f"h_wisp{i}.png": 96 for i in range(1, 7)})
_H.update({f"h_soul{i}.png": 160 for i in range(1, 7)})
_H.update({f"h_smoke{i}.png": 200 for i in range(1, 5)})
_H.update({f"h_cflame{i}.png": 60 for i in range(1, 5)})
_H.update({f"h_candle{i}.png": 160 for i in range(1, 5)})
_H.update({f"h_pumpkin{i}.png": 160 for i in range(1, 5)})
ART.update({f.rsplit(".", 1)[0]: (CUT / f, w) for f, w in _H.items()})
ART.update({f"c_em_{k}": (CUT / f"c_em_{k}.png", 220) for k in ("demon", "minions", "notinplay", "youare", "selected", "thisplayer", "yourrole",
                                                               "yes", "no", "good", "evil", "general_good", "general_evil", "general_neither", "moon")})


def webp_uri(path, width, alpha_quality=100):
    im = Image.open(path)
    im = im.convert("RGBA") if im.mode in ("RGBA", "LA", "P") else im.convert("RGB")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=82, method=6, alpha_quality=alpha_quality)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


# маски гравюры (белое + прозрачность): прозрачность можно сжать с потерями — вдвое легче, на глаз не видно
LOSSY_ALPHA = {"c_engr", "c_frontis", "c_wreath", "c_night", "c_dial", "c_win_good", "c_win_evil"}
LOSSY_ALPHA |= {"h_flame", "h_burst", "h_fog", "h_batline"}
lossy = lambda k: k in LOSSY_ALPHA or k.startswith(("c_em_", "h_em_", "h_ghost", "h_smoke", "h_wisp", "h_soul", "h_cflame", "h_web_"))
art = {k: webp_uri(p, w, 70 if lossy(k) else 100) for k, (p, w) in ART.items() if p.exists()}
meta = json.loads((CUT / "meta.json").read_text(encoding="utf-8")) if (CUT / "meta.json").exists() else {}
art_js = ("const ART = " + json.dumps(art, separators=(",", ":")) + ";\n"
          + "const ART_META = " + json.dumps(meta) + ";\n")
missing = [k for k, (p, _) in ART.items() if not p.exists()]
if missing:
    print("нет графики:", ", ".join(missing))

css = (SRC / "style.css").read_text(encoding="utf-8")
js = "\n".join([(SRC / "data.js").read_text(encoding="utf-8"), (SRC / "icons.js").read_text(encoding="utf-8"), art_js]
               + [(SRC / f).read_text(encoding="utf-8") for f in ("engine.js", "morning.js", "ideas.js", "executions.js", "notes.js", "archive.js", "ui.js")])
assert "</script" not in js.lower()

body = (f'<title>Гримуар рассказчика</title>\n{FONTS}\n<style>\n{css}\n</style>\n'
        f'<div id="app"></div>\n<script>\n{js}\n</script>\n')
(DIST / "grimoire.html").write_text(body, encoding="utf-8")
(DIST / "preview.html").write_text(
    '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>'
    + body + '</body></html>', encoding="utf-8")
print("grimoire.html", round((DIST / "grimoire.html").stat().st_size / 1024), "КБ")
