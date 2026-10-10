// Кэш: приложение открывается сразу из памяти телефона, без ожидания сети (страница ~6 МБ).
// Новая версия = новое имя кэша (номер + хэш страницы): sw.js меняется, телефон ставит его и один раз скачивает страницу в фоне.
const CACHE = 'grimoire-v18-532a6395';
const FONTS = 'grimoire-fonts'; // шрифты Google не меняются — переживают обновления приложения
const CORE = ['./index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
// no-cache: сверяемся с сервером (если страница не менялась — 304, ничего не качаем), но не берём устаревшую копию
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'no-cache' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== FONTS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// сохраняем удачные ответы; таблица стилей шрифтов приходит «непрозрачной» (opaque, без CORS) — её тоже, иначе запуск ждал бы сеть
const save = (name, req, r) => { if (r && (r.ok || r.type === 'opaque')) { const copy = r.clone(); caches.open(name).then(c => c.put(req, copy)); } return r; };
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // страница: сразу из кэша; в кэше нет (первое открытие) — из сети с сохранением
  if (e.request.mode === 'navigate') {
    e.respondWith(caches.open(CACHE).then(c => c.match('./index.html')).then(hit => hit || fetch(e.request).then(r => save(CACHE, './index.html', r)))
      .catch(() => caches.match('./index.html')));
    return;
  }
  // шрифты Google — из своего кэша; файлы сайта (иконки, манифест) — из кэша версии; нет — из сети с сохранением
  const fonts = url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com');
  if (fonts || url.origin === location.origin) {
    const name = fonts ? FONTS : CACHE;
    e.respondWith(caches.open(name).then(c => c.match(e.request)).then(hit => hit || fetch(e.request).then(r => save(name, e.request, r))));
  }
});
