"""Проба: какой кегль описаний даёт автоподгонка при разных размерах иконок и шапки (лист ролей, одна A4)."""
import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_sheets as B   # noqa: E402
import render              # noqa: E402

BASE = B.ROLES_CSS
_orig_fit = B.fit_js
B.fit_js = lambda mx, mn, g0, gm: _orig_fit(12.0, mn, g0, gm)  # поднимаем потолок автоподгонки
if len(sys.argv) > 1:
    keep = set(sys.argv[1:])
VARIANTS = {
    "probe_now": ({}, 44),
    "probe_ic12": ({".ic { flex: 0 0 9.5mm; width: 9.5mm; height: 9.5mm;": ".ic { flex: 0 0 12mm; width: 12mm; height: 12mm;"}, 44),
    "probe_ic12_nowin": ({".ic { flex: 0 0 9.5mm; width: 9.5mm; height: 9.5mm;": ".ic { flex: 0 0 12mm; width: 12mm; height: 12mm;"}, 0),
    "probe_ic12_tight": ({".ic { flex: 0 0 9.5mm; width: 9.5mm; height: 9.5mm;": ".ic { flex: 0 0 12mm; width: 12mm; height: 12mm;",
                          "line-height: 1.17;": "line-height: 1.1;", "column-gap: 6mm;": "column-gap: 4mm;"}, 0),
    # заголовки команд тоньше: без медальона, мелкий кегль, малые отступы
    "probe_ic12_slimh2": ({".ic { flex: 0 0 9.5mm; width: 9.5mm; height: 9.5mm;": ".ic { flex: 0 0 12mm; width: 12mm; height: 12mm;",
                           "h2 .medal { width: 8mm; height: 8mm;": "h2 .medal { width: 0; height: 0; display: none;",
                           "margin: 1.3mm 0 0.7mm; }": "margin: 0.6mm 0 0.3mm; font-size: 9pt; }",
                           "line-height: 1.17;": "line-height: 1.12;"}, 44),
    # плюс поля 9 мм вместо 10.5 (внутренний край рамки — 7.5 мм)
    "probe_ic12_slimh2_m9": ({".ic { flex: 0 0 9.5mm; width: 9.5mm; height: 9.5mm;": ".ic { flex: 0 0 12mm; width: 12mm; height: 12mm;",
                              "h2 .medal { width: 8mm; height: 8mm;": "h2 .medal { width: 0; height: 0; display: none;",
                              "margin: 1.3mm 0 0.7mm; }": "margin: 0.6mm 0 0.3mm; font-size: 9pt; }",
                              "line-height: 1.17;": "line-height: 1.12;",
                              "left: 10.5mm; right: 10.5mm; top: 10.5mm; bottom: 9.8mm;": "left: 9mm; right: 9mm; top: 9.5mm; bottom: 9mm;"}, 44),
}
for name, (reps, win) in VARIANTS.items():
    if len(sys.argv) > 1 and name not in keep:
        continue
    css = BASE
    for a, b in reps.items():
        assert a in css, a
        css = css.replace(a, b)
    B.ROLES_CSS = css
    B.build_roles(name, win)
    render.render(name, dpi=40)
