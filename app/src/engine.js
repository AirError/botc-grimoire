'use strict';
/* Движок помощника рассказчика: состояние игры и правила ролей базовой коробки.
   Без DOM — всё, что нужно интерфейсу, описывается «шагами» (stepSpec). */

const R = id => DATA.roles[id];
const isGoodTeam = t => t === 'townsfolk' || t === 'outsider';
const TEAM_RU = { townsfolk: 'Горожанин', outsider: 'Изгой', minion: 'Приспешник', demon: 'Демон', traveller: 'Странник' };

function uid() { return Math.random().toString(36).slice(2, 10); }
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function rname(id) { return id && R(id) ? R(id).name : (DATA.special[id] ? DATA.special[id].name : id || '—'); }

/* ------------------------------------------------------------ состояние */

function newGame(scriptKey) {
  const sc = DATA.scripts[scriptKey || 'ecbe'];
  return {
    v: 1, id: uid(), created: Date.now(), updated: Date.now(),
    script: { key: scriptKey || 'ecbe', name: sc.name, roles: sc.roles.slice(), travellers: (sc.travellers || []).slice() },
    players: [], fabled: [], bluffs: [], phase: 'setup', n: 0,
    night: null, day: null, lastDay: null, flags: {}, log: [], result: null,
  };
}

function newPlayer(name) {
  return { id: uid(), name, role: null, believes: null, gained: null, align: 'good', alive: true, ghost: true, tokens: [] };
}

const P = (S, id) => S.players.find(p => p.id === id);
const nm = (S, id) => { const p = P(S, id); return p ? p.name : '—'; };
const realTeam = p => p.role && R(p.role) ? R(p.role).team : null;
const actsAs = p => p.gained || (p.role === 'drunk' ? p.believes : p.role);
const isTraveller = p => realTeam(p) === 'traveller';
const aliveList = S => S.players.filter(p => p.alive);
// живые без Странников — для условий победы и порогов ролей («Странники не считаются»)
const aliveCount = S => S.players.filter(p => p.alive && !isTraveller(p)).length;
// все живые, включая Странников — для порога казни (Странники голосуют)
const aliveAll = S => aliveList(S).length;
const coreCount = S => S.players.filter(p => !isTraveller(p)).length;
const isDemon = p => realTeam(p) === 'demon';
const demonAlive = p => isDemon(p) && (p.alive || p.secretlyAlive);
const inPlay = (S, rid) => S.players.some(p => p.role === rid);
const holders = (S, rid) => S.players.filter(p => p.role === rid);
const phaseTag = S => S.phase === 'day' ? `Д${S.n}` : S.phase === 'night' ? `Н${S.n}` : S.phase === 'over' ? 'Итог' : 'Подг.';

function log(S, text, kind) { S.log.push({ p: phaseTag(S), t: text, k: kind || 'info' }); }

/* ------------------------------------------------------------ жетоны и состояния */

function addTok(S, p, k, src, exp, extra) {
  p.tokens.push(Object.assign({ k, src, exp: exp ? exp[0] : null, n: exp ? exp[1] : null }, extra || {}));
}
function hasTok(p, k, src) { return p.tokens.some(t => t.k === k && (!src || t.src === src)); }
function rmTok(p, k, src) { p.tokens = p.tokens.filter(t => !(t.k === k && (!src || t.src === src))); }
const TOK_RU = {
  poisoned: 'Отравлен', drunk: 'Пьян', protected: 'Защищён', cursed: 'Проклят', safe: 'Не умрёт при казни',
  master: 'Хозяин', mad: 'Помешан', hasability: 'Сохранил способность', twin: 'Близнец', grandchild: 'Внук',
  herring: 'Ложная цель', chosen: 'Выбран', note: 'Заметка', know: 'Раскрытый', lunch: 'Обед',
  votes3: '3 голоса', voteneg: 'Голос против', sober: 'Трезв и здоров', twice: 'Действует дважды', bad: 'Что-то плохое',
};

function expire(S, when) { // when: 'dusk' | 'dawn'
  for (const p of S.players) p.tokens = p.tokens.filter(t => !(t.exp === when && t.n <= S.n));
}

// ближайшие живые соседи слева и справа
function aliveNeighbours(S, p) {
  const ps = S.players, n = ps.length, i = ps.indexOf(p), res = [];
  for (const dir of [-1, 1]) {
    for (let k = 1; k < n; k++) {
      const q = ps[(i + dir * k + n * k) % n];
      if (q === p) break;
      if (q.alive) { if (!res.includes(q)) res.push(q); break; }
    }
  }
  return res;
}
// ближайшие Горожане в обе стороны (живые и мёртвые) — для Но Даши и Вигормортиса
function townsfolkNeighbours(S, p) {
  const ps = S.players, n = ps.length, i = ps.indexOf(p), res = [];
  for (const dir of [-1, 1]) {
    for (let k = 1; k < n; k++) {
      const q = ps[(i + dir * k + n * k) % n];
      if (q === p) break;
      if (realTeam(q) === 'townsfolk') { if (!res.includes(q)) res.push(q); break; }
    }
  }
  return res;
}

// яд Вдовы действует, пока Вдова жива, трезва и здорова (её собственный яд на неё не в счёт)
const widowWorks = S => holders(S, 'widow').some(w => w.alive && !w.tokens.some(x => (x.k === 'drunk' || x.k === 'poisoned') && x.src !== 'widow'));
const tokOff = (S, t) => (t.k === 'drunk' || t.k === 'poisoned') && (t.src !== 'widow' || widowWorks(S));

// Нищий всегда трезв и здоров; Бариста может сделать игрока трезвым и здоровым до заката
const alwaysSober = p => p.role === 'beggar' || p.tokens.some(t => t.k === 'sober' && t.src === 'barista');

function abilityOff(S, p) { // способность не работает (пьян/отравлен/роль-обманка)
  if (p.role === 'drunk' && !p.gained) return 'Пьяница';
  if (p.role === 'lunatic') return 'Лунатик';
  if (alwaysSober(p)) return null;
  const t = p.tokens.find(t => tokOff(S, t));
  if (t) return (t.k === 'drunk' ? 'пьян' : 'отравлен') + (t.src && R(t.src) ? ` (${R(t.src).name})` : '');
  for (const nd of holders(S, 'nodashii')) {
    if (demonAlive(nd) && !abilityOffNoND(S, nd) && townsfolkNeighbours(S, nd).includes(p)) return 'отравлен (Но Даши)';
  }
  return null;
}
function abilityOffNoND(S, p) { // то же, но без Но Даши (чтобы не зациклиться)
  if (p.role === 'drunk' && !p.gained) return 'Пьяница';
  if (alwaysSober(p)) return null;
  const t = p.tokens.find(t => tokOff(S, t));
  return t ? t.k : null;
}

function teaLadyProtects(S, p) {
  return holders(S, 'tealady').some(t => {
    if (!t.alive || abilityOff(S, t)) return false;
    const nb = aliveNeighbours(S, t);
    return nb.length === 2 && nb.every(q => q.align === 'good') && nb.includes(p);
  });
}

function vortoxActive(S) { return holders(S, 'vortox').some(v => demonAlive(v) && !abilityOff(S, v)); }

/* ------------------------------------------------------------ смерть */

// cause: demon | minion | ability | execution | unstoppable
function attemptKill(S, p, cause, src, opts) {
  opts = opts || {};
  if (!p || !p.alive) return { died: false, why: 'уже мёртв' };
  if (cause !== 'unstoppable') {
    if (cause === 'demon' && hasTok(p, 'protected', 'monk')) return saved(S, p, 'Монах');
    if (cause === 'demon' && p.role === 'soldier' && !abilityOff(S, p)) return saved(S, p, 'Солдат');
    if (cause !== 'execution' && hasTok(p, 'protected', 'innkeeper')) return saved(S, p, 'Трактирщик');
    if (p.role === 'sailor' && !abilityOff(S, p)) return saved(S, p, 'Моряк');
    if (teaLadyProtects(S, p)) return saved(S, p, 'Травница');
    if (cause === 'execution' && hasTok(p, 'safe', 'devilsadvocate')) return saved(S, p, 'Адвокат Дьявола');
    if (p.role === 'fool' && !abilityOff(S, p) && !S.flags['foolUsed_' + p.id]) {
      S.flags['foolUsed_' + p.id] = true;
      return saved(S, p, 'Шут (1-я смерть)');
    }
    if (p.role === 'zombuul' && !S.flags.zombuulFaked && !abilityOff(S, p)) {
      S.flags.zombuulFaked = true; p.alive = false; p.secretlyAlive = true;
      log(S, `${p.name} (Зомбуул) «умирает», но остаётся в игре: определяется мёртвым`, 'death');
      afterDeath(S, p, cause, true);
      return { died: true, fake: true };
    }
  }
  die(S, p, cause, src, opts);
  return { died: true };
}
function saved(S, p, by) { log(S, `${p.name} не умирает: ${by}`, 'save'); return { died: false, why: by }; }

// смерть по решению рассказчика («что-то плохое» Ангела, ручная отметка на «Столе»): без защит, но со всеми
// последствиями — ночью попадёт в объявление на рассвете, сработают Смотритель, Дитя Луны, проверка победы и т. д.
// reason — примечание рассказчика (видно в журнале и на «Столе», в объявлении на рассвете не звучит)
function storytellerKill(S, pid, src, reason) {
  const p = P(S, pid);
  if (p && p.alive) die(S, p, 'storyteller', src || null, { reason: String(reason || '').trim() });
}

function die(S, p, cause, src, opts) {
  opts = opts || {};
  const aliveBefore = aliveCount(S);
  p.alive = false; p.secretlyAlive = false; p.ghost = true;
  const how = { exile: 'изгнан', demon: 'убит Демоном', minion: 'убит Приспешником', ability: 'умер от способности',
    execution: 'казнён', unstoppable: 'убит Ассасином', storyteller: 'умирает по решению рассказчика' }[cause] || 'умер';
  p.deathNote = opts.reason || null;
  log(S, `${p.name} (${rname(p.role)}) ${how}${src && R(src) && cause !== 'execution' ? ` — ${R(src).name}` : ''}${opts.reason ? `. Причина: ${opts.reason}` : ''}`, 'death');
  if (S.phase === 'night' && S.night) S.night.deaths.push({ pid: p.id, cause });
  if (S.phase === 'day' && S.day) S.day.deaths.push(p.id);
  afterDeath(S, p, cause, false, aliveBefore, opts);
}

function afterDeath(S, p, cause, fake, aliveBefore, opts) {
  opts = opts || {};
  const team = realTeam(p);
  if (S.phase === 'day' && S.day && team === 'outsider') S.day.outsiderDied = true;
  // actsAs: и Пьяница, считающий себя Смотрителем, и Философ/Каннибал с его способностью
  if (S.phase === 'night' && actsAs(p) === 'ravenkeeper') S.flags.ravenWake = p.id;
  if (p.role === 'sage' && cause === 'demon') S.flags.sageWake = p.id;
  if (p.role === 'moonchild' && !abilityOff(S, p)) S.flags.moonchildPending = p.id;
  if (p.role === 'klutz' && !abilityOff(S, p)) S.flags.klutzPending = p.id;
  if (p.role === 'barber' && !abilityOff(S, p)) S.flags.haircuts = true;
  if (p.role === 'sweetheart' || (actsAs(p) === 'sweetheart' && !abilityOff(S, p))) S.flags.sweetheartPending = p.id;
  if (p.role === 'widow') S.players.forEach(q => rmTok(q, 'poisoned', 'widow')); // яд Вдовы — пока она жива
  if (preventsMeeting(p) && !abilityOff(S, p)) evilMeetsTonight(S);
  // Бабушка
  if (cause === 'demon' && S.flags.grandchild === p.id) {
    for (const g of holders(S, 'grandmother')) if (g.alive && !abilityOff(S, g)) {
      log(S, `Внук убит Демоном — Бабушка (${g.name}) умирает тоже`, 'death'); die(S, g, 'ability', 'grandmother');
    }
  }
  // Менестрель: казнённый Приспешник
  if (cause === 'execution' && team === 'minion') {
    for (const m of holders(S, 'minstrel')) if (m.alive && !abilityOff(S, m)) {
      for (const q of S.players) if (q !== m && q.alive) addTok(S, q, 'drunk', 'minstrel', ['dusk', S.n + 2]);
      log(S, 'Менестрель: казнён Приспешник — все остальные пьяны до заката завтрашнего дня', 'effect');
    }
  }
  // Пукка: со смертью отравление снимается
  rmTok(p, 'poisoned', 'pukka');
  if (team === 'demon' && !fake && !opts.noScarlet) demonDied(S, p, cause, aliveBefore || aliveCount(S) + 1);
  if (!opts.noCheck) checkWin(S);
}

function demonDied(S, p, cause, aliveBefore) {
  if (S.players.some(q => q !== p && demonAlive(q))) return;
  const sw = S.players.find(q => q.role === 'scarletwoman' && q.alive && !abilityOff(S, q));
  if (sw && aliveBefore >= 5) {
    sw.role = p.role; S.flags.swBecame = sw.id; S.flags.swNight = S.phase === 'night' ? S.n : S.n + 1;
    log(S, `Блудница (${sw.name}) становится новым Демоном: ${rname(p.role)}`, 'effect');
    return;
  }
  if (cause === 'execution') {
    const mm = S.players.find(q => q.role === 'mastermind' && q.alive && !abilityOff(S, q));
    if (mm) { S.flags.mastermindDay = S.n + 1; log(S, 'Кукловод: Демон казнён, играем ещё один день. Казнь доброго — победа зла', 'effect'); }
  }
}

/* ------------------------------------------------------------ победа */

function endGame(S, winner, reason) {
  if (S.result) return;
  S.result = { winner, reason }; S.phase = 'over';
  log(S, `Победа ${winner === 'good' ? 'добра' : 'зла'}: ${reason}`, 'win');
}

function twinsBlockGood(S) {
  const et = S.players.find(p => p.role === 'eviltwin' && p.alive && !abilityOff(S, p));
  const gt = S.flags.goodTwin && P(S, S.flags.goodTwin);
  return et && gt && gt.alive;
}

function checkWin(S) {
  if (S.result || S.phase === 'setup') return S.result;
  const demonsLeft = S.players.some(demonAlive);
  if (!demonsLeft) {
    if (S.flags.mastermindDay) return null;
    if (twinsBlockGood(S)) { log(S, 'Демон мёртв, но добро не может победить, пока живы оба близнеца', 'warn'); return null; }
    endGame(S, 'good', 'Демон мёртв'); return S.result;
  }
  if (aliveCount(S) <= 2) { endGame(S, 'evil', 'в живых осталось 2 игрока'); return S.result; }
  return null;
}

/* ------------------------------------------------------------ подготовка */

