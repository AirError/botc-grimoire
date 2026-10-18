'use strict';
/* Интерфейс карманного гримуара. Один render() перерисовывает экран из состояния игры S.
   Всё, что важно для партии, живёт в S (включая черновики выбора и незавершённую номинацию),
   поэтому отмена и перезагрузка страницы возвращают ровно то, что было на экране. */
const E = ENGINE;
let S = null;
// История для отмены: массив снимков состояния до каждого действия (паттерн History)
let HISTORY = [];
const HIST_MAX = 40;
const UI = { tab: 'game', open: null, notes: [], hideInactive: true, confirm: null, importText: '', customText: '', save: 'local', copied: '', killPid: null, killWhy: '', pickOpen: null, refQ: '', refScript: null, refOpen: null };

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const team = rid => rid && DATA.roles[rid] ? DATA.roles[rid].team : '';
const clone = o => JSON.parse(JSON.stringify(o));
const fmtInstr = t => esc(t).replace(/\*([^*]+)\*/g, '<b class="tok">$1</b>').replace(/:reminder:/g, '<span class="rem">●</span>');
const isGoodRole = rid => E.isGoodTeam(team(rid));

/* ------------------------------------------------------------ действия, история, автосохранение */
// Любое изменение партии идёт через act: снимок → изменение → автопропуск → сохранение → подсказка с отменой.
// С заката до следующего заката изменения, кроме шагов ночи, пишутся в запись ночи (E.recPatch) — чтобы правка выбора
// из журнала переиграла ночь и сохранила всё, что рассказчик делал потом. kind 'step' — шаг ночи (его пишет движок)
function act(fn, label, kind) {
  HISTORY.push({ s: JSON.stringify(S), label: label || '' });
  if (HISTORY.length > HIST_MAX) HISTORY.shift();
  const logLen = S.log.length, rp = S.rp && kind !== 'step' ? { id: S.rp.id, before: E.rpStrip(S) } : null;
  fn(S);
  if (rp && S.rp && S.rp.id === rp.id) E.recPatch(S, rp.before, logLen); // новая ночь началась — её запись чистая
  autoSkip(); S.updated = Date.now();
  const last = S.log.length > logLen ? S.log[S.log.length - 1].t : '';
  HISTORY[HISTORY.length - 1].label = label || last || 'изменение';
  persist(); render();
  toast('Готово: ' + HISTORY[HISTORY.length - 1].label, true);
}
function undo() {
  const h = HISTORY.pop(); if (!h) return;
  UI.edit = null; UI.editRes = null;
  S = JSON.parse(h.s); S.updated = Date.now();
  persist(); render(); toast('Отменено: ' + h.label, false);
}
// изменение черновика (выбор игроков до «Готово») — сохраняем без записи в историю
function draft(fn) { fn(S); S.updated = Date.now(); persist(); render(); }
// поля шага, в котором сейчас выбирают: текущий шаг ночи или шаг, который правят из журнала (UI.edit)
function curFields() {
  if (UI.edit) return E.stepInputs(UI.edit.spec, UI.edit.inp);
  const st = S.phase === 'night' && E.currentStep(S); if (!st || !S.draft) return [];
  return E.stepInputs(E.stepSpec(S, st), S.draft.inp);
}
// изменение выбора; bind — связанное поле подстраивается само (Прачка/Библиотекарь/Сыщик: роль ↔ игроки)
function inpDraft(key, fn) {
  const run = inp => { fn(inp); const f = curFields().find(x => x.key === key); if (f && f.bind) f.bind(inp); };
  if (UI.edit) { run(UI.edit.inp); UI.editRes = null; render(); } else draft(S => run(S.draft.inp));
}
function autoSkip() {
  if (!S || S.phase !== 'night' || !UI.hideInactive) return;
  let guard = 0;
  while (S.phase === 'night' && guard++ < 100) {
    const st = E.currentStep(S); if (!st) break;
    if (E.stepSpec(S, st).active) break;
    E.skipStep(S, 'auto');
  }
}

/* ------------------------------------------------------------ хранение: браузер (всегда) + облако claude.ai (если есть) */
const LS_KEY = 'botc-grimoire-v1', LS_HIST = 'botc-grimoire-history-v1';
let dbRef = null, saveTimer = null, saving = false, saveAgain = false;
function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* хранилище недоступно */ }
  if (S && S.result && typeof gameArchiveSoon === 'function') gameArchiveSoon(S); // игра окончена — в историю прошлых игр (archive.js)
  try { localStorage.setItem(LS_HIST, JSON.stringify(HISTORY)); }
  catch (e) { HISTORY = HISTORY.slice(-10); try { localStorage.setItem(LS_HIST, JSON.stringify(HISTORY)); } catch (e2) { /* место кончилось */ } }
  if (!dbRef) return;
  clearTimeout(saveTimer); saveTimer = setTimeout(flush, 900);
}
async function flush() {
  if (!dbRef) return;
  if (saving) { saveAgain = true; return; }
  saving = true; UI.save = 'busy'; paintSave();
  try { await dbRef.set({ state: JSON.stringify(S), savedAt: Date.now() }); UI.save = 'cloud'; }
  catch (e) { UI.save = 'local'; }
  saving = false; paintSave();
  if (saveAgain) { saveAgain = false; flush(); }
}
function paintSave() {
  const el = document.querySelector('.save'); if (!el) return;
  el.className = 'save ' + (UI.save === 'cloud' ? 'cloud' : UI.save === 'busy' ? 'busy' : '');
  el.title = UI.save === 'cloud' ? 'Сохранено в облаке и на устройстве' : UI.save === 'busy' ? 'Сохраняю…' : 'Сохранено на этом устройстве';
}
async function connectCloud() {
  try {
    if (!window.claude || !window.claude.use) return;
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    if (!db || !user) return;
    const id = await user.id(); if (!id) return;
    dbRef = db.collection('data/users/' + id).doc('current');
    const snap = await dbRef.get();
    if (snap.exists) {
      const remote = JSON.parse(snap.data().state);
      if (!S || (remote.updated || 0) > (S.updated || 0)) { S = upgrade(remote); render(); }
    }
    UI.save = 'cloud'; paintSave();
    if (S) persist();
  } catch (e) { UI.save = 'local'; paintSave(); }
}
// старые сохранения: добавляем новые поля
function upgrade(s) {
  s.fabled = s.fabled || [];
  if (s.day) { s.day.draft = s.day.draft || { by: null, on: null, voters: [], stage: 'pick', spy: false }; s.day.picks = s.day.picks || {}; s.day.exiled = s.day.exiled || []; }
  return s;
}

/* ------------------------------------------------------------ подсказка с отменой (над вкладками) */
let toastTimer = null;
function toast(text, withUndo) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.innerHTML = `<span class="tt">${esc(text)}</span>${withUndo ? '<button class="tu" data-act="undo" aria-label="Отменить">↶</button>' : ''}`;
  el.className = 'show';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

/* ------------------------------------------------------------ общие куски разметки */
const ico = (rid, align, cls) => {
  const set = typeof ICONS !== 'undefined' && rid && ICONS[rid];
  if (!set) return '';
  const v = (align || (isGoodRole(rid) ? 'good' : 'evil')) === 'evil' ? 'e' : 'g';
  return `<img class="${cls}" src="${set[v] || set.g}" alt="">`;
};
// в «Лунной гравюре» глифы шагов и дня — гравюрой (маска: днём чернила, ночью серебро), экраны победы — тушью
const ENGR_GLYPHS = ['dusk', 'dawn', 'minioninfo', 'demoninfo', 'nominate', 'vote', 'execute', 'dead'];
const art = (k, cls) => {
  if (typeof ART === 'undefined') return '';
  if (UI.skin === 'engr' && ENGR_GLYPHS.includes(k) && ART['c_g_' + k]) return `<span class="${cls} gm" aria-hidden="true" style="--m:var(--a-c-g-${k})"></span>`;
  if (UI.skin === 'engr' && (k === 'win_good' || k === 'win_evil') && ART['c_' + k]) k = 'c_' + k;
  // «Хэллоуин»: глифы — свои медальоны, экраны победы — свои (на светлом экране — умножением, белое уходит)
  if (UI.skin === 'hallow' && ENGR_GLYPHS.includes(k) && ART['h_g_' + k]) k = 'h_g_' + k;
  if (UI.skin === 'hallow' && (k === 'win_good' || k === 'win_evil') && ART['h_' + k]) k = 'h_' + k;
  return ART[k] ? `<img class="${cls}" src="${ART[k]}" alt="">` : '';
};
const roleLine = p => p.role ? `<span class="cr t-${team(p.role)}">${esc(E.rname(p.role))}${p.believes ? ' → ' + esc(E.rname(p.believes)) : ''}${E.isTraveller(p) ? ' · Странник' : ''}</span>` : '<span class="cr muted">без роли</span>';

// ядовитые капли: пьянство, отравление, Вортокс — информация может (или должна) быть ложной
// рисованная графика (art/cut, раздел 8 промптов) — если её нет в сборке, рисуем SVG и CSS
const HAS_ART = k => typeof ART !== 'undefined' && !!ART[k];
const DROP_D = 'M12 2C12 2 5 10.5 5 15a7 7 0 0 0 14 0C19 10.5 12 2 12 2Z';
const DROP_SVG = HAS_ART('poison_drop') ? `<img class="drop1" src="${ART.poison_drop}" alt="">`
  : `<svg class="drop1" viewBox="0 0 24 24" aria-hidden="true"><path d="${DROP_D}"/><circle cx="9.6" cy="15.2" r="1.7" class="gl"/></svg>`;
const DROPS_SVG = HAS_ART('poison_drop') ? `<span class="drops">${[1, 2, 3].map(i => `<img class="d${i}" src="${ART.poison_drop}" alt="">`).join('')}</span>`
  : `<svg class="drops" viewBox="0 0 46 26" aria-hidden="true"><path transform="translate(0 3) scale(.9)" d="${DROP_D}"/><path transform="translate(13 0) scale(1.08)" d="${DROP_D}"/><path transform="translate(29 7) scale(.72)" d="${DROP_D}"/></svg>`;
// потёки по верхнему краю «ядовитой» рамки
const DRIP_SVG = HAS_ART('poison_drips') ? '<span class="drip2" aria-hidden="true"></span>'
  : `<svg class="drip" viewBox="0 0 200 16" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0H200V3C192 3 191 9 188 9S185 3 178 3H132C126 3 126 14 121 14S116 3 110 3H66C61 3 61 8 58 8S55 3 50 3H22C17 3 17 11 13 11S9 3 4 3H0Z"/></svg>`;
// саван на иконке мёртвого — узкий вымпел сверху по центру с вырезом «ласточкин хвост», как в оригинальном Гримуаре
const SHROUD_SVG = HAS_ART('shroud') ? `<img class="shroud" src="${ART.shroud}" alt="">`
  : `<svg class="shroud" viewBox="0 0 40 64" aria-hidden="true"><defs><linearGradient id="shg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5E5C68"/><stop offset=".6" stop-color="#2E2D35"/><stop offset="1" stop-color="#17161B"/></linearGradient></defs>
  <path d="M3 0H37V58L20 47L3 58Z" fill="url(#shg)" stroke="#A9A6B4" stroke-width="1.4" stroke-linejoin="round"/>
  <path d="M12 3V50M28 3V50" stroke="#8E8B99" stroke-width="1" opacity=".5"/></svg>`;
// саван мёртвого; голос призрака не потрачен — толстый белый контур вокруг савана (потрачен — контура нет)
const shroudHtml = p => p.alive ? '' : SHROUD_SVG.replace('class="shroud"', `class="shroud${p.ghost ? ' vote' : ''}"`);
// запасные SVG, если рисованных значков нет в сборке
const MUG_SVG = `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7.5h11V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" fill="#E2A43A" stroke="#4A2E0C" stroke-width="1.4"/>
  <path d="M16 10.5h2a2.5 2.5 0 0 1 2.5 2.5v2a2.5 2.5 0 0 1-2.5 2.5h-2" fill="none" stroke="#4A2E0C" stroke-width="1.8"/>
  <path d="M4.3 8c-.2-2.3 1.6-3.8 3.4-3.3.7-1.5 2.6-2 3.9-1.1 1.3-.8 3.1-.3 3.7 1.1 1.9-.2 3 1.2 2.6 3.3Z" fill="#FFF8E8" stroke="#4A2E0C" stroke-width="1.2"/>
  <path d="M8.6 11.5v6.5M12.4 11.5v6.5" stroke="#B9761E" stroke-width="1.4" stroke-linecap="round"/></svg>`;
// пьянство — кружка (иконка Пьяницы), яд — капля, Безумец — его значок (вид искажения: E.distortion → kind)
// рисованная кружка пьянства (drunk_mug, раздел 8 промптов) — если её нет, иконка Пьяницы, потом SVG
const mugIcon = () => HAS_ART('drunk_mug') ? `<img class="mug1" src="${ART.drunk_mug}" alt="">` : (typeof ICONS !== 'undefined' && ICONS.drunk) ? ico('drunk', 'good', 'mug1') : MUG_SVG.replace('class="mark"', 'class="mug1"');
const offKind = off => /^пьян|^Пьяница|^Марионетка/.test(off || '') ? 'drunk' : off === 'Безумец' ? 'lunatic' : 'poison';
const distIcon = kind => kind === 'drunk' ? mugIcon() : kind === 'lunatic' ? ico('lunatic', 'good', 'mug1') : DROP_SVG;
const CROSS_SVG = `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2h4v6h6v4h-6v10h-4V12H4V8h6Z" fill="#F3D27A" stroke="#5A3E0A" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
// жетоны-напоминания, как в настоящем Гримуаре: кружок с иконкой роли, чей это жетон (Отравитель — «Отравлен», Монах — «Защищён»).
// role — роль по умолчанию (если жетон положен вручную и источник однозначен); у яда, пьянства и защиты источник берётся из жетона,
// а без источника — рисованный значок: i — номер на листе marks.png (prep_art.marks). red — красная полоска (ложная цель)
const MARK_DEFS = [
  { id: 'poison', t: 'Отравлен', d: 'Способность не работает. Иконка — кто отравил: Отравитель, Пукка, Вдова, Но Даши и др.' },
  { id: 'drunk', role: 'drunk', i: 0, svg: MUG_SVG, t: 'Пьян', d: 'Способность не работает. Всегда кружка; кто напоил (Моряк, Трактирщик, Придворный, Менестрель или сам Пьяница) — в подписи и карточке игрока' },
  { id: 'monk', role: 'monk', i: 1, svg: CROSS_SVG, t: 'Защита Монаха', d: 'Этой ночью Демон не может его убить' },
  { id: 'innkeeper', role: 'innkeeper', i: 2, svg: CROSS_SVG, t: 'Защита Трактирщика', d: 'Этой ночью не может умереть (казнь — может)' },
  { id: 'tealady', role: 'tealady', t: 'Защита Травницы', d: 'Оба живых соседа Травницы добрые — не может умереть никак (казнь, Ведьма, изгнание), кроме Ассасина' },
  { id: 'mad', role: 'cerenovus', i: 3, t: 'Безумие', d: 'Цереновус: завтра должен убеждать всех, что он — указанная роль' },
  { id: 'cursed', role: 'witch', i: 4, t: 'Проклятие Ведьмы', d: 'Если завтра номинирует — умрёт' },
  { id: 'safe', role: 'devilsadvocate', i: 5, t: 'Не умрёт при казни', d: 'Адвокат Дьявола' },
  { id: 'master', role: 'butler', i: 6, t: 'Хозяин Дворецкого', d: 'Дворецкий голосует, только если голосует хозяин' },
  { id: 'hasability', role: 'vigormortis', i: 7, t: 'Сохранил способность', d: 'Мёртвый, но способность работает: Вигормортис, Собиратель Костей' },
  { id: 'twin', role: 'eviltwin', i: 8, t: 'Близнец', d: 'Добрый близнец Злого Близнеца' },
  { id: 'grandchild', role: 'grandmother', i: 9, t: 'Внук Бабушки', d: 'Если его убьёт Демон, Бабушка умрёт тоже' },
  { id: 'herring', role: 'fortuneteller', i: 10, red: true, t: 'Ложная цель Гадалки', d: 'Красная полоска — ложная цель: для Гадалки определяется как Демон' },
  { id: 'shown', role: 'washerwoman', t: 'Показан Прачкой, Библиотекарем, Сыщиком', d: 'У него роль, которую показали; с красной полоской — второй игрок, ложная цель (или вся информация ложная)' },
  { id: 'chosen', role: 'exorcist', t: 'Выбран Экзорцистом', d: 'Следующей ночью Экзорцист не может выбрать его снова' },
  { id: 'guessused', role: 'damsel', t: 'Догадка о Девице использована', d: 'Приспешники больше не могут угадать Девицу' },
  { id: 'second', role: 'harpy', t: 'Второй игрок Гарпии', d: 'Первый выбранный завтра «помешан» на том, что этот игрок злой' },
  { id: 'know', role: 'widow', i: 11, t: 'Знает о Вдове', d: 'Знает, что Вдова в игре' },
  { id: 'lunch', role: 'cannibal', i: 12, t: 'Обед Каннибала', d: 'Каннибал получил способность этого казнённого' },
  { id: 'votes3', role: 'bureaucrat', i: 13, t: 'Голос за троих', d: 'Бюрократ: завтра его голос считается трижды' },
  { id: 'voteneg', role: 'thief', i: 14, t: 'Голос против', d: 'Вор: завтра его голос считается отрицательным' },
  { id: 'sober', role: 'barista', i: 15, t: 'Трезв и здоров', d: 'Бариста: до заката трезв, здоров и получает верную информацию' },
  { id: 'twice', role: 'barista', i: 16, t: 'Способность дважды', d: 'Бариста: этой ночью способность срабатывает дважды' },
  { id: 'bad', role: 'angel', i: 17, t: 'Что-то плохое', d: 'Ангел или Злой Библиотекарь: с ним случится что-то плохое' },
  { id: 'note', i: 18, t: 'Заметка рассказчика', d: 'Ваша пометка — текст виден в карточке игрока' },
];
const MARK = Object.fromEntries(MARK_DEFS.map(m => [m.id, m]));
// рисованный значок (без роли-источника): голос призрака, заметка, яд или пьянство без источника
const markArt = id => {
  const m = MARK[id]; if (!m) return '';
  if (id === 'poison') return DROP_SVG;
  return HAS_ART('mark' + m.i) ? `<img class="mark" src="${ART['mark' + m.i]}" alt="">` : (m.svg || `<span class="mark mtxt">${esc(m.t[0])}</span>`);
};
// жетон-напоминание: src — роль, положившая жетон (иначе роль по умолчанию, иначе рисованный значок); red — ложная цель (красная полоска)
const markIcon = (id, src, red) => {
  const m = MARK[id]; if (!m && !src) return '';
  // пьян — всегда кружка (иконка Пьяницы), кто бы ни напоил: Трактирщик, Моряк… (просьба пользователя 2026-10-14); кто — в подписи
  const r = id === 'drunk' ? 'drunk' : src && DATA.roles[src] ? src : m && m.role, fab = r && ['fabled', 'loric'].includes(team(r));
  const inner = r && typeof ICONS !== 'undefined' && ICONS[r] ? ico(r, fab ? 'good' : null, 'rti') : markArt(id);
  return `<span class="rtok ${red || (m && m.red) ? 'red' : ''}">${inner}</span>`;
};
// какой значок у жетона игрока: [id значка, роль-источник, ложная цель]
const tokMark = t => [t.k === 'poisoned' ? 'poison' : t.k === 'protected' ? (t.src === 'innkeeper' ? 'innkeeper' : 'monk') : t.k,
  t.k === 'bad' && !t.src ? ((S.fabled || []).includes('hellslibrarian') ? 'hellslibrarian' : 'angel') : t.src, !!t.wrong];
// подпись жетона: показанный Прачкой/Библиотекарем/Сыщиком — «Прачка: Повар» (ложная цель — с пометкой)
const shownTitle = t => `${E.rname(t.src)}: ${t.note && DATA.roles[t.note] ? E.rname(t.note) : '—'}${t.wrong ? ' — ложная цель' : ''}`;
// значки состояния игрока: яд и пьянство — только если способность правда не работает; остальные — по жетонам.
// [id, подсказка, роль-источник]; opts.noNotes — без заметок рассказчика (Гримуар для Шпиона и Вдовы)
function playerMarks(p, opts) {
  if (S.phase === 'setup' || !p.role) return [];
  const off = E.abilityOff(S, p) || '', tok = k => p.tokens.find(t => t.k === k && t.src) || p.tokens.find(t => t.k === k), out = [];
  const Off = off.charAt(0).toUpperCase() + off.slice(1);
  if (off && (tok('poisoned') || /отравлен/.test(off))) {
    const jinx = /джинкс: (.+)\)/.exec(off), ev = jinx && ['spy', 'widow'].find(r => E.rname(r) === jinx[1]);
    out.push(['poison', Off, tok('poisoned') ? tok('poisoned').src : ev || (/Но Даши/.test(off) ? 'nodashii' : null)]);
  }
  if (off && (tok('drunk') || p.role === 'drunk' || /пьян|Пьяница/.test(off))) out.push(['drunk', Off, tok('drunk') ? tok('drunk').src : p.role === 'drunk' ? 'drunk' : null]);
  // Безумец и Марионетка — свой значок (не «отравлен»): кем себя считает
  if (p.role === 'lunatic') out.push(['lunatic', `Безумец: считает себя ${E.rname(p.believes)}`, 'lunatic']);
  if (p.role === 'marionette') out.push(['marionette', `Марионетка: считает себя ${E.rname(p.believes)}`, 'marionette']);
  if (p.alive && E.teaLadyProtects(S, p)) out.push(['tealady', MARK.tealady.t, 'tealady']);
  for (const t of p.tokens) {
    const [id, src, red] = tokMark(t);
    if (['poisoned', 'drunk'].includes(t.k) || (opts && opts.noNotes && id === 'note') || (id !== 'shown' && out.some(x => x[0] === id && x[2] === src))) continue;
    if (!MARK[id] && !(src && DATA.roles[src])) continue;
    if (id === 'shown') { out.push([id, shownTitle(t), src, red]); continue; }
    // подпись: название жетона и чей он (если роль ещё не названа: «Защита Монаха», но «Голос за троих · Бюрократ»)
    const title = MARK[id] ? MARK[id].t : E.TOK_RU[t.k] || t.k, who = src && DATA.roles[src] ? E.rname(src) : '';
    out.push([id, title + (who && !title.toLowerCase().includes(who.slice(0, 4).toLowerCase()) ? ' · ' + who : '') + (t.note ? ': ' + t.note : ''), src, red]);
  }
  return out;
}
const markSpan = ([id, title, src, red]) => `<span class="rslot" title="${esc(title)}">${markIcon(id, src, red)}</span>`;
// Гримуар и ночной выбор игроков: значки слева и справа от иконки роли, по 2 в высоту с каждой стороны (порядок: левый верх, правый верх, левый низ, правый низ).
// Лишние — «+N» в последней ячейке (все жетоны — в карточке игрока)
function sideMarks(p) {
  const ms = playerMarks(p);
  const cells = ms.length <= 4 ? ms.map(markSpan) : ms.slice(0, 3).map(markSpan).concat(`<span class="rslot rmore" title="Ещё жетоны — в карточке игрока">+${ms.length - 3}</span>`);
  const col = k => `<span class="gside">${[cells[k], cells[k + 2]].filter(Boolean).join('')}</span>`;
  return [col(0), col(1)];
}
// справка по значкам Гримуара (кнопка «Значки» на вкладке)
function legendOverlay() {
  if (!UI.legend) return '';
  const row = (icon, t, d) => `<div class="lgrow"><span class="lgic">${icon}</span><span><b>${esc(t)}</b><span class="small muted">${esc(d)}</span></span></div>`;
  // только значки ролей этого сценария (и тех, кто в игре, Странников и Сказочников); яд, пьянство и заметка — всегда
  const here = new Set([...S.script.roles, ...(S.script.travellers || []), ...(S.fabled || []), ...S.players.map(p => p.role)]);
  const LG_ROLES = { drunk: ['drunk', 'sailor', 'innkeeper', 'courtier', 'minstrel', 'sweetheart', 'goon', 'philosopher', 'marionette'], shown: ['washerwoman', 'librarian', 'investigator'], hasability: ['vigormortis', 'bonecollector'], bad: ['angel', 'hellslibrarian'] };
  const marks = MARK_DEFS.filter(m => !m.role || (LG_ROLES[m.id] || [m.role]).some(r => here.has(r)));
  const shownSrc = LG_ROLES.shown.find(r => here.has(r)), ex = { poison: 'poisoner', drunk: 'drunk', shown: shownSrc };
  return `<div class="ov sheetov" role="dialog" aria-label="Значки Гримуара"><div class="sheetbg" data-act="legend"></div><div class="sheet">
    <div class="sheethead"><span></span><div class="sht"><div class="shp">Значки Гримуара</div></div><button class="btn sq" data-act="legend" aria-label="Закрыть">×</button></div>
    <div class="small muted">Кружок с иконкой роли — её жетон-напоминание, как в настоящем Гримуаре. Значки стоят слева и справа от иконки игрока, по два с каждой стороны. Здесь — значки ролей сценария «${esc(S.script.name)}».</div>
    <div class="lglist">
      ${row(shroudHtml({ alive: false, ghost: true }), 'Саван с белым контуром', 'Игрок мёртв, голос призрака ещё есть — может проголосовать один раз')}
      ${row(shroudHtml({ alive: false, ghost: false }), 'Саван без контура', 'Игрок мёртв, голос призрака потрачен')}
      ${marks.map(m => row(markIcon(m.id, ex[m.id]), m.t, m.d)).join('')}
      ${shownSrc ? row(markIcon('shown', shownSrc, true), 'Ложная цель', 'Второй игрок, которого показали Прачка, Библиотекарь или Сыщик (или вся их информация ложная)') : ''}
      ${row('<span class="rslot rmore lgmore">+2</span>', 'Ещё жетоны', 'Не поместились рядом с иконкой — все жетоны в карточке игрока')}
      ${row('<span class="gno lgno">3</span>', 'Номер', `Место за столом; номера идут ${dirName()}`)}
      ${row('<span class="lgbox good"></span>', 'Синяя рамка', 'Добрый игрок')}
      ${row('<span class="lgbox evil"></span>', 'Красная рамка', 'Злой игрок')}
    </div></div></div>`;
}
/* ---------- оформление: Basic (как было), «Лунная гравюра», «Витраж во тьме» — у каждого устройства своё (localStorage) ---------- */
const SKINS = [['basic', 'Basic'], ['engr', 'Лунная гравюра'], ['glass', 'Витраж во тьме'], ['hallow', 'Хэллоуин']];
const SKIN_KEY = 'botc-grimoire-skin';
function skinLoad() { try { const v = localStorage.getItem(SKIN_KEY); return SKINS.some(s => s[0] === v) ? v : 'basic'; } catch (e) { return 'basic'; } }
// значки вкладок (в Basic скрыты): контур, у .f — заливка выбранной вкладки в «Витраже», .k — детали поверх заливки
const TAB_ICO = {
  setup: '<path d="M7 3.5h10M7 20.5h10M8 3.5c0 4.6 4 5.4 4 8.5s-4 3.9-4 8.5M16 3.5c0 4.6-4 5.4-4 8.5s4 3.9 4 8.5"/>',
  day: '<circle class="f" cx="12" cy="12" r="4.3"/><path d="M12 2.6v2.5M12 18.9v2.5M2.6 12h2.5M18.9 12h2.5M5.4 5.4l1.8 1.8M16.8 16.8l1.8 1.8M5.4 18.6l1.8-1.8M16.8 7.2l1.8-1.8"/>',
  night: '<path class="f" d="M15.4 3.3a8.8 8.8 0 1 0 5.4 14.6A7.3 7.3 0 0 1 15.4 3.3z"/><path class="k" d="M7.6 8.6l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" stroke-width="1"/>',
  table: '<path class="f" d="M12 6.6C9.8 5.1 7 4.7 3.4 5.1v13.1c3.6-.4 6.4 0 8.6 1.5 2.2-1.5 5-1.9 8.6-1.5V5.1C17 4.7 14.2 5.1 12 6.6z"/><path class="k" d="M12 6.6v13.1"/>',
  log: '<path class="f" d="M6 3.4h9.3L19 7.1v13.5H6z"/><path class="k" d="M9 10h7M9 13.4h7M9 16.8h4.4"/>',
  roles: '<path class="f" d="M4 5.6c3.2-1.7 12.8-1.7 16 0 .3 7.7-3.3 13.6-8 13.6S3.7 13.3 4 5.6z"/><path class="k" d="M7.8 10.4c.9-.7 2-.7 2.8 0M13.4 10.4c.9-.7 2-.7 2.8 0M9.4 14.7c1.6 1.1 3.6 1.1 5.2 0"/>',
  menu: '<path class="f" d="M5.5 9.6l2.4 2.4-2.4 2.4-2.4-2.4zM12 9.6l2.4 2.4-2.4 2.4-2.4-2.4zM18.5 9.6l2.4 2.4-2.4 2.4-2.4-2.4z"/>',
};
const tabIco = k => UI.skin === 'engr' && HAS_ART('c_tab_' + k) ? `<span class="ti tim" aria-hidden="true" style="--m:var(--a-c-tab-${k})"></span>`
  : UI.skin === 'glass' && HAS_ART('d_tab_' + k) ? `<img class="ti tig" src="${ART['d_tab_' + k]}" alt="" aria-hidden="true">`
  : UI.skin === 'hallow' && HAS_ART('h_tab_' + k) ? `<img class="ti tig" src="${ART['h_tab_' + k]}" alt="" aria-hidden="true">` : `<svg class="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TAB_ICO[k]}</svg>`;
// картинка фазы над экраном ночи и дня: в гравюре — гравюра тушью (днём чернила, ночью серебро), в витраже ночью — ничего
function phaseArt(k) {
  if (UI.skin === 'engr' && HAS_ART('c_engr')) return `<div class="phase-wrap"><div class="skengr ${k === 'night' && HAS_ART('c_night') ? 'night' : ''}" role="img" aria-label="Городок под луной"></div></div>`;
  if (UI.skin === 'glass' && k === 'night') return '';
  if (UI.skin === 'hallow' && HAS_ART('h_header_' + k)) return `<div class="phase-wrap"><img class="phase-art hhead" src="${ART['h_header_' + k]}" alt=""></div>`;
  return `<div class="phase-wrap">${art(k, 'phase-art')}</div>`;
}
// заставка при запуске (кроме Basic): исчезает сама через 2 секунды или по нажатию
function splashHtml() {
  if (!UI.splash || UI.skin === 'basic') return '';
  // «Хэллоуин»: склеп под луной на весь экран, из-за него вылетают летучие мыши
  const bats = HAS_ART('h_bat_strip') ? [1, 2, 3, 4].map(() => `<i class="hsbat" aria-hidden="true">${hSprite('bat', 'hs-bat').html}</i>`).join('') : '';
  const pic = UI.skin === 'engr' ? art('c_frontis', 'spart') : UI.skin === 'hallow' ? art('h_splash', 'spart cover') + bats : art('d_rose', 'spart');
  const ph = S.phase === 'setup' ? 'подготовка' : S.phase === 'night' ? `ночь ${S.n}` : S.phase === 'day' ? `день ${S.n}` : 'игра окончена';
  return `<div class="splash" data-act="splashOff" role="dialog" aria-label="Гримуар рассказчика">${pic}
    <div class="spt"><div class="sptitle">Гримуар<br>рассказчика</div><div class="spsub">${esc(S.script.name)} · ${ph}</div><div class="sphint">Нажмите, чтобы продолжить</div></div></div>`;
}
// картинки для CSS — переменными (--a-…), чтобы не повторять data:-адреса в разметке; html.art-* включает рисованный вид
function artVars() {
  if (typeof ART === 'undefined') return;
  const keys = ['wall_bg', 'wall_edge', 'tablet', 'tablet_cracked', 'wall_glow', 'fx_open', 'fx_circle', 'poison_drips', 'poison_frame', 'drunk_foam', 'drunk_frame',
    'c_engr', 'c_night', 'c_dial', 'c_wreath', 'c_fl_short', 'c_fl_mid', 'c_fl_long', 'c_cor_tl', 'c_cor_tr', 'c_cor_bl', 'c_cor_br', 'd_rose']
    .concat(['day', 'night', 'setup', 'table', 'log', 'roles', 'menu'].map(k => 'c_tab_' + k), ENGR_GLYPHS.map(k => 'c_g_' + k), [...Array(24).keys()].map(i => 'rune' + i))
    // «Хэллоуин»: склеп, сундук, нечисть, свет и дым, украшения
    .concat(['h_crypt', 'h_ring', 'h_frame', 'h_chest_box', 'h_chest_lid', 'h_chest_open', 'h_bat_strip', 'h_raven_strip', 'h_wreath', 'h_spider', 'h_batline',
      'h_flame', 'h_burst', 'h_fog', 'h_web_tl', 'h_web_tr', 'h_candle3', 'h_pumpkin1', 'h_pumpkin3'],
      [1, 2, 3, 4, 5, 6].map(i => 'h_wisp' + i), [1, 2, 3, 4, 5, 6].map(i => 'h_soul' + i), [1, 2, 3, 4].map(i => 'h_smoke' + i), [1, 2, 3, 4].map(i => 'h_cflame' + i));
  const el = document.createElement('style'); el.id = 'artvars';
  el.textContent = `:root{${keys.filter(HAS_ART).map(k => `--a-${k.replace(/_/g, '-')}:url("${ART[k]}");`).join('')}--frame-slice:${(typeof ART_META !== 'undefined' && ART_META.frame_slice) || 0};--drunk-slice:${(typeof ART_META !== 'undefined' && ART_META.drunk_slice) || 0};}`;
  document.head.appendChild(el);
  const cl = document.documentElement.classList;
  cl.toggle('art-wall', HAS_ART('tablet') && HAS_ART('wall_bg')); cl.toggle('art-runes', HAS_ART('rune0')); cl.toggle('art-poison', HAS_ART('poison_frame')); cl.toggle('art-drunk', HAS_ART('drunk_frame'));
}

// выбор игроков — компактные квадратики: иконка роли (днём — номер места), имя; мёртвых тоже можно выбрать
function chipsPlayers(key, n, filter, selected, opts) {
  opts = opts || {};
  return '<div class="ptiles">' + S.players.map((p, i) => {
    const okp = filter(p), on = selected.includes(p.id);
    const icon = opts.noRole ? `<span class="seatno">${i + 1}</span>` : (p.role ? ico(p.role, p.align, 'pti') : `<span class="seatno">${i + 1}</span>`);
    const ghost = !p.alive && opts.ghost ? (p.ghost ? 'голос есть' : 'без голоса') : '';
    const sub = opts.noRole ? (ghost || (E.isTraveller(p) ? 'Странник' : '')) : [p.role ? E.rname(p.role) : '', ghost].filter(Boolean).join(' · ');
    // значки — слева и справа от иконки, как в Гримуаре
    const [l, r] = opts.noRole ? ['', ''] : sideMarks(p);
    return `<button class="ptile ${on ? 'on' : ''} ${p.alive ? '' : 'dead'}" data-act="${opts.act || 'pickP'}" data-arg="${key}|${p.id}|${n}" ${okp ? '' : 'disabled'} aria-pressed="${on}" aria-label="${esc(p.name)}${p.alive ? '' : ', мёртв'}${p.role && !opts.noRole ? ', ' + esc(E.rname(p.role)) : ''}">
      ${opts.noRole ? '' : `<span class="pno">${i + 1}</span>`}
      <span class="pmid">${l}<span class="pic">${icon}${shroudHtml(p)}</span>${r}</span><span class="pname">${esc(p.name)}</span>${sub ? `<span class="prole">${esc(sub)}</span>` : ''}${on ? '<span class="pck" aria-hidden="true">✓</span>' : ''}</button>`;
  }).join('') + '</div>';
}

