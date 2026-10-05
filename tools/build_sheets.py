"""Вёрстка листов Everyone Can Be Evil: roles.html (одна страница, злая рамка снизу) и night.html.

Весь арт вшит data-URI. Шрифты — Google Fonts. Иконки ролей — с официальной вики.
Кегль подбирается скриптом в самом листе (после загрузки шрифтов), так что печать в Chrome
всегда влезает в страницу.
"""
import base64
import io
from pathlib import Path
from PIL import Image

from sheet_data import (TITLE, AUTHOR, ICON, ICON_PATH, TEAMS, TEAM_NAME, SETUP,
                        FIRST_NIGHT, OTHER_NIGHTS, NIGHT_FOOT)

ROOT = Path(__file__).resolve().parent.parent
CUT = ROOT / "art" / "cut"
OUT = ROOT / "out"
OUT.mkdir(exist_ok=True)

COL = {"townsfolk": "#1F3A63", "outsider": "#1F3A63", "minion": "#7A1E22", "demon": "#7A1E22"}
NAME_BY_ID = {rid: name for team in TEAMS.values() for rid, name, _ in team}
TEAM_BY_ID = {rid: t for t, team in TEAMS.items() for rid, _, _ in team}


def embed(name, maxw=None, maxh=None, quality=88):
    path = CUT / name
    if not path.exists():
        return None
    im = Image.open(path)
    if maxw and im.width > maxw:
        im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
    if maxh and im.height > maxh:
        im = im.resize((round(im.width * maxh / im.height), maxh), Image.LANCZOS)
    buf = io.BytesIO()
    if im.mode == "RGBA":
        im.save(buf, "PNG", optimize=True); mime = "png"
    else:
        im.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True); mime = "jpeg"
    return f"data:image/{mime};base64," + base64.b64encode(buf.getvalue()).decode()


ICON_DIR = ROOT / "app" / "icons"
_ICONS = {}


def icon(rid):
    """Официальная иконка роли (botc-release), вшитая в лист: синяя для добрых, красная для злых."""
    if rid not in _ICONS:
        v = "e" if TEAM_BY_ID.get(rid) in ("minion", "demon") else "g"
        data = (ICON_DIR / f"{rid}_{v}.webp").read_bytes()
        _ICONS[rid] = "data:image/webp;base64," + base64.b64encode(data).decode()
    return _ICONS[rid]


FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
         'family=Alegreya:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap">')

BASE_CSS = """
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { background: #7d7a74; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact;
       font-family: 'Alegreya', Georgia, serif; color: #1C1A19; }
.page { position: relative; width: 210mm; height: 297mm; overflow: hidden; background: #FCF6E6;
        break-after: page; page-break-after: always; }
.page:last-child { break-after: auto; page-break-after: auto; }
@media screen { .page { margin: 8mm auto; box-shadow: 0 1mm 4mm rgba(0,0,0,.35); } }
.frame { position: absolute; inset: 0; width: 210mm; height: 297mm; display: block; }
.placeholder { border: 0.5mm dashed #B39B6A; border-radius: 50%; }
"""

FIT_JS = """
<script>
(async function () {
  await document.fonts.ready;
  await Promise.all([...document.images].map(i => i.complete ? 0 :
        new Promise(r => { i.onload = i.onerror = r; })));
  const root = document.documentElement.style;
  const flows = [...document.querySelectorAll('.flow')];
  const over = () => flows.some(f => f.scrollHeight > f.clientHeight + 1);
  let ab = __ABMAX__;
  for (; ab >= __ABMIN__; ab = Math.round((ab - 0.1) * 10) / 10) {
    root.setProperty('--ab', ab + 'pt');
    if (!over()) break;
  }
  let gap = __GAP0__;
  for (; gap <= __GAPMAX__; gap = Math.round((gap + 0.1) * 10) / 10) {
    root.setProperty('--gap', gap + 'mm');
    if (over()) { gap = Math.round((gap - 0.1) * 10) / 10; root.setProperty('--gap', gap + 'mm'); break; }
  }
  // граница дневной и злой рамки — чуть выше заголовка, с которого начинаются злые роли
  const evil = document.querySelector('.evil-start');
  let split = '';
  if (evil) {
    const page = evil.closest('.page'), mm = 96 / 25.4;
    split = ((evil.getBoundingClientRect().top - page.getBoundingClientRect().top) / mm - 1.5).toFixed(1);
    page.style.setProperty('--split', split + 'mm');
  }
  document.body.dataset.fit = 'ab=' + ab + 'pt gap=' + gap + 'mm overflow=' + over() +
                              (split ? ' split=' + split + 'mm' : '');
})();
</script>
"""


