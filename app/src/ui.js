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
// Любое изменение партии идёт через act: снимок → изменение → автопропуск → сохранение → подсказка с отменой
function act(fn, label) {
  HISTORY.push({ s: JSON.stringify(S), label: label || '' });
  if (HISTORY.length > HIST_MAX) HISTORY.shift();
  const logLen = S.log.length;
  fn(S); autoSkip(); S.updated = Date.now();
  const last = S.log.length > logLen ? S.log[S.log.length - 1].t : '';
  HISTORY[HISTORY.length - 1].label = label || last || 'изменение';
  persist(); render();
  toast('Готово: ' + HISTORY[HISTORY.length - 1].label, true);
}
function undo() {
  const h = HISTORY.pop(); if (!h) return;
  S = JSON.parse(h.s); S.updated = Date.now();
  persist(); render(); toast('Отменено: ' + h.label, false);
}
// изменение черновика (выбор игроков до «Готово») — сохраняем без записи в историю
function draft(fn) { fn(S); S.updated = Date.now(); persist(); render(); }
function autoSkip() {
  if (!S || S.phase !== 'night' || !UI.hideInactive) return;
  let guard = 0;
  while (S.phase === 'night' && guard++ < 100) {
    const st = E.currentStep(S); if (!st) break;
    if (E.stepSpec(S, st).active) break;
    E.skipStep(S);
  }
}

/* ------------------------------------------------------------ хранение: браузер (всегда) + облако claude.ai (если есть) */
const LS_KEY = 'botc-grimoire-v1', LS_HIST = 'botc-grimoire-history-v1';
let dbRef = null, saveTimer = null, saving = false, saveAgain = false;
function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* хранилище недоступно */ }
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
const art = (k, cls) => (typeof ART !== 'undefined' && ART[k]) ? `<img class="${cls}" src="${ART[k]}" alt="">` : '';
const roleLine = p => p.role ? `<span class="cr t-${team(p.role)}">${esc(E.rname(p.role))}${p.believes ? ' → ' + esc(E.rname(p.believes)) : ''}${E.isTraveller(p) ? ' · Странник' : ''}</span>` : '<span class="cr muted">без роли</span>';

// ядовитые капли: пьянство, отравление, Вортокс — информация может (или должна) быть ложной
const DROP_D = 'M12 2C12 2 5 10.5 5 15a7 7 0 0 0 14 0C19 10.5 12 2 12 2Z';
const DROP_SVG = `<svg class="drop1" viewBox="0 0 24 24" aria-hidden="true"><path d="${DROP_D}"/><circle cx="9.6" cy="15.2" r="1.7" class="gl"/></svg>`;
const DROPS_SVG = `<svg class="drops" viewBox="0 0 46 26" aria-hidden="true"><path transform="translate(0 3) scale(.9)" d="${DROP_D}"/><path transform="translate(13 0) scale(1.08)" d="${DROP_D}"/><path transform="translate(29 7) scale(.72)" d="${DROP_D}"/></svg>`;
// потёки по верхнему краю «ядовитой» рамки
const DRIP_SVG = `<svg class="drip" viewBox="0 0 200 16" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0H200V3C192 3 191 9 188 9S185 3 178 3H132C126 3 126 14 121 14S116 3 110 3H66C61 3 61 8 58 8S55 3 50 3H22C17 3 17 11 13 11S9 3 4 3H0Z"/></svg>`;