// квадратики с именами (номинация, голосование, изгнание): одно нажатие выбирает, второе снимает выбор
// opts.order — свой порядок (голосование: от соседа номинированного по кругу, номинированный — последним)
function tiles(key, n, filter, selected, act, opts) {
  opts = opts || {};
  return '<div class="tiles">' + (opts.order || S.players).map(p => {
    const i = S.players.indexOf(p), ok = filter(p), on = selected.includes(p.id);
    const sub = [!p.alive ? (opts.ghost ? (p.ghost ? 'мёртв · голос' : 'мёртв · без голоса') : 'мёртв') : E.isTraveller(p) ? 'Странник' : '', opts.mark === p.id ? 'номинирован' : ''].filter(Boolean).join(' · ');
    return `<button class="tile ${on ? 'on' : ''} ${p.alive ? '' : 'dead'} ${opts.mark === p.id ? 'mark' : ''}" data-act="${act}" data-arg="${key}|${p.id}|${n}" ${ok ? '' : 'disabled'} aria-pressed="${on}">
      <span class="tn">${i + 1}</span><span class="tname">${esc(p.name)}</span>${sub ? `<span class="tsub">${sub}</span>` : ''}${on ? '<span class="tck" aria-hidden="true">✓</span>' : ''}</button>`;
  }).join('') + '</div>';
}
// направление номеров за столом: по часовой (1) или против (−1) — S.flags.seatDir, задаёт рассказчик в круге
const seatDir = () => S.flags.seatDir === 'ccw' ? -1 : 1;
const dirName = () => seatDir() > 0 ? 'по часовой' : 'против часовой';
// порядок голосования: голоса считают по часовой (вики), начиная с соседа номинированного, номинированный — последний.
// Номера идут против часовой — значит, по часовой это обратный порядок списка
function voteOrder(onId) {
  const ps = seatDir() > 0 ? S.players : S.players.slice().reverse(), k = ps.findIndex(p => p.id === onId);
  return k < 0 ? ps : ps.slice(k + 1).concat(ps.slice(0, k + 1));
}

/* показ игроку на весь экран: только жетоны, без остальной информации. screens: [{caption, items:[{role, align}], thumb}] */
// жетон: {label — кому (только на кнопке), caption — жетон информации, role, align, players — имена вместо «укажите», text — число/ДА/НЕТ, sub, thumb}
const plainRole = t => t.role && !t.players && !t.text && !t.sub && !t.thumb;
function tokenGroups(tokens) {
  const groups = [];
  for (const t of tokens || []) {
    if (!t || (t.role && !DATA.roles[t.role]) || (!t.role && !t.players && !t.text && !t.thumb)) continue;
    let g = groups.find(x => x.label === (t.label || ''));
    if (!g) groups.push(g = { label: t.label || '', screens: [] });
    const last = g.screens[g.screens.length - 1];
    // join — на тот же экран столбиком (Цереновус: его жетон и роль безумия сразу)
    if (t.join && last) { last.items.push(t); last.stack = true; continue; }
    // несколько ролей подряд под одним жетоном (блефы, Изгои, Сновидец) — на одном экране
    if (last && last.caption === (t.caption || '') && plainRole(t) && last.items.every(plainRole)) last.items.push(t);
    else if (t.thumb && !t.role && !t.players && !t.text) { g.screens.push({ caption: t.caption || (t.thumb === 'down' ? 'Вы злой' : 'Вы добрый'), thumb: t.thumb, items: [] }); continue; }
    else g.screens.push({ caption: t.caption || '', items: [t] });
    // жест «добрый/злой» — отдельным экраном после жетона (как в правилах: сначала жетон, потом палец вверх или вниз)
    if (t.thumb) g.screens.push({ caption: t.thumb === 'down' ? 'Вы злой' : 'Вы добрый', thumb: t.thumb, items: [] });
  }
  return groups;
}
// карточки для показа (рисованные таблички): фразу крупно пишет приложение в поле под медальоном
const CARD_ART = { 'ЭТО ДЕМОН': 'card_demon', 'ЭТО ВАШИ ПРИСПЕШНИКИ': 'card_minions', 'ЭТИХ РОЛЕЙ В ИГРЕ НЕТ': 'card_notinplay',
  'ТЕПЕРЬ ВЫ': 'card_youare', 'ОБЛАДАТЕЛЬ ЭТОЙ РОЛИ ВЫБРАЛ ВАС': 'card_selected', 'ЭТОТ ИГРОК': 'card_thisplayer', 'ВАША РОЛЬ': 'card_yourrole',
  'ДА': 'card_yes', 'НЕТ': 'card_no', 'ВЫ ДОБРЫЙ': 'card_good', 'ВЫ ЗЛОЙ': 'card_evil',
  // Генерал: кто ближе к победе (раздел 7 prompts_app.md; пока картинок нет — палец вверх / вниз / в сторону)
  'ДОБРО': 'card_general_good', 'ЗЛО': 'card_general_evil', 'НИЧЬЯ': 'card_general_neither' };
function cardHtml(text, thumb) {
  const key = CARD_ART[String(text).toUpperCase()];
  // «Хэллоуин»: рамка из костей и веток с паучком, эмблема карточки и надпись
  if (UI.skin === 'hallow' && HAS_ART('h_frame')) {
    const n = String(text).length, side = thumb ? (thumb === 'down' ? 'evil' : thumb === 'side' ? 'none' : 'good') : '';
    const em = 'h_em_' + (key ? key.replace('card_', '') : 'moon');
    return `<div class="shframe hframe ${side ? 'side-' + side : ''}" role="img" aria-label="${esc(text)}">${HAS_ART(em) ? `<img class="shem" src="${ART[em]}" alt="">` : ''}
      <span class="shft sz-${n <= 3 ? 'xl' : n <= 12 ? 'l' : 'm'}">${esc(text)}</span></div>`;
  }
  // «Лунная гравюра»: серебряная рамка с гравированными уголками, гравированная эмблема карточки и крупная надпись
  if (UI.skin === 'engr' && HAS_ART('c_cor_tl')) {
    const n = String(text).length, side = thumb ? (thumb === 'down' ? 'evil' : thumb === 'side' ? 'none' : 'good') : '';
    const em = 'c_em_' + (key ? key.replace('card_', '') : 'moon');
    return `<div class="shframe ${side ? 'side-' + side : ''}" role="img" aria-label="${esc(text)}">${['tl', 'tr', 'bl', 'br'].map(k => `<i class="shcor ${k}"></i>`).join('')}
      ${HAS_ART(em) ? `<img class="shem" src="${ART[em]}" alt="">` : ''}<span class="shft sz-${n <= 3 ? 'xl' : n <= 12 ? 'l' : 'm'}">${esc(text)}</span><i class="shfl"></i></div>`;
  }
  if (!HAS_ART(key)) return thumb ? `<div class="shthumb side-${thumb === 'down' ? 'evil' : thumb === 'side' ? 'none' : 'good'}"><span aria-hidden="true" class="${thumb === 'side' ? 'tside' : ''}">${thumb === 'down' ? '👎' : '👍'}</span>${esc(text)}</div>` : `<div class="shcap">${esc(text)}</div>`;
  const b = (typeof ART_META !== 'undefined' && ART_META.cards && ART_META.cards.box) || [0.03, 0.42, 0.97, 0.95];
  const n = String(text).length, sz = n <= 3 ? 'xl' : n <= 12 ? 'l' : 'm';
  return `<div class="shcard" role="img" aria-label="${esc(text)}"><img src="${ART[key]}" alt="">
    <div class="shct sz-${sz}" style="left:${b[0] * 100}%;top:${b[1] * 100}%;right:${(1 - b[2]) * 100}%;bottom:${(1 - b[3]) * 100}%"><span>${esc(text)}</span></div></div>`;
}
function showButtons(tokens) {
  const groups = tokenGroups(tokens); if (!groups.length) return '';
  // кнопки показа со всего экрана (шаг ночи и форма правки из журнала) — в одном списке, render() очищает его
  const base = (UI.showGroups = UI.showGroups || []).length; UI.showGroups.push(...groups);
  return `<div class="showbtns">${groups.map((g, i) => `<button class="btn showbtn" data-act="showOpen" data-arg="${base + i}">${art('eye', 'bg')}${g.label ? 'Показать: ' + esc(g.label) : 'Показать игроку на экране'}</button>`).join('')}</div>`;
}
// число — рисованными золотыми цифрами (если они есть в сборке), остальное — шрифтом
const numText = s => {
  s = String(s);
  if (/^\d{1,3}$/.test(s) && HAS_ART('digit0')) return `<div class="shdig" role="img" aria-label="${s}">${[...s].map(c => `<img src="${ART['digit' + c]}" alt="">`).join('')}</div>`;
  // --lw — самое длинное слово: шрифт не крупнее, чем нужно, чтобы слово влезло в строку целиком
  const lw = Math.max(4, ...s.split(/\s+/).map(w => w.length));
  return `<div class="shtext ${s.length <= 4 ? '' : s.length <= 12 ? 'long l1' : s.length <= 48 ? 'long l2' : 'long'}" style="--lw:${lw}">${esc(s)}</div>`;
};
// на экране показа есть и карточка (жетон информации, ДА/НЕТ), и роли/имена/числа
function showHasBoth(sc) {
  if (!sc) return false;
  const one = sc.items.length === 1, yn = !sc.caption && one && !sc.items[0].role && !sc.items[0].players && /^(ДА|НЕТ)$/.test(sc.items[0].text || '');
  return !!(sc.caption || yn) && sc.items.length > 0 && !yn;
}
function showOverlay() {
  const sh = UI.show; if (!sh) return '';
  const sc = sh.screens[sh.i]; if (!sc) return '';
  const one = sc.items.length === 1;
  const names = ids => `<div class="shpl">${(ids || []).map(id => { const p = E.P(S, id); return p ? `<span>${esc(p.name)}</span>` : ''; }).join('') || '<span>—</span>'}</div>`;
  // ответ «ДА»/«НЕТ» без жетона — сам становится карточкой
  const yn = !sc.caption && one && !sc.items[0].role && !sc.items[0].players && /^(ДА|НЕТ)$/.test(sc.items[0].text || '') ? sc.items[0].text : null;
  const roleBox = t => {
    const r = t.role && DATA.roles[t.role], al = t.align || (t.thumb === 'down' ? 'evil' : t.thumb === 'up' ? 'good' : (r && isGoodRole(t.role) ? 'good' : 'evil'));
    // способность — только когда игрок получает роль («ТЕПЕРЬ ВЫ», показ своей роли) или роль одна без имён и чисел
    const ab = r && one && !t.players && !t.text && (sc.caption === 'ТЕПЕРЬ ВЫ' || sc.caption === 'Ваша роль' || !sc.caption);
    // lead — надпись между ролью и именами («Эта роль — один из этих игроков:» — Прачка, Библиотекарь, Сыщик)
    return `<div class="shrole side-${al} ${t.small ? 'small' : ''}">${t.pre ? `<div class="shpre">${esc(t.pre)}</div>` : ''}${r ? `${ico(t.role, al, 'shic')}<div class="shname">${esc(E.rname(t.role))}</div>` : ''}${t.lead ? `<div class="shsub shlead">${esc(t.lead)}</div>` : ''}${t.players ? names(t.players) : ''}
      ${t.text ? numText(t.text) : ''}${t.sub ? `<div class="shsub">${esc(t.sub)}</div>` : ''}${ab ? `<div class="shab">${esc(r.ability)}</div>` : ''}</div>`;
  };
  const card = sc.caption ? cardHtml(sc.caption, sc.thumb) : yn ? cardHtml(yn) : '';
  const roles = sc.items.length && !yn ? `<div class="shroles ${sc.stack ? 'stack' : 'n' + Math.min(sc.items.length, 3)}">${sc.items.map(roleBox).join('')}</div>` : '';
  const hint = `<div class="shhint">${sh.i + 1 < sh.screens.length ? `Нажмите — дальше (${sh.i + 1} из ${sh.screens.length})` : 'Нажмите, чтобы закрыть'}</div>`;
  // кнопка поворота — отдельно от слоя показа (нажатие на слой листает дальше)
  const rot = `<button class="shrot" data-act="showLand" aria-label="${UI.showLand ? 'Показывать вертикально' : 'Показать горизонтально'}">${UI.showLand ? '↕' : '↔'}</button>`;
  // горизонтально: карточка — на весь экран, роли и имена — следующим экраном, крупно (просьба пользователя).
  // Телефон держат боком: если экран сам не повернулся (портрет), содержимое повёрнуто на 90° и растянуто на весь экран;
  // если повернулся (альбом) — без поворота (CSS @media orientation)
  if (UI.showLand) {
    const part = card && roles ? (sh.sub || 0) : null; // 0 — карточка, 1 — роли
    const more = sh.i + 1 < sh.screens.length || part === 0;
    const lhint = `<div class="shhint">${more ? 'Нажмите — дальше' : 'Нажмите, чтобы закрыть'}</div>`;
    return `<div class="ov showov land ${UI.showFlip ? 'flip' : ''}" data-act="showNext" role="dialog" aria-label="Показ игроку">
    <div class="shwrap">${card && part !== 1 ? `<div class="shmain">${card}</div>` : ''}${roles && part !== 0 ? `<div class="shside">${roles}</div>` : ''}${lhint}</div></div>${rot}
    <button class="shrot flipb" data-act="showFlip" aria-label="Перевернуть на 180°">⟲</button>`;
  }
  return `<div class="ov showov" data-act="showNext" role="dialog" aria-label="Показ игроку">${card}${roles}${hint}</div>${rot}`;
}
// роль игрока, которую он видит (Пьяница — кем себя считает, Безумец — своего «Демона»)
const seenRole = p => (p.role === 'drunk' || p.role === 'lunatic' || p.role === 'marionette') && p.believes ? p.believes : p.role;
// свёрнутый выбор: заголовок с текущим значением, по нажатию раскрывается список квадратиков
function pickRow(key, label, value, body) {
  const open = UI.pickOpen === key;
  return `<div class="pick"><button class="pickhead ${open ? 'open' : ''}" data-act="pickOpen" data-arg="${key}" aria-expanded="${open}">
    <span class="pl">${esc(label)}</span><span class="pv ${value ? '' : 'muted'}">${value ? esc(value) : 'выбрать'}</span><span class="pc" aria-hidden="true">${open ? '▴' : '▾'}</span></button>${open ? body : ''}</div>`;
}
// самономинация (заметка пользователя 2026-10-17): кнопка, когда выбран номинирующий, а кого — ещё нет (в круге повторное нажатие
// снимает выбор, поэтому нужна отдельная кнопка)
function selfNomBtn(nm, onOk, bishop) {
  const p = !bishop && nm.by && nm.by !== 'st' && !nm.on && E.P(S, nm.by);
  return p && onOk(p) ? `<button class="btn wide selfnom" data-act="nomSelf">${esc(p.name)} номинирует себя</button>` : '';
}
const confirmRow = (okAct, okLabel, okOn, noAct, noLabel) => `<div class="confirm"><button class="btn ok" data-act="${okAct}" ${okOn ? '' : 'disabled'}>${okLabel}</button><button class="btn no" data-act="${noAct}">${noLabel}</button></div>`;

function roleOptions(filter, selected, opts) {
  opts = opts || {};
  const pool = opts.pool || S.script.roles;
  const inScript = pool.filter(r => DATA.roles[r] && filter(r));
  const teams = opts.teams || ['townsfolk', 'outsider', 'minion', 'demon'];
  const groups = teams.map(t => {
    const rs = inScript.filter(r => team(r) === t);
    return rs.length ? `<optgroup label="${E.TEAM_RU[t] || ''}">${rs.map(r => `<option value="${r}" ${r === selected ? 'selected' : ''}>${esc(E.rname(r))}</option>`).join('')}</optgroup>` : '';
  }).join('');
  let extra = '';
  if (opts.all) {
    const rest = Object.keys(DATA.roles).filter(r => !pool.includes(r) && filter(r) && ['townsfolk', 'outsider', 'minion', 'demon'].includes(team(r)));
    if (rest.length) extra = `<optgroup label="Не в сценарии">${rest.map(r => `<option value="${r}" ${r === selected ? 'selected' : ''}>${esc(E.rname(r))}</option>`).join('')}</optgroup>`;
  }
  return `<option value="">${opts.placeholder || '— выберите —'}</option>` + groups + extra;
}
// список ролей группами от движка — только то, что можно показать (группы с подписями «В игре», «Нет в игре — ложная…»)
function roleGroupOptions(groups, selected, placeholder) {
  const gs = groups.filter(g => g.roles.length), all = gs.flatMap(g => g.roles);
  if (selected && !all.includes(selected)) gs.push({ label: 'Выбрано раньше', roles: [selected] });
  return `<option value="">${placeholder || '— выберите —'}</option>` + gs.map(g => `<optgroup label="${esc(g.label)}">${g.roles.map(r => `<option value="${r}" ${r === selected ? 'selected' : ''}>${esc(E.rname(r))}</option>`).join('')}</optgroup>`).join('');
}
const plainOptions = (ids, selected, placeholder) => `<option value="">${placeholder || '— выберите —'}</option>` + ids.map(r => `<option value="${r}" ${r === selected ? 'selected' : ''}>${esc(E.rname(r))}</option>`).join('');

function fieldHtml(f, inp) {
  const v = inp[f.key] || (f.type === 'role' ? f.def : undefined); // def — роль, выбранная по умолчанию (Сновидец)
  if (f.type === 'players') {
    const sel = v || [], ringOk = S.phase === 'night' && S.players.length >= 3;
    // ночью — выбор квадратиками или кругом (как сидят за столом); выбор запоминается на устройстве (просьба пользователя 2026-10-14)
    const tog = ringOk ? `<button class="linkish pickmode" data-act="pickMode">${UI.pickRing ? '▦ Плиткой' : '◯ Кругом'}</button>` : '';
    return `<div class="field"><div class="flabel"><span>${esc(f.label)}</span><span>${tog} ${sel.length}/${f.n > 50 ? '…' : f.n}</span></div>${UI.pickRing && ringOk ? ringPick(f.key, f.n, f.filter, sel) : chipsPlayers(f.key, f.n, f.filter, sel)}</div>`;
  }
  if (f.type === 'role') return `<div class="field"><label>${esc(f.label)}</label><select data-act="pickR" data-arg="${f.key}">${f.groups ? roleGroupOptions(f.groups, v, f.optional ? '— не выбирать —' : undefined)
    : roleOptions(r => f.filter(r), v, { all: f.all, placeholder: f.optional ? '— не выбирать —' : undefined })}</select></div>`;
  if (f.type === 'note') return `<div class="warn">${esc(f.label)}</div>`; // пометка без выбора (Мэр под защитой — рикошета нет)
  if (f.type === 'choice') return `<div class="field"><label>${esc(f.label)}</label><div class="seg">${f.options.map(o => `<button class="${(v ?? f.def) === o.v ? 'on' : ''}" data-act="pickC" data-arg="${f.key}|${o.v}">${esc(o.l)}</button>`).join('')}</div></div>`;
  if (f.type === 'number') { const nv = v ?? f.def ?? 0;
    return `<div class="field"><label>${esc(f.label)}</label><div class="stepper"><button class="btn" data-act="num" data-arg="${f.key}|-1|${nv}">−</button><b>${nv}</b><button class="btn" data-act="num" data-arg="${f.key}|1|${nv}">+</button></div></div>`; }
  if (f.type === 'text') return `<div class="field"><label for="tx-${f.key}">${esc(f.label)}</label><textarea id="tx-${f.key}" data-act="pickT" data-arg="${f.key}">${esc(v)}</textarea>${f.ideas ? ideaChips(f.ideas, 'pickIdea', f.key, 'Идеи') : ''}</div>`;
  return '';
}