const BASE_DIST = { 5: [3, 0, 1, 1], 6: [3, 1, 1, 1], 7: [5, 0, 1, 1], 8: [5, 1, 1, 1], 9: [5, 2, 1, 1],
  10: [7, 0, 2, 1], 11: [7, 1, 2, 1], 12: [7, 2, 2, 1], 13: [9, 0, 3, 1], 14: [9, 1, 3, 1], 15: [9, 2, 3, 1] };

// роли, у которых сдвиг числа Изгоев выбирает рассказчик; Горожан становится на столько же меньше (или больше).
// def — значение, пока рассказчик не выбрал; null — выбрать обязательно
const OUT_CHOICES = {
  godfather: { opts: [-1, 1], def: null },     // [−1 или +1 Изгой]
  balloonist: { opts: [0, 1], def: 0 },        // [+0 или +1 Изгой]
  sentinel: { opts: [-1, 0, 1], def: 0 },      // Сказочник: Изгоев может быть на 1 больше или меньше
};

// roles — роли в игре и Сказочники; mods — выбор рассказчика {godfather: −1|1, balloonist: 0|1, sentinel: −1|0|1};
// maxOut — сколько Изгоев есть в сценарии (больше добавить нельзя)
function distribution(nPlayers, roles, mods, maxOut) {
  mods = mods || {};
  if (maxOut === undefined) maxOut = Infinity;
  const base = BASE_DIST[Math.min(15, Math.max(5, nPlayers))];
  if (!base) return null;
  let [t, o, m, d] = base;
  const notes = [], choices = [];
  for (const r of roles) {
    if (r === 'baron') { t -= 2; o += 2; notes.push('Барон: +2 Изгоя'); }
    if (r === 'fanggu') { t -= 1; o += 1; notes.push('Фань Гу: +1 Изгой'); }
    if (r === 'vigormortis') { t += 1; o -= 1; notes.push('Вигормортис: −1 Изгой'); }
  }
  if (o < 0) { t += o; o = 0; } // убирать Изгоя некого — число Горожан не меняется
  for (const [id, c] of Object.entries(OUT_CHOICES)) {
    if (!roles.includes(id)) continue;
    const opts = c.opts.filter(x => o + x >= 0 && t - x >= 0 && (x <= 0 || o + x <= maxOut));
    let v = mods[id] ?? c.def;
    if (!opts.includes(v)) v = opts.length === 1 ? opts[0] : opts.includes(c.def) ? c.def : null;
    choices.push({ id, opts, value: v });
    if (v !== null) { o += v; t -= v; }
  }
  return { townsfolk: t, outsider: o, minion: m, demon: d, notes, choices, pending: choices.filter(c => c.value === null).map(c => c.id) };
}

// сверка раскладки с таблицей: строки «есть / нужно» по типам ролей («?» — пока не выбран сдвиг Изгоев)
function distCheck(d, c) {
  return ['townsfolk', 'outsider', 'minion', 'demon'].map(t => {
    const unknown = d.pending.length > 0 && (t === 'townsfolk' || t === 'outsider');
    return { t, have: c[t], want: unknown ? '?' : d[t], bad: unknown || c[t] !== d[t] };
  });
}

// раскладка для текущей подготовки: роли игроков + Сказочники, выбор рассказчика, запас Изгоев в сценарии
const scriptOutsiders = S => S.script.roles.filter(r => R(r) && R(r).team === 'outsider').length;
function setupDistribution(S) {
  const core = S.players.filter(p => !isTraveller(p));
  return distribution(core.length, core.map(p => p.role).filter(Boolean).concat(S.fabled || []), S.flags.mods, scriptOutsiders(S));
}

function countTeams(S) {
  const c = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
  for (const p of S.players) if (p.role && c[realTeam(p)] !== undefined) c[realTeam(p)]++;
  return c;
}

// случайная раздача по сценарию с учётом модификаторов раскладки
function randomDeal(S) {
  const core = S.players.filter(p => !isTraveller(p)), n = core.length, roles = S.script.roles;
  const byTeam = t => shuffle(roles.filter(r => R(r) && R(r).team === t));
  const demon = byTeam('demon')[0];
  const base = BASE_DIST[n];
  const minions = byTeam('minion').slice(0, base[2]);
  const chosen = [demon, ...minions];
  // сдвиги Изгоев — как выбрал рассказчик; Крёстному Отцу без выбора — случайно −1 или +1 (выбор запоминается)
  const mods = S.flags.mods = Object.assign({}, S.flags.mods);
  if (chosen.includes('godfather') && mods.godfather == null) mods.godfather = pick([-1, 1]);
  const dist = extra => distribution(n, chosen.concat(extra, S.fabled || []), mods, scriptOutsiders(S));
  let d = dist([]);
  const tfAll = byTeam('townsfolk');
  let tf = tfAll.slice(0, Math.max(0, d.townsfolk));
  // Аэронавт попал в раздачу — он сам меняет раскладку: пересчитываем так же, как таблица, и оставляем его в игре
  if (tf.includes('balloonist')) { d = dist(['balloonist']); tf = ['balloonist', ...tfAll.filter(r => r !== 'balloonist')].slice(0, Math.max(0, d.townsfolk)); }
  const outs = byTeam('outsider');
  let o = d.outsider;
  if (o > outs.length) { tf.push(...tfAll.filter(r => !tf.includes(r)).slice(0, o - outs.length)); o = outs.length; }
  chosen.push(...outs.slice(0, Math.max(0, o)));
  chosen.push(...tf);
  const seats = shuffle(core);
  seats.forEach((p, i) => { p.role = chosen[i] || null; });
  finishRoles(S);
  autoSetup(S, true);
}

function finishRoles(S) {
  for (const p of S.players) {
    if (isTraveller(p)) continue; // сторону Странника назначает рассказчик
    p.align = p.role && !isGoodTeam(realTeam(p)) ? 'evil' : 'good';
    if (p.role !== 'lunatic' && p.role !== 'drunk') p.believes = null;
  }
}

// значения по умолчанию для подготовки: Пьяница, Лунатик, блефы, внук, ложная цель, близнец
function autoSetup(S, force) {
  const roles = S.script.roles, used = new Set(S.players.map(p => p.role));
  const notInPlay = t => shuffle(roles.filter(r => R(r) && R(r).team === t && !used.has(r)));
  for (const p of S.players) {
    if (p.role === 'drunk' && (force || !p.believes)) { p.believes = notInPlay('townsfolk')[0] || null; if (p.believes) used.add(p.believes); }
    if (p.role === 'lunatic' && (force || !p.believes)) p.believes = shuffle(roles.filter(r => R(r) && R(r).team === 'demon'))[0] || null;
  }
  if (force || !S.bluffs.length) {
    const good = shuffle(roles.filter(r => R(r) && isGoodTeam(R(r).team) && !used.has(r)));
    S.bluffs = good.slice(0, 3);
  }
  const goodPlayers = S.players.filter(p => p.align === 'good');
  if (inPlay(S, 'grandmother') && (force || !S.flags.grandchild)) {
    const g = goodPlayers.filter(p => p.role !== 'grandmother'); S.flags.grandchild = g.length ? pick(g).id : null;
  }
  if (inPlay(S, 'fortuneteller') && (force || !S.flags.ftHerring)) S.flags.ftHerring = goodPlayers.length ? pick(goodPlayers).id : null;
  if (inPlay(S, 'eviltwin') && (force || !S.flags.goodTwin)) {
    const g = goodPlayers; S.flags.goodTwin = g.length ? pick(g).id : null;
  }
}

function setupProblems(S) {
  const out = [];
  const core = S.players.filter(p => !isTraveller(p));
  if (core.length < 5) out.push('Нужно хотя бы 5 игроков (не считая Странников)');
  if (S.players.some(p => !p.role)) out.push('Не всем игрокам выданы роли');
  if (core.length >= 5 && S.players.every(p => p.role)) {
    const d = setupDistribution(S);
    for (const id of d.pending) out.push(`${rname(id)}: выберите, сколько Изгоев — −1 или +1`);
    const diff = distCheck(d, countTeams(S)).filter(x => x.bad && x.want !== '?');
    if (diff.length) out.push('Раскладка не совпадает с таблицей: ' + diff.map(x => `${TEAM_RU[x.t]}: ${x.have} из ${x.want}`).join(', '));
    const c = countTeams(S);
    if (c.demon !== 1) out.push('В игре должен быть ровно 1 Демон');
    const roles = S.players.map(p => p.role);
    if (new Set(roles).size !== roles.length) out.push('Одна роль выдана дважды');
    for (const b of S.bluffs) if (b && S.players.some(p => p.role === b || p.believes === b)) out.push(`Блеф «${rname(b)}» есть в игре — выберите другой`);
    for (const p of S.players) {
      if (p.role === 'drunk' && !p.believes) out.push(`${p.name}: Пьяница — выберите, кем он себя считает`);
      if (p.role === 'lunatic' && !p.believes) out.push(`${p.name}: Лунатик — выберите, каким Демоном он себя считает`);
    }
  }
  return out;
}

function jinxesInPlay(S) {
  const ids = S.script.roles, out = [];
  for (const [k, text] of Object.entries(DATA.jinxes)) {
    const [a, b] = k.split('|'); if (ids.includes(a) && ids.includes(b)) out.push({ a, b, text });
  }
  return out;
}

function startGame(S) {
  finishRoles(S);
  for (const p of S.players) { p.alive = true; p.ghost = true; p.tokens = []; }
  if (S.flags.grandchild) addTok(S, P(S, S.flags.grandchild), 'grandchild', 'grandmother');
  if (S.flags.ftHerring) addTok(S, P(S, S.flags.ftHerring), 'herring', 'fortuneteller');
  if (S.flags.goodTwin) addTok(S, P(S, S.flags.goodTwin), 'twin', 'eviltwin');
  log(S, `Игра началась: ${S.players.length} игроков, сценарий «${S.script.name}»`, 'phase');
  startNight(S);
}

/* ------------------------------------------------------------ ночь */

function startNight(S) {
  S.n += 1; S.phase = 'night';
  expire(S, 'dusk');
  S.night = { i: 0, deaths: [], woke: [], data: {}, steps: [] };
  S.night.steps = buildSteps(S);
  log(S, `Наступила ночь ${S.n}`, 'phase');
}

function buildSteps(S) {
  const first = S.n === 1, order = DATA.order[first ? 'first' : 'other'], steps = [];
  for (const id of order) {
    if (DATA.special[id]) {
      // при 5–6 игроках злые не знакомятся — кроме игры с Кукольником
      if ((id === 'minioninfo' || id === 'demoninfo') && coreCount(S) < 7 && !(S.fabled || []).includes('toymaker')) continue;
      steps.push({ key: id, id, pid: null });
      if (id === 'dusk' && !first && S.flags.evilWakes) {
        steps.push({ key: 'minioninfo:meet', id: 'minioninfo', pid: null, meet: true }, { key: 'demoninfo:meet', id: 'demoninfo', pid: null, meet: true });
        S.flags.evilWakes = false;
      }
      continue;
    }
    if (R(id) && R(id).team === 'fabled') { if ((S.fabled || []).includes(id)) steps.push({ key: 'fab:' + id, id, pid: null, fabled: true }); continue; }
    let actors = S.players.filter(p => actsAs(p) === id);
    if (id === 'scarletwoman' && S.flags.swBecame) actors = actors.concat([P(S, S.flags.swBecame)]);
    for (const p of actors) steps.push({ key: id + ':' + p.id, id, pid: p.id });
  }
  // Каннибал: способность «только в 1-ю ночь» срабатывает в ночь после того, как он её получил;
  // съев злого, он отравлен — его можно будить, когда проснулась бы съеденная роль, «понарошку»
  if (!first) for (const c of holders(S, 'cannibal')) {
    const f = S.flags['cannibal_' + c.id];
    if (!f) continue;
    if (f.evil) insertStep(steps, { key: 'cannibal:' + c.id, id: f.role, pid: c.id, fakeCannibal: true }, order);
    else if (f.night === S.n && !order.includes(f.role) && DATA.order.first.includes(f.role))
      insertStep(steps, { key: f.role + ':' + c.id + ':fresh', id: f.role, pid: c.id, fresh: true }, order);
  }
  // Ученик вошёл в игру позже 1-й ночи: его «первая ночь» — сразу после заката
  if (!first) for (const a of holders(S, 'apprentice')) {
    if (once(S, a, 'apprentice') || a.gained) continue;
    const at = steps.findIndex(s => s.id === 'dusk');
    steps.splice(at + 1, 0, { key: 'apprentice:' + a.id, id: 'apprentice', pid: a.id });
  }
  // способность «только в 1-ю ночь», полученная этой ночью (Ученик, Собиратель Костей)
  if (!first) for (const f of S.flags.fresh || []) {
    if (f.night !== S.n || order.includes(f.role) || !DATA.order.first.includes(f.role)) continue;
    insertStep(steps, { key: f.role + ':' + f.pid + ':fresh', id: f.role, pid: f.pid, fresh: true }, order);
  }
  return steps;
}
function addFresh(S, pid, role) { S.flags.fresh = (S.flags.fresh || []).filter(f => f.night >= S.n).concat({ pid, role, night: S.n }); }
// после смены способностей посреди ночи — перестраиваем оставшиеся шаги этой ночи
function rebuildRest(S) {
  const ord = DATA.order[S.n === 1 ? 'first' : 'other'], cur = S.night.steps[S.night.i];
  const done = new Set(S.night.steps.slice(0, S.night.i + 1).map(st => st.key)), k = ord.indexOf(cur.id);
  S.night.steps = S.night.steps.slice(0, S.night.i + 1).concat(buildSteps(S).filter(st => !done.has(st.key)
    && (st.fresh || st.fakeCannibal || k < 0 || ord.indexOf(st.id) > k)));
}
// шаг на место роли в ночном порядке; роли нет в порядке этой ночи — перед рассветом
function insertStep(steps, st, order) {
  const k = order.indexOf(st.id);
  let at = k < 0 ? -1 : steps.findIndex(s => order.indexOf(s.id) > k);
  if (at < 0) at = steps.findIndex(s => s.id === 'dawn');
  steps.splice(at < 0 ? steps.length : at, 0, st);
}

function currentStep(S) { return S.night && S.night.steps[S.night.i]; }

function endNight(S) {
  expire(S, 'dawn');
  const deaths = S.night.deaths.map(d => nm(S, d.pid));
  S.phase = 'day';
  S.lastDay = S.day;
  S.day = { n: S.n, noms: [], executed: null, executionDeath: null, deaths: [], outsiderDied: false, demonVoted: false, minionNominated: false, nominated: [], nominators: [],
    exiled: [], draft: { by: null, on: null, voters: [], stage: 'pick', spy: false } };
  S.flags.swBecame = S.flags.swNight && S.flags.swNight <= S.n ? null : S.flags.swBecame;
  log(S, deaths.length ? `Рассвет. Этой ночью умерли: ${deaths.join(', ')}` : 'Рассвет. Этой ночью никто не умер', 'phase');
  checkWin(S);
}

