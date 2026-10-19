"""Bon Appétit (by Илья): лист ролей «меню» и лист ночей «Порядок подачи».

python tools\\bon_appetit.py            → out/bon_appetit/  (HTML + PDF + PNG для осмотра)
python tools\\bon_appetit.py --night    → только лист ночей

Арт — bon_appetit/art/src/<имя>.png (сгенерирован по prompts_bon_appetit.md); белый фон вырезается здесь же.
Состав — bon_appetit/src/script.json (порядок как в официальном конструкторе). Тексты — официальный ru.json,
ночной порядок — официальный nightsheet.json (сверен с PDF конструктора).
"""
import base64
import io
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from prep_art import fit_a4  # noqa: E402

ART = ROOT / "bon_appetit" / "art" / "src"
OUT = ROOT / "out" / "bon_appetit"
DATA = ROOT / "app" / "data"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

RU = json.loads((DATA / "ru.json").read_text(encoding="utf-8"))
ru = RU["roles"]
team = {r["id"]: r["team"] for r in json.loads((DATA / "roles.json").read_text(encoding="utf-8"))}
nightsheet = json.loads((DATA / "nightsheet.json").read_text(encoding="utf-8"))
ids = [x for x in json.loads((ROOT / "bon_appetit" / "src" / "script.json").read_text(encoding="utf-8")) if isinstance(x, str)]

KEEP = {"huntsman": "Ловчий"}  # решение пользователя (официально — Егерь)
NAME = {rid: KEEP.get(rid, ru[rid]["name"]) for rid in ids}

GOOD, EVIL, GOLD, INK = "#1E4D36", "#7B1C2A", "#9C7A36", "#2A1F1A"
COL = {"townsfolk": GOOD, "outsider": GOOD, "minion": EVIL, "demon": EVIL}
TEAMS = [("townsfolk", "Горожане", "Main Courses"), ("outsider", "Изгои", "Side Dishes"),
         ("minion", "Приспешники", "Sauces & Spices"), ("demon", "Демоны", "Desserts")]
JINX = ("scarletwoman", "fanggu", RU["jinxes"]["fanggu-scarletwoman"])

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
         'family=Playfair+Display:ital,wght@0,700;0,800;1,500;1,600&'
         'family=Lora:ital,wght@0,500;0,600;0,700;1,500;1,600&display=swap">')


# ---------------------------------------------------------------- арт

def cut(name, edge_thr=240, inner_thr=250, min_area=8):
    """Белый фон в два прохода: связанный с краем кадра + замкнутые просветы чистого белого (буквы «o», «p»…)."""
    im = Image.open(ART / f"{name}.png").convert("RGB")
    a = np.asarray(im).astype(int)
    lab, _ = ndimage.label(a.min(axis=2) > edge_thr)
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    edge.discard(0)
    al = np.where(np.isin(lab, list(edge)), 0, 255).astype(np.uint8)
    m = (al > 0) & (a.min(axis=2) > inner_thr)
    lab2, n = ndimage.label(m)
    if n:
        sizes = ndimage.sum(m, lab2, range(1, n + 1))
        al[np.isin(lab2, [i + 1 for i, s in enumerate(sizes) if s >= min_area])] = 0
    al = Image.fromarray(al).filter(ImageFilter.GaussianBlur(0.7))
    out = im.convert("RGBA")
    out.putalpha(al)
    return out.crop(out.getbbox())


def uri(im, maxw=None, maxh=None, quality=90):
    if maxw and im.width > maxw:
        im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
    if maxh and im.height > maxh:
        im = im.resize((round(im.width * maxh / im.height), maxh), Image.LANCZOS)
    buf = io.BytesIO()
    if im.mode == "RGBA":
        im.save(buf, "PNG", optimize=True)
        mime = "png"
    else:
        im.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True)
        mime = "jpeg"
    return f"data:image/{mime};base64," + base64.b64encode(buf.getvalue()).decode()


_art = {}


def art(name, **kw):
    if name not in _art:
        _art[name] = uri(cut(name), **kw)
    return _art[name]


def bg(bottom_corners=True):
    im = fit_a4(Image.open(ART / "bg.png").convert("RGB"))  # 1024×1536 → пропорции A4, углы не трогаются
    if not bottom_corners:
        im = drop_bottom_corners(im)
    return uri(im, quality=90)


