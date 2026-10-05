"""Одноразовый патч: убирает капитель Alegreya SC с листов (кириллическая «у» в ней похожа на Y)."""
from pathlib import Path

p = Path(__file__).resolve().parent / "build_sheets.py"
t = p.read_text(encoding="utf-8")
reps = [
    ("&family=Alegreya+SC:wght@500;700&display=swap", "&display=swap"),
    (".by { text-align: right; margin-top: 0.3mm; font-family: 'Alegreya SC', serif; font-weight: 500;",
     ".by { text-align: right; margin-top: 0.3mm; font-family: 'Alegreya', serif; font-weight: 600; text-transform: uppercase;"),
    ("h2 { display: flex; align-items: center; gap: 2.2mm; font-family: 'Alegreya SC', serif; font-weight: 700;",
     "h2 { display: flex; align-items: center; gap: 2.2mm; font-family: 'Alegreya', serif; font-weight: 700; text-transform: uppercase;"),
    ("     font-size: 11.5pt; letter-spacing: .14em; margin: 1.3mm 0 0.7mm; }",
     "     font-size: 10.5pt; letter-spacing: .14em; margin: 1.3mm 0 0.7mm; }"),
    (".half .label { font-family: 'Alegreya SC', serif; font-weight: 700; font-size: 13pt; letter-spacing: .14em;",
     ".half .label { font-family: 'Alegreya', serif; font-weight: 700; font-size: 11.5pt; text-transform: uppercase; letter-spacing: .14em;"),
]
for a, b in reps:
    assert a in t, "не найдено: " + a[:70]
    t = t.replace(a, b)
assert "Alegreya SC" not in t
p.write_text(t, encoding="utf-8", newline="\n")
print("ok")