/* ------------------------------------------------------------ день */

const travellerWorks = (S, rid) => holders(S, rid).some(h => h.alive && !abilityOff(S, h));
// Шаман Вуду: голосуют только он и мёртвые (жетон не тратится), половина голосов не нужна — хватает 1 голоса
const voudonActive = S => travellerWorks(S, 'voudon');
// Епископ: номинирует только рассказчик
const bishopActive = S => travellerWorks(S, 'bishop');
const voteThreshold = S => voudonActive(S) ? 1 : Math.ceil(aliveAll(S) / 2);
// вес голоса: Бюрократ — за 3, Вор — против; пропадает, если Странник умер, изгнан или без способности
function voteWeight(S, v) {
  let w = 1;
  if (hasTok(v, 'votes3', 'bureaucrat') && travellerWorks(S, 'bureaucrat')) w = 3;
  if (hasTok(v, 'voteneg', 'thief') && travellerWorks(S, 'thief')) w = -w;
  return w;
}
const voteCount = (S, ids) => ids.reduce((sum, id) => sum + voteWeight(S, P(S, id)), 0);

// что произойдёт при номинации — чтобы показать рассказчику заранее и спросить решения
function nominationPreview(S, byId, onId) {
  const by = P(S, byId), on = P(S, onId), out = { notes: [], askSpy: false };
  if (!by || !on) return out;
  if (hasTok(by, 'cursed', 'witch') && holders(S, 'witch').some(w => w.alive && !abilityOff(S, w)) && aliveCount(S) > 3)
    out.notes.push(`${by.name} проклят Ведьмой: номинировав, он умрёт (номинация всё равно состоится)`);
  if (on.role === 'virgin' && !S.flags['virginUsed_' + on.id]) {
    if (abilityOff(S, on)) out.notes.push('Девственница пьяна или отравлена: способность тратится впустую');
    else if (realTeam(by) === 'townsfolk') out.notes.push(`Девственница номинирована впервые, ${by.name} — Горожанин: его немедленно казнят`);
    else if (by.role === 'spy') { out.notes.push('Номинирует Шпион: вы решаете, определяется ли он Горожанином'); out.askSpy = true; }
    else if (by.role === 'drunk') out.notes.push('Номинирует Пьяница: он не Горожанин — казни не будет, способность Девственницы тратится');
    else out.notes.push('Номинирует не Горожанин: казни не будет, способность Девственницы тратится');
  }
  return out;
}

// byId === 'st' — номинирует рассказчик (Епископ)
function nominate(S, byId, onId, opts) {
  opts = opts || {};
  const by = byId === 'st' ? null : P(S, byId), on = P(S, onId), d = S.day, res = { ended: false, notes: [] };
  if (by) d.nominators.push(byId);
  d.nominated.push(onId); d.lastNom = { by: byId, on: onId, butcher: !!d.butcherOpen };
  if (by && realTeam(by) === 'minion') d.minionNominated = true;
  log(S, `${by ? by.name : 'Рассказчик'} номинирует ${on.name}${d.butcherOpen ? ' (Мясник, после казни)' : ''}`, 'day');
  if (!by) { if (on.role === 'virgin') S.flags['virginUsed_' + on.id] = true; return res; }
  // Ведьма
  if (hasTok(by, 'cursed', 'witch') && holders(S, 'witch').some(w => w.alive && !abilityOff(S, w)) && aliveCount(S) > 3) {
    log(S, `${by.name} был проклят Ведьмой и умирает, номинировав`, 'death');
    die(S, by, 'ability', 'witch');
    res.notes.push(`${by.name} умирает: проклятие Ведьмы`);
  }
  // Девственница
  if (on.role === 'virgin' && !S.flags['virginUsed_' + on.id]) {
    S.flags['virginUsed_' + on.id] = true;
    if (!abilityOff(S, on) && (realTeam(by) === 'townsfolk' || (by.role === 'spy' && opts.spyTownsfolk)) && by.alive) {
      log(S, `Девственница: ${by.name} — Горожанин, его немедленно казнят`, 'effect');
      execute(S, byId); res.ended = true; res.notes.push(`${by.name} казнён немедленно (Девственница)`);
    } else res.notes.push('Девственница: казни нет, способность потрачена');
  }
  return res;
}

function recordVote(S, onId, voterIds) {
  const d = S.day, vd = voudonActive(S);
  for (const id of voterIds) { const v = P(S, id); if (!v.alive && !vd) v.ghost = false; if (isDemon(v)) d.demonVoted = true; }
  const nomi = d.noms.find(x => x.on === onId && x.open) || { on: onId };
  const count = voteCount(S, voterIds), raw = voterIds.length;
  Object.assign(nomi, { voters: voterIds.slice(), count, open: false, butcher: !!d.butcherOpen });
  if (!d.noms.includes(nomi)) d.noms.push(nomi);
  d.butcherOpen = false; // Мясник номинирует ещё раз только однажды
  log(S, `Голосование за ${nm(S, onId)}: ${count}${count !== raw ? ` (рук ${raw})` : ''} (нужно ${voteThreshold(S)})`, 'day');
  return block(S);
}

function block(S) { // кто на плахе: больше всех голосов и не меньше порога; ничья — никто (номинация Мясника — отдельно)
  const th = voteThreshold(S), noms = S.day.noms.filter(x => !x.butcher && x.count >= th);
  if (!noms.length) return null;
  const max = Math.max(...noms.map(x => x.count)), top = noms.filter(x => x.count === max);
  return top.length === 1 ? top[0].on : null;
}

function execute(S, pid, opts) {
  opts = opts || {};
  let p = P(S, pid);
  // Козёл Отпущения: рассказчик решил, что вместо игрока его стороны казнят его
  const sg = opts.scapegoat && P(S, opts.scapegoat);
  if (sg && sg.alive && sg !== p && sg.align === p.align && !abilityOff(S, sg)) {
    log(S, `Козёл Отпущения (${sg.name}) казнён вместо ${p.name}`, 'effect'); p = sg; pid = sg.id;
  }
  S.day.executed = pid;
  log(S, `Казнь: ${p.name}`, 'day');
  if (S.flags.goodTwin === pid && S.players.some(q => q.role === 'eviltwin' && q.alive && !abilityOff(S, q)))
    return endGame(S, 'evil', 'казнён добрый близнец');
  if (S.flags.mastermindDay && S.flags.mastermindDay === S.n) {
    return endGame(S, p.align === 'good' ? 'evil' : 'good', `Кукловод: в дополнительный день казнён ${p.align === 'good' ? 'добрый' : 'злой'} игрок`);
  }
  if (opts.pacifist) { log(S, `${p.name} не умирает: Пацифист`, 'save'); return; }
  const r = attemptKill(S, p, 'execution');
  if (r.died) {
    S.day.executionDeath = pid;
    if (p.role === 'saint' && !abilityOff(S, p)) return endGame(S, 'evil', 'казнён Святой');
    if (!r.fake) cannibalEats(S, p);
  }
}

// Каннибал: способность последнего казнённого и умершего игрока. Злой — Каннибал отравлен, пока не казнят доброго.
// Какую способность получил, Каннибалу не говорят. flags.cannibal_<id> = {pid, role, evil, night}
function cannibalEats(S, ex) {
  for (const c of holders(S, 'cannibal')) {
    if (!c.alive || c === ex) continue;
    S.players.forEach(q => rmTok(q, 'lunch', 'cannibal'));
    addTok(S, ex, 'lunch', 'cannibal');
    const evil = ex.align === 'evil';
    S.flags['cannibal_' + c.id] = { pid: ex.id, role: ex.role, evil, night: S.n + 1 };
    if (evil) { c.gained = null; if (!hasTok(c, 'poisoned', 'cannibal')) addTok(S, c, 'poisoned', 'cannibal'); }
    else { c.gained = ex.role; rmTok(c, 'poisoned', 'cannibal'); }
    log(S, `Обед Каннибала (${c.name}): ${ex.name} — ${evil ? 'злой игрок, Каннибал отравлен, пока не казнят доброго' : `способность «${rname(ex.role)}» теперь у Каннибала`}`, 'effect');
  }
}

// Мясник: казнить сейчас — после этого Мясник может номинировать ещё раз
function executeNow(S, opts) {
  const b = block(S);
  if (!b || S.day.executed) return;
  execute(S, b, opts);
  if (!S.result && travellerWorks(S, 'butcher')) { S.day.butcherOpen = true; log(S, 'После казни Мясник может номинировать ещё раз', 'day'); }
}

function endDay(S, opts) {
  opts = opts || {};
  const d = S.day;
  if (!d.executed) {
    const b = block(S);
    if (b && !opts.skipExecution) execute(S, b, opts);
  } else if (!d.executed2) { // вторая казнь: номинация Мясника набрала порог (превышать первую не нужно)
    const bn = d.noms.find(x => x.butcher && x.count >= voteThreshold(S));
    if (bn) { d.executed2 = bn.on; execute(S, bn.on, { scapegoat: opts.scapegoat }); }
  }
  if (S.result) return;
  if (!d.executed) {
    log(S, 'День закончился без казни', 'day');
    if (vortoxActive(S)) return endGame(S, 'evil', 'Вортокс: день прошёл без казни');
    const mayor = S.players.find(p => p.role === 'mayor' && p.alive && !abilityOff(S, p));
    if (mayor && aliveCount(S) === 3 && !twinsBlockGood(S)) return endGame(S, 'good', 'Мэр: трое живых и нет казни');
    if (S.flags.mastermindDay === S.n) return endGame(S, 'good', 'Кукловод: в дополнительный день никого не казнили');
  }
  if (checkWin(S)) return;
  startNight(S);
}

function slayerShot(S, slayerId, targetId, registersAsDemon) {
  const s = P(S, slayerId), t = P(S, targetId);
  S.flags['slayerUsed_' + slayerId] = true;
  log(S, `Истребитель ${s.name} стреляет в ${t.name}`, 'day');
  if (!abilityOff(S, s) && (isDemon(t) || registersAsDemon)) {
    attemptKill(S, t, 'ability', 'slayer');
  } else log(S, 'Ничего не происходит', 'day');
}

// Судья (раз за игру, номинировал другой игрок): казнь состоится немедленно — или не состоится (голоса не считаются)
function judgeRuling(S, judgeId, onId, pass) {
  const j = P(S, judgeId), on = P(S, onId), d = S.day;
  markOnce(S, j, 'judge');
  if (abilityOff(S, j)) { log(S, `Судья (${j.name}) выносит решение — способность не работает`, 'day'); return { ended: false }; }
  if (pass) { log(S, `Судья (${j.name}): казнь ${on.name} состоится`, 'day'); execute(S, onId); return { ended: true }; }
  const nomi = d.noms.filter(x => x.on === onId).pop();
  if (nomi) Object.assign(nomi, { count: 0, open: false, pardoned: true }); else d.noms.push({ on: onId, voters: [], count: 0, open: false, pardoned: true });
  log(S, `Судья (${j.name}): казни ${on.name} не будет — голоса за него не считаются`, 'day');
  return { ended: false };
}
// Стрелок: после 1-го подсчёта голосов может выбрать проголосовавшего — тот умирает
function gunslingerShot(S, gid, tid) {
  const g = P(S, gid), t = P(S, tid);
  S.day.gunUsed = true;
  log(S, `Стрелок (${g.name}) стреляет в ${t.name}`, 'day');
  if (abilityOff(S, g)) return log(S, 'Ничего не происходит — способность не работает', 'day');
  attemptKill(S, t, 'ability', 'gunslinger');
}
// Механик может умереть в любой момент (решение рассказчика)
function tinkerDies(S, pid) {
  const t = P(S, pid);
  if (abilityOff(S, t)) return log(S, `Механик (${t.name}) мог бы умереть — способность не работает`, 'day');
  attemptKill(S, t, 'ability', 'tinker');
}
// Сказочник Фаталист: живой игрок (раз за игру) требует смерти игрока своей стороны; кого — решает рассказчик
function doomsayerKill(S, invokerId, victimId) {
  const a = P(S, invokerId), v = P(S, victimId);
  S.flags['doomUsed_' + a.id] = true;
  log(S, `Фаталист: ${a.name} требует смерти игрока своей стороны`, 'day');
  attemptKill(S, v, 'ability', 'doomsayer');
}
// Сказочник Скрипач: Демон против выбранного игрока другой стороны; ничья — победа зла
function fiddlerEnd(S, challengerId, result) {
  const dm = S.players.find(demonAlive), ch = P(S, challengerId);
  const side = result === 'demon' ? (dm ? dm.align : 'evil') : result === 'challenger' ? ch.align : 'evil';
  endGame(S, side, `Скрипач: ${result === 'tie' ? 'ничья — побеждает зло' : `в состязании победил ${result === 'demon' ? (dm ? dm.name : 'Демон') : ch.name}`}`);
}
// Надзирательница: до 3 пар игроков за день меняются местами
function swapSeats(S, aId, bId) {
  const i = S.players.findIndex(p => p.id === aId), j = S.players.findIndex(p => p.id === bId);
  if (i < 0 || j < 0 || i === j) return;
  [S.players[i], S.players[j]] = [S.players[j], S.players[i]];
  S.day.matronSwaps = (S.day.matronSwaps || 0) + 1;
  log(S, `Надзирательница: ${S.players[j].name} и ${S.players[i].name} меняются местами`, 'day');
}

/* ------------------------------------------------------------ Странники, Сказочники, свойства ролей */

// роль со свойством «Приспешники и Демон не знают друг друга» (например, Дурманщик)
const preventsMeeting = p => !!(p && p.role && R(p.role) && (R(p.role).props || {}).prevents_evil_meeting);
function meetingBlocker(S) { return S.players.find(p => preventsMeeting(p) && p.alive && !abilityOff(S, p)) || null; }
function evilMeetsTonight(S) {
  if (meetingBlocker(S)) return; // знакомству всё ещё мешает другой носитель свойства
  if (S.phase === 'night' && S.night) { // этой же ночью: вставляем шаги перед рассветом
    const at = S.night.steps.findIndex((s, i) => i > S.night.i && s.id === 'dawn');
    const pos = at < 0 ? S.night.steps.length : at;
    S.night.steps.splice(pos, 0, { key: 'minioninfo:meet', id: 'minioninfo', pid: null, meet: true }, { key: 'demoninfo:meet', id: 'demoninfo', pid: null, meet: true });
  } else S.flags.evilWakes = true;
  log(S, 'Злые узнают друг друга этой ночью', 'effect');
}

function addTraveller(S, name, roleId, align, afterId) {
  const p = newPlayer(name); p.role = roleId; p.align = align === 'evil' ? 'evil' : 'good';
  const i = afterId ? S.players.findIndex(q => q.id === afterId) : S.players.length - 1;
  S.players.splice(i + 1, 0, p);
  if (S.phase !== 'setup') log(S, `В игру входит Странник ${name}: ${rname(roleId)} (${p.align === 'evil' ? 'злой' : 'добрый'})`, 'effect');
  return p;
}

