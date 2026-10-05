# ---------------------------------------------------------------- лист ролей

ROLES_CSS = """
:root { --ab: 9.5pt; --gap: 1.2mm; --split: 175mm; }
.frame.good { -webkit-mask-image: linear-gradient(to bottom, #000 calc(var(--split) - 7mm), transparent calc(var(--split) + 7mm));
              mask-image: linear-gradient(to bottom, #000 calc(var(--split) - 7mm), transparent calc(var(--split) + 7mm)); }
.content { position: absolute; left: 17mm; right: 17mm; top: 17.5mm; bottom: 13mm;
           display: flex; flex-direction: column; }
.head { flex: none; position: relative; text-align: center; }
.window { display: block; margin: 0 auto 1.2mm; height: auto; }
.title { display: block; margin: 0 auto; width: 116mm; height: auto; }
.by { position: absolute; right: 3mm; bottom: -0.5mm; font-family: 'Alegreya SC', serif; font-weight: 500;
      font-size: 9pt; letter-spacing: .08em; color: #5B554D; }
.flow { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
h2 { display: flex; align-items: center; gap: 2.2mm; font-family: 'Alegreya SC', serif; font-weight: 700;
     font-size: 12.5pt; letter-spacing: .14em; margin: 1.9mm 0 1.1mm; }
h2 .medal { width: 9.5mm; height: 9.5mm; flex: none; object-fit: contain; }
h2 .rule { flex: 1; height: 0; border-top: 0.35mm solid #9A7B3A; }
.cols { display: grid; grid-template-columns: 1fr 1fr; column-gap: 6mm; }
.col { display: flex; flex-direction: column; gap: var(--gap); }
.role { display: flex; align-items: flex-start; gap: 2mm; }
.ic { flex: 0 0 11.5mm; width: 11.5mm; height: 11.5mm; margin-top: -0.4mm; }
.ic img { width: 100%; height: 100%; object-fit: contain; display: block; }
.nm { font-weight: 700; font-size: calc(var(--ab) + 1.4pt); line-height: 1.1; }
.ab { font-size: var(--ab); line-height: 1.2; margin-top: 0.3mm; }
.ab b { font-weight: 700; }
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
    roles = TEAMS[team]
    weight = [len(a) + 70 for _, _, a in roles]  # 70 ≈ строка имени + отступ
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
            f'<div class="content"><div class="head">{window_html}'
            f'<img class="title" src="{title}" alt="{TITLE}"><div class="by">by {AUTHOR}</div></div>'
            f'<div class="flow">'
            f'{heading("townsfolk", A["sec_townsfolk"])}{two_cols("townsfolk")}'
            f'{heading("outsider", A["sec_outsider"])}{two_cols("outsider")}'
            f'{heading("minion", A["sec_minion"], "evil-start")}{two_cols("minion")}'
            f'{heading("demon", A["sec_demon"])}{two_cols("demon")}'
            f'</div><div class="foot"><span>* Не в первую ночь</span>'
            f'<span>по мотивам Everyone Can Play (Ben Burns) · роли © Steven Medway</span></div></div></div>')

    html = (f'<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>{TITLE} — роли</title>'
            f'{FONTS}<style>{BASE_CSS}{ROLES_CSS}</style></head><body>{page}'
            f'{fit_js(10.5, 7.5, 1.0, 3.5)}</body></html>')
    (OUT / f"{name}.html").write_text(html, encoding="utf-8")


