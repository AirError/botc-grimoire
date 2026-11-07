"""Сайт для GitHub Pages: веб-приложение (PWA) для Safari на iPhone/iPad.

out/site/
  index.html            — приложение (код и стили) + манифест, иконка для экрана «Домой», регистрация service worker
  art/                  — графика, иконки ролей (icons-<хэш>.js), звуки таймера: <имя>-<хэш содержимого>.<расширение> (app_build.py);
                          значки приложения icon-180/192/512-<хэш>.png (здесь)
  rec/                  — записи на утро и музыка Аль-Адихии, тоже с хэшем в имени
  manifest.webmanifest  — имя, цвета, иконки, полноэкранный режим
  sw.js                 — кэш: приложение открывается сразу из памяти телефона, работает без сети
Игра хранится в браузере устройства (localStorage), без облака.

Страница (~1,5 МБ) берётся из кэша сразу, без ожидания сети. Новая версия приходит через обновление service worker: имя кэша
содержит хэш страницы, sw.js меняется вместе с ней; телефон скачивает новую страницу один раз в фоне и показывает кнопку
«Гримуар обновился». Файлы art/ и rec/ лежат в отдельном кэше grimoire-files, общем для всех версий: в имени файла хэш
содержимого, поэтому обновление качает только новые и изменённые файлы (до v101 вся графика была внутри страницы ~20 МБ —
любое обновление качало всё).
"""
import hashlib
import io
import json
import shutil
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "out" / "site"
# чистим содержимое, а не саму папку: OneDrive иногда держит пустую папку и не даёт её удалить
SITE.mkdir(parents=True, exist_ok=True)
for f in SITE.iterdir():  # папку (rec) Windows иногда ненадолго держит — пустая остаётся, не страшно
    shutil.rmtree(f, ignore_errors=True) if f.is_dir() else f.unlink()
VERSION = "102"

body = (ROOT / "app" / "dist" / "grimoire.html").read_text(encoding="utf-8")

# файлы с хэшем в имени (app_build.py → app/dist/art и rec): рядом со страницей; service worker кладёт их в кэш при установке —
# без сети есть вся графика, утром играют записи
for d in ("art", "rec"):
    if (ROOT / "app" / "dist" / d).is_dir():
        shutil.copytree(ROOT / "app" / "dist" / d, SITE / d, dirs_exist_ok=True)
# значки приложения — тоже с хэшем в имени (art/icon-180-<хэш>.png): GitHub Pages ставит всем файлам ETag по времени публикации, и
# значки с постоянным именем (~620 КБ) перекачивались бы при каждом обновлении. iOS сама скругляет углы — полный квадрат без прозрачности
src = Image.open(ROOT / "art" / "src" / "app_icon.png").convert("RGB")
ICON = {}
(SITE / "art").mkdir(exist_ok=True)
for size in (180, 192, 512):
    buf = io.BytesIO()
    src.resize((size, size), Image.LANCZOS).save(buf, "PNG", optimize=True)
    ICON[size] = f"art/icon-{size}-{hashlib.sha1(buf.getvalue()).hexdigest()[:8]}.png"
    (SITE / ICON[size]).write_bytes(buf.getvalue())

head = ('<!doctype html><html lang="ru"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<meta name="apple-mobile-web-app-capable" content="yes">'
        '<meta name="mobile-web-app-capable" content="yes">'
        '<meta name="apple-mobile-web-app-status-bar-style" content="black">'
        '<meta name="apple-mobile-web-app-title" content="Гримуар">'
        '<meta name="theme-color" content="#0F121B">'
        '<link rel="manifest" href="manifest.webmanifest">'
        f'<link rel="apple-touch-icon" href="{ICON[180]}">'
        f'<link rel="icon" href="{ICON[192]}">'
        '</head><body>')
