"""Тестовая сборка Гримуара для одного человека (просьба пользователя 2026-10-17): дать протестировать и закрыть доступ.

    PY tools\\test_build.py --name "Иван" --until 2026-10-31 [--pin 4821]

out/test/<папка>/ и копия в Загрузки\\Гримуар\\Тестовая версия\\<папка>/ — эту папку загружают в Cloudflare Pages
(«Перетащить файлы»), а доступ по почте даёт Cloudflare Access. Отличия от сайта на GitHub Pages:
  - имя тестера и срок — плашкой поверх всех экранов (если сборка разойдётся, видно, чья она);
  - после даты (до конца дня по часам устройства) вместо приложения — «Тестовый период закончился»; часы назад не помогают:
    устройство помнит самое позднее время запуска (localStorage botc-grimoire-test-seen);
  - нет service worker и манифеста: приложение не остаётся на телефоне — закрыли доступ, и оно больше не откроется;
  - свой пароль на «Показать роли» (--pin; без него — пароль основной сборки); в коде, как и везде, только хэш;
  - поисковикам запрещено индексировать (meta robots, robots.txt, _headers).
Это защита от случайной пересылки, а не от взлома: сохранённую страницу знающий человек поправит.
"""
import argparse
import datetime
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser(description="Тестовая сборка Гримуара")
ap.add_argument("--name", required=True, help="имя тестера — видно на всех экранах")
ap.add_argument("--until", required=True, help="последний день работы, ГГГГ-ММ-ДД (включительно, по часам устройства)")
ap.add_argument("--pin", help="пароль на «Показать роли» в этой сборке (без него — пароль основной сборки)")
args = ap.parse_args()
until = datetime.date.fromisoformat(args.until)
name = args.name.strip()


def pin_hash(s):
    """как pinHash в ui.js: FNV-1a по кодам символов, результат — в 36-ричной записи"""
    h = 2166136261
    for ch in str(s).strip():
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    digits, out = "0123456789abcdefghijklmnopqrstuvwxyz", ""
    while True:
        h, r = divmod(h, 36)
        out = digits[r] + out
        if not h:
            return out


body = (ROOT / "app" / "dist" / "grimoire.html").read_text(encoding="utf-8")
if args.pin:
    body, n = re.subn(r"PIN_DEFAULT = '[0-9a-z]+'", f"PIN_DEFAULT = '{pin_hash(args.pin)}'", body)
    assert n == 1, "не нашёл PIN_DEFAULT в сборке — проверьте ui.js"

mark = f"ТЕСТ · {name} · до {until:%d.%m.%Y}"
# срок — конец последнего дня по часам устройства; самое позднее время запуска запоминается, чтобы перевод часов назад не продлевал срок;
# приложение открыто дольше срока — через 10 минут перезагрузится и покажет, что тест закончился
guard = f"""<script>
(function () {{
  var END = new Date({until.year}, {until.month - 1}, {until.day}, 23, 59, 59).getTime(), KEY = 'botc-grimoire-test-seen', seen = 0;
  try {{ seen = +localStorage.getItem(KEY) || 0; }} catch (e) {{}}
  var t = Math.max(Date.now(), seen);
  try {{ localStorage.setItem(KEY, String(t)); }} catch (e) {{}}
  if (t > END) {{
    window.stop();
    document.documentElement.innerHTML = '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Гримуар — тест закончился</title></head>'
      + '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0F121B;color:#DABA74;font:700 19px/1.5 system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box">'
      + '<div>Тестовый период закончился.<br><span style="color:#A49C8B;font-weight:400;font-size:15px">Спасибо за помощь! Чтобы продолжить, напишите автору.</span></div></body>';
    return;
  }}
  setInterval(function () {{ if (Date.now() > END) location.reload(); }}, 600000);
}})();
</script>"""
head = ('<!doctype html><html lang="ru"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<meta name="robots" content="noindex,nofollow">'
        '<meta name="apple-mobile-web-app-capable" content="yes">'
        '<meta name="mobile-web-app-capable" content="yes">'
        '<meta name="apple-mobile-web-app-status-bar-style" content="black">'
        '<meta name="apple-mobile-web-app-title" content="Гримуар (тест)">'
        '<meta name="theme-color" content="#0F121B">'
        '<link rel="apple-touch-icon" href="icon-180.png"><link rel="icon" href="icon-192.png">'
        + guard + '</head><body>')
# плашка — поверх всех экранов (в том числе показа игрокам), над вкладками; нажатия проходят сквозь неё
badge = ('<style>#testmark{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 64px);'
         'z-index:2147483647;pointer-events:none;padding:2px 10px;border-radius:999px;background:rgba(122,30,34,.88);color:#FFFFFF;'
         'font:700 11px/1.5 system-ui,sans-serif;letter-spacing:.03em;white-space:nowrap;opacity:.9}</style>'
         f'<div id="testmark" aria-hidden="true">{mark}</div>')

folder = re.sub(r'[\\/:*?"<>|]+', "", f"Тест — {name} — до {until:%d.%m}").strip()
out = ROOT / "out" / "test" / folder
out.mkdir(parents=True, exist_ok=True)
for f in out.iterdir():
    shutil.rmtree(f) if f.is_dir() else f.unlink()
(out / "index.html").write_text(head + body + badge + "</body></html>", encoding="utf-8")
for size in (180, 192):  # иконки — из сборки сайта (site_build.py)
    src = ROOT / "out" / "site" / f"icon-{size}.png"
    if src.exists():
        shutil.copy2(src, out / src.name)
(out / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
# Cloudflare Pages: страница не кэшируется (новая загрузка и срок действуют сразу), не индексируется
(out / "_headers").write_text("/*\n  Cache-Control: no-cache\n  X-Robots-Tag: noindex, nofollow\n", encoding="utf-8")

dl = Path.home() / "Downloads" / "Гримуар" / "Тестовая версия" / folder
if dl.exists():
    shutil.rmtree(dl)
shutil.copytree(out, dl)
print(json.dumps({"папка": str(dl), "плашка": mark, "пароль": "свой" if args.pin else "как в основной сборке"}, ensure_ascii=False, indent=1))