def fit_js(maxv, minv, gap0, gapmax):
    return (FIT_JS.replace("__ABMAX__", str(maxv)).replace("__ABMIN__", str(minv))
            .replace("__GAP0__", str(gap0)).replace("__GAPMAX__", str(gapmax)))


# ---------------------------------------------------------------- лист ролей

ROLES_CSS = """
:root { --ab: 9.5pt; --gap: 1.2mm; --split: 175mm; }
.frame.good { -webkit-mask-image: linear-gradient(to bottom, #000 calc(var(--split) - 7mm), transparent calc(var(--split) + 7mm));
              mask-image: linear-gradient(to bottom, #000 calc(var(--split) - 7mm), transparent calc(var(--split) + 7mm)); }
.content { position: absolute; left: 10.5mm; right: 10.5mm; top: 10.5mm; bottom: 9.8mm;
           display: flex; flex-direction: column; }
.head { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 6mm;
        padding: 0 1mm 0 0.5mm; }
.titlebox { flex: none; width: 84mm; }
.title { display: block; width: 100%; height: auto; }
.by { text-align: right; margin-top: 0.3mm; font-family: 'Alegreya', serif; font-weight: 600; text-transform: uppercase;
      font-size: 9pt; letter-spacing: .08em; color: #5B554D; }
.window { flex: none; display: block; height: auto; }
.flow { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
h2 { display: flex; align-items: center; gap: 2.2mm; font-family: 'Alegreya', serif; font-weight: 700; text-transform: uppercase;
     font-size: 10.5pt; letter-spacing: .14em; margin: 1.3mm 0 0.7mm; }
h2 .medal { width: 8mm; height: 8mm; flex: none; object-fit: contain; }
h2 .rule { flex: 1; height: 0; border-top: 0.35mm solid #9A7B3A; }
.cols { display: grid; grid-template-columns: 1fr 1fr; column-gap: 6mm; }
.col { display: flex; flex-direction: column; gap: var(--gap); }
.role { display: flex; align-items: flex-start; gap: 2mm; }
.ic { flex: 0 0 9.5mm; width: 9.5mm; height: 9.5mm; margin-top: -0.3mm; }
.ic img { width: 100%; height: 100%; object-fit: contain; display: block; }
.nm { font-weight: 800; font-size: calc(var(--ab) + 1.3pt); line-height: 1.1; }
.ab { font-size: var(--ab); font-weight: 600; line-height: 1.17; margin-top: 0.3mm; }
.ab b { font-weight: 800; }
.foot { flex: none; display: flex; justify-content: space-between; align-items: baseline;
        font-size: 7.5pt; color: #5B554D; padding-top: 1mm; }
"""


def role_html(rid, name, ability, team):
    return (f'<div class="role"><div class="ic"><img src="{icon(rid)}" alt=""></div>'
            f'<div class="tx"><div class="nm" style="color:{COL[team]}">{name}</div>'
            f'<div class="ab">{ability}</div></div></div>')


def heading(team, medal, cls=""):
    img = (f'<img class="medal" src="{medal}" alt="">' if medal
           else '<span class="medal placeholder"></span>')
    return (f'<h2 class="{cls}" style="color:{COL[team]}">{img}<span>{TEAM_NAME[team]}</span>'
            f'<i class="rule"></i></h2>')