def drop_bottom_corners(im, w=190, h=230, inset=22, strip=12, shift=230):
    """Убирает нижние угловые виньетки (на листе ролей в них упираются иконки нижних ролей).
    Всё, что внутри золотой линии отличается от бумаги, заменяется чистым участком: у боковой линии — тем же
    столбцом выше (линия и её тень вдоль листа одинаковые), дальше — бумагой сбоку."""
    a = np.asarray(im).astype(int)
    out = a.copy()
    H, W = a.shape[:2]
    ys = np.arange(H - h, H - inset)
    for xs, dx, near in ((np.arange(inset, inset + w), shift, lambda x: x < inset + strip),
                         (np.arange(W - inset - w, W - inset), -shift, lambda x: x >= W - inset - strip)):
        Y, X = np.meshgrid(ys, xs, indexing="ij")
        reg = a[Y, X]
        paper = np.median(a[Y, X + dx].reshape(-1, 3), axis=0)
        mask = ndimage.binary_dilation(np.abs(reg - paper).max(axis=2) > 22, iterations=3)
        sy, sx = np.where(near(X), Y - h, Y), np.where(near(X), X, X + dx)
        out[Y[mask], X[mask]] = a[sy[mask], sx[mask]]
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))


def icon(rid):
    v = "e" if team[rid] in ("minion", "demon") else "g"
    return "data:image/webp;base64," + base64.b64encode((ROOT / "app" / "icons" / f"{rid}_{v}.webp").read_bytes()).decode()


# ---------------------------------------------------------------- тексты

def ability(rid):
    s = ru[rid]["ability"].replace(" – ", " — ").replace(" - ", " — ")
    if not s.endswith((".", ")", "]")):
        s += "."
    s = re.sub(r"\[([^\]]+)\]", lambda m: "<b>[" + re.sub(r"(\S) (Изго\w+)", r"\1&nbsp;\2", m.group(1).replace("-", "−")) + "]</b>", s)
    return s


def role_html(rid):
    return (f'<div class="role"><div class="ic"><img src="{icon(rid)}" alt=""></div>'
            f'<div class="tx"><span class="nm" style="color:{COL[team[rid]]}">{NAME[rid]}</span>&nbsp;— {ability(rid)}</div></div>')


# ---------------------------------------------------------------- лист ролей

BASE_CSS = """
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { background: #7d7a74; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: 'Lora', Georgia, serif; color: %s; }
.page { position: relative; width: 210mm; height: 297mm; overflow: hidden; background: #F4E7CB; }
@media screen { .page { margin: 8mm auto; box-shadow: 0 1mm 4mm rgba(0,0,0,.35); } }
.frame { position: absolute; inset: 0; width: 210mm; height: 297mm; display: block; }
""" % INK

ROLES_CSS = """
:root { --ab: 10pt; --gap: 1mm; --scene: 11mm; }
.content { position: absolute; left: 8.5mm; right: 8.5mm; top: 8.5mm; bottom: 9mm; display: flex; flex-direction: column; }
/* шапка: название и подпись между угловыми виньетками рамки, натюрморт справа */
.head { flex: none; display: flex; align-items: center; justify-content: space-between; padding: 0 12mm 0 14mm; }
.titlebox { display: flex; align-items: flex-end; gap: 2.5mm; }
.title { display: block; width: 56mm; height: auto; }
.by { display: block; height: 8mm; width: auto; margin-bottom: -1.5mm; }
.feast { display: block; width: 46mm; height: auto; }
.flow { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
/* шапка секции — строка меню: значок, название, точки до края, английское название «блюда» */
.sh { flex: none; display: flex; align-items: center; gap: 2mm; margin: 0.9mm 0 0.3mm; }
.sh .medal { flex: none; width: 6.5mm; height: 6.5mm; object-fit: contain; }
.sh .lbl { font-family: 'Playfair Display', serif; font-weight: 800; font-size: 11pt; letter-spacing: .16em;
           text-transform: uppercase; white-space: nowrap; }
.sh .dots { flex: 1; align-self: flex-end; margin: 0 1mm 2.6mm; border-bottom: 1.6pt dotted %s; opacity: .8; }
.sh .en { font-family: 'Playfair Display', serif; font-style: italic; font-weight: 600; font-size: 12.5pt;
          color: %s; white-space: nowrap; }
.cols { display: grid; grid-template-columns: 1fr 1fr; column-gap: 4mm; align-items: start; }
.col { display: flex; flex-direction: column; gap: var(--gap); }
.role { display: flex; align-items: flex-start; gap: 2.2mm; }
.ic { flex: 0 0 9.5mm; width: 9.5mm; height: 9.5mm; margin-top: -0.2mm; }
.ic img { width: 100%%; height: 100%%; object-fit: contain; display: block; }
.tx { font-size: var(--ab); font-weight: 600; line-height: 1.07; }
.nm { font-family: 'Playfair Display', serif; font-weight: 800; font-size: calc(var(--ab) + 0.7pt); line-height: 1; }
.tx b { font-weight: 700; }
/* «финал ужина» — под Блудницей (просьба пользователя), участвует в подгонке */
.scene { display: block; height: var(--scene); width: auto; max-width: 100%%; margin: 0.3mm auto 0; object-fit: contain; }
/* сноска — под последней ролью более короткой колонки Демонов, вровень с текстом ролей */
.extra { padding-left: 11.7mm; font-size: calc(var(--ab) * 0.88); line-height: 1.16; font-weight: 600; }
.extra b { font-family: 'Playfair Display', serif; font-weight: 800; color: #7B1C2A; }
.extra .star { font-weight: 700; }
""" % (GOLD, GOLD)