# регистрация service worker; новая версия встала (controllerchange) — кнопка «обновиться» сверху (игра хранится в localStorage,
# перезагрузка её не теряет). Вернулись в приложение (iOS держит его открытым) — проверяем, нет ли новой версии
register = """<script>
if ('serviceWorker' in navigator) {
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!had || document.getElementById('swupd')) return;
    const b = document.createElement('button'); b.id = 'swupd'; b.type = 'button';
    b.textContent = 'Гримуар обновился — нажмите, чтобы открыть новую версию';
    b.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 8px);z-index:99;padding:12px 14px;'
      + 'border-radius:12px;border:1px solid #DABA74;background:#181C29;color:#DABA74;font:700 15px/1.3 system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.4)';
    b.onclick = () => location.reload(); document.body.appendChild(b);
  });
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {});
  });
}
</script>"""
page = head + body + register + "</body></html>"
(SITE / "index.html").write_text(page, encoding="utf-8")
# хэш страницы — в имени кэша: изменилась страница → изменился sw.js → телефоны получат обновление, даже если VERSION забыли поднять
PAGE_HASH = hashlib.sha1(page.encode("utf-8")).hexdigest()[:8]

files = lambda d: [f"./{d}/{f.name}" for f in sorted((SITE / d).iterdir())] if (SITE / d).is_dir() else []
ART_FILES, REC_FILES = files("art"), files("rec")
# иконки ролей — обязательны (без них страница пустая): установка без них не проходит
NEED = [u for u in ART_FILES if u.startswith("./art/icons-") and u.endswith(".js")]
assert len(NEED) == 1 and NEED[0][2:] in body, "иконки ролей: в странице не та ссылка, что в art/ — пересоберите app_build.py"
ART_FILES = [u for u in ART_FILES if u not in NEED]
assert all(u[2:] in page or u[2:] in ICON.values() for u in ART_FILES), "в art/ есть файлы, которых страница не знает"

manifest = {
    # id и явный start_url — чтобы iOS не путала Гримуар с другими веб-приложениями на экране «Домой»
    "id": "/botc-grimoire/", "name": "Гримуар рассказчика", "short_name": "Гримуар", "lang": "ru",
    "start_url": "./?app=grimoire", "scope": "./", "display": "standalone", "orientation": "any",
    "background_color": "#0F121B", "theme_color": "#0F121B",
    "icons": [{"src": ICON[192], "sizes": "192x192", "type": "image/png"},
              {"src": ICON[512], "sizes": "512x512", "type": "image/png"},
              {"src": ICON[512], "sizes": "512x512", "type": "image/png", "purpose": "maskable"}],
}
(SITE / "manifest.webmanifest").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

