"""A Leech of Distrust (by OJ, Teensyville): лист ролей. Листа ночей нет — пользователь ведёт игру через приложение.

python tools\\leech_of_distrust.py    → out/leech_of_distrust/  (HTML + PDF + PNG для осмотра)

Печать чёрно-белая, поэтому всё на листе в оттенках серого: арт — тушь суми-э (вырезается и ложится через multiply),
иконки ролей переводятся в серый, команды различаются шапками секций: у добрых — чёрный текст с линией,
у злых — белые буквы на чёрной плашке. Ролей 11 — места много: кегль крупный, остаток высоты отдаётся большой сцене.
Значки секций (`sec_*.png`) — по желанию: если файла нет, шапка без значка.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import bon_appetit as ba  # noqa: E402

ART = ROOT / "leech_of_distrust" / "art" / "src"
OUT = ROOT / "out" / "leech_of_distrust"
ru, team = ba.ru, ba.team
ids = [x for x in json.loads((ROOT / "leech_of_distrust" / "src" / "script.json").read_text(encoding="utf-8")) if isinstance(x, str)]
KEEP = {"oracle": "Пророк"}  # решение пользователя: Пикси заменён Пророком = Оракул (Oracle, S&V), название — пользователя
NAME = {rid: KEEP.get(rid, ru[rid]["name"]) for rid in ids}
TEAMS = [("townsfolk", "Горожане", False), ("outsider", "Изгои", False), ("minion", "Приспешники", True), ("demon", "Демоны", True)]
INK = "#111111"

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
         'family=Spectral:ital,wght@0,500;0,600;0,700;0,800;1,500&display=swap">')

_art = {}


def art(name, **kw):
    if name not in _art:
        if not (ART / f"{name}.png").exists():
            return None
        ba.ART = ART  # cut() из bon_appetit читает свою папку арта
        _art[name] = ba.uri(ba.cut(name), **kw)
    return _art[name]


def ability(rid):
    s = ba.ability(rid)
    return s.replace("Каждую ночь*, ", "Каждую ночь* ")  # лишняя запятая в официальном тексте Пиявицы


def role_html(rid):
    return (f'<div class="role"><div class="ic"><img src="{ba.icon(rid)}" alt=""></div>'
            f'<div class="tx"><span class="nm">{NAME[rid]}</span>&nbsp;— {ability(rid)}</div></div>')


CSS = """
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { background: #777; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: 'Spectral', Georgia, serif; color: %(ink)s; }
.page { position: relative; width: 210mm; height: 297mm; overflow: hidden; background: #fff; }
@media screen { .page { margin: 8mm auto; box-shadow: 0 1mm 4mm rgba(0,0,0,.35); } }
.frame { position: absolute; inset: 0; width: 210mm; height: 297mm; display: block; }
.art { mix-blend-mode: multiply; }
:root { --ab: 12pt; --gap: 3mm; }
.content { position: absolute; left: 11mm; right: 11mm; top: 10mm; bottom: 10mm; display: flex; flex-direction: column; }
.head { flex: none; display: flex; align-items: flex-end; justify-content: center; gap: 4mm; }
.title { display: block; width: 104mm; height: auto; }
.by { display: block; height: 11mm; width: auto; margin-bottom: 1mm; }
.flow { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.sh { flex: none; display: flex; align-items: center; gap: 2.5mm; margin: 2.6mm 0 1.6mm; }
.sh .medal { flex: none; width: 9mm; height: 9mm; object-fit: contain; }
.sh .lbl { font-weight: 800; font-size: 12.5pt; letter-spacing: .22em; text-transform: uppercase; white-space: nowrap; }
.sh .rule { flex: 1; height: 0; border-bottom: 0.8pt solid %(ink)s; }
/* злые команды: белые буквы на чёрной плашке — различимо без цвета */
.sh.evil .lbl { background: %(ink)s; color: #fff; padding: 0.6mm 2.4mm 0.4mm 2.8mm; }
.cols { display: grid; grid-template-columns: 1fr 1fr; column-gap: 6mm; align-items: start; }
.col { display: flex; flex-direction: column; gap: var(--gap); }
.role { display: flex; align-items: flex-start; gap: 2.8mm; }
.ic { flex: 0 0 13mm; width: 13mm; height: 13mm; margin-top: -0.4mm; }
.ic img { width: 100%%; height: 100%%; object-fit: contain; display: block; filter: grayscale(1) contrast(1.15); }
.tx { font-size: var(--ab); font-weight: 600; line-height: 1.14; }
.nm { font-weight: 800; font-size: calc(var(--ab) + 1pt); line-height: 1; }
.tx b { font-weight: 800; }
.extra { padding-left: 15.8mm; font-size: calc(var(--ab) * 0.85); font-weight: 700; }
/* сцена забирает всё, что осталось по высоте, но не меньше --hero */
/* картинка — absolute, чтобы её собственный размер не раздувал блок: блок = остаток высоты, картинка вписывается в него */
.herobox { position: relative; flex: 1 1 auto; min-height: var(--hero, 40mm); }
.herobox img { position: absolute; left: 0; right: 0; top: 3mm; bottom: 0; width: 100%%; height: calc(100%% - 3mm); object-fit: contain; display: block; }
""" % {"ink": INK}

JS = """<script>
(async function () {
  await document.fonts.ready;
  await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  const root = document.documentElement.style, flow = document.querySelector('.flow');
  const over = () => flow.scrollHeight > flow.clientHeight + 1 || flow.scrollWidth > flow.clientWidth + 1;
  // роли секции делятся на две колонки (порядок сохраняется) так, чтобы секция была как можно ниже
  const groups = [...document.querySelectorAll('.cols')].map(c => ({c, cols: [...c.children], roles: [...c.querySelectorAll('.role, .extra')]}));
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
  // кегль — самый крупный, при котором влезают роли и сцена не ниже --hero (но не крупнее 15 pt: дальше лист выглядит плакатом)
  let ab = 15;
  for (; ab >= 8; ab = Math.round((ab - 0.1) * 10) / 10) { root.setProperty('--ab', ab + 'pt'); balance(); if (!over()) break; }
  const hero = document.querySelector('.herobox img');
  const mm = 96 / 25.4, hh = hero ? (hero.getBoundingClientRect().height / mm).toFixed(1) : 0;
  document.body.dataset.fit = 'ab=' + ab + 'pt hero=' + hh + 'mm overflow=' + over();
})();
</script>"""


def build_roles():
    secs = ""
    for t, label, evil in TEAMS:
        roles = [r for r in ids if team[r] == t]
        k = (len(roles) + 1) // 2
        parts = ["".join(role_html(r) for r in part) for part in (roles[:k], roles[k:])]
        if t == "demon":  # сноска — во второй колонке рядом с единственным Демоном
            parts[1] += '<div class="extra">* Кроме первой ночи</div>'
        medal = art("sec_" + t, maxh=300)
        medal_html = f'<img class="medal art" src="{medal}" alt="">' if medal else ""
        secs += (f'<div class="sh{" evil" if evil else ""}">{medal_html}<span class="lbl">{label}</span><i class="rule"></i></div>'
                 f'<div class="cols">' + "".join(f'<div class="col">{p}</div>' for p in parts) + "</div>")
    bg = ba.uri(ba.fit_a4(ba.Image.open(ART / "bg.png").convert("RGB")), quality=90)
    page = (f'<div class="page"><img class="frame" src="{bg}" alt="">'
            f'<div class="content"><div class="head">'
            f'<img class="title art" src="{art("title", maxw=1600)}" alt="A Leech of Distrust">'
            f'<img class="by art" src="{art("by", maxw=700)}" alt="by OJ"></div>'
            f'<div class="flow">{secs}<div class="herobox"><img class="art" src="{art("hero", maxw=1600)}" alt=""></div></div>'
            f'</div></div>')
    html = (f'<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>A Leech of Distrust — роли</title>'
            f'{FONTS}<style>{CSS}</style></head><body>{page}{JS}</body></html>')
    path = OUT / "A Leech of Distrust — роли.html"
    path.write_text(html, encoding="utf-8")
    ba.render(path)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    build_roles()