// слова рассказчика на рассвет: вариант закреплён за ночью, «другой вариант» листает по кругу
function morningHtml(withNext) {
  const names = E.nightDeaths(S).map(d => `<b>${esc(E.nm(S, d.pid))}</b>`);
  // снова живы этой ночью (Профессор, Аль-Адихия…) — свои тексты: «кто-то ожил» и «смерти и воскрешение» (заметка 2026-10-16)
  const back = (S.night.revived || []).filter(id => E.P(S, id) && E.P(S, id).alive).map(id => `<b>${esc(E.nm(S, id))}</b>`);
  const seed = [...(S.id + ':' + S.n)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const m = morningText(names, S.n === 1, S.night.data.morn ?? seed, back);
  return `<div class="tale"><div class="lab">Слова для утра</div><p>${m.text}</p>
    ${withNext ? `<button class="linkish" data-act="mornNext" data-arg="${m.i}">Другой вариант · ${m.i + 1} из ${m.total}</button>` : ''}</div>`;
}
function boundsHtml(list) {
  return `<div class="bounds"><div class="lab">Рамки выбора</div>${list.map(b => `<div><b>${esc(b.w)}:</b> ${esc(b.t)}</div>`).join('')}</div>`;
}
function situationHtml() { return E.situation(S).map(w => `<div class="warn">${esc(w)}</div>`).join(''); }
// день: подсказки о положении в игре и итоги последнего действия — свёрнуты в одну кнопку, по нажатию — окно со всеми
// (просьба пользователя 2026-10-12). «новое» — есть итог последнего действия (он пропадает после следующего действия)
function dayStatusBtn() {
  const n = E.situation(S).length + (UI.notes || []).length; if (!n) return '';
  return `<button class="btn statbtn ${(UI.notes || []).length ? 'fresh' : ''}" data-act="statOpen"><span class="sti" aria-hidden="true">!</span>
    <span>Состояния и подсказки</span>${(UI.notes || []).length ? '<span class="stnew">новое</span>' : ''}<b>${n}</b></button>`;
}
function statOverlay() {
  if (!UI.stat || S.phase !== 'day') return '';
  const sit = E.situation(S), notes = UI.notes || [], warns = a => a.map(t => `<div class="warn">${esc(t)}</div>`).join('');
  return `<div class="ov editres" role="dialog" aria-label="Состояния и подсказки"><div class="statbg" data-act="statClose"></div><div class="erbox statbox">
    <h3>Состояния и подсказки</h3>
    ${notes.length ? `<div class="lab">После последнего действия</div>${warns(notes)}` : ''}
    ${sit.length ? `${notes.length ? '<div class="lab">В игре сейчас</div>' : ''}${warns(sit)}` : ''}
    ${!notes.length && !sit.length ? '<div class="muted">Сейчас ничего особенного.</div>' : ''}
    <button class="btn wide" data-act="statClose">Закрыть</button></div></div>`;
}
const notesHtml = () => (UI.notes || []).map(t => `<div class="warn">${esc(t)}</div>`).join('');

/* Странники и Сказочники — общие для подготовки и «Гримуара» */
// Странники, рекомендованные сценарием, — первыми
function travellerOptions() {
  const free = DATA.travellers.filter(r => !S.players.some(p => p.role === r)), rec = (S.script.travellers || []).filter(r => free.includes(r));
  const opt = r => `<option value="${r}">${esc(E.rname(r))}</option>`;
  if (!rec.length) return plainOptions(free, null, '— роль Странника —');
  return `<option value="">— роль Странника —</option><optgroup label="Из сценария">${rec.map(opt).join('')}</optgroup><optgroup label="Остальные">${free.filter(r => !rec.includes(r)).map(opt).join('')}</optgroup>`;
}
function travellerForm() {
  const pos = S.players.map(p => `<option value="${p.id}">после ${esc(p.name)}</option>`).join('');
  return `<details class="addbox"><summary>${art('traveller', 'hg')}Добавить Странника</summary><div class="field">
    <input type="text" id="trName" placeholder="Имя игрока" aria-label="Имя Странника">
    <select id="trRole" aria-label="Роль Странника">${travellerOptions()}</select>
    <div class="flabel"><span>Сторону выбирает рассказчик</span></div>
    <div class="seg"><button class="${S.flags._trAlign === 'evil' ? '' : 'on'}" data-act="trAlign" data-arg="good">Добрый</button><button class="${S.flags._trAlign === 'evil' ? 'on' : ''}" data-act="trAlign" data-arg="evil">Злой</button></div>
    <select id="trPos" aria-label="Место в круге">${pos}<option value="" selected>в конец круга</option></select>
    <button class="btn" data-act="trAdd">Добавить в круг</button></div></details>`;
}
function fabledZone() {
  const list = (S.fabled || []).map(id => `<div class="fab"><span class="ci-wrap">${ico(id, 'good', 'ci')}</span><div class="ct"><b>${esc(E.rname(id))}</b><div class="small">${esc(DATA.roles[id].ability)}</div></div>
    <button class="btn" data-act="fabDel" data-arg="${id}" aria-label="Убрать ${esc(E.rname(id))}">×</button></div>`).join('');
  return `<div class="card fabzone"><h3 class="hi">${art('fabled', 'hg')}Сказочники — вне круга</h3><div class="small muted">Персонажи рассказчика: без жизни и смерти, видны всем.</div>
    ${list || '<div class="small muted">Пока нет</div>'}
    <select id="fabAdd" data-act="fabAdd" aria-label="Добавить Сказочника">${plainOptions(DATA.fabled.filter(r => !(S.fabled || []).includes(r)), null, '— добавить Сказочника —')}</select></div>`;
}

/* ------------------------------------------------------------ экраны */
// сценарий — выпадающим списком (решение пользователя: везде списком)
function scriptSelect() {
  const groups = [['Ваши сценарии', ['ecbe', 'blindhunt']], ['Базовая коробка', ['tb', 'bmr', 'snv']], ['Сообщество', ['catfishing', 'reptiles2', 'oasis', 'pies', 'uncertain']]];
  const known = new Set(groups.flatMap(g => g[1])), rest = Object.keys(DATA.scripts).filter(k => !known.has(k));
  const opt = k => `<option value="${k}" ${S.script.key === k ? 'selected' : ''}>${esc(DATA.scripts[k].name)}</option>`;
  return `<select class="scriptsel" data-act="script" aria-label="Сценарий">${S.script.key === 'custom' ? `<option value="custom" selected>Свой: ${esc(S.script.name)}</option>` : ''}
    ${groups.map(([l, ks]) => `<optgroup label="${l}">${ks.filter(k => DATA.scripts[k]).map(opt).join('')}</optgroup>`).join('')}${rest.length ? `<optgroup label="Другие">${rest.map(opt).join('')}</optgroup>` : ''}</select>`;
}
// роль игрока: только из сценария и без повторов (роль другого игрока выбрать нельзя)
const freeRole = p => r => !S.players.some(q => q !== p && q.role === r);
// случайная раздача и жребий: во время жребия и после него раздать заново нельзя
function dealButtons() {
  const d = S.draw;
  if (d && d.finished) return '<div class="note-ok">Роли выданы жребием (стена). Заново не раздаются; роль можно сменить только на роль сценария, которой нет в игре.</div>';
  if (d) return '<div class="small muted">Идёт жребий (карточка «Выдача ролей» выше): роли закреплены за игроками — случайная раздача недоступна.</div>';
  const prob = E.drawProblem(S);
  return `<div class="row"><button class="btn" data-act="deal">${E.validPool(S) ? 'Раздать выбранные роли случайно' : 'Раздать роли случайно'}</button><button class="btn" data-act="drawStart" ${prob ? 'disabled' : ''}>Жребий: ${cryptOn() ? 'склеп' : 'каменная стена'}</button></div>
    ${prob && S.pool && S.pool.length ? `<div class="small muted">${esc(prob)}</div>` : ''}`;
}
// подсказки (ideas.js): нажатие подставляет текст в поле
const ideaChips = (list, act, key, title) => typeof IDEAS === 'undefined' || !IDEAS[list] ? '' : `<details class="ideas"><summary class="small">${esc(title)} (${IDEAS[list].length})</summary>
  <div class="idealist">${IDEAS[list].map((t, i) => `<button class="idea" data-act="${act}" data-arg="${key}|${list}|${i}">${esc(t)}</button>`).join('')}</div></details>`;
const amnIdeas = pid => ideaChips('AMNESIAC', 'amnIdea', pid, 'Идеи способностей');

function viewSetup() {
  const sc = S.script, core = S.players.filter(p => !E.isTraveller(p)), n = core.length;
  const presets = scriptSelect();
  const counts = ['townsfolk', 'outsider', 'minion', 'demon'].map(t => `${E.TEAM_RU[t]}: ${sc.roles.filter(r => team(r) === t).length}`).join(' · ');
  // порядок мест — перетаскиванием за ручку ⠿ (зажать и тянуть)
  const players = S.players.map((p, i) => `<div class="row prow-edit ${E.isTraveller(p) ? 'is-tr' : ''}" data-row="${p.id}" style="flex-wrap:nowrap">
      <span class="drag" data-drag="${p.id}" role="button" aria-label="Перетащить: изменить место" title="Зажмите и перетащите">⠿</span>
      <span class="muted small" style="width:20px">${i + 1}</span>
      <input type="text" id="pn-${p.id}" value="${esc(p.name)}" data-act="rename" data-arg="${p.id}" aria-label="Имя игрока ${i + 1}">
      <button class="btn sq danger" data-act="delP" data-arg="${p.id}" aria-label="Удалить">×</button></div>`).join('');
  let roles = '';
  if (n >= 5 && n <= 15) {
    const d = E.setupDistribution(S);
    const rowsD = E.distCheck(d, E.countTeams(S)).map(x => `<tr><td class="t-${x.t}">${E.TEAM_RU[x.t]}</td><td class="${x.bad ? 'bad' : ''}">${x.have} из ${x.want}</td></tr>`).join('');
    // роли, у которых число Изгоев выбирает рассказчик: Крёстный Отец, Аэронавт, Привратник
    const MOD_RU = { '-1': '−1 Изгой', 0: 'без изменений', 1: '+1 Изгой' };
    const choices = d.choices.map(c => `<div class="field ${c.value === null ? 'ask' : ''}"><label>${esc(E.rname(c.id))}: ${c.value === null ? 'выберите, сколько Изгоев' : 'Изгоев'}</label>
      <div class="seg">${c.opts.map(v => `<button class="${c.value === v ? 'on' : ''}" data-act="outMod" data-arg="${c.id}|${v}">${MOD_RU[v]}</button>`).join('')}</div></div>`).join('');
    const odd = E.unknownSetup(S);
    roles = `<div class="card"><h3>Роли</h3><table class="dist">${rowsD}</table>${choices}${d.notes.length ? `<div class="small muted">${d.notes.map(esc).join('<br>')}</div>` : ''}
      ${odd.length ? `<div class="warn">Раскладку с ролями ${odd.map(E.rname).map(esc).join(', ')} проверьте сами: в приложении нет её правил, поэтому начать игру оно не мешает. Механику этих ролей ведёте вы — в справочнике есть подсказки.</div>` : ''}
      ${dealButtons()}
      ${S.players.map(p => {
        const side = !p.role ? 'none' : (E.isTraveller(p) ? p.align : (isGoodRole(p.role) ? 'good' : 'evil'));
        return `<div class="field rolepick side-${side}"><label><span>${esc(p.name)}</span><span>${side === 'good' ? 'добрый' : side === 'evil' ? 'злой' : ''}</span></label>
        ${E.isTraveller(p) ? `<div class="small">${esc(E.rname(p.role))} — Странник</div>` : `<select data-act="setRole" data-arg="${p.id}" ${S.draw && !S.draw.finished ? 'disabled' : ''}>${roleOptions(freeRole(p), p.role, { placeholder: E.drawLocked(S) ? '— роль выдана стеной —' : undefined })}</select>`}
        ${p.role === 'drunk' || p.role === 'marionette' ? `<select data-act="setBelieves" data-arg="${p.id}">${roleOptions(r => (team(r) === 'townsfolk' || (p.role === 'marionette' && team(r) === 'outsider')) && !S.players.some(q => q.role === r) && !S.bluffs.includes(r), p.believes, { placeholder: '— кем себя считает (не блеф) —' })}</select>` : ''}
        ${p.role === 'lunatic' ? `<select data-act="setBelieves" data-arg="${p.id}">${roleOptions(r => team(r) === 'demon', p.believes, { placeholder: '— каким Демоном себя считает —' })}</select>` : ''}
      </div>`; }).join('')}</div>`;
  } else if (n > 15) roles = '<div class="warn">Больше 15 игроков: лишние должны быть Странниками.</div>';
  const notIn = r => E.canBluff(r) && !S.players.some(p => p.role === r || p.believes === r); // без Пьяницы и Безумца
  const goodPl = core.filter(p => p.role && isGoodRole(p.role));
  const pickSel = (act, label, cur, list) => `<div class="field"><label>${label}</label><select data-act="${act}"><option value="">—</option>${list.map(p => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)} (${esc(E.rname(p.role))})</option>`).join('')}</select></div>`;
  const prep = n >= 5 && S.players.every(p => p.role) ? `<div class="card"><h3>Подготовка</h3>
      <div class="field"><label>Блефы Демона: 3 добрые роли, которых нет в игре</label>
      ${[0, 1, 2].map(i => `<select data-act="bluff" data-arg="${i}">${roleOptions(r => r === S.bluffs[i] || (notIn(r) && !S.bluffs.some((b, j) => j !== i && b === r)), S.bluffs[i])}</select>`).join('')}</div>
      ${S.players.some(p => p.role === 'drunk') || (S.pool || []).includes('drunk') ? (() => { // Пьяница — кто из Горожан (заметки 2026-10-15); не в игре — блока нет (2026-10-16)
        const cur = S.players.find(p => p.role === 'drunk'), cand = core.filter(p => p === cur || E.realTeam(p) === 'townsfolk');
        return `<div class="field"><label>Пьяница — кто из Горожан на самом деле Пьяница (будет считать себя своей ролью)</label>
          <select data-act="setDrunk"><option value="">— Пьяницы нет —</option>${cand.map(p => `<option value="${p.id}" ${p === cur ? 'selected' : ''}>${esc(p.name)} (${esc(E.rname(p === cur ? p.believes : p.role))})</option>`).join('')}</select>
          <div class="small muted">${cur ? 'Выберите другого — прежний Пьяница получит роль, которой себя считал: раскладка не изменится.' : 'Пьяница — Изгой: Горожан станет на 1 меньше, Изгоев на 1 больше.'}</div></div>`; })() : ''}
      ${S.players.some(p => p.role === 'grandmother') ? pickSel('setFlag-grandchild', 'Внук Бабушки', S.flags.grandchild, goodPl.filter(p => p.role !== 'grandmother')) : ''}
      ${S.players.some(p => p.role === 'fortuneteller') ? pickSel('setFlag-ftHerring', 'Ложная цель Гадалки (добрый игрок)', S.flags.ftHerring, goodPl) : ''}
      ${S.players.some(p => p.role === 'eviltwin') ? pickSel('setFlag-goodTwin', 'Добрый близнец', S.flags.goodTwin, goodPl) : ''}
      ${S.players.some(p => p.role === 'puzzlemaster') ? pickSel('setFlag-puzzleDrunk', 'Головоломщик: кто пьян всю игру (вики: почти всегда лучше Горожанин; сам игрок не знает)', S.flags.puzzleDrunk, core.filter(p => p.role && p.role !== 'puzzlemaster')) : ''}
      ${S.flags.marionetteNeed || S.players.some(p => p.role === 'marionette') ? (() => { // Марионетка: сосед Демона с доброй ролью (вики)
        const cur = S.players.find(p => p.role === 'marionette'), cand = E.demonSeatNeighbours(S).filter(p => p.role && (isGoodRole(p.role) || p === cur));
        return `<div class="field ${cur ? '' : 'ask'}"><label>Марионетка — кто из соседей Демона ею станет (он будет считать себя своей ролью, как Пьяница)</label>
          <select data-act="setMarionette"><option value="">— выберите —</option>${cand.map(p => `<option value="${p.id}" ${cur && p.id === cur.id ? 'selected' : ''}>${esc(p.name)} (${esc(E.rname(p === cur ? p.believes : p.role))})</option>`).join('')}</select>
          ${cand.length ? '' : '<div class="small muted">У Демона нет соседей с доброй ролью — пересадите игроков или назначьте роли.</div>'}</div>`; })() : ''}
      ${S.players.filter(p => p.role === 'amnesiac').map(p => `<div class="field"><label for="amn-${p.id}">Способность Амнезиака (${esc(p.name)}) — придумайте сами, игрок её не узнает</label>
        <textarea id="amn-${p.id}" data-act="amnText" data-arg="${p.id}" placeholder="Например: каждую ночь узнаёт, сколько живых Горожан среди его соседей">${esc(S.flags['amnesiac_' + p.id] || '')}</textarea>${amnIdeas(p.id)}</div>`).join('')}
      <button class="btn" data-act="autoPrep">Заполнить случайно</button></div>` : '';
  const probs = E.setupProblems(S), jinx = E.jinxesInPlay(S);
  const exp = sc.roles.filter(r => DATA.roles[r] && !DATA.roles[r].box);
  return `${notesHtml()}<div class="card"><h3>Сценарий</h3>${presets}<div class="small muted">«${esc(sc.name)}» — ${counts}</div>
      ${exp.length ? `<div class="small muted">Не из базовой коробки (жетонов нет, механику ведёте вы): ${exp.map(E.rname).map(esc).join(', ')}</div>` : ''}
      ${(S.fabled || []).length ? `<div class="small muted">Сказочники сценария: ${S.fabled.map(E.rname).map(esc).join(', ')}</div>` : ''}
      <details><summary class="small">Загрузить свой сценарий (JSON из конструктора)</summary>
      <div class="field" style="margin-top:8px"><textarea id="customJson" data-act="customText" placeholder='[{"id":"_meta","name":"Мой сценарий"},"washerwoman","imp"]'>${esc(UI.customText)}</textarea>
      <button class="btn" data-act="customLoad">Загрузить</button></div></details></div>
    <div class="card"><div class="row ghead"><h3>Игроки по кругу (${dirName()})</h3>${S.players.length > 1 ? '<button class="btn ringbtn" data-act="ringSeat">◯ Кругом</button>' : ''}</div>${players || '<div class="muted small">Добавьте игроков в порядке, в котором они сидят.</div>'}
      <div class="row" style="flex-wrap:nowrap"><input type="text" id="newName" placeholder="Имя игрока" aria-label="Имя нового игрока"><button class="btn" data-act="addP">Добавить</button></div>
      <details><summary class="small">Вставить список имён</summary><div class="field" style="margin-top:8px"><textarea id="bulkNames" placeholder="Аня, Борис, Вика…"></textarea><button class="btn" data-act="bulk">Заменить список</button></div></details>
      ${travellerForm()}</div>
    ${(n >= 5 && n <= 15) || S.draw ? drawCard() : ''}
    ${rolesHidden() ? rolesCurtain() : roles + prep}${fabledZone()}
    ${jinx.length ? `<div class="card"><h3>Джинксы</h3>${jinx.map(j => `<div class="small"><b>${esc(E.rname(j.a))} и ${esc(E.rname(j.b))}:</b> ${esc(j.text)}</div>`).join('')}</div>` : ''}
    ${probs.length ? `<div class="warn">${rolesHidden() ? 'Подготовка не закончена — покажите роли, чтобы увидеть, что осталось.' : probs.map(esc).join('<br>')}</div>` : ''}
    <button class="btn primary wide" data-act="start" ${probs.length ? 'disabled' : ''}>Начать игру: первая ночь</button>`;
}

function stepDraft(st, spec) {
  const key = S.n + ':' + S.night.i + ':' + st.key;
  if (!S.draft || S.draft.key !== key) S.draft = { key, inp: clone(spec.defaults || {}) };
  return S.draft.inp;
}

// блок ответа; при яде/Вортоксе — зелёная «ядовитая» рамка с каплями, при пьянстве — янтарная с кружками, Безумец — своя
// (просьба пользователя 2026-10-14: «рамочка и статус для пьянства по аналогии с отравлением»; «Безумец выглядит как отравленный»)
function revealHtml(info, dist) {
  const kind = dist ? dist.kind || 'poison' : '';
  const icons = kind === 'drunk' ? `<span class="mugs">${[1, 2, 3].map(() => mugIcon()).join('')}</span>` : kind === 'lunatic' ? `<span class="mugs">${ico('lunatic', 'good', 'mug1')}</span>` : DROPS_SVG;
  const say = dist && dist.vortox ? 'информация Горожан должна быть ЛОЖНОЙ' : kind === 'lunatic' ? 'он не Демон: всё понарошку, Демон узнает его выбор' : 'информацию можно исказить';
  const tag = dist ? `<div class="ptag">${icons}<b>${esc(dist.label)}</b><span>${say}</span></div>` : '';
  const top = kind === 'poison' ? DRIP_SVG : kind === 'drunk' && HAS_ART('drunk_foam') ? '<span class="foam2" aria-hidden="true"></span>' : '';
  return `<div class="reveal ${info.secret ? 'secret' : ''} ${dist ? 'poison k-' + kind : ''}">${top}${tag}
    <div class="lab">${info.secret ? 'Только для вас — не показывайте' : 'Покажите / объявите'}</div>${info.show ? `<div class="big">${esc(info.show)}</div>` : ''}${info.show2 ? `<div class="big alive">${esc(info.show2)}</div>` : ''}
    ${(info.lines || []).filter(Boolean).map(l => `<div class="ln">${esc(l)}</div>`).join('')}
    ${info.grim ? `<div class="showbtns"><button class="btn showbtn" data-act="grimShow">${art('eye', 'bg')}Показать Гримуар на весь экран</button>
      <div class="small muted">Закрыть Гримуар — только невидимой кнопкой в <b>левом нижнем углу</b> экрана: игрок сам его не закроет. Его собственная отметка «отравлен / пьян» на экране не видна.</div>
      ${dist ? `<button class="btn showbtn" data-act="grimFake">${art('eye', 'bg')}Показать искажённый Гримуар</button>
        <div class="small muted">Пьяному или отравленному можно дать ложную информацию (вики, «Пьян»): роли добрых перемешаны, часть заменена ролями сценария того же типа, отметки состояний переезжают вместе с ролью; его место, Демон и Приспешники (злые знают друг друга), саваны и Странники — как есть.${S.night.data.fakeGrim ? ' <button class="linkish" data-act="grimFakeNew">Перемешать заново</button>' : ''}</div>` : ''}</div>` : ''}${info.secret ? '' : showButtons(info.tokens)}</div>`;
}

// цвет шага — по стороне игрока, а не по типу роли: Адвокат Дьявола, ставший добрым после обмена Цирюльника, — синий
// (заметка пользователя 2026-10-15). Шаг «Марионетка» — Демону, его цвет — по роли
const stepAlign = st => { const p = st.pid && !st.fakeCannibal && st.id !== 'marionette' && E.P(S, st.pid); return p && !E.isTraveller(p) ? p.align : null; };
const alignTeam = (t, al) => !al || !t ? t : al === 'good' && (t === 'minion' || t === 'demon') ? 'townsfolk' : al === 'evil' && (t === 'townsfolk' || t === 'outsider') ? 'minion' : t;
const stepIcon = (st, cls) => st.pid ? ico(st.fakeCannibal ? 'cannibal' : st.id, stepAlign(st), cls) : st.fabled ? ico(st.id, 'good', cls) : art(st.id, cls);
function viewNight() {
  const st = E.currentStep(S); if (!st) return '';
  const spec = E.stepSpec(S, st), inp = stepDraft(st, spec);
  const total = S.night.steps.length, i = S.night.i;
  const fields = spec.active ? E.stepInputs(spec, inp) : [];
  const missing = spec.active ? E.missingInputs(spec, inp) : [];
  let info = null; try { info = spec.active ? spec.info(inp) : null; } catch (e) { info = null; }
  const goon = spec.active ? E.goonWarn(S, st, spec, inp) : null;
  const next = S.night.steps.slice(i + 1, i + 5).map(s => `<div>${s.pid ? stepIcon(s, 'ui') : ''}${esc(s.meet ? 'Злые знакомятся' : s.fakeCannibal ? 'Каннибал — отравлен' : E.rname(s.id))}${s.pid ? ` <span>· ${esc(E.nm(S, s.pid))}</span>` : ''}</div>`).join('');
  const back = (S.night.revived || []).filter(id => E.P(S, id) && E.P(S, id).alive);
  const deaths = (E.nightDeaths(S).length ? `<div class="small"><b>Умерли этой ночью:</b> ${E.nightDeaths(S).map(d => esc(E.nm(S, d.pid))).join(', ')}</div>` : '')
    + (back.length ? `<div class="small"><b>Снова жив:</b> ${back.map(id => esc(E.nm(S, id))).join(', ')}</div>` : '');
  const icon = stepIcon(st, 'si');
  return `${phaseArt('night')}<div class="progress"><i style="width:${Math.round(100 * i / total)}%"></i></div>
    ${situationHtml()}${deaths}
    <div class="card ${spec.active ? '' : 'inactive'}">
      <div class="steprole">${icon}<span class="rn t-${alignTeam(spec.team, stepAlign(st)) || ''}">${esc(spec.title)}</span>${spec.who ? `<span class="who">${esc(spec.who)}</span>` : ''}${spec.active && spec.dist ? `<span class="ppill k-${spec.dist.kind || 'poison'}">${distIcon(spec.dist.kind)}${esc(spec.dist.label)}</span>` : ''}</div>
      ${spec.text ? `<div class="instr">${fmtInstr(spec.text)}</div>` : ''}
      ${spec.active ? '' : `<div class="warn">Не просыпается: ${esc(spec.reason)}</div>`}
      ${spec.active && spec.bounds && spec.bounds.length ? boundsHtml(spec.bounds) : ''}
      ${(spec.warn || []).map(w => `<div class="warn">${esc(w)}</div>`).join('')}
      ${fields.map(f => fieldHtml(f, inp)).join('')}
      ${goon ? `<div class="warn">${esc(goon)}</div>` : ''}
      ${info && (info.show || (info.lines || []).filter(Boolean).length) ? revealHtml(info, spec.dist) : ''}
      ${st.id === 'dawn' ? morningHtml(true) : ''}
      ${missing.length ? `<div class="small muted">Осталось выбрать: ${missing.map(esc).join('; ')}</div>` : ''}
      <div class="actions"><button class="btn primary" data-act="stepDone" ${missing.length ? 'disabled' : ''}>${spec.active ? 'Готово' : 'Дальше'}</button>
        <button class="btn" data-act="stepSkip">Пропустить</button></div>
    </div>
    ${next ? `<div class="card"><h3>Дальше этой ночью</h3><div class="upnext">${next}</div></div>` : ''}
    ${killFormHtml()}`;
}

function viewDay() {
  const d = S.day, th = E.voteThreshold(S), blk = E.block(S), alive = E.aliveCount(S), picks = d.picks || (d.picks = {});
  const nm = d.draft || (d.draft = { by: null, on: null, voters: [], stage: 'pick', spy: false });
  const parts = [];
  parts.push(phaseArt('day'));
  parts.push(`<div class="card"><div class="row"><h2>День ${S.n}</h2><span class="muted">живых ${E.aliveAll(S)} · для казни нужно ${th}</span></div>
    ${S.night && E.nightDeaths(S).length ? `<div class="small">Ночью умерли: ${E.nightDeaths(S).map(x => esc(E.nm(S, x.pid))).join(', ')}</div>` : '<div class="small muted">Ночью никто не умер</div>'}
    ${S.night && (S.night.revived || []).some(id => E.P(S, id) && E.P(S, id).alive) ? `<div class="small">Снова жив: ${S.night.revived.filter(id => E.P(S, id) && E.P(S, id).alive).map(id => esc(E.nm(S, id))).join(', ')}</div>` : ''}
    ${S.night ? `<details><summary class="small">Слова для утра</summary>${morningHtml(false)}</details>` : ''}
    ${dayStatusBtn()}</div>`);
  // Амнезиак: раз в день приватно угадывает свою способность
  for (const a of S.players.filter(p => p.role === 'amnesiac' && p.alive)) {
    const done = (d.amnesiac || {})[a.id], ab = S.flags['amnesiac_' + a.id];
    parts.push(`<div class="card"><h3>Амнезиак</h3>
      ${boundsHtml([{ w: 'Игрок', t: 'раз в день приватно угадывает, какая у него способность' }, { w: 'Вы отвечаете', t: '«Холодно» — совсем не то, «Тепло» — в верную сторону, «Горячо» — очень близко, «В точку» — угадал (даже другими словами)' }])}
      <div class="small"><b>Его способность:</b> ${ab ? esc(ab) : '<span class="muted">не задана — впишите на подготовке или ночью на шаге Амнезиака</span>'}</div>
      ${done ? `<div class="note-ok">Сегодня: ${done.guess ? `«${esc(done.guess)}» — ` : ''}${esc(E.AMNESIAC_ANSWERS[done.answer])}</div>`
        : `<textarea data-act="amnGuessText" data-arg="${a.id}" placeholder="Догадка игрока (необязательно)" aria-label="Догадка Амнезиака">${esc(picks['amnGuess_' + a.id] || '')}</textarea>
      <div class="seg">${Object.entries(E.AMNESIAC_ANSWERS).map(([k, l]) => `<button data-act="amnAnswer" data-arg="${a.id}|${k}">${esc(l)}</button>`).join('')}</div>`}</div>`);
  }
  // Савант: раз в день приватно — 2 факта, один правда, другой ложь (подбор из текущей игры — ideas.js)
  // (выбор старых версий мог набрать больше — в запись идут первый верный и первый ложный, savOneEach)
  // на экране дня — без пометок «правда / ложь» (их видно в Журнале → «Факты Саванта»); факты можно показать на весь экран
  // (заметка пользователя 2026-10-16). Факты сказаны — записываются, и сегодня Саванту больше не подбираются
  for (const sv of S.players.filter(p => p.role === 'savant' && p.alive)) {
    const pair = picks['sav_' + sv.id], off = E.abilityOff(S, sv), told = (S.flags.savantFacts || []).some(x => x.n === S.n && x.pid === sv.id);
    parts.push(`<div class="card"><h3>Савант</h3>
      ${boundsHtml([{ w: 'Игрок', t: 'раз в день может прийти к вам: приватно — 2 факта, один правда, другой ложь' }, { w: 'Вы решаете', t: off ? `Савант ${off}: можно оба правдой или оба ложью` : 'какие факты; Демона прямо не называйте' }])}
      ${told ? '<div class="note-ok">Сегодня факты уже сказаны — они в Журнале («Факты Саванта»).</div>' : `
      ${pair ? `<div class="reveal"><div class="lab">Скажите Саванту</div>${pair.map((x, i) => `<div class="ln savln"><b>${esc(x.text)}</b><button class="savdel" data-act="savDel" data-arg="${sv.id}|${i}" aria-label="Убрать факт">✕</button></div>`).join('')}
        ${showButtons(pair.map(x => ({ label: 'Саванту', text: x.text })))}</div>` : ''}
      <div class="row"><button class="btn" data-act="savGoList">Выбрать из списка</button><button class="btn" data-act="savGen" data-arg="${sv.id}">${pair ? 'Другие случайные' : 'Подобрать случайно'}</button>${pair ? `<button class="btn primary" data-act="savLog" data-arg="${sv.id}">Сказано — записать</button>` : ''}</div>
      <details class="savown"${picks['savOwn_' + sv.id] ? ' open' : ''}><summary class="small">Добавить свой факт</summary>
        <textarea data-act="savOwnText" data-arg="${sv.id}" placeholder="Например: «Отравитель сидит не дальше 3 мест от вас»" aria-label="Свой факт для Саванта">${esc(picks['savOwn_' + sv.id] || '')}</textarea>
        <div class="row"><button class="btn" data-act="savOwn" data-arg="${sv.id}|1">Правдивый</button><button class="btn" data-act="savOwn" data-arg="${sv.id}|0">Ложный</button></div>
        <div class="small muted">Свой факт заменит подобранный той же правдивости, второй подберётся сам. «Другие случайные» свой факт не трогают, убрать — ✕.</div></details>`}</div>`);
  }
  // Рыбак: раз за игру днём — совет, что делать (ideas.js)
  for (const fm of S.players.filter(p => p.role === 'fisherman' && p.alive && !S.flags['fishUsed_' + p.id])) {
    const list = picks['fish_' + fm.id], sel = picks['fishSel_' + fm.id], off = E.abilityOff(S, fm);
    parts.push(`<div class="card"><details ${list ? 'open' : ''}><summary class="small"><b>Рыбак</b> — раз за игру совет, как победить</summary><div class="field" style="margin-top:8px">
      ${boundsHtml([{ w: 'Вы решаете', t: off ? `Рыбак ${off}: можно дать плохой совет` : 'совет о том, что ДЕЛАТЬ, а не что ЕСТЬ; Демона прямо не называйте' }])}
      ${list ? `<div class="idealist">${list.map((t, i) => `<button class="idea ${sel === t ? 'on' : ''}" data-act="fishPick" data-arg="${fm.id}|${i}">${esc(t)}</button>`).join('')}</div>` : ''}
      <div class="row"><button class="btn" data-act="fishGen" data-arg="${fm.id}">${list ? 'Другие советы' : 'Подобрать советы'}</button>${sel ? `<button class="btn primary" data-act="fishUse" data-arg="${fm.id}">Совет дан</button>` : ''}</div></div></details></div>`);
  }
  // Мецефель: первый добрый, произнёсший тайное слово, ночью станет злым
  const mez = S.players.find(p => p.role === 'mezepheles');
  if (mez && S.flags.mezWord && !S.flags.mezUsed) {
    const tgt = S.flags.mezTarget && E.P(S, S.flags.mezTarget);
    parts.push(`<div class="card"><details ${tgt ? '' : ''}><summary class="small"><b>Мецефель:</b> тайное слово «${esc(S.flags.mezWord)}»${tgt ? ` — произнёс ${esc(tgt.name)}` : ''}</summary><div class="field" style="margin-top:8px">
      ${tgt ? `<div class="note-ok">${esc(tgt.name)} первым из добрых произнёс слово — ночью станет злым (если Мецефель будет трезв и здоров).</div><button class="btn" data-act="mezClear">Отменить отметку</button>`
        : `<div class="flabel"><span>Кто из добрых первым произнёс слово (вы должны услышать сами)</span></div>${chipsPlayers('mez', 1, p => p.align === 'good' && p.id !== mez.id, [], { act: 'mezPick', noRole: true })}`}</div></details></div>`);
  }
  // публичный выбор (Дитя Луны, Растяпа, Истребитель) — кнопкой; выбирают на круге с именами, без ролей и значков:
  // экран дня могут увидеть игроки (просьба пользователя 2026-10-12)
  for (const [flag, label, actName] of [['moonchildPending', 'Дитя Луны выбирает живого игрока', 'moonchild'], ['klutzPending', 'Растяпа выбирает живого игрока', 'klutz']]) {
    if (!S.flags[flag]) continue;
    const t = (picks[actName] || [])[0] && E.P(S, picks[actName][0]);
    parts.push(`<div class="card"><h3>${label}</h3>${boundsHtml([{ w: 'Выбирает игрок', t: 'публично, 1 живого игрока' }])}
      ${t ? `<div class="small">Выбран: <b>${esc(t.name)}</b></div>` : ''}${pickRingBtn(actName, '', !!t)}
      ${t ? `<button class="btn primary wide" data-act="${actName}">Записать выбор</button>` : ''}</div>`);
  }
  // Психопат (вики): раз в день, до номинаций, публично выбирает игрока — тот умирает (заметка пользователя 2026-10-14: «нет кнопки»)
  for (const ps of S.players.filter(p => E.actsAs(p) === 'psychopath' && p.alive && !(d.psychoUsed || {})[p.id] && !d.nominated.length)) {
    const t = (picks['psycho_' + ps.id] || [])[0] && E.P(S, picks['psycho_' + ps.id][0]);
    parts.push(`<div class="card"><details ${t ? 'open' : ''}><summary class="small"><b>Психопат</b> публично выбирает игрока — тот умирает (до номинаций)</summary><div class="field" style="margin-top:8px">
      ${boundsHtml([{ w: 'Игрок', t: 'объявляет себя Психопатом и публично выбирает 1 игрока; раз в день, только до начала номинаций; может не пользоваться' }])}
      ${t ? `<div class="small">Выбран: <b>${esc(t.name)}</b></div>` : ''}${pickRingBtn('psycho', ps.id, !!t)}
      ${t ? `<button class="btn danger wide" data-act="psychoKill" data-arg="${ps.id}">Психопат убивает ${esc(t.name)}</button>` : ''}</div></details></div>`);
  }
  for (const s of S.players.filter(p => E.actsAs(p) === 'slayer' && p.alive && !S.flags['slayerUsed_' + p.id])) { // и Философ со способностью Истребителя
    const t = (picks['slay_' + s.id] || [])[0] && E.P(S, picks['slay_' + s.id][0]);
    parts.push(`<div class="card"><h3>Истребитель</h3>${boundsHtml([{ w: 'Игрок выбирает', t: 'публично, 1 игрока, раз за игру' }])}
      ${t ? `<div class="small">Цель: <b>${esc(t.name)}</b></div>` : ''}${pickRingBtn('slay', s.id, !!t)}
      ${t ? `${slayRegHtml(t)}<button class="btn danger wide" data-act="slay" data-arg="${s.id}">Выстрел</button>` : ''}</div>`);
  }
  // Девица: Приспешник публично называет игрока Девицей — одна догадка на всех Приспешников за игру (вики)
  if (S.players.some(p => p.role === 'damsel') && !S.flags.damselGuessUsed) {
    const by = picks.dgBy || [], on = picks.dgOn || [];
    parts.push(`<div class="card"><details ${by.length || on.length ? 'open' : ''}><summary class="small"><b>Девица:</b> Приспешник публично угадывает, кто Девица</summary><div class="field" style="margin-top:8px">
      ${boundsHtml([{ w: 'Игрок', t: 'Приспешник, публично; одна догадка на всех Приспешников за игру — неверная тратит её. Демон, притворяющийся Приспешником, не считается' },
        { w: 'Итог', t: 'угадал живую Девицу (её способность работает) — победа зла' }])}
      <div class="flabel"><span>Какой Приспешник угадывает</span></div>${chipsPlayers('dgBy', 1, p => E.realTeam(p) === 'minion', by, { act: 'dayPick', noRole: true })}
      <div class="flabel"><span>Кого он называет Девицей</span></div>${chipsPlayers('dgOn', 1, () => true, on, { act: 'dayPick', noRole: true })}
      <button class="btn danger" data-act="damselGuess" ${by.length && on.length ? '' : 'disabled'}>Записать догадку</button></div></details></div>`);
  }
  // Головоломщик (вики): раз за игру угадывает, кто пьян из-за него; вы приватно называете одно имя (Blind Hunt, 2026-10-15)
  for (const pm of S.players.filter(p => p.role === 'puzzlemaster' && p.alive && !S.flags['puzzleUsed_' + p.id])) {
    const st = pmState(pm);
    parts.push(`<div class="card"><details ${st.g ? 'open' : ''}><summary class="small"><b>Головоломщик</b> — раз за игру угадывает, кто пьян</summary><div class="field" style="margin-top:8px">
      ${boundsHtml([{ w: 'Игрок', t: 'публично или приватно называет игрока, которого считает пьяным из-за Головоломщика' },
        { w: 'Вы', t: 'приватно называете одно имя: угадал — Демона, не угадал — любого игрока, который не Демон. Угадал ли — не говорите' }])}
      <div class="flabel"><span>Кого он назвал пьяным</span></div>${chipsPlayers('pmg_' + pm.id, 1, () => true, st.g ? [st.g] : [], { act: 'dayPick', noRole: true })}
      ${st.g ? `<div class="reveal secret"><div class="lab">Только для вас</div><div class="ln">${st.hit ? (st.off ? `Угадал, но Головоломщик ${esc(st.off)}: можно назвать кого угодно` : 'Угадал — назовите Демона') : 'Не угадал — назовите любого игрока, который не Демон'}</div></div>
        <div class="flabel"><span>Какое имя назвать</span></div>${chipsPlayers('pmt_' + pm.id, 1, p => st.hit || st.off ? true : !E.isDemon(p), st.told ? [st.told] : [], { act: 'dayPick', noRole: true })}
        ${st.told ? showButtons([{ label: 'Головоломщику', players: [st.told] }]) : ''}
        <button class="btn primary" data-act="pmGuess" data-arg="${pm.id}" ${st.told ? '' : 'disabled'}>Записать догадку</button>` : ''}</div></details></div>`);
  }
  // Безумие (вики): Цереновус и Уродец — нарушил, можно казнить (казнь за день, потом ночь); Гарпия — убить одного или обоих
  const madOf = src => S.players.filter(p => p.tokens.some(t => t.k === 'mad' && t.src === src));
  const madC = madOf('cerenovus'), madH = madOf('harpy'), mutants = S.players.filter(p => p.role === 'mutant' && p.alive && !E.abilityOff(S, p));
  if (madC.length || madH.length || mutants.length) {
    const exeOk = !d.executed, tok = (p, src) => p.tokens.find(t => t.k === 'mad' && t.src === src);
    const exeBtn = (p, src, label) => `<button class="btn danger" data-act="madExe" data-arg="${p.id}|${src}" ${exeOk ? '' : 'disabled'}>${label}</button>`;
    const rows = [
      ...madC.map(p => `<div class="madrow"><div><b>${esc(p.name)}</b> — помешан на роли «${esc(tok(p, 'cerenovus').note || '')}» (Цереновус)</div>${exeBtn(p, 'cerenovus', 'Не помешан — казнить')}</div>`),
      ...mutants.map(p => `<div class="madrow"><div><b>Уродец</b></div>${exeBtn(p, 'mutant', 'Внушает, что он Изгой, — казнить')}</div>`),
      ...madH.map(p => { const b = E.P(S, tok(p, 'harpy').by);
        return `<div class="madrow"><div><b>${esc(p.name)}</b> — помешан на том, что ${esc(b ? b.name : '?')} злой (Гарпия)</div>
          <div class="seg"><button data-act="harpyKill" data-arg="${p.id}">Умирает ${esc(p.name)}</button>${b ? `<button data-act="harpyKill" data-arg="${b.id}">Умирает ${esc(b.name)}</button><button data-act="harpyKill" data-arg="${p.id},${b.id}">Умирают оба</button>` : ''}</div></div>`; })];
    parts.push(`<div class="card"><details><summary class="small"><b>Безумие</b> нарушено? — решение рассказчика</summary><div class="field" style="margin-top:8px">
      ${boundsHtml([{ w: 'Цереновус, Уродец', t: 'не изображал безумие — можете казнить. Это казнь за день: после неё сразу ночь; если сегодня уже казнили — нельзя' },
        { w: 'Гарпия', t: 'первый не «помешан», что второй злой, — можете убить одного, обоих или никого (это смерть, не казнь)' }])}
      ${rows.join('')}${exeOk ? '' : '<div class="small muted">Сегодня казнь уже была — казнить за безумие больше нельзя</div>'}</div></details></div>`);
  }
  // Стрелок: сразу после подсчёта 1-го голосования может застрелить проголосовавшего (раз в день)
  for (const g of S.players.filter(p => p.role === 'gunslinger' && p.alive)) {
    if (d.gunUsed || !d.noms.length) continue;
    const first = d.noms[0], sel = picks.gun || [];
    parts.push(`<div class="card"><h3>Стрелок</h3>${boundsHtml([{ w: 'Игрок выбирает', t: `сразу после подсчёта 1-го голосования (за ${E.nm(S, first.on)}) — 1 проголосовавшего: тот умирает. Раз в день` }])}
      ${chipsPlayers('gun', 1, p => p.alive && first.voters.includes(p.id), sel, { act: 'dayPick', noRole: true })}
      <div class="row"><button class="btn danger" data-act="gunShoot" data-arg="${g.id}" ${sel.length ? '' : 'disabled'}>Выстрел</button><button class="btn" data-act="gunSkip">Стрелок не стреляет сегодня</button></div></div>`);
  }
  // Механик может умереть в любой момент — по решению рассказчика
  for (const t of S.players.filter(p => p.role === 'tinker' && p.alive))
    parts.push(`<div class="card"><details><summary class="small"><b>Механик</b> может умереть в любой момент</summary><div class="field" style="margin-top:8px">
      ${boundsHtml([{ w: 'Вы решаете', t: 'днём — объявите смерть сразу; не заканчивайте этим игру' }])}<button class="btn danger" data-act="tinkerDie" data-arg="${t.id}">Механик умирает сейчас</button></div></details></div>`);
  // Сказочник Фаталист: живой игрок раз за игру требует смерти игрока своей стороны
  if ((S.fabled || []).includes('doomsayer') && alive >= 4) {
    const by = (picks.doomBy || [])[0], a = by && E.P(S, by), vic = picks.doomV || [];
    parts.push(`<div class="card"><details><summary class="small"><b>Фаталист:</b> игрок требует смерти игрока своей стороны</summary><div class="field" style="margin-top:8px">
      ${boundsHtml([{ w: 'Игрок', t: 'живой, раз за игру, публично (пока живы 4 и больше)' }, { w: 'Вы решаете', t: 'кто из живых игроков его стороны умирает; Демона — только если игра продолжится' }])}
      <div class="flabel"><span>Кто требует</span></div>${chipsPlayers('doomBy', 1, p => p.alive && !E.isTraveller(p) && !S.flags['doomUsed_' + p.id], by ? [by] : [], { act: 'dayPick', noRole: true })}
      ${a ? `<div class="flabel"><span>Кто умирает (${a.align === 'good' ? 'добрые' : 'злые'})</span></div>${chipsPlayers('doomV', 1, p => p.alive && p.align === a.align, vic, { act: 'dayPick', noRole: true })}` : ''}
      <button class="btn danger" data-act="doom" ${a && vic.length ? '' : 'disabled'}>Записать смерть</button></div></details></div>`);
  }
  // Сказочник Скрипач: состязание Демона и игрока другой стороны — игра заканчивается
  if ((S.fabled || []).includes('fiddler')) {
    const dm = S.players.find(p => E.isDemon(p) && p.alive), ch = (picks.fidCh || [])[0];
    if (dm) parts.push(`<div class="card"><details><summary class="small"><b>Скрипач:</b> закончить игру состязанием</summary><div class="field" style="margin-top:8px">
      ${boundsHtml([{ w: 'Демон выбирает', t: 'тайно, 1 игрока другой стороны' }, { w: 'Голосуют', t: 'все, живые и мёртвые, за одного из двоих; ничья — победа зла' }])}
      ${chipsPlayers('fidCh', 1, p => p.align !== dm.align, ch ? [ch] : [], { act: 'dayPick', noRole: true })}
      ${ch ? `<div class="seg"><button data-act="fiddler" data-arg="demon">Победил ${esc(dm.name)}</button><button data-act="fiddler" data-arg="challenger">Победил ${esc(E.nm(S, ch))}</button><button data-act="fiddler" data-arg="tie">Ничья</button></div>` : ''}</div></details></div>`);
  }
  // Надзирательница: до 3 пар игроков меняются местами
  if (S.players.some(p => p.role === 'matron' && p.alive) && (d.matronSwaps || 0) < 3) {
    const sel = picks.matron || [];
    parts.push(`<div class="card"><details><summary class="small"><b>Надзирательница:</b> поменять игроков местами (${d.matronSwaps || 0} из 3)</summary><div class="field" style="margin-top:8px">
      ${chipsPlayers('matron', 2, () => true, sel, { act: 'dayPick2', noRole: true })}
      <button class="btn" data-act="matronSwap" ${sel.length === 2 ? '' : 'disabled'}>Поменять местами</button></div></details></div>`);
  }
  if (S.n === 1 && S.players.some(p => p.role === 'juggler' && p.alive)) {
    const g = S.flags.jugglerGuesses || [];
    parts.push(`<div class="card"><h3>Догадки Жонглёра (до 5)</h3>${g.map((x, i) => `<div class="small">${esc(E.nm(S, x.pid))} — ${esc(E.rname(x.role))} <button class="linkish" data-act="jugDel" data-arg="${i}">убрать</button></div>`).join('')}
      ${g.length < 5 ? `<div class="row" style="flex-wrap:nowrap"><select id="jugP">${S.players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><select id="jugR">${roleOptions(() => true, null)}</select><button class="btn" data-act="jugAdd">+</button></div>` : ''}</div>`);
  }
  // Судья: раз за игру решает исход номинации, сделанной другим игроком (во время голосования или сразу после)
  const judge = S.players.find(p => p.role === 'judge' && p.alive && !S.flags['judge_' + p.id]);
  const judgeHtml = (onId, byId) => judge && byId !== judge.id && !d.executed ? `<div class="field"><label>Судья (${esc(judge.name)}), раз за игру: исход номинации ${esc(E.nm(S, onId))}</label>
    <div class="seg"><button data-act="judge" data-arg="${judge.id}|${onId}|1">Казнь состоится — сейчас</button><button data-act="judge" data-arg="${judge.id}|${onId}|0">Казни не будет</button></div></div>` : '';
  const { vd, bishop, butcherTurn, byOk, onOk, canVote } = nomRules();
  if (nm.stage === 'vote') {
    const on = E.P(S, nm.on), by = nm.by === 'st' ? null : E.P(S, nm.by);
    const cnt = E.voteCount(S, nm.voters);
    const weighted = nm.voters.map(id => E.P(S, id)).filter(v => E.voteWeight(S, v) !== 1).map(v => `${v.name}: ${E.voteWeight(S, v) === 3 ? 'голос за троих (Бюрократ)' : E.voteWeight(S, v) === -3 ? 'три голоса против (Бюрократ и Вор)' : 'голос против (Вор)'}`);
    const rules = [vd ? { w: 'Голосуют', t: 'только Шаман Вуду и мёртвые; жетон голоса не нужен и не тратится' } : { w: 'Голосуют', t: 'все живые; мёртвые — только если у них остался голос призрака (тратится при голосовании)' },
      { w: 'Казнь', t: `на плаху попадает тот, у кого не меньше ${th} голос. и больше, чем у остальных; при равенстве — никто` }];
    if (S.players.some(p => p.role === 'butler' && p.alive)) rules.push({ w: 'Дворецкий', t: 'голосует, только если голосует его хозяин' });
    if (S.players.some(p => p.role === 'beggar' && p.alive)) rules.push({ w: 'Нищий', t: 'голосует, только если у него есть жетон голоса (мёртвые могут отдать ему свой — он узнаёт их сторону)' });
    parts.push(`<div class="card"><div class="row ghead"><h3 class="hi">${art('vote', 'hg')}Голосование: ${esc(on.name)}</h3>${ringBtn()}</div><div class="small muted">Номинировал ${esc(by ? by.name : 'рассказчик')}${d.lastNom && d.lastNom.butcher ? ' (Мясник, после казни: порог тот же, превышать первую не нужно)' : ''}. Отметьте всех, кто поднял руку — по кругу, начиная с соседа номинированного; сам номинированный голосует последним.</div>
      ${boundsHtml(rules)}
      ${tiles('voters', 99, canVote, nm.voters, 'vote', { ghost: !vd, order: voteOrder(nm.on), mark: nm.on })}
      ${(() => { const vn = E.voteNeeds(S); return `<div class="reveal"><div class="lab">Голосов</div><div class="big">${cnt}</div>
        <div class="ln">Для казни нужно — <b>${vn.exec}</b>${vn.cancel ? ` · для отмены (ничья, казни не будет) — <b>${vn.cancel}</b>` : ''}</div>${weighted.map(t => `<div class="ln">${esc(t)}</div>`).join('')}</div>`; })()}
      ${judgeHtml(nm.on, nm.by)}
      ${confirmRow('voteDone', 'Подтвердить голоса', true, 'voteCancel', 'Отменить номинацию')}</div>`);
  } else if (!d.executed || butcherTurn) {
    const pv = E.nominationPreview(S, nm.by, nm.on);
    const rules = bishop ? [{ w: 'Номинирует', t: 'только рассказчик (Епископ); за день — хотя бы 1 игрока стороны, противоположной Епископу' }]
      : butcherTurn ? [{ w: 'Номинирует', t: 'Мясник — ещё раз после казни; можно того, кого уже номинировали' }]
        : [{ w: 'Номинирует', t: 'живой игрок, не больше 1 раза за день' }, { w: 'Номинировать', t: 'любого, кроме Странников (их изгоняют), каждого — не больше 1 раза за день' }];
    parts.push(`<div class="card"><div class="row ghead"><h3 class="hi">${art('nominate', 'hg')}${butcherTurn ? 'Номинация Мясника' : 'Номинация'}</h3>${ringBtn()}</div>
      ${boundsHtml(rules)}
      ${bishop ? '' : pickRow('by', 'Кто номинирует', nm.by && E.nm(S, nm.by), tiles('by', 1, byOk, nm.by ? [nm.by] : [], 'nomPick'))}
      ${pickRow('on', 'Кого номинируют', nm.on && (nm.on === nm.by ? E.nm(S, nm.on) + ' (себя)' : E.nm(S, nm.on)), tiles('on', 1, onOk, nm.on ? [nm.on] : [], 'nomPick'))}
      ${selfNomBtn(nm, onOk, bishop)}
      ${pv.notes.map(t => `<div class="warn">${esc(t)}</div>`).join('')}
      ${pv.askSpy ? `<div class="field"><label>Ваше решение: Шпион определяется Горожанином?</label><div class="seg"><button class="${nm.spy ? '' : 'on'}" data-act="nomSpy" data-arg="0">Нет</button><button class="${nm.spy ? 'on' : ''}" data-act="nomSpy" data-arg="1">Да — его казнят</button></div></div>` : ''}
      ${confirmRow('nominate', 'Подтвердить', (bishop || nm.by) && nm.on, 'nomClear', 'Отменить')}</div>`);
    // Судья может решить исход последней номинации и после подсчёта, пока не номинировали следующего
    const last = d.lastNom && d.noms.some(x => x.on === d.lastNom.on && !x.pardoned) ? d.lastNom : null;
    if (last && judge && !nm.on) parts.push(`<div class="card">${judgeHtml(last.on, last.by)}</div>`);
  }
  if (d.noms.length) parts.push(`<div class="card"><h3>Номинации сегодня</h3>${d.noms.map(x => `<div class="row"><b>${esc(E.nm(S, x.on))}</b><span class="muted">${x.count} голос.</span>${x.pardoned ? '<span class="badge">Судья: казни не будет</span>' : ''}${x.butcher ? '<span class="badge">Мясник</span>' : ''}${x.on === blk ? '<span class="badge evil">на плахе</span>' : ''}</div>`).join('')}</div>`);
  const second = d.executed && d.noms.find(x => x.butcher && x.count >= th);
  const scapegoat = blk && !d.executed ? S.players.find(p => p.role === 'scapegoat' && p.alive && p.id !== blk && p.align === E.P(S, blk).align) : null;
  // день задержан до публичного выбора Растяпы/Дитя Луны (engine endDay) — следующее нажатие начинает ночь
  const endLabel = d.holdForChoice ? 'Начать ночь' : d.executed ? (second ? `Завершить день и казнить: ${esc(E.nm(S, second.on))} (Мясник)` : 'Завершить день') : blk ? `Завершить день и казнить: ${esc(E.nm(S, blk))}` : 'Завершить день без казни';
  const dead = S.players.filter(p => !p.alive);
  parts.push(fateCard(second ? second.on : d.executed || blk)); // казнь на выбор — над «Завершить день», когда есть казнь
  parts.push(`<div class="card"><button class="btn primary wide" data-act="endDay">${art('execute', 'bg')}${endLabel}</button>
    ${blk && !d.executed && E.travellerWorks(S, 'butcher') ? `<button class="btn wide" data-act="executeNow">Казнить ${esc(E.nm(S, blk))} сейчас — Мясник номинирует ещё раз</button>` : ''}
    ${scapegoat ? `<div class="seg"><button class="${picks.scapegoat ? 'on' : ''}" data-act="scapegoat" data-arg="${scapegoat.id}">Козёл Отпущения (${esc(scapegoat.name)}) казнён вместо ${esc(E.nm(S, blk))}</button></div>` : ''}
    <details><summary class="small">${d.executed ? 'Воскресить игрока' : 'Казнить другого игрока или воскресить'} (решение рассказчика)</summary><div style="margin-top:8px">
    ${d.executed ? '' : `<div class="flabel"><span>Казнить</span></div>${chipsPlayers('manualExe', 1, p => p.alive && !E.isTraveller(p), picks.manualExe || [], { act: 'dayPick', noRole: true })}
    <button class="btn danger" data-act="manualExe" ${(picks.manualExe || []).length ? '' : 'disabled'}>Казнить и завершить день</button>`}
    ${dead.length ? `<div class="flabel"><span>Воскресить (например, если ошибся рассказчик)</span></div>${chipsPlayers('revive', 1, p => !p.alive, picks.revive || [], { act: 'dayPick', noRole: true, ghost: true })}
    <button class="btn" data-act="revive" ${(picks.revive || []).length ? '' : 'disabled'}>Воскресить</button>` : '<div class="small muted">Мёртвых нет — воскрешать некого.</div>'}</div></details></div>`);
  parts.push(killFormHtml());
  parts.push(exileHtml(picks)); // изгнание Странников — в самом низу
  return parts.join('');
}

// изгнание Странника: выбор Странника и голосующих — квадратиками
function exileHtml(picks) {
  if (!S.players.some(p => E.isTraveller(p) && p.alive)) return '';
  const ex = picks.exile || { pid: null, voters: [] }, eth = E.exileThreshold(S), pass = ex.voters.length >= eth;
  return `<div class="card"><h3 class="hi">${art('traveller', 'hg')}Изгнание Странника</h3>
    ${boundsHtml([{ w: 'Кого', t: 'только Странника; изгнание — не казнь, за день их может быть сколько угодно' },
      { w: 'Голосуют', t: 'все игроки, живые и мёртвые; голос призрака при этом не тратится' },
      { w: 'Изгнан', t: `если голосов не меньше половины всех игроков: ${eth} из ${S.players.length}` }])}
    ${pickRow('exPid', 'Кого изгоняют', ex.pid && E.nm(S, ex.pid), tiles('exPid', 1, p => E.isTraveller(p) && p.alive, ex.pid ? [ex.pid] : [], 'exPick'))}
    ${ex.pid ? `<div class="flabel"><span>Кто голосует за изгнание</span><span>${ex.voters.length}</span></div>${tiles('exV', 99, () => true, ex.voters, 'exVote')}
    <div class="reveal"><div class="lab">Голосов</div><div class="big">${ex.voters.length} из ${eth} — ${pass ? 'изгнан' : 'не изгнан'}</div></div>
    ${pass && E.P(S, ex.pid).role === 'deviant' ? `<div class="seg"><button class="${picks.exFunny ? 'on' : ''}" data-act="exFunny">Девиант сегодня был забавным — не умирает</button></div>` : ''}
    ${confirmRow('exile', pass ? 'Подтвердить: изгнан' : 'Подтвердить: остаётся', true, 'exClear', 'Отменить')}` : ''}</div>`;
}

// убить игрока по решению рассказчика, с причиной-примечанием (днём и ночью)
function killFormHtml() {
  const sel = UI.killPid && E.P(S, UI.killPid) && E.P(S, UI.killPid).alive ? [UI.killPid] : [];
  return `<div class="card"><details><summary class="small"><b>Убить игрока</b> — решение рассказчика, с причиной</summary><div class="field" style="margin-top:8px">
    ${boundsHtml([{ w: 'Вы решаете', t: 'игрок умирает сразу, без защит; ночью смерть попадёт в объявление на рассвете. Причина видна только вам — в журнале и в «Гримуаре»' }])}
    ${chipsPlayers('kill', 1, p => p.alive, sel, { act: 'killPick' })}
    <input type="text" id="killWhy" data-act="killWhy" value="${esc(UI.killWhy)}" placeholder="Причина (необязательно), например: «Ангел — что-то плохое»" aria-label="Причина смерти">
    <button class="btn danger" data-act="killDo" ${sel.length ? '' : 'disabled'}>Убить${sel.length ? ': ' + esc(E.nm(S, sel[0])) : ''}</button></div></details></div>`;
}

// клетка Гримуара: квадрат с иконкой роли (значки — слева и справа от неё), роль, имя игрока на табличке под квадратом
function grimCell(p, i) {
  const side = !p.role ? 'none' : p.align, [l, r] = sideMarks(p);
  return `<button class="gcell side-${side} ${p.alive ? '' : 'dead'}" data-act="openP" data-arg="${p.id}" aria-label="${esc(p.name)}: ${p.role ? esc(E.rname(p.role)) : 'без роли'}${p.alive ? '' : ', мёртв'}">
    <span class="gsq">${shroudHtml(p)}<span class="gno">${i + 1}</span>
      <span class="gmid">${l}${p.role ? ico(p.role, p.align, 'gic') : '<span class="gq">?</span>'}${r}</span><span class="grn">${p.role ? esc(E.rname(p.role)) : 'без роли'}</span>
      ${p.believes ? `<span class="gbel">считает: ${esc(E.rname(p.believes))}</span>` : ''}${!p.role && S.phase === 'setup' ? assignBadge(p) : ''}</span>
    <span class="gpn">${esc(p.name)}</span></button>`;
}
const bluffsHtml = () => S.bluffs.filter(Boolean).length ? `<div class="gbluffs"><span class="small muted">Блефы Демона</span><div>${S.bluffs.filter(Boolean).map(r => `<span class="gbl">${ico(r, null, 'gbi')}${esc(E.rname(r))}</span>`).join('')}</div></div>` : '';
// Гримуар: большие квадраты по 3 в ряд — иконка и роль в квадрате, имя игрока под ним; нажатие — карточка игрока
/* Пароль на «Показать роли» (заметка пользователя 2026-10-16): по умолчанию — заданный пользователем (в коде только его хэш),
   сменить можно на вкладке «Ещё» → «Защита», только введя текущий. Хранится на этом устройстве (localStorage), хэшем — у сайта
   на телефоне и у программы на компьютере пароли свои. Защита от случайного взгляда, а не от взлома: код приложения открыт. */
const PIN_KEY = 'botc-grimoire-pin', PIN_DEFAULT = 'hiwc8w';
const pinHash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };
const pinStored = () => { try { return localStorage.getItem(PIN_KEY) || PIN_DEFAULT; } catch (e) { return PIN_DEFAULT; } };
const pinCheck = s => pinHash(String(s || '').trim()) === pinStored();
const pinSave = s => { try { localStorage.setItem(PIN_KEY, pinHash(String(s).trim())); return true; } catch (e) { return false; } };
function pinAskHtml() {
  const a = UI.pinAsk; if (!a) return '';
  return `<div class="ov editres" role="dialog" aria-label="Пароль"><div class="statbg" data-act="pinClose"></div><div class="erbox statbox">
    <h3>Показать роли</h3><div class="small muted">Введите пароль рассказчика.</div>
    <input type="password" id="pinIn" inputmode="numeric" autocomplete="off" aria-label="Пароль">
    ${a.err ? '<div class="warn">Неверный пароль</div>' : ''}
    <div class="confirm"><button class="btn ok" data-act="pinOk">Показать</button><button class="btn" data-act="pinClose">Отмена</button></div></div></div>`;
}
const pinFocus = () => setTimeout(() => { const el = document.getElementById('pinIn'); if (el) el.focus(); }, 30);
// роли скрыты «шторкой» после стены жребия, пока рассказчик сам не нажмёт «Показать роли» (заметка пользователя 2026-10-16)
const rolesHidden = () => S.phase === 'setup' && !!S.draw && S.draw.hidden !== false;
// текст — по просьбе пользователя (2026-10-16): без длинного пояснения
function rolesCurtain() {
  return `<div class="card curtain"><h3>Роли скрыты</h3><div class="small muted">Чтобы увидеть роли, введите пароль.</div>
    <button class="btn primary wide" data-act="rolesShow">Показать роли</button></div>`;
}
// Гримуар рассказчика: по умолчанию кругом прямо на вкладке, переключатель — на плитку (заметка пользователя 2026-10-16;
// выбор запоминается на устройстве: localStorage botc-grimoire-grimgrid). Кругом: роли, имена, все отметки; нажатие на жетон — карточка игрока.
// На подготовке переставить игроков — «Рассадка» (круг с перетаскиванием)
function viewTable() {
  if (rolesHidden()) return poolCard() + rolesCurtain(); // стена — на вкладке «Игра»; Гримуар с ролями — под «шторкой»
  const n = S.players.length, ring = !UI.grimGrid && n > 1;
  const seatB = S.phase === 'setup' && n > 1 ? '<button class="btn ringbtn" data-act="ringSeat">Рассадка</button>' : '';
  const viewSeg = n > 1 ? `<div class="seg gview" role="group" aria-label="Вид Гримуара"><button class="${ring ? 'on' : ''}" data-act="grimGrid" data-arg="0">◯ Кругом</button><button class="${ring ? '' : 'on'}" data-act="grimGrid" data-arg="1">▦ Плиткой</button></div>` : '';
  const body = !n ? '<div class="muted">Игроков пока нет — добавьте их на вкладке «Игра»</div>'
    : ring ? `${grimCircle({ names: true, notes: true, act: 'openP' })}<details class="ringdirbox"><summary class="small">Первый — внизу, у вас; номера идут ${dirName()} — изменить</summary>${dirSeg()}</details>`
      : `<div class="grim">${S.players.map((p, i) => grimCell(p, i)).join('')}</div>`;
  return `${S.phase === 'setup' ? poolCard() : ''}<div class="card"><div class="row ghead"><h3>Гримуар · ${esc(S.script.name)}</h3><span class="row gbtns">${seatB}<button class="btn lgbtn" data-act="legend" aria-label="Что значат значки"><span class="lgq" aria-hidden="true">?</span>Значки</button></span></div>
    ${viewSeg}${body}${bluffsHtml()}${S.phase === 'setup' ? '' : travellerForm()}</div>${S.phase === 'setup' ? '' : fabledZone()}${savListCard()}`;
}
// Савант: все факты списком (заметка пользователя 2026-10-16) — верные зелёным, неверные красным; нажатие выбирает (ещё раз — убирает),
// выбранные — в карточке Саванта на экране дня. Список составляется при открытии вкладки днём и живёт до конца дня («Обновить список» — заново)
const savAlive = () => S.phase === 'day' && S.day ? S.players.filter(p => p.role === 'savant' && p.alive) : [];
const savTold = id => (S.flags.savantFacts || []).some(x => x.n === S.n && x.pid === id);
// не больше одного верного и одного ложного факта Саванта — первые по порядку (заметка пользователя 2026-10-17)
const savOneEach = list => { if (!list) return null; const t = list.find(x => x.truth), f = list.find(x => !x.truth), r = list.filter(x => x === t || x === f); return r.length ? r : null; };
function savListEnsure() {
  for (const sv of savAlive()) if (!S.day.picks['savList_' + sv.id] && !savTold(sv.id)) { S.day.picks['savList_' + sv.id] = IDEAS.savantList(S, sv.id); S.updated = Date.now(); persist(); }
}
function savListCard() {
  return savAlive().map(sv => {
    const list = S.day.picks['savList_' + sv.id], sel = S.day.picks['sav_' + sv.id] || [], told = savTold(sv.id);
    const head = `<div class="row ghead"><h3>Факты Саванта${S.players.filter(p => p.role === 'savant').length > 1 ? ' · ' + esc(sv.name) : ''}</h3>${told ? '' : `<button class="btn" data-act="savList" data-arg="${sv.id}">${list ? 'Обновить список' : 'Составить список'}</button>`}</div>`;
    if (told) return `<div class="card" id="savlist">${head}<div class="note-ok">Сегодня факты уже сказаны — они в Журнале («Факты Саванта»).</div></div>`;
    if (!list) return `<div class="card" id="savlist">${head}</div>`;
    const on = t => sel.some(x => x.text === t), nT = sel.filter(x => x.truth).length;
    const btn = (i, text, tr) => `<button class="savpick ${tr ? 't' : 'f'}${on(text) ? ' on' : ''}" data-act="savPick" data-arg="${sv.id}|${i}|${tr ? 1 : 0}" aria-pressed="${on(text)}">${on(text) ? '✓ ' : ''}${esc(text)}</button>`;
    // группы свёрнуты, пока их не раскроют (заметка пользователя 2026-10-16); раскрытые помнятся до перезагрузки (UI.savOpen)
    const groups = IDEAS.SAVANT_GROUPS.map(g => { const its = list.map((it, i) => [it, i]).filter(([it]) => it.g === g); if (!its.length) return '';
      const open = !!(UI.savOpen || {})[g], nSel = its.reduce((k, [it]) => k + on(it.yes) + on(it.no), 0);
      return `<div class="savgrp"><button class="savgh${open ? ' open' : ''}" data-act="savGrp" data-arg="${esc(g)}" aria-expanded="${open}"><span class="chev" aria-hidden="true">▸</span><span>${g}</span><span class="savgn">${its.length}${nSel ? ` · выбрано ${nSel}` : ''}</span></button>
        ${open ? its.map(([it, i]) => `<div class="savpair">${btn(i, it.yes, true)}${btn(i, it.no, false)}</div>`).join('') : ''}</div>`; }).join('');
    return `<div class="card" id="savlist">${head}
      <div class="small muted">Раскройте группу. Зелёные — верные, красные — неверные. Нажмите, чтобы выбрать, ещё раз — убрать. Выбранные появятся в карточке Саванта на экране дня.</div>
      <div class="savsel">Выбрано: верных ${nT}, неверных ${sel.length - nT}</div>${groups}</div>`;
  }).join('');
}
/* ---------- Гримуар для Шпиона и Вдовы — как в игре: жетоны по кругу, напоминания — к центру ---------- */
// жетон роли, как настоящий: светлый кружок, иконка, название роли дугой по низу. Пьяница — как в Гримуаре рассказчика:
// жетон Горожанина, которым он себя считает, а рядом напоминание «Пьяница»
const realTokenRole = p => (p.role === 'drunk' || p.role === 'marionette') && p.believes ? p.believes : p.role; // Марионетка — как Пьяница: жетон «своей» роли + напоминание
// искажённый Гримуар (пьяный или отравленный Шпион/Вдова) — роль на месте игрока подменена: S.night.data.fakeGrim.map
const fakeGrimOn = () => !!(UI.grimShow && UI.grimFake && S.phase === 'night' && S.night && S.night.data.fakeGrim);
const tokenRole = p => (fakeGrimOn() && S.night.data.fakeGrim.map[p.id]) || realTokenRole(p);
// цвет жетона: Марионетка (и Пьяница) лежит в Гримуаре жетоном доброй роли, которой себя считает, — он синий, а не красный;
// что это Марионетка, видно по напоминанию (вики: «IS THE MARIONETTE» рядом с жетоном; заметка пользователя 2026-10-15)
const tokenAlign = p => fakeGrimOn() && S.night.data.fakeGrim.map[p.id] ? (isGoodRole(S.night.data.fakeGrim.map[p.id]) ? 'good' : 'evil')
  : realTokenRole(p) !== p.role ? (isGoodRole(realTokenRole(p)) ? 'good' : 'evil') : p.align;
// искажённый Гримуар: роли перемешаны между местами, примерно треть заменена ролями сценария того же типа, которых нет в игре.
// Место смотрящего (Шпиона, Вдовы) и Странники — как есть: подмену там видно сразу. Демон и Приспешники тоже на своих местах:
// злые знают друг друга с первой ночи (заметка пользователя 2026-10-12)
function makeFakeGrim(viewer) {
  const mix = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // from — чья роль (и чьи отметки состояний) теперь показана на этом месте: состояния переезжают вместе с ролью
  const seats = S.players.filter(p => p.id !== viewer && !E.isTraveller(p) && p.role && !['minion', 'demon'].includes(team(p.role)));
  const from = mix(seats.map(p => p.id)), roles = from.map(id => realTokenRole(E.P(S, id)));
  const used = new Set(S.players.flatMap(p => [p.role, p.believes]).concat(roles));
  for (const i of mix([...roles.keys()]).slice(0, Math.max(1, Math.round(roles.length / 3)))) {
    const spare = mix(S.script.roles.filter(r => DATA.roles[r] && team(r) === team(roles[i]) && !used.has(r)))[0];
    if (spare) { used.add(spare); roles[i] = spare; }
  }
  return { viewer, map: Object.fromEntries(seats.map((p, i) => [p.id, roles[i]])), from: Object.fromEntries(seats.map((p, i) => [p.id, from[i]])) };
}
// отметки на месте в круге Шпиона и Вдовы. В искажённом Гримуаре — отметки того игрока, чья роль здесь показана
// (отравлен, пьян, защищён… переезжают вместе с ролью — заметка пользователя 2026-10-12: «нужны метки состояний»);
// отметки добрых ролей, которых в искажённом Гримуаре нет (их заменили), убираем — иначе видна подмена
function seatMarks(p) {
  // своё «отравлен/пьян» смотрящему (Шпиону, Вдове) не показываем — иначе он поймёт, что отравлен (заметка пользователя 2026-10-14)
  const st = S.phase === 'night' && E.currentStep(S), viewer = st && st.pid;
  if (p.id === viewer) return seatMarks0(p).filter(m => m[0] !== 'poison' && m[0] !== 'drunk');
  return seatMarks0(p);
}
function seatMarks0(p) {
  if (!fakeGrimOn()) return playerMarks(p, { noNotes: true });
  const fg = S.night.data.fakeGrim, src = fg.map[p.id] ? fg.from && E.P(S, fg.from[p.id]) : p;
  if (!src) return [];
  const onBoard = new Set(S.players.map(tokenRole));
  // «Прачка: Повар» — показанной роли тоже нет на поле (заменена) — убираем
  const gone = new Set(src.tokens.filter(t => t.k === 'shown' && t.note && !onBoard.has(t.note)).map(shownTitle));
  return playerMarks(src, { noNotes: true }).filter(m => !(m[0] === 'shown' && gone.has(m[1]))
    && (!m[2] || !DATA.roles[m[2]] || m[2] === 'drunk' || !isGoodRole(m[2]) || onBoard.has(m[2])));
}
function roleTokenHtml(p, key) {
  const r = tokenRole(p), name = r ? E.rname(r) : '?', fit = name.length > 13 ? ' textLength="112" lengthAdjust="spacingAndGlyphs"' : '';
  return `<span class="rtk ${p.alive ? '' : 'dead'}">${r ? ico(r, tokenAlign(p), 'rtki') : ''}
    <svg class="rtkn" viewBox="0 0 100 100" aria-hidden="true"><path id="${key}" d="M13 56A37 37 0 0 0 87 56" fill="none"/><text><textPath href="#${key}" startOffset="50%" text-anchor="middle"${fit}>${esc(name)}</textPath></text></svg>
    ${shroudHtml(p)}</span>`;
}
// места по кругу: первое — внизу экрана (у рассказчика), дальше по часовой или против — как номера за столом (seatDir).
// Все размеры — в cqw (доли ширины поля), поэтому круг сам масштабируется под экран.
// На высоком экране круг немного вытянут по высоте (не больше чем в 1,3 раза) — жетоны крупнее. label — табличка с именем под жетоном.
// t — жетон: самый крупный, при котором соседи не налезают друг на друга; reserve — сколько высоты экрана занято вокруг круга
function ringGeom(n, label, reserve) {
  const avW = Math.min(window.innerWidth - 32, 640), ratio = Math.max(1, Math.min(1.3, (window.innerHeight - (reserve || 230)) / avW)), H = 100 * ratio;
  let t = label ? 21 : 24, L = 0, rx, ry;
  for (; t > 6; t -= 0.25) {
    L = label ? Math.max(4.6, t * 0.32) : 0; rx = 50 - t / 2 - 1; ry = H / 2 - t / 2 - (label ? L : 1);
    const step = 2 * Math.PI / n;
    if (n < 3 || (rx * step >= t * 1.06 && ry * step >= (t + L) * 1.02)) break;
  }
  const dir = seatDir(), pos = i => { const a = Math.PI + dir * 2 * Math.PI * i / n; return { a, x: 50 + rx * Math.sin(a), y: H / 2 - ry * Math.cos(a) }; };
  return { n, t, L, rx, ry, H, dir, pos };
}
// переключатель направления номеров (в кругах рассадки и номинации)
const dirSeg = () => `<div class="seg ringdir" role="group" aria-label="Направление номеров"><button class="${seatDir() > 0 ? 'on' : ''}" data-act="seatDir" data-arg="cw">↻ По часовой</button><button class="${seatDir() < 0 ? 'on' : ''}" data-act="seatDir" data-arg="ccw">↺ Против часовой</button></div>`;
// opts.names — таблички с именами под жетонами (рассказчику; Шпиону и Вдове — без имён, как в настоящем Гримуаре),
// opts.notes — заметки рассказчика среди напоминаний, opts.act — что делает нажатие на жетон (grimZoom — крупно, openP — карточка игрока)
function grimCircle(opts) {
  opts = opts || {};
  const ps = S.players, n = ps.length; if (!n) return '';
  const g = ringGeom(n, !!opts.names), { t, L, rx, ry, H } = g;
  const nf = Math.min(4.3, L / 1.5), rr = Math.max(6, Math.min(8.5, t * 0.42)), gap = 0.6, cx = 50, cy = H / 2;
  const seats = ps.map((p, i) => {
    const { a, x, y } = g.pos(i);
    const spacing = Math.hypot(rx * Math.cos(a), ry * Math.sin(a)) * 2 * Math.PI / n; // расстояние до соседа по кругу
    const vx = cx - x, vy = cy - y, len = Math.hypot(vx, vy) || 1;
    const lw = Math.max(t * 1.1, Math.min(t * 1.7, spacing * 0.96));
    // в искажённом Гримуаре отметок нет — они выдали бы правду
    return { p, x, y, len, ux: vx / len, uy: vy / len, lw, ms: opts.names ? playerMarks(p, { noNotes: !opts.notes }) : seatMarks(p), pos: [], j: 0 };
  });
  // занятые места: жетоны (круги) и таблички с именами (прямоугольники)
  const discs = seats.map(s => ({ x: s.x, y: s.y, r: t / 2 + 0.3 }));
  const boxes = opts.names ? seats.map(s => ({ x0: s.x - s.lw / 2, x1: s.x + s.lw / 2, y0: s.y + t / 2, y1: s.y + t / 2 + L + 0.6 })) : [];
  const free = (x, y, r) => x - r >= 0 && x + r <= 100 && y - r >= 0 && y + r <= H
    && discs.every(o => Math.hypot(o.x - x, o.y - y) >= o.r + r) && boxes.every(b => x + r <= b.x0 || x - r >= b.x1 || y + r <= b.y0 || y - r >= b.y1);
  // напоминания — по лучу от жетона к центру, как кладут на стол; если на луче занято — в сторону (на полшага или шаг).
  // Раскладываем по кругу: сначала первое напоминание каждого игрока, потом второе и т. д.
  const r2 = rr / 2, side = rr * 0.6 + gap;
  for (let k = 0, most = Math.max(0, ...seats.map(s => s.ms.length)); k < most; k++) {
    for (const s of seats) {
      if (s.ms.length <= k || s.pos.length < k) continue; // прошлое не поместилось — дальше не ищем
      const start = t / 2 + gap + r2 + L * Math.max(0, s.uy); // табличка с именем под жетоном мешает, когда луч идёт вниз (верх круга)
      for (let j = s.j; ; j++) {
        const d = start + j * (rr + gap); if (d > s.len) break;
        const spot = [0, side, -side, 2 * side, -2 * side].map(o => ({ x: s.x + s.ux * d - s.uy * o, y: s.y + s.uy * d + s.ux * o })).find(c => free(c.x, c.y, r2));
        if (spot) { s.pos.push(spot); discs.push({ x: spot.x, y: spot.y, r: r2 + gap / 2 }); s.j = j; break; }
      }
    }
  }
  const cells = seats.map(s => {
    const { p, x, y, ms, pos } = s, over = ms.length > pos.length && pos.length > 0;
    const at = c => `left:${(c.x - r2).toFixed(2)}cqw;top:${(c.y - r2).toFixed(2)}cqw;width:${rr}cqw;height:${rr}cqw`;
    const rems = pos.map((c, k) => over && k === pos.length - 1
      ? `<span class="gcm" style="${at(c)}"><span class="rmore" style="font-size:${(rr * 0.42).toFixed(2)}cqw">+${ms.length - k}</span></span>`
      : `<span class="gcm" style="${at(c)}" title="${esc(ms[k][1])}">${markIcon(ms[k][0], ms[k][2], ms[k][3])}</span>`).join('');
    return `${rems}<button class="gct" data-act="${opts.act || 'grimZoom'}" data-arg="${p.id}" style="left:${(x - t / 2).toFixed(2)}cqw;top:${(y - t / 2).toFixed(2)}cqw;width:${t}cqw;height:${t}cqw" aria-label="${opts.names ? esc(p.name) + ': ' : ''}${esc(E.rname(tokenRole(p)))}${p.alive ? '' : ', мёртв'}">${roleTokenHtml(p, 'gca-' + p.id)}</button>
      ${opts.names ? `<span class="gcl ${p.alive ? '' : 'dead'}" style="left:${x.toFixed(2)}cqw;top:${(y + t / 2 + 0.4).toFixed(2)}cqw;font-size:${nf.toFixed(2)}cqw;max-width:${s.lw.toFixed(2)}cqw">${esc(p.name)}</span>` : ''}`;
  }).join('');
  // подложка под всем кругом рассадки (в стилях: циферблат гравюры, роза витража; в Basic скрыта)
  const pad = t * 0.62, bg = `<span class="gbg" aria-hidden="true" style="left:${(cx - rx - pad).toFixed(2)}cqw;top:${(cy - ry - pad).toFixed(2)}cqw;width:${(2 * (rx + pad)).toFixed(2)}cqw;height:${(2 * (ry + pad)).toFixed(2)}cqw"></span>`;
  return `<div class="gcirc" style="aspect-ratio:100 / ${H.toFixed(1)}">${bg}${cells}</div>`;
}
// жетон крупно: нажатие на жетон в круге Шпиона и Вдовы (роль, способность и все напоминания словами; имени нет — как в Гримуаре)
function grimZoomHtml() {
  const p = UI.grimZoom && E.P(S, UI.grimZoom); if (!p) return '';
  const r = tokenRole(p), ms = seatMarks(p);
  return `<div class="gzoom" data-act="grimZoom" role="dialog" aria-label="${esc(E.rname(r))}"><div class="gzbox">
    <div class="gztok">${roleTokenHtml(p, 'gcz-' + p.id)}</div>
    <div class="gzrole side-${tokenAlign(p)}">${esc(E.rname(r))}${p.alive ? '' : ` · мёртв${p.ghost ? ', голос призрака есть' : ''}`}</div>
    <div class="gzab">${esc(DATA.roles[r] ? DATA.roles[r].ability : '')}</div>
    ${ms.length ? `<div class="gzmarks">${ms.map(m => `<div class="gzm">${markIcon(m[0], m[2], m[3])}<span>${esc(m[1])}</span></div>`).join('')}</div>` : ''}
    <div class="shhint">Нажмите, чтобы вернуться к Гримуару</div></div></div>`;
}
/* ---------- круг игроков для рассказчика: рассадка (перетаскивание) и номинация с голосованием ---------- */
// кто может номинировать, кого можно номинировать, кто может голосовать — общие для карточки дня и круга
function nomRules() {
  const d = S.day, vd = E.voudonActive(S), butcherTurn = !!d.butcherOpen;
  return { vd, bishop: E.bishopActive(S), butcherTurn,
    byOk: butcherTurn ? (p => p.role === 'butcher' && p.alive) : (p => p.alive && !d.nominators.includes(p.id)),
    onOk: p => !E.isTraveller(p) && (butcherTurn || !d.nominated.includes(p.id)),
    canVote: vd ? (p => !p.alive || p.role === 'voudon') : (p => p.alive || p.ghost) };
}
const ringBtn = () => '<button class="btn ringbtn" data-act="ringNom">◯ Кругом</button>';
// место за столом: кружок с номером и именем (без ролей — экран может видеть стол); мёртвый — саван (белый контур — голос есть)
function seatHtml(p, i, g, cls, attrs, extra) {
  const { x, y } = g.pos(i), longest = Math.max(3, ...p.name.split(/\s+/).map(w => w.length));
  const fs = Math.min(g.t * 0.22, g.t * 0.84 / (longest * 0.6)); // самое длинное слово — в одну строку
  return `<button class="rseat ${p.alive ? '' : 'dead'} ${cls || ''}" ${attrs || ''} style="left:${(x - g.t / 2).toFixed(2)}cqw;top:${(y - g.t / 2).toFixed(2)}cqw;width:${g.t}cqw;height:${g.t}cqw;font-size:${fs.toFixed(2)}cqw" aria-label="${i + 1}. ${esc(p.name)}${p.alive ? '' : ', мёртв'}">
    <span class="rno">${i + 1}</span><span class="rnm">${esc(p.name)}</span>${E.isTraveller(p) ? '<span class="rtr">Странник</span>' : ''}${extra || ''}${shroudHtml(p)}</button>`;
}
const ringStyle = g => `aspect-ratio:100 / ${g.H.toFixed(1)}`;
// ночной выбор кругом: места с иконкой роли и именем; выбранные — по порядку (1, 2, 3 — важно для Аль-Адихии)
function ringPick(key, n, filter, sel) {
  const g = ringGeom(S.players.length, false, 330);
  const seats = S.players.map((p, i) => { const k = sel.indexOf(p.id);
    const extra = `${p.role ? ico(p.role, p.align, 'rsi') : ''}${k >= 0 && n > 1 ? `<span class="rord">${k + 1}</span>` : ''}`;
    return seatHtml(p, i, g, (k >= 0 ? 'on' : '') + ' withicon', `data-act="pickP" data-arg="${key}|${p.id}|${n}" ${filter(p) ? '' : 'disabled'}`, extra); }).join('');
  return `<div class="ring nightring" style="${ringStyle(g)}">${seats}</div>`;
}
// рассадка кругом: перетащить игрока на другое место (pointer-события внизу файла: data-rdrag)
function seatRing() {
  const n = S.players.length, g = ringGeom(Math.max(n, 1), false, 250);
  // назначение для жребия и раздачи (роль или тип) — под именем; нажатие на место открывает карточку игрока, там его и меняют
  const asg = p => { const a = !rolesHidden() && !p.role && !E.isTraveller(p) && (S.assign || {})[p.id]; return a ? `<span class="rasg">→ ${esc(assignLabel(a))}</span>` : ''; }; // роли скрыты — и назначения тоже
  const seats = S.players.map((p, i) => seatHtml(p, i, g, 'drag', `data-rdrag="${p.id}"`, asg(p))).join('');
  return `<div class="ov ringov" role="dialog" aria-label="Рассадка по кругу">
    <div class="ringtop"><span></span><b>Рассадка</b><button class="wbtn" data-act="ringClose" aria-label="Закрыть">×</button></div>
    <div class="ringbox"><div class="small muted ringhint">Нажмите на игрока — назначить роль или тип роли. Зажмите и перетащите на другое место — остальные сдвинутся. Первый — внизу, у вас; номера идут ${dirName()} — как за столом.</div>
      ${dirSeg()}
      ${n ? `<div class="ring" data-geom="${esc(JSON.stringify({ t: g.t, rx: g.rx, ry: g.ry, H: g.H, dir: g.dir }))}" style="${ringStyle(g)}">${seats}<div class="ringmid" style="top:${(g.H / 2).toFixed(2)}cqw"><b>${n}</b><span>игроков</span></div></div>`
        : '<div class="muted">Игроков пока нет — добавьте их в списке.</div>'}
      <button class="btn primary wide" data-act="ringClose">Готово</button></div></div>`;
}
// номинация кругом: нажать, кто номинирует, потом — кого; голосование — отметить поднявших руку по кругу
function nomRing() {
  const d = S.day, nm = d.draft, th = E.voteThreshold(S), n = S.players.length, g = ringGeom(n, false, 330);
  const { bishop, butcherTurn, byOk, onOk, canVote } = nomRules(), vote = nm.stage === 'vote';
  const open = vote || !d.executed || butcherTurn;
  const first = vote ? voteOrder(nm.on)[0] : null;
  const seats = S.players.map((p, i) => {
    const cls = [p.id === nm.by ? 'by' : '', p.id === nm.on ? 'on' : '', vote && nm.voters.includes(p.id) ? 'voted' : '', vote && first && p.id === first.id && p.id !== nm.on ? 'first' : ''].join(' ');
    const ok = !open ? false : vote ? canVote(p) : (p.id === nm.by || p.id === nm.on || (!bishop && !nm.by ? byOk(p) : onOk(p)));
    return seatHtml(p, i, g, cls, `data-act="${vote ? 'vote' : 'ringPick'}" data-arg="${vote ? 'voters|' + p.id + '|99' : p.id}" ${ok ? '' : 'disabled'}`);
  }).join('');
  // стрелка «кто → кого»
  const bi = S.players.findIndex(p => p.id === nm.by), oi = S.players.findIndex(p => p.id === nm.on);
  let arrow = '';
  if (bi >= 0 && oi >= 0 && bi !== oi) {
    // дуга через точку, сдвинутую к центру круга: у соседей прямая между краями кружков вывернулась бы
    // и стрелка смотрела бы на номинирующего — поэтому чем ближе места, тем сильнее изгиб внутрь
    const a = g.pos(bi), b = g.pos(oi), len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, ox = 50 - mx, oy = g.H / 2 - my, ol = Math.hypot(ox, oy) || 1;
    const pull = Math.max(0, 2.6 * g.t - len) * 0.75, cx = mx + ox / ol * pull, cy = my + oy / ol * pull;
    const edge = (p, r) => { const vx = cx - p.x, vy = cy - p.y, l = Math.hypot(vx, vy) || 1; return { x: p.x + vx / l * r, y: p.y + vy / l * r }; };
    const s = edge(a, g.t / 2 + 1), e = edge(b, g.t / 2 + 2.2), f = v => v.toFixed(2);
    arrow = `<svg class="ringsvg" viewBox="0 0 100 ${g.H.toFixed(1)}" aria-hidden="true"><defs><marker id="rarr" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10Z"/></marker></defs>
      <path class="arr" d="M${f(s.x)} ${f(s.y)}Q${f(cx)} ${f(cy)} ${f(e.x)} ${f(e.y)}" marker-end="url(#rarr)"/></svg>`;
  }
  const by = nm.by === 'st' ? null : nm.by && E.P(S, nm.by), on = nm.on && E.P(S, nm.on);
  // сколько голосов нужно для казни, а если кто-то уже на плахе — и для отмены (ничья) (заметка пользователя 2026-10-16)
  const vn = vote ? E.voteNeeds(S) : null, vc = vote ? E.voteCount(S, nm.voters) : 0;
  const mid = vote ? `<b class="${vc >= vn.exec ? 'enough' : vn.cancel && vc === vn.cancel ? 'tie' : ''}">${vc}</b><span>для казни — ${vn.exec}</span>${vn.cancel ? `<span>для отмены — ${vn.cancel}</span>` : ''}<span class="small">за: ${esc(on ? on.name : '')}</span>`
    : !open ? '<span>Казнь сегодня уже была</span>'
      : !bishop && !by ? '<span>Кто номинирует?</span>'
        : !on ? `<span>${bishop ? 'Номинирует рассказчик (Епископ)' : esc(by.name) + ' номинирует…'}</span><b class="q">кого?</b>`
          : `<span>${bishop ? 'Рассказчик' : esc(by.name)}</span><span>номинирует</span><b class="nm">${by && on.id === by.id ? 'себя' : esc(on.name)}</b>`;
  // кто сейчас на плахе — видно между номинациями
  const blk = !vote && E.block(S), bn = blk && d.noms.find(x => x.on === blk);
  const mid2 = blk ? `<span class="small ringblk">на плахе: ${esc(E.nm(S, blk))}${bn ? ` (${bn.count})` : ''}</span>` : '';
  const pv = !vote && open ? E.nominationPreview(S, nm.by, nm.on) : { notes: [], askSpy: false };
  const hint = vote ? 'Отметьте всех, кто поднял руку: по часовой стрелке от соседа номинированного (он отмечен «1»), номинированный — последним.'
    : butcherTurn ? 'Номинация Мясника: ещё раз после казни; можно того, кого уже номинировали.' : bishop ? 'Епископ: номинирует только рассказчик — нажмите, кого.' : 'Нажмите, кто номинирует, потом — кого. Повторное нажатие снимает выбор.';
  return `<div class="ov ringov" role="dialog" aria-label="Номинация по кругу">
    <div class="ringtop"><span></span><b>${vote ? 'Голосование' : butcherTurn ? 'Номинация Мясника' : 'Номинация'}</b><button class="wbtn" data-act="ringClose" aria-label="Закрыть">×</button></div>
    <div class="ringbox">${notesHtml()}<div class="small muted ringhint">${hint}</div>
      <details class="ringdirbox"><summary class="small">Номера идут ${dirName()} — изменить</summary>${dirSeg()}</details>
      <div class="ring" style="${ringStyle(g)}">${arrow}${seats}<div class="ringmid" style="top:${(g.H / 2).toFixed(2)}cqw">${mid}${mid2}</div></div>
      ${!vote && open ? selfNomBtn(nm, onOk, bishop) : ''}
      ${pv.notes.map(t => `<div class="warn">${esc(t)}</div>`).join('')}
      ${pv.askSpy ? `<div class="field"><label>Ваше решение: Шпион определяется Горожанином?</label><div class="seg"><button class="${nm.spy ? '' : 'on'}" data-act="nomSpy" data-arg="0">Нет</button><button class="${nm.spy ? 'on' : ''}" data-act="nomSpy" data-arg="1">Да — его казнят</button></div></div>` : ''}
      ${vote ? confirmRow('voteDone', 'Подтвердить голоса', true, 'voteCancel', 'Отменить номинацию')
        : open ? confirmRow('nominate', 'Подтвердить номинацию', (bishop || nm.by) && nm.on, 'nomClear', 'Сбросить') : ''}
      <button class="btn wide" data-act="ringClose">Вернуться к экрану дня</button></div></div>`;
}
const fabledList = () => (S.fabled || []).length ? `<div class="gbluffs"><span class="small muted">Сказочники</span><div>${S.fabled.map(r => `<span class="gbl">${ico(r, 'good', 'gbi')}${esc(E.rname(r))}</span>`).join('')}</div></div>` : '';
/* ---------- публичный выбор днём кругом: Истребитель, Дитя Луны, Растяпа — только имена и места ---------- */
const PICK_RINGS = {
  slay: id => ({ key: 'slay_' + id, title: 'Истребитель: ' + E.nm(S, id), hint: 'Нажмите, в кого стреляет Истребитель. Повторное нажатие снимает выбор.', mid: 'цель', ok: 'slay', okArg: id, okLabel: 'Выстрел', danger: true, extra: slayRegHtml }),
  moonchild: () => ({ key: 'moonchild', title: 'Дитя Луны выбирает', hint: 'Нажмите, кого выбирает Дитя Луны (живого игрока).', mid: 'выбран', ok: 'moonchild', okLabel: 'Записать выбор' }),
  psycho: id => ({ key: 'psycho_' + id, title: 'Психопат выбирает', hint: 'Нажмите, кого публично выбирает Психопат: этот игрок умирает.', mid: 'умирает', ok: 'psychoKill', okArg: id, okLabel: 'Убить', danger: true }),
  klutz: () => ({ key: 'klutz', title: 'Растяпа выбирает', hint: 'Нажмите, кого выбирает Растяпа (живого игрока).', mid: 'выбран', ok: 'klutz', okLabel: 'Записать выбор' }),
};
const pickRingBtn = (kind, arg, chosen) => `<button class="btn ringbtn wide" data-act="ringPickOpen" data-arg="${kind}|${arg}">◯ ${chosen ? 'Изменить выбор — кругом' : 'Выбрать кругом'}</button>`;
// Затворник под выстрелом: решение рассказчика (нейтрально — экран могут увидеть)
const slayRegHtml = t => t && t.role === 'recluse' ? `<div class="field"><label>Ваше решение: цель определяется Демоном?</label><div class="seg"><button class="${S.day.picks.slayReg ? '' : 'on'}" data-act="slayReg" data-arg="0">Нет</button><button class="${S.day.picks.slayReg ? 'on' : ''}" data-act="slayReg" data-arg="1">Да — умрёт</button></div></div>` : '';
function pickRing() {
  const pr = UI.ringPick, r = pr && PICK_RINGS[pr.kind] && PICK_RINGS[pr.kind](pr.arg); if (!r) return '';
  const g = ringGeom(S.players.length, false, 330), selId = (S.day.picks[r.key] || [])[0], t = selId && E.P(S, selId);
  const seats = S.players.map((p, i) => seatHtml(p, i, g, p.id === selId ? 'on' : '', `data-act="dayPick" data-arg="${r.key}|${p.id}" ${p.alive ? '' : 'disabled'}`)).join('');
  return `<div class="ov ringov" role="dialog" aria-label="${esc(r.title)}">
    <div class="ringtop"><span></span><b>${esc(r.title)}</b><button class="wbtn" data-act="ringClose" aria-label="Закрыть">×</button></div>
    <div class="ringbox"><div class="small muted ringhint">${esc(r.hint)}</div>
      <div class="ring" style="${ringStyle(g)}">${seats}<div class="ringmid" style="top:${(g.H / 2).toFixed(2)}cqw">${t ? `<span>${esc(r.mid)}</span><b class="nm">${esc(t.name)}</b>` : '<b class="q">кого?</b>'}</div></div>
      ${r.extra ? r.extra(t) : ''}
      <button class="btn ${r.danger ? 'danger' : 'primary'} wide" data-act="${r.ok}" data-arg="${r.okArg || ''}" ${t ? '' : 'disabled'}>${esc(r.okLabel)}</button>
      <button class="btn wide" data-act="ringClose">Вернуться к экрану дня</button></div></div>`;
}
function ringOverlay() {
  if (UI.ring === 'pick' && S.phase === 'day') return pickRing();
  if (UI.ring === 'seat' && S.phase === 'setup') return seatRing();
  if (UI.ring === 'nom' && S.phase === 'day') return nomRing();
  return '';
}

// Гримуар на весь экран — Шпиону и Вдове в их ночной шаг: только смотреть; жетон можно открыть крупно; закрыть — кнопкой.
// Без имён игроков (только жетоны по кругу, как в настоящем Гримуаре) и без блефов Демона — решения пользователя
function grimOverlay() {
  if (!UI.grimShow || S.phase !== 'night') return '';
  // закрыть можно только невидимой кнопкой в левом нижнем углу — чтобы Шпион не закрыл Гримуар сам и не увидел экран рассказчика
  // (заметка пользователя 2026-10-14); подсказка про нажатие на жетоны остаётся
  return `<div class="ov grimov" role="dialog" aria-label="Гримуар">
    <div class="grimtop"><span></span><b>Гримуар</b><span></span></div>
    <div class="grimbox">${grimCircle()}<div class="small muted gchint">Нажмите на жетон — он откроется крупно</div>${fabledList()}</div>${grimZoomHtml()}
    <button class="grimx" data-act="grimShow" aria-label="Закрыть Гримуар"></button></div>`;
}

// карточка игрока поверх Гримуара (то, что раньше раскрывалось в строке «Стола»)
function sheetOverlay() {
  const p = UI.open && E.P(S, UI.open); if (!p) return '';
  const i = S.players.indexOf(p), off = S.phase !== 'setup' && p.role && E.abilityOff(S, p);
  const toks = p.tokens.map(t => `<span class="badge tok">${markIcon(...tokMark(t))}${t.k === 'shown' ? esc(shownTitle(t))
    : `${esc(E.TOK_RU[t.k] || t.k)}${t.src && DATA.roles[t.src] ? ' · ' + esc(DATA.roles[t.src].name) : ''}${t.note ? ': ' + esc(t.note) : ''}`}</span>`).join('');
  return `<div class="ov sheetov" role="dialog" aria-label="Игрок ${esc(p.name)}"><div class="sheetbg" data-act="openP" data-arg="${p.id}"></div><div class="sheet">
    <div class="sheethead">${p.role ? ico(p.role, p.align, 'si') : ''}<div class="sht"><div class="shp">${i + 1}. ${esc(p.name)}</div>
      <div class="pr t-${team(p.role)}">${p.role ? esc(E.rname(p.role)) : 'без роли'}${E.isTraveller(p) ? ' · Странник' : ''}${p.believes ? ` <span class="muted">(считает себя: ${esc(E.rname(p.believes))})</span>` : ''}${p.gained ? ` <span class="muted">(способность: ${esc(E.rname(p.gained))})</span>` : ''}</div></div>
      <button class="btn sq" data-act="openP" data-arg="${p.id}" aria-label="Закрыть">×</button></div>
    <div class="badges left"><span class="badge ${p.align}">${p.align === 'good' ? 'добрый' : 'злой'}</span>${p.alive ? '' : `<span class="badge dead">${art('dead', 'bd')}мёртв${p.ghost ? ' · голос' : ''}</span>`}${off ? `<span class="badge poisonb k-${offKind(off)}">${distIcon(offKind(off))}${esc(off)}</span>` : ''}${toks}</div>
    ${!p.alive && p.deathNote ? `<div class="small muted">Причина смерти: ${esc(p.deathNote)}</div>` : ''}
    ${p.role ? `<div class="small">${esc(DATA.roles[seenRole(p)] ? DATA.roles[seenRole(p)].ability : '')}</div>
      <button class="btn showbtn" data-act="showRole" data-arg="${p.id}">Показать игроку его роль на весь экран${seenRole(p) !== p.role ? ` (${esc(E.rname(seenRole(p)))})` : ''}</button>` : ''}
    ${S.phase === 'setup' && !p.role && !E.isTraveller(p) ? assignHtml(p) : editorHtml(p)}</div></div>`;
}

/* ---------- выдача ролей: древняя каменная стена с рунами (как мешочек с жетонами) ---------- */
// руны: часть — старшие футарк-подобные знаки, часть — знаки «в духе Лавкрафта» (Старший знак, глаз, щупальца, сферы)
const RUNES = [
  'M18 8V40M18 16L30 8M18 24L32 15', 'M24 8V40M24 22L13 10M24 22L35 10', 'M24 6L34 18L24 30L14 18ZM18 26L10 40M30 26L38 40', 'M18 8V40M18 14L30 24L18 34',
  'M24 5L29.5 18.5L44 19L32.5 28L36.5 42L24 34L11.5 42L15.5 28L4 19L18.5 18.5ZM24 20a4 4 0 1 0 0.1 0', 'M8 24Q24 9 40 24Q24 39 8 24ZM24 19a5 5 0 1 0 0.1 0M24 4V10M24 38V44',
  'M12 40C12 26 30 30 30 20C30 12 20 12 20 18C20 22 26 22 26 19M30 40C30 34 36 32 36 26', 'M16 8L30 18L18 30L32 40', 'M24 6L36 24L24 42L12 24ZM24 16V32',
  'M10 10V38L38 10V38Z', 'M14 8V40M34 8V40M14 18L34 30', 'M24 8V40M12 20L24 8L36 20', 'M14 8V40M34 8V40M14 8L34 24M34 8L14 24',
  'M12 18a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M24 30a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M10 36a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M22 22L28 26M16 24L14 32',
  'M16 15Q24 4 32 15Q34 22 28 24M20 24Q14 22 16 15M20 24Q18 34 13 41M24 24V42M28 24Q30 34 35 41M21 14a1.5 1.5 0 1 0 0.1 0M27 14a1.5 1.5 0 1 0 0.1 0',
  'M31 8A16 16 0 1 0 31 40A12 12 0 1 1 31 8ZM34 24a2.5 2.5 0 1 0 0.1 0', 'M24 42V14M14 8V18Q14 25 24 25Q34 25 34 18V8M24 6V14', 'M38 24A14 14 0 1 1 30 11.5M30 11.5L37 10M30 11.5L33 17.5',
  'M24 22V42M16 31H32M24 22C14 18 17 6 24 6C31 6 34 18 24 22', 'M14 8H34L14 40H34ZM24 22a2 2 0 1 0 0.1 0', 'M24 24H30V18H18V30H36V12H12V36', 'M14 10C25 10 25 22 14 22M14 22C25 22 25 34 14 34M32 8V40',
  'M32 8L16 24L32 40M22 24H38', 'M24 8V40M15 20L33 29M24 8a4 4 0 1 0 0.1 0'];
const CRACKS = ['M24 1L21 14L27 21L19 31L23 47M27 21L38 25L47 22M21 14L8 9', 'M1 18L14 21L20 30L31 27L47 34M20 30L17 47M31 27L34 3', 'M31 1L26 16L33 25L24 34L28 47M26 16L12 18L2 28M33 25L46 20'];
function drawCard() {
  const core = S.players.filter(p => !E.isTraveller(p)), d = S.draw, ok = core.length >= 5 && core.length <= 15;
  const left = d ? d.cells.filter(c => !c.pid).length : 0, held = core.filter(p => p.role).length, prob = !d && E.drawProblem(S);
  const src = (E.validPool(S) ? 'В мешочке — выбранные «Роли на игру».' : 'Роли на игру не выбраны — приложение наберёт их по раскладке случайно.')
    + (held && !d ? ` Роли, уже выданные игрокам (${held}), останутся за ними.` : '');
  // кто ещё не открыл ячейку: нажатие — карточка игрока, там можно назначить роль или тип роли
  const waiting = d && !d.finished ? core.filter(p => !p.role) : [], hid = rolesHidden();
  // роли открыты — можно снова закрыть «шторкой» (например, перед тем как снова выкатить стену)
  const hideBtn = d && !hid ? '<button class="btn" data-act="rolesHide">Скрыть роли</button>' : '';
  const cr = cryptOn(); // «Хэллоуин»: вместо стены — склеп с сундуками
  return `<div class="card drawcard"><h3>Выдача ролей · ${cr ? 'склеп' : 'каменная стена'}</h3>
    <div class="small muted">${cr
      ? `Игроки по кругу открывают сундуки со светящимися рунами — как тянут жетон из мешочка: роли разложены по сундукам в случайном порядке, и какой сундук игрок выберет, ту роль и получит. Где какая роль, не видит никто, и вы тоже. ${src} Пока игрок не открыл сундук, в его карточке можно назначить роль или тип роли — назначенное выпадет ему из любого сундука. Пьяница увидит роль, которой себя считает. Свернуть склеп — невидимой кнопкой в <b>левом нижнем углу</b> экрана; после него роли на экране закрыты, пока вы не нажмёте «Показать роли».`
      : `Игроки по кругу открывают светящиеся ячейки — как тянут жетон из мешочка: роли разложены по ячейкам в случайном порядке, и какую ячейку игрок выберет, ту роль и получит. Где какая роль, не видит никто, и вы тоже. ${src} Пока игрок не открыл ячейку, в его карточке можно назначить роль или тип роли — назначенное выпадет ему из любой ячейки. Пьяница увидит роль, которой себя считает. Свернуть стену — невидимой кнопкой в <b>левом нижнем углу</b> экрана; после неё роли на экране закрыты, пока вы не нажмёте «Показать роли».`}</div>
    ${!ok ? '<div class="warn">Нужно от 5 до 15 игроков (без Странников).</div>'
      : d && d.finished ? `<div class="note-ok">Роли выданы жребием. Заново их не раздать; роль можно сменить только на роль сценария, которой нет в игре.</div>${hideBtn}`
      : d ? `<div class="note-ok">Жребий идёт: осталось ${cr ? 'сундуков' : 'ячеек'} — ${left}. Очередь: ${esc(E.nm(S, d.turn))}</div>
        ${waiting.length ? `<div class="flabel"><span>Ещё не открыли — нажмите, чтобы назначить роль или тип</span></div><div class="seg">${waiting.map(p => `<button data-act="openP" data-arg="${p.id}">${esc(p.name)}${!hid && (S.assign || {})[p.id] ? ' → ' + esc(assignLabel(S.assign[p.id])) : ''}</button>`).join('')}</div>` : ''}
        <div class="row"><button class="btn primary" data-act="wallShow">Продолжить жребий</button><button class="btn danger" data-act="drawCancel">Отменить жребий</button>${hideBtn}</div>`
      : prob ? `<div class="warn">${esc(prob)}</div>`
      : `<button class="btn primary wide" data-act="drawStart">${cr ? 'Открыть склеп' : 'Выкатить стену'}</button>`}</div>`;
}

// «Роли на игру»: рассказчик отмечает роли сценария; раздача и жребий берут только их (по числу игроков)
const TEAM_PL = { townsfolk: 'Горожане', outsider: 'Изгои', minion: 'Приспешники', demon: 'Демоны' };
function poolCard() {
  if (S.draw) return '';
  const n = S.players.filter(p => !E.isTraveller(p)).length; if (n < 5 || n > 15) return '';
  const pool = S.pool || [], d = E.distribution(n, pool.concat(S.fabled || []), S.flags.mods, E.scriptOutsiders(S));
  const cnt = t => pool.filter(r => team(r) === t).length, good = cnt('townsfolk') + cnt('outsider');
  const MOD_RU = { '-1': '−1 Изгой', 0: 'без изменений', 1: '+1 Изгой' };
  const stat = ['townsfolk', 'outsider', 'minion', 'demon'].map(t => {
    const bad = d.free && (t === 'townsfolk' || t === 'outsider') ? good !== d.townsfolk + d.outsider : cnt(t) !== d[t];
    return `<span class="pstat ${bad ? 'bad' : 'okc'}">${E.TEAM_RU[t]}: ${cnt(t)} из ${d[t]}</span>`; }).join('');
  const groups = ['townsfolk', 'outsider', 'minion', 'demon'].map(t => {
    const rs = S.script.roles.filter(r => team(r) === t); if (!rs.length) return '';
    return `<div class="poolgrp"><div class="small muted">${TEAM_PL[t]}</div><div class="pooltiles">${rs.map(r => `<button class="ptok ${pool.includes(r) ? 'on' : ''}" data-act="poolToggle" data-arg="${r}" aria-pressed="${pool.includes(r)}">${ico(r, null, 'pti')}<span>${esc(E.rname(r))}</span></button>`).join('')}</div></div>`; }).join('');
  const choices = d.choices.map(c => `<div class="field ${c.value === null ? 'ask' : ''}"><label>${esc(E.rname(c.id))}: ${c.value === null ? 'выберите, сколько Изгоев' : 'Изгоев'}</label>
    <div class="seg">${c.opts.map(v => `<button class="${c.value === v ? 'on' : ''}" data-act="outMod" data-arg="${c.id}|${v}">${MOD_RU[v]}</button>`).join('')}</div></div>`).join('');
  return `<div class="card"><details class="pooldet" ${pool.length ? 'open' : ''}><summary><b>Роли на игру</b> <span class="small muted">${pool.length ? `выбрано ${pool.length} из ${n}` : 'не выбраны — раздача случайная по раскладке'}</span></summary>
    <div class="small muted">Отметьте роли, которые будут в игре: случайная раздача и жребий возьмут только их. Блефы Демона наберутся из остальных добрых ролей.</div>
    <div class="pstats">${stat}</div>${choices}${d.notes.length ? `<div class="small muted">${d.notes.map(esc).join('<br>')}</div>` : ''}
    ${pool.length && pool.length !== n ? `<div class="warn">Нужно ровно ${n} ролей — по числу игроков (без Странников).</div>` : ''}
    ${pool.includes('huntsman') && !pool.includes('damsel') ? '<div class="warn">Егерь в игре — добавьте Девицу.</div>' : ''}
    ${groups}<div class="row"><button class="btn" data-act="poolRandom">Случайный набор</button>${pool.length ? '<button class="btn" data-act="poolClear">Очистить</button>' : ''}</div></details></div>`;
}

// назначение для жребия и раздачи: конкретная роль или тип роли (по умолчанию — случайно)
const assignLabel = a => !a ? '' : a.role ? E.rname(a.role) : E.TEAM_RU[a.team];
const assignBadge = p => { const a = (S.assign || {})[p.id]; return a ? `<span class="gassign">→ ${esc(assignLabel(a))}</span>` : ''; };
function assignHtml(p) {
  const as = S.assign || {}, cur = as[p.id], taken = Object.entries(as).filter(([id, a]) => id !== p.id && a.role).map(([, a]) => a.role);
  // только из «Ролей на игру» (во время жребия — из того, что осталось в мешочке); роли, выданные или назначенные другим, — нет
  const src = S.draw && !S.draw.finished ? S.draw.bag : (S.pool && S.pool.length ? S.pool : S.script.roles);
  const roles = src.filter(r => DATA.roles[r] && r !== 'marionette' && !taken.includes(r) && !S.players.some(q => q.role === r)); // Марионетку выбирают после раздачи
  const teams = ['townsfolk', 'outsider', 'minion', 'demon'].filter(t => roles.some(r => team(r) === t));
  const opt = (v, l) => `<option value="${v}" ${(cur ? (cur.role ? 'r:' + cur.role : 't:' + cur.team) : '') === v ? 'selected' : ''}>${esc(l)}</option>`;
  return `<div class="editor"><div class="field"><label>Что выпадет игроку на жребии и при раздаче</label>
    <select data-act="assign" data-arg="${p.id}">${opt('', 'Случайно (по умолчанию)')}
      ${teams.length ? `<optgroup label="Тип роли">${teams.map(t => opt('t:' + t, 'Любой: ' + E.TEAM_RU[t])).join('')}</optgroup>` : ''}
      ${['townsfolk', 'outsider', 'minion', 'demon'].map(t => { const rs = roles.filter(r => team(r) === t); return rs.length ? `<optgroup label="${TEAM_PL[t]}">${rs.map(r => opt('r:' + r, E.rname(r))).join('')}</optgroup>` : ''; }).join('')}
    </select></div><div class="small muted">${cryptOn() ? 'Какой сундук склепа' : 'Какую ячейку стены'} игрок ни откроет — выпадет назначенное. Только из ролей на игру; роли, выданные или назначенные другим, здесь не предлагаются.</div></div>`;
}
/* «Хэллоуин»: склеп вместо стены (просьба пользователя 2026-10-18). Ячейка — сундук: короб и крышка отдельными картинками (крышка
   распахивается), руна — на замке; после выдачи — открытый пустой сундук с паутиной. При открытии из сундука вылетает случайная нечисть */
const HFX = ['ghost', 'bats', 'skull', 'raven', 'wisps'];
const cryptOn = () => UI.skin === 'hallow' && HAS_ART('h_chest_box') && HAS_ART('h_crypt');
const hChest = () => '<span class="hchest" aria-hidden="true"><i class="hbox"></i><i class="hlid"></i><i class="hopen"></i></span>';
// геометрия сундука (prep_art.halloween → meta.hallow.chest): короб и крышка в долях закрытого сундука
function hChestVars() {
  const c = (typeof ART_META !== 'undefined' && ART_META.hallow && ART_META.hallow.chest) || { w: 485, h: 375, box: [0, .11, 1, .89], lid: [0, 0, 1, .46] }, pc = v => (v * 100).toFixed(2) + '%';
  return `--hca:${c.w} / ${c.h};--hbx:${pc(c.box[0])};--hby:${pc(c.box[1])};--hbw:${pc(c.box[2])};--hbh:${pc(c.box[3])};--hlx:${pc(c.lid[0])};--hly:${pc(c.lid[1])};--hlw:${pc(c.lid[2])};--hlh:${pc(c.lid[3])}`;
}
// склеп: туман, свечи и тыквы по углам (поверх фона, под сундуками)
const cryptDecor = () => `<div class="hcrypt" aria-hidden="true"><i class="hfog"></i>
  <span class="hcorner l"><i class="hpump" style="background-image:var(--a-h-pumpkin1)"></i><span class="hcand"><i class="hstick"></i><i class="hcf"></i></span></span>
  <span class="hcorner r"><span class="hcand"><i class="hstick"></i><i class="hcf"></i></span><i class="hpump" style="background-image:var(--a-h-pumpkin3)"></i></span></div>`;
// нечисть, вылетающая из сундука: место — центр сундука (UI.openPos), куда лететь — в сторону от края (--dir). Летит её код (cryptFly)
const hSprite = (k, cls) => { const m = (typeof ART_META !== 'undefined' && ART_META.hallow && ART_META.hallow[k]) || { n: k === 'bat' ? 6 : 4, w: 1, h: 1 };
  return { n: m.n, ar: m.w / m.h, html: `<i class="hspr ${cls}" style="width:${m.n * 100}%"></i>` }; };
function cryptFx() {
  const pos = UI.openPos || { x: 180, y: 300, dir: 1 }, fx = UI.openFx || 'ghost';
  const ghosts = [1, 2, 3, 4].filter(i => ART['h_ghost' + i]), souls = [1, 2, 3, 4, 5, 6].filter(i => ART['h_soul' + i]);
  const bat = hSprite('bat', 'hs-bat'), rav = hSprite('raven', 'hs-rav');
  const body = fx === 'ghost' ? `<i class="hcre"><i class="hflip">${ghosts.map(i => `<img class="hgp" src="${ART['h_ghost' + i]}" alt="">`).join('')}</i></i>`
    : fx === 'bats' ? [1, 2, 3, 4, 5, 6].map(() => `<i class="hbatf" style="width:${Math.round(84 * bat.ar)}px;height:84px;margin:-42px 0 0 ${-Math.round(42 * bat.ar)}px">${bat.html}</i>`).join('')
      : fx === 'skull' ? `<i class="hcre hsku"><i class="hflip"><i class="hfl"></i><img class="hsk" src="${ART.h_skull}" alt=""></i></i>`
        : fx === 'raven' ? [1, 2].map(() => `<i class="hrav" style="width:${Math.round(150 * rav.ar)}px;height:150px;margin:-75px 0 0 ${-Math.round(75 * rav.ar)}px"><i class="hflip">${rav.html}</i></i>`).join('')
          // души (если нарисованы; четыре разных лица из шести) или болотные огоньки
          : souls.length ? souls.map(n => [hRand((UI.openAt || 7) + n)(), n]).sort((a, b) => a[0] - b[0]).slice(0, 4).map(([, n]) => `<i class="hwi soul" style="--m:var(--a-h-soul${n})"></i>`).join('')
            : [1, 2, 3, 4, 5].map(i => `<i class="hwi" style="--m:var(--a-h-wisp${i})"></i>`).join('');
  return `<div class="hfx fx-${fx}" aria-hidden="true" data-fx="${fx}" data-x="${pos.x}" data-y="${pos.y}" data-dir="${pos.dir}" style="--x:${pos.x}px;--y:${pos.y}px;--dir:${pos.dir}"><i class="hburst"></i><i class="hsm s1"></i><i class="hsm s2"></i>${body}</div>`;
}
/* Полёт нечисти — кодом (Web Animations). Путь — плавная кривая через опорные точки, ключевые кадры через ~30 мс и линейно между
   ними: скорость меняется без рывков (заметка пользователя 2026-10-18 «анимации рваные»: у CSS-кадров замедление было в каждом
   отрезке — нечисть почти останавливалась на стыках). Двигаются только transform и opacity — их ведёт видеокарта, без перерисовки */
const hClamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hRamp = (u, a, b) => hClamp((u - a) / (b - a), 0, 1);
const hSmooth = t => t * t * (3 - 2 * t);
// случайность от времени открытия сундука: перерисовка экрана посреди полёта даёт тот же путь
function hRand(seed) { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// кривая Катмулла — Рома: проходит через все точки, на стыках скорость непрерывна
function hSpline(P, t) {
  const n = P.length - 1, f = hClamp(t, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), u = f - i;
  const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n, i + 2)];
  const c = k => .5 * (2 * p1[k] + (p2[k] - p0[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * u * u * u);
  return [c(0), c(1)];
}
// точка пути и направление полёта (vx, vy — к следующей точке)
function hAt(P, t) { const a = hSpline(P, t), b = hSpline(P, Math.min(1, t + .012)), c = hSpline(P, Math.max(0, t - .012)); return { x: a[0], y: a[1], vx: b[0] - c[0], vy: b[1] - c[1] }; }
const hHead = (v, dir, lim) => hClamp(Math.atan2(v.vy, v.vx * dir || 1e-6) * 180 / Math.PI, -lim, lim) * dir; // наклон носом по полёту
// f(u) → { x, y, r, s | sx, sy, o } при u от 0 до 1
function hAnim(el, f, dur, delay) {
  if (!el || !el.animate) return null;
  const n = Math.max(12, Math.round(dur / 30)), kf = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, v = f(u), sx = v.sx != null ? v.sx : v.s != null ? v.s : 1, sy = v.sy != null ? v.sy : sx;
    kf.push({ offset: u, opacity: v.o != null ? +hClamp(v.o, 0, 1).toFixed(3) : 1,
      transform: `translate(${(v.x || 0).toFixed(1)}px,${(v.y || 0).toFixed(1)}px) rotate(${(v.r || 0).toFixed(2)}deg) scale(${sx.toFixed(3)},${sy.toFixed(3)})` });
  }
  return el.animate(kf, { duration: dur, delay: delay || 0, fill: 'both', easing: 'linear' });
}
const hFade = (el, f, dur, delay) => el && el.animate && el.animate([...Array(Math.max(12, Math.round(dur / 30)) + 1)].map((_, i, a) => ({ offset: i / (a.length - 1), opacity: +hClamp(f(i / (a.length - 1)), 0, 1).toFixed(3) })), { duration: dur, delay: delay || 0, fill: 'both', easing: 'linear' });
// взмахи крыльев: полоса из n кадров сдвигается целыми кадрами (steps), тоже transform
function hFlap(el, n, dur, off) {
  if (!el || !el.animate || n < 2) return;
  const a = el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }], { duration: dur, iterations: Infinity, easing: `steps(${n}, end)` });
  a.currentTime = off || 0;
}
const hFadeIO = (u, i, o) => Math.min(hRamp(u, 0, i), 1 - hRamp(u, o, 1));
function cryptFly(fx) {
  if (fx.dataset.on || !fx.animate) return; fx.dataset.on = '1';
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const W = fx.clientWidth, H = fx.clientHeight, dir = +fx.dataset.dir || 1, x0 = +fx.dataset.x, y0 = +fx.dataset.y, kind = fx.dataset.fx;
  const R = hRand(UI.openAt || 7), rnd = (a, b) => a + R() * (b - a), D = 300; // вылетает, когда крышка уже откинута
  const N = { bat: hSprite('bat').n, raven: hSprite('raven').n };
  if (kind === 'ghost') {
    // выныривает из сундука (вытянут), уходит в сторону, покачиваясь, — и бросается на зрителя, вырастая и растворяясь
    // банши (4 позы: выныривает / летит / кричит / рассыпается): чаще бросается на зрителя с криком, иногда уносится и рассыпается на лету
    const g = fx.querySelector('.hcre'), poses = [...fx.querySelectorAll('.hgp')], flee = poses.length >= 4 && R() < .35, dur = flee ? 1650 : 1750;
    const lx = (W / 2 - x0) * .9, ly = H * .42 - y0; // бросок — в середину экрана, на зрителя
    const P = flee ? [[0, 24], [dir * 6, -50], [dir * 40, -118], [dir * 110, -160], [dir * W * .45, -H * .3], [dir * W * .8, -H * .42]]
      : [[0, 24], [dir * 6, -50], [dir * 38, -118], [dir * 92, -150], [dir * 70 + lx * .3, -150 + (ly + 150) * .4], [lx, ly]];
    hAnim(g, u => { const v = hAt(P, u), L = flee ? 0 : hRamp(u, .64, 1), big = 1 + 2.3 * Math.pow(L, 1.6), sway = Math.sin(u * Math.PI * 3.2) * (1 - L), grow = flee ? 1 + .25 * hRamp(u, .5, 1) : 1;
      return { x: v.x + sway * 7, y: v.y, r: sway * 6 + hClamp(v.vx * dir * .35, -10, 10) * dir * (1 - L) + Math.sin(L * 40) * 4 * L,
        sx: (.55 + .45 * hSmooth(hRamp(u, 0, .22))) * big * grow, sy: (1.5 - .5 * hSmooth(hRamp(u, 0, .22))) * big * grow, o: hFadeIO(u, .07, flee ? .8 : .9) }; }, dur, D);
    // позы сменяются плавно (наплывом), а не скачком; [начало, конец] доли полёта, null — поза не показывается
    const win = poses.length < 4 ? [[0, .26], [.26, .64], [.64, 1]] : flee ? [[0, .26], [.26, .62], null, [.62, 1]] : [[0, .26], [.26, .6], [.6, 1], null];
    poses.forEach((im, i) => { const wi = win[i], w = .09, last = win.slice(i + 1).every(x => !x);
      hFade(im, u => !wi ? 0 : (i === 0 ? 1 : hRamp(u, wi[0] - w / 2, wi[0] + w / 2)) * (last ? 1 : 1 - hRamp(u, wi[1] - w / 2, wi[1] + w / 2)), dur, D); });
    // крик: склеп вздрагивает, когда призрак бросается
    const sc = document.querySelector('.crypt .wscroll');
    if (sc && !flee) sc.animate([0, 1, 2, 3, 4, 5, 6].map(i => ({ transform: i % 6 ? `translate(${(i % 2 ? 4 : -4) * (1 - i / 7)}px, ${(i % 3 - 1) * 2}px)` : 'none' })), { duration: 320, delay: D + dur * .66, easing: 'linear' });
  } else if (kind === 'bats') {
    // стая вырывается веером в сторону полёта; каждая по своей дуге, с креном на поворотах
    fx.querySelectorAll('.hbatf').forEach((b, i) => {
      const ang = (-90 + dir * 32 + (i - 2.5) * 23 + rnd(-7, 7)) * Math.PI / 180, dist = Math.hypot(W, H) * rnd(.7, .95);
      const ex = Math.cos(ang) * dist, ey = Math.sin(ang) * dist, side = rnd(-1, 1) * 70;
      const P = [[0, 12], [rnd(-14, 14), -46], [ex * .3 - ey * side / dist, ey * .3 + ex * side / dist - 20], [ex * .65, ey * .65], [ex, ey]];
      const dur = rnd(1100, 1350);
      // вырываются из сундука быстро (t обгоняет время в начале), дальше летят ровно
      hAnim(b, u => { const t = 1 - Math.pow(1 - u, 1.35), v = hAt(P, t), sp = Math.abs(v.vx) + Math.abs(v.vy) + 1e-6;
        return { x: v.x, y: v.y + Math.sin(u * 26 + i) * 3, r: hClamp(v.vx / sp * 28, -28, 28), s: .35 + .65 * hSmooth(hRamp(u, 0, .35)), o: hFadeIO(u, .06, .9) }; }, dur, D + i * 40 + rnd(0, 30));
      hFlap(b.querySelector('.hspr'), N.bat, rnd(300, 380), rnd(0, 400));
    });
  } else if (kind === 'skull') {
    // череп взмывает, ныряет и уносится; нос — по полёту, пламя хвостом позади и дрожит
    const s = fx.querySelector('.hcre'), dur = 1550;
    const P = [[0, 16], [dir * 12, -95], [dir * 85, -165], [dir * 155, -140], [dir * (W * .45), -H * .3], [dir * (W * .85), -H * .55]];
    hAnim(s, u => { const v = hAt(P, .25 * hSmooth(u) + .75 * u);
      return { x: v.x, y: v.y, r: hHead(v, dir, 50) + Math.sin(u * Math.PI * 4) * 5, s: .3 + .7 * hSmooth(hRamp(u, 0, .3)), o: hFadeIO(u, .06, .88) }; }, dur, D);
    const fl = fx.querySelector('.hfl');
    if (fl) fl.animate([1, 1.14, .93, 1.08, .97, 1].map((k, i) => ({ transform: `scale(${-k}, ${(2 - k).toFixed(2)})`, offset: i / 5 })), { duration: 460, iterations: Infinity, easing: 'ease-in-out' });
  } else if (kind === 'raven') {
    // два ворона уходят вверх широкими дугами, второй — чуть позже и дальше (меньше)
    fx.querySelectorAll('.hrav').forEach((b, i) => {
      const far = i ? .78 : 1, ex = dir * W * (i ? .45 : .8), ey = -H * (i ? .7 : .55);
      const P = [[0, 10], [dir * (i ? -10 : 18), -70], [ex * .35, ey * .35 - 30], [ex * .7, ey * .68], [ex, ey]];
      hAnim(b, u => { const v = hAt(P, .6 * u + .4 * u * u);
        return { x: v.x, y: v.y, r: hHead(v, dir, 35), s: far * (.35 + .65 * hSmooth(hRamp(u, 0, .4))), o: hFadeIO(u, .08, .9) }; }, rnd(1400, 1600), D + i * 200);
      hFlap(b.querySelector('.hspr'), N.raven, N.raven > 4 ? 520 : 440, i * 170);
    });
  } else {
    // огоньки / души: спираль вокруг сундука (ближняя сторона крупнее и ярче), души растут, будто летят к зрителю, и разлетаются; свет мерцает
    const ws = [...fx.querySelectorAll('.hwi')], soul = ws.length && ws[0].classList.contains('soul');
    ws.forEach((w, i) => {
      const ph = i * Math.PI * 2 / ws.length + rnd(0, .6), turns = soul ? rnd(.9, 1.2) : rnd(1.3, 1.8), rise = Math.min(y0 + (soul ? 140 : 80), H * (soul ? .85 : .7));
      const out = rnd(-1, 1) * W * (soul ? .45 : .35), R0 = soul ? 26 : 16, R1 = soul ? 104 : 66;
      const pos = u => { const th = ph + dir * u * turns * Math.PI * 2, rad = R0 + R1 * hSmooth(hRamp(u, 0, .5)), up = .15 * u + .85 * u * u;
        return [Math.sin(th) * rad + out * u * u * u, 12 - rise * up, Math.cos(th)]; };
      hAnim(w, u => { const [x, y, z] = pos(u), [x2] = pos(Math.min(1, u + .02)), near = (z + 1) / 2;
        return { x, y, r: hClamp((x2 - x) * -2.2, -30, 30),
          s: soul ? (.65 + .35 * near) * (.45 + .8 * hSmooth(hRamp(u, 0, .65))) : (.55 + .35 * near) * (.4 + .6 * hSmooth(hRamp(u, 0, .2))),
          o: hFadeIO(u, .08, soul ? .86 : .82) * (soul ? .78 + .22 * near : .55 + .45 * near) * (.88 + .12 * Math.sin(u * 47 + i * 2.1)) }; }, soul ? rnd(1650, 1900) : rnd(1550, 1850), D + i * (soul ? 90 : 70));
    });
  }
}
// летучие мыши заставки: вылетают из двери склепа в разные стороны
function splashFly() {
  const sp = document.querySelector('.splash'); if (!sp || sp.dataset.on) return; sp.dataset.on = '1';
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const W = sp.clientWidth, H = sp.clientHeight, n = hSprite('bat').n;
  sp.querySelectorAll('.hsbat').forEach((b, i) => {
    const d = i % 2 ? 1 : -1, ex = d * W * (.55 + i * .06), ey = -H * (.25 + (i % 3) * .1);
    const P = [[0, 0], [d * 20, -30], [ex * .4, ey * .3 + 20], [ex, ey]];
    hAnim(b, u => { const v = hAt(P, .5 * u + .5 * u * u), sp2 = Math.abs(v.vx) + Math.abs(v.vy) + 1e-6;
      return { x: v.x, y: v.y + Math.sin(u * 20 + i) * 3, r: hClamp(v.vx / sp2 * 25, -25, 25), s: .25 + .75 * hSmooth(hRamp(u, 0, .6)), o: hFadeIO(u, .1, .88) }; }, 1500 + i * 120, 150 + i * 220);
    hFlap(b.querySelector('.hspr'), n, 340 + i * 30, i * 90);
  });
}
// после перерисовки: запустить полёты; экран перерисовался посреди полёта — всё в раскрытии продолжается с того же места
function hallowAfter() {
  if (UI.skin !== 'hallow') return;
  if (UI.splash) splashFly();
  const fx = document.querySelector('.hfx'); if (!fx || fx.dataset.on) return;
  cryptFly(fx);
  const el = UI.openAt ? Date.now() - UI.openAt : 0;
  if (el > 60) document.querySelectorAll('.wreveal, .wcell.opened').forEach(n => n.getAnimations && n.getAnimations({ subtree: true }).forEach(a => { try { a.currentTime = el; } catch (e) { /* анимация без времени */ } }));
}
function wallOverlay() {
  const d = S.draw; if (!UI.wall || !d) return '';
  const turn = d.turn && E.P(S, d.turn), open = d.open !== null ? d.cells[d.open] : null, crypt = cryptOn();
  const cells = d.cells.map((c, i) => {
    const used = !!c.pid, crack = c.done && !HAS_ART('tablet_cracked') ? `<svg class="crack" viewBox="0 0 48 48" aria-hidden="true" style="transform:rotate(${(i * 67) % 360}deg)"><path d="${CRACKS[i % 3]}"/></svg>` : '';
    // руна: рисованная маска (24 знака из runes.png) или запасной SVG
    const rune = HAS_ART('rune0') ? `<span class="runeg" aria-hidden="true"><i class="runei" style="--rm:var(--a-rune${c.glyph % 24})"></i></span>`
      : `<svg class="rune" viewBox="0 0 48 48" aria-hidden="true"><path d="${RUNES[c.glyph % RUNES.length]}"/></svg>`;
    return `<button class="wcell c-${c.color} ${c.done ? 'done' : ''} ${UI.cracking === i ? 'cracking' : ''} ${d.open === i ? 'opened' : ''}" data-act="drawOpen" data-arg="${i}" ${used || !turn ? 'disabled' : ''} aria-label="${used ? (crypt ? 'Открытый сундук' : 'Открытая ячейка') : (crypt ? 'Сундук ' : 'Ячейка ') + (i + 1)}" style="--d:${(i * 0.37) % 2.4}s">
      ${crypt ? hChest() : ''}${rune}${crack}</button>`;
  }).join('');
  const others = d.order.filter(id => (id === d.turn || !d.cells.some(c => c.pid === id)) && E.P(S, id)); // кто ещё не открывал (и тот, чья ячейка открыта сейчас)
  const who = crypt ? 'Сундук открывает' : 'Ячейку открывает';
  // свернуть стену — невидимой кнопкой в левом нижнем углу (.grimx, как у Гримуара Шпиона): игроки не закроют её случайно
  // и не увидят чужих ролей на экране рассказчика (заметка пользователя 2026-10-16)
  return `<div class="ov wallov ${crypt ? 'crypt' : ''} ${crypt && open ? 'busy' : ''}" role="dialog" aria-label="${crypt ? 'Склеп' : 'Каменная стена'}: выдача ролей">
    <div class="wall ${UI.wallAnim ? 'roll' : ''}" ${crypt ? `style="${hChestVars()}"` : ''}>${crypt ? cryptDecor() : ''}<div class="wscroll">
      <div class="wtop"><span aria-hidden="true"></span>
        <div class="wturn">${!turn ? '<b>Все роли выданы</b>' : others.length > 1
          // очередь по кругу; другой игрок — выбором из списка (компактно, не занимает экран)
          ? `<label for="wsel">${who}</label><span class="wsel"><select id="wsel" data-act="drawTurn" aria-label="${crypt ? 'Кто открывает сундук' : 'Кто открывает ячейку'}" ${d.open !== null ? 'disabled' : ''}>${others.map(id => `<option value="${id}" ${id === d.turn ? 'selected' : ''}>${esc(E.nm(S, id))}</option>`).join('')}</select><span aria-hidden="true">▾</span></span>`
          : `<span>${who}</span><b>${esc(turn.name)}</b>`}</div>
        <button class="wbtn" data-act="undo" ${HISTORY.length ? '' : 'disabled'} aria-label="Отменить последнее">↶</button></div>
      <div class="wgrid">${cells}</div>
      <div class="whint">${turn ? (crypt ? 'Нажмите на сундук со светящейся руной' : 'Нажмите на светящуюся ячейку') : 'Все роли выданы. Верните телефон рассказчику'}</div>
    </div></div>
    <button class="grimx" data-act="wallHide" aria-label="${crypt ? 'Свернуть склеп' : 'Свернуть стену'}"></button>
    ${open ? (() => { const op = E.P(S, open.pid), r = (op && seenRole(op)) || E.drawShown(open), al = isGoodRole(r) ? 'good' : 'evil';
      // ячейка «распахивается»: роль вырастает из её места на стене; за иконкой — вспышка и магический круг цвета её рун.
      // Имени нет — только «Ваша роль»; закрыть можно через 2 секунды (подсказка появляется тогда же)
      const col = d.open % 3, row = Math.floor(d.open / 3);
      return `<div class="wreveal side-${al} c-${open.color}" data-act="drawClose" role="dialog" aria-label="Ваша роль" style="transform-origin:${Math.round((col + 0.5) / 3 * 100)}% ${170 + row * 122}px">
        ${crypt ? cryptFx() : ''}<div class="wrfor">Ваша роль</div>
        <div class="wrart">${HAS_ART('fx_circle') ? '<i class="fxc"></i>' : ''}${HAS_ART('fx_open') ? '<i class="fxo"></i>' : ''}${ico(r, al, 'wric')}</div><div class="wrname">${esc(E.rname(r))}</div>
        <div class="wrteam">${esc(E.TEAM_RU[team(r)] || '')} · ${al === 'good' ? 'добро' : 'зло'}</div><div class="wrab">${esc(DATA.roles[r].ability)}</div>
        <div class="shhint wrlater">${crypt ? 'Запомните роль и нажмите — сундук закроется' : 'Запомните роль и нажмите — ячейка закроется'}</div></div>`; })() : ''}</div>`;
}

function editorHtml(p) {
  const tokKinds = ['poisoned', 'drunk', 'protected', 'cursed', 'safe', 'mad', 'bad', 'note'];
  return `<div class="editor">
    <div class="field"><label>Роль${E.isTraveller(p) ? '' : ' — только роли сценария, которых нет в игре'}</label><select data-act="edRole" data-arg="${p.id}" ${S.draw && !S.draw.finished ? 'disabled' : ''}>${E.isTraveller(p) ? plainOptions(DATA.travellers, p.role) : roleOptions(freeRole(p), p.role)}</select></div>
    ${p.alive && S.phase !== 'setup' ? `<div class="row" style="flex-wrap:nowrap"><input type="text" id="edWhy-${p.id}" placeholder="Причина смерти (необязательно)" aria-label="Причина смерти ${esc(p.name)}">
      <button class="btn danger" data-act="edKill" data-arg="${p.id}">Убить</button></div>` : ''}
    <div class="seg">${p.alive ? '' : `<button data-act="edAlive" data-arg="${p.id}">Воскресить</button>`}
      <button data-act="edAlign" data-arg="${p.id}">Сделать ${p.align === 'good' ? 'злым' : 'добрым'}</button>
      ${p.alive ? '' : `<button data-act="edGhost" data-arg="${p.id}">${p.ghost ? 'Голос призрака: есть' : 'Голос призрака: потрачен'}</button>`}
      ${E.isTraveller(p) && S.phase !== 'setup' ? `<button data-act="trLeave" data-arg="${p.id}">Странник ушёл из игры</button>` : ''}</div>
    <div class="row" style="flex-wrap:nowrap"><select id="tokKind-${p.id}" aria-label="Жетон">${tokKinds.map(k => `<option value="${k}">${esc(E.TOK_RU[k])}</option>`).join('')}</select>
      <button class="btn" data-act="edTok" data-arg="${p.id}">Добавить жетон</button></div>
    ${p.tokens.length ? `<div class="seg">${p.tokens.map((t, i) => `<button data-act="edTokDel" data-arg="${p.id}|${i}">× ${esc(E.TOK_RU[t.k] || t.k)}</button>`).join('')}</div>` : ''}
  </div>`;
}

/* ---------- казнь на выбор (заметки пользователя 2026-10-12): казнённый выбирает из трёх, рассказчик читает историю ---------- */
const fateStory = (i, name) => esc(EXECUTIONS[i].s).split('{name}').join(`<b>${esc(name)}</b>`);
function fateCard(pid) {
  const p = pid && E.P(S, pid); if (!p || S.result || typeof EXECUTIONS === 'undefined') return '';
  const f = S.day.picks.fate, ch = f && f.pid === pid && f.pick != null ? f.pick : null;
  return `<div class="card fatecard"><h3>Казнь на выбор</h3>
    <div class="small muted">${S.day.executed === pid ? 'Казнён' : 'На плахе'}: <b>${esc(p.name)}</b>. Пусть игрок выберет из трёх вариантов, какой казни удостоиться, — а вы прочитаете историю вслух.</div>
    ${ch != null ? `<div class="tale"><div class="lab">${esc(EXECUTIONS[ch].t)}</div><p>${fateStory(ch, p.name)}</p></div>
      <div class="row"><button class="btn" data-act="fateShow">Открыть на весь экран</button><button class="btn" data-act="fateOpen" data-arg="${p.id}">Выбрать заново</button></div>`
      : `<button class="btn showbtn" data-act="fateOpen" data-arg="${p.id}">${art('eye', 'bg')}Показать игроку три казни</button>`}</div>`;
}
// на весь экран: сначала три названия (выбирает казнённый), потом история — крупно, чтобы прочитать вслух
function fateOverlay() {
  const f = UI.fate && S.phase === 'day' && S.day.picks && S.day.picks.fate, p = f && E.P(S, f.pid);
  if (!p) return '';
  const close = '<button class="wbtn fatex" data-act="fateClose" aria-label="Закрыть">×</button>';
  if (f.pick == null) return `<div class="ov fateov" role="dialog" aria-label="Выбор казни">${close}<div class="fatebox">
    <div class="fatename">${esc(p.name)}</div><div class="fateq">Как вас казнить?</div>
    <div class="fateopts">${f.opts.map(i => `<button class="fateopt" data-act="fatePick" data-arg="${i}">${esc(EXECUTIONS[i].t)}</button>`).join('')}</div></div></div>`;
  return `<div class="ov fateov" role="dialog" aria-label="${esc(EXECUTIONS[f.pick].t)}">${close}<div class="fatebox">
    <div class="fatet">${esc(EXECUTIONS[f.pick].t)}</div><p class="fatestory">${fateStory(f.pick, p.name)}</p>
    <button class="btn wide" data-act="fateClose">Готово</button></div></div>`;
}
// записи шагов последней ночи (с ✎) — кнопки: выбор можно изменить, приложение переиграет ночь и покажет, что изменится
const logEditable = e => !!(S.rp && e.w === S.rp.id && e.r != null && S.phase !== 'setup');
// цвета журнала (просьба пользователя 2026-10-14): смерть — красным, воскрешение — зелёным, яд и пьянство — фиолетовым; состояния — жирным
// класс «save» занят значком сохранения в шапке — у записи «не умирает» свой (saved)
const logCls = e => e.k === 'death' ? 'death' : e.k === 'revive' || /воскреш|снова жив/i.test(e.t) ? 'revive' : e.k === 'save' ? 'saved' : /отрав|травит|пьян|напои/i.test(e.t) ? 'poison' : e.k;
const logTxt = e => esc(e.t).replace(/(отрав[а-яё]*|травит|пьян[а-яё]*|напои[а-яё]*|трезв[а-яё]*|защи[щт][а-яё]*|прокл[а-яё]*|помешан[а-яё]*|безуми[а-яё]*|воскреш[а-яё]*|снова жив)/gi, '<b>$1</b>');
// записи по фазам, новые сверху; editable — записи последней ночи с ✎ (только у текущей игры, не у прошлых)
function logHtml(entries, editable) {
  const groups = [];
  for (const e of entries) { const g = groups[groups.length - 1]; if (!g || g.p !== e.p) groups.push({ p: e.p, items: [e] }); else g.items.push(e); }
  const row = e => editable && logEditable(e) ? `<button class="e ${logCls(e)} edit" data-act="logEdit" data-arg="${e.r}"><span>${logTxt(e)}</span><span class="ed" aria-hidden="true">✎</span></button>` : `<div class="e ${logCls(e)}">${logTxt(e)}</div>`;
  return `<div class="log">${groups.slice().reverse().map(g => `<div class="ph">${esc(phaseName(g.p))}</div>${g.items.map(row).join('')}`).join('') || '<div class="muted">Пока пусто</div>'}</div>`;
}
function viewLog() {
  const any = S.log.some(logEditable);
  // Савант в игре — кнопка со всеми сказанными ему фактами и пометками П/Л (заметка пользователя 2026-10-16)
  const sav = (S.flags.savantFacts || []).length || S.players.some(p => p.role === 'savant');
  return `<div class="card"><div class="row ghead"><h3>Журнал</h3>${sav ? `<button class="btn" data-act="savFacts">Факты Саванта${(S.flags.savantFacts || []).length ? ` · ${S.flags.savantFacts.length}` : ''}</button>` : ''}</div>${any ? '<div class="small muted">Записи с ✎ — выбор последней ночи: нажмите, чтобы изменить (игрок не понял, шаг пропущен, ошибка). Сначала приложение покажет, что это изменит.</div>' : ''}
    ${logHtml(S.log, true)}</div>${pastGamesHtml()}`;
}
/* ---------- прошлые игры (archive.js; просьба пользователя 2026-10-18): под журналом, каждая свёрнута ---------- */
const pgDate = t => { const d = new Date(t); return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) + ', ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); };
const pgRole = (r, b) => r ? E.rname(r) + (b ? ` (считает себя: ${E.rname(b)})` : '') : 'без роли';
function pgPlayer(p) {
  const moved = p.start && (p.start !== p.role || (p.startAlign && p.startAlign !== p.align));
  return `<div class="pgp ${p.alive ? '' : 'dead'}"><span class="pgn">${p.seat}</span>${p.role ? ico(p.role, p.align, 'pgi') : '<span class="pgi"></span>'}
    <span class="pgt"><span class="pgnm">${p.alive ? '' : '† '}${esc(p.name)}</span><span class="pgr side-${p.align}">${esc(pgRole(p.role, p.believes))}${p.tr ? ' · Странник' : ''}</span>
    ${moved ? `<span class="pgst">в начале: ${esc(pgRole(p.start, p.startBelieves))}${p.startAlign && p.startAlign !== p.align ? (p.startAlign === 'good' ? ', добрый' : ', злой') : ''}</span>` : ''}</span></div>`;
}
function pgItem(g) {
  const res = g.result ? `<span class="pgres ${g.result.winner}">Победа ${g.result.winner === 'good' ? 'добра' : 'зла'}</span>` : '<span class="pgres none">Не окончена</span>';
  // скрытый id в заголовке: render() помнит раскрытые <details> по тексту заголовка — у каждой игры он свой
  return `<details class="pg"><summary><span class="pgd">${esc(pgDate(g.saved))}</span><span class="pgs">${esc(g.script)} · ${g.players.length} игроков</span>${res}<span hidden>${g.id}</span></summary>
    <div class="pgbody">
      <div class="small">${g.result ? esc(g.result.reason) : 'Начали новую игру до конца этой.'}</div>
      <div class="small muted">Начата ${esc(pgDate(g.created))}${g.n ? ` · дошли до ${g.phase === 'night' ? 'ночи' : 'дня'} ${g.n}` : ''}</div>
      <div class="pgpl">${g.players.map(pgPlayer).join('')}</div>
      ${g.bluffs.length ? `<div class="small"><b>Блефы Демона:</b> ${g.bluffs.map(r => esc(E.rname(r))).join(', ')}</div>` : ''}
      ${g.fabled.length ? `<div class="small"><b>Сказочники:</b> ${g.fabled.map(r => esc(E.rname(r))).join(', ')}</div>` : ''}
      <details class="pglog"><summary class="small">Журнал игры · ${g.log.length}<span hidden>${g.id}</span></summary>${logHtml(g.log, false)}</details>
      ${UI.confirm === 'pg:' + g.id ? `<div class="warn">Удалить эту игру из истории? Это нельзя отменить.</div><div class="row"><button class="btn danger" data-act="pgDel" data-arg="${g.id}">Да, удалить</button><button class="btn" data-act="cancelConfirm">Отмена</button></div>`
        : `<button class="btn danger pgdel" data-act="pgDelAsk" data-arg="${g.id}">Удалить из истории</button>`}
    </div></details>`;
}
function pastGamesHtml() {
  const list = (typeof GAMES !== 'undefined' ? GAMES : []).filter(g => g.id !== S.id); // текущая игра — в журнале выше
  return `<div class="card pgcard"><h3>Прошлые игры${list.length ? ' · ' + list.length : ''}</h3>
    ${list.length ? list.map(pgItem).join('') : '<div class="small muted">Здесь появятся сыгранные партии: игра сохраняется сама, когда заканчивается и когда вы начинаете новую. Хранится на этом устройстве.</div>'}</div>`;
}
// правка выбора шага из журнала: поля шага в том состоянии, в каком он был (до него); «Что изменится» — переигрывание ночи
function editOverlay() {
  const ed = UI.edit; if (!ed) return '';
  const now = S.log.filter(e => e.w === ed.w && e.r === ed.k).map(e => `<div class="ln">${esc(e.t)}</div>`).join('');
  const S0 = S; let body = '';
  S = ed.pre; // игроки, подсказки и фильтры — как перед этим шагом
  try {
    const spec = ed.spec, inp = ed.inp, fields = spec.active ? E.stepInputs(spec, inp) : [], missing = spec.active ? E.missingInputs(spec, inp) : [];
    let info = null; try { info = spec.active ? spec.info(inp) : null; } catch (e) { info = null; }
    const icon = stepIcon(ed.st, 'si');
    body = `<div class="sheethead">${icon}<div class="sht"><div class="shp">Изменить выбор · Ночь ${ed.pre.n}</div><div class="pr t-${alignTeam(spec.team, stepAlign(ed.st)) || ''}">${esc(spec.title)}${spec.who ? ' · ' + esc(spec.who) : ''}</div></div>
        <button class="btn sq" data-act="editClose" aria-label="Закрыть">×</button></div>
      <div class="edwas"><div class="lab">Сейчас в журнале</div>${now || '<div class="ln muted">Шаг был пропущен</div>'}</div>
      ${spec.active ? '' : `<div class="warn">Не просыпается: ${esc(spec.reason)}</div>`}
      ${(spec.warn || []).map(w => `<div class="warn">${esc(w)}</div>`).join('')}
      ${fields.map(f => fieldHtml(f, inp)).join('')}
      ${info && (info.show || (info.lines || []).filter(Boolean).length) ? revealHtml(Object.assign({}, info, { grim: false }), spec.dist) : ''}
      ${missing.length ? `<div class="small muted">Осталось выбрать: ${missing.map(esc).join('; ')}</div>` : ''}
      <div class="actions"><button class="btn primary" data-act="editCheck" ${missing.length || !spec.active ? 'disabled' : ''}>Что изменится →</button>
        ${ed.rec.t === 'step' ? '<button class="btn" data-act="editSkip">Сделать шаг пропущенным</button>' : ''}</div>`;
  } finally { S = S0; }
  return `<div class="ov sheetov editov" role="dialog" aria-label="Изменить выбор"><div class="sheetbg" data-act="editClose"></div><div class="sheet">${body}</div></div>${editResHtml()}`;
}
// отдельное уведомление: что повлечёт правка — «Принять» или «Отмена» (просьба пользователя)
function editResHtml() {
  const r = UI.editRes; if (!r) return '';
  const li = a => a.map(t => `<li>${esc(t)}</li>`).join('');
  const c = r.changes, empty = !r.notes.length && !c.list.length && !c.logGone.length && !c.logNew.length;
  return `<div class="ov editres" role="alertdialog" aria-label="Что изменится"><div class="erbox">
    <h3>Что изменится${r.skip ? ' · шаг станет пропущенным' : ''}</h3>
    ${r.notes.map(t => `<div class="warn">${esc(t)}</div>`).join('')}
    ${c.list.length ? `<ul class="erlist">${li(c.list)}</ul>` : ''}
    ${c.logGone.length ? `<div class="lab">Уйдёт из журнала</div><ul class="erlist gone">${li(c.logGone)}</ul>` : ''}
    ${c.logNew.length ? `<div class="lab">Появится в журнале</div><ul class="erlist new">${li(c.logNew)}</ul>` : ''}
    ${empty ? '<div class="muted">Ничего не меняется — выбор тот же.</div>' : ''}
    <div class="small muted">Всё, что вы делали после этого шага, сохранится. Принятую правку можно отменить кнопкой ↶.</div>
    ${confirmRow('editAccept', 'Принять', true, 'editBack', 'Отмена')}</div></div>`;
}
/* ------------------------------------------------------------ справочник ролей */
const EDITION_RU = { tb: 'Trouble Brewing', bmr: 'Bad Moon Rising', snv: 'Sects & Violets', carousel: 'экспериментальная (Carousel), не из базовой коробки',
  fabled: 'Сказочники', loric: 'Лорики, не из базовой коробки' };
const REF_TEAMS = [['townsfolk', 'Горожане'], ['outsider', 'Изгои'], ['minion', 'Приспешники'], ['demon', 'Демоны'], ['traveller', 'Странники'], ['fabled', 'Сказочники'], ['loric', 'Лорики']];
const TYPE_RU = { fabled: 'Сказочник', loric: 'Лорик' };
// выбранный в справочнике сценарий: 'all', ключ встроенного сценария или 'custom' (свой сценарий текущей игры)
const refKey = () => {
  const k = UI.refScript;
  if (k && (k === 'all' || DATA.scripts[k] || (k === 'custom' && S.script.key === 'custom'))) return k;
  return S.script.key === 'custom' || DATA.scripts[S.script.key] ? S.script.key : 'all';
};
function refPool() {
  const key = refKey();
  if (key === 'all') return Object.keys(DATA.roles);
  // роли сценария + его Странники (рекомендованные сценарием; у изданий коробки — Странники этого издания)
  const sc = key === 'custom' ? S.script : DATA.scripts[key];
  if (!sc) return Object.keys(DATA.roles);
  const tr = sc.travellers && sc.travellers.length ? sc.travellers : Object.keys(DATA.roles).filter(r => DATA.roles[r].team === 'traveller' && DATA.roles[r].edition === key);
  return [...new Set([...sc.roles, ...tr, ...(sc.fabled || [])])].filter(r => DATA.roles[r]);
}
function refScriptSelect() {
  const key = refKey();
  const opts = [['all', `Все роли (${Object.keys(DATA.roles).length})`], ...Object.entries(DATA.scripts).map(([k, s]) => [k, s.name])];
  if (S.script.key === 'custom') opts.push(['custom', 'Свой: ' + S.script.name]);
  return `<div class="field"><label for="refScript">Сценарий</label><select id="refScript" data-act="refScript">${opts.map(([k, l]) => `<option value="${k}" ${k === key ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
}
function refCard(rid) {
  const r = DATA.roles[rid], g = DATA.guide[rid] || {}, li = a => (a || []).map(t => `<li>${esc(t)}</li>`).join('');
  const setup = (r.ability.match(/\[[^\]]+\]/) || [])[0];
  // после стены роли скрыты — справочник тоже не говорит, у кого роль
  const who = rolesHidden() ? [] : S.players.filter(p => p.role === rid || p.gained === rid || p.believes === rid).map(p => p.name + (p.role !== rid ? ` (${p.gained === rid ? 'способность' : 'считает себя'})` : ''));
  const jx = Object.entries(DATA.jinxes).filter(([k]) => k.split('|').includes(rid)).map(([k, t]) => `<li><b>${esc(E.rname(k.split('|').find(x => x !== rid) || rid))}:</b> ${esc(t)}</li>`).join('');
  const night = (lab, txt) => `<div><b>${lab}:</b> ${txt ? fmtInstr(txt) : '<span class="muted">не просыпается</span>'}</div>`;
  return `<div class="refcard">
    <div class="refability">${esc(r.ability)}</div>
    <div class="refprops small">
      <div><b>Тип:</b> ${esc(TYPE_RU[r.team] || E.TEAM_RU[r.team])} · ${esc(EDITION_RU[r.edition] || r.edition)}</div>
      ${r.unofficial ? `<div class="muted">Официального перевода нет: название и способность переведены в приложении (англ. ${esc(r.en)}).</div>` : ''}
      ${setup ? `<div><b>Раскладка:</b> ${esc(setup)}</div>` : ''}
      ${r.team !== 'fabled' && r.team !== 'loric' ? night('Первая ночь', r.first) + night('Остальные ночи', r.other) : (r.first || r.other ? night('Ночью', r.first || r.other) : '')}
      ${r.reminders.length ? `<div><b>Жетоны-напоминания:</b> ${r.reminders.map(esc).join(', ')}</div>` : ''}
      ${who.length ? `<div><b>В этой игре:</b> ${who.map(esc).join(', ')}</div>` : ''}
    </div>
    ${g.how ? `<div class="refsec"><div class="lab">Как вести</div><div>${esc(g.how)}</div></div>` : ''}
    ${(g.rules || []).length ? `<div class="refsec"><div class="lab">Важно</div><ul>${li(g.rules)}</ul></div>` : ''}
    ${(g.tips || []).length ? `<div class="refsec"><div class="lab">Советы рассказчику</div><ul>${li(g.tips)}</ul></div>` : ''}
    ${jx ? `<div class="refsec"><div class="lab">Джинксы</div><div class="small muted">Особые правила для пары ролей — действуют, только если обе роли есть в сценарии.</div><ul>${jx}</ul></div>` : ''}
    <button class="btn showbtn" data-act="showRef" data-arg="${rid}">Показать роль игроку на весь экран</button>
  </div>`;
}
function viewRoles() {
  const pool = refPool();
  const groups = REF_TEAMS.map(([t, label]) => {
    const rs = pool.filter(r => DATA.roles[r].team === t).sort((a, b) => E.rname(a).localeCompare(E.rname(b), 'ru'));
    if (!rs.length) return '';
    return `<div class="refgroup"><h3 class="t-${t}">${label}</h3>${rs.map(rid => `<div class="refitem" data-name="${esc((E.rname(rid) + ' ' + DATA.roles[rid].en).toLowerCase())}">
      <button class="refrow ${UI.refOpen === rid ? 'open' : ''}" data-act="refOpen" data-arg="${rid}" aria-expanded="${UI.refOpen === rid}">${ico(rid, t === 'fabled' || t === 'loric' ? 'good' : null, 'ri')}<span class="rname t-${t}">${esc(E.rname(rid))}</span>${DATA.roles[rid].box ? '' : '<span class="rbadge">эксп.</span>'}<span class="pc" aria-hidden="true">${UI.refOpen === rid ? '▴' : '▾'}</span></button>
      ${UI.refOpen === rid ? refCard(rid) : ''}</div>`).join('')}</div>`;
  }).join('');
  return `<div class="card"><h3>Справочник ролей</h3>
    <input type="search" id="refQ" data-act="refQ" data-live="1" value="${esc(UI.refQ)}" placeholder="Поиск по названию (рус. или англ.)" aria-label="Поиск роли">
    ${refScriptSelect()}
    <div class="small muted">Способности и ночные тексты — официальные. «Как вести», «Важно» и «Советы» — пересказ вики wiki.bloodontheclocktower.com.</div></div>
    <div class="card">${groups || '<div class="muted">Нет ролей</div>'}<div class="muted small refnone" hidden>Ничего не найдено</div></div>`;
}
// поиск без перерисовки — чтобы поле не теряло фокус
function filterRefs() {
  const q = (UI.refQ || '').trim().toLowerCase(); let any = false;
  document.querySelectorAll('.refitem').forEach(el => { const ok = !q || el.dataset.name.includes(q); el.hidden = !ok; any = any || ok; });
  document.querySelectorAll('.refgroup').forEach(g => { g.hidden = ![...g.querySelectorAll('.refitem')].some(el => !el.hidden); });
  const none = document.querySelector('.refnone'); if (none) none.hidden = any;
}

const phaseName = t => t.startsWith('Н') ? 'Ночь ' + t.slice(1) : t.startsWith('Д') ? 'День ' + t.slice(1) : t === 'Подг.' ? 'Подготовка' : t;

// тестовая сборка для другого человека (tools/test_build.py кладёт window.TEST_BUILD = {name, until}): при каждом открытии — окно
// приветствия, а что это тест — только на вкладке «Ещё» (заметка пользователя 2026-10-17: постоянная плашка мешала). В обычной сборке — ничего
const TEST = window.TEST_BUILD || null;
function testCard() {
  if (!TEST) return '';
  return `<div class="card testcard"><h3>Тестовая версия</h3><div>Для: <b>${esc(TEST.name)}</b> · доступ до <b>${esc(TEST.until)}</b></div>
    <div class="small muted">Ошибки и пожелания записывайте в «Заметки» ниже. Потом скопируйте их («Скопировать текст» или «Поделиться») и отправьте разработчику.</div></div>`;
}
function testWelcomeHtml() {
  if (!TEST || !UI.testWelcome) return '';
  return `<div class="ov editres" role="dialog" aria-label="Тестовая версия"><div class="statbg" data-act="testWelcomeClose"></div><div class="erbox statbox testwelcome">
    <h3>Добро пожаловать в тестовую версию</h3><p>Вам открыт доступ до <b>${esc(TEST.until)}</b>.</p>
    <p>Все ошибки и пожелания можно оставить во вкладке «Ещё», раздел «Заметки». Не забудьте потом скопировать и отправить разработчику.</p>
    <div class="confirm"><button class="btn ok" data-act="testWelcomeClose">Понятно</button><button class="btn" data-act="testWelcomeNotes">Открыть заметки</button></div></div></div>`;
}
function viewMenu() {
  return `${testCard()}${notesHtml()}${notesCard()}<div class="card"><h3>Игра</h3>
    <div class="seg"><button class="${UI.hideInactive ? 'on' : ''}" data-act="toggleHide">Пропускать шаги, которые не срабатывают</button></div>
    ${HISTORY.length ? `<div class="small muted">Можно отменить ${HISTORY.length} последних действий — кнопка «↶» в шапке.</div>` : ''}
    ${UI.confirm === 'new' ? `<div class="warn">Начать новую игру? Текущая будет удалена.</div><div class="row"><button class="btn danger" data-act="newGame">Да, новая игра</button><button class="btn" data-act="cancelConfirm">Отмена</button></div>`
      : `<button class="btn" data-act="askNew">Новая игра</button>`}
    <div class="small muted">${UI.save === 'cloud' ? 'Игра сохраняется после каждого действия: на этом устройстве и в вашем аккаунте claude.ai.' : 'Игра сохраняется после каждого действия на этом устройстве.'}</div></div>
    <div class="card"><h3>Оформление</h3>
      <div class="seg skinseg" role="group" aria-label="Оформление">${SKINS.map(([k, l]) => `<button class="${UI.skin === k ? 'on' : ''}" data-act="skin" data-arg="${k}" aria-pressed="${UI.skin === k}">${l}</button>`).join('')}</div>
      <div class="small muted">Basic — как было. «Лунная гравюра» — книжные гравюры: днём тушью, ночью серебром. «Витраж во тьме» — витражи в тёмной оправе, Гримуар на витражной розе. «Хэллоуин» — тыквы, паутина и склеп с сундуками, из которых вылетает нечисть. Выбор запоминается на этом устройстве.</div></div>
    <div class="card"><h3>Перенос игры</h3>
      <button class="btn" data-act="copyJson">Скопировать игру</button>${UI.copied ? `<div class="note-ok">${esc(UI.copied)}</div>` : ''}
      <textarea id="importJson" data-act="importText" placeholder="Вставьте сюда скопированную игру">${esc(UI.importText)}</textarea>
      <button class="btn" data-act="importJson">Загрузить игру</button></div>
    <div class="card"><h3>О приложении</h3><div class="small muted">Тексты ролей, ночной порядок и джинксы — из официальных данных The Pandemonium Institute (русский перевод). Где правила оставляют выбор рассказчику, приложение подсказывает, но решаете вы.</div></div>
    <div class="card"><h3>Защита</h3><div class="small muted">Пароль нужен, чтобы показать роли после стены жребия. Он хранится только на этом устройстве; сменить его можно, только зная текущий.</div>
      <input type="password" id="pinOld" inputmode="numeric" autocomplete="off" placeholder="Текущий пароль" aria-label="Текущий пароль">
      <input type="password" id="pinNew" autocomplete="off" placeholder="Новый пароль (не короче 4 символов)" aria-label="Новый пароль">
      <input type="password" id="pinNew2" autocomplete="off" placeholder="Новый пароль ещё раз" aria-label="Повтор нового пароля">
      <button class="btn" data-act="pinChange">Сменить пароль</button>
      ${UI.pinMsg ? `<div class="${UI.pinMsg.ok ? 'note-ok' : 'warn'}">${esc(UI.pinMsg.t)}</div>` : ''}</div>`;
}

function viewOver() {
  const r = S.result;
  return `<div class="phase-wrap">${art(r.winner === 'good' ? 'win_good' : 'win_evil', 'win-art')}</div><div class="banner"><div class="w">${r.winner === 'good' ? 'Победа добра' : 'Победа зла'}</div><div>${esc(r.reason)}</div></div>
    ${politicianHtml()}${viewTable()}${viewLog()}`;
}
// Политик (вики): если больше всех виноват в поражении своей команды — меняет сторону и побеждает (пьяный или отравленный — нет).
// Игра окончена — до объявления победы окно со статистикой: сколько номинировал сам и за казнь кого голосовал; кнопки «Добрый»
// (синяя) и «Злой» (красная) — на чьей стороне Политик в итоге (заметка пользователя 2026-10-16)
function politicianHtml() {
  const r = S.result, done = S.players.filter(p => p.role === 'politician' && S.flags['polDone_' + p.id]);
  if (!done.length) return '';
  return `<div class="card"><h3>Политик</h3>${done.map(p => `<div class="${p.align === r.winner ? 'note-ok' : 'small'}">${esc(p.name)} в итоге ${p.align === 'good' ? 'добрый' : 'злой'} —
    ${p.align === r.winner ? 'побеждает' : 'проигрывает'} вместе ${p.align === 'good' ? 'с добром' : 'со злом'}.</div>`).join('')}</div>`;
}
function polOverlay() {
  const p = E.politiciansPending(S)[0]; if (!p) return '';
  const r = S.result, st = E.politicianStats(S, p.id), off = E.abilityOff(S, p);
  const row = (l, v) => `<tr><td>${l}</td><td><b>${v}</b></td></tr>`;
  return `<div class="ov editres" role="alertdialog" aria-label="Политик"><div class="erbox statbox polbox">
    <div class="lab">Игра окончена — до объявления победы</div><h3>Политик: ${esc(p.name)}</h3>
    <div class="small muted">Победа ${r.winner === 'good' ? 'добра' : 'зла'}. Вики: если поражение своей команды — больше всего из-за слов и поступков Политика, он меняет сторону и тоже побеждает. Решаете вы.</div>
    <div class="small">Сейчас: <b class="t-${p.align === 'good' ? 'townsfolk' : 'demon'}">${p.align === 'good' ? 'добрый' : 'злой'}</b>${off ? ` · <b>${esc(off)}</b> — по вики сторону не меняет` : ''}</div>
    <table class="dist polstat">${row('Номинировал сам', `${st.noms} (добрых ${st.nomGood}, злых ${st.nomEvil})`)}
      ${row('Голосовал за казнь добрых', st.voteGood)}${row('Голосовал за казнь злых', st.voteEvil)}</table>
    <div class="small muted">Сторона — на момент номинации или голосования.</div>
    <div class="flabel"><span>На чьей стороне Политик в итоге?</span></div>
    <div class="confirm"><button class="btn pgood" data-act="polSide" data-arg="${p.id}|good">Добрый</button><button class="btn pevil" data-act="polSide" data-arg="${p.id}|evil">Злой</button></div></div></div>`;
}

function render() {
  const app = document.getElementById('app');
  if (!S) { app.innerHTML = '<main><div class="card">Загрузка…</div></main>'; return; }
  // ночью — принудительный OLED: чистый чёрный фон, светятся только текст и иконки
  document.documentElement.classList.toggle('oled', S.phase === 'night');
  // днём и на остальных экранах — всегда светлая тема, даже если телефон переключился на тёмную
  document.documentElement.dataset.theme = 'light';
  document.documentElement.dataset.skin = UI.skin || 'basic';
  const ph = S.phase === 'setup' ? 'Подготовка' : S.phase === 'night' ? `Ночь ${S.n} · ${S.night.i + 1}/${S.night.steps.length}` : S.phase === 'day' ? `День ${S.n}` : 'Игра окончена';
  UI.showGroups = [];
  // правка из журнала открыта, а запись ночи с тех пор изменилась (отмена, новая ночь) — форма устарела, закрываем
  if (UI.edit && (!S.rp || S.rp.id !== UI.edit.w || S.rp.recs.length !== UI.edit.n)) { UI.edit = null; UI.editRes = null; }
  let body = '';
  if (UI.tab === 'game') body = S.phase === 'setup' ? viewSetup() : S.phase === 'night' ? viewNight() : S.phase === 'day' ? viewDay() : viewOver();
  if (UI.tab === 'table') body = viewTable();
  if (UI.tab === 'log') body = viewLog();
  if (UI.tab === 'roles') body = viewRoles();
  if (UI.tab === 'menu') body = viewMenu();
  const last = HISTORY[HISTORY.length - 1];
  const scrollY = window.scrollY;
  // раскрытые блоки <details> остаются раскрытыми после перерисовки (узнаём их по заголовку)
  const opened = new Set([...app.querySelectorAll('details[open] > summary')].map(s => s.textContent));
  app.innerHTML = `<header class="top"><span class="brand">${art('icon', 'logo')}Гримуар</span><span class="phase">${esc(ph)}</span>
      <button class="hundo" data-act="undo" ${last ? '' : 'disabled'} aria-label="${last ? esc('Отменить: ' + last.label) : 'Нечего отменять'}" title="${last ? esc('Отменить: ' + last.label) : ''}">↶</button><span class="save"></span></header>
    <main>${body}</main>
    <nav class="tabs">${[['game', S.phase === 'night' ? 'Ночь' : S.phase === 'day' ? 'День' : 'Игра', S.phase === 'night' ? 'night' : S.phase === 'day' ? 'day' : 'setup'], ['table', 'Гримуар'], ['log', 'Журнал'], ['roles', 'Роли'], ['menu', 'Ещё']].map(([k, l, ic]) => `<button class="${UI.tab === k ? 'on' : ''}" data-act="tab" data-arg="${k}">${tabIco(ic || k)}<span class="tl">${l}</span></button>`).join('')}</nav>
    ${legendOverlay()}${wallOverlay()}${grimOverlay()}${ringOverlay()}${sheetOverlay()}${editOverlay()}${fateOverlay()}${statOverlay()}${tipHtml()}${savFactsHtml()}${ghostLostHtml()}${pinAskHtml()}${polOverlay()}${gossipAskHtml()}${exeAskHtml()}${exeResHtml()}${showOverlay()}${noteViewOverlay()}${testWelcomeHtml()}${splashHtml()}`;
  // круг рассадки — только на подготовке, круг номинации — только днём, Гримуар кругом — во время игры (после смены фазы закрываются сами)
  if ((UI.ring === 'seat' && S.phase !== 'setup') || ((UI.ring === 'nom' || UI.ring === 'pick') && S.phase !== 'day') || UI.ring === 'grim') UI.ring = null;
  // под полноэкранными слоями страница не прокручивается
  if (UI.fate && !(S.phase === 'day' && S.day.picks && S.day.picks.fate)) UI.fate = false; // день кончился — выбор казни закрыт
  if (UI.stat && S.phase !== 'day') UI.stat = false;
  document.documentElement.classList.toggle('locked', !!((UI.splash && UI.skin !== 'basic') || UI.show || UI.legend || UI.ring || UI.noteView || UI.edit || UI.fate || UI.stat || UI.tip || UI.savFacts || UI.ghostLost || UI.pinAsk || UI.testWelcome || E.politiciansPending(S).length || UI.gossipAsk || UI.exeAsk || UI.exeRes || (UI.open && E.P(S, UI.open)) || (UI.wall && S.draw) || (UI.grimShow && S.phase === 'night')));
  app.querySelectorAll('details > summary').forEach(s => { if (opened.has(s.textContent)) s.parentElement.open = true; });
  if (UI.tab === 'roles') filterRefs();
  paintSave();
  window.scrollTo(0, scrollY);
  hallowAfter();
}

/* ------------------------------------------------------------ обработчики */
const sel1 = (list, id) => (list || [])[0] === id ? [] : [id];
// Головоломщик: кого назвали пьяным (g), угадал ли (hit), какое имя назвать (told: выбранное вами, иначе — Демон, если угадал).
// Не угадал — Демона называть нельзя (выбор, оставшийся от прежней догадки, сбрасывается)
function pmState(pm) {
  const picks = S.day.picks, g = (picks['pmg_' + pm.id] || [])[0] || null, hit = !!g && E.puzzleHit(S, g), off = E.abilityOff(S, pm);
  const dm = S.players.find(p => E.isDemon(p) && p.alive) || S.players.find(p => E.isDemon(p));
  let told = (picks['pmt_' + pm.id] || [])[0] || null;
  if (told && !hit && !off && E.isDemon(E.P(S, told))) told = null;
  if (!told && !picks['pmt_' + pm.id] && hit && !off && dm) told = dm.id;
  return { g, hit, off, told };
}
const A = {
  tab: k => { UI.tab = k; if (k === 'table') savListEnsure(); render(); window.scrollTo(0, 0); },
  undo: () => undo(),
  // подготовка
  // Сказочники сценария (Джинн, Привратник, Ловец Бури…) входят в игру вместе с ним
  // сценарий из списка; смена сценария сбрасывает набор ролей, назначения и незаконченный жребий
  script: (a, el) => { const k = (el && el.value) || a; const sc = DATA.scripts[k]; if (!sc || k === S.script.key) return;
    act(S => { if (S.draw && !S.draw.finished) E.drawCancel(S); S.draw = null; S.pool = null; S.assign = {};
      S.script = { key: k, name: sc.name, roles: sc.roles.slice(), travellers: (sc.travellers || []).slice() }; S.fabled = (sc.fabled || []).slice();
      S.players.forEach(p => { if (p.role && !E.isTraveller(p) && !S.script.roles.includes(p.role)) p.role = null; }); }, 'сценарий «' + sc.name + '»'); },
  customText: (a, el) => { UI.customText = el.value; },
  customLoad: () => {
    try {
      const arr = JSON.parse(UI.customText); const meta = arr.find(x => x && x.id === '_meta');
      const ids = arr.filter(x => !(x && x.id === '_meta')).map(x => String(typeof x === 'string' ? x : x.id).toLowerCase().replace(/[^a-z]/g, ''));
      const known = ids.filter(id => DATA.roles[id] && ['townsfolk', 'outsider', 'minion', 'demon'].includes(team(id))), unknown = ids.filter(id => !DATA.roles[id]);
      act(S => { S.script = { key: 'custom', name: (meta && meta.name) || 'Свой сценарий', roles: known, travellers: ids.filter(id => team(id) === 'traveller') }; }, 'свой сценарий');
      UI.notes = unknown.length ? [`Нет в данных приложения, пропущены: ${unknown.join(', ')}`] : []; render();
    } catch (e) { alertNote('Не получилось прочитать JSON: проверьте, что вставлен текст сценария целиком.'); }
  },
  addP: () => { const el = document.getElementById('newName'); const name = el.value.trim() || `Игрок ${S.players.length + 1}`; act(S => S.players.push(E.newPlayer(name)), 'игрок ' + name); setTimeout(() => { const n = document.getElementById('newName'); if (n) n.focus(); }, 0); },
  bulk: () => { const names = document.getElementById('bulkNames').value.split(/[,\n;]/).map(s => s.trim()).filter(Boolean); if (names.length) act(S => { S.players = names.map(n => E.newPlayer(n)); }, 'список игроков'); },
  rename: (id, el) => act(S => { E.P(S, id).name = el.value.trim() || E.P(S, id).name; }, 'имя игрока'),
  move: arg => { const [id, d] = arg.split('|'); act(S => { const i = S.players.findIndex(p => p.id === id), j = i + (+d); if (j >= 0 && j < S.players.length) [S.players[i], S.players[j]] = [S.players[j], S.players[i]]; }, 'порядок мест'); },
  delP: id => act(S => { S.players = S.players.filter(p => p.id !== id); }, 'удалён игрок'),
  deal: () => { if (S.draw) return alertNote('Роли выдаются или выданы жребием — случайная раздача недоступна.'); act(S => E.randomDeal(S), 'случайная раздача ролей'); },
  outMod: arg => { const [id, v] = arg.split('|'); act(S => { S.flags.mods = Object.assign({}, S.flags.mods, { [id]: +v }); }, `${E.rname(id)}: ${{ '-1': '−1 Изгой', 0: 'Изгоев без изменений', 1: '+1 Изгой' }[v]}`); },
  setRole: (id, el) => act(S => E.setupRole(S, E.P(S, id), el.value), 'роль ' + E.P(S, id).name),
  setDrunk: (a, el) => act(S => E.makeDrunk(S, el.value), 'Пьяница'),
  setBelieves: (id, el) => act(S => { E.P(S, id).believes = el.value || null; }, 'роль-обманка'),
  setMarionette: (a, el) => { if (el.value) act(S => E.makeMarionette(S, el.value), 'Марионетка'); },
  bluff: (i, el) => act(S => { S.bluffs[+i] = el.value || null; }, 'блеф Демона'),
  'setFlag-grandchild': (a, el) => act(S => { S.flags.grandchild = el.value || null; }, 'внук Бабушки'),
  'setFlag-ftHerring': (a, el) => act(S => { S.flags.ftHerring = el.value || null; }, 'ложная цель Гадалки'),
  'setFlag-goodTwin': (a, el) => act(S => { S.flags.goodTwin = el.value || null; }, 'добрый близнец'),
  'setFlag-puzzleDrunk': (a, el) => act(S => { S.flags.puzzleDrunk = el.value || null; }, 'пьяный Головоломщика'),
  autoPrep: () => act(S => E.autoSetup(S, true), 'подготовка случайно'),
  start: () => { UI.notes = []; act(S => E.startGame(S), 'начало игры'); window.scrollTo(0, 0); },
  // Странники и Сказочники
  trAlign: v => draft(S => { S.flags._trAlign = v; }),
  trAdd: () => {
    const name = document.getElementById('trName').value.trim(), role = document.getElementById('trRole').value, after = document.getElementById('trPos').value;
    if (!role) return alertNote('Выберите роль Странника.');
    act(S => E.addTraveller(S, name || 'Странник', role, S.flags._trAlign === 'evil' ? 'evil' : 'good', after || null), 'Странник ' + (name || E.rname(role)));
  },
  trLeave: id => act(S => { const p = E.P(S, id); E.log(S, `Странник ${p.name} уходит из игры`, 'effect'); S.players = S.players.filter(q => q.id !== id); }, 'Странник ушёл'),
  fabAdd: () => { const id = document.getElementById('fabAdd').value; if (id) act(S => { S.fabled = (S.fabled || []).concat(id); if (S.phase !== 'setup') E.log(S, `Рассказчик вводит Сказочника: ${E.rname(id)}`, 'effect'); }, 'Сказочник ' + E.rname(id)); },
  fabDel: id => act(S => { S.fabled = (S.fabled || []).filter(x => x !== id); }, 'убран Сказочник ' + E.rname(id)),
  // ночь: выбор — черновик (без истории), «Готово» — действие (в истории)
  pickP: arg => {
    const [key, id, n] = arg.split('|');
    inpDraft(key, inp => { const sel = (inp[key] || []).slice(), max = +n;
      if (sel.includes(id)) sel.splice(sel.indexOf(id), 1); else { if (sel.length >= max) sel.shift(); sel.push(id); }
      inp[key] = sel; });
  },
  pickR: (key, el) => inpDraft(key, inp => { inp[key] = el.value || null; }),
  pickMode: () => { UI.pickRing = !UI.pickRing; try { localStorage.setItem('botc-grimoire-pickring', UI.pickRing ? '1' : ''); } catch (e) { /* без хранилища — до перезагрузки */ } render(); },
  pickC: arg => { const [key, v] = arg.split('|'); inpDraft(key, inp => { inp[key] = v; }); },
  num: arg => { const [key, d, base] = arg.split('|'); inpDraft(key, inp => { inp[key] = Math.max(0, (inp[key] ?? (+base || 0)) + (+d)); }); },
  // текст печатается — сохраняем без перерисовки, иначе поле теряет фокус
  pickT: (key, el) => { if (UI.edit) { UI.edit.inp[key] = el.value; UI.editRes = null; return; } S.draft.inp[key] = el.value; S.updated = Date.now(); persist(); },
  mornNext: i => draft(S => { S.night.data.morn = +i + 1; }),
  amnText: (id, el) => { S.flags['amnesiac_' + id] = el.value; S.updated = Date.now(); persist(); },
  // подсказка из ideas.js: в поле способности Амнезиака (подготовка) или в поле шага ночи
  amnIdea: arg => { const [id, list, i] = arg.split('|'); act(S => { S.flags['amnesiac_' + id] = IDEAS[list][+i]; }, 'способность Амнезиака'); },
  pickIdea: arg => { const [key, list, i] = arg.split('|'); inpDraft(key, inp => { inp[key] = IDEAS[list][+i]; }); },
  amnGuessText: (id, el) => { S.day.picks['amnGuess_' + id] = el.value; S.updated = Date.now(); persist(); },
  amnAnswer: arg => { const [id, ans] = arg.split('|'), guess = (S.day.picks['amnGuess_' + id] || '').trim(); act(S => { E.amnesiacGuess(S, id, guess, ans); delete S.day.picks['amnGuess_' + id]; }); },
  stepDone: () => { const st = E.currentStep(S), spec = E.stepSpec(S, st), inp = clone(S.draft.inp), had = !!S.night.data.pithagInfo; UI.notes = []; act(S => { if (spec.active) E.applyStep(S, st, inp); else E.skipStep(S, 'auto'); }, spec.title + (spec.who ? ' (' + spec.who + ')' : ''), 'step'); window.scrollTo(0, 0);
    // Яга создала Демона — окно с советами вики (заметка пользователя 2026-10-15)
    if (!had && S.phase === 'night' && S.night.data.pithagInfo) { UI.tip = E.pithagAdvice(S); render(); } },
  tipClose: () => { UI.tip = null; render(); },
  stepSkip: () => { const spec = E.stepSpec(S, E.currentStep(S)); act(S => E.skipStep(S, 'manual'), 'пропущен шаг: ' + spec.title, 'step'); window.scrollTo(0, 0); },
  // день
  dayPick: arg => { const [key, id] = arg.split('|'); draft(S => { S.day.picks[key] = sel1(S.day.picks[key], id); }); },
  moonchild: () => { UI.ring = null; act(S => E.moonchildChoose(S, S.day.picks.moonchild[0])); },
  klutz: () => { UI.ring = null; act(S => E.klutzChoose(S, S.day.picks.klutz[0])); },
  slayReg: v => draft(S => { S.day.picks.slayReg = v === '1'; }),
  slay: id => { UI.ring = null; act(S => { E.slayerShot(S, id, S.day.picks['slay_' + id][0], S.day.picks.slayReg); S.day.picks = {}; }); },
  psychoKill: id => { const t = (S.day.picks['psycho_' + id] || [])[0]; if (!t) return; UI.ring = null; act(S => { E.psychopathKill(S, id, t); S.day.picks['psycho_' + id] = []; }, 'Психопат'); },
  ringPickOpen: arg => { const [kind, a] = arg.split('|'); UI.ringPick = { kind, arg: a }; UI.ring = 'pick'; render(); },
  madExe: arg => { const [pid, src] = arg.split('|'), before = exeMark(); act(S => E.madnessExecute(S, pid, src), 'казнь за нарушенное безумие'); window.scrollTo(0, 0); showExeResult(before); },
  harpyKill: arg => act(S => E.harpyKill(S, arg.split(',')), 'Гарпия: смерть'),
  polSide: arg => { const [id, a] = arg.split('|'); act(S => E.politicianSide(S, id, a), 'Политик: ' + (a === 'good' ? 'добрый' : 'злой')); },
  pmGuess: id => { const pm = E.P(S, id), st = pmState(pm); if (!st.g || !st.told) return;
    act(S => { E.puzzleGuess(S, id, st.g, st.told); S.day.picks['pmg_' + id] = []; S.day.picks['pmt_' + id] = []; }, 'догадка Головоломщика'); },
  damselGuess: () => { const by = (S.day.picks.dgBy || [])[0], on = (S.day.picks.dgOn || [])[0]; if (by && on) act(S => { E.damselGuess(S, by, on); S.day.picks.dgBy = []; S.day.picks.dgOn = []; }, 'догадка о Девице'); },
  jugAdd: () => { const pid = document.getElementById('jugP').value, role = document.getElementById('jugR').value; if (role) act(S => { (S.flags.jugglerGuesses = S.flags.jugglerGuesses || []).push({ pid, role }); }, 'догадка Жонглёра'); },
  jugDel: i => act(S => S.flags.jugglerGuesses.splice(+i, 1), 'убрана догадка'),
  exPick: arg => { const id = arg.split('|')[1]; draft(S => { const ex = S.day.picks.exile || { pid: null, voters: [] }; ex.pid = ex.pid === id ? null : id; ex.voters = []; S.day.picks.exile = ex; UI.pickOpen = ex.pid ? null : 'exPid'; }); },
  exVote: arg => { const id = arg.split('|')[1]; draft(S => { const v = S.day.picks.exile.voters; if (v.includes(id)) v.splice(v.indexOf(id), 1); else v.push(id); }); },
  exile: () => { const ex = clone(S.day.picks.exile), funny = !!S.day.picks.exFunny; act(S => { E.exile(S, ex.pid, ex.voters.length, null, { funny }); S.day.picks.exile = null; S.day.picks.exFunny = false; }); },
  exFunny: () => draft(S => { S.day.picks.exFunny = !S.day.picks.exFunny; }),
  dayPick2: arg => { const [key, id] = arg.split('|'); draft(S => { const sel = (S.day.picks[key] || []).slice(); if (sel.includes(id)) sel.splice(sel.indexOf(id), 1); else { if (sel.length >= 2) sel.shift(); sel.push(id); } S.day.picks[key] = sel; }); },
  gunShoot: gid => { const t = S.day.picks.gun[0]; act(S => { E.gunslingerShot(S, gid, t); S.day.picks.gun = []; }); },
  gunSkip: () => act(S => { S.day.gunUsed = true; E.log(S, 'Стрелок сегодня не стреляет', 'day'); }),
  tinkerDie: id => act(S => E.tinkerDies(S, id), 'Механик умирает'),
  doom: () => { const a = S.day.picks.doomBy[0], v = S.day.picks.doomV[0]; act(S => { E.doomsayerKill(S, a, v); S.day.picks.doomBy = []; S.day.picks.doomV = []; }); },
  fiddler: res => { const ch = S.day.picks.fidCh[0]; act(S => E.fiddlerEnd(S, ch, res), 'Скрипач'); },
  matronSwap: () => { const [a, b] = S.day.picks.matron; act(S => { E.swapSeats(S, a, b); S.day.picks.matron = []; }); },
  judge: arg => { const [j, on, pass] = arg.split('|'); act(S => { const r = E.judgeRuling(S, j, on, pass === '1'); S.day.draft = { by: null, on: null, voters: [], stage: 'pick', spy: false }; if (r.ended && !S.result) E.endDay(S); }); window.scrollTo(0, 0); },
  executeNow: () => { const o = { pacifist: S.day.picks.pacifist, scapegoat: S.day.picks.scapegoat }; act(S => { E.executeNow(S, o); S.day.picks.scapegoat = null; S.day.draft = { by: null, on: null, voters: [], stage: 'pick', spy: false }; }); },
  scapegoat: id => draft(S => { S.day.picks.scapegoat = S.day.picks.scapegoat ? null : id; }),
  // выбор в свёрнутом списке: после «кто» сразу раскрывается «кого», после «кого» список сворачивается
  nomPick: arg => { const [key, id] = arg.split('|'); draft(S => { const d = S.day.draft; d[key] = d[key] === id ? null : id; d.spy = false;
    if (key === 'by' && d.by) UI.pickOpen = d.on ? null : 'on'; if (key === 'on' && d.on) UI.pickOpen = null; }); },
  pickOpen: key => { UI.pickOpen = UI.pickOpen === key ? null : key; render(); },
  nomSelf: () => draft(S => { const d = S.day.draft, p = d.by && E.P(S, d.by); if (p && nomRules().onOk(p)) { d.on = d.by; d.spy = false; } UI.pickOpen = null; }),
  // справочник ролей
  refOpen: id => { UI.refOpen = UI.refOpen === id ? null : id; render(); },
  refScript: (a, el) => { UI.refScript = el.value; UI.refOpen = null; render(); },
  refQ: (a, el) => { UI.refQ = el.value; filterRefs(); },
  nomClear: () => { UI.pickOpen = null; draft(S => { S.day.draft = { by: null, on: null, voters: [], stage: 'pick', spy: false }; }); },
  exClear: () => { UI.pickOpen = null; draft(S => { S.day.picks.exile = null; S.day.picks.exFunny = false; }); },
  nomSpy: v => draft(S => { S.day.draft.spy = v === '1'; }),
  nominate: () => {
    let res = null; const d0 = clone(S.day.draft), by = E.bishopActive(S) ? 'st' : d0.by, before = exeMark();
    UI.pickOpen = null;
    act(S => {
      res = E.nominate(S, by, d0.on, { spyTownsfolk: !!d0.spy });
      if (res.ended) E.endDay(S);
      else if (S.phase === 'day') S.day.draft = { by, on: d0.on, voters: [], stage: 'vote', spy: false };
    });
    UI.notes = res ? res.notes : []; render();
    showExeResult(before); // Девственница: номинировавший Горожанин казнён
  },
  vote: arg => { const id = arg.split('|')[1]; draft(S => { const v = S.day.draft.voters; if (v.includes(id)) v.splice(v.indexOf(id), 1); else v.push(id); }); },
  voteDone: () => { const d0 = clone(S.day.draft), lost = E.ghostSpent(S, d0.voters).map(p => p.name);
    act(S => { E.recordVote(S, d0.on, d0.voters); S.day.draft = { by: null, on: null, voters: [], stage: 'pick', spy: false }; });
    if (lost.length) { UI.ghostLost = lost; render(); } }, // окно: кто лишился последнего голоса (заметка пользователя 2026-10-16)
  ghostLostClose: () => { UI.ghostLost = null; render(); },
  voteCancel: () => act(S => { S.day.draft = { by: null, on: null, voters: [], stage: 'pick', spy: false }; }, 'номинация отменена'),
  pacifist: () => draft(S => { S.day.picks.pacifist = !S.day.picks.pacifist; }),
  // «Завершить день»: если казнят доброго при Пацифисте или Психопата — сначала окно с решением (заметка пользователя 2026-10-14),
  // после казни — окно «Казнён: умирает / не умирает» и «Продолжить»
  endDay: () => {
    // Сплетница: сначала — было ли сегодня публичное заявление (заметка пользователя 2026-10-15)
    const gp = E.gossipPending(S);
    if (gp.length && !S.day.holdForChoice) { UI.gossipAsk = { pid: gp[0].id }; render(); return; }
    const d = S.day, sg = d.picks.scapegoat, blk = E.block(S), th = E.voteThreshold(S);
    const bn = d.executed && !d.executed2 && d.noms.find(x => x.butcher && x.count >= th);
    const pid = d.holdForChoice ? null : !d.executed ? (blk ? sg || blk : null) : bn ? bn.on : null;
    const qs = pid ? E.exeQuestions(S, pid) : [];
    if (qs.length) { UI.exeAsk = { pid, q: qs[0], then: 'endDay' }; render(); return; }
    doEndDay({});
  },
  exeAnswer: v => { const a = UI.exeAsk; if (!a) return; UI.exeAsk = null;
    const opts = a.q === 'pacifist' ? { pacifist: v === 'spare' } : { roshambo: v };
    if (a.then === 'manual') doManualExe(a.pid, opts); else doEndDay(opts); },
  exeAskClose: () => { UI.exeAsk = null; render(); },
  gossipAnswer: v => { const a = UI.gossipAsk; if (!a) return; const t = (document.getElementById('gossipText') || {}).value || ''; UI.gossipAsk = null;
    act(S => E.setGossip(S, a.pid, v === 'yes', t), 'Сплетница: ' + (v === 'yes' ? 'заявление' : 'без заявления')); A.endDay(); },
  gossipClose: () => { UI.gossipAsk = null; render(); },
  exeResClose: () => { UI.exeRes = null; render(); },
  // воскрешение по решению рассказчика (экран дня): жив, причина смерти снята, голос призрака возвращается
  revive: () => { const id = (S.day.picks.revive || [])[0], p = id && E.P(S, id); if (!p || p.alive) return;
    act(S => { E.revive(S, E.P(S, id), 'Рассказчик воскрешает'); S.day.picks.revive = []; }, 'воскрешение: ' + p.name); }, // ожил — выбора «после смерти» нет
  manualExe: () => { const id = S.day.picks.manualExe[0], qs = E.exeQuestions(S, id);
    if (qs.length) { UI.exeAsk = { pid: id, q: qs[0], then: 'manual' }; render(); return; }
    doManualExe(id, {}); },
  // казнь на выбор: три случайных, без повторов за игру (пока хватает); выбор — в журнал
  fateOpen: pid => {
    const all = EXECUTIONS.map((_, i) => i), used = S.flags.fateUsed || [], free = all.filter(i => !used.includes(i));
    UI.fate = true; draft(S => { S.day.picks.fate = { pid, opts: E.shuffle(free.length >= 3 ? free : all).slice(0, 3), pick: null }; });
  },
  fatePick: i => { const f = S.day.picks.fate, p = f && E.P(S, f.pid); if (!p) return;
    act(S => { S.day.picks.fate.pick = +i; S.flags.fateUsed = (S.flags.fateUsed || []).concat(+i); E.log(S, `${p.name} выбирает казнь: ${EXECUTIONS[+i].t}`, 'day'); }, 'казнь на выбор'); },
  fateShow: () => { UI.fate = true; render(); },
  statOpen: () => { UI.stat = true; render(); },
  statClose: () => { UI.stat = false; render(); },
  fateClose: () => { UI.fate = false; render(); },
  // журнал: изменить выбор шага последней ночи → «Что изменится» (переигрывание ночи) → «Принять» или «Отмена»
  logEdit: k => {
    const tg = E.editTarget(S, +k); if (!tg) return alertNote('Этот шаг уже нельзя изменить.');
    const spec = E.stepSpec(tg.pre, tg.st);
    UI.edit = { k: +k, w: S.rp.id, n: S.rp.recs.length, pre: tg.pre, st: tg.st, spec, rec: tg.rec, inp: clone(tg.rec.t === 'step' ? tg.rec.inp : (spec.defaults || {})) };
    UI.editRes = null; render();
  },
  editClose: () => { UI.edit = null; UI.editRes = null; render(); },
  editCheck: () => { const ed = UI.edit; if (!ed || E.missingInputs(ed.spec, ed.inp).length) return; UI.editRes = E.editNight(S, ed.k, { inp: clone(ed.inp) }); render(); },
  editSkip: () => { const ed = UI.edit; if (!ed) return; UI.editRes = Object.assign(E.editNight(S, ed.k, { skip: true }), { skip: true }); render(); },
  editBack: () => { UI.editRes = null; render(); },
  editAccept: () => {
    const ed = UI.edit, res = UI.editRes; if (!ed || !res) return;
    const what = ed.spec.title + (ed.spec.who ? ` (${ed.spec.who})` : '');
    HISTORY.push({ s: JSON.stringify(S), label: 'изменён выбор: ' + what }); if (HISTORY.length > HIST_MAX) HISTORY.shift();
    S = E.acceptEdit(res.T, `Рассказчик изменил выбор, ночь ${ed.pre.n}: ${what}${res.skip ? ' — шаг пропущен' : ''}`);
    UI.edit = null; UI.editRes = null; autoSkip(); S.updated = Date.now();
    persist(); render(); toast('Готово: изменён выбор — ' + what, true);
  },
  // Гримуар: карточка игрока, показ роли на весь экран
  openP: id => { UI.open = UI.open === id ? null : id; render(); },
  legend: () => { UI.legend = !UI.legend; render(); },
  grimShow: () => { UI.grimShow = !UI.grimShow; UI.grimFake = false; UI.grimZoom = null; render(); },
  // искажённый Гримуар: один и тот же на эту ночь (пока не «Перемешать заново»)
  grimFake: () => { const st = E.currentStep(S), viewer = st && st.pid;
    if (!S.night.data.fakeGrim || S.night.data.fakeGrim.viewer !== viewer) draft(S => { S.night.data.fakeGrim = makeFakeGrim(viewer); });
    UI.grimShow = true; UI.grimFake = true; UI.grimZoom = null; render(); },
  grimFakeNew: () => { const st = E.currentStep(S); draft(S => { S.night.data.fakeGrim = makeFakeGrim(st && st.pid); }); },
  grimZoom: id => { UI.grimZoom = UI.grimZoom ? null : id; render(); },
  // круг игроков: рассадка (подготовка) и номинация (день)
  ringSeat: () => { UI.ring = 'seat'; render(); },
  ringNom: () => { UI.ring = 'nom'; render(); },
  grimGrid: v => { UI.grimGrid = v === '1'; try { localStorage.setItem('botc-grimoire-grimgrid', UI.grimGrid ? '1' : ''); } catch (e) { /* без хранилища — до перезагрузки */ } render(); },
  ringClose: () => { UI.ring = null; render(); },
  seatDir: v => { if ((S.flags.seatDir || 'cw') !== v) act(S => { S.flags.seatDir = v; }, v === 'ccw' ? 'номера против часовой' : 'номера по часовой'); },
  // номинация кругом: первое нажатие — кто номинирует, второе — кого; повторное нажатие снимает выбор
  ringPick: id => draft(S => {
    const d = S.day.draft, { bishop, byOk, onOk } = nomRules(), p = E.P(S, id); d.spy = false;
    if (d.by === id) d.by = null;
    else if (d.on === id) d.on = null;
    else if (!bishop && !d.by && byOk(p)) d.by = id;
    else if (onOk(p)) d.on = id;
  }),
  showOpen: i => { const g = (UI.showGroups || [])[+i]; if (g) { UI.show = { screens: g.screens, i: 0 }; render(); } },
  showNext: () => { if (!UI.show) return;
    // горизонтально экран с карточкой и ролями — в два нажатия: сначала карточка, потом роли
    if (UI.showLand && !UI.show.sub && showHasBoth(UI.show.screens[UI.show.i])) { UI.show.sub = 1; render(); return; }
    UI.show.sub = 0; UI.show.i += 1; if (UI.show.i >= UI.show.screens.length) UI.show = null; render(); },
  // горизонтальный показ (запоминается на устройстве); ⟲ — повернуть на 180°, если держат телефон другим боком
  showLand: () => { UI.showLand = !UI.showLand; if (UI.show) UI.show.sub = 0; try { localStorage.setItem('botc-grimoire-showland', UI.showLand ? '1' : ''); } catch (e) { /* без хранилища — до перезагрузки */ } render(); },
  showFlip: () => { UI.showFlip = !UI.showFlip; try { localStorage.setItem('botc-grimoire-showflip', UI.showFlip ? '1' : ''); } catch (e) { /* без хранилища */ } render(); },
  showRole: id => { const p = E.P(S, id), r = seenRole(p); UI.show = { screens: [{ caption: 'Ваша роль', items: [{ role: r, align: r === p.role ? p.align : undefined }] }], i: 0 }; render(); },
  showRef: rid => { UI.show = { screens: [{ caption: '', items: [{ role: rid, align: DATA.roles[rid].team === 'fabled' || DATA.roles[rid].team === 'loric' ? 'good' : undefined }] }], i: 0 }; render(); },
  // жребий: каменная стена
  drawStart: () => { if (S.draw) return wallIn(); const pr = E.drawProblem(S); if (pr) return alertNote(pr); act(S => E.drawStart(S), 'жребий: стена'); wallIn(); },
  // Савант, Рыбак, Мецефель (день)
  // свои факты рассказчика (own) остаются, подбирается только факт другой правдивости
  savGen: id => draft(S => { const own = (S.day.picks['sav_' + id] || []).filter(x => x.own);
    const pair = own.concat((IDEAS.savantPair(S, id) || []).filter(g => !own.some(o => o.truth === g.truth)));
    S.day.picks['sav_' + id] = pair.length ? E.shuffle(pair) : null; }),
  // свой факт с пометкой «правда» или «ложь» (заметка пользователя 2026-10-16): заменяет факт той же правдивости; второго нет — подбирается
  savOwnText: (id, el) => { S.day.picks['savOwn_' + id] = el.value; S.updated = Date.now(); persist(); },
  savOwn: arg => { const [id, t] = arg.split('|'), text = (S.day.picks['savOwn_' + id] || '').trim(); if (!text) return;
    draft(S => { const truth = t === '1', pair = (S.day.picks['sav_' + id] || []).filter(x => x.truth !== truth).concat({ text, truth, own: true });
      if (pair.length < 2) { const g = (IDEAS.savantPair(S, id) || []).find(x => x.truth !== truth); if (g) pair.push(g); }
      S.day.picks['sav_' + id] = E.shuffle(pair); delete S.day.picks['savOwn_' + id]; }); },
  savDel: arg => { const [id, i] = arg.split('|');
    draft(S => { const pair = (S.day.picks['sav_' + id] || []).filter((x, k) => k !== +i); S.day.picks['sav_' + id] = pair.length ? pair : null; }); },
  // список фактов на вкладке «Гримуар»: выбрать / убрать факт (место в паре — случайное, чтобы порядок не выдавал правдивость)
  savGoList: () => { UI.tab = 'table'; savListEnsure(); render(); const c = document.getElementById('savlist'); if (c) c.scrollIntoView(); else window.scrollTo(0, 0); },
  savList: id => draft(S => { S.day.picks['savList_' + id] = IDEAS.savantList(S, id); }),
  savGrp: g => { UI.savOpen = Object.assign({}, UI.savOpen, { [g]: !(UI.savOpen || {})[g] }); render(); },
  // выбран один верный и один ложный (заметка пользователя 2026-10-17): новый факт заменяет выбранный той же правдивости
  savPick: arg => { const [id, i, t] = arg.split('|'), it = (S.day.picks['savList_' + id] || [])[+i]; if (!it) return;
    const truth = t === '1', text = truth ? it.yes : it.no;
    draft(S => { const sel = S.day.picks['sav_' + id] || [], k = sel.findIndex(x => x.text === text), f = { text, truth };
      const other = sel.filter(x => !!x.truth !== truth);
      const next = k >= 0 ? sel.filter((x, j) => j !== k) : Math.random() < 0.5 ? [f, ...other] : [...other, f];
      S.day.picks['sav_' + id] = next.length ? next : null; }); },
  savLog: id => { const pair = savOneEach(S.day.picks['sav_' + id]); if (pair) act(S => {
    S.flags.savantFacts = (S.flags.savantFacts || []).concat({ n: S.n, pid: id, facts: pair.map(x => ({ text: x.text, truth: !!x.truth, own: !!x.own })) });
    S.day.picks['sav_' + id] = null;
    E.log(S, `Савант (${E.nm(S, id)}): ${pair.map(x => `«${x.text}» — ${x.truth ? 'правда' : 'ложь'}`).join('; ')}`, 'day'); }, 'факты Саванта'); },
  savFacts: () => { UI.savFacts = true; render(); },
  savFactsClose: () => { UI.savFacts = false; render(); },
  fishGen: id => draft(S => { S.day.picks['fish_' + id] = IDEAS.fishermanAdvice(S, id); S.day.picks['fishSel_' + id] = null; }),
  fishPick: arg => { const [id, i] = arg.split('|'); draft(S => { S.day.picks['fishSel_' + id] = S.day.picks['fish_' + id][+i]; }); },
  fishUse: id => { const t = S.day.picks['fishSel_' + id]; act(S => { S.flags['fishUsed_' + id] = true; E.log(S, `Рыбак (${E.nm(S, id)}) получает совет: «${t}»`, 'day'); }, 'совет Рыбаку'); },
  mezPick: arg => { const id = arg.split('|')[1]; act(S => { S.flags.mezTarget = id; E.log(S, `${E.nm(S, id)} произносит тайное слово Мецефеля`, 'day'); }, 'тайное слово'); },
  mezClear: () => act(S => { S.flags.mezTarget = null; }, 'отметка снята'),
  // «Роли на игру» и назначения для жребия
  poolToggle: r => draft(S => { const p = S.pool || []; S.pool = p.includes(r) ? p.filter(x => x !== r) : p.concat(r); if (!S.pool.length) S.pool = null; }),
  poolRandom: () => draft(S => { S.pool = E.randomPool(S); }),
  poolClear: () => draft(S => { S.pool = null; }),
  assign: (pid, el) => act(S => { S.assign = Object.assign({}, S.assign); const v = el.value;
    if (!v) delete S.assign[pid]; else S.assign[pid] = v.startsWith('r:') ? { role: v.slice(2) } : { team: v.slice(2) }; }, 'назначение для жребия'),
  wallShow: () => wallIn(),
  // стена свёрнута — роли закрыты «шторкой», экран — вкладка «Игра» с карточкой стены (заметка пользователя 2026-10-16)
  wallHide: () => { UI.wall = false; UI.tab = 'game'; draft(S => { if (S.draw) S.draw.hidden = true; }); window.scrollTo(0, 0); },
  // показать роли — только по паролю (заметка пользователя 2026-10-16)
  rolesShow: () => { UI.pinAsk = { err: false }; render(); pinFocus(); },
  pinOk: () => { const el = document.getElementById('pinIn');
    if (!pinCheck(el && el.value)) { UI.pinAsk = { err: true }; render(); pinFocus(); return; }
    UI.pinAsk = null; draft(S => { if (S.draw) S.draw.hidden = false; }); },
  pinClose: () => { UI.pinAsk = null; render(); },
  testWelcomeClose: () => { UI.testWelcome = false; render(); },
  testWelcomeNotes: () => { UI.testWelcome = false; UI.tab = 'menu'; render(); window.scrollTo(0, 0); },
  // «Ещё» → «Защита»: новый пароль — только после ввода текущего
  pinChange: () => { const v = id => ((document.getElementById(id) || {}).value || '').trim(), old = v('pinOld'), nw = v('pinNew'), nw2 = v('pinNew2');
    UI.pinMsg = !pinCheck(old) ? { ok: false, t: 'Текущий пароль неверный — пароль не изменён' }
      : nw.length < 4 ? { ok: false, t: 'Новый пароль — не короче 4 символов' }
      : nw !== nw2 ? { ok: false, t: 'Новый пароль и повтор не совпадают' }
      : pinSave(nw) ? { ok: true, t: 'Пароль изменён (на этом устройстве)' } : { ok: false, t: 'Не получилось сохранить: хранилище браузера недоступно' };
    render(); },
  rolesHide: () => { draft(S => { if (S.draw) S.draw.hidden = true; }); window.scrollTo(0, 0); },
  drawTurn: (a, el) => { const id = el && el.value; if (id) draft(S => { S.draw.turn = id; }); },
  drawOpen: i => { UI.openAt = Date.now();
    // склеп: откуда вылетает нечисть (центр сундука на стене) и кто — случайно; из крайних столбцов летит к середине
    const cell = document.querySelector(`.wcell[data-arg="${i}"]`), wall = document.querySelector('.wall');
    if (cell && wall) { const a = cell.getBoundingClientRect(), b = wall.getBoundingClientRect(), col = +i % 3;
      UI.openPos = { x: Math.round(a.left + a.width / 2 - b.left), y: Math.round(a.top + a.height * .35 - b.top), dir: col === 2 ? -1 : col === 0 ? 1 : (Math.random() < .5 ? -1 : 1) }; }
    UI.openFx = HFX[Math.floor(Math.random() * HFX.length)];
    act(S => E.drawOpen(S, +i), 'жребий: ячейка открыта'); },
  // закрыть роль можно не раньше чем через 2 секунды — чтобы игрок успел прочитать и не закрыл случайно (было 3 с; просьба пользователя 2026-10-18)
  drawClose: () => { if (UI.openAt && Date.now() - UI.openAt < 2000) return; UI.openAt = null;
    UI.cracking = S.draw.open; act(S => E.drawClose(S), 'жребий: ячейка закрыта'); setTimeout(() => { UI.cracking = null; }, 1600); },
  drawCancel: () => { UI.wall = false; act(S => E.drawCancel(S), 'жребий отменён'); },
  edRole: (id, el) => act(S => E.storytellerRole(S, E.P(S, id), el.value || null), 'роль ' + E.nm(S, id)),
  // смерть по решению рассказчика — настоящая: ночью попадёт в объявление на рассвете, сработают последствия
  edKill: id => { const why = (document.getElementById('edWhy-' + id) || {}).value || ''; act(S => E.storytellerKill(S, id, null, why), 'смерть: ' + E.nm(S, id)); },
  edAlive: id => act(S => E.revive(S, E.P(S, id), 'Рассказчик воскрешает'), 'воскрешение'),
  // «Убить игрока» на экранах дня и ночи; причину запоминаем при уходе из поля, чтобы перерисовка её не стёрла
  killWhy: (a, el) => { UI.killWhy = el.value; },
  killPick: arg => { const id = arg.split('|')[1], el = document.getElementById('killWhy'); if (el) UI.killWhy = el.value; UI.killPid = UI.killPid === id ? null : id; render(); },
  killDo: () => {
    const el = document.getElementById('killWhy'), why = el ? el.value : UI.killWhy, id = UI.killPid;
    if (!id) return;
    UI.killPid = null; UI.killWhy = '';
    act(S => E.storytellerKill(S, id, null, why), 'смерть: ' + E.nm(S, id));
  },
  edAlign: id => act(S => { const p = E.P(S, id); p.align = p.align === 'good' ? 'evil' : 'good'; E.log(S, `${p.name} теперь ${p.align === 'good' ? 'добрый' : 'злой'}`, 'effect'); }),
  edGhost: id => act(S => { const p = E.P(S, id); p.ghost = !p.ghost; }, 'голос призрака'),
  edTok: id => { const k = document.getElementById('tokKind-' + id).value; act(S => E.addTok(S, E.P(S, id), k, null, null), 'жетон «' + E.TOK_RU[k] + '»'); },
  edTokDel: arg => { const [id, i] = arg.split('|'); act(S => E.P(S, id).tokens.splice(+i, 1), 'снят жетон'); },
  // меню
  toggleHide: () => { UI.hideInactive = !UI.hideInactive; autoSkip(); render(); },
  skin: k => { if (!SKINS.some(s => s[0] === k)) return; UI.skin = k; try { localStorage.setItem(SKIN_KEY, k); } catch (e) { /* без хранилища — до перезагрузки */ } render(); },
  splashOff: () => { UI.splash = false; render(); },
  askNew: () => { UI.confirm = 'new'; render(); },
  pgDelAsk: id => { UI.confirm = 'pg:' + id; render(); },
  pgDel: id => { UI.confirm = null; gameDelete(id).then(render); render(); },
  cancelConfirm: () => { UI.confirm = null; render(); },
  newGame: () => {
    gameArchive(S); // прошлая игра — в историю (archive.js); подготовку без ночей не храним
    const key = S.script.key === 'custom' ? 'ecbe' : S.script.key, names = S.players.filter(p => !E.isTraveller(p)).map(p => p.name), dir = S.flags.seatDir;
    HISTORY = []; S = E.newGame(key); S.players = names.map(n => E.newPlayer(n)); if (dir) S.flags.seatDir = dir; // направление мест — как в прошлой игре
    UI.confirm = null; UI.tab = 'game'; persist(); render();
  },
  copyJson: () => {
    const text = JSON.stringify(S);
    const done = () => { UI.copied = 'Скопировано. Вставьте этот текст на другом устройстве в поле ниже.'; render(); };
    try { navigator.clipboard.writeText(text).then(done, () => { UI.importText = text; UI.copied = 'Не удалось скопировать автоматически: текст игры в поле ниже, выделите и скопируйте его.'; render(); }); }
    catch (e) { UI.importText = text; UI.copied = 'Текст игры в поле ниже — выделите и скопируйте его.'; render(); }
  },
  importText: (a, el) => { UI.importText = el.value; },
  importJson: () => { try { const s = JSON.parse(UI.importText); if (!s.players || !s.script) throw 0; if (s.id !== S.id) gameArchive(S); HISTORY.push({ s: JSON.stringify(S), label: 'загрузка игры' }); S = upgrade(s); S.updated = Date.now(); UI.importText = ''; UI.copied = ''; UI.tab = 'game'; persist(); render(); } catch (e) { alertNote('Это не похоже на сохранённую игру.'); } },
};
Object.assign(A, NOTE_ACTS); // заметки «что доработать» (notes.js)
function alertNote(text) { UI.copied = ''; UI.notes = [text]; render(); }
// казнь: итог показываем окном (умирает / не умирает и почему — только рассказчику)
const exeMark = () => S.day && S.day.exeResult;
function showExeResult(before) { const r = exeMark(); if (r && r !== before && !S.result) { UI.exeRes = r; render(); } }
function doEndDay(opts) {
  const before = exeMark(), sg = S.day.picks.scapegoat; UI.notes = [];
  act(S => E.endDay(S, Object.assign({ scapegoat: sg }, opts)), 'конец дня ' + S.n); window.scrollTo(0, 0);
  showExeResult(before);
}
function doManualExe(id, opts) {
  const before = exeMark();
  act(S => { E.execute(S, id, opts); if (!S.result) E.endDay(S, { skipExecution: true }); }); window.scrollTo(0, 0);
  showExeResult(before);
}
// окно до казни: Пацифист (помиловать или казнить — вики: «примерно раз за игру») или «камень-ножницы-бумага» Психопата
function exeAskHtml() {
  const a = UI.exeAsk, p = a && E.P(S, a.pid); if (!p || S.phase !== 'day') return '';
  let body = '';
  if (a.q === 'pacifist') {
    const saves = S.flags.pacifistSaves || 0;
    body = `<h3>Пацифист: казнят ${esc(p.name)}</h3>
      <div>Казнён добрый игрок, а Пацифист в игре и трезв — решите, умирает ли он.</div>
      <div class="small muted">Вики: срабатывать примерно <b>раз за игру</b> — обычно в самый раз; можно чаще, если уместно; изредка — ни разу, чтобы Пацифист выглядел подозрительно. Не говорите почему: «казнён, но жив». Казнь дня всё равно состоялась.${saves ? ` Уже помиловано в этой игре: ${saves}.` : ''}</div>
      <div class="confirm"><button class="btn ok" data-act="exeAnswer" data-arg="spare">Помиловать — не умирает</button><button class="btn no" data-act="exeAnswer" data-arg="kill">Казнить — умирает</button></div>`;
  } else {
    const by = S.day.nomBy && S.day.nomBy[p.id], who = by && by !== p.id && by !== 'st' ? E.nm(S, by) : 'вами (самономинация — играет с рассказчиком)';
    body = `<h3>Психопат казнён: ${esc(p.name)}</h3>
      <div>Психопат играет в «камень-ножницы-бумагу» с ${esc(who)}. Умирает, только если проиграл; ничья или выигрыш — жив (вики).</div>
      <div class="small muted">Казнь дня всё равно состоялась.</div>
      <div class="confirm"><button class="btn no" data-act="exeAnswer" data-arg="lose">Проиграл — умирает</button><button class="btn ok" data-act="exeAnswer" data-arg="live">Ничья или выиграл — жив</button></div>`;
  }
  return `<div class="ov editres" role="alertdialog" aria-label="Решение о казни"><div class="statbg" data-act="exeAskClose"></div><div class="erbox statbox">${body}
    <button class="btn wide" data-act="exeAskClose">Отмена — вернуться к дню</button></div></div>`;
}
// после подсчёта голосов: мёртвые, которые проголосовали и потратили голос призрака
const shroudMini = () => SHROUD_SVG.replace('class="shroud"', 'class="glmini"');
function ghostLostHtml() {
  const list = UI.ghostLost; if (!list || !list.length || S.phase !== 'day') return '';
  return `<div class="ov editres" role="alertdialog" aria-label="Голоса призраков"><div class="statbg" data-act="ghostLostClose"></div><div class="erbox statbox">
    <h3>Последнего голоса лишились</h3><div class="ghostlost">${list.map(n => `<div>${shroudMini()}<b>${esc(n)}</b></div>`).join('')}</div>
    <div class="small muted">Голос призрака потрачен — больше эти игроки голосовать не могут.</div>
    <button class="btn primary wide" data-act="ghostLostClose">Понятно</button></div></div>`;
}
// все факты, сказанные Саванту за игру: по дням, П — правда, Л — ложь
function savFactsHtml() {
  if (!UI.savFacts) return '';
  const list = S.flags.savantFacts || [];
  const body = list.length ? list.map(x => `<div class="savday"><div class="lab">День ${x.n}${S.players.filter(p => p.role === 'savant').length > 1 ? ` · ${esc(E.nm(S, x.pid))}` : ''}</div>
    ${x.facts.map(f => `<div class="savf"><b class="savtag ${f.truth ? 't' : 'f'}">${f.truth ? 'П' : 'Л'}</b><span>${esc(f.text)}${f.own ? ' <span class="muted small">(свой)</span>' : ''}</span></div>`).join('')}</div>`).join('')
    : '<div class="small muted">Пока ни одного факта не сказано. Факты попадают сюда кнопкой «Сказано — записать» на экране дня.</div>';
  return `<div class="ov editres" role="dialog" aria-label="Факты Саванта"><div class="statbg" data-act="savFactsClose"></div><div class="erbox statbox">
    <h3>Факты Саванта</h3>${body}<button class="btn wide" data-act="savFactsClose">Закрыть</button></div></div>`;
}
// окно с советами вики (Яга создала Демона): {title, lines, src}
function tipHtml() {
  const t = UI.tip; if (!t) return '';
  return `<div class="ov editres" role="alertdialog" aria-label="${esc(t.title)}"><div class="statbg" data-act="tipClose"></div><div class="erbox statbox tipbox">
    <h3>${esc(t.title)}</h3>${t.lines.map(l => `<p>${esc(l)}</p>`).join('')}${t.src ? `<div class="small muted">${esc(t.src)}</div>` : ''}
    <button class="btn primary wide" data-act="tipClose">Понятно</button></div></div>`;
}
// окно в конце дня: делала ли Сплетница публичное заявление (верное — ночью кто-то умирает, выбор — на её шаге)
function gossipAskHtml() {
  const a = UI.gossipAsk, p = a && E.P(S, a.pid); if (!p || S.phase !== 'day') return '';
  return `<div class="ov editres" role="alertdialog" aria-label="Сплетница"><div class="statbg" data-act="gossipClose"></div><div class="erbox statbox">
    <h3>Сплетница</h3>${p.role !== 'gossip' ? `<div class="small muted">На самом деле ${esc(E.rname(p.role))} — считает себя Сплетницей.</div>` : ''}
    <div>Сделала ли Сплетница сегодня публичное заявление?</div>
    <div class="small muted">Вики: считается только ясное заявление, которое слышали все и про которое вы знаете, верно оно или нет. Верное — этой ночью кто-то умирает (выберете на её шаге); неверное или не было — никто.</div>
    <textarea id="gossipText" placeholder="Заявление — необязательно, напомнит ночью" aria-label="Заявление Сплетницы"></textarea>
    <div class="confirm"><button class="btn ok" data-act="gossipAnswer" data-arg="yes">Да, было</button><button class="btn no" data-act="gossipAnswer" data-arg="no">Нет</button></div>
    <button class="btn wide" data-act="gossipClose">Отмена — вернуться к дню</button></div></div>`;
}
// окно после казни: «Казнён: умирает / не умирает» → «Продолжить» (дальше ночь)
function exeResHtml() {
  const r = UI.exeRes, p = r && E.P(S, r.pid); if (!p) return '';
  return `<div class="ov editres" role="alertdialog" aria-label="Итог казни"><div class="erbox statbox exeres">
    <div class="lab">Казнь</div><div class="exename">${esc(p.name)}</div>
    <div class="exeverd ${r.died || r.dead ? 'die' : 'live'}">${r.died ? 'Умирает' : r.dead ? 'Уже мёртв' : 'Не умирает'}</div>
    ${r.dead ? '<div class="small muted">Казнён мёртвый игрок: казнь дня состоялась, он остаётся мёртвым.</div>'
      : r.died ? '' : `<div class="small muted">Только для вас: ${esc(r.why || 'защита')}. Объявите «казнён, но жив» — не говорите почему.</div>`}
    <button class="btn primary wide" data-act="exeResClose">Продолжить</button></div></div>`;
}
// стена «выкатывается» сверху один раз при показе, дальше перерисовки идут без анимации
function wallIn() { UI.wall = true; UI.wallAnim = true; render(); setTimeout(() => { UI.wallAnim = false; }, 1200); }

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]'); if (!el || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return;
  const f = A[el.dataset.act]; if (f) { ev.preventDefault(); f(el.dataset.arg, el); }
});
document.addEventListener('change', ev => {
  const el = ev.target; if (!el.dataset || !el.dataset.act) return;
  if (el.tagName === 'SELECT' || el.tagName === 'INPUT') { const f = A[el.dataset.act]; if (f) f(el.dataset.arg, el); }
  // текст шага ночи (свой текст Амнезиака, тайное слово) вписан — перерисовать, чтобы появилась кнопка показа
  if (el.tagName === 'TEXTAREA' && el.dataset.act === 'pickT') render();
});
document.addEventListener('input', ev => {
  // текстовые поля и «живые» поля ввода (поиск) — без перерисовки на каждую букву
  const el = ev.target; if (!el.dataset || !el.dataset.act || (el.tagName !== 'TEXTAREA' && !el.dataset.live)) return;
  const f = A[el.dataset.act]; if (f) f(el.dataset.arg, el);
});
document.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.id === 'newName') A.addP(); if (ev.key === 'Enter' && ev.target.id === 'pinIn') A.pinOk(); });
// круг Гримуара для Шпиона подстраивается под экран (поворот телефона, размер окна)
let resizeTimer = null;
window.addEventListener('resize', () => { if (!UI.grimShow) return; clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });

// порядок мест: зажать ручку ⠿ и тянуть (пальцем или мышью); строки раздвигаются, на отпускании — новое место
let dragS = null;
document.addEventListener('pointerdown', ev => {
  const h = ev.target.closest('[data-drag]'); if (!h) return;
  const row = h.closest('[data-row]'), rows = [...row.parentElement.querySelectorAll(':scope > [data-row]')];
  if (rows.length < 2) return;
  ev.preventDefault(); try { h.setPointerCapture(ev.pointerId); } catch (e) { /* без захвата тоже работает */ }
  const step = rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top;
  dragS = { id: h.dataset.drag, row, rows, y0: ev.clientY, from: rows.indexOf(row), to: rows.indexOf(row), step };
  row.classList.add('dragging');
});
document.addEventListener('pointermove', ev => {
  if (!dragS) return; ev.preventDefault();
  const dy = ev.clientY - dragS.y0, { from, rows, step } = dragS;
  const to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / step)));
  dragS.to = to; dragS.row.style.transform = `translateY(${dy}px)`;
  rows.forEach((r, i) => { if (r === dragS.row) return; const s = from < to && i > from && i <= to ? -step : from > to && i < from && i >= to ? step : 0; r.style.transform = s ? `translateY(${s}px)` : ''; });
}, { passive: false });
const dragEnd = () => {
  if (!dragS) return; const { id, from, to, rows } = dragS; dragS = null;
  rows.forEach(r => { r.style.transform = ''; r.classList.remove('dragging'); });
  if (from !== to) act(S => { const i = S.players.findIndex(p => p.id === id); const [p] = S.players.splice(i, 1); S.players.splice(to, 0, p); }, 'порядок мест');
};
document.addEventListener('pointerup', dragEnd);
document.addEventListener('pointercancel', dragEnd);

// рассадка кругом: зажать игрока и тянуть; место — по углу от центра круга, остальные сдвигаются; на отпускании — новый порядок
let ringS = null;
const ringXY = (G, n, i) => { const a = Math.PI + G.dir * 2 * Math.PI * i / n; return { x: 50 + G.rx * Math.sin(a), y: G.H / 2 - G.ry * Math.cos(a) }; };
document.addEventListener('pointerdown', ev => {
  const el = ev.target.closest('[data-rdrag]'); if (!el) return;
  const board = el.closest('.ring'), seats = [...board.querySelectorAll('[data-rdrag]')];
  ev.preventDefault(); try { el.setPointerCapture(ev.pointerId); } catch (e) { /* без захвата тоже работает */ }
  const from = seats.indexOf(el);
  ringS = { el, board, seats, from, to: from, G: JSON.parse(board.dataset.geom), rect: board.getBoundingClientRect(), x0: ev.clientX, y0: ev.clientY, moved: false };
});
document.addEventListener('pointermove', ev => {
  if (!ringS) return; ev.preventDefault();
  const { el, seats, G, rect } = ringS, n = seats.length;
  // нажатие без движения — открыть карточку игрока (назначить роль или тип); тянуть — от 8 px
  if (!ringS.moved) { if (n < 2 || Math.hypot(ev.clientX - ringS.x0, ev.clientY - ringS.y0) < 8) return; ringS.moved = true; el.classList.add('dragging'); }
  const px = (ev.clientX - rect.left) / rect.width * 100, py = (ev.clientY - rect.top) / rect.width * 100; // в cqw
  // угол от верха по часовой → номер места: первое — внизу (π), дальше в сторону G.dir
  const a = Math.atan2(px - 50, G.H / 2 - py), step = 2 * Math.PI / n;
  const to = ((Math.round((a - Math.PI) * G.dir / step) % n) + n) % n;
  el.style.left = (px - G.t / 2) + 'cqw'; el.style.top = (py - G.t / 2) + 'cqw';
  if (to === ringS.to) return;
  ringS.to = to;
  const order = seats.filter(s => s !== el); order.splice(to, 0, el);
  order.forEach((s, i) => {
    s.querySelector('.rno').textContent = i + 1;
    if (s === el) return;
    const c = ringXY(G, n, i); s.style.left = (c.x - G.t / 2) + 'cqw'; s.style.top = (c.y - G.t / 2) + 'cqw';
  });
}, { passive: false });
const ringEnd = ev => {
  if (!ringS) return; const { el, from, to, moved } = ringS, id = el.dataset.rdrag; ringS = null;
  el.classList.remove('dragging');
  if (!moved) { if (ev.type === 'pointerup') { UI.open = id; render(); } return; }
  if (from !== to) act(S => { const i = S.players.findIndex(p => p.id === id); const [p] = S.players.splice(i, 1); S.players.splice(to, 0, p); }, 'порядок мест');
  else render();
};
document.addEventListener('pointerup', ringEnd);
document.addEventListener('pointercancel', ringEnd);

/* ------------------------------------------------------------ запуск */
function boot(hotData) {
  if (hotData && hotData.S) { S = hotData.S; HISTORY = hotData.H || []; }
  if (!S) {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) S = JSON.parse(raw); } catch (e) { S = null; }
    try { const h = localStorage.getItem(LS_HIST); if (h) HISTORY = JSON.parse(h) || []; } catch (e) { HISTORY = []; }
  }
  if (!S) S = sampleGame();
  S = upgrade(S);
  // настройки этого устройства: показ игрокам горизонтально и каким боком
  try { UI.showLand = localStorage.getItem('botc-grimoire-showland') === '1'; UI.showFlip = localStorage.getItem('botc-grimoire-showflip') === '1'; UI.pickRing = localStorage.getItem('botc-grimoire-pickring') === '1';
    UI.grimGrid = localStorage.getItem('botc-grimoire-grimgrid') === '1'; } catch (e) { /* по умолчанию — вертикально, квадратиками; Гримуар — кругом */ }
  if (TEST) UI.testWelcome = true; // тестовая сборка: окно приветствия при каждом открытии
  UI.skin = skinLoad();
  if (!hotData && UI.skin !== 'basic') { UI.splash = true; setTimeout(() => { if (UI.splash) { UI.splash = false; render(); } }, 2000); }
  if (!document.getElementById('artvars')) artVars();
  render();
  connectCloud();
}
function sampleGame() {
  const g = E.newGame('ecbe');
  g.players = ['Аня', 'Борис', 'Вика', 'Гоша', 'Даша', 'Егор', 'Женя', 'Зоя'].map(n => E.newPlayer(n));
  return g;
}
(function () {
  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.snapshot === 'function') { try { hot.snapshot(() => ({ S, H: HISTORY })); } catch (e) { /* нет поддержки */ } }
  if (hot && typeof hot.ready === 'function') hot.ready(boot); else boot(hot && hot.data);
})();