// порог изгнания: половина всех игроков с округлением вверх — живых и мёртвых, Странники тоже считаются
// (голоса мёртвых на изгнании не тратятся) — по правилам из буклета, со слов пользователя
const exileThreshold = S => Math.ceil(S.players.length / 2);

// изгнание Странника: не казнь, за день может быть сколько угодно
function exile(S, pid, votes, passed, opts) {
  opts = opts || {};
  const p = P(S, pid);
  if (passed === undefined || passed === null) passed = votes >= exileThreshold(S);
  log(S, `Изгнание Странника ${p.name}: ${votes} голос. (нужно ${exileThreshold(S)})`, 'day');
  if (!passed) { log(S, `${p.name} не изгнан`, 'day'); return; }
  // Девиант: если сегодня был забавным, изгнание его не убивает (решает рассказчик)
  if (p.role === 'deviant' && opts.funny) { log(S, `Девиант (${p.name}) сегодня был забавным — изгнание его не убивает`, 'save'); return; }
  S.day.exiled = (S.day.exiled || []).concat(pid);
  die(S, p, 'exile', null);
}

// Каннибал съел злого: способности нет (отравлен), но можно разбудить и «дать» ему способность — лучше ту, которой блефовал казнённый
function cannibalFakeSpec(S, step) {
  const p = P(S, step.pid), f = S.flags['cannibal_' + p.id] || {}, ex = P(S, f.pid);
  const spec = { title: 'Каннибал — отравлен', who: p.name, pid: p.id, team: 'townsfolk', text: '', active: p.alive, reason: p.alive ? '' : `${p.name} мёртв`,
    inputs: [PL('t', 2, 'Выбор Каннибала, если будите его (можно никого)', () => true, { min: 0 })], defaults: {}, warn: [],
    info: () => ({ show: null, lines: ['Любая информация может быть ложной: способности у Каннибала нет'] }),
    apply: inp => log(S, `Каннибал (${p.name}) отравлен, «способность» понарошку${inp.t && inp.t.length ? ': ' + inp.t.map(id => nm(S, id)).join(', ') : ''}`, 'action'),
    bounds: [Y(`Каннибал съел злого игрока${ex ? ` (${ex.name} — ${rname(ex.role)})` : ''} и отравлен, пока не казнят доброго`),
      Y('Можно разбудить его, когда проснулась бы эта роль, и сделать вид, что у него новая способность — лучше та, которой блефовал казнённый. Можно и не будить')] };
  return spec;
}

function fabledSpec(S, step, first) {
  const role = R(step.id);
  const spec = { title: role.name, who: 'Сказочник', team: 'fabled', text: (first ? role.first : role.other) || '', active: true, reason: '',
    inputs: [PL('t', 2, 'Выбор (если нужен)', () => true, { min: 0 })], defaults: {}, warn: [], info: () => null,
    apply: inp => log(S, `${role.name}${inp.t && inp.t.length ? ': ' + inp.t.map(id => nm(S, id)).join(', ') : ''}`, 'action'),
    bounds: [{ w: 'Способность', t: role.ability }] };
  // Герцогиня: ровно 3 посетителя узнают, сколько из них злых; один получает ложное число
  if (step.id === 'duchess') Object.assign(spec, {
    inputs: [PL('t', 3, 'Посетители Герцогини (ровно 3; иначе никто не просыпается)', () => true, { min: 0 })],
    more: inp => (inp.t || []).length === 3 ? [PL('f', 1, 'Кто из них получает ложное число', q => inp.t.includes(q.id))] : [],
    info: inp => {
      const vs = (inp.t || []).map(id => P(S, id)); if (vs.length !== 3) return { show: 'Посетителей не 3 — Герцогиня не действует', lines: [] };
      const n = vs.filter(q => q.align === 'evil').length, f = inp.f && P(S, inp.f[0]);
      return { show: `Злых посетителей: ${n}`, lines: [`Покажите это число двоим, ${f ? f.name : 'третьему'} — любое другое`, ...regNote(S, inp.t)] };
    },
    apply: inp => log(S, (inp.t || []).length === 3 ? `Герцогиня: посетители ${inp.t.map(id => nm(S, id)).join(', ')}; ложное число — ${nm(S, (inp.f || [])[0])}` : 'Герцогиня: посетителей не 3 — никто не просыпается', 'info'),
    bounds: [{ w: 'Способность', t: role.ability }, Y('Каждому посетителю — число злых среди троих (себя тоже); одному — любое другое число')],
  });
  return spec;
}

/* ------------------------------------------------------------ шаги ночи */

// общий вид шага: {title, who, text, active, reason, inputs, defaults, info(inp), apply(inp)}
function stepSpec(S, step) {
  const first = S.n === 1 || !!step.fresh; // fresh: Каннибал получил способность «в 1-ю ночь» — работает как в первую
  if (DATA.special[step.id]) return specialSpec(S, step, first);
  if (step.fabled) return fabledSpec(S, step, first);
  if (step.fakeCannibal) return cannibalFakeSpec(S, step);
  const p = P(S, step.pid), role = R(step.id);
  const base = {
    title: role.name, who: p.name, pid: p.id, team: role.team,
    text: (first ? role.first : role.other) || '',
    active: true, reason: '', inputs: [], defaults: {}, warn: [],
    info: () => null, apply: () => {},
  };
  const off = abilityOff(S, p);
  if (off) base.warn.push(`${p.name}: ${off}. Способность не работает — можно дать ложную информацию, эффекты не применяются.`);
  if (p.believes && p.role === 'drunk') base.warn.push(`На самом деле ${p.name} — Пьяница (считает себя: ${rname(p.believes)})`);
  if (p.role === 'cannibal') base.warn.push(`${p.name} — Каннибал со способностью съеденного игрока (${nm(S, (S.flags['cannibal_' + p.id] || {}).pid)}). Не говорите, какая это способность.`);
  if (vortoxActive(S) && role.team === 'townsfolk') base.warn.push('Вортокс в игре: информация Горожан должна быть ложной.');
  if (role.team === 'demon' && S.night.data.lunatic && p.role !== 'lunatic')
    base.warn.push(`Лунатик «атаковал»: ${S.night.data.lunatic.map(id => nm(S, id)).join(', ') || 'никого'} — покажите это Демону.`);
  const logic = LOGIC[step.id];
  const spec = logic ? Object.assign(base, logic(S, p, first, !!off, base) || {}) : Object.assign(base, genericLogic(S, p, first, !!off, base));
  // мёртвый просыпается, если способность сохранена (Вигормортис) или возвращена (Собиратель Костей)
  if (spec.active && !p.alive && !spec.deadOk && !hasTok(p, 'hasability')) { spec.active = false; spec.reason = `${p.name} мёртв`; }
  if (hasTok(p, 'twice', 'barista')) spec.warn.push('Бариста: способность срабатывает дважды — шаг повторится ещё раз.');
  // Кукольник: Демон может не нападать (и обязан сделать это хотя бы раз за игру)
  if (spec.active && role.team === 'demon' && (S.fabled || []).includes('toymaker') && spec.inputs.some(f => f.key === 't')) {
    spec.inputs = spec.inputs.map(f => f.key === 't' ? Object.assign({}, f, { min: 0, label: f.label + ' (Кукольник: можно никого)' }) : f);
    const orig = spec.apply;
    spec.apply = inp => {
      if (inp.t && inp.t.length) return orig(inp);
      S.flags.toyNoAttack = true; log(S, `${rname(p.role)} (${p.name}) не нападает этой ночью (Кукольник)`, 'action');
    };
    if (!S.flags.toyNoAttack) spec.warn.push('Кукольник: Демон ещё ни разу не отказывался от нападения. Если его нападение может закончить игру — он этой ночью не нападает (не выбирайте никого).');
  }
  spec.bounds = boundsFor(step.id, first).slice();
  if (!spec.bounds.length) spec.bounds.push({ w: 'Способность', t: role.ability });
  if (off) spec.bounds.push(Y('Способность не работает: можно показать любую информацию, эффекты не применяются'));
  if (p.role === 'cannibal') spec.bounds.push(Y('Каннибалу не говорят, чья это способность: будите его как обычную роль'));
  return spec;
}

function specialSpec(S, step, first) {
  const sp = DATA.special[step.id];
  const spec = { title: sp.name, who: '', text: (first ? sp.first : sp.other) || '', active: true, reason: '', inputs: [], defaults: {}, warn: [], info: () => null, apply: () => {}, bounds: boundsFor(step.id, first) };
  const minions = S.players.filter(p => realTeam(p) === 'minion'), demon = S.players.find(isDemon);
  if (step.id === 'minioninfo') spec.info = () => ({ show: `Демон: ${demon ? demon.name : '—'}`, lines: [`Приспешники: ${minions.map(m => m.name).join(', ') || '—'}`] });
  const blocker = meetingBlocker(S);
  if (step.meet) {
    spec.title = step.id === 'minioninfo' ? 'Злые знакомятся: Приспешники' : 'Злые знакомятся: Демон';
    spec.text = step.id === 'minioninfo' ? 'Разбудите Приспешников, пусть посмотрят друг на друга. Покажите жетон *ЭТО ДЕМОН* и укажите на Демона.'
      : 'Разбудите Демона. Покажите жетон *ЭТО ВАШИ ПРИСПЕШНИКИ* и укажите на Приспешников.';
    spec.bounds = [Y('Носитель свойства «злые не знакомятся» умер трезвым — злые узнают друг друга этой ночью')];
    if (step.id === 'demoninfo') spec.info = () => ({ show: `Приспешники: ${minions.map(m => m.name).join(', ') || '—'}`, lines: [] });
    return spec;
  }
  if (first && blocker && step.id === 'minioninfo') { spec.active = false; spec.reason = `в игре ${rname(blocker.role)} — Приспешники и Демон не знакомятся`; }
  if (first && blocker && step.id === 'demoninfo') {
    spec.text = 'Разбудите Демона. Покажите жетон *ЭТИХ РОЛЕЙ В ИГРЕ НЕТ* и 3 жетона добрых ролей, которых нет в игре. Приспешников не показывайте.';
    spec.bounds = [Y(`В игре ${rname(blocker.role)}: Демон получает только блефы, без знакомства с Приспешниками`)];
    spec.info = () => ({ show: `Блефы: ${S.bluffs.map(rname).join(', ')}`, lines: [] });
    return spec;
  }
  if (step.id === 'demoninfo') {
    spec.info = () => ({ show: `Блефы: ${S.bluffs.map(rname).join(', ')}`, lines: [`Приспешники: ${minions.map(m => m.name).join(', ') || '—'}`] });
    const lun = S.players.find(p => p.role === 'lunatic');
    if (lun) spec.warn.push(`Лунатик ${lun.name} считает себя Демоном (${rname(lun.believes)}): покажите Демону, кто Лунатик.`);
  }
  if (step.id === 'dawn') {
    const pend = [];
    if (S.flags.moonchildPending) pend.push(`Дитя Луны (${nm(S, S.flags.moonchildPending)}) днём выберет игрока`);
    if (S.flags.klutzPending) pend.push(`Растяпа (${nm(S, S.flags.klutzPending)}) днём выберет игрока`);
    spec.info = () => ({ show: S.night.deaths.length ? `Умерли: ${S.night.deaths.map(d => nm(S, d.pid)).join(', ')}` : 'Никто не умер', lines: pend });
  }
  return spec;
}

/* --- помощники для логики ролей */
const PL = (key, n, label, filter, extra) => Object.assign({ type: 'players', key, n, label, filter: filter || (() => true) }, extra || {});
const ROLE = (key, label, filter, extra) => Object.assign({ type: 'role', key, label, filter: filter || (() => true) }, extra || {});
const CHOICE = (key, label, options) => ({ type: 'choice', key, label, options });
const NUM = (key, label) => ({ type: 'number', key, label });
const TEXT = (key, label) => ({ type: 'text', key, label });
const notSelf = p => q => q.id !== p.id;
const aliveOnly = q => q.alive;
const both = (a, b) => q => a(q) && b(q);
const regNote = (S, ids) => {
  const ps = ids.map(id => P(S, id)).filter(Boolean), out = [];
  if (ps.some(q => q.role === 'recluse')) out.push('Среди выбранных Затворник: может определиться злым, Приспешником или Демоном — решите сами.');
  if (ps.some(q => q.role === 'spy')) out.push('Среди выбранных Шпион: может определиться добрым, Горожанином или Изгоем — решите сами.');
  return out;
};
// случайное значение, закреплённое на эту ночь (чтобы подсказки не менялись при перерисовке)
function stable(S, key, fn) { const d = S.night.data; if (!(key in d)) d[key] = fn(); return d[key]; }
const once = (S, p, key) => S.flags[key + '_' + p.id];
const markOnce = (S, p, key) => { S.flags[key + '_' + p.id] = true; };
const scriptRoles = (S, f) => S.script.roles.filter(r => R(r) && (!f || f(r)));

function demonKill(S, p, off, t, inp, cause) {
  if (off) { log(S, `${rname(p.role)} выбирает ${t.name} — способность не работает`, 'action'); return; }
  let target = t;
  if (t.role === 'mayor' && !abilityOff(S, t) && inp.bounce && inp.bounce !== t.id) {
    target = P(S, inp.bounce); log(S, `Мэр: вместо ${t.name} умирает ${target.name}`, 'effect');
  }
  log(S, `${rname(p.role)} (${p.name}) атакует ${t.name}`, 'action');
  return attemptKill(S, target, cause || 'demon', p.role);
}
function mayorInput(S, inp) {
  const t = inp.t && P(S, inp.t[0]);
  if (t && t.role === 'mayor' && !abilityOff(S, t)) return [PL('bounce', 1, 'Мэр: кто умрёт вместо него? (не выбирать — умрёт Мэр)', aliveOnly)];
  return [];
}
function demonExorcised(S, p, base) {
  if (S.night.data.exorcised === p.id) { base.active = false; base.reason = 'Экзорцист выбрал Демона: он не просыпается этой ночью'; return true; }
  return false;
}

function genericLogic(S, p, first, off) {
  return {
    inputs: [PL('t', 2, 'Выбор игрока (если есть)', () => true, { min: 0 })],
    apply: inp => log(S, `${rname(p.role === 'drunk' ? p.believes : p.role)} (${p.name})${inp.t && inp.t.length ? ' выбирает: ' + inp.t.map(id => nm(S, id)).join(', ') : ''}`, 'action'),
  };
}