def two_cols(team):
    """Делит роли на две колонки так, чтобы самая длинная была как можно короче (по объёму текста)."""
    import math, re
    roles = TEAMS[team]
    # высота роли в строках описания: имя ≈ 1.1 строки, отступ ≈ 0.4, и не ниже иконки (≈ 3 строки)
    lines = [math.ceil(len(re.sub(r"<[^>]+>|&nbsp;", " ", a)) / 50) for _, _, a in roles]
    weight = [max(3.0, 1.1 + n) + 0.4 for n in lines]
    split = min(range(1, len(roles)), key=lambda k: max(sum(weight[:k]), sum(weight[k:])))
    cols = [roles[:split], roles[split:]]
    return '<div class="cols">' + "".join(
        '<div class="col">' + "".join(role_html(r, n, a, team) for r, n, a in c) + "</div>"
        for c in cols) + "</div>"


def build_roles(name="roles", window_mm=48):
    A = {k: embed(f"{k}.png", maxw=560) for k in
         ["sec_townsfolk", "sec_outsider", "sec_minion", "sec_demon"]}
    title = embed("title_1.png", maxw=1435)
    window = embed("header_front.png", maxw=640) if window_mm else None
    bg_good, bg_evil = embed("bg_front.jpg", quality=90), embed("bg_back.jpg", quality=90)

    window_html = (f'<img class="window" style="width:{window_mm}mm" src="{window}" alt="">'
                   if window else "")
    page = (f'<div class="page"><img class="frame evil" src="{bg_evil}" alt="">'
            f'<img class="frame good" src="{bg_good}" alt="">'
            f'<div class="content"><div class="head"><div class="titlebox">'
            f'<img class="title" src="{title}" alt="{TITLE}"><div class="by">by {AUTHOR}</div></div>'
            f'{window_html}</div>'
            f'<div class="flow">'
            f'{heading("townsfolk", A["sec_townsfolk"])}{two_cols("townsfolk")}'
            f'{heading("outsider", A["sec_outsider"])}{two_cols("outsider")}'
            f'{heading("minion", A["sec_minion"], "evil-start")}{two_cols("minion")}'
            f'{heading("demon", A["sec_demon"])}{two_cols("demon")}'
            f'</div><div class="foot"><span>* Не в первую ночь</span></div></div></div>')

    html = (f'<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>{TITLE} — роли</title>'
            f'{FONTS}<style>{BASE_CSS}{ROLES_CSS}</style></head><body>{page}'
            f'{fit_js(10.5, 7.5, 1.0, 3.5)}</body></html>')
    (OUT / f"{name}.html").write_text(html, encoding="utf-8")


# ---------------------------------------------------------------- лист ночей

NIGHT_CSS = """
:root { --ab: 11pt; --gap: 2mm; }
.half { position: absolute; top: 10.5mm; bottom: 10mm; width: 78mm; display: flex; flex-direction: column; }
.half.a { left: 10.5mm; }
.half.b { right: 10.5mm; transform: rotate(180deg); }
.half .title { display: block; width: 78mm; height: auto; }
.half .label { font-family: 'Alegreya', serif; font-weight: 700; font-size: 11.5pt; text-transform: uppercase; letter-spacing: .14em;
               color: #8C6A2E; margin: 1.6mm 0 1.4mm; display: flex; align-items: center; gap: 2mm; }
.half .label i { flex: 1; border-top: 0.35mm solid #9A7B3A; }
.flow { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: var(--gap); }
.step { display: flex; align-items: center; gap: 3mm; min-height: 11mm; }
.ic { flex: 0 0 11mm; width: 11mm; height: 11mm; }
.ic img, .ic svg { width: 100%; height: 100%; object-fit: contain; display: block; }
.nm { font-weight: 700; font-size: var(--ab); line-height: 1.1; }
.note { font-style: italic; font-size: calc(var(--ab) - 2.6pt); line-height: 1.15; color: #5B554D; margin-top: 0.3mm; }
.nfoot { flex: none; font-size: 7.8pt; line-height: 1.25; color: #5B554D; margin-top: 2mm; }
.center { position: absolute; left: 50%; top: 50%; width: 24mm; transform: translate(-50%, -50%); }
.center img { width: 100%; height: auto; display: block; }
"""

