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
         '&family=Old+Standard+TT:ital,wght@0,400;0,700;1,400&family=Rubik+Wet+Paint'
         '&family=Bona+Nova:ital,wght@0,400;0,700;1,400&family=PT+Serif:wght@400;700&display=swap">')
# Old Standard TT — «Лунная гравюра», Rubik Wet Paint — «Хэллоуин», Bona Nova и PT Serif — «Скрипторий» (у обоих настоящий жирный и кириллица)

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
# свои цифры оформлений «Витраж во тьме» (d_digits) и «Хэллоуин» (h_digits) — по желанию (заметка пользователя 2026-10-27)
ART.update({f"{p}{i}": (CUT / f"{p}{i}.png", 150) for p in ("d_digit", "h_digit") for i in range(10)})
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
      "h_ring.png": 640, "h_frame.png": 600, "h_skull.png": 420, "h_chest_open.png": 300, "h_chest_box.png": 300, "h_chest_lid.png": 300,
      "h_spider.png": 80, "h_batline.png": 360, "h_wreath.png": 160, "h_flame.png": 480, "h_burst.png": 360, "h_fog.png": 800,
      # полоса кадров мыши — без сжатия (раньше 656 px на 12 кадров — по 55 px на кадр, мыши выходили мыльными)
      "h_bat_strip.png": 8000}
# череп, души и мыши летят «в экран» и вырастают в 3–6 раз — им нужен запас по размеру
_H.update({f"h_tab_{k}.png": 96 for k in ("day", "night", "setup", "table", "log", "roles", "menu")})
_H.update({f"h_g_{k}.png": 128 for k in ("dusk", "dawn", "minioninfo", "demoninfo", "nominate", "vote", "execute", "dead")})
_H.update({f"h_em_{k}.png": 220 for k in ("demon", "minions", "notinplay", "youare", "selected", "thisplayer", "yourrole",
                                          "yes", "no", "good", "evil", "general_good", "general_evil", "general_neither", "moon")})
_H.update({f"h_web_{k}.png": 120 for k in ("tl", "tr", "bl", "br")})
_H.update({f"h_ghost{i}.png": 480 for i in (1, 2, 3, 4)})  # призрак в конце броска вырастает в 3,3 раза — нужен запас
_H.update({f"h_wisp{i}.png": 96 for i in range(1, 7)})
_H.update({f"h_soul{i}.png": 420 for i in range(1, 7)})
_H.update({f"h_skull{i}.png": 420 for i in (2, 3, 4)})  # череп поворачивается к зрителю (этап 5)
_H["h_skull_fire.png"] = 720
_H.update({f"h_smoke{i}.png": 200 for i in range(1, 5)})
_H.update({f"h_cflame{i}.png": 60 for i in range(1, 5)})
_H.update({f"h_candle{i}.png": 160 for i in range(1, 5)})
_H.update({f"h_pumpkin{i}.png": 160 for i in range(1, 5)})
# этап 6: пауки и паутина на весь экран, шарик и клоун во весь экран, девочка с табличкой, паразит, прыгающий в лицо
_H.update({"h_spider_strip.png": 8000, "h_web_full.png": 720, "h_balloon.png": 200, "h_clown.png": 720,
           "h_girl1.png": 420, "h_girl2.png": 560, "h_hugger1.png": 300, "h_hugger2.png": 640})
_H.update({f"h_acid{i}.png": 400 for i in range(1, 7)})  # этап 7: кляксы кислотной крови паразита
ART.update({f.rsplit(".", 1)[0]: (CUT / f, w) for f, w in _H.items()})
# «Витраж во тьме»: выдача ролей витражом (prep_art.vitrage, prompts_vitrage.md); без картинок окна рисует CSS
ART.update({"d_nave": (CUT / "d_nave.jpg", 720), "d_reveal": (CUT / "d_reveal.jpg", 600), "d_arch": (CUT / "d_arch.png", 400),
            "d_arch_broken": (CUT / "d_arch_broken.png", 400)})
ART.update({f"d_pane{i}": (CUT / f"d_pane{i}.png", 300) for i in range(20)})
# этап 2: нарисованные трещины, ночной витраж и ореол за ролью, цветные лучи, вспышка удара
ART.update({"d_reveal_dark": (CUT / "d_reveal_dark.jpg", 600), "d_reveal_glow": (CUT / "d_reveal_glow.jpg", 160), "d_beams": (CUT / "d_beams.png", 600),
            "d_impact": (CUT / "d_impact.png", 400), "d_crack1": (CUT / "d_crack1.png", 700), "d_crack2": (CUT / "d_crack2.png", 700)})