function infoPair(team) {
  return (S, p, first, off) => {
    const cands = S.players.filter(q => q.id !== p.id && realTeam(q) === team);
    const def = stable(S, `pair:${team}:${p.id}`, () => {
      const real = cands.length ? pick(cands) : null;
      const others = S.players.filter(q => q.id !== p.id && q !== real);
      return real ? { t: shuffle([real.id, pick(others).id]), r: real.role, none: '' } : { t: [], r: null, none: team === 'outsider' ? 'yes' : '' };
    });
    const inputs = [PL('t', 2, 'Укажите на 2 игроков', notSelf(p)), ROLE('r', 'Жетон роли', r => R(r).team === team)];
    if (team === 'outsider') inputs.push(CHOICE('none', 'Показать «Изгоев нет» (0)', [{ v: '', l: 'Нет' }, { v: 'yes', l: 'Да' }]));
    return {
      inputs, defaults: def,
      info: inp => {
        if (inp.none === 'yes') return { show: '0 — Изгоев в игре нет', lines: [cands.length ? 'Внимание: Изгои в игре есть — это ложь' : 'Верно'] };
        const ps = (inp.t || []).map(id => P(S, id));
        const ok = inp.r && ps.some(q => q && q.role === inp.r);
        return { show: `${rname(inp.r)}: ${ps.map(q => q && q.name).join(' и ')}`, lines: [ok ? 'Информация верная' : 'Информация ложная', ...regNote(S, inp.t || [])] };
      },
      apply: inp => log(S, `${rname(p.role === 'drunk' ? p.believes : p.role)} (${p.name}): ${inp.none === 'yes' ? 'Изгоев нет' : `${rname(inp.r)} — ${(inp.t || []).map(id => nm(S, id)).join(' или ')}`}`, 'info'),
    };
  };
}

function countInfo(compute, label) {
  return (S, p, first, off) => ({
    info: () => { const r = compute(S, p); return { show: String(r.n), lines: [label, ...(r.lines || [])] }; },
    apply: () => { const r = compute(S, p); log(S, `${rname(actsAs(p))} (${p.name}): ${r.n}${off ? ' (способность не работает)' : ''}`, 'info'); },
  });
}