GLYPH = {
    "dusk": ("#2B3F66", '<path d="M20 4a13 13 0 1 0 0 24 16 16 0 0 1 0-24z"/>'),
    "dawn": ("#B8860B", '<circle cx="16" cy="16" r="7"/><g stroke="currentColor" stroke-width="2.4" '
                        'stroke-linecap="round" fill="none"><path d="M16 1v4M16 27v4M1 16h4M27 16h4'
                        'M5 5l3 3M24 24l3 3M27 5l-3 3M8 24l-3 3"/></g>'),
    "minioninfo": ("#7A1E22", '<path d="M3 11c4-3 9-3 13 0 4-3 9-3 13 0-1 7-5 10-9 10-2 0-3-2-4-3-1 1-2 3-4 3-4 0-8-3-9-10z'
                              'M8 14c1 2 4 2 5 0zM19 14c1 2 4 2 5 0z" fill-rule="evenodd"/>'),
    "demoninfo": ("#7A1E22", '<path d="M6 3c0 5 2 8 5 9-2 2-3 4-3 7 0 5 4 10 8 10s8-5 8-10c0-3-1-5-3-7 3-1 5-4 5-9'
                             '-2 3-5 5-10 5S8 6 6 3z"/>'),
}
GLYPH_NAME = {"dusk": "Закат", "dawn": "Рассвет", "minioninfo": "Приспешники", "demoninfo": "Демон"}


def glyph(key, art):
    if art:
        return f'<div class="ic"><img src="{art}" alt=""></div>'
    colour, body = GLYPH[key]
    return (f'<div class="ic"><svg viewBox="0 0 32 32" fill="{colour}" color="{colour}">{body}</svg></div>')


def step_html(rid, label, note, arts):
    if rid in GLYPH:
        ic, name, colour = glyph(rid, arts.get(rid)), label or GLYPH_NAME[rid], "#4A3B26"
        if rid in ("minioninfo", "demoninfo"):
            colour = "#7A1E22"
    else:
        ic = f'<div class="ic"><img src="{icon(rid)}" alt=""></div>'
        name, colour = label or NAME_BY_ID[rid], COL[TEAM_BY_ID[rid]]
    note_html = f'<div class="note">{note}</div>' if note else ""
    return f'<div class="step">{ic}<div><div class="nm" style="color:{colour}">{name}</div>{note_html}</div></div>'


def build_night():
    arts = {k: embed(f"{k}.png", maxw=300) for k in GLYPH}
    title = embed("title_1.png", maxw=1100)
    center = embed("night_center.png", maxh=1458)
    bg = embed("bg_night.jpg", quality=90)

    def half(cls, label, steps, foot=""):
        body = "".join(step_html(r, l, n, arts) for r, l, n in steps)
        foot_html = f'<div class="nfoot">{foot}</div>' if foot else ""
        return (f'<div class="half {cls}"><img class="title" src="{title}" alt="{TITLE}">'
                f'<div class="label"><span>{label}</span><i></i></div>'
                f'<div class="flow">{body}</div>{foot_html}</div>')

    page = (f'<div class="page"><img class="frame" src="{bg}" alt="">'
            f'<div class="center"><img src="{center}" alt=""></div>'
            f'{half("a", "Первая ночь", FIRST_NIGHT, NIGHT_FOOT)}'
            f'{half("b", "Последующие ночи", OTHER_NIGHTS)}</div>')
    html = (f'<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>{TITLE} — ночи</title>'
            f'{FONTS}<style>{BASE_CSS}{NIGHT_CSS}</style></head><body>{page}'
            f'{fit_js(12.5, 9.0, 1.0, 5.0)}</body></html>')
    (OUT / "night.html").write_text(html, encoding="utf-8")


if __name__ == "__main__":
    build_roles("roles", 44)
    build_night()
    for f in ("roles.html", "night.html"):
        print(f, round((OUT / f).stat().st_size / 1e6, 2), "MB")
