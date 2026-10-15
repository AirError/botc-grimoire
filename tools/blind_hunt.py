"""Blind Hunt (сценарий Alex): лист ролей и лист ночей.

  1) лист ролей: названия по официальному переводу (кроме оставленных своих), «Демоны», сноска «* Кроме первой ночи»,
     затем upgrade_sheet.py: иконки вшиты, кегль подобран под A4 (компактные заголовки + плотные строки);
  2) лист ночей в стиле листа ролей: тот же фон, «BLIND HUNT» / «by Alex», охотник и сова по центру,
     слева первая ночь, справа остальные (повёрнуты на 180°, как в Everyone Can Be Evil). Порядок — официальный.

python tools\\blind_hunt.py            → out/blind_hunt/
Исходники в blind_hunt/src: roles_source.html (лист старого генератора, арт вшит в него), script.json, props.png (луна и солнце).
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
SRC = ROOT / "blind_hunt" / "src"
OUT = ROOT / "out" / "blind_hunt"
DATA = ROOT / "app" / "data"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

KEEP = {"huntsman": "Ловчий"}  # своё название оставлено сознательно (официально — Егерь)
COL = {"townsfolk": "#1A5FB4", "outsider": "#12808F", "minion": "#C0281C", "demon": "#8E1016"}

ru = json.loads((DATA / "ru.json").read_text(encoding="utf-8"))["roles"]
team = {r["id"]: r["team"] for r in json.loads((DATA / "roles.json").read_text(encoding="utf-8"))}
nightsheet = json.loads((DATA / "nightsheet.json").read_text(encoding="utf-8"))
ids = [x for x in json.loads((SRC / "script.json").read_text(encoding="utf-8")) if isinstance(x, str)]
NAME = {rid: KEEP.get(rid, ru[rid]["name"]) for rid in ids}
source = (SRC / "roles_source.html").read_text(encoding="utf-8")


# ---------------------------------------------------------------- лист ролей

def fix_roles(html):
    def name(m):
        return m.group(1) + NAME[m.group(2)] + m.group(3)
    html = re.sub(r'(<div class="role" id="r-([a-z_]+)">.*?<span class="nm"[^>]*>)[^<]+(</span>)', name, html, flags=re.S)
    html = html.replace('<span class="lbl">Демон</span>', '<span class="lbl">Демоны</span>')
    # сноска — под Чёртом, в левой колонке секции Демонов (справа процессия)
    html = html.replace('</div><div class="col art-slot">',
                        '<div class="foot">* Кроме первой ночи</div></div><div class="col art-slot">', 1)
    css = ("<style>.foot { font-family:'LatoEmb',sans-serif; font-weight:700; font-size:var(--ab, 9.6pt);"
           " color:#1E1A16; margin-top:1.2mm; }</style>")
    return html.replace("</head>", css + "</head>", 1)


def build_roles():
    html = fix_roles(source)
    for rid in ids:
        assert f">{NAME[rid]}</span>" in html, rid
    tmp = Path(tempfile.mkdtemp()) / "Blind Hunt — роли.html"
    tmp.write_text(html, encoding="utf-8")
    subprocess.run([sys.executable, str(ROOT / "tools" / "upgrade_sheet.py"), str(tmp), str(OUT),
                    "--slim", "1", "--tight", "1"], check=True)


# ---------------------------------------------------------------- лист ночей

def art():
    """Арт, вшитый в лист ролей: охотник, сова, название, подпись, значки секций, фон."""
    imgs = re.findall(r'<img class="([^"]*)" src="(data:image/\w+;base64,[^"]+)"', source)
    by_cls = {c: u for c, u in imgs if c != "art"}
    plain = [u for c, u in imgs if c == "art"]  # значки: горожане, изгои, приспешники, демон; затем процессия
    bg = re.search(r"background-image:url\('(data:image/\w+;base64,[^']+)'\)", source).group(1)
    return {"hunter": by_cls["art hunter"], "owl": by_cls["art owl"], "ttl": by_cls["art ttl"], "by": by_cls["art by"],
            "minioninfo": plain[2], "demoninfo": plain[3], "bg": bg}


def props_cut(col, row, thr=240):
    """Предмет из листа реквизита (сетка 3×2 на белом): белый фон, связанный с краем, — прозрачный."""
    im = Image.open(SRC / "props.png").convert("RGB")
    w, h = im.width // 3, im.height // 2
    cell = im.crop((col * w, row * h, (col + 1) * w, (row + 1) * h))
    a = np.asarray(cell).astype(int)
    lab, _ = ndimage.label(a.min(axis=2) > thr)
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    edge.discard(0)
    al = np.where(np.isin(lab, list(edge)), 0, 255).astype(np.uint8)
    al = Image.fromarray(al).filter(ImageFilter.GaussianBlur(0.7))
    out = cell.convert("RGBA")
    out.putalpha(al)
    out = out.crop(out.getbbox())
    out.thumbnail((360, 360), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def icon(rid):
    v = "e" if team[rid] in ("minion", "demon") else "g"
    return "data:image/webp;base64," + base64.b64encode((ROOT / "app" / "icons" / f"{rid}_{v}.webp").read_bytes()).decode()


SPECIAL = {"dusk": ("Закат", "#3B3226"), "dawn": ("Рассвет", "#3B3226"),
           "minioninfo": ("Приспешники", COL["minion"]), "demoninfo": ("Демон", COL["demon"])}

# короткие подсказки по официальным текстам листа ночей (ru.json) и вики
NOTES_FIRST = {
    "poppygrower": "в игре: пропустите знакомство злых, Демону — только 3 блефа",
    "minioninfo": "Девица в игре — покажите и её жетон",
    "godfather": "узнаёт, какие Изгои в игре",
    "huntsman": "выбрал Девицу — она узнаёт новую роль",
    "damsel": "Приспешники ещё не видели её жетон — покажите",
}
NOTES_OTHER = {
    "poppygrower": "умер днём или ночью — злые узнают друг друга",
    "imp": "убил себя — Приспешник становится Чёртом",
    "godfather": "если днём умер Изгой",
    "huntsman": "выбрал Девицу — она узнаёт новую роль",
    "damsel": "выбрана Ловчим — покажите новую роль",
    "moonchild": "днём выбрало доброго — он умирает",
    "ravenkeeper": "если умер этой ночью",
    "undertaker": "если днём была казнь",
}

NIGHT_CSS = """
@page { size:A4; margin:0; }
* { box-sizing:border-box; margin:0; padding:0; }
:root { --ab:13pt; --gap:1mm; --ic:calc(var(--ab) * 2.75); }  /* иконка растёт вместе с кеглем: 16.5pt → 16 мм */
body { color:#1E1A16; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.page { position:relative; width:210mm; height:297mm; overflow:hidden; background-color:#F5F3EF;
        background-size:210mm 297mm; background-repeat:no-repeat; }