const LOGIC = {
  /* --- Trouble Brewing */
  washerwoman: infoPair('townsfolk'),
  librarian: infoPair('outsider'),
  investigator: infoPair('minion'),
  chef: countInfo((S) => {
    const ps = S.players, n = ps.length; let c = 0;
    for (let i = 0; i < n; i++) if (ps[i].align === 'evil' && ps[(i + 1) % n].align === 'evil') c++;
    return { n: c, lines: regNote(S, ps.map(q => q.id)) };
  }, 'Пар соседей-злодеев (покажите пальцами)'),
  empath: countInfo((S, p) => {
    const nb = aliveNeighbours(S, p);
    return { n: nb.filter(q => q.align === 'evil').length, lines: [`Соседи: ${nb.map(q => q.name).join(' и ')}`, ...regNote(S, nb.map(q => q.id))] };
  }, 'Злых среди живых соседей'),
  fortuneteller: (S, p, first, off) => ({
    inputs: [PL('t', 2, 'Гадалка выбирает 2 игроков')],
    info: inp => {
      const ps = (inp.t || []).map(id => P(S, id));
      if (ps.length < 2) return null;
      const yes = ps.some(q => q && (isDemon(q) || q.id === S.flags.ftHerring));
      return { show: yes ? 'ДА — кивните' : 'НЕТ — покачайте головой', lines: [`Ложная цель: ${nm(S, S.flags.ftHerring)}`, ...regNote(S, inp.t || [])] };
    },
    apply: inp => log(S, `Гадалка (${p.name}) проверяет ${(inp.t || []).map(id => nm(S, id)).join(' и ')}`, 'info'),
  }),
  undertaker: (S, p, first, off) => {
    const ex = S.day && S.day.executionDeath && P(S, S.day.executionDeath);
    if (!ex) return { active: false, reason: 'Сегодня днём никто не умер от казни' };
    return { info: () => ({ show: `Роль казнённого: ${rname(ex.role)}`, lines: [ex.name] }),
      apply: () => log(S, `Гробовщик (${p.name}) узнаёт: ${ex.name} — ${rname(ex.role)}`, 'info') };
  },
  monk: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Кого защищает Монах', both(notSelf(p), aliveOnly))],
    apply: inp => { const t = P(S, inp.t[0]); if (!off) addTok(S, t, 'protected', 'monk', ['dawn', S.n]); log(S, `Монах (${p.name}) защищает ${t.name}${off ? ' — не работает' : ''}`, 'action'); },
  }),
  ravenkeeper: (S, p, first, off) => {
    if (S.flags.ravenWake !== p.id || !S.night.deaths.some(d => d.pid === p.id)) return { active: false, reason: 'Смотритель не умер этой ночью', deadOk: true };
    return { deadOk: true, inputs: [PL('t', 1, 'Чью роль узнать')],
      info: inp => { const t = inp.t && P(S, inp.t[0]); return t ? { show: rname(t.role), lines: regNote(S, [t.id]) } : null; },
      apply: inp => { log(S, `Смотритель воронов (${p.name}) узнаёт роль ${nm(S, inp.t[0])}: ${rname(P(S, inp.t[0]).role)}`, 'info'); S.flags.ravenWake = null; } };
  },
  butler: (S, p) => ({
    inputs: [PL('t', 1, 'Хозяин Дворецкого', notSelf(p))],
    apply: inp => { S.players.forEach(q => rmTok(q, 'master', 'butler')); addTok(S, P(S, inp.t[0]), 'master', 'butler'); log(S, `Дворецкий (${p.name}) выбирает хозяина: ${nm(S, inp.t[0])}`, 'action'); },
  }),
  poisoner: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Кого отравить')],
    apply: inp => { const t = P(S, inp.t[0]); if (!off) addTok(S, t, 'poisoned', 'poisoner', ['dusk', S.n + 1]); log(S, `Отравитель (${p.name}) травит ${t.name}${off ? ' — не работает' : ''}`, 'action'); },
  }),
  spy: (S, p) => ({ info: () => ({ show: 'Покажите Гримуар', lines: [] }), apply: () => log(S, `Шпион (${p.name}) смотрит Гримуар`, 'info') }),
  scarletwoman: (S, p) => {
    if (S.flags.swBecame !== p.id) return { active: false, reason: 'Блудница не становилась Демоном' };
    return { apply: () => log(S, `${p.name} узнаёт, что теперь Демон (${rname(p.role)})`, 'info') };
  },
  imp: (S, p, first, off, base) => {
    if (demonExorcised(S, p, base)) return {};
    return {
      inputs: [PL('t', 1, 'Кого убивает Чёрт')],
      more: inp => {
        const t = inp.t && P(S, inp.t[0]);
        if (t && t.id === p.id) return [PL('heir', 1, 'Кто из Приспешников станет Чёртом', q => q.alive && realTeam(q) === 'minion')];
        return mayorInput(S, inp);
      },
      defaults: (() => { const h = S.players.find(q => q.alive && q.role === 'scarletwoman') || S.players.find(q => q.alive && realTeam(q) === 'minion'); return { heir: h ? [h.id] : [] }; })(),
      info: inp => {
        const t = inp.t && P(S, inp.t[0]);
        if (t && t.id === p.id) return { show: 'Чёрт убивает себя', lines: ['Выбранный Приспешник станет Чёртом: разбудите его, покажите «ТЕПЕРЬ ВЫ» и жетон Чёрта'] };
        return null;
      },
      apply: inp => {
        const t = P(S, inp.t[0]);
        if (t.id === p.id && !off) {
          const heir = inp.heir && inp.heir[0] && P(S, inp.heir[0]);
          log(S, `Чёрт (${p.name}) убивает себя`, 'action');
          const r = attemptKill(S, p, 'demon', 'imp', { noScarlet: true, noCheck: true });
          if (r.died && heir) { heir.role = 'imp'; log(S, `${heir.name} становится Чёртом`, 'effect'); checkWin(S); }
          else if (r.died) checkWin(S);
          return;
        }
        demonKill(S, p, off, t, inp);
      },
    };
  },

  /* --- Bad Moon Rising */
  grandmother: (S, p, first) => {
    if (!first) return { active: false, reason: 'Срабатывает сама: если Демон убьёт внука, Бабушка умрёт (приложение отметит)' };
    return { inputs: [PL('t', 1, 'Внук (добрый игрок)', q => q.id !== p.id)], defaults: { t: S.flags.grandchild ? [S.flags.grandchild] : [] },
      info: inp => { const t = inp.t && P(S, inp.t[0]); return t ? { show: `${t.name} — ${rname(t.role)}`, lines: t.align === 'good' ? [] : ['Внимание: внук должен быть добрым'] } : null; },
      apply: inp => { S.players.forEach(q => rmTok(q, 'grandchild')); S.flags.grandchild = inp.t[0]; addTok(S, P(S, inp.t[0]), 'grandchild', 'grandmother'); log(S, `Бабушка (${p.name}) узнаёт внука: ${nm(S, inp.t[0])} — ${rname(P(S, inp.t[0]).role)}`, 'info'); } };
  },
  sailor: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Моряк выбирает живого игрока', aliveOnly), CHOICE('who', 'Кто пьян до заката', [{ v: 'target', l: 'Выбранный' }, { v: 'self', l: 'Сам Моряк' }])],
    defaults: { who: 'target' },
    apply: inp => { const t = P(S, inp.t[0]); if (!off) addTok(S, inp.who === 'self' ? p : t, 'drunk', 'sailor', ['dusk', S.n + 1]); log(S, `Моряк (${p.name}) выбирает ${t.name}; пьян: ${inp.who === 'self' ? p.name : t.name}`, 'action'); },
  }),
  chambermaid: (S, p) => ({
    inputs: [PL('t', 2, 'Горничная выбирает 2 живых игроков', both(aliveOnly, notSelf(p)))],
    info: inp => { const c = (inp.t || []).filter(id => S.night.woke.includes(id)).length; return { show: String(c), lines: ['Сколько из них просыпались этой ночью из-за своей способности (на этот момент)'] }; },
    apply: inp => log(S, `Горничная (${p.name}) проверяет ${(inp.t || []).map(id => nm(S, id)).join(' и ')}`, 'info'),
  }),
  exorcist: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Экзорцист выбирает игрока (не того же, что прошлой ночью)', q => q.id !== S.flags['exorcistLast_' + p.id])],
    info: inp => { const t = inp.t && P(S, inp.t[0]); return t && isDemon(t) ? { show: 'Это Демон', lines: ['Разбудите Демона, покажите жетон Экзорциста и укажите на Экзорциста. Демон не просыпается этой ночью.'] } : null; },
    apply: inp => { const t = P(S, inp.t[0]); S.flags['exorcistLast_' + p.id] = t.id; if (!off && isDemon(t)) S.night.data.exorcised = t.id; log(S, `Экзорцист (${p.name}) выбирает ${t.name}`, 'action'); },
  }),
  innkeeper: (S, p, first, off) => ({
    inputs: [PL('t', 2, 'Трактирщик выбирает 2 игроков'), CHOICE('drunk', 'Кто из них пьян до заката', [{ v: '0', l: 'Первый' }, { v: '1', l: 'Второй' }])],
    defaults: { drunk: '0' },
    apply: inp => { const ts = inp.t.map(id => P(S, id)); if (!off) { ts.forEach(t => addTok(S, t, 'protected', 'innkeeper', ['dawn', S.n])); addTok(S, ts[+inp.drunk] || ts[0], 'drunk', 'innkeeper', ['dusk', S.n + 1]); } log(S, `Трактирщик (${p.name}) защищает ${ts.map(t => t.name).join(' и ')}`, 'action'); },
  }),
  gambler: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Азартный игрок выбирает игрока'), ROLE('r', 'и угадывает роль', r => true, { all: true })],
    info: inp => { const t = inp.t && P(S, inp.t[0]); if (!t || !inp.r) return null; const ok = t.role === inp.r; return { show: ok ? 'Угадал' : 'Не угадал', lines: [ok ? '' : off ? 'Способность не работает — не умирает' : 'Азартный игрок умрёт'] }; },
    apply: inp => { const t = P(S, inp.t[0]); log(S, `Азартный игрок (${p.name}): ${t.name} — ${rname(inp.r)}?`, 'action'); if (t.role !== inp.r && !off) attemptKill(S, p, 'ability', 'gambler'); },
  }),
  gossip: (S, p, first, off) => ({
    inputs: [CHOICE('true', 'Утверждение Сплетника днём было правдой?', [{ v: 'no', l: 'Нет' }, { v: 'yes', l: 'Да' }]), PL('t', 1, 'Если да — кто умирает', aliveOnly, { min: 0 })],
    defaults: { true: 'no' },
    apply: inp => { if (inp.true === 'yes' && !off && inp.t && inp.t[0]) { log(S, 'Сплетник сказал правду', 'effect'); attemptKill(S, P(S, inp.t[0]), 'ability', 'gossip'); } },
  }),
  courtier: (S, p, first, off) => {
    if (once(S, p, 'courtier')) return { active: false, reason: 'Способность уже использована' };
    return { inputs: [ROLE('r', 'Придворный выбирает роль (можно пропустить)', () => true, { optional: true })],
      info: inp => { if (!inp.r) return null; const h = holders(S, inp.r); return { show: h.length ? `${h.map(q => q.name).join(', ')} пьян на 3 ночи и 3 дня` : 'Этой роли нет в игре', lines: [] }; },
      apply: inp => { if (!inp.r) return; markOnce(S, p, 'courtier'); log(S, `Придворный (${p.name}) выбирает роль: ${rname(inp.r)}`, 'action'); if (!off) holders(S, inp.r).forEach(q => addTok(S, q, 'drunk', 'courtier', ['dusk', S.n + 3])); } };
  },
  professor: (S, p, first, off) => {
    if (once(S, p, 'professor')) return { active: false, reason: 'Способность уже использована' };
    return { inputs: [PL('t', 1, 'Профессор выбирает мёртвого (можно пропустить)', q => !q.alive, { min: 0 })],
      apply: inp => { if (!inp.t || !inp.t[0]) return; markOnce(S, p, 'professor'); const t = P(S, inp.t[0]); if (!off && realTeam(t) === 'townsfolk') { t.alive = true; log(S, `Профессор воскрешает ${t.name}`, 'effect'); } else log(S, `Профессор выбирает ${t.name} — ничего не происходит`, 'action'); } };
  },
  moonchild: (S, p) => {
    const t = S.flags.moonchildTarget && P(S, S.flags.moonchildTarget);
    if (!t) return { active: false, reason: 'Дитя Луны никого не выбирало', deadOk: true };
    return { deadOk: true, info: () => ({ show: t.align === 'good' ? `${t.name} — добрый, умирает` : `${t.name} — злой, ничего`, lines: [] }),
      apply: () => { S.flags.moonchildTarget = null; if (t.align === 'good') attemptKill(S, t, 'ability', 'moonchild'); } };
  },
  godfather: (S, p, first, off) => {
    if (first) {
      const outs = S.players.filter(q => realTeam(q) === 'outsider').map(q => rname(q.role));
      return { info: () => ({ show: outs.length ? outs.join(', ') : 'Изгоев нет', lines: ['Покажите жетоны Изгоев в игре'] }), apply: () => log(S, `Крёстный Отец (${p.name}) узнаёт Изгоев: ${outs.join(', ') || 'нет'}`, 'info') };
    }
    if (!S.day || !S.day.outsiderDied) return { active: false, reason: 'Днём не умирал Изгой' };
    return { inputs: [PL('t', 1, 'Кого убивает Крёстный Отец', aliveOnly)],
      apply: inp => { log(S, `Крёстный Отец (${p.name}) выбирает ${nm(S, inp.t[0])}`, 'action'); if (!off) attemptKill(S, P(S, inp.t[0]), 'minion', 'godfather'); } };
  },
  devilsadvocate: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Кого защищает от казни (не того же, что прошлой ночью)', q => q.alive && q.id !== S.flags['daLast_' + p.id])],
    apply: inp => { const t = P(S, inp.t[0]); S.flags['daLast_' + p.id] = t.id; if (!off) addTok(S, t, 'safe', 'devilsadvocate', ['dusk', S.n + 1]); log(S, `Адвокат Дьявола (${p.name}) защищает ${t.name}`, 'action'); },
  }),
  assassin: (S, p, first, off) => {
    if (once(S, p, 'assassin')) return { active: false, reason: 'Способность уже использована' };
    return { inputs: [PL('t', 1, 'Ассасин выбирает (можно пропустить)', aliveOnly, { min: 0 })],
      apply: inp => { if (!inp.t || !inp.t[0]) return; markOnce(S, p, 'assassin'); log(S, `Ассасин (${p.name}) выбирает ${nm(S, inp.t[0])}`, 'action'); if (!off) attemptKill(S, P(S, inp.t[0]), 'unstoppable', 'assassin'); } };
  },
  zombuul: (S, p, first, off, base) => {
    if (demonExorcised(S, p, base)) return {};
    if (S.day && S.day.deaths && S.day.deaths.length) return { active: false, reason: 'Сегодня днём кто-то умер — Зомбуул не убивает', deadOk: true };
    return { deadOk: !!p.secretlyAlive, inputs: [PL('t', 1, 'Кого убивает Зомбуул')], more: inp => mayorInput(S, inp), apply: inp => demonKill(S, p, off, P(S, inp.t[0]), inp) };
  },
  pukka: (S, p, first, off, base) => {
    if (demonExorcised(S, p, base)) return {};
    const prev = S.flags.pukkaPrev && P(S, S.flags.pukkaPrev);
    return {
      inputs: [PL('t', 1, 'Кого отравляет Пукка')],
      info: () => prev && !first ? { show: `Умирает отравленный прошлой ночью: ${prev.name}`, lines: [] } : null,
      apply: inp => {
        const t = P(S, inp.t[0]);
        log(S, `Пукка (${p.name}) отравляет ${t.name}${off ? ' — не работает' : ''}`, 'action');
        if (off) return;
        if (prev && prev.alive && !first) { rmTok(prev, 'poisoned', 'pukka'); attemptKill(S, prev, 'demon', 'pukka'); }
        if (prev) rmTok(prev, 'poisoned', 'pukka');
        addTok(S, t, 'poisoned', 'pukka'); S.flags.pukkaPrev = t.id;
      },
    };
  },
  shabaloth: (S, p, first, off, base) => {
    if (demonExorcised(S, p, base)) return {};
    return { inputs: [PL('t', 2, 'Кого убивает Шабалот'), PL('back', 1, 'Отрыгнуть (вернуть к жизни) одного из убитых прошлой ночью — по желанию', q => !q.alive, { min: 0 })],
      apply: inp => { if (inp.back && inp.back[0] && !off) { P(S, inp.back[0]).alive = true; log(S, `Шабалот отрыгивает ${nm(S, inp.back[0])}: снова жив`, 'effect'); } inp.t.forEach(id => demonKill(S, p, off, P(S, id), {})); } };
  },
  po: (S, p, first, off, base) => {
    if (demonExorcised(S, p, base)) return {};
    const charged = S.flags.poCharged;
    return { inputs: [PL('t', charged ? 3 : 1, charged ? 'По атакует троих' : 'По выбирает игрока (или никого — тогда в следующий раз троих)', () => true, { min: 0 })],
      info: inp => (!inp.t || !inp.t.length) && !charged ? { show: 'Никого', lines: ['В следующую ночь По атакует троих'] } : null,
      apply: inp => { if (!inp.t || !inp.t.length) { S.flags.poCharged = !off || S.flags.poCharged; log(S, `По (${p.name}) никого не выбирает`, 'action'); return; } S.flags.poCharged = false; inp.t.forEach(id => demonKill(S, p, off, P(S, id), {})); } };
  },
  /* --- Sects & Violets */
  clockmaker: countInfo((S) => {
    const ps = S.players, n = ps.length, d = ps.findIndex(isDemon); if (d < 0) return { n: '—' };
    let best = n;
    ps.forEach((q, i) => { if (realTeam(q) === 'minion') { const k = Math.abs(i - d); best = Math.min(best, k, n - k); } });
    return { n: best === n ? '—' : best, lines: regNote(S, ps.map(q => q.id)) };
  }, 'Шагов от Демона до ближайшего Приспешника'),
  dreamer: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Сновидец выбирает игрока', notSelf(p))],
    info: inp => {
      const t = inp.t && P(S, inp.t[0]); if (!t) return null;
      const goodSide = isGoodTeam(realTeam(t));
      const fake = stable(S, `dream:${p.id}:${t.id}`, () => pick(scriptRoles(S, r => isGoodTeam(R(r).team) !== goodSide && r !== t.role)) || null);
      return { show: `${rname(t.role)} или ${rname(fake)}`, lines: ['Покажите 1 добрую и 1 злую роль, одна из них — его', ...regNote(S, [t.id])] };
    },
    apply: inp => log(S, `Сновидец (${p.name}) смотрит на ${nm(S, inp.t[0])}`, 'info'),
  }),
  snakecharmer: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Заклинатель змей выбирает живого игрока', both(aliveOnly, notSelf(p)))],
    info: inp => { const t = inp.t && P(S, inp.t[0]); return t && isDemon(t) && !off ? { show: 'Это Демон — обмен!', lines: ['Заклинатель становится Демоном (злым), Демон — Заклинателем (добрым) и отравлен навсегда. Разбудите обоих и покажите «ТЕПЕРЬ ВЫ».'] } : null; },
    apply: inp => { const t = P(S, inp.t[0]); log(S, `Заклинатель змей (${p.name}) выбирает ${t.name}`, 'action'); if (!off && isDemon(t)) { const dr = t.role; t.role = 'snakecharmer'; t.align = 'good'; p.role = dr; p.align = 'evil'; addTok(S, t, 'poisoned', 'snakecharmer'); log(S, `Обмен: ${p.name} теперь ${rname(dr)}, ${t.name} — Заклинатель змей`, 'effect'); } },
  }),
  mathematician: (S, p) => ({
    inputs: [NUM('c', 'Сколько игроков сработали неправильно из-за чужих способностей')],
    defaults: { c: S.players.filter(q => q.id !== p.id && abilityOff(S, q) && (q.alive || S.night.deaths.some(d => d.pid === q.id))).length },
    info: inp => ({ show: String(inp.c ?? 0), lines: ['Подсказка — число пьяных/отравленных игроков с активной способностью; уточните сами'] }),
    apply: inp => log(S, `Математик (${p.name}): ${inp.c}`, 'info'),
  }),
  flowergirl: (S, p) => ({ info: () => ({ show: S.day && S.day.demonVoted ? 'ДА — Демон голосовал' : 'НЕТ — Демон не голосовал', lines: [] }), apply: () => log(S, `Цветочница (${p.name}): ${S.day && S.day.demonVoted ? 'да' : 'нет'}`, 'info') }),
  towncrier: (S, p) => ({ info: () => ({ show: S.day && S.day.minionNominated ? 'ДА — Приспешник номинировал' : 'НЕТ', lines: [] }), apply: () => log(S, `Глашатай (${p.name}): ${S.day && S.day.minionNominated ? 'да' : 'нет'}`, 'info') }),
  oracle: countInfo(S => ({ n: S.players.filter(q => !q.alive && q.align === 'evil').length }), 'Мёртвых злых игроков'),
  seamstress: (S, p, first, off) => {
    if (once(S, p, 'seamstress')) return { active: false, reason: 'Способность уже использована' };
    return { inputs: [PL('t', 2, 'Швея выбирает 2 игроков (можно пропустить)', notSelf(p), { min: 0 })],
      info: inp => { const ps = (inp.t || []).map(id => P(S, id)); if (ps.length < 2) return null; const same = ps[0].align === ps[1].align; return { show: same ? 'ДА — одна сторона' : 'НЕТ — разные стороны', lines: regNote(S, inp.t) }; },
      apply: inp => { if (!inp.t || inp.t.length < 2) return; markOnce(S, p, 'seamstress'); log(S, `Швея (${p.name}) проверяет ${inp.t.map(id => nm(S, id)).join(' и ')}`, 'info'); } };
  },
  philosopher: (S, p, first, off) => {
    if (once(S, p, 'philosopher')) return { active: false, reason: 'Способность уже использована' };
    return { inputs: [ROLE('r', 'Философ выбирает добрую роль (можно пропустить)', r => isGoodTeam(R(r).team), { optional: true, all: true })],
      apply: inp => { if (!inp.r) return; markOnce(S, p, 'philosopher'); if (off) { log(S, `Философ (${p.name}) выбирает ${rname(inp.r)} — не работает`, 'action'); return; } p.gained = inp.r; holders(S, inp.r).forEach(q => addTok(S, q, 'drunk', 'philosopher')); log(S, `Философ (${p.name}) получает способность: ${rname(inp.r)}`, 'effect'); rebuildRest(S); } };
  },
  juggler: (S, p) => {
    if (S.n !== 2) return { active: false, reason: 'Жонглёр узнаёт результат только после 1-го дня' };
    const g = S.flags.jugglerGuesses || [];
    const c = g.filter(x => P(S, x.pid) && P(S, x.pid).role === x.role).length;
    return { info: () => ({ show: String(c), lines: [`Догадок: ${g.length}`] }), apply: () => log(S, `Жонглёр (${p.name}): верных ${c}`, 'info') };
  },
  sage: (S, p) => {
    if (S.flags.sageWake !== p.id) return { active: false, reason: 'Мудреца не убивал Демон', deadOk: true };
    const def = stable(S, `sage:${p.id}`, () => {
      const d = S.players.find(isDemon), other = pick(S.players.filter(q => q !== d && q !== p));
      return shuffle([d && d.id, other && other.id].filter(Boolean));
    });
    return { deadOk: true, inputs: [PL('t', 2, 'Покажите 2 игроков, один — Демон')], defaults: { t: def },
      apply: inp => { S.flags.sageWake = null; log(S, `Мудрец (${p.name}) узнаёт: ${inp.t.map(id => nm(S, id)).join(' или ')}`, 'info'); } };
  },
  barber: (S, p) => {
    if (!S.flags.haircuts) return { active: false, reason: 'Цирюльник не умирал', deadOk: true };
    return { deadOk: true, text: (DATA.roles.barber.other || ''),
      inputs: [PL('t', 2, 'Демон выбирает 2 игроков для обмена ролями (можно отказаться)', q => !(isDemon(q) && S.players.filter(isDemon).length > 1 && q !== S.players.find(isDemon)), { min: 0 })],
      apply: inp => { S.flags.haircuts = false; if (!inp.t || inp.t.length < 2) { log(S, 'Цирюльник: Демон отказался менять роли', 'action'); return; } const [a, b] = inp.t.map(id => P(S, id)); [a.role, b.role] = [b.role, a.role]; log(S, `Цирюльник: ${a.name} и ${b.name} меняются ролями (${rname(a.role)} ↔ ${rname(b.role)}), стороны прежние`, 'effect'); } };
  },
  sweetheart: (S, p) => {
    if (S.flags.sweetheartPending !== p.id) return { active: false, reason: 'Возлюбленная не умирала', deadOk: true };
    return { deadOk: true, inputs: [PL('t', 1, 'Кто становится пьяным навсегда')],
      apply: inp => { S.flags.sweetheartPending = null; addTok(S, P(S, inp.t[0]), 'drunk', 'sweetheart'); log(S, `Возлюбленная: ${nm(S, inp.t[0])} пьян до конца игры`, 'effect'); } };
  },
  eviltwin: (S, p, first) => ({
    inputs: [PL('t', 1, 'Добрый близнец', q => q.align !== p.align)], defaults: { t: S.flags.goodTwin ? [S.flags.goodTwin] : [] },
    info: inp => { const t = inp.t && P(S, inp.t[0]); return t ? { show: `Близнецы: ${p.name} и ${t.name}`, lines: [`Покажите ${p.name} роль ${rname(t.role)}, а ${t.name} — роль Злого Близнеца`] } : null; },
    apply: inp => { S.players.forEach(q => rmTok(q, 'twin')); S.flags.goodTwin = inp.t[0]; addTok(S, P(S, inp.t[0]), 'twin', 'eviltwin'); log(S, `Близнецы узнают друг друга: ${p.name} и ${nm(S, inp.t[0])}`, 'info'); },
  }),
  witch: (S, p, first, off) => {
    if (aliveCount(S) <= 3) return { active: false, reason: 'В живых 3 игрока — Ведьма теряет способность' };
    return { inputs: [PL('t', 1, 'Кого проклинает Ведьма', aliveOnly)],
      apply: inp => { const t = P(S, inp.t[0]); if (!off) addTok(S, t, 'cursed', 'witch', ['dusk', S.n + 1]); log(S, `Ведьма (${p.name}) проклинает ${t.name}`, 'action'); } };
  },
  cerenovus: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Церенов выбирает игрока'), ROLE('r', 'и добрую роль', r => isGoodTeam(R(r).team), { all: true })],
    apply: inp => { const t = P(S, inp.t[0]); if (!off) addTok(S, t, 'mad', 'cerenovus', ['dusk', S.n + 1], { note: rname(inp.r) }); log(S, `Церенов (${p.name}): ${t.name} должен быть помешан на роли «${rname(inp.r)}»`, 'action'); },
  }),
  pithag: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Ведьма-Яга выбирает игрока'), ROLE('r', 'и роль, которой нет в игре', r => !inPlay(S, r), { all: true })],
    more: inp => inp.r && R(inp.r).team === 'demon' && !off ? [PL('kill', 20, 'Создан Демон: кто умирает этой ночью (ваше решение, можно никого)', aliveOnly, { min: 0 })] : [],
    info: inp => inp.r && R(inp.r).team === 'demon' ? { show: 'Создан Демон', lines: ['Смерти этой ночью — на ваше усмотрение'] } : null,
    apply: inp => {
      const t = P(S, inp.t[0]);
      if (off || inPlay(S, inp.r)) { log(S, `Ведьма-Яга (${p.name}) выбирает ${t.name} — ничего`, 'action'); return; }
      const old = t.role; t.role = inp.r; log(S, `Ведьма-Яга превращает ${t.name}: ${rname(old)} → ${rname(inp.r)} (сторона прежняя)`, 'effect');
      (inp.kill || []).forEach(id => attemptKill(S, P(S, id), 'ability', 'pithag'));
    },
  }),
  fanggu: (S, p, first, off, base) => {
    if (demonExorcised(S, p, base)) return {};
    return {
      inputs: [PL('t', 1, 'Кого убивает Фань Гу')], more: inp => mayorInput(S, inp),
      info: inp => { const t = inp.t && P(S, inp.t[0]); return t && realTeam(t) === 'outsider' && !S.flags.fangguJumped && !off ? { show: 'Изгой: прыжок!', lines: [`${t.name} становится злым Фань Гу, старый Фань Гу (${p.name}) умирает. Разбудите ${t.name}: «ТЕПЕРЬ ВЫ», жетон Фань Гу, «ТЕПЕРЬ ВЫ», большой палец вниз.`] } : null; },
      apply: inp => {
        const t = P(S, inp.t[0]);
        if (!off && realTeam(t) === 'outsider' && !S.flags.fangguJumped && t.alive) {
          S.flags.fangguJumped = true;
          log(S, `Фань Гу (${p.name}) выбирает Изгоя ${t.name}: прыжок`, 'action');
          t.role = 'fanggu'; t.align = 'evil';
          die(S, p, 'ability', 'fanggu', { noScarlet: true });
          return;
        }
        demonKill(S, p, off, t, inp);
      },
    };
  },
  vigormortis: (S, p, first, off, base) => {
    if (demonExorcised(S, p, base)) return {};
    return {
      inputs: [PL('t', 1, 'Кого убивает Вигормортис')],
      more: inp => { const t = inp.t && P(S, inp.t[0]); return t && realTeam(t) === 'minion' ? [PL('nb', 1, 'Какой сосед-Горожанин отравлен', q => townsfolkNeighbours(S, t).includes(q))] : mayorInput(S, inp); },
      apply: inp => { const t = P(S, inp.t[0]); const r = demonKill(S, p, off, t, inp); if (r && r.died && realTeam(t) === 'minion') { addTok(S, t, 'hasability', 'vigormortis'); if (inp.nb && inp.nb[0]) addTok(S, P(S, inp.nb[0]), 'poisoned', 'vigormortis'); log(S, `${t.name} сохраняет способность`, 'effect'); } },
    };
  },
  nodashii: (S, p, first, off, base) => {
    if (demonExorcised(S, p, base)) return {};
    const nb = townsfolkNeighbours(S, p);
    return { inputs: [PL('t', 1, 'Кого убивает Но Даши')], more: inp => mayorInput(S, inp),
      info: () => ({ show: null, lines: [`Отравлены соседи-Горожане: ${nb.map(q => q.name).join(' и ') || '—'}`] }),
      apply: inp => demonKill(S, p, off, P(S, inp.t[0]), inp) };
  },
  vortox: (S, p, first, off, base) => {
    if (demonExorcised(S, p, base)) return {};
    return { inputs: [PL('t', 1, 'Кого убивает Вортокс')], more: inp => mayorInput(S, inp), apply: inp => demonKill(S, p, off, P(S, inp.t[0]), inp) };
  },
  lunatic: (S, p, first) => {
    if (first) return { info: () => ({ show: 'Лунатик считает себя Демоном', lines: [`Его «блефы» и «приспешники» — на ваш выбор`] }), apply: () => log(S, `Лунатик (${p.name}) узнаёт, что он «Демон»`, 'info') };
    return { inputs: [PL('t', 3, 'Кого «атакует» Лунатик', () => true, { min: 0 })],
      apply: inp => { S.night.data.lunatic = inp.t || []; log(S, `Лунатик (${p.name}) «атакует»: ${(inp.t || []).map(id => nm(S, id)).join(', ') || 'никого'}`, 'action'); } };
  },

  /* --- не из базовой коробки: роли сценария Catfishing (Carousel) */
  widow: (S, p, first, off) => {
    if (once(S, p, 'widow')) return { active: false, reason: 'Вдова действует только в свою 1-ю ночь' };
    const goodOk = q => q.align === 'good' && q.id !== p.id, good = S.players.filter(goodOk);
    return {
      inputs: [PL('t', 1, 'Кого отравляет Вдова (посмотрев Гримуар)'), PL('know', 1, 'Добрый игрок, который узнаёт, что Вдова в игре', goodOk)],
      defaults: stable(S, 'widowKnow:' + p.id, () => ({ know: good.length ? [pick(good).id] : [] })),
      info: inp => { const k = inp.know && P(S, inp.know[0]); return { show: 'Покажите Вдове Гримуар', lines: [k ? `Затем разбудите ${k.name} и покажите жетон Вдовы` : ''] }; },
      apply: inp => {
        markOnce(S, p, 'widow');
        const t = P(S, inp.t[0]), k = P(S, inp.know[0]);
        if (!off) addTok(S, t, 'poisoned', 'widow');
        addTok(S, k, 'know', 'widow');
        log(S, `Вдова (${p.name}) смотрит Гримуар и травит ${t.name}${off ? ' — не работает' : ''}; ${k.name} узнаёт, что Вдова в игре`, 'action');
      },
    };
  },
  balloonist: (S, p, first, off) => {
    const key = 'balloonLast_' + p.id, last = S.flags[key];
    const TYPES = ['townsfolk', 'outsider', 'minion', 'demon'];
    return {
      inputs: [PL('t', 1, last ? 'Покажите игрока другого типа, чем прошлой ночью' : 'Покажите любого игрока')],
      more: inp => { const t = inp.t && P(S, inp.t[0]); return t && (t.role === 'recluse' || t.role === 'spy') ? [Object.assign(CHOICE('reg', `Каким типом определяется ${t.name} (ваше решение; не выбрали — настоящим)`, TYPES.map(v => ({ v, l: TEAM_RU[v] }))), { optional: true })] : []; },
      defaults: stable(S, 'balloon:' + p.id, () => {
        const c = S.players.filter(q => q.id !== p.id && (!last || realTeam(q) !== last.type));
        return { t: c.length ? [pick(c).id] : [] };
      }),
      info: inp => {
        const t = inp.t && P(S, inp.t[0]); if (!t) return null;
        const type = inp.reg || realTeam(t), same = last && type === last.type;
        return { show: t.name, lines: [`Тип роли: ${TEAM_RU[type] || type}`, last ? `Прошлой ночью: ${nm(S, last.pid)} — ${TEAM_RU[last.type] || last.type}` : '',
          same ? (off ? 'Тип тот же — можно: Аэронавт не трезв или не здоров' : 'Тип тот же, что прошлой ночью: трезвому и здоровому Аэронавту так нельзя') : ''] };
      },
      apply: inp => { const t = P(S, inp.t[0]); S.flags[key] = { pid: t.id, type: inp.reg || realTeam(t) }; log(S, `Аэронавт (${p.name}) узнаёт игрока: ${t.name}`, 'info'); },
    };
  },
  tinker: (S, p, first, off) => ({
    inputs: [CHOICE('die', 'Механик умирает этой ночью? (ваше решение)', [{ v: 'no', l: 'Нет' }, { v: 'yes', l: 'Да' }])], defaults: { die: 'no' },
    apply: inp => { if (inp.die !== 'yes') return; if (off) log(S, `Механик (${p.name}) мог бы умереть — способность не работает`, 'action'); else attemptKill(S, p, 'ability', 'tinker'); },
  }),

  /* --- Странники */
  harlot: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Куртизанка выбирает живого игрока', both(aliveOnly, notSelf(p))),
      CHOICE('yes', 'Выбранный согласился показать свою роль?', [{ v: 'no', l: 'Нет' }, { v: 'yes', l: 'Да' }])],
    defaults: { yes: 'no', die: 'no' },
    more: inp => inp.yes === 'yes' ? [CHOICE('die', 'Умирают оба? (ваше решение)', [{ v: 'no', l: 'Нет' }, { v: 'yes', l: 'Да, оба' }])] : [],
    info: inp => {
      const t = inp.t && P(S, inp.t[0]); if (!t) return null;
      if (inp.yes !== 'yes') return { show: 'Отказ — ничего не происходит', lines: [] };
      return { show: `Покажите Куртизанке жетон: ${rname(t.role)}`, lines: [isDemon(t) ? 'Это Демон: не убивайте обоих, если это закончит игру' : '', inp.die === 'yes' && off ? 'Куртизанка пьяна или отравлена — никто не умрёт' : ''] };
    },
    apply: inp => {
      const t = P(S, inp.t[0]);
      log(S, `Куртизанка (${p.name}) выбирает ${t.name}: ${inp.yes === 'yes' ? 'согласие, узнаёт роль ' + rname(t.role) : 'отказ'}`, 'action');
      if (inp.yes === 'yes' && inp.die === 'yes' && !off) { attemptKill(S, t, 'ability', 'harlot'); attemptKill(S, p, 'ability', 'harlot'); }
    },
  }),
  bureaucrat: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Бюрократ выбирает игрока', notSelf(p))],
    apply: inp => { const t = P(S, inp.t[0]); if (!off) addTok(S, t, 'votes3', 'bureaucrat', ['dusk', S.n + 1]); log(S, `Бюрократ (${p.name}): голос ${t.name} завтра считается за 3${off ? ' — не работает' : ''}`, 'action'); },
  }),
  thief: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Вор выбирает игрока', notSelf(p))],
    apply: inp => { const t = P(S, inp.t[0]); if (!off) addTok(S, t, 'voteneg', 'thief', ['dusk', S.n + 1]); log(S, `Вор (${p.name}): голос ${t.name} завтра считается против${off ? ' — не работает' : ''}`, 'action'); },
  }),
  barista: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Кого выбираете вы'), CHOICE('mode', 'Что с ним до заката', [{ v: 'sober', l: 'Трезв, здоров, верная информация' }, { v: 'twice', l: 'Способность дважды' }])],
    defaults: { mode: 'sober' },
    info: inp => { const t = inp.t && P(S, inp.t[0]); return t ? { show: inp.mode === 'twice' ? 'Два пальца' : 'Один палец', lines: [`Разбудите ${t.name}: жетон «ОБЛАДАТЕЛЬ ЭТОЙ РОЛИ ВЫБРАЛ ВАС», жетон Баристы, затем пальцы`] } : null; },
    apply: inp => {
      const t = P(S, inp.t[0]);
      S.players.forEach(q => { rmTok(q, 'sober', 'barista'); rmTok(q, 'twice', 'barista'); });
      log(S, `Бариста (${p.name}): ${t.name} — ${inp.mode === 'twice' ? 'способность дважды' : 'трезв и здоров'} до заката${off ? ' (Бариста не работает)' : ''}`, 'action');
      if (off) return;
      addTok(S, t, inp.mode === 'twice' ? 'twice' : 'sober', 'barista', ['dusk', S.n + 1]);
      if (inp.mode === 'twice') { // повторяем ещё не пройденный шаг этого игрока
        const k = S.night.steps.findIndex((s, j) => j > S.night.i && s.pid === t.id && !s.twice);
        if (k >= 0) S.night.steps.splice(k + 1, 0, Object.assign({}, S.night.steps[k], { key: S.night.steps[k].key + ':twice', twice: true }));
      }
    },
  }),
  bonecollector: (S, p, first, off) => {
    if (once(S, p, 'bonecollector')) return { active: false, reason: 'Способность уже использована' };
    return {
      inputs: [PL('t', 1, 'Собиратель Костей выбирает мёртвого (можно никого)', q => !q.alive, { min: 0 })],
      apply: inp => {
        const t = inp.t && inp.t[0] && P(S, inp.t[0]);
        if (!t) return;
        markOnce(S, p, 'bonecollector');
        log(S, `Собиратель Костей (${p.name}) выбирает ${t.name}${off ? ' — не работает' : `: способность «${rname(actsAs(t))}» вернулась до заката`}`, 'action');
        if (off) return;
        addTok(S, t, 'hasability', 'bonecollector', ['dusk', S.n + 1]);
        addFresh(S, t.id, actsAs(t)); rebuildRest(S);
      },
    };
  },
  apprentice: (S, p, first, off) => {
    const team = p.align === 'evil' ? 'minion' : 'townsfolk';
    return {
      inputs: [ROLE('r', `Способность ${team === 'minion' ? 'Приспешника (Ученик злой)' : 'Горожанина (Ученик добрый)'} — лучше роль не в игре`, r => R(r).team === team)],
      info: inp => inp.r ? { show: `Покажите «ТЕПЕРЬ ВЫ» и жетон: ${rname(inp.r)}`, lines: [] } : null,
      apply: inp => {
        markOnce(S, p, 'apprentice'); p.gained = inp.r; addFresh(S, p.id, inp.r);
        log(S, `Ученик (${p.name}) получает способность: ${rname(inp.r)}`, 'effect'); rebuildRest(S);
      },
    };
  },

  amnesiac: (S, p) => {
    const key = 'amnesiac_' + p.id;
    return {
      inputs: [TEXT('ability', 'Способность Амнезиака — решаете вы, игрок её не знает'), PL('t', 3, 'Выбор Амнезиака, если способность его требует', () => true, { min: 0 })],
      defaults: { ability: S.flags[key] || '' },
      apply: inp => {
        S.flags[key] = String(inp.ability || '').trim();
        log(S, `Амнезиак (${p.name})${S.flags[key] ? ': ' + S.flags[key] : ''}${inp.t && inp.t.length ? ' — выбор: ' + inp.t.map(id => nm(S, id)).join(', ') : ''}`, 'action');
      },
    };
  },
};
// роль-обманка Пьяницы просыпается как настоящая роль, но без эффекта — логика та же (off=true)