ROLES_JS = """<script>
(async function () {
  await document.fonts.ready;
  await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  const root = document.documentElement.style, flow = document.querySelector('.flow'), mm = 96 / 25.4;
  const over = () => flow.scrollHeight > flow.clientHeight + 1 || flow.scrollWidth > flow.clientWidth + 1;
  // роли секции делятся на две колонки (порядок сохраняется) так, чтобы секция была как можно ниже
  const groups = [...document.querySelectorAll('.cols')].map(c => ({c, cols: [...c.children], roles: [...c.querySelectorAll('.role, .extra, .scene')]}));
  const place = (g, k) => g.roles.forEach((r, i) => g.cols[i < k ? 0 : 1].appendChild(r));
  function balance() {
    for (const g of groups) {
      const n = g.roles.length, hs = [];
      for (let k = 1; k < n; k++) { place(g, k); hs[k] = g.c.getBoundingClientRect().height; }
      const mn = Math.min(...hs.slice(1)), off = k => Math.abs(k - n / 2);
      let best = 0;
      for (let k = 1; k < n; k++) if (hs[k] <= mn + 0.5 && (!best || off(k) < off(best) || (off(k) == off(best) && k > best))) best = k;
      if (best) place(g, best);
    }
  }
  let ab = 14;
  for (; ab >= 7.5; ab = Math.round((ab - 0.1) * 10) / 10) { root.setProperty('--ab', ab + 'pt'); balance(); if (!over()) break; }
  let gap = 1;
  for (; gap <= 4; gap = Math.round((gap + 0.1) * 10) / 10) {
    root.setProperty('--gap', gap + 'mm'); balance();
    if (over()) { gap = Math.round((gap - 0.1) * 10) / 10; root.setProperty('--gap', gap + 'mm'); balance(); break; }
  }
  document.body.dataset.fit = 'ab=' + ab + 'pt gap=' + gap + 'mm overflow=' + over();
})();
</script>"""


def build_roles():
    by_team = {t: [r for r in ids if team[r] == t] for t, _, _ in TEAMS}
    secs = ""
    for t, label, en in TEAMS:
        roles = by_team[t]
        k = (len(roles) + 1) // 2
        parts = ["".join(role_html(r) for r in part) for part in (roles[:k], roles[k:])]
        if t == "minion":  # тарелки — в конце правой колонки, под Блудницей
            parts[1] += f'<img class="scene" src="{art("scene", maxw=1000)}" alt="">'
        if t == "demon":  # сноска всегда в конце правой колонки (balance в листе это сохраняет); джинкс — только на листе ночей
            parts[1] += '<div class="extra"><div class="star">* Кроме первой ночи</div></div>'
        cols = "".join(f'<div class="col">{p}</div>' for p in parts)
        secs += (f'<div class="sh" style="color:{COL[t]}"><img class="medal" src="{art("sec_" + t, maxh=300)}" alt="">'
                 f'<span class="lbl">{label}</span><i class="dots"></i><span class="en">{en}</span></div>'
                 f'<div class="cols">{cols}</div>')

    page = (f'<div class="page"><img class="frame" src="{bg(bottom_corners=False)}" alt="">'
            f'<div class="content"><div class="head"><div class="titlebox">'
            f'<img class="title" src="{art("title", maxw=1400)}" alt="Bon Appétit">'
            f'<img class="by" src="{art("by", maxw=800)}" alt="by Илья"></div>'
            f'<img class="feast" src="{art("header", maxw=1200)}" alt=""></div>'
            f'<div class="flow">{secs}</div></div></div>')
    html = (f'<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Bon Appétit — роли</title>'
            f'{FONTS}<style>{BASE_CSS}{ROLES_CSS}</style></head><body>{page}{ROLES_JS}</body></html>')
    path = OUT / "Bon Appétit — роли.html"
    path.write_text(html, encoding="utf-8")
    render(path)