# «Ведьмин котёл»: выдача ролей варкой зелья (prep_art.cauldron, prompts_cauldron.md); без картинок вида «Котёл» нет
ART.update({"k_hut": (CUT / "k_hut.jpg", 1536), "k_cauldron": (CUT / "k_cauldron.png", 640), "k_cauldron_front": (CUT / "k_cauldron_front.png", 640),
            "k_logs": (CUT / "k_logs.png", 560), "k_steam": (CUT / "k_steam.png", 520), "k_jar": (CUT / "k_jar.png", 560)})
ART.update({f"k_shelf{i}": (CUT / f"k_shelf{i}.png", 1100) for i in (1, 2, 3)})
ART.update({f"k_ing{i}": (CUT / f"k_ing{i}.png", 210) for i in range(20)})
ART.update({f"k_bit{i}": (CUT / f"k_bit{i}.png", 180) for i in range(20)})  # те же без банок — в банку игрока и в котёл (этап 3)
ART.update({f"k_hand{i}": (CUT / f"k_hand{i}.png", 300) for i in (1, 2, 3)})
ART.update({f"k_flame{i}": (CUT / f"k_flame{i}.png", 160) for i in (1, 2, 3, 4)})
ART.update({f"k_splash{i}": (CUT / f"k_splash{i}.png", 260) for i in range(1, 7)})
ART.update({f"k_witch{i}": (CUT / f"k_witch{i}.png", 400) for i in (1, 2, 3, 4)})
ART.update({f"k_herb{i}": (CUT / f"k_herb{i}.png", 160) for i in range(1, 6)})
ART.update({f"k_cat{i}": (CUT / f"k_cat{i}.png", 300) for i in (1, 2)})
ART.update({k: (CUT / f"{k}.png", 360) for k in ("al_live", "al_die")})  # Аль-Адихия: жить — свеча, умереть — череп
ART.update({f"c_em_{k}": (CUT / f"c_em_{k}.png", 220) for k in ("demon", "minions", "notinplay", "youare", "selected", "thisplayer", "yourrole",
                                                               "yes", "no", "good", "evil", "general_good", "general_evil", "general_neither", "moon")})
# «Скрипторий» (prep_art.scriptorium, prompts_scriptorium.md; картинки пользователя 2026-11-04): оформление и выдача ролей «Печати».
# Ширина — экран телефона/iPad ×2; у полос кадров — число кадров × ширина кадра. В сборку — только то, что берёт приложение
# (свеча, предметы стола, буквицы 2–3, лоза-бордюр, ленты для фраз — пока не используются)
_S = {"s_header_day.jpg": 800, "s_header_night.jpg": 800, "s_splash.jpg": 720, "s_win_good.jpg": 800, "s_win_evil.jpg": 800, "s_paper.jpg": 384,
      "s_orn_long.png": 360, "s_orn_short.png": 200, "s_orn_corner.png": 120, "s_orn_flower.png": 48, "s_orn_rhomb.png": 40, "s_init1.png": 200,
      "s_seal_glow.png": 200, "s_wreath.png": 160, "s_ring.png": 640, "s_ring_night.png": 640, "s_frame.png": 560, "s_frame_wide.png": 760,
      "s_desk_top.jpg": 760, "s_desk_mid.jpg": 760, "s_desk_bot.jpg": 760, "s_desk_wide.jpg": 1400, "s_rays.png": 420, "s_sweep.png": 700,
      "s_flame_strip.png": 8 * 64, "s_crack_strip.png": 6 * 120, "s_puff_strip.png": 6 * 150, "s_ribbon_strip.png": 6 * 220,
      "s_sheet.png": 700, "s_roller_top.png": 900, "s_roller_bot.png": 900, "s_ink_strip.png": 8 * 260, "s_inkr_strip.png": 8 * 260,
      "s_drip_strip.png": 6 * 150, "s_quill_strip.png": 6 * 130, "s_m_snail_strip.png": 6 * 140, "s_m_rabbit_strip.png": 6 * 170, "s_m_cat_strip.png": 4 * 210}
_S.update({f"s_tab_{k}.png": 96 for k in ("day", "night", "setup", "table", "log", "roles", "menu")})
_S.update({f"s_g_{k}.png": 128 for k in ("dusk", "dawn", "minioninfo", "demoninfo", "nominate", "vote", "execute", "dead")})
_S.update({f"s_em_{k}.png": 220 for k in ("demon", "minions", "notinplay", "youare", "selected", "thisplayer", "yes", "no", "good", "evil",
                                          "general_good", "general_evil", "general_neither", "mad")})
