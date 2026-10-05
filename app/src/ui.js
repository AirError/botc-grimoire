'use strict';
/* Интерфейс карманного гримуара. Один render() перерисовывает экран из состояния игры S.
   Всё, что важно для партии, живёт в S (включая черновики выбора и незавершённую номинацию),
   поэтому отмена и перезагрузка страницы возвращают ровно то, что было на экране. */
const E = ENGINE;
let S = null;
// История для отмены: массив снимков состояния до каждого действия (паттерн History)
let HISTORY = [];
const HIST_MAX = 40;
const UI = { tab: 'game', open: null, notes: [], hideInactive: true, confirm: null, importText: '', customText: '', save: 'local', copied: '' };

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
  el.innerHTML = `<span class="tt">${esc(text)}</span>${withUndo ? '<button class="tu" data-act="undo">↶ Отменить</button>' : ''}`;
  el.className = 'show';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = ''; }, withUndo ? 6000 : 2500);
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

// список игроков крупными строками на всю ширину: удобно попадать одной рукой
function chipsPlayers(key, n, filter, selected, opts) {
  opts = opts || {};
  return '<div class="chips">' + S.players.map((p, i) => {
    const okp = filter(p), on = selected.includes(p.id);
    // днём роли не показываем: вместо иконки — номер места за столом (мёртвым — призрак)
    const icon = opts.noRole ? (p.alive ? `<span class="seatno">${i + 1}</span>` : art('dead', 'ci')) : ico(p.role, p.align, 'ci');
    const sub = opts.noRole ? `<span class="cr muted">${p.alive ? (E.isTraveller(p) ? 'Странник' : '') : 'мёртв'}${!p.alive && opts.ghost ? (p.ghost ? ' · есть голос' : ' · голоса нет') : ''}</span>` : roleLine(p);
    return `<button class="chip ${on ? 'on' : ''} ${p.alive ? '' : 'dead'}" data-act="${opts.act || 'pickP'}" data-arg="${key}|${p.id}|${n}" ${okp ? '' : 'disabled'} aria-pressed="${on}">
      <span class="ci-wrap">${icon}</span><span class="ct"><span class="cn">${esc(p.name)}</span>${sub}</span><span class="ck" aria-hidden="true">${on ? '✓' : ''}</span></button>`;
  }).join('') + '</div>';
}

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
  if (f.type === 'choice') return `<div class="field"><label>${esc(f.label)}</label><div class="seg">${f.options.map(o => `<button class="${v === o.v ? 'on' : ''}" data-act="pickC" data-arg="${f.key}|${o.v}">${esc(o.l)}</button>`).join('')}</div></div>`;
  if (f.type === 'number') return `<div class="field"><label>${esc(f.label)}</label><div class="stepper"><button class="btn" data-act="num" data-arg="${f.key}|-1">−</button><b>${v ?? 0}</b><button class="btn" data-act="num" data-arg="${f.key}|1">+</button></div></div>`;
  return '';
}
function boundsHtml(list) {
  return `<div class="bounds"><div class="lab">Рамки выбора</div>${list.map(b => `<div><b>${esc(b.w)}:</b> ${esc(b.t)}</div>`).join('')}</div>`;
}
function situationHtml() { return E.situation(S).map(w => `<div class="warn">${esc(w)}</div>`).join(''); }
const notesHtml = () => (UI.notes || []).map(t => `<div class="warn">${esc(t)}</div>`).join('');