# ---------------------------------------------------------------- лист ночей

SPECIAL = {"dusk": ("Закат", INK), "dawn": ("Рассвет", INK),
           "minioninfo": ("Приспешники", EVIL), "demoninfo": ("Демон", EVIL)}

# короткие подсказки по официальным текстам листа ночей (ru.json) и How to Run на вики
NOTES_FIRST = {
    "kazali": "выбирает, кто станет какими Приспешниками: каждому — «Теперь вы», жетон и «злой»",
    "minioninfo": "Девица в игре — покажите и её жетон",
    "godfather": "узнаёт, какие Изгои в игре",
    "huntsman": "выбрал Девицу — она узнаёт новую роль",
    "damsel": "выбрана Ловчим — покажите новую роль",
}
NOTES_OTHER = {
    "gambler": "угадывает роль игрока: ошибся — умирает",
    "scarletwoman": "если сегодня стала Демоном",
    "imp": "убил себя — Приспешник становится Чёртом",
    "fanggu": "выбрал Изгоя (1 раз) — тот становится злым Фань Гу",
    "godfather": "если днём умер Изгой",
    "huntsman": "выбрал Девицу — она узнаёт новую роль",
    "damsel": "выбрана Ловчим — покажите новую роль",
    "ravenkeeper": "если умер этой ночью",
}
FOOT_FIRST = ("<b>Казали</b> в игре: при подготовке уберите жетоны Приспешников и добавьте вместо них Горожан или Изгоев. "
              "<b>Каннибал</b> просыпается тогда же, когда проснулась бы роль последнего казнённого.")

NIGHT_CSS = """
:root { --ab: 13pt; --gap: 1mm; --ic: calc(var(--ab) * 2.7); }
.half { position: absolute; top: 9mm; bottom: 9mm; width: 80mm; display: flex; flex-direction: column; }
.half.a { left: 9.5mm; }
.half.b { right: 9.5mm; transform: rotate(180deg); }
/* начало и конец половины отодвинуты от угловых виньеток рамки */
.nhead { flex: none; display: flex; align-items: flex-end; gap: 2mm; padding-left: 14mm; }
.nhead .title { display: block; width: 50mm; height: auto; }
.nhead .by { display: block; height: 7mm; width: auto; margin-bottom: -1mm; }
.label { flex: none; display: flex; align-items: center; gap: 2.5mm; color: %s; margin: 2mm 0 1.2mm; }
.label span { font-family: 'Playfair Display', serif; font-weight: 800; font-size: 11pt; letter-spacing: .16em;
              text-transform: uppercase; white-space: nowrap; }
.label i { flex: 1; height: 0; border-bottom: 0.6pt solid %s; }
.flow { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: var(--gap); }
.step { flex: none; display: flex; align-items: center; gap: 3mm; min-height: var(--ic); }
.ic { flex: 0 0 var(--ic); width: var(--ic); height: var(--ic); }
.ic img { width: 100%%; height: 100%%; object-fit: contain; display: block; }
.ic.glyph img { padding: 0.8mm; }
.tx { flex: 1; min-width: 0; }
.nm { font-family: 'Playfair Display', serif; font-weight: 700; font-size: var(--ab); line-height: 1.1; white-space: nowrap; }
.note { font-style: italic; font-weight: 600; font-size: calc(var(--ab) * 0.64); line-height: 1.2; color: #5E4B3C; margin-top: 0.4mm; }
.nfoot { flex: none; padding: 1.5mm 0 0 14mm; font-size: 9pt; line-height: 1.25; font-weight: 600; color: #4A3B30; }
.nfoot b { font-family: 'Playfair Display', serif; font-weight: 800; }
.center { position: absolute; left: 50%%; top: 50%%; transform: translate(-50%%, -50%%); }
.center img { display: block; width: 26mm; height: auto; }  /* между половинами ~31 мм */
""" % (EVIL, GOLD)