/* --- рамки выбора: кто выбирает и что разрешено (по текстам способностей) */
const I = t => ({ w: 'Игрок выбирает', t }), Y = t => ({ w: 'Вы решаете', t });
const BOUNDS = {
  dusk: { all: [Y('Убедитесь, что все закрыли глаза')] },
  minioninfo: { all: [Y('Только при 7+ игроках. Приспешники узнают Демона, Демон — Приспешников')] },
  demoninfo: { all: [Y('Блефы — 3 добрые роли, которых нет в игре (у Пьяницы роль-обманка тоже считается занятой)')] },
  dawn: { all: [Y('Объявите, кто умер ночью. Роли умерших не называются')] },
  washerwoman: { all: [Y('2 игрока и роль Горожанина; если Прачка трезва, один из двоих обязан иметь эту роль')] },
  librarian: { all: [Y('2 игрока и роль Изгоя (Пьяница — тоже Изгой); «Изгоев нет» — только если их правда нет')] },
  investigator: { all: [Y('2 игрока и роль Приспешника; Затворника можно показать Приспешником')] },
  chef: { all: [Y('Число пар соседей-злодеев. Затворник и Шпион определяются по вашему решению')] },
  empath: { all: [Y('Число злых среди 2 ближайших живых соседей')] },
  fortuneteller: { all: [I('любых 2 игроков (можно себя и мёртвых)'), Y('«Да», если среди них Демон или ложная цель')] },
  undertaker: { all: [Y('Роль игрока, который сегодня умер от казни')] },
  monk: { all: [I('1 игрока, не себя: он защищён от Демона этой ночью')] },
  ravenkeeper: { all: [I('любого игрока (живого или мёртвого)'), Y('Покажите его роль')] },
  butler: { all: [I('1 игрока, не себя — хозяина. Завтра Дворецкий голосует, только если голосует хозяин')] },
  poisoner: { all: [I('любого игрока (можно себя): он отравлен этой ночью и завтрашним днём')] },
  spy: { all: [Y('Покажите весь Гримуар, сколько нужно')] },
  scarletwoman: { all: [Y('Сообщите, что она теперь Демон')] },
  imp: { other: [I('любого игрока, можно себя'), Y('Если Чёрт убил себя — кто из живых Приспешников станет Чёртом')] },
  grandmother: { first: [Y('Внук — любой добрый игрок; покажите его и его роль')] },
  sailor: { all: [I('1 живого игрока'), Y('Кто из двоих (Моряк или выбранный) пьян до заката')] },
  chambermaid: { all: [I('2 живых игроков, не себя'), Y('Сколько из них просыпались этой ночью из-за своей способности')] },
  exorcist: { other: [I('1 игрока, не того же, что прошлой ночью. Если это Демон — он не просыпается')] },
  innkeeper: { other: [I('2 игроков: они не могут умереть этой ночью'), Y('Кто из двоих пьян до заката')] },
  gambler: { other: [I('1 игрока и роль. Не угадал — Азартный игрок умирает')] },
  gossip: { other: [Y('Было ли дневное утверждение Сплетника правдой. Если да — вы выбираете, кто умирает')] },
  courtier: { all: [I('любую роль, раз за игру: её обладатель пьян 3 ночи и 3 дня')] },
  professor: { other: [I('1 мёртвого игрока, раз за игру; воскресает, только если он Горожанин')] },
  moonchild: { other: [Y('Если днём выбран добрый игрок — он умирает')] },
  godfather: { first: [Y('Покажите все роли Изгоев в игре')], other: [I('любого игрока — только если днём умер Изгой')] },
  devilsadvocate: { all: [I('1 живого игрока, не того же, что прошлой ночью: завтра казнь его не убьёт')] },
  assassin: { other: [I('любого игрока, раз за игру — умирает несмотря ни на какую защиту')] },
  zombuul: { other: [I('любого игрока — только если днём никто не умер')] },
  pukka: { all: [I('любого игрока: он отравлен; отравленный прошлой ночью умирает')] },
  shabaloth: { other: [I('2 игроков'), Y('По желанию вернуть к жизни одного из убитых им прошлой ночью')] },
  po: { other: [I('1 игрока или никого; после «никого» в следующую ночь — 3 игроков')] },
  lunatic: { all: [I('как будто он Демон — ничего не происходит'), Y('Что показать Лунатику; настоящий Демон узнаёт его выбор')] },
  clockmaker: { first: [Y('Число шагов от Демона до ближайшего Приспешника')] },
  dreamer: { all: [I('1 игрока, не себя'), Y('1 добрую и 1 злую роль, одна из них — его')] },
  snakecharmer: { all: [I('1 живого игрока: если это Демон — они меняются ролями и сторонами')] },
  mathematician: { all: [Y('Число игроков, чьи способности сработали неправильно из-за чужих способностей')] },
  flowergirl: { other: [Y('Голосовал ли сегодня Демон')] },
  towncrier: { other: [Y('Номинировал ли сегодня Приспешник')] },
  oracle: { other: [Y('Число мёртвых злых игроков')] },
  seamstress: { all: [I('2 игроков, не себя, раз за игру'), Y('На одной ли они стороне')] },
  philosopher: { all: [I('добрую роль, раз за игру: Философ получает её способность; если роль в игре — её обладатель пьян')] },
  juggler: { other: [Y('Сколько догадок 1-го дня были верными')] },
  sage: { other: [Y('2 игрока, один из них — Демон')] },
  barber: { other: [I('Демон: 2 игроков (не другого Демона, можно себя) — они меняются ролями, стороны прежние; можно отказаться')] },
  sweetheart: { other: [Y('Любой игрок становится пьяным до конца игры')] },
  eviltwin: { first: [Y('Добрый близнец — любой игрок противоположной стороны')] },
  witch: { all: [I('любого игрока (можно себя): если завтра номинирует — умрёт. При 3 живых способность пропадает')] },
  cerenovus: { all: [I('1 игрока и добрую роль'), Y('Если завтра он не помешан на этой роли — можете казнить его')] },
  pithag: { other: [I('1 игрока и роль, которой нет в игре; сторона игрока не меняется'), Y('Если создан Демон — смерти этой ночью любые, на ваше усмотрение')] },
  fanggu: { other: [I('любого игрока; первый убитый так Изгой становится злым Фань Гу, а Фань Гу умирает')] },
  vigormortis: { other: [I('любого игрока'), Y('Если убит Приспешник — какой сосед-Горожанин отравлен')] },
  nodashii: { other: [I('любого игрока. Соседи-Горожане Но Даши отравлены всё время')] },
  vortox: { other: [I('любого игрока. Информация Горожан всегда ложная')] },
  widow: { first: [Y('Покажите Гримуар столько, сколько нужно'), I('любого игрока: он отравлен, пока Вдова жива'), Y('1 доброго игрока: он узнаёт, что Вдова в игре (но не кто она и кого отравила)')] },
  balloonist: { first: [Y('Любой игрок: живой или мёртвый, добрый или злой')], other: [Y('Игрок с типом роли не как у показанного прошлой ночью. Пьяному или отравленному Аэронавту можно тот же тип')] },
  tinker: { other: [Y('Можете решить, что Механик умирает (днём — кнопкой на экране дня). Не заканчивайте этим игру')] },
  harlot: { other: [I('1 живого игрока, не себя'), Y('Если выбранный согласился — покажите Куртизанке его роль; можете решить, что умирают оба. Если это Демон, не заканчивайте этим игру')] },
  bureaucrat: { all: [I('1 игрока, не себя: завтра его голос считается за 3')] },
  thief: { all: [I('1 игрока, не себя: завтра его голос считается против (−1)')] },
  barista: { all: [Y('Любой игрок до заката: либо трезв, здоров и получает верную информацию, либо действует дважды. Он узнаёт, что именно')] },
  bonecollector: { other: [I('1 мёртвого игрока или никого, раз за игру: он восстанавливает способность до заката')] },
  apprentice: { all: [Y('Ученик получает способность Горожанина (если добрый) или Приспешника (если злой) из сценария; лучше роль, которой нет в игре')] },
  amnesiac: { all: [Y('Способность придумываете вы: будите и просите выбрать, только если она этого требует'), Y('Днём он раз в день приватно угадывает её — отвечайте «Холодно», «Тепло», «Горячо» или «В точку»')] },
};
function boundsFor(id, first) { const b = BOUNDS[id]; return b ? (b.all || (first ? b.first : b.other) || []) : []; }