/* Странники и Сказочники — общие для подготовки и «Стола» */
function travellerForm() {
  const pos = S.players.map(p => `<option value="${p.id}">после ${esc(p.name)}</option>`).join('');
  return `<details class="addbox"><summary>${art('traveller', 'hg')}Добавить Странника</summary><div class="field">
    <input type="text" id="trName" placeholder="Имя игрока" aria-label="Имя Странника">
    <select id="trRole" aria-label="Роль Странника">${plainOptions(DATA.travellers.filter(r => !S.players.some(p => p.role === r)), null, '— роль Странника —')}</select>
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
    <div class="row" style="flex-wrap:nowrap"><select id="fabAdd" aria-label="Добавить Сказочника">${plainOptions(DATA.fabled.filter(r => !(S.fabled || []).includes(r)), null, '— добавить Сказочника —')}</select><button class="btn" data-act="fabAdd">+</button></div></div>`;
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
    const d = E.distribution(n, core.map(p => p.role).filter(Boolean)), c = E.countTeams(S);
    const rowsD = ['townsfolk', 'outsider', 'minion', 'demon'].map(t => `<tr><td class="t-${t}">${E.TEAM_RU[t]}</td><td class="${c[t] !== d[t] ? 'bad' : ''}">${c[t]} из ${d[t]}${t === 'outsider' && d.godfather ? ' (±1)' : ''}</td></tr>`).join('');
    roles = `<div class="card"><h3>Роли</h3><table class="dist">${rowsD}</table>${d.notes.length ? `<div class="small muted">${d.notes.map(esc).join('<br>')}</div>` : ''}
      <button class="btn" data-act="deal">Раздать роли случайно</button>
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

function viewNight() {
  const st = E.currentStep(S); if (!st) return '';
  const spec = E.stepSpec(S, st), inp = stepDraft(st, spec);
  const total = S.night.steps.length, i = S.night.i;
  const fields = spec.active ? E.stepInputs(spec, inp) : [];
  const missing = spec.active ? E.missingInputs(spec, inp) : [];
  let info = null; try { info = spec.active ? spec.info(inp) : null; } catch (e) { info = null; }
  const next = S.night.steps.slice(i + 1, i + 5).map(s => `<div>${s.pid ? ico(s.id, null, 'ui') : ''}${esc(s.meet ? 'Злые знакомятся' : E.rname(s.id))}${s.pid ? ` <span>· ${esc(E.nm(S, s.pid))}</span>` : ''}</div>`).join('');
  const deaths = S.night.deaths.length ? `<div class="small"><b>Умерли этой ночью:</b> ${S.night.deaths.map(d => esc(E.nm(S, d.pid))).join(', ')}</div>` : '';
  const icon = st.pid ? ico(st.id, null, 'si') : st.fabled ? ico(st.id, 'good', 'si') : art(st.id, 'si');
  return `<div class="phase-wrap">${art('night', 'phase-art')}</div><div class="progress"><i style="width:${Math.round(100 * i / total)}%"></i></div>
    ${situationHtml()}${deaths}
    <div class="card ${spec.active ? '' : 'inactive'}">
      <div class="steprole">${icon}<span class="rn t-${spec.team || ''}">${esc(spec.title)}</span>${spec.who ? `<span class="who">${esc(spec.who)}</span>` : ''}</div>
      ${spec.text ? `<div class="instr">${fmtInstr(spec.text)}</div>` : ''}
      ${spec.active ? '' : `<div class="warn">Не просыпается: ${esc(spec.reason)}</div>`}
      ${spec.active && spec.bounds && spec.bounds.length ? boundsHtml(spec.bounds) : ''}
      ${(spec.warn || []).map(w => `<div class="warn">${esc(w)}</div>`).join('')}
      ${fields.map(f => fieldHtml(f, inp)).join('')}
      ${info && (info.show || (info.lines || []).filter(Boolean).length) ? `<div class="reveal"><div class="lab">Покажите / объявите</div>${info.show ? `<div class="big">${esc(info.show)}</div>` : ''}${(info.lines || []).filter(Boolean).map(l => `<div class="ln">${esc(l)}</div>`).join('')}</div>` : ''}
      ${missing.length ? `<div class="small muted">Осталось выбрать: ${missing.map(esc).join('; ')}</div>` : ''}
      <div class="actions"><button class="btn primary" data-act="stepDone" ${missing.length ? 'disabled' : ''}>${spec.active ? 'Готово' : 'Дальше'}</button>
        <button class="btn" data-act="stepSkip">Пропустить</button></div>
    </div>
    ${next ? `<div class="card"><h3>Дальше этой ночью</h3><div class="upnext">${next}</div></div>` : ''}`;
}

function viewDay() {
  const d = S.day, th = E.voteThreshold(S), blk = E.block(S), alive = E.aliveCount(S), picks = d.picks || (d.picks = {});
  const nm = d.draft || (d.draft = { by: null, on: null, voters: [], stage: 'pick', spy: false });
  const parts = [];
  parts.push(`<div class="phase-wrap">${art('day', 'phase-art')}</div>`);
  parts.push(`<div class="card"><div class="row"><h2>День ${S.n}</h2><span class="muted">живых ${E.aliveAll(S)} · для казни нужно ${th}</span></div>
    ${S.night && S.night.deaths.length ? `<div class="small">Ночью умерли: ${S.night.deaths.map(x => esc(E.nm(S, x.pid))).join(', ')}</div>` : '<div class="small muted">Ночью никто не умер</div>'}
    ${notesHtml()}</div>`);
  parts.push(situationHtml());
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
  if (S.n === 1 && S.players.some(p => p.role === 'juggler' && p.alive)) {
    const g = S.flags.jugglerGuesses || [];
    parts.push(`<div class="card"><h3>Догадки Жонглёра (до 5)</h3>${g.map((x, i) => `<div class="small">${esc(E.nm(S, x.pid))} — ${esc(E.rname(x.role))} <button class="linkish" data-act="jugDel" data-arg="${i}">убрать</button></div>`).join('')}
      ${g.length < 5 ? `<div class="row" style="flex-wrap:nowrap"><select id="jugP">${S.players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><select id="jugR">${roleOptions(() => true, null)}</select><button class="btn" data-act="jugAdd">+</button></div>` : ''}</div>`);
  }
  // изгнание Странников
  const trAlive = S.players.filter(p => E.isTraveller(p) && p.alive);
  if (trAlive.length) {
    const ex = picks.exile || { pid: null, voters: [] }, eth = E.exileThreshold(S), pass = ex.voters.length >= eth;
    parts.push(`<div class="card"><h3 class="hi">${art('traveller', 'hg')}Изгнание Странника</h3>
      ${boundsHtml([{ w: 'Кого', t: 'только Странника; изгнание — не казнь, за день их может быть сколько угодно' },
        { w: 'Голосуют', t: 'все игроки, живые и мёртвые; голос призрака при этом не тратится' },
        { w: 'Изгнан', t: `если голосов не меньше половины всех игроков: ${eth} из ${S.players.length}` }])}
      ${chipsPlayers('exPid', 1, p => E.isTraveller(p) && p.alive, ex.pid ? [ex.pid] : [], { act: 'exPick' })}
      ${ex.pid ? `<div class="flabel"><span>Кто голосует за изгнание</span><span>${ex.voters.length}</span></div>${chipsPlayers('exV', 99, () => true, ex.voters, { act: 'exVote', noRole: true })}
      <div class="reveal"><div class="lab">Голосов</div><div class="big">${ex.voters.length} из ${eth} — ${pass ? 'изгнан' : 'не изгнан'}</div></div>
      <button class="btn ${pass ? 'danger' : ''} wide" data-act="exile">Записать: ${pass ? 'Странник изгнан' : 'Странник остаётся'}</button>` : ''}</div>`);
  }
  if (nm.stage === 'vote') {
    const on = E.P(S, nm.on), by = E.P(S, nm.by);
    const canVote = p => p.alive || p.ghost;
    parts.push(`<div class="card"><h3 class="hi">${art('vote', 'hg')}Голосование: ${esc(on.name)}</h3><div class="small muted">Номинировал ${esc(by.name)}. Отметьте всех, кто поднял руку.</div>
      ${boundsHtml([{ w: 'Голосуют', t: 'все живые; мёртвые — только если у них остался голос призрака (тратится при голосовании)' }, { w: 'Казнь', t: `на плаху попадает тот, у кого не меньше ${th} голосов и больше, чем у остальных; при равенстве — никто` }].concat(S.players.some(p => p.role === 'butler' && p.alive) ? [{ w: 'Дворецкий', t: 'голосует, только если голосует его хозяин' }] : []))}
      ${chipsPlayers('voters', 99, canVote, nm.voters, { act: 'vote', noRole: true, ghost: true })}
      <div class="reveal"><div class="lab">Голосов</div><div class="big">${nm.voters.length} из ${th}</div></div>
      <div class="actions"><button class="btn primary" data-act="voteDone">Записать голоса</button><button class="btn" data-act="voteCancel">Отменить номинацию</button></div></div>`);
  } else {
    const byOk = p => p.alive && !d.nominators.includes(p.id), onOk = p => !d.nominated.includes(p.id) && !E.isTraveller(p);
    const pv = E.nominationPreview(S, nm.by, nm.on);
    parts.push(`<div class="card"><h3 class="hi">${art('nominate', 'hg')}Номинация</h3>
      ${boundsHtml([{ w: 'Номинирует', t: 'живой игрок, не больше 1 раза за день' }, { w: 'Номинировать', t: 'любого, кроме Странников (их изгоняют), каждого — не больше 1 раза за день' }])}
      <div class="field"><div class="flabel"><span>Кто номинирует</span></div>${chipsPlayers('by', 1, byOk, nm.by ? [nm.by] : [], { act: 'nomPick', noRole: true })}</div>
      <div class="field"><div class="flabel"><span>Кого</span></div>${chipsPlayers('on', 1, onOk, nm.on ? [nm.on] : [], { act: 'nomPick', noRole: true })}</div>
      ${pv.notes.map(t => `<div class="warn">${esc(t)}</div>`).join('')}
      ${pv.askSpy ? `<div class="field"><label>Ваше решение: Шпион определяется Горожанином?</label><div class="seg"><button class="${nm.spy ? '' : 'on'}" data-act="nomSpy" data-arg="0">Нет</button><button class="${nm.spy ? 'on' : ''}" data-act="nomSpy" data-arg="1">Да — его казнят</button></div></div>` : ''}
      <button class="btn primary" data-act="nominate" ${nm.by && nm.on ? '' : 'disabled'}>Номинировать</button></div>`);
  }
  if (d.noms.length) parts.push(`<div class="card"><h3>Номинации сегодня</h3>${d.noms.map(x => `<div class="row"><b>${esc(E.nm(S, x.on))}</b><span class="muted">${x.count} голос.</span>${x.on === blk ? '<span class="badge evil">на плахе</span>' : ''}</div>`).join('')}</div>`);
  parts.push(`<div class="card"><button class="btn primary wide" data-act="endDay">${art('execute', 'bg')}${blk && !d.executed ? `Завершить день и казнить: ${esc(E.nm(S, blk))}` : 'Завершить день без казни'}</button>
    ${blk && !d.executed && S.players.some(p => p.role === 'pacifist' && p.alive) && E.P(S, blk).align === 'good' ? `<div class="seg"><button class="${picks.pacifist ? 'on' : ''}" data-act="pacifist">Пацифист спасает казнённого</button></div>` : ''}
    <details><summary class="small">Казнить другого игрока (решение рассказчика)</summary><div style="margin-top:8px">${chipsPlayers('manualExe', 1, p => p.alive && !E.isTraveller(p), picks.manualExe || [], { act: 'dayPick', noRole: true })}
    <button class="btn danger" data-act="manualExe" ${(picks.manualExe || []).length ? '' : 'disabled'}>Казнить и завершить день</button></div></details></div>`);
  return parts.join('');
}

function viewTable() {
  const rows = S.players.map((p, i) => {
    const toks = p.tokens.map(t => `<span class="badge tok">${esc(E.TOK_RU[t.k] || t.k)}${t.src && DATA.roles[t.src] ? ' · ' + esc(DATA.roles[t.src].name) : ''}${t.note ? ': ' + esc(t.note) : ''}</span>`).join('');
    const off = S.phase !== 'setup' && E.abilityOff(S, p);
    return `<button class="seat ${p.alive ? '' : 'dead'}" data-act="openP" data-arg="${p.id}" aria-expanded="${UI.open === p.id}">
      <span class="no">${i + 1}</span><span class="sic">${ico(p.role, p.align, 'ti')}</span>
      <span><div class="pn">${esc(p.name)}</div><div class="pr t-${team(p.role)}">${esc(E.rname(p.role))}${E.isTraveller(p) ? ' · Странник' : ''}${p.believes ? ` <span class="muted">(считает себя: ${esc(E.rname(p.believes))})</span>` : ''}${p.gained ? ` <span class="muted">(способность: ${esc(E.rname(p.gained))})</span>` : ''}</div></span>
      <span class="badges"><span class="badge ${p.align}">${p.align === 'good' ? 'добрый' : 'злой'}</span>${p.alive ? '' : `<span class="badge dead">${art('dead', 'bd')}мёртв${p.ghost ? ' · голос' : ''}</span>`}${off ? `<span class="badge evil">${esc(off)}</span>` : ''}${toks}</span></button>
      ${UI.open === p.id ? editorHtml(p) : ''}`;
  }).join('');
  const bl = S.bluffs.length ? `<div class="small"><b>Блефы Демона:</b> ${S.bluffs.map(E.rname).map(esc).join(', ')}</div>` : '';
  return `<div class="card"><h3>Стол · ${esc(S.script.name)}</h3>${bl}<div>${rows || '<div class="muted">Игроков пока нет</div>'}</div>${S.phase === 'setup' ? '' : travellerForm()}</div>${S.phase === 'setup' ? '' : fabledZone()}`;
}

function editorHtml(p) {
  const tokKinds = ['poisoned', 'drunk', 'protected', 'cursed', 'safe', 'mad', 'note'];
  return `<div class="editor">
    <div class="field"><label>Роль</label><select data-act="edRole" data-arg="${p.id}">${E.isTraveller(p) ? plainOptions(DATA.travellers, p.role) : roleOptions(() => true, p.role, { all: true })}</select></div>
    <div class="seg"><button data-act="edAlive" data-arg="${p.id}">${p.alive ? 'Отметить смерть' : 'Воскресить'}</button>
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
  const ph = S.phase === 'setup' ? 'Подготовка' : S.phase === 'night' ? `Ночь ${S.n} · ${S.night.i + 1}/${S.night.steps.length}` : S.phase === 'day' ? `День ${S.n}` : 'Игра окончена';
  let body = '';
  if (UI.tab === 'game') body = S.phase === 'setup' ? viewSetup() : S.phase === 'night' ? viewNight() : S.phase === 'day' ? viewDay() : viewOver();
  if (UI.tab === 'table') body = viewTable();
  if (UI.tab === 'log') body = viewLog();
  if (UI.tab === 'menu') body = viewMenu();
  const last = HISTORY[HISTORY.length - 1];
  const scrollY = window.scrollY;
  app.innerHTML = `<header class="top"><span class="brand">${art('icon', 'logo')}Гримуар</span><span class="phase">${esc(ph)}</span>
      <button class="hundo" data-act="undo" ${last ? '' : 'disabled'} aria-label="${last ? esc('Отменить: ' + last.label) : 'Нечего отменять'}" title="${last ? esc('Отменить: ' + last.label) : ''}">↶</button><span class="save"></span></header>
    <main>${body}</main>
    <nav class="tabs">${[['game', S.phase === 'night' ? 'Ночь' : S.phase === 'day' ? 'День' : 'Игра'], ['table', 'Стол'], ['log', 'Журнал'], ['menu', 'Ещё']].map(([k, l]) => `<button class="${UI.tab === k ? 'on' : ''}" data-act="tab" data-arg="${k}">${l}</button>`).join('')}</nav>`;
  paintSave();
  window.scrollTo(0, scrollY);
}

