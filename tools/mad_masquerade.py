"""Mad Masquerade (by Alex): лист ролей. Листа ночей нет — пользователь ведёт игру через приложение.

python tools\\mad_masquerade.py    → out/mad_masquerade/  (HTML + PDF + PNG для осмотра)

Стиль — праздничная средневековая рукопись с маргиналиями (акварель). Арт — mad_masquerade/art/src: название и подпись —
вариант 1 (левый верхний) из сеток 2×2 пользователя. Значков у шапок секций нет (свеча и череп — иконки для приложения, не для листа).
Главный приоритет — текст (пользователь): картинки уменьшаются и двигаются под текст. Крупные нижние угловые фигуры
рамки (скелет, песочные часы) стёрты с фона — в них упирались нижние роли; верхние (колпак, маска) обходит шапка.
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import bon_appetit as ba  # noqa: E402

ART = ROOT / "mad_masquerade" / "art" / "src"
OUT = ROOT / "out" / "mad_masquerade"
ru, team = ba.ru, ba.team
ids = [x for x in json.loads((ROOT / "mad_masquerade" / "src" / "script.json").read_text(encoding="utf-8")) if isinstance(x, str)]
KEEP = {"huntsman": "Ловчий", "assassin": "Убийца"}  # решения пользователя (официально — Егерь, Ассасин)
NAME = {rid: KEEP.get(rid, ru[rid]["name"]) for rid in ids}

GOOD, EVIL, GOLD, INK = "#23457C", "#8E1B1E", "#A27F35", "#2A1E16"
COL = {"townsfolk": GOOD, "outsider": GOOD, "minion": EVIL, "demon": EVIL}
# значков секций нет: свеча и череп пользователя — иконки для приложения, на листе их не использовать
TEAMS = [("townsfolk", "Горожане", None), ("outsider", "Изгои", None), ("minion", "Приспешники", None), ("demon", "Демоны", None)]
# девиз «Под каждой маской…» на листе не нужен (пользователь)

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
         'family=Literata:ital,opsz,wght@0,7..72,600;0,7..72,700;0,7..72,800;1,7..72,500;1,7..72,600&display=swap">')

_art = {}


def art(name, **kw):
    if name not in _art:
        if not (ART / f"{name}.png").exists():
            return None
        ba.ART = ART  # cut() из bon_appetit читает свою папку арта
        _art[name] = ba.uri(ba.cut(name), **kw)
    return _art[name]


def feathered(name, fx=0.16, fy=0.2, **kw):
    """Картинка с размытыми краями (просьба пользователя: «края не резкие»): к вырезанному фону добавляется плавное
    затухание к каждому краю — fx/fy доли ширины/высоты; сглаживание smoothstep, без ступеньки."""
    if name not in _art:
        ba.ART = ART
        im = ba.cut(name)
        W, H = im.size
        ramp = lambda n, f: np.clip(np.minimum(np.arange(n), np.arange(n)[::-1]) / (f * n), 0, 1)
        sx, sy = ramp(W, fx), ramp(H, fy)
        m = np.outer(sy * sy * (3 - 2 * sy), sx * sx * (3 - 2 * sx))
        a = np.asarray(im.getchannel("A")).astype(float) * m
        im.putalpha(ba.Image.fromarray(a.round().astype(np.uint8)))
        _art[name] = ba.uri(im, **kw)
    return _art[name]


def erase_bottom_corners(im, w=175, h=300, inset=6, strip=52, shift=300, thr=26):
    """Стирает нижние угловые фигуры рамки. Всё, что отличается от пергамента, заменяется соседним участком:
    у боковой лозы — тем же столбцом выше (лоза продолжается), дальше — пергаментом сбоку на той же высоте
    (нижняя лоза продолжается)."""
    a = np.asarray(im).astype(int)
    out = a.copy()
    H, W = a.shape[:2]
    ys = np.arange(H - h, H - inset)
    for xs, dx, near in ((np.arange(inset, inset + w), shift, lambda x: x < inset + strip),
                         (np.arange(W - inset - w, W - inset), -shift, lambda x: x >= W - inset - strip)):
        Y, X = np.meshgrid(ys, xs, indexing="ij")
        paper = np.median(a[Y, X + dx].reshape(-1, 3), axis=0)
        mask = ndimage.binary_dilation(np.abs(a[Y, X] - paper).max(axis=2) > thr, iterations=3)
        sy, sx = np.where(near(X), Y - h, Y), np.where(near(X), X, X + dx)
        out[Y[mask], X[mask]] = a[sy[mask], sx[mask]]
    return ba.Image.fromarray(out.clip(0, 255).astype(np.uint8))


def bg():
    im = erase_bottom_corners(ba.fit_a4(ba.Image.open(ART / "bg.png").convert("RGB")))
    return ba.uri(im, quality=90)


def ability(rid):
    s = ba.ability(rid)
    for old, new in (("Ассасин", "Убийца"), ("Егер", "Ловч")):
        s = s.replace(old, new)
    return s


def role_html(rid):
    return (f'<div class="role"><div class="ic"><img src="{ba.icon(rid)}" alt=""></div>'
            f'<div class="tx"><span class="nm" style="color:{COL[team[rid]]}">{NAME[rid]}</span>&nbsp;— {ability(rid)}</div></div>')


CSS = """
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { background: #7a746c; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: 'Literata', Georgia, serif; color: %(ink)s; }
.page { position: relative; width: 210mm; height: 297mm; overflow: hidden; background: #F3E2BF; }
@media screen { .page { margin: 8mm auto; box-shadow: 0 1mm 4mm rgba(0,0,0,.35); } }
.frame { position: absolute; inset: 0; width: 210mm; height: 297mm; display: block; }
.art { mix-blend-mode: multiply; }
:root { --ab: 10pt; --gap: var(--gap0); --gap0: 1.8mm; }
.content { position: absolute; left: 11mm; right: 11mm; top: 7mm; bottom: 11.5mm; display: flex; flex-direction: column; }
/* шапка между колпаком (слева) и маской (справа) рамки */
.head { flex: none; display: flex; align-items: center; gap: 1.2mm; padding: 0 15mm 0 22mm; }
.title { flex: none; display: block; width: 36mm; height: auto; }  /* меньше — ниже шапка: +0.3 pt тексту */
/* align-items: flex-start — иначе колонка растягивает подпись по ширине (было «очень растянуто») */
.side { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-end; align-self: stretch; padding-bottom: 1.6mm; }
.by { display: block; height: 6.5mm; width: auto; flex: none; }
/* башня — во всю высоту шапки (высоту задаёт название), шапку не увеличивает */
.tower { flex: none; display: block; width: 76mm; height: auto; max-height: 24mm; object-fit: contain; }
.flow { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.sh { flex: none; display: flex; align-items: center; gap: 2mm; margin: 1mm 0 0.4mm; }
.sh .medal { flex: none; width: 6.5mm; height: 6.5mm; object-fit: contain; }
.sh .lbl { font-weight: 800; font-size: 11pt; letter-spacing: .2em; text-transform: uppercase; white-space: nowrap; }
.sh .rule { flex: 1; height: 0; border-bottom: 0.8pt solid %(gold)s; }
.sh .note { flex: none; font-size: 9.5pt; font-weight: 700; color: %(ink)s; white-space: nowrap; }
.cols { display: grid; grid-template-columns: 1fr 1fr; column-gap: 4mm; align-items: start; }
.col { display: flex; flex-direction: column; gap: var(--gap); }
.role { display: flex; align-items: flex-start; gap: 2.2mm; }
.ic { flex: 0 0 9.5mm; width: 9.5mm; height: 9.5mm; margin-top: -0.2mm; }
.ic img { width: 100%%; height: 100%%; object-fit: contain; display: block; }
.tx { font-size: var(--ab); font-weight: 600; line-height: 1.1; }
.nm { font-weight: 800; font-size: calc(var(--ab) + 0.8pt); line-height: 1; }
.tx b { font-weight: 800; }
.extra { padding-left: 11.7mm; font-size: calc(var(--ab) * 0.88); font-weight: 700; }
/* пляска ставится поверх листа (absolute) от конца короткой колонки до нижнего края, заходя на поле с лозой */
.scene { display: block; position: absolute; object-fit: contain; }
""" % {"ink": INK, "gold": GOLD}

JS = """<script>
(async function () {
  await document.fonts.ready;
  await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  const root = document.documentElement.style, flow = document.querySelector('.flow'), mm = 96 / 25.4;
  const over = () => flow.scrollHeight > flow.clientHeight + 1 || flow.scrollWidth > flow.clientWidth + 1;
  const groups = [...document.querySelectorAll('.cols')].map(c => ({c, cols: [...c.children], roles: [...c.querySelectorAll('.role, .extra')]}));
  const scene = document.querySelector('.scene');
  const place = (g, k) => g.roles.forEach((r, i) => g.cols[i < k ? 0 : 1].appendChild(r));
  function balance() {
    if (scene) scene.remove();
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
  const gap0 = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gap0'));
  // промежутки между ролями не растягиваются: остаток высоты уходит пляске внизу (просьба пользователя — крупнее)
  const gap = gap0;
  root.setProperty('--gap', gap + 'mm'); balance();
  // пляска — в самый большой просвет под более короткой колонкой секции, уже после подгонки (текст не теснит);
  // для нижней секции просвет считается до низа листа (картинке можно зайти на поле с лозой — пользователь разрешил)
  let room = 0, where = 'нет места';
  if (scene) {
    const page = document.querySelector('.page'), pg = page.getBoundingClientRect();
    const end = col => col.lastElementChild.getBoundingClientRect().bottom;
    let best = null, top = 0, bottom = 0;
    groups.forEach((g, i) => {
      const [a, b] = g.cols, short = end(a) <= end(b) ? a : b;
      const lim = i === groups.length - 1 ? pg.bottom - 1 * mm : Math.max(end(a), end(b)) - gap * mm;  // края размыты — можно до самого низа
      const r = (lim - end(short)) / mm - 1;
      if (r > room) { room = r; best = short; top = end(short) + mm; bottom = lim; where = g.c.dataset.team; }
    });
    if (best && room >= 9) {
      const cr = best.getBoundingClientRect();
      Object.assign(scene.style, { left: (cr.left - pg.left) + 'px', width: cr.width + 'px',
                                   top: (top - pg.top) + 'px', height: Math.min(bottom - top, 46 * mm) + 'px' });
      page.appendChild(scene);
    } else where = 'нет места';
  }  document.body.dataset.fit = 'ab=' + ab + 'pt gap=' + gap + 'mm scene=' + room.toFixed(1) + 'mm (' + where + ') overflow=' + over();
})();
</script>"""


def build_roles():
    secs = ""
    for t, label, medal in TEAMS:
        roles = [r for r in ids if team[r] == t]
        k = (len(roles) + 1) // 2
        parts = ["".join(role_html(r) for r in part) for part in (roles[:k], roles[k:])]
        # сноска — в строке шапки Демонов справа: освобождает колонку под пляску
        note = '<span class="note">* Кроме первой ночи</span>' if t == "demon" else ""
        m = art(medal, maxh=300) if medal else None
        secs += (f'<div class="sh" style="color:{COL[t]}">' + (f'<img class="medal art" src="{m}" alt="">' if m else "") +
                 f'<span class="lbl">{label}</span><i class="rule"></i>{note}</div>'
                 f'<div class="cols" data-team="{label}">' + "".join(f'<div class="col">{p}</div>' for p in parts) + "</div>")
    page = (f'<div class="page"><img class="frame" src="{bg()}" alt="">'
            f'<div class="content"><div class="head">'
            f'<img class="title art" src="{art("title", maxw=900)}" alt="Mad Masquerade">'
            f'<div class="side"><img class="by art" src="{art("by", maxw=600)}" alt="by Alex"></div>'
            f'<img class="tower art" src="{art("header", maxw=1100)}" alt=""></div>'
            f'<div class="flow">{secs}<img class="scene art" src="{feathered("scene", maxw=1300)}" alt=""></div></div></div>')
    html = (f'<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Mad Masquerade — роли</title>'
            f'{FONTS}<style>{CSS}</style></head><body>{page}{JS}</body></html>')
    path = OUT / "Mad Masquerade — роли.html"
    path.write_text(html, encoding="utf-8")
    ba.render(path)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    build_roles()