.half { position:absolute; top:11mm; bottom:15mm; width:76mm; display:flex; flex-direction:column; }
.half.a { left:11mm; }
.half.b { right:11mm; transform:rotate(180deg); }
.head { flex:none; display:flex; align-items:flex-end; gap:1.5mm; }
.head .ttl { width:54mm; height:auto; display:block; }
.head .by { height:7.5mm; width:auto; display:block; margin-bottom:-1.2mm; }
.label { flex:none; display:flex; align-items:center; gap:2.6mm; color:#1F2A44; margin:2.2mm 0 1.2mm; }
.label span { font-family:'Kurale',serif; font-size:12.5pt; letter-spacing:2.4pt; text-transform:uppercase; white-space:nowrap; }
.label i { flex:1; height:0; border-bottom:0.7pt solid currentColor; opacity:.28; }
.flow { flex:1 1 auto; min-height:0; overflow:hidden; display:flex; flex-direction:column; gap:var(--gap); }
/* flex:none — шаг не сжимается, иначе при нехватке места строки налезают друг на друга, а подгонка этого не видит */
.step { flex:none; display:flex; align-items:center; gap:3mm; min-height:var(--ic); }
.ic { flex:0 0 var(--ic); width:var(--ic); height:var(--ic); }
.ic img { width:100%; height:100%; object-fit:contain; display:block; }
.ic.glyph img { padding:1.3mm; }
.tx { flex:1; min-width:0; }
.nm { font-family:'Kurale',serif; font-size:var(--ab); line-height:1.1; white-space:nowrap; }
.note { font-family:'LatoEmb',sans-serif; font-weight:700; font-size:calc(var(--ab) * 0.68); line-height:1.2;
        color:#5E574E; margin-top:0.4mm; }
.center { position:absolute; left:50%; top:50%; transform:translate(-50%, -50%);
          display:flex; flex-direction:column; align-items:center; gap:3mm; }
.center .owl { height:56mm; width:auto; display:block; transform:rotate(180deg); }
.center .hunter { width:36mm; height:auto; display:block; }
"""

NIGHT_JS = """<script>
(async function () {
  await document.fonts.ready;
  await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  const root = document.documentElement.style, flows = [...document.querySelectorAll('.flow')];
  const over = () => flows.some(f => f.scrollHeight > f.clientHeight + 1 || f.scrollWidth > f.clientWidth + 1);
  let ab = 18;
  for (; ab >= 9; ab = Math.round((ab - 0.1) * 10) / 10) { root.setProperty('--ab', ab + 'pt'); if (!over()) break; }
  // промежутки у каждой половины свои: шаги расходятся на всю высоту
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
    A = art()
    A["dusk"], A["dawn"] = props_cut(1, 1), props_cut(2, 1)  # войлочные луна и солнце
    lato = re.search(r"@font-face \{ font-family:'LatoEmb';.*?\}", source, re.S).group(0)

    def step(rid, notes):
        if rid in SPECIAL:
            name, colour = SPECIAL[rid]
            ic = f'<div class="ic glyph"><img src="{A[rid]}" alt=""></div>'
        else:
            name, colour = NAME[rid], COL[team[rid]]
            ic = f'<div class="ic"><img src="{icon(rid)}" alt=""></div>'
        note = f'<div class="note">{notes[rid]}</div>' if rid in notes else ""
        return f'<div class="step">{ic}<div class="tx"><div class="nm" style="color:{colour}">{name}</div>{note}</div></div>'

    def half(cls, label, key, notes):
        order = [x for x in nightsheet[key] if x in ids or x in SPECIAL]
        return (f'<div class="half {cls}"><div class="head"><img class="ttl" src="{A["ttl"]}" alt="Blind Hunt">'
                f'<img class="by" src="{A["by"]}" alt="by Alex"></div>'
                f'<div class="label"><span>{label}</span><i></i></div>'
                f'<div class="flow">{"".join(step(r, notes) for r in order)}</div></div>'), order

    a, first = half("a", "Первая ночь", "firstNight", NOTES_FIRST)
    b, other = half("b", "Остальные ночи", "otherNight", NOTES_OTHER)
    page = (f'<div class="page" style="background-image:url(\'{A["bg"]}\')">'
            f'<div class="center"><img class="owl" src="{A["owl"]}" alt=""><img class="hunter" src="{A["hunter"]}" alt=""></div>'
            f'{a}{b}</div>')
    html = ('<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Blind Hunt — ночи</title>'
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Kurale&display=swap">'
            f'<style>{lato}{NIGHT_CSS}</style></head><body>{page}{NIGHT_JS}</body></html>')
    path = OUT / "Blind Hunt — ночи.html"
    path.write_text(html, encoding="utf-8")
    print("первая ночь:", ", ".join(SPECIAL.get(x, (NAME.get(x),))[0] for x in first))
    print("остальные:  ", ", ".join(SPECIAL.get(x, (NAME.get(x),))[0] for x in other))
    render(path)


def render(path):
    profile = Path(tempfile.gettempdir()) / "ecbe_edge_profile"
    base = [EDGE, "--headless=new", "--disable-gpu", f"--user-data-dir={profile}", "--no-first-run",
            "--virtual-time-budget=20000", "--run-all-compositor-stages-before-draw"]
    pdf, url = path.with_suffix(".pdf"), path.resolve().as_uri()
    subprocess.run(base + ["--no-pdf-header-footer", f"--print-to-pdf={pdf.resolve()}", url], capture_output=True, timeout=180)
    dom = subprocess.run(base + ["--dump-dom", url], capture_output=True, text=True, encoding="utf-8",
                         errors="replace", timeout=180).stdout
    fit = re.search(r'data-fit="([^"]*)"', dom)
    import pymupdf
    doc = pymupdf.open(pdf)
    doc[0].get_pixmap(dpi=70).save(path.with_name(path.stem + "_p1.png"))
    print(f"{path.name}: страниц {doc.page_count}; подгонка: {fit.group(1) if fit else 'нет данных'}")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    if "--night" not in sys.argv:  # --night: только лист ночей
        build_roles()
    build_night()