/* ------------------------------------------------------------ обработчики */
const sel1 = (list, id) => (list || [])[0] === id ? [] : [id];
const A = {
  tab: k => { UI.tab = k; render(); window.scrollTo(0, 0); },
  undo: () => undo(),
  // подготовка
  script: k => act(S => { const sc = DATA.scripts[k]; S.script = { key: k, name: sc.name, roles: sc.roles.slice() }; S.players.forEach(p => { if (p.role && !E.isTraveller(p) && !S.script.roles.includes(p.role)) p.role = null; }); }, 'сценарий «' + DATA.scripts[k].name + '»'),
  customText: (a, el) => { UI.customText = el.value; },
  customLoad: () => {
    try {
      const arr = JSON.parse(UI.customText); const meta = arr.find(x => x && x.id === '_meta');
      const ids = arr.filter(x => !(x && x.id === '_meta')).map(x => String(typeof x === 'string' ? x : x.id).toLowerCase().replace(/[^a-z]/g, ''));
      const known = ids.filter(id => DATA.roles[id] && ['townsfolk', 'outsider', 'minion', 'demon'].includes(team(id))), unknown = ids.filter(id => !DATA.roles[id]);
      act(S => { S.script = { key: 'custom', name: (meta && meta.name) || 'Свой сценарий', roles: known }; }, 'свой сценарий');
      UI.notes = unknown.length ? [`Нет в данных приложения, пропущены: ${unknown.join(', ')}`] : []; render();
    } catch (e) { alertNote('Не получилось прочитать JSON: проверьте, что вставлен текст сценария целиком.'); }
  },
  addP: () => { const el = document.getElementById('newName'); const name = el.value.trim() || `Игрок ${S.players.length + 1}`; act(S => S.players.push(E.newPlayer(name)), 'игрок ' + name); setTimeout(() => { const n = document.getElementById('newName'); if (n) n.focus(); }, 0); },
  bulk: () => { const names = document.getElementById('bulkNames').value.split(/[,\n;]/).map(s => s.trim()).filter(Boolean); if (names.length) act(S => { S.players = names.map(n => E.newPlayer(n)); }, 'список игроков'); },
  rename: (id, el) => act(S => { E.P(S, id).name = el.value.trim() || E.P(S, id).name; }, 'имя игрока'),
  move: arg => { const [id, d] = arg.split('|'); act(S => { const i = S.players.findIndex(p => p.id === id), j = i + (+d); if (j >= 0 && j < S.players.length) [S.players[i], S.players[j]] = [S.players[j], S.players[i]]; }, 'порядок мест'); },
  delP: id => act(S => { S.players = S.players.filter(p => p.id !== id); }, 'удалён игрок'),
  deal: () => act(S => E.randomDeal(S), 'случайная раздача ролей'),
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
  num: arg => { const [key, d] = arg.split('|'); draft(S => { S.draft.inp[key] = Math.max(0, (S.draft.inp[key] || 0) + (+d)); }); },
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
  exPick: arg => { const id = arg.split('|')[1]; draft(S => { const ex = S.day.picks.exile || { pid: null, voters: [] }; ex.pid = ex.pid === id ? null : id; ex.voters = []; S.day.picks.exile = ex; }); },
  exVote: arg => { const id = arg.split('|')[1]; draft(S => { const v = S.day.picks.exile.voters; if (v.includes(id)) v.splice(v.indexOf(id), 1); else v.push(id); }); },
  exile: () => { const ex = clone(S.day.picks.exile); act(S => { E.exile(S, ex.pid, ex.voters.length); S.day.picks.exile = null; }); },
  nomPick: arg => { const [key, id] = arg.split('|'); draft(S => { const d = S.day.draft; d[key] = d[key] === id ? null : id; d.spy = false; }); },
  nomSpy: v => draft(S => { S.day.draft.spy = v === '1'; }),
  nominate: () => {
    let res = null; const d0 = clone(S.day.draft);
    act(S => {
      res = E.nominate(S, d0.by, d0.on, { spyTownsfolk: !!d0.spy });
      if (res.ended) E.endDay(S);
      else if (S.phase === 'day') S.day.draft = { by: d0.by, on: d0.on, voters: [], stage: 'vote', spy: false };
    });
    UI.notes = res ? res.notes : []; render();
  },
  vote: arg => { const id = arg.split('|')[1]; draft(S => { const v = S.day.draft.voters; if (v.includes(id)) v.splice(v.indexOf(id), 1); else v.push(id); }); },
  voteDone: () => { const d0 = clone(S.day.draft); act(S => { E.recordVote(S, d0.on, d0.voters); S.day.draft = { by: null, on: null, voters: [], stage: 'pick', spy: false }; }); },
  voteCancel: () => act(S => { S.day.draft = { by: null, on: null, voters: [], stage: 'pick', spy: false }; }, 'номинация отменена'),
  pacifist: () => draft(S => { S.day.picks.pacifist = !S.day.picks.pacifist; }),
  endDay: () => { const pac = S.day.picks.pacifist; UI.notes = []; act(S => E.endDay(S, { pacifist: pac }), 'конец дня ' + S.n); window.scrollTo(0, 0); },
  manualExe: () => { const id = S.day.picks.manualExe[0]; act(S => { E.execute(S, id); if (!S.result) E.endDay(S, { skipExecution: true }); }); window.scrollTo(0, 0); },
  // стол
  openP: id => { UI.open = UI.open === id ? null : id; render(); },
  edRole: (id, el) => act(S => { const p = E.P(S, id); const old = p.role; p.role = el.value || null; E.log(S, `Рассказчик меняет роль ${p.name}: ${E.rname(old)} → ${E.rname(p.role)}`, 'effect'); }),
  edAlive: id => act(S => { const p = E.P(S, id); if (p.alive) { E.log(S, `Рассказчик отмечает смерть: ${p.name}`, 'death'); p.alive = false; p.ghost = true; E.checkWin(S); } else { p.alive = true; E.log(S, `Рассказчик воскрешает ${p.name}`, 'effect'); } }),
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

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]'); if (!el || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return;
  const f = A[el.dataset.act]; if (f) { ev.preventDefault(); f(el.dataset.arg, el); }
});
document.addEventListener('change', ev => {
  const el = ev.target; if (!el.dataset || !el.dataset.act) return;
  if (el.tagName === 'SELECT' || el.tagName === 'INPUT') { const f = A[el.dataset.act]; if (f) f(el.dataset.arg, el); }
});
document.addEventListener('input', ev => {
  const el = ev.target; if (el.tagName !== 'TEXTAREA' || !el.dataset.act) return;
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
