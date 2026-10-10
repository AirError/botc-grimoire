'use strict';
/* Заметки «что доработать» — вкладка «Ещё». Хранятся отдельно от игры (новая игра и отмена их не трогают):
   IndexedDB, без него — localStorage. Скриншоты сжимаются (до 1600 px, JPEG) и хранятся с миниатюрой для списка.
   К заметке само добавляется, где вы были: фаза, шаг ночи, сценарий. Выгрузка: «Поделиться», файл со всем, текст. */
let NOTES = [];                      // [{ id, created, text, done, ctx, images: [{ full, thumb }] }], новые — первыми
const NOTE_DRAFT = { imgs: [], busy: false };
const NOTES_DB = 'botc-grimoire-notes', NOTES_LS = 'botc-grimoire-notes-v1';
let notesIdb = null;

function notesOpen() {
  return new Promise(res => {
    try {
      const rq = indexedDB.open(NOTES_DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('notes', { keyPath: 'id' });
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
const notesTx = (mode, fn) => new Promise((res, rej) => {
  const tx = notesIdb.transaction('notes', mode), st = tx.objectStore('notes'), out = fn(st);
  tx.oncomplete = () => res(out && out.result); tx.onerror = () => rej(tx.error);
});
// без IndexedDB — localStorage (места меньше: около 5 МБ на все заметки)
function notesSaveLs() { try { localStorage.setItem(NOTES_LS, JSON.stringify(NOTES)); return true; } catch (e) { return false; } }
async function notesLoad() {
  notesIdb = await notesOpen();
  try {
    if (notesIdb) NOTES = (await notesTx('readonly', st => st.getAll())) || [];
    else NOTES = JSON.parse(localStorage.getItem(NOTES_LS) || '[]');
  } catch (e) { NOTES = []; }
  NOTES.sort((a, b) => b.created - a.created);
  if (typeof render === 'function' && typeof S !== 'undefined' && S) render();
}
async function notePut(n) {
  if (notesIdb) { try { await notesTx('readwrite', st => st.put(n)); return true; } catch (e) { return false; } }
  return notesSaveLs();
}
async function noteDelete(id) {
  NOTES = NOTES.filter(n => n.id !== id);
  if (notesIdb) { try { await notesTx('readwrite', st => st.delete(id)); } catch (e) { /* уже удалена */ } } else notesSaveLs();
}

// скриншот → JPEG до 1600 px по длинной стороне + миниатюра 240 px (для списка)
function noteImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const pack = max => { const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        const g = c.getContext('2d'); g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', max > 400 ? 0.82 : 0.7); };
      URL.revokeObjectURL(url); res({ full: pack(1600), thumb: pack(240) });
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('не картинка')); };
    img.src = url;
  });
}
// где был рассказчик, когда писал заметку
function noteContext() {
  if (!S) return '';
  const ph = S.phase === 'setup' ? 'Подготовка' : S.phase === 'night' ? `Ночь ${S.n}` : S.phase === 'day' ? `День ${S.n}` : 'Игра окончена';
  const st = S.phase === 'night' && E.currentStep(S), step = st ? (st.meet ? 'знакомство злых' : E.rname(st.id)) : '';
  return [ph + (step ? ' · шаг: ' + step : ''), S.script.name].join(' · ');
}
const noteDate = ts => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

function notesCard() {
  const pend = NOTE_DRAFT.imgs.map((im, i) => `<span class="nthumb"><img src="${im.thumb}" alt="Скриншот ${i + 1}"><button class="nx" data-act="noteImgDel" data-arg="${i}" aria-label="Убрать скриншот">×</button></span>`).join('');
  const open = NOTES.filter(n => !n.done).length;
  const list = NOTES.map(n => `<div class="note ${n.done ? 'done' : ''}">
      <div class="nhead"><span class="small muted">${esc(noteDate(n.created))}${n.ctx ? ' · ' + esc(n.ctx) : ''}</span></div>
      ${n.text ? `<div class="ntext">${esc(n.text)}</div>` : ''}
      ${(n.images || []).length ? `<div class="nthumbs">${n.images.map((im, i) => `<button class="nthumb" data-act="noteView" data-arg="${n.id}|${i}" aria-label="Открыть скриншот ${i + 1}"><img src="${im.thumb}" alt=""></button>`).join('')}</div>` : ''}
      <div class="row nact"><button class="linkish" data-act="noteDone" data-arg="${n.id}">${n.done ? 'Вернуть в работу' : 'Сделано'}</button>
        ${UI.noteDel === n.id ? `<span class="small">Удалить?</span><button class="linkish danger" data-act="noteDel" data-arg="${n.id}">Да, удалить</button><button class="linkish" data-act="noteDelAsk">Нет</button>`
          : `<button class="linkish" data-act="noteDelAsk" data-arg="${n.id}">Удалить</button>`}</div></div>`).join('');
  return `<div class="card notes"><h3>Заметки: что доработать</h3>
    <div class="small muted">Пишите, что исправить или добавить, и прикладывайте скриншоты. Заметки хранятся на этом устройстве отдельно от игры. Чтобы передать их, нажмите «Поделиться» или «Скачать файлом».</div>
    <textarea id="noteText" data-act="noteText" placeholder="Например: в круге номинации не видно, кто уже голосовал">${esc(UI.noteText || '')}</textarea>
    ${pend ? `<div class="nthumbs">${pend}</div>` : ''}
    <div class="row"><label class="btn nfile">${NOTE_DRAFT.busy ? 'Обрабатываю…' : 'Добавить скриншоты'}<input type="file" accept="image/*" multiple data-act="noteFiles" hidden></label>
      <button class="btn primary" data-act="noteSave">Сохранить заметку</button></div>
    ${UI.noteMsg ? `<div class="note-ok">${esc(UI.noteMsg)}</div>` : ''}
    ${NOTES.length ? `<div class="row"><span class="small muted">Заметок: ${NOTES.length}${open !== NOTES.length ? `, в работе: ${open}` : ''}</span></div>
      <div class="row"><button class="btn" data-act="noteShare">Поделиться</button><button class="btn" data-act="noteExport">Скачать файлом</button><button class="btn" data-act="noteCopy">Скопировать текст</button></div>
      <div class="nlist">${list}</div>` : ''}</div>`;
}
// скриншот на весь экран (нажатие — закрыть)
function noteViewOverlay() {
  const v = UI.noteView, n = v && NOTES.find(x => x.id === v.id), im = n && (n.images || [])[v.i];
  if (!im) return '';
  return `<div class="ov noteov" data-act="noteView" role="dialog" aria-label="Скриншот"><img src="${im.full}" alt="Скриншот"><div class="shhint">Нажмите, чтобы закрыть</div></div>`;
}
// текст всех заметок (для копирования и «Поделиться»)
function notesPlain() {
  return NOTES.slice().reverse().map((n, i) => `${i + 1}. ${noteDate(n.created)}${n.ctx ? ' — ' + n.ctx : ''}${n.done ? ' [сделано]' : ''}\n${n.text || '(без текста)'}${(n.images || []).length ? `\nСкриншотов: ${n.images.length}` : ''}`).join('\n\n');
}
const noteFileName = ext => `Гримуар — заметки ${new Date().toISOString().slice(0, 10)}.${ext}`;
// один HTML-файл: текст и скриншоты внутри — удобно переслать целиком
function notesHtmlFile() {
  const items = NOTES.slice().reverse().map((n, i) => `<section><h2>${i + 1}. ${esc(noteDate(n.created))}${n.done ? ' — сделано' : ''}</h2>${n.ctx ? `<p class="ctx">${esc(n.ctx)}</p>` : ''}
    <p>${esc(n.text || '(без текста)').replace(/\n/g, '<br>')}</p>${(n.images || []).map((im, k) => `<img src="${im.full}" alt="Скриншот ${k + 1}">`).join('')}</section>`).join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Гримуар — заметки</title>
<style>body{font:16px/1.45 system-ui,sans-serif;max-width:760px;margin:0 auto;padding:16px;background:#F4EFE3;color:#1E1B18}h1{font-size:22px}h2{font-size:17px;margin:0 0 4px}
section{background:#FFFCF5;border:1px solid #DCD2BE;border-radius:10px;padding:12px;margin:12px 0}.ctx{color:#6A6257;font-size:14px;margin:0 0 6px}img{display:block;max-width:100%;margin:8px 0;border:1px solid #DCD2BE;border-radius:6px}</style></head>
<body><h1>Гримуар рассказчика — заметки: что доработать</h1>${items}</body></html>`;
}
const dataUrlFile = (url, name) => { const [h, b] = url.split(','), bin = atob(b), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new File([a], name, { type: h.slice(5, h.indexOf(';')) }); };
function downloadFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const noteMsg = t => { UI.noteMsg = t; render(); clearTimeout(noteMsg.timer); noteMsg.timer = setTimeout(() => { UI.noteMsg = ''; render(); }, 4000); };

// обработчики (подмешиваются в A из ui.js)
const NOTE_ACTS = {
  noteText: (a, el) => { UI.noteText = el.value; },
  noteFiles: async (a, el) => {
    const files = [...(el.files || [])]; el.value = ''; if (!files.length) return;
    NOTE_DRAFT.busy = true; render();
    for (const f of files) { try { NOTE_DRAFT.imgs.push(await noteImage(f)); } catch (e) { /* не картинка — пропускаем */ } }
    NOTE_DRAFT.busy = false; render();
  },
  noteImgDel: i => { NOTE_DRAFT.imgs.splice(+i, 1); render(); },
  noteSave: async () => {
    const text = (UI.noteText || '').trim();
    if (!text && !NOTE_DRAFT.imgs.length) { noteMsg('Напишите текст или добавьте скриншот'); return; }
    const n = { id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), created: Date.now(), text, done: false, ctx: noteContext(), images: NOTE_DRAFT.imgs.slice() };
    NOTES.unshift(n);
    if (!(await notePut(n))) { NOTES.shift(); noteMsg('Не удалось сохранить: на устройстве не хватает места. Удалите старые заметки или скриншоты.'); return; }
    UI.noteText = ''; NOTE_DRAFT.imgs = []; noteMsg('Заметка сохранена');
  },
  noteDone: async id => { const n = NOTES.find(x => x.id === id); if (!n) return; n.done = !n.done; await notePut(n); render(); },
  noteDelAsk: id => { UI.noteDel = id || null; render(); },
  noteDel: async id => { UI.noteDel = null; await noteDelete(id); render(); },
  noteView: arg => { if (UI.noteView) UI.noteView = null; else { const [id, i] = String(arg).split('|'); UI.noteView = { id, i: +i }; } render(); },
  noteCopy: async () => {
    try { await navigator.clipboard.writeText(notesPlain()); noteMsg('Текст заметок скопирован (скриншоты — через «Поделиться» или «Скачать файлом»)'); }
    catch (e) { noteMsg('Не получилось скопировать — используйте «Скачать файлом»'); }
  },
  noteExport: () => { downloadFile(noteFileName('html'), notesHtmlFile(), 'text/html'); noteMsg('Файл с заметками и скриншотами сохранён'); },
  noteShare: async () => {
    const text = notesPlain(), imgs = [];
    NOTES.slice().reverse().forEach((n, i) => (n.images || []).forEach((im, k) => imgs.push(dataUrlFile(im.full, `заметка-${i + 1}-скриншот-${k + 1}.jpg`))));
    const files = [new File([text], noteFileName('txt'), { type: 'text/plain' })].concat(imgs);
    try {
      if (navigator.canShare && navigator.canShare({ files })) await navigator.share({ title: 'Гримуар — заметки', files });
      else if (navigator.share) await navigator.share({ title: 'Гримуар — заметки', text });
      else { NOTE_ACTS.noteExport(); return; }
    } catch (e) { if (e && e.name !== 'AbortError') noteMsg('Не получилось поделиться — используйте «Скачать файлом»'); }
  },
};
notesLoad();
