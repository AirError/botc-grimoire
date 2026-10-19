"""Nachtmahr (by Илья, хэллоуинский, эстетика «Носферату» Эггерса): лист ролей и лист ночей.

python tools\\nachtmahr.py            → out/nachtmahr/  (HTML + PDF + PNG для осмотра)
python tools\\nachtmahr.py --night    → только лист ночей

Арт — nachtmahr/art/src/<имя>.png (по prompts_nachtmahr.md): гравюра на белом; белый вырезается, и рисунок ложится на
бумагу через multiply (мягкие края тумана и тени не дают ореола). Состав — nachtmahr/src/script.json, порядок ролей —
как в PDF конструктора. Тексты — официальный ru.json, ночной порядок — nightsheet.json (сверен с PDF конструктора).
Общие куски (вырезание, data-URI, рендер через Edge) — из bon_appetit.py.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import bon_appetit as ba  # noqa: E402

ART = ROOT / "nachtmahr" / "art" / "src"
OUT = ROOT / "out" / "nachtmahr"
ru, team, nightsheet = ba.ru, ba.team, ba.nightsheet
JINX_RU = ba.RU["jinxes"]
ids = [x for x in json.loads((ROOT / "nachtmahr" / "src" / "script.json").read_text(encoding="utf-8")) if isinstance(x, str)]

KEEP = {"huntsman": "Ловчий", "fearmonger": "Страшила"}  # решения пользователя (официально — Егерь, Паникёр)
NAME = {rid: KEEP.get(rid, ru[rid]["name"]) for rid in ids}

GOOD, EVIL, ASH, INK = "#25395A", "#6E1A1F", "#77716B", "#1E1B1A"
COL = {"townsfolk": GOOD, "outsider": GOOD, "minion": EVIL, "demon": EVIL}
TEAMS = [("townsfolk", "Горожане"), ("outsider", "Изгои"), ("minion", "Приспешники"), ("demon", "Демоны")]
# джинксы — только на листе ночей (решение пользователя); у Математика и Пьяницы официального русского текста нет — перевод наш
JINXES = [("scarletwoman", "fanggu", JINX_RU["fanggu-scarletwoman"]),
          ("mathematician", "drunk", "Математик узнаёт и о том, что способность Пьяницы дала ложные сведения "
                                     "или не сработала как надо.")]

# Old Standard TT — антиква XIX века с кириллицей: названия, шапки секций; описания — PT Serif (плотнее, читается крупнее)
FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
         'family=Old+Standard+TT:ital,wght@0,400;0,700;1,400&family=PT+Serif:ital,wght@0,400;0,700;1,400;1,700&display=swap">')

_art = {}


def art(name, **kw):
    if name not in _art:
        path = ART / f"{name}.png"
        if not path.exists():
            return None
        ba.ART = ART  # cut() из bon_appetit читает свою папку арта
        _art[name] = ba.uri(ba.cut(name), **kw)
    return _art[name]


def bg():
    im = ba.fit_a4(ba.Image.open(ART / "bg.png").convert("RGB"))
    return ba.uri(im, quality=90)


def ability(rid):
    s = ba.ability(rid)
    for old, new in (("Егер", "Ловч"), ("Паникёр", "Страшила")):
        s = s.replace(old, new)
    return s


def role_html(rid):
    return (f'<div class="role"><div class="ic"><img src="{ba.icon(rid)}" alt=""></div>'
            f'<div class="tx"><span class="nm" style="color:{COL[team[rid]]}">{NAME[rid]}</span>&nbsp;— {ability(rid)}</div></div>')


BASE_CSS = """
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { background: #6d6a66; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: 'PT Serif', Georgia, serif; color: %s; }
.page { position: relative; width: 210mm; height: 297mm; overflow: hidden; background: #F3EAD6; }
@media screen { .page { margin: 8mm auto; box-shadow: 0 1mm 4mm rgba(0,0,0,.35); } }
.frame { position: absolute; inset: 0; width: 210mm; height: 297mm; display: block; }
.art { mix-blend-mode: multiply; }
""" % INK

# ---------------------------------------------------------------- лист ролей (приоритет тексту)

ROLES_CSS = """
:root { --ab: 10pt; --gap: 1mm; }
.content { position: absolute; left: 8.5mm; right: 8.5mm; top: 8mm; bottom: 8.5mm; display: flex; flex-direction: column; }
.head { flex: none; display: flex; align-items: center; justify-content: space-between; padding: 0 3mm 0 4mm; }
.titlebox { display: flex; align-items: flex-end; gap: 2.5mm; }
.title { display: block; width: 52mm; height: auto; }
.by { display: block; height: 8mm; width: auto; margin-bottom: -0.5mm; }
.port { display: block; width: 58mm; height: auto; }
.flow { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.sh { flex: none; display: flex; align-items: center; gap: 2mm; margin: 0.9mm 0 0.3mm; }
.sh .medal { flex: none; width: 6.5mm; height: 6.5mm; object-fit: contain; }
.sh .lbl { font-family: 'Old Standard TT', serif; font-weight: 700; font-size: 11pt; letter-spacing: .2em;
           text-transform: uppercase; white-space: nowrap; }
.sh .rule { flex: 1; height: 0; border-bottom: 0.6pt solid %s; }
.cols { display: grid; grid-template-columns: 1fr 1fr; column-gap: 4mm; align-items: start; }
.col { display: flex; flex-direction: column; gap: var(--gap); }
.role { display: flex; align-items: flex-start; gap: 2.2mm; }
.ic { flex: 0 0 9.5mm; width: 9.5mm; height: 9.5mm; margin-top: -0.2mm; }
.ic img { width: 100%%; height: 100%%; object-fit: contain; display: block; }
.tx { font-size: var(--ab); font-weight: 700; line-height: 1.08; }
.nm { font-family: 'Old Standard TT', serif; font-weight: 700; font-size: calc(var(--ab) + 1pt); line-height: 1; }
.tx b { font-weight: 700; }
.extra { padding-left: 11.7mm; font-size: calc(var(--ab) * 0.88); font-weight: 700; }
.scene { display: block; width: auto; max-width: 100%%; margin: 0.5mm auto 0; object-fit: contain; }
""" % ASH

ROLES_JS = """<script>
(async function () {
  await document.fonts.ready;
  await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  const root = document.documentElement.style, flow = document.querySelector('.flow'), mm = 96 / 25.4;
  const over = () => flow.scrollHeight > flow.clientHeight + 1 || flow.scrollWidth > flow.clientWidth + 1;
  // роли секции делятся на две колонки (порядок сохраняется) так, чтобы секция была как можно ниже
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
  let gap = 1;
  for (; gap <= 4; gap = Math.round((gap + 0.1) * 10) / 10) {
    root.setProperty('--gap', gap + 'mm'); balance();
    if (over()) { gap = Math.round((gap - 0.1) * 10) / 10; root.setProperty('--gap', gap + 'mm'); balance(); break; }
  }
  // корабль-призрак — в самый большой просвет под более короткой колонкой какой-нибудь секции (текст не теснит)
  let room = 0, where = '';
  if (scene) {
    const end = col => col.lastElementChild.getBoundingClientRect().bottom;
    let best = null;
    for (const g of groups) {
      const [a, b] = g.cols, short = end(a) <= end(b) ? a : b;
      const r = (Math.max(end(a), end(b)) - end(short)) / mm - gap - 1;
      if (r > room) { room = r; best = short; where = g.c.dataset.team; }
    }
    if (best && room >= 9) { scene.style.height = Math.min(room, 30) + 'mm'; best.appendChild(scene); } else where = 'нет места';
  }
  document.body.dataset.fit = 'ab=' + ab + 'pt gap=' + gap + 'mm scene=' + room.toFixed(1) + 'mm (' + where + ') overflow=' + over();
})();
</script>"""


def build_roles():
    secs = ""
    for t, label in TEAMS:
        roles = [r for r in ids if team[r] == t]
        k = (len(roles) + 1) // 2
        parts = ["".join(role_html(r) for r in part) for part in (roles[:k], roles[k:])]
        if t == "demon":  # сноска — в конце правой колонки Демонов
            parts[1] += '<div class="extra">* Кроме первой ночи</div>'
        medal = art("sec_" + t, maxh=300)
        medal_html = f'<img class="medal art" src="{medal}" alt="">' if medal else ""
        secs += (f'<div class="sh" style="color:{COL[t]}">{medal_html}<span class="lbl">{label}</span><i class="rule"></i></div>'
                 f'<div class="cols" data-team="{label}">' + "".join(f'<div class="col">{p}</div>' for p in parts) + "</div>")
    scene = art("scene", maxw=1000)
    page = (f'<div class="page"><img class="frame" src="{bg()}" alt="">'
            f'<div class="content"><div class="head"><div class="titlebox">'
            f'<img class="title art" src="{art("title", maxw=1400)}" alt="Nachtmahr">'
            f'<img class="by art" src="{art("by", maxw=800)}" alt="by Илья"></div>'
            f'<img class="port art" src="{art("header", maxw=1200)}" alt=""></div>'
            f'<div class="flow">{secs}' + (f'<img class="scene art" src="{scene}" alt="">' if scene else "") +
            '</div></div></div>')
    html = (f'<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Nachtmahr — роли</title>'
            f'{FONTS}<style>{BASE_CSS}{ROLES_CSS}</style></head><body>{page}{ROLES_JS}</body></html>')
    path = OUT / "Nachtmahr — роли.html"
    path.write_text(html, encoding="utf-8")
    ba.render(path)


# ---------------------------------------------------------------- лист ночей

SPECIAL = {"dusk": ("Закат", INK), "dawn": ("Рассвет", INK),
           "minioninfo": ("Приспешники", EVIL), "demoninfo": ("Демон", EVIL)}

# короткие подсказки по официальным текстам листа ночей (ru.json) и How to Run на вики
NOTES_FIRST = {
    "magician": "Приспешникам покажите его вместе с Демоном, Демону — вместе с Приспешниками",
    "minioninfo": "Девица в игре — покажите и её жетон",
    "godfather": "узнаёт, какие Изгои в игре",
    "fearmonger": "выбирает игрока — объявите всем, что Страшила сделал выбор",
    "pukka": "выбранный отравлен",
    "huntsman": "выбрал Девицу — она узнаёт новую роль",
    "damsel": "выбрана Ловчим — покажите новую роль",
    "mathematician": "покажите число меток «Аномалия»",
}
NOTES_OTHER = {
    "fearmonger": "выбрал нового игрока — объявите всем",
    "scarletwoman": "если сегодня стала Демоном",
    "lycanthrope": "выбрал доброго — тот умирает; Демона будите, но он не убивает",
    "imp": "убил себя — Приспешник становится Чёртом",
    "pukka": "новый отравлен, прежний умирает",
    "fanggu": "выбрал Изгоя (1 раз) — тот становится злым Фань Гу",
    "godfather": "если днём умер Изгой",
    "banshee": "убита Демоном этой ночью — объявите всем",
    "huntsman": "выбрал Девицу — она узнаёт новую роль",
    "damsel": "выбрана Ловчим — покажите новую роль",
    "mathematician": "покажите число меток «Аномалия»",
}
FOOT_FIRST = ("<b>Подготовка:</b> отметьте одного доброго игрока — он определяется злым (<b>Оборотень</b>). "
              "<b>Каннибал</b> просыпается тогда же, когда проснулась бы роль последнего казнённого.")

NIGHT_CSS = """
:root { --ab: 13pt; --gap: 1mm; --ic: calc(var(--ab) * 2.6); }
.half { position: absolute; top: 9mm; bottom: 9mm; width: 80mm; display: flex; flex-direction: column; }
.half.a { left: 9.5mm; }
.half.b { right: 9.5mm; transform: rotate(180deg); }
.nhead { flex: none; display: flex; align-items: flex-end; gap: 2mm; padding-left: 4mm; }
.nhead .title { display: block; width: 44mm; height: auto; }
.nhead .by { display: block; height: 7mm; width: auto; }
.label { flex: none; display: flex; align-items: center; gap: 2.5mm; color: %s; margin: 2mm 0 1.2mm; }
.label span { font-family: 'Old Standard TT', serif; font-weight: 700; font-size: 11pt; letter-spacing: .2em;
              text-transform: uppercase; white-space: nowrap; }
.label i { flex: 1; height: 0; border-bottom: 0.6pt solid %s; }
.flow { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: var(--gap); }
.step { flex: none; display: flex; align-items: center; gap: 3mm; min-height: var(--ic); }
.ic { flex: 0 0 var(--ic); width: var(--ic); height: var(--ic); }
.ic img { width: 100%%; height: 100%%; object-fit: contain; display: block; }
.ic.glyph img { padding: 0.6mm; }
.tx { flex: 1; min-width: 0; }
.nm { font-family: 'Old Standard TT', serif; font-weight: 700; font-size: var(--ab); line-height: 1.1; white-space: nowrap; }
.note { font-style: italic; font-size: calc(var(--ab) * 0.64); line-height: 1.2; color: #4E4842; margin-top: 0.4mm; }
.nfoot { flex: none; padding: 1.5mm 0 0 4mm; font-size: 8.8pt; line-height: 1.25; color: #3E3832; }
.nfoot p + p { margin-top: 0.8mm; }
.nfoot b { font-family: 'Old Standard TT', serif; font-weight: 700; }
.center { position: absolute; left: 50%%; top: 50%%; transform: translate(-50%%, -50%%); }
.center img { display: block; width: 24mm; height: auto; }
""" % (EVIL, ASH)


def build_night():
    glyph = {k: art(k, maxh=420) for k in SPECIAL}

    def step(rid, notes):
        if rid in SPECIAL:
            name, colour = SPECIAL[rid]
            ic = f'<div class="ic glyph"><img class="art" src="{glyph[rid]}" alt=""></div>'
        else:
            name, colour = NAME[rid], COL[team[rid]]
            ic = f'<div class="ic"><img src="{ba.icon(rid)}" alt=""></div>'
        note = f'<div class="note">{notes[rid]}</div>' if rid in notes else ""
        return f'<div class="step">{ic}<div class="tx"><div class="nm" style="color:{colour}">{name}</div>{note}</div></div>'

    def half(cls, label, key, notes, foot):
        order = [x for x in nightsheet[key] if x in ids or x in SPECIAL]
        print(f"{label}:", ", ".join(SPECIAL.get(x, (NAME.get(x),))[0] for x in order))
        return (f'<div class="half {cls}"><div class="nhead"><img class="title art" src="{art("title", maxw=1400)}" alt="Nachtmahr">'
                f'<img class="by art" src="{art("by", maxw=800)}" alt="by Илья"></div>'
                f'<div class="label"><span>{label}</span><i></i></div>'
                f'<div class="flow">{"".join(step(r, notes) for r in order)}</div><div class="nfoot">{foot}</div></div>')

    foot_other = "".join(f'<p><b style="color:{EVIL}">{NAME[a]} и {NAME[b]}:</b> {text}</p>' for a, b, text in JINXES)
    page = (f'<div class="page"><img class="frame" src="{bg()}" alt="">'
            f'<div class="center"><img class="art" src="{art("night_center", maxh=1400)}" alt=""></div>'
            f'{half("a", "Первая ночь", "firstNight", NOTES_FIRST, "<p>" + FOOT_FIRST + "</p>")}'
            f'{half("b", "Последующие ночи", "otherNight", NOTES_OTHER, foot_other)}</div>')
    html = (f'<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Nachtmahr — ночи</title>'
            f'{FONTS}<style>{BASE_CSS}{NIGHT_CSS}</style></head><body>{page}{ba.NIGHT_JS}</body></html>')
    path = OUT / "Nachtmahr — ночи.html"
    path.write_text(html, encoding="utf-8")
    ba.render(path)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    if "--night" not in sys.argv:
        build_roles()
    build_night()
