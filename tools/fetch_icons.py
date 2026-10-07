"""Скачивает официальные иконки всех ролей приложения из botc-release и готовит их к встраиванию.

raw:   app/icons/raw/<id>_<g|e>.webp — как скачано
small: app/icons/<id>_<g|e>.webp     — 192 px, для приложения и листов
js:    app/src/icons.js               — const ICONS = {id: {g: dataURI, e: dataURI}}
"""
import base64
import io
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "app" / "icons" / "raw"
SMALL = ROOT / "app" / "icons"
RAW.mkdir(parents=True, exist_ok=True)
BASE = "https://raw.githubusercontent.com/ThePandemoniumInstitute/botc-release/main/resources/characters/{ed}/{id}_{v}.webp"
SIZE = 192

# все роли, которые есть в данных приложения (базовая коробка + Странники + Сказочники + роли со свойствами)
_data = (ROOT / "app" / "src" / "data.js").read_text(encoding="utf-8")
roles = json.loads(_data[len("const DATA = "):_data.rindex(";")])["roles"]
SINGLE = "https://raw.githubusercontent.com/ThePandemoniumInstitute/botc-release/main/resources/characters/{ed}/{id}.webp"


def fetch(job):
    rid, v = job
    dst = RAW / f"{rid}_{v}.webp"
    if dst.exists() and dst.stat().st_size > 0:
        return rid, v, dst.stat().st_size, None
    # у Сказочников и Лориков одна иконка без деления на добрых и злых (в папке своего издания) — кладём её в оба варианта
    r = roles[rid]
    url = (SINGLE.format(ed=r["edition"], id=rid) if r["team"] in ("fabled", "loric")
           else BASE.format(ed=r["edition"], id=rid, v=v))
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                data = r.read()
            dst.write_bytes(data)
            return rid, v, len(data), None
        except Exception as e:  # повтор при сетевой ошибке
            err = str(e)
    return rid, v, 0, err


jobs = [(rid, v) for rid in roles for v in ("g", "e")]
with ThreadPoolExecutor(max_workers=8) as ex:
    results = list(ex.map(fetch, jobs))

failed = [r for r in results if r[3]]
total = sum(r[2] for r in results)
print(f"скачано: {len(results) - len(failed)} из {len(jobs)}, {total / 1024 / 1024:.1f} МБ")
for rid, v, _, err in failed:
    print("  не удалось:", rid, v, err)

icons = {}
for rid, v, size, err in results:
    if err:
        continue
    im = Image.open(RAW / f"{rid}_{v}.webp").convert("RGBA")
    im = im.crop(im.getbbox())
    im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=88, method=6)
    (SMALL / f"{rid}_{v}.webp").write_bytes(buf.getvalue())
    app = im.copy()
    app.thumbnail((112, 112), Image.LANCZOS)  # для экрана телефона хватает 112 px
    abuf = io.BytesIO()
    app.save(abuf, "WEBP", quality=85, method=6)
    icons.setdefault(rid, {})[v] = "data:image/webp;base64," + base64.b64encode(abuf.getvalue()).decode()

out = ROOT / "app" / "src" / "icons.js"
out.write_text("const ICONS = " + json.dumps(icons, separators=(",", ":")) + ";\n", encoding="utf-8")
print(f"icons.js: {len(icons)} ролей, {out.stat().st_size / 1024 / 1024:.2f} МБ")