// выбор игроков — компактные квадратики: иконка роли (днём — номер места), имя; мёртвых тоже можно выбрать
function chipsPlayers(key, n, filter, selected, opts) {
  opts = opts || {};
  return '<div class="ptiles">' + S.players.map((p, i) => {
    const okp = filter(p), on = selected.includes(p.id);
    const icon = opts.noRole ? `<span class="seatno">${i + 1}</span>` : (p.role ? ico(p.role, p.align, 'pti') : `<span class="seatno">${i + 1}</span>`);
    const ghost = !p.alive && opts.ghost ? (p.ghost ? 'голос есть' : 'без голоса') : '';
    const sub = opts.noRole ? (ghost || (E.isTraveller(p) ? 'Странник' : '')) : [p.role ? E.rname(p.role) : '', ghost].filter(Boolean).join(' · ');
    const off = !opts.noRole && S.phase !== 'setup' && p.role && E.abilityOff(S, p);
    return `<button class="ptile ${on ? 'on' : ''} ${p.alive ? '' : 'dead'}" data-act="${opts.act || 'pickP'}" data-arg="${key}|${p.id}|${n}" ${okp ? '' : 'disabled'} aria-pressed="${on}" aria-label="${esc(p.name)}${p.alive ? '' : ', мёртв'}${p.role && !opts.noRole ? ', ' + esc(E.rname(p.role)) : ''}">
      ${opts.noRole ? '' : `<span class="pno">${i + 1}</span>`}${p.alive ? '' : `<span class="pdead" title="мёртв">${art('dead', 'pdi') || '✝'}</span>`}${off ? `<span class="ppois" title="${esc(off)}">${DROP_SVG}</span>` : ''}
      <span class="pic">${icon}</span><span class="pname">${esc(p.name)}</span>${sub ? `<span class="prole">${esc(sub)}</span>` : ''}${on ? '<span class="pck" aria-hidden="true">✓</span>' : ''}</button>`;
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
// порядок голосования: начиная со следующего за номинированным по часовой, номинированный — последний
function voteOrder(onId) {
  const k = S.players.findIndex(p => p.id === onId);
  return k < 0 ? S.players : S.players.slice(k + 1).concat(S.players.slice(0, k + 1));
}

/* показ игроку на весь экран: только жетоны, без остальной информации. screens: [{caption, items:[{role, align}], thumb}] */
function tokenGroups(tokens) {
  const groups = [];
  for (const t of tokens || []) {
    if (!t || !t.role || !DATA.roles[t.role]) continue;
    let g = groups.find(x => x.label === (t.label || ''));
    if (!g) groups.push(g = { label: t.label || '', screens: [] });
    const last = g.screens[g.screens.length - 1];
    if (last && last.caption === (t.caption || '') && !t.thumb && !last.thumb) last.items.push(t);
    else g.screens.push({ caption: t.caption || '', thumb: t.thumb || null, items: [t] });
  }
  return groups;
}
function showButtons(tokens) {
  const groups = tokenGroups(tokens); if (!groups.length) return '';
  UI.showGroups = groups;
  return `<div class="showbtns">${groups.map((g, i) => `<button class="btn showbtn" data-act="showOpen" data-arg="${i}">${art('eye', 'bg')}${g.label ? 'Показать: ' + esc(g.label) : 'Показать игроку на экране'}</button>`).join('')}</div>`;
}
function showOverlay() {
  const sh = UI.show; if (!sh) return '';
  const sc = sh.screens[sh.i]; if (!sc) return '';
  const one = sc.items.length === 1;
  const roleBox = t => { const r = DATA.roles[t.role], al = t.align || (sc.thumb === 'down' ? 'evil' : sc.thumb === 'up' ? 'good' : (isGoodRole(t.role) ? 'good' : 'evil'));
    return `<div class="shrole side-${al}">${ico(t.role, al, 'shic')}<div class="shname">${esc(E.rname(t.role))}</div>${one ? `<div class="shab">${esc(r.ability)}</div>` : ''}</div>`; };
  return `<div class="ov showov" data-act="showNext" role="dialog" aria-label="Показ игроку">
    ${sc.caption ? `<div class="shcap">${esc(sc.caption)}</div>` : ''}
    <div class="shroles n${Math.min(sc.items.length, 3)}">${sc.items.map(roleBox).join('')}</div>
    ${sc.thumb ? `<div class="shthumb side-${sc.thumb === 'down' ? 'evil' : 'good'}"><span aria-hidden="true">${sc.thumb === 'down' ? '👎' : '👍'}</span>${sc.thumb === 'down' ? 'Вы злой' : 'Вы добрый'}</div>` : ''}
    <div class="shhint">${sh.i + 1 < sh.screens.length ? `Нажмите — дальше (${sh.i + 1} из ${sh.screens.length})` : 'Нажмите, чтобы закрыть'}</div></div>`;
}
// роль игрока, которую он видит (Пьяница — кем себя считает, Лунатик — своего «Демона»)
const seenRole = p => (p.role === 'drunk' || p.role === 'lunatic') && p.believes ? p.believes : p.role;
// свёрнутый выбор: заголовок с текущим значением, по нажатию раскрывается список квадратиков
function pickRow(key, label, value, body) {
  const open = UI.pickOpen === key;
  return `<div class="pick"><button class="pickhead ${open ? 'open' : ''}" data-act="pickOpen" data-arg="${key}" aria-expanded="${open}">
    <span class="pl">${esc(label)}</span><span class="pv ${value ? '' : 'muted'}">${value ? esc(value) : 'выбрать'}</span><span class="pc" aria-hidden="true">${open ? '▴' : '▾'}</span></button>${open ? body : ''}</div>`;
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
const plainOptions = (ids, selected, placeholder) => `<option value="">${placeholder || '— выберите —'}</option>` + ids.map(r => `<option value="${r}" ${r === selected ? 'selected' : ''}>${esc(E.rname(r))}</option>`).join('');

function fieldHtml(f, inp) {
  const v = inp[f.key];
  if (f.type === 'players') {
    const sel = v || [];
    return `<div class="field"><div class="flabel"><span>${esc(f.label)}</span><span>${sel.length}/${f.n > 50 ? '…' : f.n}</span></div>${chipsPlayers(f.key, f.n, f.filter, sel)}</div>`;
  }
  if (f.type === 'role') return `<div class="field"><label>${esc(f.label)}</label><select data-act="pickR" data-arg="${f.key}">${roleOptions(r => f.filter(r), v, { all: f.all, placeholder: f.optional ? '— не выбирать —' : undefined })}</select></div>`;
  if (f.type === 'choice') return `<div class="field"><label>${esc(f.label)}</label><div class="seg">${f.options.map(o => `<button class="${(v ?? f.def) === o.v ? 'on' : ''}" data-act="pickC" data-arg="${f.key}|${o.v}">${esc(o.l)}</button>`).join('')}</div></div>`;
  if (f.type === 'number') { const nv = v ?? f.def ?? 0;
    return `<div class="field"><label>${esc(f.label)}</label><div class="stepper"><button class="btn" data-act="num" data-arg="${f.key}|-1|${nv}">−</button><b>${nv}</b><button class="btn" data-act="num" data-arg="${f.key}|1|${nv}">+</button></div></div>`; }
  if (f.type === 'text') return `<div class="field"><label for="tx-${f.key}">${esc(f.label)}</label><textarea id="tx-${f.key}" data-act="pickT" data-arg="${f.key}">${esc(v)}</textarea></div>`;
  return '';
}

// слова рассказчика на рассвет: вариант закреплён за ночью, «другой вариант» листает по кругу
function morningHtml(withNext) {
  const names = S.night.deaths.map(d => `<b>${esc(E.nm(S, d.pid))}</b>`);
  const seed = [...(S.id + ':' + S.n)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const m = morningText(names, S.n === 1, S.night.data.morn ?? seed);
  return `<div class="tale"><div class="lab">Слова для утра</div><p>${m.text}</p>
    ${withNext ? `<button class="linkish" data-act="mornNext" data-arg="${m.i}">Другой вариант · ${m.i + 1} из ${m.total}</button>` : ''}</div>`;
}
function boundsHtml(list) {
  return `<div class="bounds"><div class="lab">Рамки выбора</div>${list.map(b => `<div><b>${esc(b.w)}:</b> ${esc(b.t)}</div>`).join('')}</div>`;
}
function situationHtml() { return E.situation(S).map(w => `<div class="warn">${esc(w)}</div>`).join(''); }
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
function viewSetup() {
  const sc = S.script, core = S.players.filter(p => !E.isTraveller(p)), n = core.length;
  const presets = Object.entries(DATA.scripts).map(([k, s]) => `<button class="${sc.key === k ? 'on' : ''}" data-act="script" data-arg="${k}">${esc(s.name)}</button>`).join('');
  const counts = ['townsfolk', 'outsider', 'minion', 'demon'].map(t => `${E.TEAM_RU[t]}: ${sc.roles.filter(r => team(r) === t).length}`).join(' · ');
  const players = S.players.map((p, i) => `<div class="row prow-edit ${E.isTraveller(p) ? 'is-tr' : ''}" style="flex-wrap:nowrap">
      <span class="muted small" style="width:20px">${i + 1}</span>
      <input type="text" id="pn-${p.id}" value="${esc(p.name)}" data-act="rename" data-arg="${p.id}" aria-label="Имя игрока ${i + 1}">
      <button class="btn sq" data-act="move" data-arg="${p.id}|-1" aria-label="Выше">↑</button>
      <button class="btn sq" data-act="move" data-arg="${p.id}|1" aria-label="Ниже">↓</button>
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
      <div class="row"><button class="btn" data-act="deal">Раздать роли случайно</button><button class="btn" data-act="${S.draw && !S.draw.finished ? 'wallShow' : 'drawStart'}">${S.draw && !S.draw.finished ? 'Продолжить жребий' : 'Жребий: каменная стена'}</button></div>
      ${S.players.map(p => {
        const side = !p.role ? 'none' : (E.isTraveller(p) ? p.align : (isGoodRole(p.role) ? 'good' : 'evil'));
        return `<div class="field rolepick side-${side}"><label><span>${esc(p.name)}</span><span>${side === 'good' ? 'добрый' : side === 'evil' ? 'злой' : ''}</span></label>
        ${E.isTraveller(p) ? `<div class="small">${esc(E.rname(p.role))} — Странник</div>` : `<select data-act="setRole" data-arg="${p.id}">${roleOptions(() => true, p.role)}</select>`}
        ${p.role === 'drunk' ? `<select data-act="setBelieves" data-arg="${p.id}">${roleOptions(r => team(r) === 'townsfolk' && !S.players.some(q => q.role === r), p.believes, { placeholder: '— кем себя считает —' })}</select>` : ''}
        ${p.role === 'lunatic' ? `<select data-act="setBelieves" data-arg="${p.id}">${roleOptions(r => team(r) === 'demon', p.believes, { placeholder: '— каким Демоном себя считает —' })}</select>` : ''}
      </div>`; }).join('')}</div>`;
  } else if (n > 15) roles = '<div class="warn">Больше 15 игроков: лишние должны быть Странниками.</div>';
  const notIn = r => DATA.roles[r] && isGoodRole(r) && !S.players.some(p => p.role === r || p.believes === r);
  const goodPl = core.filter(p => p.role && isGoodRole(p.role));
  const pickSel = (act, label, cur, list) => `<div class="field"><label>${label}</label><select data-act="${act}"><option value="">—</option>${list.map(p => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)} (${esc(E.rname(p.role))})</option>`).join('')}</select></div>`;
  const prep = n >= 5 && S.players.every(p => p.role) ? `<div class="card"><h3>Подготовка</h3>
      <div class="field"><label>Блефы Демона: 3 добрые роли, которых нет в игре</label>
      ${[0, 1, 2].map(i => `<select data-act="bluff" data-arg="${i}">${roleOptions(r => notIn(r) || r === S.bluffs[i], S.bluffs[i])}</select>`).join('')}</div>
      ${S.players.some(p => p.role === 'grandmother') ? pickSel('setFlag-grandchild', 'Внук Бабушки', S.flags.grandchild, goodPl.filter(p => p.role !== 'grandmother')) : ''}
      ${S.players.some(p => p.role === 'fortuneteller') ? pickSel('setFlag-ftHerring', 'Ложная цель Гадалки (добрый игрок)', S.flags.ftHerring, goodPl) : ''}
      ${S.players.some(p => p.role === 'eviltwin') ? pickSel('setFlag-goodTwin', 'Добрый близнец', S.flags.goodTwin, goodPl) : ''}
      ${S.players.filter(p => p.role === 'amnesiac').map(p => `<div class="field"><label for="amn-${p.id}">Способность Амнезиака (${esc(p.name)}) — придумайте сами, игрок её не узнает</label>
        <textarea id="amn-${p.id}" data-act="amnText" data-arg="${p.id}" placeholder="Например: каждую ночь узнаёт, сколько живых Горожан среди его соседей">${esc(S.flags['amnesiac_' + p.id] || '')}</textarea></div>`).join('')}
      <button class="btn" data-act="autoPrep">Заполнить случайно</button></div>` : '';
  const probs = E.setupProblems(S), jinx = E.jinxesInPlay(S);
  return `${notesHtml()}<div class="card"><h3>Сценарий</h3><div class="seg">${presets}</div><div class="small muted">«${esc(sc.name)}» — ${counts}</div>
      <details><summary class="small">Загрузить свой сценарий (JSON из конструктора)</summary>
      <div class="field" style="margin-top:8px"><textarea id="customJson" data-act="customText" placeholder='[{"id":"_meta","name":"Мой сценарий"},"washerwoman","imp"]'>${esc(UI.customText)}</textarea>
      <button class="btn" data-act="customLoad">Загрузить</button></div></details></div>
    <div class="card"><h3>Игроки по кругу (по часовой)</h3>${players || '<div class="muted small">Добавьте игроков в порядке, в котором они сидят.</div>'}
      <div class="row" style="flex-wrap:nowrap"><input type="text" id="newName" placeholder="Имя игрока" aria-label="Имя нового игрока"><button class="btn" data-act="addP">Добавить</button></div>
      <details><summary class="small">Вставить список имён</summary><div class="field" style="margin-top:8px"><textarea id="bulkNames" placeholder="Аня, Борис, Вика…"></textarea><button class="btn" data-act="bulk">Заменить список</button></div></details>
      ${travellerForm()}</div>
    ${roles}${prep}${fabledZone()}
    ${jinx.length ? `<div class="card"><h3>Джинксы</h3>${jinx.map(j => `<div class="small"><b>${esc(E.rname(j.a))} и ${esc(E.rname(j.b))}:</b> ${esc(j.text)}</div>`).join('')}</div>` : ''}
    ${probs.length ? `<div class="warn">${probs.map(esc).join('<br>')}</div>` : ''}
    <button class="btn primary wide" data-act="start" ${probs.length ? 'disabled' : ''}>Начать игру: первая ночь</button>`;
}

function stepDraft(st, spec) {
  const key = S.n + ':' + S.night.i + ':' + st.key;
  if (!S.draft || S.draft.key !== key) S.draft = { key, inp: clone(spec.defaults || {}) };
  return S.draft.inp;
}

// блок ответа; при пьянстве/яде/Вортоксе — зелёная «ядовитая» рамка с каплями и крупной пометкой
function revealHtml(info, dist) {
  const tag = dist ? `<div class="ptag">${DROPS_SVG}<b>${esc(dist.label)}</b><span>${dist.vortox ? 'информация Горожан должна быть ЛОЖНОЙ' : 'информацию можно исказить'}</span></div>` : '';
  return `<div class="reveal ${info.secret ? 'secret' : ''} ${dist ? 'poison' : ''}">${dist ? DRIP_SVG : ''}${tag}
    <div class="lab">${info.secret ? 'Только для вас — не показывайте' : 'Покажите / объявите'}</div>${info.show ? `<div class="big">${esc(info.show)}</div>` : ''}
    ${(info.lines || []).filter(Boolean).map(l => `<div class="ln">${esc(l)}</div>`).join('')}${info.secret ? '' : showButtons(info.tokens)}</div>`;
}

function viewNight() {
  const st = E.currentStep(S); if (!st) return '';
  const spec = E.stepSpec(S, st), inp = stepDraft(st, spec);
  const total = S.night.steps.length, i = S.night.i;
  const fields = spec.active ? E.stepInputs(spec, inp) : [];
  const missing = spec.active ? E.missingInputs(spec, inp) : [];
  let info = null; try { info = spec.active ? spec.info(inp) : null; } catch (e) { info = null; }
  const goon = spec.active ? E.goonWarn(S, st, spec, inp) : null;
  const next = S.night.steps.slice(i + 1, i + 5).map(s => `<div>${s.pid ? ico(s.fakeCannibal ? 'cannibal' : s.id, null, 'ui') : ''}${esc(s.meet ? 'Злые знакомятся' : s.fakeCannibal ? 'Каннибал — отравлен' : E.rname(s.id))}${s.pid ? ` <span>· ${esc(E.nm(S, s.pid))}</span>` : ''}</div>`).join('');
  const deaths = S.night.deaths.length ? `<div class="small"><b>Умерли этой ночью:</b> ${S.night.deaths.map(d => esc(E.nm(S, d.pid))).join(', ')}</div>` : '';
  const icon = st.pid ? ico(st.fakeCannibal ? 'cannibal' : st.id, null, 'si') : st.fabled ? ico(st.id, 'good', 'si') : art(st.id, 'si');
  return `<div class="phase-wrap">${art('night', 'phase-art')}</div><div class="progress"><i style="width:${Math.round(100 * i / total)}%"></i></div>
    ${situationHtml()}${deaths}
    <div class="card ${spec.active ? '' : 'inactive'}">
      <div class="steprole">${icon}<span class="rn t-${spec.team || ''}">${esc(spec.title)}</span>${spec.who ? `<span class="who">${esc(spec.who)}</span>` : ''}${spec.active && spec.dist ? `<span class="ppill">${DROP_SVG}${esc(spec.dist.label)}</span>` : ''}</div>
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
  parts.push(`<div class="phase-wrap">${art('day', 'phase-art')}</div>`);
  parts.push(`<div class="card"><div class="row"><h2>День ${S.n}</h2><span class="muted">живых ${E.aliveAll(S)} · для казни нужно ${th}</span></div>
    ${S.night && S.night.deaths.length ? `<div class="small">Ночью умерли: ${S.night.deaths.map(x => esc(E.nm(S, x.pid))).join(', ')}</div>` : '<div class="small muted">Ночью никто не умер</div>'}
    ${S.night ? `<details><summary class="small">Слова для утра</summary>${morningHtml(false)}</details>` : ''}
    ${notesHtml()}</div>`);
  parts.push(situationHtml());
  // Амнезиак: раз в день приватно угадывает свою способность
  for (const a of S.players.filter(p => p.role === 'amnesiac' && p.alive)) {
    const done = (d.amnesiac || {})[a.id], ab = S.flags['amnesiac_' + a.id];
    parts.push(`<div class="card"><h3>Амнезиак: ${esc(a.name)}</h3>
      ${boundsHtml([{ w: 'Игрок', t: 'раз в день приватно угадывает, какая у него способность' }, { w: 'Вы отвечаете', t: '«Холодно» — совсем не то, «Тепло» — в верную сторону, «Горячо» — очень близко, «В точку» — угадал (даже другими словами)' }])}
      <div class="small"><b>Его способность:</b> ${ab ? esc(ab) : '<span class="muted">не задана — впишите на подготовке или ночью на шаге Амнезиака</span>'}</div>
      ${done ? `<div class="note-ok">Сегодня: ${done.guess ? `«${esc(done.guess)}» — ` : ''}${esc(E.AMNESIAC_ANSWERS[done.answer])}</div>`
        : `<textarea data-act="amnGuessText" data-arg="${a.id}" placeholder="Догадка игрока (необязательно)" aria-label="Догадка Амнезиака">${esc(picks['amnGuess_' + a.id] || '')}</textarea>
      <div class="seg">${Object.entries(E.AMNESIAC_ANSWERS).map(([k, l]) => `<button data-act="amnAnswer" data-arg="${a.id}|${k}">${esc(l)}</button>`).join('')}</div>`}</div>`);
  }
  for (const [flag, label, actName] of [['moonchildPending', 'Дитя Луны выбирает живого игрока', 'moonchild'], ['klutzPending', 'Растяпа выбирает живого игрока', 'klutz']]) {
    if (!S.flags[flag]) continue;
    const sel = picks[actName] || [];
    parts.push(`<div class="card"><h3>${label}</h3>${boundsHtml([{ w: 'Выбирает игрок', t: 'публично, 1 живого игрока' }])}${chipsPlayers(actName, 1, p => p.alive, sel, { act: 'dayPick' })}
      <button class="btn primary" data-act="${actName}" ${sel.length ? '' : 'disabled'}>Записать выбор</button></div>`);
  }
  for (const s of S.players.filter(p => p.role === 'slayer' && p.alive && !S.flags['slayerUsed_' + p.id])) {
    const sel = picks['slay_' + s.id] || [], t = sel[0] && E.P(S, sel[0]);
    parts.push(`<div class="card"><h3>Истребитель: ${esc(s.name)}</h3>${boundsHtml([{ w: 'Игрок выбирает', t: 'публично, 1 игрока, раз за игру' }])}${chipsPlayers('slay_' + s.id, 1, p => p.alive, sel, { act: 'dayPick' })}
      ${t && t.role === 'recluse' ? `<div class="field"><label>Ваше решение: Затворник определяется Демоном?</label><div class="seg"><button class="${picks.slayReg ? '' : 'on'}" data-act="slayReg" data-arg="0">Нет</button><button class="${picks.slayReg ? 'on' : ''}" data-act="slayReg" data-arg="1">Да — он умрёт</button></div></div>` : ''}
      <button class="btn" data-act="slay" data-arg="${s.id}" ${sel.length ? '' : 'disabled'}>Выстрел</button></div>`);
  }
  // Стрелок: сразу после подсчёта 1-го голосования может застрелить проголосовавшего (раз в день)
  for (const g of S.players.filter(p => p.role === 'gunslinger' && p.alive)) {
    if (d.gunUsed || !d.noms.length) continue;
    const first = d.noms[0], sel = picks.gun || [];
    parts.push(`<div class="card"><h3>Стрелок: ${esc(g.name)}</h3>${boundsHtml([{ w: 'Игрок выбирает', t: `сразу после подсчёта 1-го голосования (за ${E.nm(S, first.on)}) — 1 проголосовавшего: тот умирает. Раз в день` }])}
      ${chipsPlayers('gun', 1, p => p.alive && first.voters.includes(p.id), sel, { act: 'dayPick', noRole: true })}
      <div class="row"><button class="btn danger" data-act="gunShoot" data-arg="${g.id}" ${sel.length ? '' : 'disabled'}>Выстрел</button><button class="btn" data-act="gunSkip">Стрелок не стреляет сегодня</button></div></div>`);
  }
  // Механик может умереть в любой момент — по решению рассказчика
  for (const t of S.players.filter(p => p.role === 'tinker' && p.alive))
    parts.push(`<div class="card"><details><summary class="small"><b>Механик (${esc(t.name)})</b> может умереть в любой момент</summary><div class="field" style="margin-top:8px">
      ${boundsHtml([{ w: 'Вы решаете', t: 'днём — объявите смерть сразу; не заканчивайте этим игру' }])}<button class="btn danger" data-act="tinkerDie" data-arg="${t.id}">Механик умирает сейчас</button></div></details></div>`);
  // Сказочник Фаталист: живой игрок раз за игру требует смерти игрока своей стороны
  if ((S.fabled || []).includes('doomsayer') && alive >= 4) {
    const by = (picks.doomBy || [])[0], a = by && E.P(S, by), vic = picks.doomV || [];
    parts.push(`<div class="card"><details><summary class="small"><b>Фаталист:</b> игрок требует смерти игрока своей стороны</summary><div class="field" style="margin-top:8px">
      ${boundsHtml([{ w: 'Игрок', t: 'живой, раз за игру, публично (пока живы 4 и больше)' }, { w: 'Вы решаете', t: 'кто из живых игроков его стороны умирает; Демона — только если игра продолжится' }])}
      <div class="flabel"><span>Кто требует</span></div>${chipsPlayers('doomBy', 1, p => p.alive && !E.isTraveller(p) && !S.flags['doomUsed_' + p.id], by ? [by] : [], { act: 'dayPick', noRole: true })}
      ${a ? `<div class="flabel"><span>Кто умирает (${a.align === 'good' ? 'добрые' : 'злые'})</span></div>${chipsPlayers('doomV', 1, p => p.alive && p.align === a.align, vic, { act: 'dayPick' })}` : ''}
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
  const vd = E.voudonActive(S), bishop = E.bishopActive(S), butcherTurn = !!d.butcherOpen;
  if (nm.stage === 'vote') {
    const on = E.P(S, nm.on), by = nm.by === 'st' ? null : E.P(S, nm.by);
    const canVote = vd ? (p => !p.alive || p.role === 'voudon') : (p => p.alive || p.ghost);
    const cnt = E.voteCount(S, nm.voters);
    const weighted = nm.voters.map(id => E.P(S, id)).filter(v => E.voteWeight(S, v) !== 1).map(v => `${v.name}: ${E.voteWeight(S, v) === 3 ? 'голос за троих (Бюрократ)' : E.voteWeight(S, v) === -3 ? 'три голоса против (Бюрократ и Вор)' : 'голос против (Вор)'}`);
    const rules = [vd ? { w: 'Голосуют', t: 'только Шаман Вуду и мёртвые; жетон голоса не нужен и не тратится' } : { w: 'Голосуют', t: 'все живые; мёртвые — только если у них остался голос призрака (тратится при голосовании)' },
      { w: 'Казнь', t: `на плаху попадает тот, у кого не меньше ${th} голос. и больше, чем у остальных; при равенстве — никто` }];
    if (S.players.some(p => p.role === 'butler' && p.alive)) rules.push({ w: 'Дворецкий', t: 'голосует, только если голосует его хозяин' });
    if (S.players.some(p => p.role === 'beggar' && p.alive)) rules.push({ w: 'Нищий', t: 'голосует, только если у него есть жетон голоса (мёртвые могут отдать ему свой — он узнаёт их сторону)' });
    parts.push(`<div class="card"><h3 class="hi">${art('vote', 'hg')}Голосование: ${esc(on.name)}</h3><div class="small muted">Номинировал ${esc(by ? by.name : 'рассказчик')}${d.lastNom && d.lastNom.butcher ? ' (Мясник, после казни: порог тот же, превышать первую не нужно)' : ''}. Отметьте всех, кто поднял руку — по кругу, начиная с соседа номинированного; сам номинированный голосует последним.</div>
      ${boundsHtml(rules)}
      ${tiles('voters', 99, canVote, nm.voters, 'vote', { ghost: !vd, order: voteOrder(nm.on), mark: nm.on })}
      <div class="reveal"><div class="lab">Голосов</div><div class="big">${cnt} из ${th}</div>${weighted.map(t => `<div class="ln">${esc(t)}</div>`).join('')}</div>
      ${judgeHtml(nm.on, nm.by)}
      ${confirmRow('voteDone', 'Подтвердить голоса', true, 'voteCancel', 'Отменить номинацию')}</div>`);
  } else if (!d.executed || butcherTurn) {
    const byOk = butcherTurn ? (p => p.role === 'butcher' && p.alive) : (p => p.alive && !d.nominators.includes(p.id));
    const onOk = p => !E.isTraveller(p) && (butcherTurn || !d.nominated.includes(p.id));
    const pv = E.nominationPreview(S, nm.by, nm.on);
    const rules = bishop ? [{ w: 'Номинирует', t: 'только рассказчик (Епископ); за день — хотя бы 1 игрока стороны, противоположной Епископу' }]
      : butcherTurn ? [{ w: 'Номинирует', t: 'Мясник — ещё раз после казни; можно того, кого уже номинировали' }]
        : [{ w: 'Номинирует', t: 'живой игрок, не больше 1 раза за день' }, { w: 'Номинировать', t: 'любого, кроме Странников (их изгоняют), каждого — не больше 1 раза за день' }];
    parts.push(`<div class="card"><h3 class="hi">${art('nominate', 'hg')}${butcherTurn ? 'Номинация Мясника' : 'Номинация'}</h3>
      ${boundsHtml(rules)}
      ${bishop ? '' : pickRow('by', 'Кто номинирует', nm.by && E.nm(S, nm.by), tiles('by', 1, byOk, nm.by ? [nm.by] : [], 'nomPick'))}
      ${pickRow('on', 'Кого номинируют', nm.on && E.nm(S, nm.on), tiles('on', 1, onOk, nm.on ? [nm.on] : [], 'nomPick'))}
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
  const endLabel = d.executed ? (second ? `Завершить день и казнить: ${esc(E.nm(S, second.on))} (Мясник)` : 'Завершить день') : blk ? `Завершить день и казнить: ${esc(E.nm(S, blk))}` : 'Завершить день без казни';
  parts.push(`<div class="card"><button class="btn primary wide" data-act="endDay">${art('execute', 'bg')}${endLabel}</button>
    ${blk && !d.executed && E.travellerWorks(S, 'butcher') ? `<button class="btn wide" data-act="executeNow">Казнить ${esc(E.nm(S, blk))} сейчас — Мясник номинирует ещё раз</button>` : ''}
    ${scapegoat ? `<div class="seg"><button class="${picks.scapegoat ? 'on' : ''}" data-act="scapegoat" data-arg="${scapegoat.id}">Козёл Отпущения (${esc(scapegoat.name)}) казнён вместо ${esc(E.nm(S, blk))}</button></div>` : ''}
    ${blk && !d.executed && S.players.some(p => p.role === 'pacifist' && p.alive) && E.P(S, blk).align === 'good' ? `<div class="seg"><button class="${picks.pacifist ? 'on' : ''}" data-act="pacifist">Пацифист спасает казнённого</button></div>` : ''}
    <details><summary class="small">Казнить другого игрока (решение рассказчика)</summary><div style="margin-top:8px">${chipsPlayers('manualExe', 1, p => p.alive && !E.isTraveller(p), picks.manualExe || [], { act: 'dayPick', noRole: true })}
    <button class="btn danger" data-act="manualExe" ${(picks.manualExe || []).length ? '' : 'disabled'}>Казнить и завершить день</button></div></details></div>`);
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

// Гримуар: большие квадраты по 3 в ряд — иконка и роль в квадрате, имя игрока под ним; нажатие — карточка игрока
function viewTable() {
  const cells = S.players.map((p, i) => {
    const off = S.phase !== 'setup' && p.role && E.abilityOff(S, p), side = !p.role ? 'none' : p.align;
    return `<button class="gcell side-${side} ${p.alive ? '' : 'dead'}" data-act="openP" data-arg="${p.id}" aria-label="${esc(p.name)}: ${p.role ? esc(E.rname(p.role)) : 'без роли'}${p.alive ? '' : ', мёртв'}">
      <span class="gsq"><span class="gno">${i + 1}</span>${off ? `<span class="gpois" title="${esc(off)}">${DROP_SVG}</span>` : ''}${p.tokens.length ? `<span class="gtok" title="жетонов: ${p.tokens.length}">${p.tokens.length}</span>` : ''}
        ${p.role ? ico(p.role, p.align, 'gic') : '<span class="gq">?</span>'}<span class="grn">${p.role ? esc(E.rname(p.role)) : 'без роли'}</span>
        ${p.believes ? `<span class="gbel">считает: ${esc(E.rname(p.believes))}</span>` : ''}${p.alive ? '' : `<span class="gshroud">${art('dead', 'bd')}${p.ghost ? 'голос есть' : 'мёртв'}</span>`}</span>
      <span class="gpn">${esc(p.name)}</span></button>`;
  }).join('');
  const bl = S.bluffs.filter(Boolean).length ? `<div class="gbluffs"><span class="small muted">Блефы Демона</span><div>${S.bluffs.filter(Boolean).map(r => `<span class="gbl">${ico(r, null, 'gbi')}${esc(E.rname(r))}</span>`).join('')}</div></div>` : '';
  return `${S.phase === 'setup' ? drawCard() : ''}<div class="card"><h3>Гримуар · ${esc(S.script.name)}</h3>
    ${cells ? `<div class="grim">${cells}</div>` : '<div class="muted">Игроков пока нет — добавьте их на вкладке «Игра»</div>'}${bl}${S.phase === 'setup' ? '' : travellerForm()}</div>${S.phase === 'setup' ? '' : fabledZone()}`;
}

// карточка игрока поверх Гримуара (то, что раньше раскрывалось в строке «Стола»)
function sheetOverlay() {
  const p = UI.open && E.P(S, UI.open); if (!p) return '';
  const i = S.players.indexOf(p), off = S.phase !== 'setup' && p.role && E.abilityOff(S, p);
  const toks = p.tokens.map(t => `<span class="badge tok">${esc(E.TOK_RU[t.k] || t.k)}${t.src && DATA.roles[t.src] ? ' · ' + esc(DATA.roles[t.src].name) : ''}${t.note ? ': ' + esc(t.note) : ''}</span>`).join('');
  return `<div class="ov sheetov" role="dialog" aria-label="Игрок ${esc(p.name)}"><div class="sheetbg" data-act="openP" data-arg="${p.id}"></div><div class="sheet">
    <div class="sheethead">${p.role ? ico(p.role, p.align, 'si') : ''}<div class="sht"><div class="shp">${i + 1}. ${esc(p.name)}</div>
      <div class="pr t-${team(p.role)}">${p.role ? esc(E.rname(p.role)) : 'без роли'}${E.isTraveller(p) ? ' · Странник' : ''}${p.believes ? ` <span class="muted">(считает себя: ${esc(E.rname(p.believes))})</span>` : ''}${p.gained ? ` <span class="muted">(способность: ${esc(E.rname(p.gained))})</span>` : ''}</div></div>
      <button class="btn sq" data-act="openP" data-arg="${p.id}" aria-label="Закрыть">×</button></div>
    <div class="badges left"><span class="badge ${p.align}">${p.align === 'good' ? 'добрый' : 'злой'}</span>${p.alive ? '' : `<span class="badge dead">${art('dead', 'bd')}мёртв${p.ghost ? ' · голос' : ''}</span>`}${off ? `<span class="badge poisonb">${DROP_SVG}${esc(off)}</span>` : ''}${toks}</div>
    ${!p.alive && p.deathNote ? `<div class="small muted">Причина смерти: ${esc(p.deathNote)}</div>` : ''}
    ${p.role ? `<div class="small">${esc(DATA.roles[seenRole(p)] ? DATA.roles[seenRole(p)].ability : '')}</div>
      <button class="btn showbtn" data-act="showRole" data-arg="${p.id}">Показать игроку его роль на весь экран${seenRole(p) !== p.role ? ` (${esc(E.rname(seenRole(p)))})` : ''}</button>` : ''}
    ${editorHtml(p)}</div></div>`;
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
  const left = d ? d.cells.filter(c => !c.pid).length : 0;
  return `<div class="card drawcard"><h3>Выдача ролей · каменная стена</h3>
    <div class="small muted">Игроки по кругу открывают светящиеся ячейки — как тянут жетон из мешочка. Роль видна на весь экран; повторное нажатие закрывает ячейку, и она трескается. ${core.some(p => !p.role) ? 'Роли ещё не выбраны — приложение наберёт их по раскладке случайно.' : 'В стене будут роли, выбранные на вкладке «Игра».'} Пьяница увидит роль, которой себя считает.</div>
    ${!ok ? '<div class="warn">Нужно от 5 до 15 игроков (без Странников) — рассадку заполните на вкладке «Игра».</div>'
      : d && !d.finished ? `<div class="note-ok">Жребий идёт: осталось ячеек — ${left}. Очередь: ${esc(E.nm(S, d.turn))}</div><div class="row"><button class="btn primary" data-act="wallShow">Продолжить жребий</button><button class="btn danger" data-act="drawCancel">Отменить жребий</button></div>`
      : `${d && d.finished ? '<div class="note-ok">Роли выданы жребием.</div>' : ''}<button class="btn primary wide" data-act="drawStart">${d && d.finished ? 'Новый жребий' : 'Выкатить стену'}</button>`}</div>`;
}
function wallOverlay() {
  const d = S.draw; if (!UI.wall || !d) return '';
  const turn = d.turn && E.P(S, d.turn), open = d.open !== null ? d.cells[d.open] : null;
  const cells = d.cells.map((c, i) => {
    const used = !!c.pid, crack = c.done ? `<svg class="crack" viewBox="0 0 48 48" aria-hidden="true" style="transform:rotate(${(i * 67) % 360}deg)"><path d="${CRACKS[i % 3]}"/></svg>` : '';
    return `<button class="wcell c-${c.color} ${c.done ? 'done' : ''} ${UI.cracking === i ? 'cracking' : ''} ${d.open === i ? 'opened' : ''}" data-act="drawOpen" data-arg="${i}" ${used || !turn ? 'disabled' : ''} aria-label="${used ? 'Открытая ячейка' : 'Ячейка ' + (i + 1)}" style="--d:${(i * 0.37) % 2.4}s">
      <svg class="rune" viewBox="0 0 48 48" aria-hidden="true"><path d="${RUNES[c.glyph % RUNES.length]}"/></svg>${crack}</button>`;
  }).join('');
  const others = d.order.filter(id => !d.cells.some(c => c.pid === id) && E.P(S, id));
  return `<div class="ov wallov" role="dialog" aria-label="Каменная стена: выдача ролей">
    <div class="wall ${UI.wallAnim ? 'roll' : ''}">
      <div class="wtop"><button class="wbtn" data-act="wallHide" aria-label="Свернуть стену">×</button>
        <div class="wturn">${turn ? `<span>Ячейку открывает</span><b>${esc(turn.name)}</b>` : '<b>Все роли выданы</b>'}</div>
        <button class="wbtn" data-act="undo" ${HISTORY.length ? '' : 'disabled'} aria-label="Отменить последнее">↶</button></div>
      ${turn && others.length > 1 ? `<div class="wwho">${others.map(id => `<button class="${id === d.turn ? 'on' : ''}" data-act="drawTurn" data-arg="${id}">${esc(E.nm(S, id))}</button>`).join('')}</div>` : ''}
      <div class="wgrid">${cells}</div>
      <div class="whint">${turn ? 'Нажмите на светящуюся ячейку' : '<button class="btn primary" data-act="wallHide">Готово</button>'}</div>
    </div>
    ${open ? (() => { const r = E.drawShown(open), al = isGoodRole(r) ? 'good' : 'evil';
      // ячейка «распахивается»: роль вырастает из её места на стене
      const col = d.open % 3, row = Math.floor(d.open / 3);
      return `<div class="wreveal side-${al}" data-act="drawClose" role="dialog" aria-label="Ваша роль" style="transform-origin:${Math.round((col + 0.5) / 3 * 100)}% ${170 + row * 122}px">
        <div class="wrfor">${esc(E.nm(S, open.pid))}, ваша роль</div>${ico(r, al, 'wric')}<div class="wrname">${esc(E.rname(r))}</div>
        <div class="wrteam">${esc(E.TEAM_RU[team(r)] || '')} · ${al === 'good' ? 'добро' : 'зло'}</div><div class="wrab">${esc(DATA.roles[r].ability)}</div>
        <div class="shhint">Запомните роль и нажмите — ячейка закроется</div></div>`; })() : ''}</div>`;
}

function editorHtml(p) {
  const tokKinds = ['poisoned', 'drunk', 'protected', 'cursed', 'safe', 'mad', 'bad', 'note'];
  return `<div class="editor">
    <div class="field"><label>Роль</label><select data-act="edRole" data-arg="${p.id}">${E.isTraveller(p) ? plainOptions(DATA.travellers, p.role) : roleOptions(() => true, p.role, { all: true })}</select></div>
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

function viewLog() {
  const groups = [];
  for (const e of S.log) { const g = groups[groups.length - 1]; if (!g || g.p !== e.p) groups.push({ p: e.p, items: [e] }); else g.items.push(e); }
  return `<div class="card"><h3>Журнал</h3><div class="log">${groups.slice().reverse().map(g => `<div class="ph">${esc(phaseName(g.p))}</div>${g.items.map(e => `<div class="e ${e.k}">${esc(e.t)}</div>`).join('')}`).join('') || '<div class="muted">Пока пусто</div>'}</div></div>`;
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
  return [...new Set([...sc.roles, ...tr])].filter(r => DATA.roles[r]);
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
  const who = S.players.filter(p => p.role === rid || p.gained === rid || p.believes === rid).map(p => p.name + (p.role !== rid ? ` (${p.gained === rid ? 'способность' : 'считает себя'})` : ''));
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

function viewMenu() {
  return `${notesHtml()}<div class="card"><h3>Игра</h3>
    <div class="seg"><button class="${UI.hideInactive ? 'on' : ''}" data-act="toggleHide">Пропускать шаги, которые не срабатывают</button></div>
    ${HISTORY.length ? `<div class="small muted">Можно отменить ${HISTORY.length} последних действий — кнопка «↶» в шапке.</div>` : ''}
    ${UI.confirm === 'new' ? `<div class="warn">Начать новую игру? Текущая будет удалена.</div><div class="row"><button class="btn danger" data-act="newGame">Да, новая игра</button><button class="btn" data-act="cancelConfirm">Отмена</button></div>`
      : `<button class="btn" data-act="askNew">Новая игра</button>`}
    <div class="small muted">${UI.save === 'cloud' ? 'Игра сохраняется после каждого действия: на этом устройстве и в вашем аккаунте claude.ai.' : 'Игра сохраняется после каждого действия на этом устройстве.'}</div></div>
    <div class="card"><h3>Перенос игры</h3>
      <button class="btn" data-act="copyJson">Скопировать игру</button>${UI.copied ? `<div class="note-ok">${esc(UI.copied)}</div>` : ''}
      <textarea id="importJson" data-act="importText" placeholder="Вставьте сюда скопированную игру">${esc(UI.importText)}</textarea>
      <button class="btn" data-act="importJson">Загрузить игру</button></div>
    <div class="card"><h3>О приложении</h3><div class="small muted">Тексты ролей, ночной порядок и джинксы — из официальных данных The Pandemonium Institute (русский перевод). Где правила оставляют выбор рассказчику, приложение подсказывает, но решаете вы.</div></div>`;
}

function viewOver() {
  const r = S.result;
  return `<div class="phase-wrap">${art(r.winner === 'good' ? 'win_good' : 'win_evil', 'win-art')}</div><div class="banner"><div class="w">${r.winner === 'good' ? 'Победа добра' : 'Победа зла'}</div><div>${esc(r.reason)}</div></div>
    ${viewTable()}${viewLog()}`;
}

function render() {
  const app = document.getElementById('app');
  if (!S) { app.innerHTML = '<main><div class="card">Загрузка…</div></main>'; return; }
  // ночью — принудительный OLED: чистый чёрный фон, светятся только текст и иконки
  document.documentElement.classList.toggle('oled', S.phase === 'night');
  // днём и на остальных экранах — всегда светлая тема, даже если телефон переключился на тёмную
  document.documentElement.dataset.theme = 'light';
  const ph = S.phase === 'setup' ? 'Подготовка' : S.phase === 'night' ? `Ночь ${S.n} · ${S.night.i + 1}/${S.night.steps.length}` : S.phase === 'day' ? `День ${S.n}` : 'Игра окончена';
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
    <nav class="tabs">${[['game', S.phase === 'night' ? 'Ночь' : S.phase === 'day' ? 'День' : 'Игра'], ['table', 'Гримуар'], ['log', 'Журнал'], ['roles', 'Роли'], ['menu', 'Ещё']].map(([k, l]) => `<button class="${UI.tab === k ? 'on' : ''}" data-act="tab" data-arg="${k}">${l}</button>`).join('')}</nav>
    ${sheetOverlay()}${wallOverlay()}${showOverlay()}`;
  // под полноэкранными слоями страница не прокручивается
  document.documentElement.classList.toggle('locked', !!(UI.show || (UI.open && E.P(S, UI.open)) || (UI.wall && S.draw)));
  app.querySelectorAll('details > summary').forEach(s => { if (opened.has(s.textContent)) s.parentElement.open = true; });
  if (UI.tab === 'roles') filterRefs();
  paintSave();
  window.scrollTo(0, scrollY);
}

/* ------------------------------------------------------------ обработчики */
const sel1 = (list, id) => (list || [])[0] === id ? [] : [id];
const A = {
  tab: k => { UI.tab = k; render(); window.scrollTo(0, 0); },
  undo: () => undo(),
  // подготовка
  script: k => act(S => { const sc = DATA.scripts[k]; S.script = { key: k, name: sc.name, roles: sc.roles.slice(), travellers: (sc.travellers || []).slice() }; S.players.forEach(p => { if (p.role && !E.isTraveller(p) && !S.script.roles.includes(p.role)) p.role = null; }); }, 'сценарий «' + DATA.scripts[k].name + '»'),
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
  deal: () => act(S => E.randomDeal(S), 'случайная раздача ролей'),
  outMod: arg => { const [id, v] = arg.split('|'); act(S => { S.flags.mods = Object.assign({}, S.flags.mods, { [id]: +v }); }, `${E.rname(id)}: ${{ '-1': '−1 Изгой', 0: 'Изгоев без изменений', 1: '+1 Изгой' }[v]}`); },
  setRole: (id, el) => act(S => { const p = E.P(S, id); p.role = el.value || null; E.finishRoles(S); E.autoSetup(S, false); }, 'роль ' + E.P(S, id).name),
  setBelieves: (id, el) => act(S => { E.P(S, id).believes = el.value || null; }, 'роль-обманка'),
  bluff: (i, el) => act(S => { S.bluffs[+i] = el.value || null; }, 'блеф Демона'),
  'setFlag-grandchild': (a, el) => act(S => { S.flags.grandchild = el.value || null; }, 'внук Бабушки'),
  'setFlag-ftHerring': (a, el) => act(S => { S.flags.ftHerring = el.value || null; }, 'ложная цель Гадалки'),
  'setFlag-goodTwin': (a, el) => act(S => { S.flags.goodTwin = el.value || null; }, 'добрый близнец'),
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
    draft(S => { const inp = S.draft.inp, sel = (inp[key] || []).slice(), max = +n;
      if (sel.includes(id)) sel.splice(sel.indexOf(id), 1); else { if (sel.length >= max) sel.shift(); sel.push(id); }
      inp[key] = sel; });
  },
  pickR: (key, el) => draft(S => { S.draft.inp[key] = el.value || null; }),
  pickC: arg => { const [key, v] = arg.split('|'); draft(S => { S.draft.inp[key] = v; }); },
  num: arg => { const [key, d, base] = arg.split('|'); draft(S => { S.draft.inp[key] = Math.max(0, (S.draft.inp[key] ?? (+base || 0)) + (+d)); }); },
  // текст печатается — сохраняем без перерисовки, иначе поле теряет фокус
  pickT: (key, el) => { S.draft.inp[key] = el.value; S.updated = Date.now(); persist(); },
  mornNext: i => draft(S => { S.night.data.morn = +i + 1; }),
  amnText: (id, el) => { S.flags['amnesiac_' + id] = el.value; S.updated = Date.now(); persist(); },
  amnGuessText: (id, el) => { S.day.picks['amnGuess_' + id] = el.value; S.updated = Date.now(); persist(); },
  amnAnswer: arg => { const [id, ans] = arg.split('|'), guess = (S.day.picks['amnGuess_' + id] || '').trim(); act(S => { E.amnesiacGuess(S, id, guess, ans); delete S.day.picks['amnGuess_' + id]; }); },
  stepDone: () => { const st = E.currentStep(S), spec = E.stepSpec(S, st), inp = clone(S.draft.inp); UI.notes = []; act(S => { if (spec.active) E.applyStep(S, st, inp); else E.skipStep(S); }, spec.title + (spec.who ? ' (' + spec.who + ')' : '')); window.scrollTo(0, 0); },
  stepSkip: () => { const spec = E.stepSpec(S, E.currentStep(S)); act(S => E.skipStep(S), 'пропущен шаг: ' + spec.title); window.scrollTo(0, 0); },
  // день
  dayPick: arg => { const [key, id] = arg.split('|'); draft(S => { S.day.picks[key] = sel1(S.day.picks[key], id); }); },
  moonchild: () => act(S => E.moonchildChoose(S, S.day.picks.moonchild[0])),
  klutz: () => act(S => E.klutzChoose(S, S.day.picks.klutz[0])),
  slayReg: v => draft(S => { S.day.picks.slayReg = v === '1'; }),
  slay: id => act(S => { E.slayerShot(S, id, S.day.picks['slay_' + id][0], S.day.picks.slayReg); S.day.picks = {}; }),
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
  // справочник ролей
  refOpen: id => { UI.refOpen = UI.refOpen === id ? null : id; render(); },
  refScript: (a, el) => { UI.refScript = el.value; UI.refOpen = null; render(); },
  refQ: (a, el) => { UI.refQ = el.value; filterRefs(); },
  nomClear: () => { UI.pickOpen = null; draft(S => { S.day.draft = { by: null, on: null, voters: [], stage: 'pick', spy: false }; }); },
  exClear: () => { UI.pickOpen = null; draft(S => { S.day.picks.exile = null; S.day.picks.exFunny = false; }); },
  nomSpy: v => draft(S => { S.day.draft.spy = v === '1'; }),
  nominate: () => {
    let res = null; const d0 = clone(S.day.draft), by = E.bishopActive(S) ? 'st' : d0.by;
    UI.pickOpen = null;
    act(S => {
      res = E.nominate(S, by, d0.on, { spyTownsfolk: !!d0.spy });
      if (res.ended) E.endDay(S);
      else if (S.phase === 'day') S.day.draft = { by, on: d0.on, voters: [], stage: 'vote', spy: false };
    });
    UI.notes = res ? res.notes : []; render();
  },
  vote: arg => { const id = arg.split('|')[1]; draft(S => { const v = S.day.draft.voters; if (v.includes(id)) v.splice(v.indexOf(id), 1); else v.push(id); }); },
  voteDone: () => { const d0 = clone(S.day.draft); act(S => { E.recordVote(S, d0.on, d0.voters); S.day.draft = { by: null, on: null, voters: [], stage: 'pick', spy: false }; }); },
  voteCancel: () => act(S => { S.day.draft = { by: null, on: null, voters: [], stage: 'pick', spy: false }; }, 'номинация отменена'),
  pacifist: () => draft(S => { S.day.picks.pacifist = !S.day.picks.pacifist; }),
  endDay: () => { const pac = S.day.picks.pacifist, sg = S.day.picks.scapegoat; UI.notes = []; act(S => E.endDay(S, { pacifist: pac, scapegoat: sg }), 'конец дня ' + S.n); window.scrollTo(0, 0); },
  manualExe: () => { const id = S.day.picks.manualExe[0]; act(S => { E.execute(S, id); if (!S.result) E.endDay(S, { skipExecution: true }); }); window.scrollTo(0, 0); },
  // Гримуар: карточка игрока, показ роли на весь экран
  openP: id => { UI.open = UI.open === id ? null : id; render(); },
  showOpen: i => { const g = (UI.showGroups || [])[+i]; if (g) { UI.show = { screens: g.screens, i: 0 }; render(); } },
  showNext: () => { if (!UI.show) return; UI.show.i += 1; if (UI.show.i >= UI.show.screens.length) UI.show = null; render(); },
  showRole: id => { const p = E.P(S, id), r = seenRole(p); UI.show = { screens: [{ caption: 'Ваша роль', items: [{ role: r, align: r === p.role ? p.align : undefined }] }], i: 0 }; render(); },
  showRef: rid => { UI.show = { screens: [{ caption: '', items: [{ role: rid, align: DATA.roles[rid].team === 'fabled' || DATA.roles[rid].team === 'loric' ? 'good' : undefined }] }], i: 0 }; render(); },
  // жребий: каменная стена
  drawStart: () => { act(S => E.drawStart(S), 'жребий: стена'); wallIn(); },
  wallShow: () => wallIn(),
  wallHide: () => { UI.wall = false; render(); },
  drawTurn: id => draft(S => { S.draw.turn = id; }),
  drawOpen: i => act(S => E.drawOpen(S, +i), 'жребий: ячейка открыта'),
  drawClose: () => { UI.cracking = S.draw.open; act(S => E.drawClose(S), 'жребий: ячейка закрыта'); setTimeout(() => { UI.cracking = null; }, 1600); },
  drawCancel: () => { UI.wall = false; act(S => E.drawCancel(S), 'жребий отменён'); },
  edRole: (id, el) => act(S => { const p = E.P(S, id); const old = p.role; p.role = el.value || null; E.log(S, `Рассказчик меняет роль ${p.name}: ${E.rname(old)} → ${E.rname(p.role)}`, 'effect'); }),
  // смерть по решению рассказчика — настоящая: ночью попадёт в объявление на рассвете, сработают последствия
  edKill: id => { const why = (document.getElementById('edWhy-' + id) || {}).value || ''; act(S => E.storytellerKill(S, id, null, why), 'смерть: ' + E.nm(S, id)); },
  edAlive: id => act(S => { const p = E.P(S, id); if (!p.alive) { p.alive = true; p.deathNote = null; E.log(S, `Рассказчик воскрешает ${p.name}`, 'effect'); } }),
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
  askNew: () => { UI.confirm = 'new'; render(); },
  cancelConfirm: () => { UI.confirm = null; render(); },
  newGame: () => {
    const key = S.script.key === 'custom' ? 'ecbe' : S.script.key, names = S.players.filter(p => !E.isTraveller(p)).map(p => p.name);
    HISTORY = []; S = E.newGame(key); S.players = names.map(n => E.newPlayer(n)); UI.confirm = null; UI.tab = 'game'; persist(); render();
  },
  copyJson: () => {
    const text = JSON.stringify(S);
    const done = () => { UI.copied = 'Скопировано. Вставьте этот текст на другом устройстве в поле ниже.'; render(); };
    try { navigator.clipboard.writeText(text).then(done, () => { UI.importText = text; UI.copied = 'Не удалось скопировать автоматически: текст игры в поле ниже, выделите и скопируйте его.'; render(); }); }
    catch (e) { UI.importText = text; UI.copied = 'Текст игры в поле ниже — выделите и скопируйте его.'; render(); }
  },
  importText: (a, el) => { UI.importText = el.value; },
  importJson: () => { try { const s = JSON.parse(UI.importText); if (!s.players || !s.script) throw 0; HISTORY.push({ s: JSON.stringify(S), label: 'загрузка игры' }); S = upgrade(s); S.updated = Date.now(); UI.importText = ''; UI.copied = ''; UI.tab = 'game'; persist(); render(); } catch (e) { alertNote('Это не похоже на сохранённую игру.'); } },
};
function alertNote(text) { UI.copied = ''; UI.notes = [text]; render(); }
// стена «выкатывается» сверху один раз при показе, дальше перерисовки идут без анимации
function wallIn() { UI.wall = true; UI.wallAnim = true; render(); setTimeout(() => { UI.wallAnim = false; }, 1200); }

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]'); if (!el || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return;
  const f = A[el.dataset.act]; if (f) { ev.preventDefault(); f(el.dataset.arg, el); }
});
document.addEventListener('change', ev => {
  const el = ev.target; if (!el.dataset || !el.dataset.act) return;
  if (el.tagName === 'SELECT' || el.tagName === 'INPUT') { const f = A[el.dataset.act]; if (f) f(el.dataset.arg, el); }
});
document.addEventListener('input', ev => {
  // текстовые поля и «живые» поля ввода (поиск) — без перерисовки на каждую букву
  const el = ev.target; if (!el.dataset || !el.dataset.act || (el.tagName !== 'TEXTAREA' && !el.dataset.live)) return;
  const f = A[el.dataset.act]; if (f) f(el.dataset.arg, el);
});
document.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.id === 'newName') A.addP(); });

/* ------------------------------------------------------------ запуск */
function boot(hotData) {
  if (hotData && hotData.S) { S = hotData.S; HISTORY = hotData.H || []; }
  if (!S) {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) S = JSON.parse(raw); } catch (e) { S = null; }
    try { const h = localStorage.getItem(LS_HIST); if (h) HISTORY = JSON.parse(h) || []; } catch (e) { HISTORY = []; }
  }
  if (!S) S = sampleGame();
  S = upgrade(S);
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