_S.update({f"s_digit{i}.png": 150 for i in range(10)})
_S.update({f"s_scroll{i}.png": 320 for i in (1, 2, 3)})
_S.update({f"s_scroll_used{i}.png": 320 for i in (1, 2, 3)})
_S.update({f"s_seal{i}.png": 120 for i in range(24)})
_S.update({f"s_shard{i}.png": 100 for i in range(1, 9)})
_S.update({f"s_crumb{i}.png": 44 for i in range(1, 9)})
_S.update({f"s_dust{i}.png": 40 for i in range(1, 9)})
_S.update({f"s_spark{i}.png": 64 for i in range(1, 9)})
_S.update({f"s_border_{k}.png": 600 for k in ("town", "out", "minion", "demon")})
_S.update({f"s_medal_{k}.png": 300 for k in ("town", "out", "minion", "demon")})
_S.update({f"s_m_{k}_strip.png": 8 * 210 for k in ("angel", "fool", "monk", "demon")})
ART.update({f.rsplit(".", 1)[0]: (CUT / f, w) for f, w in _S.items()})


def webp_uri(path, width, alpha_quality=100, quality=82):
    im = Image.open(path)
    im = im.convert("RGBA") if im.mode in ("RGBA", "LA", "P") else im.convert("RGB")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=quality, method=6, alpha_quality=alpha_quality)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


# маски гравюры (белое + прозрачность): прозрачность можно сжать с потерями — вдвое легче, на глаз не видно
LOSSY_ALPHA = {"c_engr", "c_frontis", "c_wreath", "c_night", "c_dial", "c_win_good", "c_win_evil"}
LOSSY_ALPHA |= {"h_flame", "h_burst", "h_fog", "h_batline", "h_skull_fire"}
lossy = lambda k: k in LOSSY_ALPHA or k.startswith(("c_em_", "h_em_", "h_ghost", "h_smoke", "h_wisp", "h_soul", "h_cflame", "h_web_", "h_clown", "h_girl", "h_hugger", "h_acid", "d_crack", "d_beams", "d_impact", "k_", "s_"))
# пестрая мозаика витража жмётся плохо: окна (20 штук) и приглушённый витраж за ролью — качеством пониже, на глаз не видно
# «Скрипторий»: фон стола и полосы кадров — пониже, мелкие значки и цифры — как обычно
quality = lambda k: (72 if k.startswith("d_pane") else 65 if k in ("d_reveal", "d_reveal_dark") else 70 if k == "k_hut" else 76 if k.startswith("k_")
                     else 68 if k.startswith(("s_desk", "s_splash", "s_win", "s_header", "s_paper")) else 74 if k.startswith("s_") and not k.startswith(("s_tab_", "s_digit", "s_g_")) else 82)
art = {k: webp_uri(p, w, 70 if lossy(k) else 100, quality(k)) for k, (p, w) in ART.items() if p.exists()}
meta = json.loads((CUT / "meta.json").read_text(encoding="utf-8")) if (CUT / "meta.json").exists() else {}
art_js = ("const ART = " + json.dumps(art, separators=(",", ":")) + ";\n"
          + "const ART_META = " + json.dumps(meta) + ";\n")
# записи на утро (Хэллоуин; просьба пользователя 2026-10-30): audio/morning/<папка, начинается с 0, 1 или 2> — ночь без смертей, с одной
# и с двумя смертями. Звук в страницу не встраиваем (каждое обновление качало бы его заново): файлы — рядом, app/dist/rec/<id>.<расширение>;
# id — от папки и имени файла, поэтому «прослушано» на устройстве переживает пересборку. Имя записи в приложении — имя файла
# (без номера в начале и «_монтаж» в конце); порядок — по имени файла
import hashlib
import re
import shutil
AUDIO = {".mp3", ".m4a", ".aac", ".wav", ".ogg", ".opus"}
REC_SRC, REC_OUT = ROOT / "audio" / "morning", DIST / "rec"
for _ in range(10):  # папку бывает ненадолго держит OneDrive или сервер просмотра — повторяем
    shutil.rmtree(REC_OUT, ignore_errors=True)
    if not REC_OUT.exists() or not any(REC_OUT.iterdir()):
        break
    __import__("time").sleep(0.5)