(SITE / "sw.js").write_text(f"""// Кэш: приложение открывается сразу из памяти телефона, без ожидания сети, и работает без сети.
// Новая версия = новое имя кэша (номер + хэш страницы): sw.js меняется, телефон ставит его и один раз скачивает страницу в фоне.
const CACHE = 'grimoire-v{VERSION}-{PAGE_HASH}'; // страница и манифест — у каждой версии свои
const FILES = 'grimoire-files'; // art/ и rec/: в имени хэш содержимого — общий кэш для всех версий, неизменённое не качается заново
const FONTS = 'grimoire-fonts'; // шрифты Google не меняются — переживают обновления приложения
const LIST = './files-list.json'; // в FILES: какие файлы нужны этой версии (после обновления — чтобы чистить кэш)
const CORE = ['./index.html', './manifest.webmanifest'];
const NEED = {json.dumps(NEED)}; // иконки ролей — без них страница пустая: обязательны
// графика, звуки таймера, записи на утро — по возможности (не скачался файл — установка всё равно проходит, файл догрузится,
// когда понадобится); есть в кэше (прошлая версия) — берём оттуда, а не качаем заново
const ART = {json.dumps(ART_FILES)};
const REC = {json.dumps(REC_FILES)};
const abs = u => new URL(u, self.location).href;
// одновременно — не больше n загрузок (сотни файлов разом — тяжело для iPhone)
const pool = (list, n, fn) => {{ let i = 0; const next = () => i < list.length ? fn(list[i++]).then(next, next) : Promise.resolve();
  return Promise.all(Array.from({{ length: n }}, next)); }};
// файл с хэшем в имени: уже в FILES — ничего; есть в другом кэше (прошлые версии до v101 держали записи в своём) — переложить; нет — скачать
const take = (f, u) => f.match(u).then(hit => hit || caches.match(u).then(old => old ? f.put(u, old)
  : fetch(u).then(r => {{ if (!r.ok) throw new Error(u + ': ' + r.status); return f.put(u, r); }})));
// no-cache: сверяемся с сервером (если страница не менялась — 304, ничего не качаем), но не берём устаревшую копию
self.addEventListener('install', e => {{
  e.waitUntil(Promise.all([caches.open(CACHE), caches.open(FILES)]).then(([c, f]) =>
    c.addAll(CORE.map(u => new Request(u, {{ cache: 'no-cache' }})))
      .then(() => Promise.all(NEED.map(u => take(f, u))))
      .then(() => pool(ART.concat(REC), 6, u => take(f, u).catch(() => {{}}))))
    .then(() => self.skipWaiting()));
}});
// старые кэши версий — удалить; в FILES оставить файлы этой версии и прошлой (её страница может быть ещё открыта и догружать картинки)
self.addEventListener('activate', e => {{
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== FONTS && k !== FILES).map(k => caches.delete(k))))
    .then(() => caches.open(FILES)).then(f => f.match(LIST).then(r => r ? r.json() : []).catch(() => []).then(prev => {{
      const mine = NEED.concat(ART, REC).map(abs), keep = new Set(mine.concat(prev, abs(LIST)));
      return f.keys().then(reqs => Promise.all(reqs.filter(r => !keep.has(r.url)).map(r => f.delete(r))))
        .then(() => f.put(LIST, new Response(JSON.stringify(mine), {{ headers: {{ 'Content-Type': 'application/json' }} }})));
    }})).then(() => self.clients.claim()));
}});
// сохраняем удачные ответы; таблица стилей шрифтов приходит «непрозрачной» (opaque, без CORS) — её тоже, иначе запуск ждал бы сеть
const save = (name, req, r) => {{ if (r && (r.ok || r.type === 'opaque')) {{ const copy = r.clone(); caches.open(name).then(c => c.put(req, copy)); }} return r; }};
self.addEventListener('fetch', e => {{
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // страница: сразу из кэша; в кэше нет (первое открытие) — из сети с сохранением
  if (e.request.mode === 'navigate') {{
    e.respondWith(caches.open(CACHE).then(c => c.match('./index.html')).then(hit => hit || fetch(e.request).then(r => save(CACHE, './index.html', r)))
      .catch(() => caches.match('./index.html')));
    return;
  }}
  // шрифты Google — из своего кэша; art/ и rec/ — из общего кэша файлов; остальное (манифест) — из кэша версии;
  // нет — из сети с сохранением
  const fonts = url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com');
  if (fonts || url.origin === location.origin) {{
    const name = fonts ? FONTS : /\\/(art|rec)\\//.test(url.pathname) ? FILES : CACHE;
    e.respondWith(caches.open(name).then(c => c.match(e.request)).then(hit => hit || fetch(e.request).then(r => save(name, e.request, r))));
  }}
}});
""", encoding="utf-8")

(SITE / ".nojekyll").write_text("", encoding="utf-8")  # GitHub Pages: отдавать файлы как есть
for f in sorted(SITE.iterdir()):
    if f.is_dir():
        fs = list(f.iterdir())
        print(f"{f.name}/: {len(fs)} файлов, {sum(x.stat().st_size for x in fs) / 1024:.0f} КБ")
    else:
        print(f"{f.name}: {f.stat().st_size / 1024:.0f} КБ")
