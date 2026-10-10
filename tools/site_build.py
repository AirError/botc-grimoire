"""Сайт для GitHub Pages: веб-приложение (PWA) для Safari на iPhone/iPad.

out/site/
  index.html            — приложение + манифест, иконка для экрана «Домой», регистрация service worker
  manifest.webmanifest  — имя, цвета, иконки, полноэкранный режим
  sw.js                 — кэш: приложение открывается сразу из памяти телефона, работает без сети
  icon-180.png, icon-192.png, icon-512.png
Игра хранится в браузере устройства (localStorage), без облака.

Страница весит ~6 МБ (3,8 МБ сжатой) — вся графика внутри. Поэтому страница берётся из кэша сразу, без ожидания сети
(раньше сначала шла сеть — на мобильном интернете запуск занимал до 30 секунд). Новая версия приходит через обновление
service worker: имя кэша содержит хэш страницы, sw.js меняется вместе с ней; телефон скачивает её один раз в фоне
и показывает кнопку «Гримуар обновился».
"""
import hashlib
import json
import shutil
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "out" / "site"
# чистим содержимое, а не саму папку: OneDrive иногда держит пустую папку и не даёт её удалить
SITE.mkdir(parents=True, exist_ok=True)
for f in SITE.iterdir():
    shutil.rmtree(f) if f.is_dir() else f.unlink()
VERSION = "19"

body = (ROOT / "app" / "dist" / "grimoire.html").read_text(encoding="utf-8")
# хэш страницы — в имени кэша: изменилась страница → изменился sw.js → телефоны получат обновление, даже если VERSION забыли поднять
PAGE_HASH = hashlib.sha1(body.encode("utf-8")).hexdigest()[:8]
head = ('<!doctype html><html lang="ru"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<meta name="apple-mobile-web-app-capable" content="yes">'
        '<meta name="mobile-web-app-capable" content="yes">'
        '<meta name="apple-mobile-web-app-status-bar-style" content="black">'
        '<meta name="apple-mobile-web-app-title" content="Гримуар">'
        '<meta name="theme-color" content="#0F121B">'
        '<link rel="manifest" href="manifest.webmanifest">'
        '<link rel="apple-touch-icon" href="icon-180.png">'
        '<link rel="icon" href="icon-192.png">'
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
(SITE / "index.html").write_text(head + body + register + "</body></html>", encoding="utf-8")

# иконки: iOS сама скругляет углы — отдаём полный квадрат без прозрачности
src = Image.open(ROOT / "art" / "src" / "app_icon.png").convert("RGB")
for size in (180, 192, 512):
    src.resize((size, size), Image.LANCZOS).save(SITE / f"icon-{size}.png", optimize=True)

manifest = {
    # id и явный start_url — чтобы iOS не путала Гримуар с другими веб-приложениями на экране «Домой»
    "id": "/botc-grimoire/", "name": "Гримуар рассказчика", "short_name": "Гримуар", "lang": "ru",
    "start_url": "./?app=grimoire", "scope": "./", "display": "standalone", "orientation": "any",
    "background_color": "#0F121B", "theme_color": "#0F121B",
    "icons": [{"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
              {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"},
              {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}],
}
(SITE / "manifest.webmanifest").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

(SITE / "sw.js").write_text(f"""// Кэш: приложение открывается сразу из памяти телефона, без ожидания сети (страница ~6 МБ).
// Новая версия = новое имя кэша (номер + хэш страницы): sw.js меняется, телефон ставит его и один раз скачивает страницу в фоне.
const CACHE = 'grimoire-v{VERSION}-{PAGE_HASH}';
const FONTS = 'grimoire-fonts'; // шрифты Google не меняются — переживают обновления приложения
const CORE = ['./index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
// no-cache: сверяемся с сервером (если страница не менялась — 304, ничего не качаем), но не берём устаревшую копию
self.addEventListener('install', e => {{
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, {{ cache: 'no-cache' }})))).then(() => self.skipWaiting()));
}});
self.addEventListener('activate', e => {{
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== FONTS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
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
  // шрифты Google — из своего кэша; файлы сайта (иконки, манифест) — из кэша версии; нет — из сети с сохранением
  const fonts = url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com');
  if (fonts || url.origin === location.origin) {{
    const name = fonts ? FONTS : CACHE;
    e.respondWith(caches.open(name).then(c => c.match(e.request)).then(hit => hit || fetch(e.request).then(r => save(name, e.request, r))));
  }}
}});
""", encoding="utf-8")

(SITE / ".nojekyll").write_text("", encoding="utf-8")  # GitHub Pages: отдавать файлы как есть
for f in sorted(SITE.iterdir()):
    print(f"{f.name}: {f.stat().st_size / 1024:.0f} КБ")
