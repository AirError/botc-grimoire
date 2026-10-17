"""Тестовая сборка Гримуара для одного человека (просьба пользователя 2026-10-17): дать протестировать и закрыть доступ.

    PY tools\\test_build.py --name "Иван" --until 2026-10-31 [--pin 4821] [--deploy grimoire-test-k7q2]

out/test/<папка>/ и копия в Загрузки\\Гримуар\\Тестовая версия\\<папка>/. С --deploy папка сразу загружается в проект Cloudflare
Pages (production) через Wrangler (%LOCALAPPDATA%\\botc-grimoire\\wrangler; вход — `wrangler login` с правами account:read,
user:read, pages:write, сделан 2026-10-17); без него папку загружают вручную («Create deployment» → перетащить). Доступ по почте
даёт Cloudflare Access. Отличия от сайта на GitHub Pages:
  - при каждом открытии — окно «Добро пожаловать в тестовую версию» со сроком и просьбой писать ошибки в «Заметки»; имя тестера
    и срок — карточкой на вкладке «Ещё» (window.TEST_BUILD → ui.js; постоянная плашка была до 2026-10-17 — пользователю мешала);
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
ap.add_argument("--name", required=True, help="имя тестера — в окне приветствия и на вкладке «Ещё»")
ap.add_argument("--until", required=True, help="последний день работы, ГГГГ-ММ-ДД (включительно, по часам устройства)")
ap.add_argument("--pin", help="пароль на «Показать роли» в этой сборке (без него — пароль основной сборки)")
ap.add_argument("--deploy", metavar="ПРОЕКТ", help="сразу загрузить в этот проект Cloudflare Pages (production) через Wrangler")
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

test_info = json.dumps({"name": name, "until": f"{until:%d.%m.%Y}"}, ensure_ascii=False)
# срок — конец последнего дня по часам устройства; самое позднее время запуска запоминается, чтобы перевод часов назад не продлевал срок;
# приложение открыто дольше срока — через 10 минут перезагрузится и покажет, что тест закончился
guard = f"""<script>
window.TEST_BUILD = {test_info};
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
folder = re.sub(r'[\\/:*?"<>|]+', "", f"Тест — {name} — до {until:%d.%m}").strip()
out = ROOT / "out" / "test" / folder
out.mkdir(parents=True, exist_ok=True)
for f in out.iterdir():
    shutil.rmtree(f) if f.is_dir() else f.unlink()
(out / "index.html").write_text(head + body + "</body></html>", encoding="utf-8")
for size in (180, 192):  # иконки — из сборки сайта (site_build.py)
    src = ROOT / "out" / "site" / f"icon-{size}.png"
    if src.exists():
        shutil.copy2(src, out / src.name)
(out / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
# Cloudflare Pages: страница не кэшируется (новая загрузка и срок действуют сразу), не индексируется
(out / "_headers").write_text("/*\n  Cache-Control: no-cache\n  X-Robots-Tag: noindex, nofollow\n", encoding="utf-8")

# копия в «Загрузки»: обновляем файлы внутри папки (саму папку не удаляем — она может быть открыта в Проводнике);
# не получилось — только предупреждение, сборка и загрузка на Cloudflare идут дальше
dl = Path.home() / "Downloads" / "Гримуар" / "Тестовая версия" / folder
try:
    dl.mkdir(parents=True, exist_ok=True)
    for f in dl.iterdir():
        shutil.rmtree(f) if f.is_dir() else f.unlink()
    shutil.copytree(out, dl, dirs_exist_ok=True)
except OSError as e:
    print(f"копия в «Загрузки» не обновлена: {e}")
print(json.dumps({"папка": str(dl), "тестер": name, "до": f"{until:%d.%m.%Y}", "пароль": "свой" if args.pin else "как в основной сборке"}, ensure_ascii=False, indent=1))

if args.deploy:
    # Wrangler — напрямую через node (без cmd.exe: путь к папке с кириллицей передаётся без искажений); ветка main — production проекта
    import os
    import subprocess
    import sys
    tools = Path(os.environ["LOCALAPPDATA"]) / "botc-grimoire"
    node = tools / "node" / "node-v24.21.0-win-x64" / "node.exe"
    wrangler = tools / "wrangler" / "node_modules" / "wrangler" / "bin" / "wrangler.js"
    if not wrangler.exists():
        sys.exit(f"нет Wrangler: {wrangler} — установить: npm install wrangler в {wrangler.parents[3]}, потом wrangler login")
    env = dict(os.environ, PATH=str(node.parent) + os.pathsep + os.environ.get("PATH", ""), WRANGLER_SEND_METRICS="false")
    # cwd — папка Wrangler вне проекта: он пишет туда .wrangler/cache (номер и название аккаунта — не для публичного репозитория)
    r = subprocess.run([str(node), str(wrangler), "pages", "deploy", str(out.resolve()), "--project-name", args.deploy,
                        "--branch", "main", "--commit-dirty=true"], env=env, cwd=str(wrangler.parents[3]))
    sys.exit(r.returncode)