NIGHT_JS = """<script>
(async function () {
  await document.fonts.ready;
  await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  const root = document.documentElement.style, flows = [...document.querySelectorAll('.flow')];
  const over = () => flows.some(f => f.scrollHeight > f.clientHeight + 1 || f.scrollWidth > f.clientWidth + 1);
  let ab = 18;
  for (; ab >= 9; ab = Math.round((ab - 0.1) * 10) / 10) { root.setProperty('--ab', ab + 'pt'); if (!over()) break; }
  const gaps = flows.map(f => {
    let g = 1;
    for (; g <= 12; g = Math.round((g + 0.1) * 10) / 10) {
      f.style.setProperty('--gap', g + 'mm');
      if (over()) { g = Math.round((g - 0.1) * 10) / 10; f.style.setProperty('--gap', g + 'mm'); break; }
    }
    return Math.min(g, 12);
  });
  document.body.dataset.fit = 'ab=' + ab + 'pt gap=' + gaps.join('/') + 'mm overflow=' + over();
})();
</script>"""


def build_night():
    glyph = {k: art(k, maxh=420) for k in SPECIAL}

    def step(rid, notes):
        if rid in SPECIAL:
            name, colour = SPECIAL[rid]
            ic = f'<div class="ic glyph"><img src="{glyph[rid]}" alt=""></div>'
        else:
            name, colour = NAME[rid], COL[team[rid]]
            ic = f'<div class="ic"><img src="{icon(rid)}" alt=""></div>'
        note = f'<div class="note">{notes[rid]}</div>' if rid in notes else ""
        return f'<div class="step">{ic}<div class="tx"><div class="nm" style="color:{colour}">{name}</div>{note}</div></div>'

    def half(cls, label, key, notes, foot):
        order = [x for x in nightsheet[key] if x in ids or x in SPECIAL]
        print(f"{label}:", ", ".join(SPECIAL.get(x, (NAME.get(x),))[0] for x in order))
        return (f'<div class="half {cls}"><div class="nhead"><img class="title" src="{art("title", maxw=1400)}" alt="Bon Appétit">'
                f'<img class="by" src="{art("by", maxw=800)}" alt="by Илья"></div>'
                f'<div class="label"><span>{label}</span><i></i></div>'
                f'<div class="flow">{"".join(step(r, notes) for r in order)}</div><div class="nfoot">{foot}</div></div>')

    a, b, text = JINX
    foot_other = f'<b style="color:{EVIL}">{NAME[a]} и {NAME[b]}:</b> {text}'
    page = (f'<div class="page"><img class="frame" src="{bg()}" alt="">'
            f'<div class="center"><img src="{art("night_center", maxh=1400)}" alt=""></div>'
            f'{half("a", "Первая ночь", "firstNight", NOTES_FIRST, FOOT_FIRST)}'
            f'{half("b", "Последующие ночи", "otherNight", NOTES_OTHER, foot_other)}</div>')
    html = (f'<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Bon Appétit — ночи</title>'
            f'{FONTS}<style>{BASE_CSS}{NIGHT_CSS}</style></head><body>{page}{NIGHT_JS}</body></html>')
    path = OUT / "Bon Appétit — ночи.html"
    path.write_text(html, encoding="utf-8")
    render(path)


def render(path):
    profile = Path(tempfile.gettempdir()) / "ecbe_edge_profile"
    base = [EDGE, "--headless=new", "--disable-gpu", f"--user-data-dir={profile}", "--no-first-run",
            "--virtual-time-budget=25000", "--run-all-compositor-stages-before-draw"]
    pdf, url = path.with_suffix(".pdf"), path.resolve().as_uri()
    subprocess.run(base + ["--no-pdf-header-footer", f"--print-to-pdf={pdf.resolve()}", url], capture_output=True, timeout=180)
    dom = subprocess.run(base + ["--dump-dom", url], capture_output=True, text=True, encoding="utf-8",
                         errors="replace", timeout=180).stdout
    fit = re.search(r'data-fit="([^"]*)"', dom)
    import pymupdf
    doc = pymupdf.open(pdf)
    doc[0].get_pixmap(dpi=70).save(path.with_name(path.stem + "_p1.png"))
    print(f"{path.name}: страниц {doc.page_count}; подгонка: {fit.group(1) if fit else 'нет данных'}; "
          f"{path.stat().st_size / 1e6:.1f} МБ")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    if "--night" not in sys.argv:
        build_roles()
    build_night()
