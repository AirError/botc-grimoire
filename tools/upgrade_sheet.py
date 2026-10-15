"""Доводит лист ролей старого генератора (make_art.py) до уровня «Everyone Can Be Evil»:
  1) иконки ролей вшиваются в файл (официальные botc-release: синие у добрых, красные у злых) — лист работает без интернета;
  2) кегль описаний подбирается автоматически: максимальный, при котором всё влезает на A4 (название = описание × 1.3);
  3) рендер в PDF через headless Edge + PNG для осмотра.

python tools\\upgrade_sheet.py "<лист.html>" "<папка результата>" [--ic 14] [--max 12.5]
Исходный файл не меняется.
"""
import base64
import json
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "app" / "icons"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE = "https://raw.githubusercontent.com/ThePandemoniumInstitute/botc-release/main/resources/characters/{ed}/{id}_{v}.webp"

args = [a for a in sys.argv[1:] if not a.startswith("--")]
opt = dict(zip(sys.argv[1::2], sys.argv[2::2]))
src, outdir = Path(args[0]), Path(args[1])
ic_mm = float(opt.get("--ic", 14))
ab_max = float(opt.get("--max", 12.5))
slim = opt.get("--slim") == "1"          # компактнее заголовки секций и шапка
tight = opt.get("--tight") == "1"        # плотнее межстрочный интервал и отступы между ролями
suffix = opt.get("--suffix", "")
outdir.mkdir(parents=True, exist_ok=True)

roles = {r["id"]: r for r in json.loads((ROOT / "app" / "data" / "roles.json").read_text(encoding="utf-8"))}
html = src.read_text(encoding="utf-8")


def icon_uri(rid):
    team = roles[rid]["team"]
    v = "e" if team in ("minion", "demon") else "g"
    path = ICONS / f"{rid}_{v}.webp"
    if not path.exists():  # роли не из базовой коробки — докачиваем из того же официального источника
        url = BASE.format(ed=roles[rid]["edition"], id=rid, v=v)
        print("  скачиваю иконку:", rid)
        path.write_bytes(urllib.request.urlopen(url, timeout=30).read())
    return "data:image/webp;base64," + base64.b64encode(path.read_bytes()).decode()


# 1. иконки: <div class="role" id="r-ID"><div class="ic"><img src="https://wiki...">
count = 0


def repl(m):
    global count
    count += 1
    return m.group(1) + icon_uri(m.group(2)) + '"'


html = re.sub(r'(<div class="role" id="r-([a-z_]+)"><div class="ic"><img src=")https?://[^"]+"', repl, html)
left = re.findall(r'src="https?://wiki[^"]+"', html)
print(f"иконок вшито: {count}; осталось ссылок на вики: {len(left)}")

# 2. автоподгонка кегля: переменная --ab, название пропорционально (как было: 12.5 / 9.6 ≈ 1.3)
css = f"""<style>
:root {{ --ab: 9.6pt; }}
.ab {{ font-size: var(--ab) !important; }}
.nm {{ font-size: calc(var(--ab) * 1.3) !important; }}
.ic {{ flex: 0 0 {ic_mm}mm !important; width: {ic_mm}mm !important; height: {ic_mm}mm !important; }}
{'''.sh .lbl { font-size: 12pt !important; letter-spacing: 2pt !important; }
.sh img { height: 6.5mm !important; }
.sec { margin-top: 1.2mm !important; }
header { height: 22mm !important; } header .hunter, header .owl { height: 22mm !important; }''' if slim else ''}
{'''.ab { line-height: 1.12 !important; } .role { padding: 0.25mm 0 !important; } .nm { margin-bottom: 0.3mm !important; }''' if tight else ''}
</style>"""
js = f"""<script>
(async function () {{
  await document.fonts.ready;
  await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => {{ i.onload = i.onerror = r; }})));
  const page = document.querySelector('.page'), root = document.documentElement.style;
  const over = () => page.scrollHeight > page.clientHeight + 1;
  // колонки секции делятся по реальной высоте ролей (порядок сохраняется), а не поровну по количеству
  const pairs = [...document.querySelectorAll('.cols')].map(c => [...c.children].filter(x => x.classList.contains('col') && !x.classList.contains('art-slot')))
    .filter(cs => cs.length === 2);
  function balance() {{
    for (const [a, b] of pairs) {{
      const roles = [...a.querySelectorAll('.role'), ...b.querySelectorAll('.role')];
      roles.forEach(r => a.appendChild(r));
      const h = roles.map(r => r.getBoundingClientRect().height);
      let best = 1, bestMax = 1e9;
      for (let k = 1; k < roles.length; k++) {{
        const m = Math.max(h.slice(0, k).reduce((s, x) => s + x, 0), h.slice(k).reduce((s, x) => s + x, 0));
        if (m < bestMax) {{ bestMax = m; best = k; }}
      }}
      roles.slice(best).forEach(r => b.appendChild(r));
    }}
  }}
  let ab = {ab_max};
  for (; ab >= 7.5; ab = Math.round((ab - 0.1) * 10) / 10) {{ root.setProperty('--ab', ab + 'pt'); balance(); if (!over()) break; }}
  document.body.dataset.fit = 'ab=' + ab + 'pt overflow=' + over();
}})();
</script>"""
html = html.replace("</head>", css + "</head>", 1).replace("</body>", js + "</body>", 1)
name = src.stem.replace(" — роли", "") + " — роли" + suffix
out_html = outdir / f"{name}.html"
out_html.write_text(html, encoding="utf-8")

# 3. рендер: печать в PDF как в Chrome + итог подгонки
profile = Path(tempfile.gettempdir()) / "ecbe_edge_profile"
base = [EDGE, "--headless=new", "--disable-gpu", f"--user-data-dir={profile}", "--no-first-run",
        "--virtual-time-budget=20000", "--run-all-compositor-stages-before-draw"]
pdf = outdir / f"{name}.pdf"
url = out_html.resolve().as_uri()
subprocess.run(base + ["--no-pdf-header-footer", f"--print-to-pdf={pdf.resolve()}", url], capture_output=True, timeout=180)
dom = subprocess.run(base + ["--dump-dom", url], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180).stdout
fit = re.search(r'data-fit="([^"]*)"', dom)
try:
    import pymupdf
    doc = pymupdf.open(pdf)
    doc[0].get_pixmap(dpi=70).save(outdir / f"{name}_p1.png")
    pages = doc.page_count
except Exception as e:
    pages = f"не проверено ({e})"
print(f"{out_html.name}: страниц {pages}; автоподгонка: {fit.group(1) if fit else 'нет данных'}")