/* применение шага: снимок для отмены делает интерфейс */
// все поля шага (основные и дополнительные, зависящие от выбора)
function stepInputs(spec, inp) { return spec.inputs.concat(spec.more ? spec.more(inp || {}) : []); }
// чего не хватает, чтобы применить шаг
function missingInputs(spec, inp) {
  inp = inp || {};
  return stepInputs(spec, inp).filter(f => {
    const v = inp[f.key];
    if (f.type === 'players') return (v || []).length < (f.min ?? f.n);
    if (f.type === 'role') return !f.optional && !v;
    if (f.type === 'choice') return !f.optional && v === undefined;
    return false;
  }).map(f => f.label);
}

// Наёмник: первый за ночь игрок, выбравший его своей способностью, пьян до заката, а Наёмник переходит на его сторону.
// Считаем только шаги, где выбирает сам игрок (в рамках выбора есть «Игрок выбирает»)
function goonTarget(S, step, spec, inp) {
  if (!step.pid || S.night.data.goonHit || !(spec.bounds || []).some(b => b.w === 'Игрок выбирает')) return null;
  const actor = P(S, step.pid);
  return (inp.t || []).map(id => P(S, id)).find(q => q && q.role === 'goon' && q.alive && q !== actor && !abilityOff(S, q)) || null;
}
function goonWarn(S, step, spec, inp) {
  const g = goonTarget(S, step, spec, inp), a = g && P(S, step.pid);
  if (!g) return null;
  return `Выбран Наёмник (${g.name}): ${a.role === 'assassin' ? 'Ассасин всё равно убивает' : `${a.name} становится пьяным до заката — способность не сработает`}; Наёмник переходит на сторону ${a.name}${g.align !== a.align ? ' — разбудите его и покажите большой палец ' + (a.align === 'good' ? 'вверх' : 'вниз') : ''}.`;
}
function goonHit(S, step, spec, inp) {
  const g = goonTarget(S, step, spec, inp);
  if (!g) return false;
  const a = P(S, step.pid), was = g.align;
  S.night.data.goonHit = true;
  if (a.role !== 'assassin') addTok(S, a, 'drunk', 'goon', ['dusk', S.n + 1]); // по вики: Ассасин убивает Наёмника, но тот всё равно меняет сторону
  g.align = a.align;
  log(S, `Наёмник (${g.name}) выбран: ${a.role !== 'assassin' ? `${a.name} пьян до заката; ` : ''}Наёмник ${was !== g.align ? 'теперь ' + (g.align === 'good' ? 'добрый' : 'злой') : 'остаётся на своей стороне'}`, 'effect');
  return true;
}

function applyStep(S, step, inp) {
  let spec = stepSpec(S, step);
  if (spec.active && missingInputs(spec, inp).length) return { ok: false, missing: missingInputs(spec, inp) };
  if (spec.active) {
    if (step.pid && !S.night.woke.includes(step.pid)) S.night.woke.push(step.pid);
    if (goonHit(S, step, spec, inp || {})) spec = stepSpec(S, step); // выбравший Наёмника пьян — пересчитываем шаг
    spec.apply(inp || {});
  }
  if (!S.result) { S.night.i += 1; if (S.night.i >= S.night.steps.length) endNight(S); }
  return { ok: true };
}
function skipStep(S) { S.night.i += 1; if (S.night.i >= S.night.steps.length) endNight(S); }

/* --- предупреждения о текущей ситуации */
function situation(S) {
  const out = [];
  if (S.phase === 'setup' || S.result) return out;
  const alive = aliveCount(S);
  const demon = S.players.find(demonAlive);
  if (demon && abilityOff(S, demon)) out.push(`Демон (${demon.name}) ${abilityOff(S, demon)}`);
  if (alive <= 4) out.push(`Живых: ${alive}. При двух живых побеждает зло.`);
  if (alive === 3 && S.players.some(p => p.role === 'mayor' && p.alive && !abilityOff(S, p))) out.push('Трое живых и Мэр жив: день без казни — победа добра.');
  if (twinsBlockGood(S)) out.push('Оба близнеца живы: добро не может победить.');
  if (S.flags.mastermindDay === S.n) out.push('Дополнительный день Кукловода: казнь доброго — победа зла, злого или никого — победа добра.');
  if (S.flags.moonchildPending) out.push(`Дитя Луны (${nm(S, S.flags.moonchildPending)}) должно публично выбрать игрока.`);
  if (S.flags.klutzPending) out.push(`Растяпа (${nm(S, S.flags.klutzPending)}) должен публично выбрать игрока.`);
  if (vortoxActive(S)) out.push('Вортокс: день без казни — победа зла.');
  if (S.phase === 'day' && S.day) {
    const bishop = holders(S, 'bishop').find(h => h.alive && !abilityOff(S, h));
    if (bishop && !S.day.nominated.some(id => P(S, id) && P(S, id).align !== bishop.align))
      out.push(`Епископ: номинирует только рассказчик; сегодня нужно номинировать хотя бы 1 ${bishop.align === 'good' ? 'злого' : 'доброго'} игрока.`);
    if (voudonActive(S)) out.push('Шаман Вуду: голосуют только он и мёртвые (жетоны не тратятся); для казни хватает 1 голоса, побеждает больше всех.');
    if (S.day.butcherOpen) out.push('Мясник может номинировать ещё раз: для второй казни нужен порог голосов, превышать первую не нужно.');
  }
  return out;
}

// Амнезиак раз в день угадывает свою способность; рассказчик отвечает, насколько он близок
const AMNESIAC_ANSWERS = { cold: 'Холодно', warm: 'Тепло', hot: 'Горячо', bingo: 'В точку' };
function amnesiacGuess(S, pid, guess, answer) {
  const p = P(S, pid);
  S.day.amnesiac = Object.assign({}, S.day.amnesiac, { [pid]: { guess: guess || '', answer } });
  log(S, `Амнезиак (${p.name}) угадывает способность${guess ? `: «${guess}»` : ''} — ${AMNESIAC_ANSWERS[answer]}`, 'day');
}

function moonchildChoose(S, pid) { S.flags.moonchildTarget = pid; log(S, `Дитя Луны выбирает ${nm(S, pid)}`, 'day'); S.flags.moonchildPending = null; }
function klutzChoose(S, pid) {
  const k = P(S, S.flags.klutzPending), t = P(S, pid); S.flags.klutzPending = null;
  log(S, `Растяпа (${k.name}) выбирает ${t.name}`, 'day');
  if (t.align === 'evil') endGame(S, k.align === 'evil' ? 'good' : 'evil', `Растяпа выбрал злого игрока (${t.name})`);
}


const ENGINE = { newGame, newPlayer, P, nm, rname, realTeam, actsAs, aliveCount, aliveAll, coreCount, isTraveller, exile, exileThreshold, addTraveller, meetingBlocker, isDemon, distribution, setupDistribution, distCheck, countTeams, randomDeal,
  amnesiacGuess, AMNESIAC_ANSWERS, storytellerKill, voteCount, voteWeight, voudonActive, bishopActive, travellerWorks, executeNow,
  judgeRuling, gunslingerShot, tinkerDies, doomsayerKill, fiddlerEnd, swapSeats, goonWarn,
  finishRoles, autoSetup, setupProblems, jinxesInPlay, startGame, startNight, currentStep, stepSpec, applyStep, skipStep,
  stepInputs, missingInputs, endNight,
  nominate, nominationPreview, recordVote, block, execute, endDay, slayerShot, voteThreshold, situation, moonchildChoose, klutzChoose,
  abilityOff, attemptKill, die, addTok, rmTok, hasTok, TOK_RU, TEAM_RU, log, checkWin, endGame, aliveNeighbours,
  townsfolkNeighbours, teaLadyProtects, phaseTag, isGoodTeam, shuffle, uid };
