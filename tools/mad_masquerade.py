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
    """Новая рамка (bg2.png, маленькие углы — по промпту 2026-11-03) берётся как есть; старая — со стёртыми нижними углами."""
    if (ART / "bg2.png").exists():
        return ba.uri(ba.fit_a4(ba.Image.open(ART / "bg2.png").convert("RGB")), quality=90)
    im = erase_bottom_corners(ba.fit_a4(ba.Image.open(ART / "bg.png").convert("RGB")))
    return ba.uri(im, quality=90)


NEW_FRAME = (ART / "bg2.png").exists()


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
:root { --ab: 10pt; --gap: var(--gap0); --gap0: 1.8mm; --title: 60mm; --hpad-l: %(hl)s; --hpad-r: %(hr)s; --side: %(side)s; --bottom: %(bottom)s; }
.content { position: absolute; left: var(--side); right: var(--side); top: 7mm; bottom: var(--bottom); display: flex; flex-direction: column; }
/* шапка между угловыми фигурками рамки */
.head { flex: none; display: flex; align-items: center; gap: 1.2mm; padding: 0 var(--hpad-r) 0 var(--hpad-l); }
/* название крупнее (замечание пользователя «название мелкое»), башня — под его высоту */
.title { flex: none; display: block; width: var(--title); height: auto; }
/* align-items: flex-start — иначе колонка растягивает подпись по ширине (было «очень растянуто») */
/* подпись — по центру промежутка между названием и башней, на уровне нижней строки названия (просьба пользователя) */
.side { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-end; align-self: stretch; padding: 0 0 1mm 3mm; }
/* крупнее (просьба пользователя), пропорции сохраняются; правым краем может заходить под гирлянду башни (там пусто) */
.by { display: block; height: 12.5mm; width: auto; flex: none; margin-right: -9mm; position: relative; z-index: 1; }
/* башня — во всю высоту шапки (высоту задаёт название), шапку не увеличивает */
.tower { flex: none; display: block; width: 94mm; height: auto; max-height: calc(var(--title) * 0.68); object-fit: contain; margin-left: auto; }  /* крупнее (просьба пользователя), не выше названия */
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
/* пляска ставится поверх листа (absolute) от конца короткой колонки до нижнего края, заходя на поле с лозой;
   без multiply — картинка лежит поверх рамки, лоза её не перекрывает (замечание пользователя) */
.scene { display: block; position: absolute; object-fit: contain; }
/* миниатюра в золотой рамке (scene_mini.png) — прямоугольник: ни на текст, ни на рамку листа не заходит */
.scene.mini { filter: drop-shadow(0 0.4mm 0.6mm rgba(60,40,20,.35)); }
""" % {"ink": INK, "gold": GOLD, "hl": "4mm" if NEW_FRAME else "22mm", "hr": "0mm" if NEW_FRAME else "15mm",
         "side": "9.5mm" if NEW_FRAME else "11mm", "bottom": "8.5mm" if NEW_FRAME else "11.5mm"}  # тонкая новая рамка — поля уже

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
      if (g.c.dataset.split) { place(g, +g.c.dataset.split); continue; }  // делёж задан вручную (SPLIT)
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
  const mini = scene && (scene.classList.contains('mini') || scene.classList.contains('soft'));
  const soft = scene && scene.classList.contains('soft');
  if (scene) {
    const page = document.querySelector('.page'), pg = page.getBoundingClientRect();
    const end = col => col.lastElementChild.getBoundingClientRect().bottom;
    let best = null, top = 0, bottom = 0;
    groups.forEach((g, i) => {
      const [a, b] = g.cols, short = end(a) <= end(b) ? a : b;
      // вписанная картина (soft) — до нижней лозы рамки (внутри неё); миниатюра в рамке — до низа области текста;
      // старая вырезка — до низа листа
      const lim = i < groups.length - 1 ? Math.max(end(a), end(b)) - gap * mm
                : soft ? pg.bottom - 5.5 * mm : mini ? flow.getBoundingClientRect().bottom : pg.bottom - 1.5 * mm;
      const r = (lim - end(short)) / mm - 1;
      if (r > room) { room = r; best = short; top = end(short) + (soft ? -0.5 : 0.5) * mm; bottom = lim; where = g.c.dataset.team; }
    });
    if (best && room >= 9 && mini) {
      // миниатюра: самый крупный прямоугольник в просвете, по центру просвета — аккуратно, без наложений
      const cr = best.getBoundingClientRect(), ar = scene.naturalWidth / scene.naturalHeight;
      // размытым краям можно чуть зайти за край колонки (до лозы рамки слева и в межколонник справа)
      // размытым краям можно чуть зайти в межколонник и на поле (их край почти прозрачный)
      const L = cr.left - (soft ? 1.5 * mm : 0), R = cr.right + (soft ? 1.5 * mm : 0);
      let h = Math.min(bottom - top - (soft ? 0 : mm), 60 * mm), w = h * ar;
      if (w > R - L) { w = R - L; h = w / ar; }
      room = h / mm;
      // вписанная картина стоит на нижней лозе, миниатюра — по центру просвета
      const y = soft ? bottom - h : top + (bottom - top - h) / 2;
      Object.assign(scene.style, { left: (L + (R - L - w) / 2 - pg.left) + 'px', width: w + 'px',
                                   top: (y - pg.top) + 'px', height: h + 'px' });
      page.appendChild(scene);
      where += soft ? ', вписана' : ', миниатюра';
    } else if (best && room >= 9) {
      const cr = best.getBoundingClientRect(), ar = scene.naturalWidth / scene.naturalHeight;
      // последняя строка текста над картинкой: небо у пляски прозрачное, поэтому картинка поднимается на строку вверх,
      // если шпиль башни (середина картинки) правее конца этой строки; влево можно зайти на поле с лозой
      const rg = document.createRange(); rg.selectNodeContents(best.lastElementChild);
      const rs = [...rg.getClientRects()], last = rs[rs.length - 1];
      const fit = rise => {
        let h = Math.min(bottom - top + rise, 50 * mm), w = h * ar;
        const minL = cr.left - 7 * mm, maxR = cr.right;
        if (w > maxR - minL) { w = maxR - minL; h = w / ar; }
        const left = Math.min(Math.max(minL, (rise ? last.right + 5 * mm : (minL + maxR) / 2) - w / 2), maxR - w);
        return { h, w, left, ok: !rise || left + w / 2 >= last.right + 4 * mm };
      };
      let rise = last ? last.height : 0, f = fit(rise);
      if (!f.ok) { rise = 0; f = fit(0); }
      room = f.h / mm;
      Object.assign(scene.style, { left: (f.left - pg.left) + 'px', width: f.w + 'px',
                                   top: (bottom - f.h - pg.top) + 'px', height: f.h + 'px' });
      page.appendChild(scene);
      where += rise ? ', поднята на строку' : '';
    } else where = 'нет места';
  }
  document.body.dataset.fit = 'ab=' + ab + 'pt gap=' + gap + 'mm scene=' + room.toFixed(1) + 'mm (' + where + ') overflow=' + over();
})();
</script>"""