rec = []
for folder in sorted(REC_SRC.iterdir()) if REC_SRC.is_dir() else []:
    if not folder.is_dir() or folder.name[:1] not in "012":
        continue
    cat = int(folder.name[0])
    for f in sorted(folder.iterdir()):
        if f.suffix.lower() not in AUDIO:
            continue
        rid = hashlib.sha1(f"{cat}/{f.stem}".encode("utf-8")).hexdigest()[:10]
        # в имени файла — ещё и хэш содержимого: service worker берёт прежнюю копию из кэша по адресу, а заменённая запись — новый адрес
        out = f"{rid}-{hashlib.sha1(f.read_bytes()).hexdigest()[:8]}{f.suffix.lower()}"
        REC_OUT.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, REC_OUT / out)
        # «01_Звонок_монтаж» → «Звонок»: номер (порядок файлов) и «монтаж» в названии не нужны, «_» — пробел
        name = re.sub(r"[ _]+монтаж$", "", re.sub(r"^\d+[ _.\-]+", "", f.stem), flags=re.I).replace("_", " ").strip() or f.stem
        rec.append({"id": rid, "c": cat, "n": name, "src": f"rec/{out}"})
art_js += "const MORNING_REC = " + json.dumps(rec, ensure_ascii=False) + ";\n"
# музыка на шаг Аль-Адихии (заметка пользователя 2026-11-03: «приглушённо играет восточная музыка»): audio/alhadikhia/* — так же
# файлами рядом (rec/), не в странице; название — имя файла без номера в начале. Громкость по умолчанию — фон, под который можно
# говорить (просьба пользователя): каждый трек выравнивается к одному уровню MUSIC_DB по замеру из levels.json (g — множитель громкости)
MUSIC_DB = -30
_lv = ROOT / "audio" / "alhadikhia" / "levels.json"
levels = json.loads(_lv.read_text(encoding="utf-8")) if _lv.exists() else {}
music = []
for f in sorted((ROOT / "audio" / "alhadikhia").iterdir()) if (ROOT / "audio" / "alhadikhia").is_dir() else []:
    if f.suffix.lower() not in AUDIO:
        continue
    mid = hashlib.sha1(f"alhadikhia/{f.stem}".encode("utf-8")).hexdigest()[:10]
    out = f"{mid}-{hashlib.sha1(f.read_bytes()).hexdigest()[:8]}{f.suffix.lower()}"
    REC_OUT.mkdir(parents=True, exist_ok=True)
    shutil.copy2(f, REC_OUT / out)
    g = round(min(1.0, 10 ** ((MUSIC_DB - levels[f.stem]) / 20)), 3) if isinstance(levels.get(f.stem), (int, float)) else 0.2
    music.append({"id": mid, "n": re.sub(r"^\d+[ _.\-]+", "", f.stem).replace("_", " ").strip() or f.stem, "src": f"rec/{out}", "g": g})
art_js += "const ALHAD_MUSIC = " + json.dumps(music, ensure_ascii=False) + ";\n"
# колокол конца дня (таймер дня; файл пользователя 2026-11-02, audio/bell/*.mp3): встроен в страницу — короткий, нужен и без сети;
# нет файла — приложение синтезирует удар само
BELL_DIR = ROOT / "audio" / "bell"
bell = next(iter(sorted(BELL_DIR.glob("*.mp3"))), None) if BELL_DIR.is_dir() else None
art_js += "const BELL_SRC = " + json.dumps(base64.b64encode(bell.read_bytes()).decode() if bell else "") + ";\n"
# тиканье за минуту до конца таймера (файл пользователя 2026-11-03, обрезан до ~6 с: audio/tick/*.mp3) — тоже в странице
TICK_DIR = ROOT / "audio" / "tick"
tick = next(iter(sorted(TICK_DIR.glob("*.mp3"))), None) if TICK_DIR.is_dir() else None
art_js += "const TICK_SRC = " + json.dumps(base64.b64encode(tick.read_bytes()).decode() if tick else "") + ";\n"
print("колокол:", bell.name if bell else "нет (синтез)", "| тиканье:", tick.name if tick else "нет", "| музыка Аль-Адихии:", len(music))
print("записей на утро:", len(rec), *[f"{c}: {sum(r['c'] == c for r in rec)}" for c in (0, 1, 2)])
missing = [k for k, (p, _) in ART.items() if not p.exists() and not k.startswith(("d_pane", "d_nave", "d_reveal", "d_arch", "d_crack", "d_beams", "d_impact", "d_digit", "h_digit", "k_", "s_"))]  # витраж, котёл, «Скрипторий» — по желанию
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
