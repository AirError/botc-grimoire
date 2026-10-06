"""Сайт для GitHub Pages: веб-приложение (PWA) для Safari на iPhone/iPad.

out/site/
  index.html            — приложение + манифест, иконка для экрана «Домой», регистрация service worker
  manifest.webmanifest  — имя, цвета, иконки, полноэкранный режим
  sw.js                 — кэш для работы без сети (после первого открытия)
  icon-180.png, icon-192.png, icon-512.png
Игра хранится в браузере устройства (localStorage), без облака.
"""
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
VERSION = "9"

body = (ROOT / "app" / "dist" / "grimoire.html").read_text(encoding="utf-8")
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
register = ("<script>if ('serviceWorker' in navigator) { window.addEventListener('load', () => "
            "navigator.serviceWorker.register('sw.js').catch(() => {})); }</script>")
(SITE / "index.html").write_text(head + body + register + "</body></html>", encoding="utf-8")

# иконки: iOS сама скругляет углы — отдаём полный квадрат без прозрачности
src = Image.open(ROOT / "art" / "src" / "app_icon.png").convert("RGB")
for size in (180, 192, 512):
    src.resize((size, size), Image.LANCZOS).save(SITE / f"icon-{size}.png", optimize=True)

manifest = {
    "name": "Гримуар рассказчика", "short_name": "Гримуар", "lang": "ru",
    "start_url": "./", "scope": "./", "display": "standalone", "orientation": "any",
    "background_color": "#0F121B", "theme_color": "#0F121B",
    "icons": [{"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
              {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"},
              {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}],
}
(SITE / "manifest.webmanifest").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

(SITE / "sw.js").write_text(f"""// Кэш для работы без сети. Новая версия приложения = новый номер кэша.
const CACHE = 'grimoire-v{VERSION}';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {{ e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); }});
self.addEventListener('activate', e => {{
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
}});
self.addEventListener('fetch', e => {{
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // страница: сначала сеть (чтобы получать обновления), без сети — из кэша
  if (e.request.mode === 'navigate') {{
    e.respondWith(fetch(e.request).then(r => {{ const copy = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return r; }})
      .catch(() => caches.match('./index.html')));
    return;
  }}
  // шрифты Google и иконки: из кэша, если есть, иначе из сети с сохранением
  if (url.origin === location.origin || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {{
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {{
      const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }})));
  }}
}});
""", encoding="utf-8")

(SITE / ".nojekyll").write_text("", encoding="utf-8")  # GitHub Pages: отдавать файлы как есть
for f in sorted(SITE.iterdir()):
    print(f"{f.name}: {f.stat().st_size / 1024:.0f} КБ")