# делёж ролей по колонкам вручную: у Демонов двое слева, Фань Гу справа — под ним место для пляски (почти вдвое больше)
SPLIT = {"demon": 2}


def scene_soft(aspect=3.3, inset=30, fx=0.11, fy=0.24):
    """Пляска «вписана в лист» (пользователь: так лучше): из миниатюры scene_mini.png берётся только сама картина —
    без белого поля и золотой рамки (inset px), обрезается снизу до пропорции aspect (шпиль башни целиком)
    и получает плавно размытые края, которые растворяются в пергаменте."""
    im = ba.Image.open(ART / "scene_mini.png").convert("RGB")
    a = np.asarray(im).astype(int)
    ys, xs = np.where(a.min(axis=2) < 235)
    x0, y0, x1, y1 = xs.min() + inset, ys.min() + inset, xs.max() - inset, ys.max() - inset
    y1 = min(y1, y0 + round((x1 - x0) / aspect))
    im = im.crop((x0, y0, x1, y1)).convert("RGBA")
    W, H = im.size
    ramp = lambda n, f: np.clip(np.minimum(np.arange(n), np.arange(n)[::-1]) / (f * n), 0, 1)
    sx, sy = ramp(W, fx), ramp(H, fy)
    m = np.outer(sy * sy * (3 - 2 * sy), sx * sx * (3 - 2 * sx))
    im.putalpha(ba.Image.fromarray((m * 255).round().astype(np.uint8)))
    return ba.uri(im, maxw=1500)


def scene_html():
    """Пляска: вписанная в лист картина с размытыми краями (из scene_mini.png), иначе — старая вырезка с размытыми краями."""
    if (ART / "scene_mini.png").exists():
        return f'<img class="scene soft" src="{scene_soft()}" alt="">'
    return f'<img class="scene" src="{feathered("scene", maxw=1300)}" alt="">'


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
                 f'<div class="cols" data-team="{label}"' + (f' data-split="{SPLIT[t]}"' if t in SPLIT else '') + '>' + "".join(f'<div class="col">{p}</div>' for p in parts) + "</div>")
    page = (f'<div class="page"><img class="frame" src="{bg()}" alt="">'
            f'<div class="content"><div class="head">'
            f'<img class="title art" src="{art("title", maxw=900)}" alt="Mad Masquerade">'
            f'<div class="side"><img class="by art" src="{art("by", maxw=600)}" alt="by Alex"></div>'
            f'<img class="tower art" src="{art("header", maxw=1100)}" alt=""></div>'
            f'<div class="flow">{secs}{scene_html()}</div></div></div>')
    html = (f'<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Mad Masquerade — роли</title>'
            f'{FONTS}<style>{CSS}</style></head><body>{page}{JS}</body></html>')
    path = OUT / "Mad Masquerade — роли.html"
    path.write_text(html, encoding="utf-8")
    ba.render(path)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    build_roles()
