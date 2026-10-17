'use strict';
/* Движок помощника рассказчика: состояние игры и правила ролей базовой коробки.
   Без DOM — всё, что нужно интерфейсу, описывается «шагами» (stepSpec). */

const R = id => DATA.roles[id];
const isGoodTeam = t => t === 'townsfolk' || t === 'outsider';
const TEAM_RU = { townsfolk: 'Горожанин', outsider: 'Изгой', minion: 'Приспешник', demon: 'Демон', traveller: 'Странник' };
// официальные жетоны информации (как в ночных текстах ru.json) — для показа игроку на весь экран
const CARD = { youAre: 'ТЕПЕРЬ ВЫ', selected: 'ОБЛАДАТЕЛЬ ЭТОЙ РОЛИ ВЫБРАЛ ВАС', thisPlayer: 'ЭТОТ ИГРОК', demon: 'ЭТО ДЕМОН',
  minions: 'ЭТО ВАШИ ПРИСПЕШНИКИ', notInPlay: 'ЭТИХ РОЛЕЙ В ИГРЕ НЕТ' };
const bluffCards = (S, label) => S.bluffs.filter(Boolean).map(role => ({ label, caption: CARD.notInPlay, role }));

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
    players: [], fabled: (sc.fabled || []).slice(), bluffs: [], phase: 'setup', n: 0,
    night: null, day: null, lastDay: null, flags: {}, log: [], result: null,
  };
}

function newPlayer(name) {
  return { id: uid(), name, role: null, believes: null, gained: null, align: 'good', alive: true, ghost: true, tokens: [] };
}

const P = (S, id) => S.players.find(p => p.id === id);
const nm = (S, id) => { const p = P(S, id); return p ? p.name : '—'; };
const realTeam = p => p.role && R(p.role) ? R(p.role).team : null;
// Пьяница и Марионетка «считают себя» доброй ролью: просыпаются как она, способность не работает (вики: «как будто Пьяница»)
const fakeGood = p => p.role === 'drunk' || p.role === 'marionette';
const actsAs = p => p.gained || (fakeGood(p) ? p.believes : p.role);
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
  herring: 'Ложная цель', chosen: 'Выбран', note: 'Заметка', know: 'Раскрытый', lunch: 'Обед', shown: 'Показан', guessused: 'Догадка использована', second: 'Второй (Гарпия)',
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
// Философ: обладатель выбранной им роли пьян, пока Философ жив, трезв и здоров (вики: «если Философ умирает, становится пьян
// или отравлен — этот игрок снова трезв»)
const philosopherWorks = S => holders(S, 'philosopher').some(f => f.alive && f.gained && !f.tokens.some(x => (x.k === 'drunk' || x.k === 'poisoned') && x.src !== 'philosopher'));
const tokOff = (S, t) => (t.k === 'drunk' || t.k === 'poisoned') && (t.src !== 'widow' || widowWorks(S)) && (t.src !== 'philosopher' || philosopherWorks(S));

// Нищий всегда трезв и здоров; Бариста может сделать игрока трезвым и здоровым до заката
const alwaysSober = p => p.role === 'beggar' || p.tokens.some(t => t.k === 'sober' && t.src === 'barista');

function abilityOff(S, p) { // способность не работает (пьян/отравлен/роль-обманка)
  if (p.role === 'drunk' && !p.gained) return 'Пьяница';
  if (p.role === 'marionette') return 'Марионетка';
  if (p.role === 'lunatic') return 'Безумец';
  if (alwaysSober(p)) return null;
  const t = p.tokens.find(t => tokOff(S, t));
  if (t) return (t.k === 'drunk' ? 'пьян' : 'отравлен') + (t.src && R(t.src) ? ` (${R(t.src).name})` : '');
  // джинксы: если Шпион или Вдова в игре (или были в ней), Девица отравлена
  if (p.role === 'damsel') for (const ev of ['spy', 'widow']) if (jinxOn(S, ev, 'damsel') && (inPlay(S, ev) || (S.flags.ever || {})[ev])) return `отравлена (джинкс: ${R(ev).name})`;
  for (const nd of holders(S, 'nodashii')) {
    if (demonAlive(nd) && !abilityOffNoND(S, nd) && townsfolkNeighbours(S, nd).includes(p)) return 'отравлен (Но Даши)';
  }
  return null;
}
// джинкс действует, если обе роли есть в сценарии
const jinxOn = (S, a, b) => !!(DATA.jinxes[a + '|' + b] || DATA.jinxes[b + '|' + a]) && S.script.roles.includes(a) && S.script.roles.includes(b);
// у Дурманщика есть способность: жив, трезв и здоров (джинксы со Шпионом и Вдовой — они не заглядывают в Гримуар)
const poppyActive = S => S.players.some(q => actsAs(q) === 'poppygrower' && q.alive && !abilityOff(S, q));
function abilityOffNoND(S, p) { // то же, но без Но Даши (чтобы не зациклиться)
  if (p.role === 'drunk' && !p.gained) return 'Пьяница';
  if (p.role === 'marionette') return 'Марионетка';
  if (alwaysSober(p)) return null;
  const t = p.tokens.find(t => tokOff(S, t));
  return t ? t.k : null;
}

function teaLadyProtects(S, p) {
  return S.players.filter(q => actsAs(q) === 'tealady').some(t => { // и Философ/Каннибал со способностью Травницы
    if (!t.alive || abilityOff(S, t)) return false;
    const nb = aliveNeighbours(S, t);
    return nb.length === 2 && nb.every(q => q.align === 'good') && nb.includes(p);
  });
}

function vortoxActive(S) { return holders(S, 'vortox').some(v => demonAlive(v) && !abilityOff(S, v)); }

/* ------------------------------------------------------------ искажённая информация и Математик */
// чужая способность, из-за которой способность игрока не работает (для Математика); своя роль (Пьяница, Безумец) — не в счёт
function abnSource(S, p) {
  if ((p.role === 'drunk' && !p.gained) || p.role === 'lunatic' || alwaysSober(p)) return null;
  const offs = p.tokens.filter(t => tokOff(S, t));
  if (offs.length) { // своя способность не считается (Моряк, выбравший себя)
    const t = offs.find(t => t.src !== p.role);
    return !t ? null : t.src && R(t.src) ? R(t.src).name : (t.k === 'drunk' ? 'пьянство' : 'яд');
  }
  return abilityOff(S, p) ? 'Но Даши' : null;
}
// может ли (или должна ли) информация шага быть ложной: пьян, отравлен или Вортокс (для Горожан)
function distortion(S, p) {
  const team = R(actsAs(p)) ? R(actsAs(p)).team : realTeam(p);
  const off = abilityOff(S, p);
  const label = !off ? '' : /^пьян/.test(off) ? 'ПЬЯН' : /^отравлен/.test(off) ? 'ОТРАВЛЕН' : off.toUpperCase();
  // вид искажения — для рамки ответа: пьянство (кружка), яд (капли), Безумец (свой значок) — просьба пользователя 2026-10-14
  const kind = !off ? 'poison' : /^пьян|^Пьяница|^Марионетка/.test(off) ? 'drunk' : off === 'Безумец' ? 'lunatic' : 'poison';
  if (vortoxActive(S) && team === 'townsfolk' && !alwaysSober(p))
    return { must: true, why: 'Вортокс: информация Горожан должна быть ЛОЖНОЙ', src: 'Вортокс', label: label ? label + ' · ВОРТОКС' : 'ВОРТОКС', vortox: true, kind: off ? kind : 'poison' };
  return off ? { must: false, why: `${p.name}: ${off} — можно показать любую информацию`, src: abnSource(S, p), label, kind } : null;
}
// способность сработала иначе из-за чужой способности — запоминаем до рассвета (Математик считает с прошлого рассвета)
function recordAbn(S, p, text, src) {
  if (!src) return;
  S.flags.abn = (S.flags.abn || []).concat({ pid: p.id, text: `${p.name}: ${text} (${src})` });
}

/* ------------------------------------------------------------ смерть */

// кто не даёт игроку умереть (без последствий) — общая проверка для attemptKill и подсказок заранее (номинация проклятого Ведьмой).
// Травница (вики): её соседи не умирают никак — ни от Демона, ни от казни, ни от Ведьмы, ни при изгнании; исключение — Ассасин
function deathGuard(S, p, cause) {
  if (cause === 'unstoppable') return null;
  if (cause === 'demon' && hasTok(p, 'protected', 'monk')) return 'Монах';
  if (cause === 'demon' && actsAs(p) === 'soldier' && !abilityOff(S, p)) return 'Солдат';
  if (cause !== 'execution' && hasTok(p, 'protected', 'innkeeper')) return 'Трактирщик';
  if (actsAs(p) === 'sailor' && !abilityOff(S, p)) return 'Моряк';
  if (teaLadyProtects(S, p)) return 'Травница';
  if (cause === 'execution' && hasTok(p, 'safe', 'devilsadvocate')) return 'Адвокат Дьявола';
  if (actsAs(p) === 'fool' && !abilityOff(S, p) && !S.flags['foolUsed_' + p.id]) return 'Шут (1-я смерть)';
  return null;
}
// cause: demon | minion | ability | execution | exile | unstoppable
function attemptKill(S, p, cause, src, opts) {
  opts = opts || {};
  if (!p || !p.alive) return { died: false, why: 'уже мёртв' };
  if (cause !== 'unstoppable') {
    const guard = deathGuard(S, p, cause);
    if (guard) { if (guard.startsWith('Шут')) S.flags['foolUsed_' + p.id] = true; return saved(S, p, guard); }
    if (p.role === 'zombuul' && !S.flags.zombuulFaked && !abilityOff(S, p)) {
      S.flags.zombuulFaked = true; p.alive = false; p.secretlyAlive = true;
      log(S, `${p.name} (Зомбуул) «умирает», но остаётся в игре: определяется мёртвым`, 'death');
      afterDeath(S, p, cause, true);
      return { died: true, fake: true };
    }
    abnKill(S, p, cause);
  }
  die(S, p, cause, src, opts);
  return { died: true };
}
// защита не сработала из-за пьянства/яда — для Математика (по вики: «способность должна была сработать, но не сработала»)
function abnKill(S, p, cause) {
  const would = S.phase === 'night' && S.night && (S.night.data.protectWould || {})[p.id];
  if (would && (cause === 'demon' || (!would.demonOnly && cause !== 'execution'))) { const g = P(S, would.by); if (g) recordAbn(S, g, `не защитил ${p.name}`, abnSource(S, g)); }
  if (cause === 'demon' && actsAs(p) === 'soldier') recordAbn(S, p, 'не защитил себя', abnSource(S, p));
  if (actsAs(p) === 'sailor') recordAbn(S, p, 'не защитил себя', abnSource(S, p));
  if (actsAs(p) === 'fool' && !S.flags['foolUsed_' + p.id]) recordAbn(S, p, 'не избежал смерти', abnSource(S, p));
  for (const t of S.players.filter(q => actsAs(q) === 'tealady')) {
    const nb = aliveNeighbours(S, t);
    if (t.alive && nb.length === 2 && nb.every(q => q.align === 'good') && nb.includes(p)) recordAbn(S, t, `не защитила ${p.name}`, abnSource(S, t));
  }
}
function saved(S, p, by) { log(S, `${p.name} не умирает: ${by}`, 'save'); return { died: false, why: by }; }

// смерть по решению рассказчика («что-то плохое» Ангела, ручная отметка в «Гримуаре»): без защит, но со всеми
// последствиями — ночью попадёт в объявление на рассвете, сработают Смотритель, Дитя Луны, проверка победы и т. д.
// reason — примечание рассказчика (видно в журнале и в «Гримуаре», в объявлении на рассвете не звучит)
/* ---------- смена роли посреди игры: Яга, Цирюльник, Заклинатель змей, Фань Гу, Егерь, Блудница, Чёрт ---------- */
// эффекты, которые держатся, пока у кого-то есть способность-источник: роль сменилась — эффект кончается (яд Отравителя и т. п.)
const ENDS_WITH_ROLE = ['poisoned', 'drunk', 'protected', 'safe', 'cursed', 'mad', 'second', 'hasability', 'votes3', 'voteneg', 'sober', 'twice', 'chosen', 'master'];
function endOrphanEffects(S) {
  const held = new Set(S.players.flatMap(q => [q.role, q.gained]).filter(Boolean));
  for (const q of S.players) q.tokens = q.tokens.filter(t => !(ENDS_WITH_ROLE.includes(t.k) && t.src && R(t.src) && !held.has(t.src)));
}
// кем себя считает новый Пьяница (Горожанин сценария не в игре и не из блефов) или Безумец (Демон сценария)
function pickBelieved(S, role) {
  const used = new Set(S.players.flatMap(q => [q.role, q.believes]).concat(S.bluffs || []));
  if (role === 'drunk') return pick(S.script.roles.filter(r => R(r) && R(r).team === 'townsfolk' && !used.has(r))) || null;
  if (role === 'lunatic') return pick(S.script.roles.filter(r => R(r) && R(r).team === 'demon')) || null;
  return null;
}
// opts: align — новая сторона (Заклинатель, Фань Гу), gained — полученная способность (едет вместе с ролью Философа/Каннибала),
// believes — кем себя считает (Пьяница/Безумец; при обмене Цирюльника едет вместе с ролью, как жетон с напоминанием)
function changeRole(S, p, role, opts) {
  opts = opts || {};
  const old = p.role;
  p.role = role; p.gained = opts.gained || null;
  p.believes = role === 'drunk' || role === 'lunatic' ? (opts.believes || pickBelieved(S, role)) : null;
  if (opts.align) p.align = opts.align;
  S.flags.ever = Object.assign({}, S.flags.ever, { [role]: true }); // джинксы «есть или был в игре»
  // Философ выбрал эту роль, когда её не было в игре, — теперь её обладатель пьян (вики)
  if (holders(S, 'philosopher').some(f => f !== p && f.gained === role) && !hasTok(p, 'drunk', 'philosopher')) addTok(S, p, 'drunk', 'philosopher');
  // способность «только в 1-ю ночь» новой роли срабатывает в ближайшую ночь (вики, Яга: созданный Злой Близнец узнаёт близнеца)
  // (Пьяница — как роль, которой себя считает)
  if (S.phase !== 'setup') addFresh(S, p.id, actsAs(p), S.phase === 'night' ? S.n : S.n + 1);
  if (!opts.keep) endOrphanEffects(S); // keep — обмен двух ролей: эффекты проверяем после второй замены
  return old;
}

// кто умер этой ночью — без тех, кого той же ночью вернули к жизни (Профессор, Шабалот, Аль-Хадикия; заметка пользователя
// 2026-10-14: «показывает умер игрок, а его воскресил Профессор»). «Умерший» Зомбуул остаётся в списке — он определяется мёртвым
const nightDeaths = S => S.night ? S.night.deaths.filter(d => { const q = P(S, d.pid); return q && (!q.alive || q.secretlyAlive); }) : [];
// воскрешение способностью: ночью — в список «снова жив» на рассвете (вики, Профессор: объявить после смертей, не говоря почему)
function revive(S, p, why) {
  if (!p || p.alive) return false;
  p.alive = true; p.ghost = true; p.deathNote = null;
  if (S.phase === 'night' && S.night) S.night.revived = (S.night.revived || []).concat(p.id);
  for (const f of ['klutzPending', 'moonchildPending', 'sweetheartPending']) if (S.flags[f] === p.id) S.flags[f] = null;
  log(S, `${why}: ${p.name} снова жив`, 'revive');
  return true;
}
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
  if (actsAs(p) === 'sage' && cause === 'demon') S.flags.sageWake = p.id;
  if (actsAs(p) === 'moonchild' && !abilityOff(S, p)) S.flags.moonchildPending = p.id;
  if (actsAs(p) === 'klutz' && !abilityOff(S, p)) S.flags.klutzPending = p.id;
  if (actsAs(p) === 'barber' && !abilityOff(S, p)) S.flags.haircuts = true;
  if (p.role === 'sweetheart' || (actsAs(p) === 'sweetheart' && !abilityOff(S, p))) S.flags.sweetheartPending = p.id;
  if (p.role === 'widow') S.players.forEach(q => rmTok(q, 'poisoned', 'widow')); // яд Вдовы — пока она жива
  if (preventsMeeting(p) && !abilityOff(S, p)) evilMeetsTonight(S);
  // Бабушка
  if (cause === 'demon' && S.flags.grandchild === p.id) {
    for (const g of holders(S, 'grandmother')) if (g.alive && !abilityOff(S, g)) {
      log(S, `Внук убит Демоном — Бабушка (${g.name}) должна умереть тоже`, 'death'); attemptKill(S, g, 'ability', 'grandmother'); // защиты действуют (Травница, Моряк…)
    }
  }
  // Менестрель: казнённый Приспешник
  if (cause === 'execution' && team === 'minion') {
    for (const m of S.players.filter(q => actsAs(q) === 'minstrel')) if (m.alive && !abilityOff(S, m)) {
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
    changeRole(S, sw, p.role); S.flags.swBecame = sw.id; S.flags.swNight = S.phase === 'night' ? S.n : S.n + 1;
    log(S, `Блудница (${sw.name}) становится новым Демоном: ${rname(p.role)}`, 'effect');
    // Демон умер посреди ночи — новый Демон просыпается этой же ночью, если его очередь ещё не прошла
    if (S.phase === 'night' && S.night && S.night.steps[S.night.i]) rebuildRest(S);
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
  // игра без Демона в начале (Атеист, Призыватель, Монстрёнок): «Демон мёртв» не считается, пока Демон не появится
  if (S.flags.demonless && S.players.some(isDemon)) S.flags.demonless = false;
  if (!demonsLeft && !S.flags.demonless) {
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
  // Егерь [+Девица] (вики): если Девицы нет — убрать 1 Горожанина и добавить Девицу (+1); если Девица уже среди Изгоев — без изменений
  huntsman: { opts: [0, 1], def: 1 },
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
  // Атеист [В игре нет злых ролей] (вики): злых убрать, добрых добавить до числа игроков; Горожан/Изгоев — на усмотрение рассказчика
  let free = false;
  if (roles.includes('atheist')) { t += m + d; m = 0; d = 0; free = true; notes.push('Атеист: злых ролей нет; сколько Горожан и Изгоев — решаете вы'); }
  for (const [id, c] of Object.entries(OUT_CHOICES)) {
    if (!roles.includes(id)) continue;
    // Аэронавт сам Горожанин: хотя бы один Горожанин должен остаться
    const opts = c.opts.filter(x => o + x >= 0 && t - x >= (id === 'balloonist' ? 1 : 0) && (x <= 0 || o + x <= maxOut));
    let v = mods[id] ?? c.def;
    if (!opts.includes(v)) v = opts.length === 1 ? opts[0] : opts.includes(c.def) ? c.def : null;
    choices.push({ id, opts, value: v });
    if (v !== null) { o += v; t -= v; }
  }
  return { townsfolk: t, outsider: o, minion: m, demon: d, notes, choices, free, pending: choices.filter(c => c.value === null).map(c => c.id) };
}

// роли и Сказочники, раскладку которых приложение умеет считать; с остальными (экспериментальные: Легион,
// Казали и т. п.) раскладку проверяет рассказчик, и приложение не мешает начать игру
const KNOWN_SETUP = new Set(['drunk', 'baron', 'godfather', 'fanggu', 'vigormortis', 'balloonist', 'sentinel', 'huntsman', 'atheist']);
const unknownSetup = S => [...new Set(S.players.map(p => p.role).concat(S.fabled || []))].filter(r => r && R(r) && R(r).setup && !KNOWN_SETUP.has(r));

// сверка раскладки с таблицей: строки «есть / нужно» по типам ролей («?» — пока не выбран сдвиг Изгоев);
// при Атеисте Горожане и Изгои сверяются только вместе
function distCheck(d, c) {
  return ['townsfolk', 'outsider', 'minion', 'demon'].map(t => {
    const good = t === 'townsfolk' || t === 'outsider', unknown = d.pending.length > 0 && good;
    if (d.free && good) return { t, have: c[t], want: d[t], bad: c.townsfolk + c.outsider !== d.townsfolk + d.outsider };
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

/* ---------- набор ролей на игру, назначения для жребия, случайная раздача ---------- */
const SETUP_TF = ['balloonist', 'huntsman']; // Горожане, которые сами меняют раскладку
const coreOf = S => S.players.filter(p => !isTraveller(p));
// набор ролей, выбранный рассказчиком на вкладке «Гримуар» (S.pool), годится, если ролей ровно по числу игроков
const validPool = S => !!(S.pool && S.pool.length === coreOf(S).length && S.pool.every(r => S.script.roles.includes(r)));

// случайный набор ролей по раскладке; назначенные для жребия роли (S.assign) и роли, уже выданные игрокам (held),
// обязательно входят в набор. Атеиста случайно не берём — игру без злых рассказчик выбирает сам (набором ролей)
function randomPool(S, held) {
  const n = coreOf(S).length, roles = S.script.roles, as = Object.values(S.assign || {});
  const must = [...new Set(as.filter(a => a.role && roles.includes(a.role)).map(a => a.role).concat((held || []).filter(r => roles.includes(r))))];
  const byTeam = t => { const m = must.filter(r => R(r).team === t); return m.concat(shuffle(roles.filter(r => R(r) && R(r).team === t && r !== 'atheist' && !m.includes(r)))); };
  const base = BASE_DIST[Math.min(15, Math.max(5, n))];
  const chosen = [byTeam('demon')[0], ...byTeam('minion').slice(0, base[2])].filter(Boolean);
  const mods = S.flags.mods = Object.assign({}, S.flags.mods);
  if (chosen.includes('godfather') && mods.godfather == null) mods.godfather = pick([-1, 1]);
  const dist = extra => distribution(n, chosen.concat(extra, S.fabled || []), mods, scriptOutsiders(S));
  const tfAll = byTeam('townsfolk');
  // Горожане, меняющие раскладку (Аэронавт, Егерь), — пересчитываем раскладку с ними и оставляем их в игре
  let d = dist([]), tf = tfAll.slice(0, Math.max(0, d.townsfolk));
  for (let k = 0; k < 2; k++) {
    const sp = tf.filter(r => SETUP_TF.includes(r)); d = dist(sp);
    tf = sp.concat(tfAll.filter(r => !sp.includes(r) && !SETUP_TF.includes(r))).slice(0, Math.max(0, d.townsfolk));
  }
  // Егерь: Девица обязательно среди Изгоев
  const outs = byTeam('outsider').sort((a, b) => (b === 'damsel' && tf.includes('huntsman')) - (a === 'damsel' && tf.includes('huntsman')));
  let o = d.outsider;
  if (o > outs.length) { tf.push(...tfAll.filter(r => !tf.includes(r)).slice(0, o - outs.length)); o = outs.length; }
  const pool = chosen.concat(outs.slice(0, Math.max(0, o)), tf);
  // ровно по числу игроков: недостающих добираем добрыми ролями сценария, лишних Горожан убираем
  const spare = shuffle(roles.filter(r => R(r) && isGoodTeam(R(r).team) && !pool.includes(r) && r !== 'atheist'));
  while (pool.length < n && spare.length) pool.push(spare.shift());
  while (pool.length > n) { const i = pool.findIndex(r => R(r).team === 'townsfolk' && !must.includes(r) && !SETUP_TF.includes(r)); pool.splice(i < 0 ? pool.length - 1 : i, 1); }
  return pool;
}

// раздать набор игрокам: сначала назначенные роли, потом назначенный тип роли, остальным — случайно
function dealPool(S, pool) {
  S.flags.marionetteNeed = false; pool = marionetteSwap(S, pool); // Марионетка — Горожанином, потом выбор соседа Демона
  const core = coreOf(S), left = shuffle(pool.slice()), as = S.assign || {}, got = {};
  const take = f => { const i = left.findIndex(f); return i < 0 ? null : left.splice(i, 1)[0]; };
  for (const p of core) { const a = as[p.id]; if (a && a.role) got[p.id] = take(r => r === a.role); }
  for (const p of core) { const a = as[p.id]; if (a && a.team && !got[p.id]) got[p.id] = take(r => R(r).team === a.team); }
  for (const p of shuffle(core)) if (!got[p.id]) got[p.id] = take(() => true);
  core.forEach(p => { p.role = got[p.id] || null; p.believes = null; });
  finishRoles(S);
}
// Марионетка (вики): её жетона в мешочке нет — вместо него любой Горожанин; потом рассказчик выбирает соседа Демона с доброй ролью,
// он и становится Марионеткой (считает себя этой ролью, как Пьяница). Заметка пользователя 2026-10-14
function marionetteSwap(S, pool) {
  const k = pool.indexOf('marionette'); if (k < 0) return pool;
  const busy = new Set(pool.concat(S.players.map(p => p.role), S.players.map(p => p.believes)));
  const tf = shuffle(S.script.roles.filter(r => R(r) && R(r).team === 'townsfolk' && !busy.has(r) && !SETUP_TF.includes(r)));
  if (!tf[0]) return pool;
  pool = pool.slice(); pool.splice(k, 1, tf[0]);
  S.flags.marionetteNeed = true;
  return pool;
}
// сделать игрока Марионеткой: его роль становится той, которой он себя считает; прежнюю Марионетку (если была) — обратно
function makeMarionette(S, pid) {
  const p = P(S, pid); if (!p || !p.role || !isGoodTeam(realTeam(p))) return false;
  for (const q of S.players) if (q.role === 'marionette' && q.believes) { q.role = q.believes; q.believes = null; q.align = 'good'; }
  p.believes = p.role; p.role = 'marionette'; p.align = 'evil'; S.flags.marionetteNeed = false;
  log(S, `Марионетка: ${p.name} (считает себя: ${rname(p.believes)})`, 'effect');
  return true;
}
// Пьяница (карточка «Подготовка», под блефами): выбранный Горожанин становится Пьяницей и считает себя своей ролью
// (как в правилах: жетон Пьяницы в Гримуаре заменяют жетоном Горожанина). Прежний Пьяница получает роль, которой себя считал,
// поэтому раскладка не меняется. pid пустой — Пьяницы нет. Заметки пользователя 2026-10-15
function makeDrunk(S, pid) {
  const p = pid ? P(S, pid) : null;
  if (p && (p.role === 'drunk' || realTeam(p) !== 'townsfolk')) return false;
  for (const q of S.players) if (q.role === 'drunk') { q.role = q.believes || null; q.believes = null; }
  if (p) { p.believes = p.role; p.role = 'drunk'; log(S, `Пьяница: ${p.name} (считает себя: ${rname(p.believes)})`, 'effect'); }
  finishRoles(S); autoSetup(S, false);
  return true;
}
// роль из списка в карточке «Роли»: игрок с доброй ролью стал Пьяницей (Марионеткой) — считает себя прежней ролью
// (заметка пользователя 2026-10-15: «сделал Гадалку Пьяницей, а в Гримуаре — Пьяница-Сыщик, Гадалка пропала»)
function setupRole(S, p, role) {
  const old = p.role, t = old && R(old) ? R(old).team : null;
  p.role = role || null;
  if (old !== p.role && ((p.role === 'drunk' && t === 'townsfolk') || (p.role === 'marionette' && isGoodTeam(t)))) p.believes = old;
  finishRoles(S); autoSetup(S, false);
}
// роль из карточки игрока («Гримуар»): на подготовке — как список ролей; в игре — через changeRole (сторона прежняя — её меняет
// кнопка «Сделать злым/добрым»), ночью оставшиеся шаги перестраиваются: новая роль проснётся, если её очередь ещё не прошла
// (заметка пользователя 2026-10-15: «изменил Блудницу на Отравителя» в 1-ю ночь — Отравитель не просыпался)
function storytellerRole(S, p, role) {
  if (S.phase === 'setup') return setupRole(S, p, role);
  if (!role || role === p.role) return;
  const old = p.role, t = old && R(old) ? R(old).team : null;
  changeRole(S, p, role, { believes: role === 'drunk' && t === 'townsfolk' ? old : undefined, align: isTraveller(p) ? p.align : undefined });
  log(S, `Рассказчик меняет роль ${p.name}: ${rname(old)} → ${rname(role)}`, 'effect');
  if (S.phase === 'night' && S.night && S.night.steps[S.night.i]) rebuildRest(S);
}
// соседи Демона по кругу (живые и мёртвые) — Марионетка обязана сидеть рядом
function demonSeatNeighbours(S) {
  const ps = S.players.filter(q => !isTraveller(q)), out = [];
  ps.forEach((q, i) => { if (isDemon(q)) for (const j of [i - 1, i + 1]) { const x = ps[(j + ps.length) % ps.length]; if (x && x !== q && !out.includes(x)) out.push(x); } });
  return out;
}

// случайная раздача: выбранный набор ролей (если он полный) или случайный по раскладке.
// Если роли уже выдаются или выданы стеной — раздавать заново нельзя (возвращает false)
function randomDeal(S) {
  if (S.draw) return false;
  dealPool(S, validPool(S) ? S.pool : randomPool(S));
  autoSetup(S, true);
  return true;
}

function finishRoles(S) {
  for (const p of S.players) {
    if (isTraveller(p)) continue; // сторону Странника назначает рассказчик
    p.align = p.role && !isGoodTeam(realTeam(p)) ? 'evil' : 'good';
    if (p.role !== 'lunatic' && !fakeGood(p)) p.believes = null;
  }
}

// блефом может быть добрая роль, кроме Пьяницы и Безумца: их обладатель не знает, кто он, — такой блеф бессмыслен
// (решение пользователя 2026-10-13: «Пьяница не знает, что он Пьяница»; вики блеф Пьяницей не запрещает)
const NO_BLUFF = ['drunk', 'lunatic'];
const canBluff = r => !!R(r) && isGoodTeam(R(r).team) && !NO_BLUFF.includes(r);
// значения по умолчанию для подготовки: Пьяница, Безумец, блефы, внук, ложная цель, близнец.
// Пьянице — роль не из блефов (иначе Демон поймёт, кто Пьяница); блефы — только добрые роли сценария не в игре, без повторов
function autoSetup(S, force) {
  const roles = S.script.roles, used = new Set(S.players.map(p => p.role));
  const bl = force ? [] : S.bluffs.filter(Boolean);
  const notInPlay = t => shuffle(roles.filter(r => R(r) && R(r).team === t && !used.has(r) && !bl.includes(r)));
  for (const p of S.players) {
    if (p.role === 'drunk' && (force || !p.believes || bl.includes(p.believes))) { p.believes = notInPlay('townsfolk')[0] || null; }
    if (p.role === 'marionette' && !p.believes) p.believes = notInPlay('townsfolk')[0] || null;
    if (fakeGood(p) && p.believes) used.add(p.believes);
    if (p.role === 'lunatic' && (force || !p.believes)) p.believes = shuffle(roles.filter(r => R(r) && R(r).team === 'demon'))[0] || null;
  }
  if (force || !S.bluffs.filter(Boolean).length || S.bluffs.some(b => b && (used.has(b) || !canBluff(b)))) {
    const keep = force ? [] : S.bluffs.filter(b => b && !used.has(b) && canBluff(b));
    const good = shuffle(roles.filter(r => canBluff(r) && !used.has(r) && !keep.includes(r)));
    S.bluffs = keep.concat(good).slice(0, 3);
  }
  const goodPlayers = S.players.filter(p => p.align === 'good');
  if (inPlay(S, 'grandmother') && (force || !S.flags.grandchild)) {
    const g = goodPlayers.filter(p => p.role !== 'grandmother'); S.flags.grandchild = g.length ? pick(g).id : null;
  }
  // ложная цель — случайный добрый игрок, но не сама Гадалка (решение пользователя 2026-10-14; вики это разрешает — выбрать вручную можно)
  const ftOk = goodPlayers.filter(p => p.role !== 'fortuneteller');
  if (inPlay(S, 'fortuneteller') && (force || !S.flags.ftHerring)) S.flags.ftHerring = ftOk.length ? pick(ftOk).id : goodPlayers.length ? pick(goodPlayers).id : null;
  if (inPlay(S, 'eviltwin') && (force || !S.flags.goodTwin)) {
    const g = goodPlayers; S.flags.goodTwin = g.length ? pick(g).id : null;
  }
  if (inPlay(S, 'puzzlemaster') && (force || !S.flags.puzzleDrunk)) S.flags.puzzleDrunk = puzzleDrunkDefault(S);
}
// Головоломщик (вики): при подготовке 1-й ночи один игрок пьян до конца игры, даже если Головоломщик умрёт; почти всегда лучше
// Горожанин (Приспешника или Демона — только с очень веской причиной). Раз за игру он угадывает, кто это: угадал — рассказчик
// приватно называет Демона, нет — любого игрока, который не Демон; угадал ли — не говорить. Мёртвый не угадывает
function puzzleDrunkDefault(S) {
  const tf = S.players.filter(p => realTeam(p) === 'townsfolk' && !isTraveller(p));
  return tf.length ? pick(tf).id : null;
}
const puzzleHit = (S, gid) => { const g = P(S, gid); return !!g && hasTok(g, 'drunk', 'puzzlemaster'); };
function puzzleGuess(S, pmId, guessId, toldId) {
  const pm = P(S, pmId), g = P(S, guessId), t = P(S, toldId);
  if (!pm || !g || !t || !pm.alive || S.flags['puzzleUsed_' + pmId]) return false;
  S.flags['puzzleUsed_' + pmId] = true; addTok(S, pm, 'guessused', 'puzzlemaster');
  const off = abilityOff(S, pm);
  log(S, `Головоломщик (${pm.name}) угадывает, что пьян ${g.name}: ${puzzleHit(S, guessId) ? 'верно' : 'неверно'}${off ? ` (Головоломщик ${off})` : ''}. Названо имя: ${t.name}`, 'day');
  return true;
}

/* «Стена жребия» — как мешочек с жетонами, разложенными по ячейкам. В мешочке — «Роли на игру» (S.pool) или, если они
   не выбраны, случайный набор по раскладке. Когда стена выкатывается, роли в случайном порядке прячутся в ячейки (cells[].hid):
   какую ячейку игрок выберет, ту роль и получит (заметка пользователя 2026-10-15: «чтобы выбор ячейки влиял на то, что получит
   игрок»). Где какая роль, не видит никто, и рассказчик тоже: пока ячейку не открыли, её роли в интерфейсе нет.
   Пока игрок не открыл ячейку, ему можно назначить роль или тип роли (S.assign) — назначения соблюдаются: ему выпадает
   назначенное, а то, что лежало в его ячейке, переезжает в ячейку, где лежала выпавшая роль. Другим не выпадает то, что нужно
   назначенным (содержимое ячейки так же меняется местами с подходящей). Роль, выданная игроку до стены, остаётся за ним:
   ячеек столько, сколько игроков, лишние — пустые. Пьяница видит роль, которой себя считает, Безумец — своего «Демона». */
const RUNE_COLORS = ['green', 'violet', 'red', 'gold'];
// почему стену нельзя выкатить (или пусто)
function drawProblem(S) {
  const n = coreOf(S).length;
  if (n < 5 || n > 15) return 'Нужно от 5 до 15 игроков (без Странников)';
  if (S.pool && S.pool.length && !validPool(S)) return `В «Ролях на игру» отмечено ${S.pool.length}, а игроков ${n}: отметьте ровно ${n} ролей — или очистите выбор, тогда роли наберутся случайно по раскладке`;
  return '';
}
function drawStart(S) {
  if (S.draw || drawProblem(S)) return false;
  const core = coreOf(S), prev = core.map(p => ({ id: p.id, role: p.role, believes: p.believes }));
  // мешочек: выбранные роли (или случайный набор); роли, уже выданные игрокам до стены, из него вынимаем
  S.flags.marionetteNeed = false;
  let bag = validPool(S) ? S.pool.slice() : randomPool(S, core.map(p => p.role).filter(Boolean));
  for (const p of core) if (p.role) { const k = bag.indexOf(p.role); if (k >= 0) bag.splice(k, 1); }
  bag = marionetteSwap(S, bag);
  const glyphs = shuffle([...Array(24).keys()]);
  const hid = shuffle(bag.concat(Array(Math.max(0, core.length - bag.length)).fill(null))); // роли по ячейкам; пустые — для уже выданных
  // hidden — роли на экране рассказчика закрыты «шторкой», пока он сам не нажмёт «Показать роли» (заметка пользователя 2026-10-16:
  // «вдруг случайно закроют стену» — за ней не должно быть видно ролей)
  S.draw = { prev, bag, hidden: true, order: core.map(p => p.id), turn: core[0] ? core[0].id : null, open: null,
    cells: core.map((x, i) => ({ hid: hid[i] || null, role: null, believes: null, glyph: glyphs[i % glyphs.length], color: RUNE_COLORS[Math.floor(Math.random() * 4)], pid: null, done: false })) };
  return true;
}
// какие роли из мешочка можно отдать игроку p: назначенную ему; не назначенные другим, ещё не открывшим
// (и чтобы хватило на их назначенный тип)
function drawCands(S, p) {
  const d = S.draw, as = S.assign || {}, a = as[p.id], bag = d.bag;
  const others = coreOf(S).filter(q => q !== p && !q.role);
  const reserved = others.map(q => as[q.id] && as[q.id].role).filter(r => r && bag.includes(r));
  const need = {}; for (const q of others) { const x = as[q.id]; if (x && x.team && !x.role) need[x.team] = (need[x.team] || 0) + 1; }
  const fits = r => { const rest = bag.slice(); rest.splice(rest.indexOf(r), 1);
    return Object.entries(need).every(([t, k]) => rest.filter(x => !reserved.includes(x) && R(x) && R(x).team === t).length >= k); };
  let cands = a && a.role && bag.includes(a.role) ? [a.role] : bag.filter(r => !reserved.includes(r));
  if (a && a.team && !a.role) { const t = cands.filter(r => R(r) && R(r).team === a.team); if (t.length) cands = t; }
  const ok = cands.filter(fits);
  return ok.length ? ok : cands.length ? cands : bag;
}
// положить роль (null — пусто) в ячейку i; то, что в ней лежало, переезжает в неоткрытую ячейку, где лежала эта роль
// (старые сохранения без hid: ячейки пустые — роль просто выпадает, как раньше)
function drawPut(d, i, role) {
  const c = d.cells[i], was = c.hid || null;
  if (was === role) return;
  const j = d.cells.findIndex((x, k) => k !== i && !x.pid && (x.hid || null) === role);
  if (j >= 0) d.cells[j].hid = was;
  c.hid = role;
}
// Пьянице — Горожанин сценария не в игре и не в мешочке; Безумцу — Демон сценария
function drawBelieves(S, p) {
  const used = new Set(S.players.map(q => q.role).concat(S.players.map(q => q.believes), S.draw.bag, S.bluffs || []));
  if (p.role === 'drunk') p.believes = pick(S.script.roles.filter(r => R(r) && R(r).team === 'townsfolk' && !used.has(r))) || null;
  if (p.role === 'lunatic') p.believes = pick(S.script.roles.filter(r => R(r) && R(r).team === 'demon')) || null;
}
const drawShown = c => c.believes || c.role; // что видит игрок
function drawOpen(S, i) {
  const d = S.draw, c = d && d.cells[i], p = d && P(S, d.turn);
  if (!c || c.pid || d.open !== null || !p) return false;
  if (!p.role) { // роль — из выбранной ячейки, если её можно отдать этому игроку (назначения); иначе подходящая из другой ячейки
    const cands = drawCands(S, p), here = c.hid || null;
    p.role = here && cands.includes(here) ? here : pick(cands) || null; p.believes = null;
    drawPut(d, i, p.role);
    const k = d.bag.indexOf(p.role); if (k >= 0) d.bag.splice(k, 1);
    p.align = p.role && !isGoodTeam(realTeam(p)) ? 'evil' : 'good';
    if (p.role === 'drunk' || p.role === 'lunatic') drawBelieves(S, p);
  } else drawPut(d, i, null); // роль выдана до стены: её ячейка «пустая», жетон из неё переезжает в пустую
  c.role = p.role; c.believes = p.believes || null; c.pid = p.id; d.open = i;
  return true;
}
function drawClose(S) {
  const d = S.draw; if (!d || d.open === null) return;
  d.cells[d.open].done = true; d.open = null;
  const taken = new Set(d.cells.filter(c => c.pid).map(c => c.pid));
  const k = d.order.indexOf(d.turn), rest = d.order.slice(k + 1).concat(d.order.slice(0, k + 1)).filter(id => !taken.has(id) && P(S, id));
  d.turn = rest[0] || null;
  if (!d.turn) drawFinish(S);
}
function drawFinish(S) {
  finishRoles(S);
  autoSetup(S, false); // блефы, внук, ложная цель, близнец — когда все роли уже известны
  // внук, ложная цель Гадалки, добрый близнец — должны остаться добрыми
  const good = S.players.filter(p => p.align === 'good' && !isTraveller(p));
  const fix = (flag, ok) => { const q = S.flags[flag] && P(S, S.flags[flag]); if (!q || !ok(q)) { const c = good.filter(ok); S.flags[flag] = c.length ? pick(c).id : null; } };
  if (inPlay(S, 'grandmother')) fix('grandchild', q => q.align === 'good' && q.role !== 'grandmother');
  if (inPlay(S, 'fortuneteller')) fix('ftHerring', q => q.align === 'good' && q.role !== 'fortuneteller');
  if (inPlay(S, 'eviltwin')) fix('goodTwin', q => q.align === 'good');
  S.draw.finished = true;
  log(S, 'Роли выданы жребием (стена)', 'phase');
}
// отменить можно только незаконченный жребий: роли возвращаются как были до него
function drawCancel(S) {
  const d = S.draw; if (!d || d.finished) return;
  d.prev.forEach(x => { const p = P(S, x.id); if (p) { p.role = x.role; p.believes = x.believes; } });
  S.flags.marionetteNeed = false;
  finishRoles(S);
  S.draw = null;
}
// роли выданы стеной: заново не раздаются, менять можно только на роль сценария, которой нет в игре
const drawLocked = S => !!(S.draw && S.draw.finished);
function setupProblems(S) {
  const out = [];
  const core = S.players.filter(p => !isTraveller(p));
  if (core.length < 5) out.push('Нужно хотя бы 5 игроков (не считая Странников)');
  if (S.draw && !S.draw.finished) out.push('Жребий не закончен: не все игроки открыли ячейки стены');
  else if (S.players.some(p => !p.role)) out.push('Не всем игрокам выданы роли');
  if (core.length >= 5 && S.players.every(p => p.role)) {
    const d = setupDistribution(S), odd = unknownSetup(S).length > 0;
    for (const id of d.pending) out.push(`${rname(id)}: выберите, сколько Изгоев — −1 или +1`);
    const diff = distCheck(d, countTeams(S)).filter(x => x.bad && x.want !== '?');
    if (S.flags.marionetteNeed) out.push('Марионетка: выберите в карточке «Подготовка», кто из соседей Демона ею станет');
    if (diff.length && !odd && !S.flags.marionetteNeed) out.push('Раскладка не совпадает с таблицей: ' + diff.map(x => `${TEAM_RU[x.t]}: ${x.have} из ${x.want}`).join(', '));
    const c = countTeams(S);
    if (c.demon !== d.demon && !odd) out.push(d.demon ? 'В игре должен быть ровно 1 Демон' : 'Атеист в игре: злых ролей быть не должно');
    if (d.free && c.minion) out.push('Атеист в игре: Приспешников быть не должно');
    if (inPlay(S, 'huntsman') && !inPlay(S, 'damsel')) out.push('Егерь в игре — Девица тоже должна быть в игре');
    const roles = S.players.map(p => p.role);
    if (new Set(roles).size !== roles.length) out.push('Одна роль выдана дважды');
    for (const b of S.bluffs) if (b && S.players.some(p => p.role === b || p.believes === b)) out.push(`Блеф «${rname(b)}» есть в игре — выберите другой`);
    for (const b of S.bluffs) if (b && NO_BLUFF.includes(b)) out.push(`Блеф «${rname(b)}» бессмыслен: обладатель этой роли не знает, кто он, — выберите другой`);
    for (const p of S.players) {
      if (p.role === 'drunk' && !p.believes) out.push(`${p.name}: Пьяница — выберите, кем он себя считает`);
      if (p.role === 'lunatic' && !p.believes) out.push(`${p.name}: Безумец — выберите, каким Демоном он себя считает`);
      if (p.role === 'marionette' && !p.believes) out.push(`${p.name}: Марионетка — выберите, кем она себя считает`);
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
  finishRoles(S); S.draw = null;
  S.flags.ever = Object.fromEntries(S.players.filter(p => p.role).map(p => [p.role, true])); // роли, бывшие в игре (джинксы «есть или был»)
  for (const p of S.players) { p.alive = true; p.ghost = true; p.tokens = []; }
  S.flags.demonless = !S.players.some(isDemon);
  // Головоломщик: пьяный не выбран (или игрока нет) — случайный Горожанин
  if (inPlay(S, 'puzzlemaster') && !(S.flags.puzzleDrunk && P(S, S.flags.puzzleDrunk))) S.flags.puzzleDrunk = puzzleDrunkDefault(S);
  // выбор подготовки остаётся от прежней раздачи — ставим отметку, только если роль правда в игре (иначе выбор сбрасываем)
  for (const [flag, rid, tok] of [['grandchild', 'grandmother', 'grandchild'], ['ftHerring', 'fortuneteller', 'herring'], ['goodTwin', 'eviltwin', 'twin'], ['puzzleDrunk', 'puzzlemaster', 'drunk']]) {
    const q = S.flags[flag] && P(S, S.flags[flag]);
    if (q && inPlay(S, rid)) addTok(S, q, tok, rid); else S.flags[flag] = null;
  }
  // история для фактов Саванта (2026-10-16): есть только у игр, начатых после обновления (`hist` — признак)
  const tm = countTeams(S);
  S.flags.hist = { teams: { townsfolk: tm.townsfolk, outsider: tm.outsider }, picks: [], exe: [], poison: [], off: [], abn: [] };
  log(S, `Игра началась: ${S.players.length} игроков, сценарий «${S.script.name}»`, 'phase');
  startNight(S);
}
// пьян или отравлен (Пьяница и Марионетка — тоже пьяны; Безумец — нет)
const droisoned = (S, p) => { const o = abilityOff(S, p) || ''; return /^отравл/.test(o) ? 'poison' : /^(пьян|Пьяница|Марионетка)/.test(o) ? 'drunk' : null; };

/* ------------------------------------------------------------ ночь */

function startNight(S) {
  S.n += 1; S.phase = 'night';
  expire(S, 'dusk');
  // для фактов Саванта: picks — кого игроки выбирали способностью; start — роли и мёртвые злые в начале ночи
  const deadEvil = () => S.players.filter(p => !p.alive && p.align === 'evil' && !isTraveller(p)).length;
  S.night = { i: 0, deaths: [], woke: [], steps: [], data: { picks: [], pv: 2,
    start: { roles: Object.fromEntries(S.players.map(p => [p.id, p.role])), deadEvil: deadEvil() } } };
  S.night.steps = buildSteps(S);
  log(S, `Наступила ночь ${S.n}`, 'phase');
  rpStart(S);
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
    if (id === 'marionette') actors = S.players.filter(p => p.role === 'marionette'); // она просыпается как «своя» роль, а этот шаг — Демону
    if (id === 'scarletwoman' && S.flags.swBecame) actors = actors.concat([P(S, S.flags.swBecame)]);
    for (const p of actors) steps.push({ key: id + ':' + p.id, id, pid: p.id });
  }
  // Безумец при 5–6 игроках: шага «Информация Демону» нет, а Демон всё равно узнаёт Безумца (вики) — отдельный шаг после Безумца
  if (first && S.players.some(p => p.role === 'lunatic') && S.players.some(isDemon) && !steps.some(s => s.id === 'demoninfo')) {
    const at = steps.map(s => s.id).lastIndexOf('lunatic'), dawn = steps.findIndex(s => s.id === 'dawn');
    steps.splice(at >= 0 ? at + 1 : dawn >= 0 ? dawn : steps.length, 0, { key: 'demoninfo:lunatic', id: 'demoninfo', pid: null, lunatic: true });
  }
  // Девица при Дурманщике (злые не знакомятся): Приспешников будят по одному — сразу после блефов Демону (заметка пользователя 2026-10-15)
  if (first && meetingBlocker(S)) {
    const k = steps.findIndex(s => s.id === 'damsel');
    if (k >= 0) {
      const [dam] = steps.splice(k, 1), ord = order.indexOf('demoninfo'), di = steps.findIndex(s => s.id === 'demoninfo');
      const at = di >= 0 ? di + 1 : steps.findIndex(s => order.indexOf(s.id) > ord);
      steps.splice(at >= 0 ? at : steps.length, 0, dam);
    }
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
function addFresh(S, pid, role, night) { S.flags.fresh = (S.flags.fresh || []).filter(f => f.night >= S.n && f.pid !== pid).concat({ pid, role, night: night || S.n }); }
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
  S.flags.abnPrev = S.flags.abn || []; // для фактов Саванта: сбои со вчерашнего утра
  // факты Саванта: кто на рассвете пьян/отравлен, сколько мёртвых злых; история игры (выборы, яд, сбои) — если игра её ведёт
  const offNow = S.players.filter(p => p.alive && !isTraveller(p) && droisoned(S, p)), poisonNow = offNow.filter(p => droisoned(S, p) === 'poison').map(p => p.id);
  if (S.night.data.pv) Object.assign(S.night.data, { off: offNow.map(p => p.id), dawnDeadEvil: S.players.filter(p => !p.alive && p.align === 'evil' && !isTraveller(p)).length });
  const H = S.flags.hist;
  if (H && S.night.data.pv) {
    S.night.data.newPoison = poisonNow.filter(id => !H.poison.includes(id));
    H.poison = [...new Set(H.poison.concat(poisonNow))];
    H.off = [...new Set(H.off.concat(offNow.map(p => p.id)))];
    H.abn = [...new Set(H.abn.concat(S.flags.abnPrev.map(a => a.pid)))];
    H.picks = H.picks.concat(S.night.data.picks.map(x => Object.assign({ n: S.n }, x)));
  }
  S.flags.abn = []; // Математик считает «с рассвета»
  const deaths = nightDeaths(S).map(d => nm(S, d.pid)), back = (S.night.revived || []).filter(id => P(S, id) && P(S, id).alive).map(id => nm(S, id));
  S.phase = 'day';
  S.lastDay = S.day;
  S.day = { n: S.n, noms: [], executed: null, executionDeath: null, deaths: [], outsiderDied: false, demonVoted: false, minionNominated: false, nominated: [], nominators: [],
    exiled: [], draft: { by: null, on: null, voters: [], stage: 'pick', spy: false } };
  S.flags.swBecame = S.flags.swNight && S.flags.swNight <= S.n ? null : S.flags.swBecame;
  log(S, (deaths.length ? `Рассвет. Этой ночью умерли: ${deaths.join(', ')}` : 'Рассвет. Этой ночью никто не умер') + (back.length ? `. Снова жив: ${back.join(', ')}` : ''), 'phase');
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
  if (hasTok(by, 'cursed', 'witch') && holders(S, 'witch').some(w => w.alive && !abilityOff(S, w)) && aliveCount(S) > 3) {
    const guard = deathGuard(S, by, 'ability');
    out.notes.push(guard ? `${by.name} проклят Ведьмой, но не умрёт: ${guard} (номинация состоится)` : `${by.name} проклят Ведьмой: номинировав, он умрёт (номинация всё равно состоится)`);
  }
  if (actsAs(by) === 'golem') out.notes.push(S.flags['golemUsed_' + by.id] ? 'Голем уже номинировал в этой игре — больше нельзя (вики: номинацию лучше не принимать)'
    : isDemon(on) ? 'Голем номинирует Демона — ничего не произойдёт (не говорите почему)' : abilityOff(S, by) ? 'Голем пьян или отравлен — номинированный не умрёт'
    : `Голем номинирует: ${on.name} сразу умрёт (если не защищён)${on.role === 'recluse' ? '. Затворник может определиться Демоном — тогда ничего (решите сами, отменив номинацию)' : ''}`);
  if (actsAs(on) === 'virgin' && !S.flags['virginUsed_' + on.id]) {
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
  d.nomBy = Object.assign({}, d.nomBy, { [onId]: byId }); // кто кого номинировал (Психопат играет с номинировавшим)
  S.flags.nomHist = (S.flags.nomHist || []).concat({ n: S.n, by: by ? byId : null, byAlign: by ? by.align : null, on: onId, onAlign: on.align }); // история для итога Политика и фактов Саванта
  if (by && realTeam(by) === 'minion') d.minionNominated = true;
  log(S, `${by ? by.name : 'Рассказчик'} номинирует ${on.name}${d.butcherOpen ? ' (Мясник, после казни)' : ''}`, 'day');
  if (!by) { if (actsAs(on) === 'virgin') S.flags['virginUsed_' + on.id] = true; return res; }
  // Ведьма
  // защиты действуют: соседа Травницы, Моряка, Шута (1-я смерть) проклятие не убивает (вики, Травница: «не умирают никак»)
  if (hasTok(by, 'cursed', 'witch') && holders(S, 'witch').some(w => w.alive && !abilityOff(S, w)) && aliveCount(S) > 3) {
    log(S, `${by.name} проклят Ведьмой и номинирует`, 'effect');
    const r = attemptKill(S, by, 'ability', 'witch');
    res.notes.push(r.died ? `${by.name} умирает: проклятие Ведьмы` : `${by.name} проклят Ведьмой, но не умирает: ${r.why}`);
  }
  // Голем (вики): номинирует раз за игру; номинированный не Демон — сразу умирает, голосование продолжается (не объявлять почему)
  if (actsAs(by) === 'golem' && !S.flags['golemUsed_' + by.id]) {
    S.flags['golemUsed_' + by.id] = true;
    if (abilityOff(S, by)) { if (!isDemon(on)) recordAbn(S, by, `${on.name} не умер`, abnSource(S, by)); }
    else if (!isDemon(on)) { log(S, `Голем (${by.name}) номинировал не Демона`, 'effect'); const r = attemptKill(S, on, 'ability', 'golem'); res.notes.push(r.died ? `${on.name} умирает: Голем (не говорите почему; голосование продолжается)` : `${on.name} не умирает: ${r.why}`); }
    else res.notes.push('Голем номинировал Демона — ничего не происходит (не говорите почему)');
  }
  const wd = S.flags.witchDud; // Ведьма прокляла, будучи пьяной/отравленной: номинация без последствий — для Математика
  if (wd && wd.t === by.id && wd.n === S.n && aliveCount(S) > 3 && P(S, wd.w)) { recordAbn(S, P(S, wd.w), 'проклятие не сработало', wd.src); S.flags.witchDud = null; }
  // Девственница
  if (actsAs(on) === 'virgin' && !S.flags['virginUsed_' + on.id]) {
    S.flags['virginUsed_' + on.id] = true;
    const tf = realTeam(by) === 'townsfolk' || (by.role === 'spy' && opts.spyTownsfolk);
    if (!abilityOff(S, on) && tf && by.alive) {
      log(S, `Девственница: ${by.name} — Горожанин, его немедленно казнят`, 'effect');
      execute(S, byId); res.ended = true; res.notes.push(`${by.name} казнён немедленно (Девственница)`);
    } else {
      if (tf && by.alive) recordAbn(S, on, 'не сработала', abnSource(S, on));
      res.notes.push('Девственница: казни нет, способность потрачена');
    }
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
  // история голосов за всю игру (итог Политика): сторона номинированного — на момент голосования
  S.flags.voteHist = (S.flags.voteHist || []).concat({ n: S.n, on: onId, onAlign: P(S, onId) ? P(S, onId).align : null, voters: voterIds.slice() });
  d.butcherOpen = false; // Мясник номинирует ещё раз только однажды
  log(S, `Голосование за ${nm(S, onId)}: ${count}${count !== raw ? ` (рук ${raw})` : ''} (нужно ${voteThreshold(S)})`, 'day');
  return block(S);
}

// кто из голосующих сейчас потратит голос призрака: мёртвые, у которых он ещё был (при Шамане Вуду голос не тратится).
// После подсчёта — окно «последнего голоса лишились» (заметка пользователя 2026-10-16)
const ghostSpent = (S, voterIds) => voudonActive(S) ? [] : voterIds.map(id => P(S, id)).filter(v => v && !v.alive && v.ghost);
// сколько голосов нужно текущей номинации (заметка пользователя 2026-10-16): для казни — порог, а если кто-то уже на плахе —
// на 1 больше, чем у него; для отмены — столько же, сколько у него (ничья — никого не казнят). Номинация Мясника — только порог
function voteNeeds(S) {
  const th = voteThreshold(S), d = S.day;
  if (d.lastNom && d.lastNom.butcher) return { exec: th, cancel: null };
  const top = Math.max(0, ...d.noms.filter(x => !x.butcher && !x.open && x.count >= th).map(x => x.count));
  return top ? { exec: top + 1, cancel: top } : { exec: th, cancel: null };
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
  if (S.flags.hist) S.flags.hist.exe.push({ n: S.n, pid, team: realTeam(p) }); // история казней (факты Саванта)
  log(S, `Казнь: ${p.name}`, 'day');
  if (S.flags.goodTwin === pid && S.players.some(q => q.role === 'eviltwin' && q.alive && !abilityOff(S, q)))
    return endGame(S, 'evil', 'казнён добрый близнец');
  if (S.flags.mastermindDay && S.flags.mastermindDay === S.n) {
    return endGame(S, p.align === 'good' ? 'evil' : 'good', `Кукловод: в дополнительный день казнён ${p.align === 'good' ? 'добрый' : 'злой'} игрок`);
  }
  // итог казни — для окна после «Завершить день» (заметка пользователя 2026-10-14: «казнили — умирает или не умирает, кнопка Продолжить»)
  const res = why => { S.day.exeResult = { pid, n: S.n, died: !why, why: why || '' }; };
  if (opts.pacifist && p.align === 'good' && roleWorks(S, 'pacifist')) { S.flags.pacifistSaves = (S.flags.pacifistSaves || 0) + 1; log(S, `${p.name} не умирает: Пацифист`, 'save'); return res('Пацифист'); }
  // Психопат (вики): казнён — играет в «камень-ножницы-бумагу» с номинировавшим (самономинация — с рассказчиком);
  // умирает, только если проиграл. Ничья или выигрыш — жив, но казнь дня состоялась
  if (actsAs(p) === 'psychopath' && !abilityOff(S, p) && opts.roshambo === 'live') {
    log(S, `${p.name} казнён, но не проиграл в «камень-ножницы-бумагу» — не умирает (Психопат)`, 'save'); return res('Психопат: ничья или выигрыш в «камень-ножницы-бумагу»');
  }
  // казнён мёртвый (например, убитый Големом при номинации — голосование по вики продолжается): «уже мёртв», а не «не умирает»
  if (!p.alive) { S.day.exeResult = { pid, n: S.n, died: false, dead: true, why: 'уже мёртв' }; log(S, `${p.name} уже мёртв — казнь дня состоялась`, 'day'); return; }
  const r = attemptKill(S, p, 'execution');
  res(r.died ? '' : r.why);
  if (r.died) {
    S.day.executionDeath = pid;
    if (actsAs(p) === 'saint' && !abilityOff(S, p)) return endGame(S, 'evil', 'казнён Святой');
    if (!r.fake) cannibalEats(S, p);
  }
}
// работает ли способность (жив, трезв) у кого-то с этой ролью или полученной ею
const roleWorks = (S, rid) => S.players.some(q => actsAs(q) === rid && q.alive && !abilityOff(S, q));
// что нужно решить до казни (окно после «Завершить день»): Пацифист — помиловать доброго; Психопат — «камень-ножницы-бумага»
function exeQuestions(S, pid) {
  const p = P(S, pid); if (!p || !p.alive) return []; // мёртвого казнят без вопросов — он остаётся мёртвым
  const out = [];
  if (p.align === 'good' && roleWorks(S, 'pacifist')) out.push('pacifist');
  if (actsAs(p) === 'psychopath' && !abilityOff(S, p)) out.push('roshambo');
  return out;
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

// Девица (вики): Приспешник публично называет игрока Девицей — одна догадка на всех Приспешников за игру.
// Угадал живую Девицу (её способность работает) — победа зла; не угадал — догадок больше нет (жетон «Угадать использованное»)
function damselGuess(S, byId, onId) {
  const by = P(S, byId), on = P(S, onId), d = S.players.find(q => q.role === 'damsel');
  if (!by || !on || S.flags.damselGuessUsed || realTeam(by) !== 'minion') return null;
  S.flags.damselGuessUsed = true;
  if (d) addTok(S, d, 'guessused', 'damsel');
  const hit = !!d && on === d && d.alive && !abilityOff(S, d);
  log(S, `${by.name} (Приспешник) называет Девицей ${on.name}: ${hit ? 'угадал' : on === d ? 'это Девица, но её способность не работает' : 'не угадал'}`, 'day');
  if (hit) endGame(S, 'evil', `Приспешник ${by.name} угадал Девицу (${on.name})`);
  return { hit };
}

// Безумие нарушено (вики, Цереновус и Уродец): рассказчик может казнить игрока — это казнь за день (их не больше одной),
// днём после неё сразу наступает ночь. Мёртвого тоже можно «казнить» — тогда сегодня больше никого не казнят
function madnessExecute(S, pid, src) {
  if (S.phase !== 'day' || S.day.executed || !P(S, pid)) return false;
  log(S, `${nm(S, pid)}: безумие нарушено — рассказчик казнит (${rname(src)})`, 'day');
  execute(S, pid);
  if (!S.result) endDay(S, { skipExecution: true });
  return true;
}
// Гарпия (вики): первый игрок не «помешан», что второй злой, — рассказчик может убить одного, обоих или никого (это смерть, не казнь)
function harpyKill(S, ids) {
  for (const id of ids) { const q = P(S, id); if (q && q.alive) attemptKill(S, q, 'ability', 'harpy'); }
  S.players.forEach(q => { rmTok(q, 'mad', 'harpy'); rmTok(q, 'second', 'harpy'); });
}

// Психопат (вики): раз в день, до номинаций, публично выбирает игрока — тот умирает (заметка пользователя 2026-10-14: «нет кнопки»)
function psychopathKill(S, pid, tid) {
  const p = P(S, pid), t = P(S, tid); if (!p || !t || S.phase !== 'day' || (S.day.psychoUsed || {})[pid]) return false;
  S.day.psychoUsed = Object.assign({}, S.day.psychoUsed, { [pid]: true });
  log(S, `Психопат (${p.name}) публично выбирает ${t.name}`, 'day');
  if (abilityOff(S, p)) { log(S, `${t.name} не умирает — способность Психопата не работает`, 'day'); recordAbn(S, p, `${t.name} не умер`, abnSource(S, p)); return true; }
  attemptKill(S, t, 'minion', 'psychopath');
  return true;
}
// Яга создала Демона — советы вики (Яга, How to Run) для окна сразу после её шага (заметка пользователя 2026-10-15)
function pithagAdvice(S) {
  const a = S.night && S.night.data.pithagInfo; if (!a) return null;
  const t = P(S, a.pid), who = `${t ? t.name : '—'} — ${rname(a.role)}`;
  const lines = ['Смерти этой ночью — на ваше усмотрение: можно убить или защитить любых игроков, чтобы уравновесить игру. Лишние смерти считаются нападением Яги.'];
  if (a.kind === 'changed') lines.push(`Демон стал другим Демоном (${who}). Лучше, чтобы этой ночью никто не умер: так добрые поймут, что Демон сменился. Можно разбудить нового Демона, выслушать его выбор и решить, что никто не умирает (на шаге Демона — «Пропустить»).`);
  else if (a.kind === 'evil') lines.push(`Создан новый злой Демон (${who}). Лучше убить старого Демона и ещё одного игрока — это знак добрым, что Демон сменился.`);
  else lines.push(`Создан добрый Демон (${who}). Если это последняя ночь — лучше убить одного из Демонов, чтобы днём был жив только один. Если нет — можно оставить двух Демонов, но осторожно: чтобы победило добро, должны умереть все Демоны.`);
  return { title: 'Яга создала Демона', lines, src: 'Вики, страница Яги (How to Run)' };
}
// Политик (вики): в конце игры — если больше всех виноват в поражении своей команды, меняет сторону и побеждает. Перед объявлением
// победы рассказчик видит его статистику — сколько номинировал сам (добрых / злых) и за казнь кого голосовал — и решает, на чьей
// он стороне (заметка пользователя 2026-10-16). Сторона номинированного — на момент номинации или голосования
function politicianStats(S, pid) {
  const noms = (S.flags.nomHist || []).filter(x => x.by === pid), votes = (S.flags.voteHist || []).filter(x => x.voters.includes(pid));
  const of = (list, a) => list.filter(x => x.onAlign === a).length;
  return { noms: noms.length, nomGood: of(noms, 'good'), nomEvil: of(noms, 'evil'), votes: votes.length, voteGood: of(votes, 'good'), voteEvil: of(votes, 'evil') };
}
const politiciansPending = S => S.phase === 'over' && S.result ? S.players.filter(p => p.role === 'politician' && !S.flags['polDone_' + p.id]) : [];
function politicianSide(S, pid, align) {
  const p = P(S, pid); if (!p || !S.result) return;
  const was = p.align; p.align = align === 'evil' ? 'evil' : 'good'; S.flags['polDone_' + pid] = true;
  const win = p.align === S.result.winner;
  log(S, `Политик (${p.name}) в итоге ${p.align === 'good' ? 'добрый' : 'злой'}${was !== p.align ? ' — меняет сторону' : ''}: ${win ? 'побеждает' : 'проигрывает'} вместе ${p.align === 'good' ? 'с добром' : 'со злом'}`, win ? 'win' : 'day');
}
// Сплетница: в конце дня рассказчик отмечает, делала ли она публичное заявление (заметка пользователя 2026-10-15).
// Спрашиваем о каждой живой «Сплетнице» (и Пьянице, который ею себя считает: он тоже делает заявления)
const gossipPending = S => S.phase === 'day' && S.day ? S.players.filter(p => actsAs(p) === 'gossip' && p.alive && !((S.day.gossip || {})[p.id])) : [];
function setGossip(S, pid, made, text) {
  const p = P(S, pid); if (!p || !S.day) return;
  text = String(text || '').trim();
  S.day.gossip = Object.assign({}, S.day.gossip, { [pid]: { made: !!made, text } });
  log(S, made ? `Сплетница (${p.name}) сделала публичное заявление${text ? `: «${text}»` : ''}` : `Сплетница (${p.name}) сегодня заявления не делала`, 'day');
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
  if (!d.executed && !d.holdForChoice) { // день уже держали до выбора Растяпы/Дитя Луны — итог «без казни» подведён
    log(S, 'День закончился без казни', 'day');
    if (vortoxActive(S)) return endGame(S, 'evil', 'Вортокс: день прошёл без казни');
    const mayor = S.players.find(p => actsAs(p) === 'mayor' && p.alive && !abilityOff(S, p));
    if (mayor && aliveCount(S) === 3 && !twinsBlockGood(S)) return endGame(S, 'good', 'Мэр: трое живых и нет казни');
    if (S.flags.mastermindDay === S.n) return endGame(S, 'good', 'Кукловод: в дополнительный день никого не казнили');
  }
  if (checkWin(S)) return;
  // Растяпа или Дитя Луны умерли днём (казнь, Ведьма…): узнают о смерти сразу и публично выбирают игрока — до ночи
  // (вики: «когда узнаёте, что умерли»). Раньше ночь наступала сразу, и выбор всплывал только на следующий день (заметка
  // пользователя 2026-10-13). День держим один раз: следующее «Завершить день» начинает ночь, даже если выбора нет
  const pend = [S.flags.klutzPending, S.flags.moonchildPending].filter(Boolean);
  if (pend.length && !d.holdForChoice) {
    d.holdForChoice = true;
    log(S, `До наступления ночи: ${pend.map(id => `${rname(P(S, id).role)} (${nm(S, id)})`).join(' и ')} публично выбирает игрока`, 'day');
    return;
  }
  startNight(S);
}

function slayerShot(S, slayerId, targetId, registersAsDemon) {
  const s = P(S, slayerId), t = P(S, targetId);
  S.flags['slayerUsed_' + slayerId] = true;
  log(S, `Истребитель ${s.name} стреляет в ${t.name}`, 'day');
  if (!abilityOff(S, s) && (isDemon(t) || registersAsDemon)) {
    attemptKill(S, t, 'ability', 'slayer');
  } else {
    log(S, 'Ничего не происходит', 'day');
    if (isDemon(t) || registersAsDemon) recordAbn(S, s, 'выстрел в Демона не сработал', abnSource(S, s));
  }
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
  attemptKill(S, p, 'exile', null); // вики, Травница: изгнанный сосед Травницы остаётся жив
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
      const fake = stable(S, 'duchessFake', () => pick([0, 1, 2, 3].filter(x => x !== n)));
      return { show: `Злых посетителей: ${n}`, lines: [`Покажите это число двоим, ${f ? f.name : 'третьему'} — любое другое (подсказка: ${fake})`, ...regNote(S, inp.t)],
        tokens: vs.map(q => ({ label: q.name, caption: CARD.selected, role: 'duchess', text: String(f && q.id === f.id ? fake : n) })) };
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
  if (role.team === 'demon' && S.night.data.pithagDemon) base.warn.push(S.night.data.pithagDemon === 'changed'
    ? 'Яга превратила Демона в другого Демона: смерти этой ночью — на ваше усмотрение. Вики советует, чтобы никто не умер (знак добрым, что Демон сменился): выслушайте выбор Демона и нажмите «Пропустить».'
    : 'Яга создала Демона этой ночью: смерти — на ваше усмотрение (вики). Нападение можно пропустить.');
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
  spec.dist = distortion(S, p); // для «ядовитой» рамки ответа: пьян/отравлен/Вортокс
  // Безумец (вики): каждую ночь, кроме первой, перед нападением Демона — разбудить настоящего Демона, указать на Безумца,
  // показать жетон Безумца и указать, кого Безумец «атаковал» (заметка пользователя 2026-10-14). В 1-ю ночь — на шаге Безумца
  const lun = spec.active && role.team === 'demon' && p.role !== 'lunatic' && !first ? S.players.find(q => q.role === 'lunatic') : null;
  // ответ «да/нет» или число — тоже можно показать на весь экран
  const info0 = spec.info;
  spec.info = inp => {
    let r = info0(inp);
    if (lun) {
      const vic = S.night.data.lunatic || [];
      r = Object.assign({ show: null, lines: [] }, r || {});
      r.lines = [`Сначала покажите Демону Безумца (${lun.name})${vic.length ? ` и кого он «атаковал»: ${vic.map(id => nm(S, id)).join(', ')}` : ''}`].concat(r.lines || []);
      r.tokens = [{ label: `Демону (${p.name})`, caption: CARD.thisPlayer, role: 'lunatic', players: [lun.id] }]
        .concat(vic.length ? [{ label: `Демону (${p.name})`, players: vic, sub: 'Безумец «атаковал» этих игроков' }] : [], r.tokens || []);
    }
    if (r && !r.secret && !r.tokens && typeof r.show === 'string') {
      const yn = r.show.match(/^(ДА|НЕТ)(?![А-ЯЁа-яё])/); // \b в JS не видит границу кириллических слов
      if (yn) r.tokens = [{ text: yn[1] }]; else if (/^\d+$/.test(r.show)) r.tokens = [{ text: r.show }];
    }
    return r;
  };
  spec.bounds = boundsFor(step.id, first).slice();
  if (!spec.bounds.length) spec.bounds.push({ w: 'Способность', t: role.ability });
  if (off) spec.bounds.push(Y('Способность не работает: можно показать любую информацию, эффекты не применяются'));
  if (p.role === 'cannibal') spec.bounds.push(Y('Каннибалу не говорят, чья это способность: будите его как обычную роль'));
  return spec;
}

function specialSpec(S, step, first) {
  const sp = DATA.special[step.id];
  const spec = { title: sp.name, who: '', text: (first ? sp.first : sp.other) || '', active: true, reason: '', inputs: [], defaults: {}, warn: [], info: () => null, apply: () => {}, bounds: boundsFor(step.id, first) };
  // Марионетка (вики) не просыпается с Приспешниками и не узнаётся ими; Демон узнаёт её на её шаге
  const minions = S.players.filter(p => realTeam(p) === 'minion' && p.role !== 'marionette'), demon = S.players.find(isDemon);
  // Приспешникам — только «ЭТО ДЕМОН» (друг друга они видят, проснувшись вместе; решение пользователя); Демону — Приспешники и блефы
  const minionCards = () => [{ label: 'Приспешникам', caption: CARD.demon, players: demon ? [demon.id] : [] }];
  const demonCards = () => [{ label: 'Демону', caption: CARD.minions, players: minions.map(m => m.id) }];
  if (step.id === 'minioninfo') spec.info = () => ({ show: `Демон: ${demon ? demon.name : '—'}`, lines: [`Приспешники: ${minions.map(m => m.name).join(', ') || '—'}`], tokens: minionCards() });
  const blocker = meetingBlocker(S);
  if (step.meet) {
    spec.title = step.id === 'minioninfo' ? 'Злые знакомятся: Приспешники' : 'Злые знакомятся: Демон';
    spec.text = step.id === 'minioninfo' ? 'Разбудите Приспешников, пусть посмотрят друг на друга. Покажите жетон *ЭТО ДЕМОН* и укажите на Демона.'
      : 'Разбудите Демона. Покажите жетон *ЭТО ВАШИ ПРИСПЕШНИКИ* и укажите на Приспешников.';
    spec.bounds = [Y('Носитель свойства «злые не знакомятся» умер трезвым — злые узнают друг друга этой ночью')];
    if (step.id === 'demoninfo') spec.info = () => ({ show: `Приспешники: ${minions.map(m => m.name).join(', ') || '—'}`, lines: [], tokens: demonCards() });
    return spec;
  }
  if (first && blocker && step.id === 'minioninfo') { spec.active = false; spec.reason = `в игре ${rname(blocker.role)} — Приспешники и Демон не знакомятся`; }
  // Безумец (вики): в 1-ю ночь настоящему Демону — «ТЕПЕРЬ ВЫ» и его жетон, затем «ЭТОТ ИГРОК» и жетон Безумца. Показ — в блоке
  // настоящего Демона, а не на шаге Безумца (заметка пользователя 2026-10-15); при 5–6 игроках — отдельный шаг (buildSteps)
  const lun = first && step.id === 'demoninfo' ? S.players.find(p => p.role === 'lunatic') : null;
  const lunCards = () => lun && demon ? [{ label: 'Демону', caption: CARD.youAre, role: demon.role }, { label: 'Демону', caption: CARD.thisPlayer, role: 'lunatic', players: [lun.id] }] : [];
  const lunLine = lun ? `Безумец: ${lun.name} — считает себя Демоном (${rname(lun.believes)}). Покажите Демону, что он настоящий Демон, и кто Безумец` : '';
  if (step.lunatic) {
    spec.title = 'Демон узнаёт Безумца';
    spec.text = 'Разбудите Демона. Покажите жетон *ТЕПЕРЬ ВЫ* и его жетон Демона, затем жетон *ЭТОТ ИГРОК* и жетон Безумца — укажите на Безумца.';
    spec.bounds = [Y('Безумец считает себя Демоном; настоящий Демон знает, кто он (вики). Меньше 7 игроков — Приспешников и блефов Демону не показывают')];
    spec.info = () => ({ show: `Безумец: ${lun ? lun.name : '—'}`, lines: [], tokens: lunCards() });
    return spec;
  }
  if (first && blocker && step.id === 'demoninfo') {
    spec.text = 'Разбудите Демона. Покажите жетон *ЭТИХ РОЛЕЙ В ИГРЕ НЕТ* и 3 жетона добрых ролей, которых нет в игре. Приспешников не показывайте.';
    spec.bounds = [Y(`В игре ${rname(blocker.role)}: Демон получает только блефы, без знакомства с Приспешниками`)];
    spec.info = () => ({ show: `Блефы: ${S.bluffs.map(rname).join(', ')}`, lines: [lunLine], tokens: lunCards().concat(bluffCards(S, 'Демону')) });
    return spec;
  }
  if (step.id === 'demoninfo') {
    spec.info = () => ({ show: `Блефы: ${S.bluffs.map(rname).join(', ')}`, lines: [`Приспешники: ${minions.map(m => m.name).join(', ') || '—'}`, lunLine],
      tokens: lunCards().concat(demonCards(), bluffCards(S, 'Демону')) });
  }
  if (step.id === 'dawn') {
    const pend = [];
    if (S.flags.moonchildPending) pend.push(`Дитя Луны (${nm(S, S.flags.moonchildPending)}) днём выберет игрока`);
    if (S.flags.klutzPending) pend.push(`Растяпа (${nm(S, S.flags.klutzPending)}) днём выберет игрока`);
    const back = (S.night.revived || []).filter(id => P(S, id) && P(S, id).alive).map(id => nm(S, id));
    // Аль-Адихия (вики): на рассвете объявить, кто из троих выбранных жив, а кто мёртв — даже если ничего не изменилось
    const alh = (S.night.data.alh || []).map(id => P(S, id)).filter(Boolean);
    if (alh.length) pend.unshift(`Аль-Адихия: объявите, кто из выбранных жив и кто мёртв — ${alh.map(q => `${q.name}: ${q.alive ? 'жив' : 'мёртв'}`).join(', ')}`);
    // «Снова жив» — так же крупно, как смерти (заметка пользователя 2026-10-15, Аль-Адихия)
    spec.info = () => ({ show: nightDeaths(S).length ? `Умерли: ${nightDeaths(S).map(d => nm(S, d.pid)).join(', ')}` : 'Никто не умер', show2: back.length ? `Снова жив: ${back.join(', ')}` : null,
      lines: [back.length ? 'Объявите после смертей, что они снова живы (не говорите почему)' : ''].concat(pend) });
  }
  return spec;
}

/* --- помощники для логики ролей */
// Амнезиак: какую карточку показать — по способности из подсказок (ideas.js), иначе не знаем
const AMN_SHOW = [{ v: 'none', l: 'Ничего' }, { v: 'yesno', l: 'ДА / НЕТ' }, { v: 'number', l: 'Число' }, { v: 'role', l: 'Роль' }, { v: 'player', l: 'Игроков' }, { v: 'text', l: 'Свой текст' }];
function amnKind(ab) {
  if (typeof IDEAS === 'undefined' || !IDEAS.AMNESIAC_KIND) return null;
  const i = IDEAS.AMNESIAC.indexOf(String(ab || '').trim());
  return i >= 0 ? IDEAS.AMNESIAC_KIND[i] || null : null;
}
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
// случайная рекомендация не меняется от перерисовки; хранится отдельно (night.data.st) — переигрывание ночи (правка из журнала) её сохраняет
function stable(S, key, fn) { const d = S.night.data.st || (S.night.data.st = {}); if (!(key in d)) d[key] = fn(); return d[key]; }
const once = (S, p, key) => S.flags[key + '_' + p.id];
const markOnce = (S, p, key) => { S.flags[key + '_' + p.id] = true; };
const scriptRoles = (S, f) => S.script.roles.filter(r => R(r) && (!f || f(r)));

function demonKill(S, p, off, t, inp, cause) {
  if (off) { log(S, `${rname(p.role)} выбирает ${t.name} — способность не работает`, 'action'); if (t.alive) recordAbn(S, p, `нападение на ${t.name} не сработало`, abnSource(S, p)); return; }
  let target = t;
  // Мэр (вики): «если Мэра атаковали и он умер бы» — рассказчик может решить, что умирает другой. Под защитой (Монах, Травница…)
  // Мэр не умер бы — рикошета нет. Выбран мёртвый, Солдат или защищённый Монахом — этот игрок не умирает (вики)
  if (actsAs(t) === 'mayor' && !abilityOff(S, t) && inp.bounce && inp.bounce[0] && inp.bounce[0] !== t.id && !deathGuard(S, t, cause || 'demon')) {
    target = P(S, inp.bounce[0]); log(S, `Мэр: вместо ${t.name} умирает ${target.name}`, 'effect');
  }
  log(S, `${rname(p.role)} (${p.name}) атакует ${t.name}`, 'action');
  return attemptKill(S, target, cause || 'demon', p.role);
}
// Мэр атакован: кто умрёт вместо него — по желанию рассказчика (не выбрано — умирает Мэр). Защищён — рикошета нет, только пометка
function mayorInput(S, inp) {
  const t = inp.t && P(S, inp.t[0]);
  if (!t || actsAs(t) !== 'mayor' || abilityOff(S, t)) return [];
  const guard = deathGuard(S, t, 'demon');
  if (guard) return [{ type: 'note', key: '_mayor', label: `Мэр под защитой (${guard}) — не умирает, рикошета нет (вики: другой умирает, только если Мэр умер бы).` }];
  return [PL('bounce', 1, 'Мэр: кто умрёт вместо него? (не выбрано — умрёт Мэр; мёртвый, Солдат или под защитой Монаха — никто не умрёт)', null, { min: 0 })];
}
function demonExorcised(S, p, base) {
  if (S.night.data.exorcised === p.id) { base.active = false; base.reason = 'Экзорцист выбрал Демона: он не просыпается этой ночью'; return true; }
  return false;
}

// роль без своей логики (экспериментальные): сколько игроков выбирает — из текста способности («выберите 3 игроков»),
// не выбирает никого — без выбора; «Что показать» — на весь экран. Эффекты рассказчик отмечает вручную
// (заметка пользователя 2026-10-14: «у Аристократа выбор 2 игроков вместо 3», «проверяй логику в других сценариях»)
const WORD_N = { одного: 1, двух: 2, трёх: 3, трех: 3, четырёх: 4 };
function choiceCount(rid) {
  const a = (R(rid) && R(rid).ability || '').toLowerCase();
  if (!/выб(ер|ир|ра)/.test(a)) return 0; // выберите, выбирает, выбрать
  const m = a.match(/выб(?:ер|ир|ра)[а-яё]*[^.:]*?\s(\d+|одного|двух|трёх|трех|четырёх)\s+(?:\S+\s+)?игрок/); // \b не видит кириллицу
  if (m) return +m[1] || WORD_N[m[1]] || 1;
  return /игрок/.test(a) ? 1 : 0;
}
function genericLogic(S, p, first, off) {
  const rid = actsAs(p), n = choiceCount(rid);
  return {
    inputs: (n ? [PL('t', n, `Выбор игрока${n > 1 ? ` (до ${n})` : ''} — по способности`, () => true, { min: 0 })] : [])
      .concat([TEXT('say', 'Что показать игроку (число, ДА/НЕТ или слово; пусто — ничего)')]),
    info: inp => { const say = String(inp.say || '').trim();
      return { show: say ? say.toUpperCase() : null, lines: [`Способность: ${R(rid) ? R(rid).ability : ''}`, 'Эта роль ведётся вручную: эффекты (смерть, яд, защита, смена роли) отметьте в «Гримуаре»'],
        tokens: say && !/^(да|нет|\d+)$/i.test(say) ? [{ text: say.toUpperCase() }] : undefined }; },
    apply: inp => { const say = String(inp.say || '').trim();
      log(S, `${rname(rid)} (${p.name})${inp.t && inp.t.length ? ' выбирает: ' + inp.t.map(id => nm(S, id)).join(', ') : ''}${say ? ` — показано: ${say}` : ''}`, 'action'); },
  };
}

// Шпион может определиться добрым (Горожанином или Изгоем), Затворник — злым (Приспешником или Демоном)
const REG_AS = { spy: ['townsfolk', 'outsider'], recluse: ['minion', 'demon'] };
const TEAM_INS = { townsfolk: 'Горожанином', outsider: 'Изгоем', minion: 'Приспешником', demon: 'Демоном' };
const seatSort = (S, ids) => ids.slice().sort((a, b) => S.players.findIndex(q => q.id === a) - S.players.findIndex(q => q.id === b));
// какую роль можно показать вместо роли игрока t (Гробовщик, Смотритель воронов): верно — его роль, Шпиону и Затворнику —
// и роли, которыми они могут определиться; пьяному, отравленному, при Вортоксе — любая роль сценария (ложь).
// Свою роль показывающему ложной не предлагаем
function shownRoleGroups(S, p, t, dist) {
  const own = r => r === actsAs(p) || r === p.role;
  const reg = scriptRoles(S, r => (REG_AS[t.role] || []).includes(R(r).team) && r !== t.role && !own(r));
  const groups = [{ label: 'Настоящая роль', roles: [t.role] }];
  if (reg.length) groups.push({ label: `${rname(t.role)} может определиться другой ролью (решаете вы)`, roles: reg });
  if (dist) groups.push({ label: 'Ложная роль (пьян, отравлен или Вортокс)', roles: scriptRoles(S, r => r !== t.role && !own(r) && !reg.includes(r)) });
  return groups;
}

// Прачка, Библиотекарь, Сыщик: 2 игрока и роль. Рекомендация — верная, а при яде/пьянстве/Вортоксе — ложная.
// Список ролей — только то, что можно показать (заметка пользователя 2026-10-12): роли этого типа в игре; если в игре Шпион
// или Затворник, способные определиться этим типом, — и остальные роли типа; пьян/отравлен/Вортокс — любые роли типа (ложь).
// Роль и игроки связаны: выбрали роль — её обладатель сам встаёт в пару; выбрали игроков — роль берётся у того, кто этого типа
function infoPair(team) {
  return (S, p, first, off) => {
    const dist = distortion(S, p);
    const own = r => r === actsAs(p) || r === p.role; // свою роль не показываем
    const others = S.players.filter(q => q.id !== p.id);
    const cands = others.filter(q => realTeam(q) === team);
    const held = [...new Set(cands.map(q => q.role))].filter(r => !own(r));
    const regs = others.filter(q => (REG_AS[q.role] || []).includes(team));
    const rest = scriptRoles(S, r => R(r).team === team && !own(r) && !held.includes(r));
    const groups = [{ label: 'В игре', roles: held }];
    if (rest.length && (dist || regs.length)) groups.push({ label: dist ? 'Нет в игре — ложная информация' : `Нет в игре — если ${regs.map(q => `${q.name} (${rname(q.role)})`).join(' или ')} определится ${TEAM_INS[team]}`, roles: rest });
    // связь роли и игроков — только для верной информации (пьяному и отравленному рассказчик подбирает ложь сам)
    const bindT = inp => { if (dist) return; const sel = (inp.t || []).map(id => P(S, id)).filter(Boolean);
      if (sel.some(q => q.role === inp.r)) return; const h = sel.find(q => realTeam(q) === team && !own(q.role)); if (h) inp.r = h.role; };
    const bindR = inp => { if (dist || !inp.r) return; const h = others.find(q => q.role === inp.r), sel = inp.t || [];
      if (h && !sel.includes(h.id)) inp.t = [h.id].concat(sel.filter(id => id !== h.id).slice(-1)); };
    const def = stable(S, `pair:${team}:${p.id}:${dist ? 'f' : 't'}`, () => {
      if (dist) { // ложная: роль этого типа из сценария, которой нет ни у одного из двоих показанных
        const r = pick(scriptRoles(S, x => R(x).team === team && x !== actsAs(p) && x !== p.role)) || null; // не своя роль
        return { t: shuffle(S.players.filter(q => q.id !== p.id && q.role !== r)).slice(0, 2).map(q => q.id), r, none: '' };
      }
      const real = cands.length ? pick(cands) : null;
      const others = S.players.filter(q => q.id !== p.id && q !== real);
      return real ? { t: shuffle([real.id, pick(others).id]), r: real.role, none: '' } : { t: [], r: null, none: team === 'outsider' ? 'yes' : '' };
    });
    const correct = inp => inp.none === 'yes' ? !cands.length : !!inp.r && (inp.t || []).some(id => P(S, id) && P(S, id).role === inp.r);
    const pair = [PL('t', 2, 'Укажите на 2 игроков', notSelf(p), { bind: bindT }), ROLE('r', `Жетон роли (${TEAM_RU[team]})`, r => R(r).team === team, { groups, bind: bindR })];
    // Библиотекарь: «Изгоев нет» — тогда игроки и жетон не нужны
    const inputs = team === 'outsider' ? [CHOICE('none', 'Показать «Изгоев нет» (0)', [{ v: '', l: 'Нет' }, { v: 'yes', l: 'Да' }])] : pair;
    return {
      inputs, more: inp => team === 'outsider' && inp.none !== 'yes' ? pair : [], defaults: def,
      info: inp => {
        const ok = correct(inp), mustLie = dist && dist.must && ok ? 'Вортокс: нужна ЛОЖНАЯ информация' : '';
        if (inp.none === 'yes') return { show: '0 — Изгоев в игре нет', lines: [ok ? 'Верно' : 'Изгои в игре есть — это ложь', mustLie], tokens: [{ text: '0', sub: 'Изгоев в игре нет' }] };
        const ps = (inp.t || []).map(id => P(S, id));
        return { show: `${rname(inp.r)}: ${ps.map(q => q && q.name).join(' и ')}`, lines: [ok ? 'Информация верная' : 'Информация ложная', mustLie, ...regNote(S, inp.t || [])],
          tokens: inp.r ? [{ role: inp.r, players: seatSort(S, inp.t || []), lead: 'Эта роль — один из этих игроков:' }] : [] }; // по местам — порядок не выдаёт, кто верный
      },
      apply: inp => {
        log(S, `${rname(p.role === 'drunk' ? p.believes : p.role)} (${p.name}): ${inp.none === 'yes' ? 'Изгоев нет' : `${rname(inp.r)} — ${(inp.t || []).map(id => nm(S, id)).join(' или ')}`}`, 'info');
        if (dist && !correct(inp)) recordAbn(S, p, 'ложная информация', dist.src);
        // жетоны-напоминания, как в Гримуаре: у кого показанная роль — «Горожанин/Изгой/Приспешник», второй — ложная цель
        // (информация ложная — ложные цели оба); note — показанная роль
        const own = actsAs(p);
        S.players.forEach(q => { q.tokens = q.tokens.filter(t => !(t.k === 'shown' && t.src === own && t.by === p.id)); });
        if (inp.none !== 'yes' && inp.r) for (const id of inp.t || []) {
          const q = P(S, id); if (q) addTok(S, q, 'shown', own, null, { note: inp.r, wrong: q.role !== inp.r, by: p.id });
        }
      },
    };
  };
}

// Повар, Эмпат, Часовщик, Оракул: число. Рекомендация при искажении — на 1 больше или меньше верного
function countInfo(compute, label) {
  return (S, p, first, off) => {
    const dist = distortion(S, p), r0 = compute(S, p), truth = r0.n, num = typeof truth === 'number';
    const fake = stable(S, `count:${p.id}`, () => num ? (truth > 0 && Math.random() < 0.5 ? truth - 1 : truth + 1) : truth);
    return {
      inputs: num ? [NUM('n', label + ' — что показать')] : [], defaults: num ? { n: dist ? fake : truth } : {},
      info: inp => {
        const v = num ? (inp.n ?? truth) : truth;
        return { show: String(v), lines: [label, num && v !== truth ? `Верное число: ${truth}` : '', dist && dist.must && v === truth ? 'Вортокс: нужно ЛОЖНОЕ число' : '', ...(r0.lines || [])] };
      },
      apply: inp => {
        const v = num ? (inp.n ?? truth) : truth;
        log(S, `${rname(actsAs(p))} (${p.name}): ${v}${v !== truth ? ` (верное ${truth})` : ''}${off ? ' — способность не работает' : ''}`, 'info');
        if (dist && v !== truth) recordAbn(S, p, `ложное число ${v} вместо ${truth}`, dist.src);
      },
    };
  };
}
// «да/нет» с рекомендацией: верный ответ, а при искажении — противоположный; рассказчик может выбрать сам
function yesNo(S, p, truth, label) {
  const dist = distortion(S, p);
  const shown = inp => inp.ans ? inp.ans === 'yes' : (dist ? !truth : truth);
  return {
    dist, shown,
    field: Object.assign(CHOICE('ans', label || 'Что показать (по умолчанию — рекомендация)', [{ v: 'yes', l: 'Да' }, { v: 'no', l: 'Нет' }]), { optional: true, def: (dist ? !truth : truth) ? 'yes' : 'no' }),
    lines: inp => [shown(inp) !== truth ? `Верный ответ: ${truth ? 'да' : 'нет'}` : '', dist && dist.must && shown(inp) === truth ? 'Вортокс: нужен ЛОЖНЫЙ ответ' : ''],
    record: inp => { if (dist && shown(inp) !== truth) recordAbn(S, p, 'ложный ответ', dist.src); },
  };
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
  fortuneteller: (S, p, first, off) => {
    const truth = inp => (inp.t || []).map(id => P(S, id)).some(q => q && (isDemon(q) || q.id === S.flags.ftHerring));
    const yn = inp => yesNo(S, p, truth(inp));
    return {
      inputs: [PL('t', 2, 'Гадалка выбирает 2 игроков')],
      more: inp => (inp.t || []).length === 2 ? [yn(inp).field] : [],
      info: inp => {
        if ((inp.t || []).length < 2) return null;
        const y = yn(inp), s = y.shown(inp);
        return { show: s ? 'ДА — кивните' : 'НЕТ — покачайте головой', lines: [...y.lines(inp), `Ложная цель: ${nm(S, S.flags.ftHerring)}`, ...regNote(S, inp.t || [])] };
      },
      apply: inp => { const y = yn(inp); log(S, `Гадалка (${p.name}) проверяет ${(inp.t || []).map(id => nm(S, id)).join(' и ')}: ${y.shown(inp) ? 'да' : 'нет'}`, 'info'); y.record(inp); },
    };
  },
  undertaker: (S, p, first, off) => {
    const ex = S.day && S.day.executionDeath && P(S, S.day.executionDeath);
    if (!ex) return { active: false, reason: 'Сегодня днём никто не умер от казни' };
    const dist = distortion(S, p);
    const own = r => r === actsAs(p) || r === p.role; // свою роль Гробовщику не предлагаем
    const fake = stable(S, 'under:' + p.id, () => pick(scriptRoles(S, r => r !== ex.role && !own(r) && R(r).team === realTeam(ex))) || pick(scriptRoles(S, r => r !== ex.role && !own(r))) || ex.role);
    return { inputs: [ROLE('r', 'Какую роль показать (по умолчанию — рекомендация)', () => true, { groups: shownRoleGroups(S, p, ex, dist) })], defaults: { r: dist ? fake : ex.role },
      info: inp => ({ show: `Покажите жетон: ${rname(inp.r)}`, lines: [`Казнён ${ex.name} — ${rname(ex.role)}`, inp.r !== ex.role ? 'Показываете ложную роль' : '',
        dist && dist.must && inp.r === ex.role ? 'Вортокс: нужна ЛОЖНАЯ роль' : ''], tokens: inp.r ? [{ role: inp.r }] : [] }),
      apply: inp => { log(S, `Гробовщик (${p.name}) узнаёт: ${ex.name} — ${rname(inp.r)}${inp.r !== ex.role ? ` (на самом деле ${rname(ex.role)})` : ''}`, 'info'); if (dist && inp.r !== ex.role) recordAbn(S, p, 'ложная роль казнённого', dist.src); } };
  },
  monk: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Кого защищает Монах', both(notSelf(p), aliveOnly))],
    apply: inp => {
      const t = P(S, inp.t[0]);
      if (!off) addTok(S, t, 'protected', 'monk', ['dawn', S.n]);
      else S.night.data.protectWould = Object.assign({}, S.night.data.protectWould, { [t.id]: { by: p.id, demonOnly: true } }); // для Математика
      log(S, `Монах (${p.name}) защищает ${t.name}${off ? ' — не работает' : ''}`, 'action');
    },
  }),
  ravenkeeper: (S, p, first, off) => {
    if (S.flags.ravenWake !== p.id || !S.night.deaths.some(d => d.pid === p.id)) return { active: false, reason: 'Смотритель не умер этой ночью', deadOk: true };
    const dist = distortion(S, p);
    const shown = inp => { const t = inp.t && P(S, inp.t[0]); if (!t) return null; return inp.r || (dist ? stable(S, 'raven:' + t.id, () => pick(scriptRoles(S, r => r !== t.role && r !== actsAs(p) && r !== p.role && R(r).team === realTeam(t))) || t.role) : t.role); };
    return { deadOk: true, inputs: [PL('t', 1, 'Чью роль узнать', null, { bind: inp => { inp.r = null; } })], // другой игрок — роль снова по рекомендации
      more: inp => { const t = inp.t && P(S, inp.t[0]); return t ? [ROLE('r', 'Какую роль показать (не выбрано — рекомендация)', () => true, { optional: true, groups: shownRoleGroups(S, p, t, dist) })] : []; },
      info: inp => { const t = inp.t && P(S, inp.t[0]); if (!t) return null; const r = shown(inp);
        return { show: rname(r), lines: [r !== t.role ? `На самом деле: ${rname(t.role)}` : '', dist && dist.must && r === t.role ? 'Вортокс: нужна ЛОЖНАЯ роль' : '', ...regNote(S, [t.id])], tokens: [{ role: r }] }; },
      apply: inp => { const t = P(S, inp.t[0]), r = shown(inp); log(S, `Смотритель воронов (${p.name}) узнаёт роль ${t.name}: ${rname(r)}${r !== t.role ? ` (на самом деле ${rname(t.role)})` : ''}`, 'info');
        if (dist && r !== t.role) recordAbn(S, p, 'ложная роль', dist.src); S.flags.ravenWake = null; } };
  },
  butler: (S, p) => ({
    inputs: [PL('t', 1, 'Хозяин Дворецкого', notSelf(p))],
    apply: inp => { S.players.forEach(q => rmTok(q, 'master', 'butler')); addTok(S, P(S, inp.t[0]), 'master', 'butler'); log(S, `Дворецкий (${p.name}) выбирает хозяина: ${nm(S, inp.t[0])}`, 'action'); },
  }),
  poisoner: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Кого отравить')],
    apply: inp => { const t = P(S, inp.t[0]); if (!off) addTok(S, t, 'poisoned', 'poisoner', ['dusk', S.n + 1]); else recordAbn(S, p, 'яд не подействовал', abnSource(S, p));
      log(S, `Отравитель (${p.name}) травит ${t.name}${off ? ' — не работает' : ''}`, 'action'); },
  }),
  spy: (S, p) => jinxOn(S, 'spy', 'poppygrower') && poppyActive(S)
    ? { active: false, reason: 'Джинкс с Дурманщиком: пока у Дурманщика есть способность, Шпион не заглядывает в Гримуар' }
    : { info: () => ({ show: 'Покажите Гримуар', lines: [], grim: true }), apply: () => log(S, `Шпион (${p.name}) смотрит Гримуар`, 'info') },
  scarletwoman: (S, p) => {
    if (S.flags.swBecame !== p.id) return { active: false, reason: 'Блудница не становилась Демоном' };
    return { info: () => ({ show: `«ТЕПЕРЬ ВЫ» — ${rname(p.role)}`, lines: [], tokens: [{ caption: 'ТЕПЕРЬ ВЫ', role: p.role }] }),
      apply: () => log(S, `${p.name} узнаёт, что теперь Демон (${rname(p.role)})`, 'info') };
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
        if (t && t.id === p.id && !off) return { show: 'Чёрт убивает себя', lines: ['Выбранный Приспешник станет Чёртом: разбудите его, покажите «ТЕПЕРЬ ВЫ» и жетон Чёрта'],
          tokens: inp.heir && inp.heir[0] ? [{ label: nm(S, inp.heir[0]), caption: 'ТЕПЕРЬ ВЫ', role: 'imp' }] : undefined };
        return null;
      },
      apply: inp => {
        const t = P(S, inp.t[0]);
        if (t.id === p.id && !off) {
          const heir = inp.heir && inp.heir[0] && P(S, inp.heir[0]);
          log(S, `Чёрт (${p.name}) убивает себя`, 'action');
          const r = attemptKill(S, p, 'demon', 'imp', { noScarlet: true, noCheck: true });
          if (r.died && heir) { changeRole(S, heir, 'imp'); log(S, `${heir.name} становится Чёртом`, 'effect'); checkWin(S); }
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
      info: inp => { const t = inp.t && P(S, inp.t[0]); return t ? { show: `${t.name} — ${rname(t.role)}`, lines: t.align === 'good' ? [] : ['Внимание: внук должен быть добрым'], tokens: [{ pre: 'Ваш внук', role: t.role, players: [t.id] }] } : null; }, // «Ваш внук» — над иконкой (заметка 2026-10-15)
      apply: inp => { S.players.forEach(q => rmTok(q, 'grandchild')); S.flags.grandchild = inp.t[0]; addTok(S, P(S, inp.t[0]), 'grandchild', 'grandmother'); log(S, `Бабушка (${p.name}) узнаёт внука: ${nm(S, inp.t[0])} — ${rname(P(S, inp.t[0]).role)}`, 'info'); } };
  },
  sailor: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Моряк выбирает живого игрока', aliveOnly), CHOICE('who', 'Кто пьян до заката', [{ v: 'target', l: 'Выбранный' }, { v: 'self', l: 'Сам Моряк' }])],
    defaults: { who: 'target' },
    apply: inp => { const t = P(S, inp.t[0]); if (!off) addTok(S, inp.who === 'self' ? p : t, 'drunk', 'sailor', ['dusk', S.n + 1]); else recordAbn(S, p, 'никто не опьянел', abnSource(S, p));
      log(S, `Моряк (${p.name}) выбирает ${t.name}; пьян: ${inp.who === 'self' ? p.name : t.name}`, 'action'); },
  }),
  chambermaid: (S, p) => {
    const dist = distortion(S, p), truth = inp => (inp.t || []).filter(id => S.night.woke.includes(id)).length;
    const def = inp => { const c = truth(inp); return dist ? (c ? c - 1 : 1) : c; };
    return {
      inputs: [PL('t', 2, 'Горничная выбирает 2 живых игроков', both(aliveOnly, notSelf(p)))],
      more: inp => (inp.t || []).length === 2 ? [Object.assign(NUM('n', 'Что показать (по умолчанию — рекомендация)'), { def: def(inp) })] : [],
      info: inp => { if ((inp.t || []).length < 2) return null; const c = truth(inp), n = inp.n ?? def(inp);
        return { show: String(n), lines: ['Сколько из них просыпались этой ночью из-за своей способности (на этот момент)', n !== c ? `Верное число: ${c}` : '',
          dist && dist.must && n === c ? 'Вортокс: нужно ЛОЖНОЕ число' : ''] }; },
      apply: inp => { const c = truth(inp), n = inp.n ?? def(inp);
        log(S, `Горничная (${p.name}) проверяет ${(inp.t || []).map(id => nm(S, id)).join(' и ')}: ${n}`, 'info'); if (dist && n !== c) recordAbn(S, p, 'ложное число', dist.src); },
    };
  },
  exorcist: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Экзорцист выбирает игрока (не того же, что прошлой ночью)', q => q.id !== S.flags['exorcistLast_' + p.id])],
    info: inp => { const t = inp.t && P(S, inp.t[0]); return t && isDemon(t) && !off ? { show: 'Это Демон', lines: ['Разбудите Демона, покажите жетон Экзорциста и укажите на Экзорциста. Демон не просыпается этой ночью.'],
      tokens: [{ label: `Демону (${t.name})`, caption: CARD.selected, role: 'exorcist', players: [p.id] }] } : t && isDemon(t) ? { secret: true, show: 'Это Демон, но Экзорцист пьян или отравлен — Демон просыпается как обычно', lines: [] } : null; },
    apply: inp => { const t = P(S, inp.t[0]); S.flags['exorcistLast_' + p.id] = t.id; if (!off && isDemon(t)) S.night.data.exorcised = t.id; else if (off && isDemon(t)) recordAbn(S, p, 'Демон не остановлен', abnSource(S, p));
      S.players.forEach(q => rmTok(q, 'chosen', 'exorcist')); addTok(S, t, 'chosen', 'exorcist'); // «Выбран»: следующей ночью — не его
      log(S, `Экзорцист (${p.name}) выбирает ${t.name}`, 'action'); },
  }),
  innkeeper: (S, p, first, off) => ({
    inputs: [PL('t', 2, 'Трактирщик выбирает 2 игроков'), CHOICE('drunk', 'Кто из них пьян до заката', [{ v: '0', l: 'Первый' }, { v: '1', l: 'Второй' }])],
    defaults: { drunk: '0' },
    apply: inp => {
      const ts = inp.t.map(id => P(S, id));
      if (!off) { ts.forEach(t => addTok(S, t, 'protected', 'innkeeper', ['dawn', S.n])); addTok(S, ts[+inp.drunk] || ts[0], 'drunk', 'innkeeper', ['dusk', S.n + 1]); }
      else ts.forEach(t => { S.night.data.protectWould = Object.assign({}, S.night.data.protectWould, { [t.id]: { by: p.id } }); }); // для Математика
      log(S, `Трактирщик (${p.name}) защищает ${ts.map(t => t.name).join(' и ')}`, 'action');
    },
  }),
  gambler: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Азартный игрок выбирает игрока'), ROLE('r', 'и угадывает роль из сценария', r => true)],
    // Азартный игрок не узнаёт, угадал ли он: ничего не показываем, просто умирает или нет (secret — только для рассказчика)
    info: inp => {
      const t = inp.t && P(S, inp.t[0]); if (!t || !inp.r) return null;
      const ok = t.role === inp.r;
      return { secret: true, show: ok ? 'Угадал — ничего не происходит' : off ? 'Не угадал, но пьян или отравлен — не умирает' : 'Не угадал — умирает этой ночью',
        lines: ['Азартному игроку ничего не показывайте и не говорите', ...regNote(S, [t.id])] };
    },
    apply: inp => {
      const t = P(S, inp.t[0]); log(S, `Азартный игрок (${p.name}): ${t.name} — ${rname(inp.r)}?`, 'action');
      if (t.role === inp.r) return;
      if (!off) attemptKill(S, p, 'ability', 'gambler'); else recordAbn(S, p, 'не угадал, но не умер', abnSource(S, p));
    },
  }),
  // Сплетница (вики): в конце дня приложение спрашивает, было ли публичное заявление (setGossip). Не было — шаг не просыпается;
  // было — рассказчик решает, верно ли оно, и если да — кто умирает (заметка пользователя 2026-10-15). Не спрашивали — как раньше
  gossip: (S, p, first, off) => {
    const g = ((S.day && S.day.gossip) || {})[p.id];
    if (g && !g.made) return { active: false, reason: 'днём Сплетница не делала публичного заявления' };
    return {
      inputs: [CHOICE('true', 'Заявление Сплетницы днём было верным?', [{ v: 'no', l: 'Нет' }, { v: 'yes', l: 'Да' }])],
      // верное — выбрать, кто умирает (вики: лучше тот, кто правда умрёт, а не защищённый Шутом или Травницей)
      more: inp => inp.true === 'yes' ? [PL('t', 1, 'Кто умирает из-за Сплетницы', aliveOnly)] : [],
      defaults: { true: 'no' },
      info: () => g && g.text ? { secret: true, show: `Заявление: «${g.text}»`, lines: [] } : null,
      apply: inp => {
        if (inp.true !== 'yes' || !inp.t || !inp.t[0]) { log(S, `Сплетница (${p.name}): заявление неверное — никто не умирает`, 'action'); return; }
        if (off) { log(S, `Сплетница (${p.name}): заявление верное, но способность не работает`, 'action'); return recordAbn(S, p, 'правда, но никто не умер', abnSource(S, p)); }
        log(S, `Сплетница (${p.name}): заявление верное`, 'effect'); attemptKill(S, P(S, inp.t[0]), 'ability', 'gossip');
      },
    };
  },
  courtier: (S, p, first, off) => {
    if (once(S, p, 'courtier')) return { active: false, reason: 'Способность уже использована' };
    return { inputs: [ROLE('r', 'Придворный выбирает роль (можно пропустить)', () => true, { optional: true })],
      // Придворный не узнаёт, удалось ли: ничего не показываем (secret — только для рассказчика)
      info: inp => { if (!inp.r) return null; const h = holders(S, inp.r);
        return { secret: true, show: !h.length ? 'Этой роли нет в игре — ничего' : off ? 'Придворный пьян или отравлен — никто не пьянеет' : `${h.map(q => q.name).join(', ')} пьян 3 ночи и 3 дня`,
          lines: ['Придворному ничего не показывайте'] }; },
      apply: inp => { if (!inp.r) return; markOnce(S, p, 'courtier'); log(S, `Придворный (${p.name}) выбирает роль: ${rname(inp.r)}`, 'action');
        if (!off) holders(S, inp.r).forEach(q => addTok(S, q, 'drunk', 'courtier', ['dusk', S.n + 3])); else if (holders(S, inp.r).length) recordAbn(S, p, 'никто не опьянел', abnSource(S, p)); } };
  },
  professor: (S, p, first, off) => {
    if (once(S, p, 'professor')) return { active: false, reason: 'Способность уже использована' };
    return { inputs: [PL('t', 1, 'Профессор выбирает мёртвого (можно пропустить)', q => !q.alive, { min: 0 })],
      apply: inp => { if (!inp.t || !inp.t[0]) return; markOnce(S, p, 'professor'); const t = P(S, inp.t[0]); if (!off && realTeam(t) === 'townsfolk') revive(S, t, `Профессор (${p.name}) воскрешает`);
        else { log(S, `Профессор выбирает ${t.name} — ничего не происходит`, 'action'); if (off && realTeam(t) === 'townsfolk') recordAbn(S, p, 'воскрешение не сработало', abnSource(S, p)); } } };
  },
  moonchild: (S, p) => {
    const t = S.flags.moonchildTarget && P(S, S.flags.moonchildTarget);
    if (!t) return { active: false, reason: 'Дитя Луны никого не выбирало', deadOk: true };
    return { deadOk: true, info: () => ({ secret: true, show: t.align === 'good' ? `${t.name} — добрый, умирает` : `${t.name} — злой, ничего`, lines: [] }),
      apply: () => { S.flags.moonchildTarget = null; if (t.align === 'good') attemptKill(S, t, 'ability', 'moonchild'); } };
  },
  godfather: (S, p, first, off) => {
    if (first) {
      const outs = S.players.filter(q => realTeam(q) === 'outsider').map(q => rname(q.role));
      const outRoles = S.players.filter(q => realTeam(q) === 'outsider').map(q => q.role);
      return { info: () => ({ show: outs.length ? outs.join(', ') : 'Изгоев нет', lines: ['Покажите жетоны Изгоев в игре'], tokens: outRoles.length ? outRoles.map(role => ({ role })) : undefined }),
        apply: () => log(S, `Крёстный Отец (${p.name}) узнаёт Изгоев: ${outs.join(', ') || 'нет'}`, 'info') };
    }
    if (!S.day || !S.day.outsiderDied) return { active: false, reason: 'Днём не умирал Изгой' };
    return { inputs: [PL('t', 1, 'Кого убивает Крёстный Отец', aliveOnly)],
      apply: inp => { log(S, `Крёстный Отец (${p.name}) выбирает ${nm(S, inp.t[0])}`, 'action'); if (!off) attemptKill(S, P(S, inp.t[0]), 'minion', 'godfather'); else recordAbn(S, p, 'убийство не сработало', abnSource(S, p)); } };
  },
  devilsadvocate: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Кого защищает от казни (не того же, что прошлой ночью)', q => q.alive && q.id !== S.flags['daLast_' + p.id])],
    apply: inp => { const t = P(S, inp.t[0]); S.flags['daLast_' + p.id] = t.id; if (!off) addTok(S, t, 'safe', 'devilsadvocate', ['dusk', S.n + 1]); log(S, `Адвокат Дьявола (${p.name}) защищает ${t.name}`, 'action'); },
  }),
  assassin: (S, p, first, off) => {
    if (once(S, p, 'assassin')) return { active: false, reason: 'Способность уже использована' };
    return { inputs: [PL('t', 1, 'Ассасин выбирает (можно пропустить)', aliveOnly, { min: 0 })],
      apply: inp => { if (!inp.t || !inp.t[0]) return; markOnce(S, p, 'assassin'); log(S, `Ассасин (${p.name}) выбирает ${nm(S, inp.t[0])}`, 'action'); if (!off) attemptKill(S, P(S, inp.t[0]), 'unstoppable', 'assassin'); else recordAbn(S, p, 'убийство не сработало', abnSource(S, p)); } };
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
      // по вики: пьяный/отравленный Пукка не отравляет нового, а прежний отравленный не умирает — умрёт, когда Пукка протрезвеет
      info: () => prev && prev.alive && !first ? { secret: true,
        show: off ? `${prev.name} этой ночью НЕ умирает: Пукка пьян или отравлен` : `Умирает отравленный прошлой ночью: ${prev.name}`,
        lines: [off ? 'Новый выбор Пукки тоже не отравляет. Когда Пукка протрезвеет, прежний отравленный умрёт в ту ночь' : 'На рассвете объявите его смерть, не называя причины'] } : null,
      apply: inp => {
        const t = P(S, inp.t[0]);
        log(S, `Пукка (${p.name}) отравляет ${t.name}${off ? ' — не работает' : ''}`, 'action');
        if (off) { recordAbn(S, p, 'яд Пукки не сработал', abnSource(S, p)); return; }
        if (prev && prev.alive && !first) { rmTok(prev, 'poisoned', 'pukka'); attemptKill(S, prev, 'demon', 'pukka'); }
        if (prev) rmTok(prev, 'poisoned', 'pukka');
        addTok(S, t, 'poisoned', 'pukka'); S.flags.pukkaPrev = t.id;
      },
    };
  },
  shabaloth: (S, p, first, off, base) => {
    if (demonExorcised(S, p, base)) return {};
    return { inputs: [PL('t', 2, 'Кого убивает Шабалот'), PL('back', 1, 'Отрыгнуть (вернуть к жизни) одного из убитых прошлой ночью — по желанию', q => !q.alive, { min: 0 })],
      apply: inp => { if (inp.back && inp.back[0] && !off) revive(S, P(S, inp.back[0]), 'Шабалот отрыгивает'); inp.t.forEach(id => demonKill(S, p, off, P(S, id), {})); } };
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
  // Сновидец (вики): игрок не он сам и не Странник; 1 добрая и 1 злая роль, одна из них — его. Роли выбирает рассказчик,
  // в списках они уже стоят по умолчанию (заметка пользователя 2026-10-17): роль стороны игрока — настоящая (если Сновидец трезв
  // и здоров), ложная добрая — роль, которой нет в игре (и не блеф Демона, не «кем себя считает» Пьяница); ложная злая — Приспешник
  // из игры. В списках сверху — роли, которых нет в игре. Своя роль Сновидцу не предлагается. Пьян, отравлен, Вортокс — обе ложные
  dreamer: (S, p, first, off) => {
    const dist = distortion(S, p), mine = new Set([p.role, actsAs(p)]);
    const side = good => r => R(r) && isGoodTeam(R(r).team) === good && !mine.has(r);
    const named = new Set([...(S.bluffs || []), ...S.players.map(q => q.believes).filter(Boolean)]); // их называют, хотя их нет в игре
    const absent = good => scriptRoles(S, r => side(good)(r) && !inPlay(S, r));
    const groups = good => [{ label: 'Нет в игре', roles: absent(good).filter(r => !named.has(r)) },
      { label: 'Нет в игре — блефы Демона, кем себя считает Пьяница', roles: absent(good).filter(r => named.has(r)) },
      { label: 'В игре', roles: scriptRoles(S, r => side(good)(r) && inPlay(S, r)) }];
    const fakeFor = (t, good) => { const pool = scriptRoles(S, r => side(good)(r) && r !== t.role);
      const pref = good ? pool.filter(r => !inPlay(S, r) && !named.has(r)) : pool.filter(r => R(r).team === 'minion' && inPlay(S, r));
      const out = good ? pool.filter(r => !inPlay(S, r)) : [];
      return pick(pref.length ? pref : out.length ? out : pool) || null; };
    const rec = t => stable(S, `dream:${p.id}:${t.id}:${dist ? 'f' : 't'}`, () => {
      const tg = isGoodTeam(realTeam(t));
      if (dist) return { g: fakeFor(t, true), e: fakeFor(t, false) };
      return tg ? { g: t.role, e: fakeFor(t, false) } : { g: fakeFor(t, true), e: t.role };
    });
    const pickT = inp => inp.t && P(S, inp.t[0]);
    const shown = inp => { const t = pickT(inp); if (!t) return null; const d = rec(t); return { g: inp.g || d.g, e: inp.e || d.e }; };
    return {
      inputs: [PL('t', 1, 'Сновидец выбирает игрока (не себя и не Странника)', q => q.id !== p.id && !isTraveller(q))],
      more: inp => { const t = pickT(inp); if (!t) return []; const d = rec(t), real = good => !dist && isGoodTeam(realTeam(t)) === good;
        const lab = good => `${good ? 'Добрая' : 'Злая'} роль (по умолчанию — ${real(good) ? 'настоящая' : good ? 'ложная, нет в игре' : 'ложная'})`;
        return [ROLE('g', lab(true), side(true), { optional: true, groups: groups(true), def: d.g }),
          ROLE('e', lab(false), side(false), { optional: true, groups: groups(false), def: d.e })]; },
      info: inp => {
        const t = pickT(inp), s = shown(inp); if (!t || !s) return null;
        const ok = s.g === t.role || s.e === t.role;
        const order = stable(S, `dreamOrd:${p.id}:${t.id}`, () => Math.random() < 0.5);
        return { show: `${rname(s.g)} или ${rname(s.e)}`, lines: [ok ? 'Одна из ролей — его: информация верная' : `Обе роли ложные (на самом деле ${rname(t.role)})`,
            dist && dist.must && ok ? 'Вортокс: нужна ЛОЖНАЯ информация — обе роли не его' : '', ...regNote(S, [t.id])],
          tokens: (order ? [s.g, s.e] : [s.e, s.g]).filter(Boolean).map(role => ({ role })) };
      },
      apply: inp => { const t = pickT(inp), s = shown(inp); const ok = s.g === t.role || s.e === t.role;
        log(S, `Сновидец (${p.name}) смотрит на ${t.name}: ${rname(s.g)} или ${rname(s.e)}${ok ? '' : ' (обе ложные)'}`, 'info');
        if (dist && !ok) recordAbn(S, p, 'ложная информация', dist.src); },
    };
  },
  // Гарпия (вики): выбирает 2 игроков по очереди; будят только первого — «ОБЛАДАТЕЛЬ ЭТОЙ РОЛИ ВЫБРАЛ ВАС», жетон Гарпии,
  // указать на второго. Второго не будят. Завтра первый «помешан», что второй злой, иначе рассказчик может убить одного или обоих
  harpy: (S, p, first, off) => ({
    inputs: [PL('m', 1, 'Гарпия выбирает первого игрока (он будет «помешан»)'), PL('s', 1, 'и второго игрока')],
    info: inp => { const a = inp.m && P(S, inp.m[0]), b = inp.s && P(S, inp.s[0]); if (!a || !b) return null;
      return { show: `Разбудите ${a.name}: «ОБЛАДАТЕЛЬ ЭТОЙ РОЛИ ВЫБРАЛ ВАС», жетон Гарпии, затем укажите на ${b.name}`,
        lines: [`Второго игрока (${b.name}) не будят — он ничего не узнаёт`, off ? 'Гарпия пьяна или отравлена: показать можно, но безумие не действует' : ''],
        tokens: [{ label: a.name, caption: CARD.selected, role: 'harpy', players: [b.id] }] }; },
    apply: inp => { const a = P(S, inp.m[0]), b = P(S, inp.s[0]);
      S.players.forEach(q => { rmTok(q, 'mad', 'harpy'); rmTok(q, 'second', 'harpy'); }); // действует до следующего выбора Гарпии
      if (!off) { addTok(S, a, 'mad', 'harpy', ['dusk', S.n + 1], { note: `${b.name} злой`, by: b.id }); addTok(S, b, 'second', 'harpy', ['dusk', S.n + 1]); }
      else recordAbn(S, p, 'безумие не наложено', abnSource(S, p));
      log(S, `Гарпия (${p.name}): ${a.name} должен быть помешан на том, что ${b.name} злой`, 'action'); },
  }),
  snakecharmer: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Заклинатель змей выбирает живого игрока', both(aliveOnly, notSelf(p)))],
    info: inp => {
      const t = inp.t && P(S, inp.t[0]); if (!t || !isDemon(t)) return null;
      if (off) return { secret: true, show: 'Это Демон, но Заклинатель пьян или отравлен — обмена нет', lines: [] };
      // обмен: Заклинателю — «ТЕПЕРЬ ВЫ» Демон (злой), прежнему Демону — «ТЕПЕРЬ ВЫ» его роль (добрый, отравлен навсегда).
      // Способностью Заклинателя пользовался Философ (или Каннибал) — прежний Демон становится Философом (вики)
      return { show: 'Это Демон — обмен ролями и сторонами!', lines: [`1) Заклинателю (${p.name}): «ТЕПЕРЬ ВЫ», жетон ${rname(t.role)}, палец вниз`, `2) Прежнему Демону (${t.name}): «ТЕПЕРЬ ВЫ», жетон ${rname(p.role)}, палец вверх`],
        tokens: [{ label: `Заклинателю (${p.name})`, caption: 'ТЕПЕРЬ ВЫ', role: t.role, thumb: 'down' }, { label: `Прежнему Демону (${t.name})`, caption: 'ТЕПЕРЬ ВЫ', role: p.role, thumb: 'up' }] };
    },
    apply: inp => {
      const t = P(S, inp.t[0]); log(S, `Заклинатель змей (${p.name}) выбирает ${t.name}`, 'action');
      if (!isDemon(t)) return;
      if (off) return recordAbn(S, p, 'выбрал Демона, но обмена не было', abnSource(S, p));
      // меняются роли и стороны; способность Философа/Каннибала едет вместе с его ролью — новый Демон просыпается Демоном
      const dr = t.role, mine = p.role, gained = p.gained;
      changeRole(S, p, dr, { align: 'evil', keep: true }); changeRole(S, t, mine, { align: 'good', gained });
      addTok(S, t, 'poisoned', 'snakecharmer');
      log(S, `Обмен: ${p.name} теперь ${rname(dr)}, ${t.name} — ${rname(mine)} (отравлен)`, 'effect');
      rebuildRest(S); // дальше этой ночью Демоном просыпается новый Демон, у прежнего — шаги Заклинателя
    },
  }),
  // Математик: приложение само отмечает сбои с рассвета (ложная информация, несработавшая защита и т. п.)
  mathematician: (S, p) => {
    const dist = distortion(S, p), list = (S.flags.abn || []).filter(a => a.pid !== p.id), truth = list.length;
    const fake = stable(S, 'math:' + p.id, () => truth > 0 && Math.random() < 0.5 ? truth - 1 : truth + 1);
    return {
      inputs: [NUM('c', 'Что показать: сколько способностей сработали иначе из-за чужих способностей')], defaults: { c: dist ? fake : truth },
      info: inp => ({ show: String(inp.c ?? truth), lines: [inp.c !== truth ? `Верное число по учёту: ${truth}` : '', list.length ? 'Приложение отметило с рассвета:' : 'Приложение не заметило сбоев с рассвета',
        ...list.map(a => '• ' + a.text), 'Затворник, Шпион и другие случаи на ваше усмотрение приложение не считает — поправьте число, если нужно'] }),
      apply: inp => { log(S, `Математик (${p.name}): ${inp.c}`, 'info'); if (dist && inp.c !== truth) recordAbn(S, p, 'ложное число', dist.src); },
    };
  },
  flowergirl: (S, p) => {
    const truth = !!(S.day && S.day.demonVoted), y = yesNo(S, p, truth);
    return { inputs: [y.field], info: inp => ({ show: y.shown(inp) ? 'ДА — кивните' : 'НЕТ — покачайте головой', lines: [`Демон сегодня ${truth ? 'голосовал' : 'не голосовал'}`, ...y.lines(inp)] }),
      apply: inp => { log(S, `Цветочница (${p.name}): ${y.shown(inp) ? 'да' : 'нет'}`, 'info'); y.record(inp); } };
  },
  towncrier: (S, p) => {
    const truth = !!(S.day && S.day.minionNominated), y = yesNo(S, p, truth);
    return { inputs: [y.field], info: inp => ({ show: y.shown(inp) ? 'ДА — кивните' : 'НЕТ — покачайте головой', lines: [`Приспешник сегодня ${truth ? 'номинировал' : 'не номинировал'}`, ...y.lines(inp)] }),
      apply: inp => { log(S, `Глашатай (${p.name}): ${y.shown(inp) ? 'да' : 'нет'}`, 'info'); y.record(inp); } };
  },
  oracle: countInfo(S => ({ n: S.players.filter(q => !q.alive && q.align === 'evil').length }), 'Мёртвых злых игроков'),
  seamstress: (S, p, first, off) => {
    if (once(S, p, 'seamstress')) return { active: false, reason: 'Способность уже использована' };
    const same = inp => { const ps = (inp.t || []).map(id => P(S, id)); return ps.length === 2 && ps[0].align === ps[1].align; };
    return { inputs: [PL('t', 2, 'Швея выбирает 2 игроков (можно пропустить)', notSelf(p), { min: 0 })],
      more: inp => (inp.t || []).length === 2 ? [yesNo(S, p, same(inp)).field] : [],
      info: inp => { if ((inp.t || []).length < 2) return null; const y = yesNo(S, p, same(inp));
        return { show: y.shown(inp) ? 'ДА — одна сторона' : 'НЕТ — разные стороны', lines: [...y.lines(inp), ...regNote(S, inp.t)] }; },
      apply: inp => { if (!inp.t || inp.t.length < 2) return; markOnce(S, p, 'seamstress'); const y = yesNo(S, p, same(inp));
        log(S, `Швея (${p.name}) проверяет ${inp.t.map(id => nm(S, id)).join(' и ')}: ${y.shown(inp) ? 'да' : 'нет'}`, 'info'); y.record(inp); } };
  },
  philosopher: (S, p, first, off) => {
    if (once(S, p, 'philosopher')) return { active: false, reason: 'Способность уже использована' };
    return { inputs: [ROLE('r', 'Философ выбирает добрую роль из сценария (можно пропустить)', r => isGoodTeam(R(r).team), { optional: true })],
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
    const dist = distortion(S, p), d = S.players.find(isDemon);
    const def = stable(S, `sage:${p.id}:${dist ? 'f' : 't'}`, () => {
      if (dist) return shuffle(S.players.filter(q => q !== d && q !== p)).slice(0, 2).map(q => q.id); // ложная: Демона среди двоих нет
      const other = pick(S.players.filter(q => q !== d && q !== p));
      return shuffle([d && d.id, other && other.id].filter(Boolean));
    });
    const correct = inp => !!d && (inp.t || []).includes(d.id);
    return { deadOk: true, inputs: [PL('t', 2, `Покажите 2 игроков, один — Демон${dist ? ' (рекомендация — ложная)' : ''}`)], defaults: { t: def },
      info: inp => (inp.t || []).length === 2 ? { show: inp.t.map(id => nm(S, id)).join(' или '), lines: [!correct(inp) ? `Демона среди них нет — информация ложная. Демон: ${d ? d.name : '—'}` : '',
        dist && dist.must && correct(inp) ? 'Вортокс: нужна ЛОЖНАЯ информация' : ''], tokens: [{ players: inp.t, sub: 'Один из них — Демон' }] } : null,
      apply: inp => { S.flags.sageWake = null; log(S, `Мудрец (${p.name}) узнаёт: ${inp.t.map(id => nm(S, id)).join(' или ')}`, 'info'); if (dist && !correct(inp)) recordAbn(S, p, 'ложная информация', dist.src); } };
  },
  barber: (S, p) => {
    if (!S.flags.haircuts) return { active: false, reason: 'Цирюльник не умирал', deadOk: true };
    return { deadOk: true, text: (DATA.roles.barber.other || ''),
      inputs: [PL('t', 2, 'Демон выбирает 2 игроков для обмена ролями (можно отказаться)', q => !(isDemon(q) && S.players.filter(isDemon).length > 1 && q !== S.players.find(isDemon)), { min: 0 })],
      info: inp => {
        const demon = S.players.find(isDemon), first = demon ? [{ label: `Демону (${demon.name})`, caption: CARD.selected, role: 'barber' }] : [];
        if ((inp.t || []).length < 2) return { show: 'Покажите Демону жетон Цирюльника', lines: ['Демон может выбрать 2 игроков для обмена ролями или отказаться'], tokens: first };
        const [a, b] = inp.t.map(id => P(S, id)), seen = q => q.believes || q.role; // Пьяница видит роль, которой себя считает
        return { show: `${a.name} ↔ ${b.name}`, lines: ['Разбудите каждого и покажите «ТЕПЕРЬ ВЫ» и новую роль; стороны не меняются — покажите жестом',
            a.role === 'drunk' || b.role === 'drunk' ? 'Пьяница: вместе с ролью переходит и жетон Горожанина, которым он себя считает — его и покажите' : ''],
          tokens: first.concat([{ label: a.name, caption: CARD.youAre, role: seen(b), align: a.align, thumb: a.align === 'good' ? 'up' : 'down' },
            { label: b.name, caption: CARD.youAre, role: seen(a), align: b.align, thumb: b.align === 'good' ? 'up' : 'down' }]) }; },
      // обмен (вики): стороны прежние; полученная способность (Философ, Каннибал) и «кем себя считает» едут вместе с ролью
      apply: inp => { S.flags.haircuts = false; if (!inp.t || inp.t.length < 2) { log(S, 'Цирюльник: Демон отказался менять роли', 'action'); return; }
        const [a, b] = inp.t.map(id => P(S, id)), A0 = { role: a.role, gained: a.gained, believes: a.believes }, B0 = { role: b.role, gained: b.gained, believes: b.believes };
        changeRole(S, a, B0.role, { gained: B0.gained, believes: B0.believes, keep: true }); changeRole(S, b, A0.role, { gained: A0.gained, believes: A0.believes });
        log(S, `Цирюльник: ${a.name} и ${b.name} меняются ролями (${rname(a.role)} ↔ ${rname(b.role)}), стороны прежние`, 'effect');
        rebuildRest(S); checkWin(S); } };
  },
  sweetheart: (S, p) => {
    if (S.flags.sweetheartPending !== p.id) return { active: false, reason: 'Возлюбленная не умирала', deadOk: true };
    return { deadOk: true, inputs: [PL('t', 1, 'Кто становится пьяным навсегда')],
      apply: inp => { S.flags.sweetheartPending = null; addTok(S, P(S, inp.t[0]), 'drunk', 'sweetheart'); log(S, `Возлюбленная: ${nm(S, inp.t[0])} пьян до конца игры`, 'effect'); } };
  },
  eviltwin: (S, p, first) => ({
    inputs: [PL('t', 1, 'Добрый близнец', q => q.align !== p.align)], defaults: { t: S.flags.goodTwin ? [S.flags.goodTwin] : [] },
    info: inp => { const t = inp.t && P(S, inp.t[0]); return t ? { show: `Близнецы: ${p.name} и ${t.name}`, lines: [`Покажите ${p.name} роль ${rname(t.role)}, а ${t.name} — роль Злого Близнеца`],
      tokens: [{ label: `Злому Близнецу (${p.name})`, caption: CARD.thisPlayer, role: t.role, align: t.align, players: [t.id] }, { label: `Доброму близнецу (${t.name})`, caption: CARD.thisPlayer, role: 'eviltwin', players: [p.id] }] } : null; },
    apply: inp => { S.players.forEach(q => rmTok(q, 'twin')); S.flags.goodTwin = inp.t[0]; addTok(S, P(S, inp.t[0]), 'twin', 'eviltwin'); log(S, `Близнецы узнают друг друга: ${p.name} и ${nm(S, inp.t[0])}`, 'info'); },
  }),
  witch: (S, p, first, off) => {
    if (aliveCount(S) <= 3) return { active: false, reason: 'В живых 3 игрока — Ведьма теряет способность' };
    return { inputs: [PL('t', 1, 'Кого проклинает Ведьма', aliveOnly)],
      apply: inp => { const t = P(S, inp.t[0]); if (!off) addTok(S, t, 'cursed', 'witch', ['dusk', S.n + 1]);
        else S.flags.witchDud = { t: t.id, w: p.id, n: S.n, src: abnSource(S, p) };
        log(S, `Ведьма (${p.name}) проклинает ${t.name}`, 'action'); } };
  },
  cerenovus: (S, p, first, off) => ({
    inputs: [PL('t', 1, 'Цереновус выбирает игрока'), ROLE('r', 'и добрую роль из сценария', r => isGoodTeam(R(r).team))],
    info: inp => inp.t && inp.t.length && inp.r ? { show: `Разбудите ${nm(S, inp.t[0])}: помешан на роли «${rname(inp.r)}»`, lines: [off ? 'Цереновус пьян или отравлен: можно показать, но безумие не действует' : ''],
      // один экран: «ОБЛАДАТЕЛЬ ЭТОЙ РОЛИ ВЫБРАЛ ВАС», маленький жетон Цереновуса и крупно — роль безумия (join: на тот же экран)
      tokens: [{ label: nm(S, inp.t[0]), caption: CARD.selected, role: 'cerenovus', small: true },
        { label: nm(S, inp.t[0]), join: true, pre: 'Безумие: завтра вы —', role: inp.r }] } : null,
    apply: inp => { const t = P(S, inp.t[0]); if (!off) addTok(S, t, 'mad', 'cerenovus', ['dusk', S.n + 1], { note: rname(inp.r) }); else recordAbn(S, p, 'безумие не наложено', abnSource(S, p));
      log(S, `Цереновус (${p.name}): ${t.name} должен быть помешан на роли «${rname(inp.r)}»`, 'action'); },
  }),
  // Яга (вики): игрок становится ролью, если её нет в игре (в игре — ничего не происходит); сторона прежняя; игрок узнаёт роль
  // («ТЕПЕРЬ ВЫ» + жетон + жест, что сторона не изменилась). Создан Демон — смерти этой ночью на усмотрение рассказчика
  pithag: (S, p, first, off) => {
    const bel = r => r === 'drunk' || r === 'lunatic' ? stable(S, `phBel:${S.n}:${r}`, () => pickBelieved(S, r)) : null; // кем себя будет считать
    const works = inp => inp.t && inp.t.length && inp.r && !off && !inPlay(S, inp.r);
    return {
      inputs: [PL('t', 1, 'Яга выбирает игрока'), ROLE('r', 'и роль из сценария (если она в игре — ничего не происходит)', () => true)],
      more: inp => works(inp) && R(inp.r).team === 'demon' ? [PL('kill', 20, 'Создан Демон: кто умирает этой ночью (ваше решение, можно никого)', aliveOnly, { min: 0 })] : [],
      info: inp => {
        if (!inp.t || !inp.t.length || !inp.r) return null;
        const t = P(S, inp.t[0]);
        if (inPlay(S, inp.r)) return { secret: true, show: `${rname(inp.r)} уже в игре — ничего не происходит`, lines: ['Ягу просто усыпите'] };
        if (off) return { secret: true, show: 'Яга пьяна или отравлена — превращения нет', lines: ['Можно разбудить выбранного игрока «понарошку», но роль не меняется'] };
        const demon = R(inp.r).team === 'demon', seen = bel(inp.r) || inp.r, onlyDemon = isDemon(t) && S.players.filter(demonAlive).length === 1 && !demon;
        return { show: `Разбудите ${t.name}: «ТЕПЕРЬ ВЫ» — ${rname(seen)}`, lines: [
            seen !== inp.r ? `${rname(inp.r)}: покажите жетон роли, которой он себя будет считать (${rname(seen)})` : '',
            `Сторона прежняя (${t.align === 'good' ? 'добрый' : 'злой'}) — покажите жестом`,
            // вики, Яга: «если Демон превращён в нового Демона — лучше, чтобы этой ночью никто не умер» (подсказка добрым, что Демон сменился);
            // создан новый злой Демон — лучше убить старого Демона и ещё кого-то
            demon && isDemon(t) ? 'Демон стал другим Демоном: смерти этой ночью — на ваше усмотрение. Вики советует, чтобы этой ночью никто не умер (знак добрым, что Демон сменился): нового Демона можно разбудить, выслушать выбор и решить, что никто не умирает'
              : demon ? 'Создан Демон: смерти этой ночью — на ваше усмотрение. Вики советует убить старого Демона и ещё кого-то (знак добрым, что Демон сменился); нападение можно пропустить' : '',
            onlyDemon ? 'Это единственный Демон: после превращения живых Демонов не останется — добро побеждает (все Демоны мертвы)' : ''],
          tokens: [{ label: t.name, caption: CARD.youAre, role: seen, align: t.align, thumb: t.align === 'good' ? 'up' : 'down' }] };
      },
      apply: inp => {
        const t = P(S, inp.t[0]);
        if (!works(inp)) { log(S, `Яга (${p.name}) выбирает ${t.name} и ${rname(inp.r)} — ничего${off ? ' (Яга пьяна или отравлена)' : ' (роль в игре)'}`, 'action');
          if (off && !inPlay(S, inp.r)) recordAbn(S, p, 'превращение не сработало', abnSource(S, p)); return; }
        const wasDemon = isDemon(t), old = changeRole(S, t, inp.r, { believes: bel(inp.r) });
        log(S, `Яга превращает ${t.name}: ${rname(old)} → ${rname(inp.r)} (сторона прежняя)`, 'effect');
        if (R(inp.r).team === 'demon') { S.night.data.pithagDemon = wasDemon ? 'changed' : 'new';
          S.night.data.pithagInfo = { pid: t.id, role: inp.r, kind: wasDemon ? 'changed' : t.align === 'good' ? 'good' : 'evil' }; } // для окна с советами вики
        (inp.kill || []).forEach(id => attemptKill(S, P(S, id), 'ability', 'pithag'));
        rebuildRest(S); // старая роль этой ночью больше не просыпается, новая — в свою очередь (и «первая ночь», если есть)
        checkWin(S);
      },
    };
  },
  fanggu: (S, p, first, off, base) => {
    if (demonExorcised(S, p, base)) return {};
    // прыжок — только если Изгой правда умер бы (вики: «если выбранный Изгой не умирает, он не становится Фань Гу»)
    const shield = t => hasTok(t, 'protected', 'monk') ? 'Монах' : hasTok(t, 'protected', 'innkeeper') ? 'Трактирщик' : teaLadyProtects(S, t) ? 'Травница' : '';
    const jumps = t => t && t.alive && realTeam(t) === 'outsider' && !S.flags.fangguJumped && !off && !shield(t);
    return {
      inputs: [PL('t', 1, 'Кого убивает Фань Гу')], more: inp => mayorInput(S, inp),
      info: inp => { const t = inp.t && P(S, inp.t[0]);
        if (t && realTeam(t) === 'outsider' && !S.flags.fangguJumped && !off && shield(t)) return { secret: true, show: `Изгой под защитой (${shield(t)}) — не умирает и не становится Фань Гу`, lines: [] };
        return jumps(t) ? { show: 'Изгой: прыжок!', lines: [`${t.name} становится злым Фань Гу, старый Фань Гу (${p.name}) умирает. Разбудите ${t.name}: «ТЕПЕРЬ ВЫ», жетон Фань Гу, «ТЕПЕРЬ ВЫ», большой палец вниз. Приспешников он не узнаёт.`],
          tokens: [{ label: t.name, caption: 'ТЕПЕРЬ ВЫ', role: 'fanggu', thumb: 'down' }] } : null; },
      apply: inp => {
        const t = P(S, inp.t[0]);
        if (jumps(t)) {
          S.flags.fangguJumped = true;
          log(S, `Фань Гу (${p.name}) выбирает Изгоя ${t.name}: прыжок`, 'action');
          changeRole(S, t, 'fanggu', { align: 'evil' });
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
    if (first) {
      // 7+ игроков: Безумцу — любые «приспешники» (столько, сколько Приспешников в игре) и 3 любые добрые роли; Демону — кто Безумец
      const big = coreCount(S) >= 7, k = S.players.filter(q => realTeam(q) === 'minion').length, demon = S.players.find(isDemon);
      const def = stable(S, 'lunatic:' + p.id, () => ({ m: shuffle(S.players.filter(q => q.id !== p.id && !isTraveller(q))).slice(0, k).map(q => q.id),
        b: shuffle(scriptRoles(S, r => canBluff(r) && !inPlay(S, r))).slice(0, 3) }));
      return {
        inputs: big ? [PL('m', k, `Кого показать Безумцу как «Приспешников» (${k})`, notSelf(p)), ROLE('b0', '«Блеф» 1', canBluff), ROLE('b1', '«Блеф» 2', canBluff), ROLE('b2', '«Блеф» 3', canBluff)] : [],
        defaults: big ? { m: def.m, b0: def.b[0], b1: def.b[1], b2: def.b[2] } : {},
        // кто Безумец — настоящему Демону на его шаге («Информация Демону»), а не здесь (заметка пользователя 2026-10-15)
        info: inp => ({ show: `${p.name} считает себя Демоном (${rname(p.believes)})`, lines: [big ? 'Безумцу — «приспешники» и «блефы»' : 'Меньше 7 игроков: Безумцу ничего не показывают',
            demon ? `Настоящему Демону (${demon.name}) покажете Безумца на шаге Демона` : ''],
          tokens: big ? [{ label: `Безумцу (${p.name})`, caption: CARD.minions, players: inp.m || [] }].concat(['b0', 'b1', 'b2'].filter(x => inp[x]).map(x => ({ label: `Безумцу (${p.name})`, caption: CARD.notInPlay, role: inp[x] }))) : [] }),
        apply: () => log(S, `Безумец (${p.name}) узнаёт, что он «Демон»`, 'info'),
      };
    }
    return { inputs: [PL('t', 3, 'Кого «атакует» Безумец', () => true, { min: 0 })],
      apply: inp => { S.night.data.lunatic = inp.t || []; log(S, `Безумец (${p.name}) «атакует»: ${(inp.t || []).map(id => nm(S, id)).join(', ') || 'никого'}`, 'action'); } };
  },

  /* --- не из базовой коробки: роли сценария Catfishing (Carousel) */
  widow: (S, p, first, off) => {
    if (once(S, p, 'widow')) return { active: false, reason: 'Вдова действует только в свою 1-ю ночь' };
    const goodOk = q => q.align === 'good' && q.id !== p.id, good = S.players.filter(goodOk);
    return {
      inputs: [PL('t', 1, 'Кого отравляет Вдова (посмотрев Гримуар)'), PL('know', 1, 'Добрый игрок, который узнаёт, что Вдова в игре', goodOk)],
      defaults: stable(S, 'widowKnow:' + p.id, () => ({ know: good.length ? [pick(good).id] : [] })),
      info: inp => { const k = inp.know && P(S, inp.know[0]), noLook = jinxOn(S, 'widow', 'poppygrower') && poppyActive(S);
        return { show: noLook ? 'Гримуар не показывайте: джинкс с Дурманщиком' : 'Покажите Вдове Гримуар', grim: !noLook, lines: [k ? `Затем разбудите ${k.name} и покажите жетон Вдовы` : ''],
        tokens: k ? [{ label: k.name, role: 'widow', sub: 'Эта роль в игре' }] : [] }; },
      apply: inp => {
        markOnce(S, p, 'widow');
        const t = P(S, inp.t[0]), k = P(S, inp.know[0]);
        if (!off) addTok(S, t, 'poisoned', 'widow');
        addTok(S, k, 'know', 'widow');
        log(S, `Вдова (${p.name}) смотрит Гримуар и травит ${t.name}${off ? ' — не работает' : ''}; ${k.name} узнаёт, что Вдова в игре`, 'action');
      },
    };
  },
  // Егерь (вики): раз за игру ночью выбирает живого игрока; Девица становится Горожанином не из игры (выбирает рассказчик)
  // и узнаёт его. Выбрал не Девицу — ничего, способность потрачена; отказался — способность остаётся
  huntsman: (S, p, first, off) => {
    if (once(S, p, 'huntsman')) return { active: false, reason: 'Способность уже использована' };
    const tf = r => R(r) && R(r).team === 'townsfolk' && !inPlay(S, r) && !S.players.some(q => q.believes === r) && !(S.bluffs || []).includes(r);
    const dam = inp => { const t = inp.t && P(S, inp.t[0]); return t && t.role === 'damsel' ? t : null; };
    return {
      inputs: [PL('t', 1, 'Егерь выбирает живого игрока (можно отказаться — способность останется)', aliveOnly, { min: 0 })],
      more: inp => dam(inp) && !off ? [ROLE('r', 'Девица становится Горожанином, которого нет в игре (выбираете вы)', tf)] : [],
      defaults: stable(S, 'hunt:' + p.id, () => ({ r: pick(S.script.roles.filter(tf)) || null })),
      info: inp => {
        const t = dam(inp); if (!t) return inp.t && inp.t.length ? { secret: true, show: 'Это не Девица — ничего не происходит, способность Егеря потрачена', lines: [] } : null;
        if (off) return { secret: true, show: 'Это Девица, но Егерь пьян или отравлен — ничего не происходит', lines: [] };
        return inp.r ? { show: `Девица (${t.name}) становится: ${rname(inp.r)}`, lines: ['Усыпите Егеря, разбудите Девицу и покажите «ТЕПЕРЬ ВЫ» и новую роль'],
          tokens: [{ label: t.name, caption: CARD.youAre, role: inp.r, align: t.align }] } : null;
      },
      apply: inp => {
        if (!inp.t || !inp.t.length) { log(S, `Егерь (${p.name}) никого не выбирает`, 'action'); return; }
        markOnce(S, p, 'huntsman'); const t = P(S, inp.t[0]);
        if (t.role === 'damsel' && !off && inp.r) { changeRole(S, t, inp.r); log(S, `Егерь (${p.name}) нашёл Девицу: ${t.name} теперь ${rname(inp.r)}`, 'effect'); rebuildRest(S); }
        else { log(S, `Егерь (${p.name}) выбирает ${t.name} — ничего`, 'action'); if (t.role === 'damsel' && off) recordAbn(S, p, 'не превратил Девицу', abnSource(S, p)); }
      },
    };
  },
  // Девица (вики): в 1-ю ночь Приспешники узнают, что Девица в игре (появилась позже — «если ещё не сделали, сделайте сейчас»)
  damsel: (S, p, first) => {
    if (S.flags.damselShown && !first) return { active: false, reason: 'Приспешники уже знают, что Девица в игре', deadOk: true };
    const ms = S.players.filter(q => realTeam(q) === 'minion' && q.role !== 'marionette'); // Марионетку не будят (вики)
    // Дурманщик (злые не знакомятся): будить вместе нельзя — каждому Приспешнику по очереди (вики: «wake each Minion»)
    const apart = meetingBlocker(S);
    if (apart) return { deadOk: true, text: `Злые не знакомятся (${rname(apart.role)}): будите Приспешников по одному и каждому покажите жетон Девицы.`,
      info: () => ({ show: 'Каждому Приспешнику по очереди — жетон Девицы', lines: [ms.length ? `Приспешники: ${ms.map(q => q.name).join(', ')}` : 'Приспешников нет'],
        tokens: ms.map(q => ({ label: q.name, role: 'damsel', sub: 'Эта роль в игре' })) }),
      apply: () => { S.flags.damselShown = true; log(S, `Приспешники по одному узнают, что Девица в игре (${rname(apart.role)})`, 'info'); } };
    return { deadOk: true, info: () => ({ show: 'Разбудите Приспешников и покажите жетон Девицы', lines: [ms.length ? `Приспешники: ${ms.map(q => q.name).join(', ')}` : 'Приспешников нет'],
        tokens: [{ label: 'Приспешникам', role: 'damsel', sub: 'Эта роль в игре' }] }),
      apply: () => { S.flags.damselShown = true; log(S, 'Приспешники узнают, что Девица в игре', 'info'); } };
  },
  balloonist: (S, p, first, off) => {
    const key = 'balloonLast_' + p.id, last = S.flags[key];
    const TYPES = ['townsfolk', 'outsider', 'minion', 'demon'];
    return {
      // трезвому Аэронавту — только игроки другого типа (и Шпион/Затворник: тип выбираете вы); пьяному/отравленному — любые
      inputs: [PL('t', 1, last ? `Покажите игрока другого типа, чем прошлой ночью (не ${TEAM_RU[last.type] || last.type})` : 'Покажите любого игрока',
        q => !last || off || realTeam(q) !== last.type || !!REG_AS[q.role])],
      more: inp => { const t = inp.t && P(S, inp.t[0]); return t && (t.role === 'recluse' || t.role === 'spy') ? [Object.assign(CHOICE('reg', `Каким типом определяется ${t.name} (ваше решение; не выбрали — настоящим)`, TYPES.map(v => ({ v, l: TEAM_RU[v] }))), { optional: true })] : []; },
      defaults: stable(S, 'balloon:' + p.id, () => {
        const c = S.players.filter(q => q.id !== p.id && (!last || realTeam(q) !== last.type));
        return { t: c.length ? [pick(c).id] : [] };
      }),
      info: inp => {
        const t = inp.t && P(S, inp.t[0]); if (!t) return null;
        const type = inp.reg || realTeam(t), same = last && type === last.type;
        return { show: t.name, lines: [`Тип роли: ${TEAM_RU[type] || type}`, last ? `Прошлой ночью: ${nm(S, last.pid)} — ${TEAM_RU[last.type] || last.type}` : '',
          same ? (off ? 'Тип тот же — можно: Аэронавт не трезв или не здоров' : 'Тип тот же, что прошлой ночью: трезвому и здоровому Аэронавту так нельзя') : ''], tokens: [{ players: [t.id] }] };
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
    // по вики рассказчик может решить, что умирают оба; смерть одного из них — по решению пользователя (домашнее правило)
    more: inp => inp.yes === 'yes' ? [CHOICE('die', 'Кто умирает? (ваше решение)', [{ v: 'no', l: 'Никто' }, { v: 'yes', l: 'Оба' },
      { v: 'harlot', l: 'Только Куртизанка' }, { v: 'target', l: 'Только выбранный' }])] : [],
    info: inp => {
      const t = inp.t && P(S, inp.t[0]); if (!t) return null;
      const asked = [{ label: `Выбранному (${t.name})`, caption: CARD.selected, role: 'harlot' }];
      if (inp.yes !== 'yes') return { show: 'Отказ — ничего не происходит', lines: ['Сначала разбудите выбранного: жетон «ОБЛАДАТЕЛЬ ЭТОЙ РОЛИ ВЫБРАЛ ВАС» и жетон Куртизанки'], tokens: asked };
      return { show: `Покажите Куртизанке жетон: ${rname(t.role)}`, lines: [isDemon(t) ? 'Это Демон: не убивайте его, если это закончит игру' : '', inp.die && inp.die !== 'no' && off ? 'Куртизанка пьяна или отравлена — никто не умрёт' : ''],
        tokens: asked.concat([{ label: `Куртизанке (${p.name})`, role: t.role, align: t.align }]) };
    },
    apply: inp => {
      const t = P(S, inp.t[0]);
      log(S, `Куртизанка (${p.name}) выбирает ${t.name}: ${inp.yes === 'yes' ? 'согласие, узнаёт роль ' + rname(t.role) : 'отказ'}`, 'action');
      if (inp.yes !== 'yes' || off) return;
      if (inp.die === 'yes' || inp.die === 'target') attemptKill(S, t, 'ability', 'harlot');
      if (inp.die === 'yes' || inp.die === 'harlot') attemptKill(S, p, 'ability', 'harlot');
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
    info: inp => { const t = inp.t && P(S, inp.t[0]); return t ? { show: inp.mode === 'twice' ? 'Два пальца' : 'Один палец', lines: [`Разбудите ${t.name}: жетон «ОБЛАДАТЕЛЬ ЭТОЙ РОЛИ ВЫБРАЛ ВАС», жетон Баристы, затем пальцы`],
      tokens: [{ label: t.name, caption: CARD.selected, role: 'barista', text: inp.mode === 'twice' ? '2' : '1', sub: inp.mode === 'twice' ? 'Ваша способность сработает дважды' : 'Вы трезвы, здоровы и получаете верную информацию' }] } : null; },
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
      info: inp => inp.r ? { show: `Покажите «ТЕПЕРЬ ВЫ» и жетон: ${rname(inp.r)}`, lines: [], tokens: [{ caption: CARD.youAre, role: inp.r, align: p.align }] } : null,
      apply: inp => {
        markOnce(S, p, 'apprentice'); p.gained = inp.r; addFresh(S, p.id, inp.r);
        log(S, `Ученик (${p.name}) получает способность: ${rname(inp.r)}`, 'effect'); rebuildRest(S);
      },
    };
  },

  // Мецефель (вики): в 1-ю ночь узнаёт тайное слово; первый добрый, произнёсший его, ночью становится злым
  // (если Мецефель этой ночью пьян или отравлен — игрок остаётся добрым, способность потрачена)
  mezepheles: (S, p, first, off) => {
    if (first) return {
      inputs: [Object.assign(TEXT('word', 'Тайное слово — необычное, чтобы его не сказали случайно (можно своё)'), { ideas: 'MEZ_WORDS' })],
      defaults: stable(S, 'mezWord:' + p.id, () => ({ word: S.flags.mezWord || (typeof IDEAS !== 'undefined' ? pick(IDEAS.MEZ_WORDS) : '') })),
      info: inp => inp.word ? { show: `Тайное слово: ${inp.word}`, lines: ['Покажите на экране или скажите шёпотом'], tokens: [{ caption: 'ТАЙНОЕ СЛОВО', text: String(inp.word).trim() }] } : null,
      apply: inp => { S.flags.mezWord = String(inp.word || '').trim(); log(S, `Мецефель (${p.name}) узнаёт тайное слово: «${S.flags.mezWord}»`, 'info'); },
    };
    const t = S.flags.mezTarget && P(S, S.flags.mezTarget);
    if (S.flags.mezUsed || !t) return { active: false, reason: S.flags.mezUsed ? 'Способность уже использована' : 'Никто из добрых не произнёс тайное слово' };
    return {
      info: () => off ? { secret: true, show: `${t.name} остаётся добрым: Мецефель пьян или отравлен, способность потрачена`, lines: [] }
        : { show: `${t.name} становится злым`, lines: ['Разбудите его: «ТЕПЕРЬ ВЫ» и жест «злой». Мецефель об этом не узнаёт'], tokens: [{ label: t.name, caption: 'Вы злой', thumb: 'down' }] },
      apply: () => { S.flags.mezUsed = true; S.flags.mezTarget = null;
        if (off) return log(S, `${t.name} произнёс тайное слово, но Мецефель пьян или отравлен — остаётся добрым`, 'effect');
        t.align = 'evil'; log(S, `${t.name} произнёс тайное слово и становится злым (Мецефель)`, 'effect'); },
    };
  },
  // Амнезиак (вики): способность придумывает рассказчик и ведёт её как обычную — будит, просит выбрать, показывает информацию.
  // Заметка пользователя 2026-10-14 «выбор реализован, а дальше ничего»: «Что показать» — число, ДА/НЕТ или слово — на весь экран
  // Что показать — карточкой, как у других ролей: ДА/НЕТ, число, жетон роли, игроки или свой текст крупно на весь экран
  // (заметка пользователя 2026-10-15). Для способностей из подсказок вид карточки подставляется сам (IDEAS.AMNESIAC_KIND)
  amnesiac: (S, p, first, off) => {
    const key = 'amnesiac_' + p.id;
    const kindOf = inp => inp.kind || amnKind(inp.ability) || (String(inp.say || '').trim() ? 'text' : 'none');
    const show = inp => { // {show, tokens} — что увидит игрок
      const k = kindOf(inp), names = ids => (ids || []).map(id => nm(S, id)).join(', ');
      if (k === 'yesno' && inp.yn) return { show: inp.yn, tokens: [{ text: inp.yn }] };
      if (k === 'number') return { show: String(inp.num ?? 0), tokens: [{ text: String(inp.num ?? 0) }] };
      if (k === 'role' && inp.r) return { show: rname(inp.r) + ((inp.rp || []).length ? ` — ${names(inp.rp)}` : ''), tokens: [{ role: inp.r, players: (inp.rp || []).length ? inp.rp : undefined }] };
      if (k === 'player' && (inp.sp || []).length) return { show: names(inp.sp), tokens: [{ caption: inp.sp.length === 1 ? CARD.thisPlayer : '', players: inp.sp }] };
      const say = String(inp.say || '').trim();
      if (k === 'text' && say) return { show: say, tokens: [{ text: say }] };
      return { show: null };
    };
    return {
      inputs: [Object.assign(TEXT('ability', 'Способность Амнезиака — решаете вы, игрок её не знает'), { ideas: 'AMNESIAC' }), PL('t', 3, 'Выбор Амнезиака, если способность его требует', () => true, { min: 0 })],
      more: inp => {
        const k = kindOf(inp);
        const detail = { yesno: [CHOICE('yn', 'Ответ', [{ v: 'ДА', l: 'ДА' }, { v: 'НЕТ', l: 'НЕТ' }])], number: [NUM('num', 'Число')],
          role: [ROLE('r', 'Какую роль показать', () => true, { all: true }), PL('rp', 3, 'На кого указать (необязательно)', () => true, { min: 0 })],
          player: [PL('sp', 3, 'Каких игроков показать', () => true, { min: 1 })], text: [TEXT('say', 'Свой текст — крупно на весь экран')] }[k] || [];
        return [Object.assign(CHOICE('kind', 'Что показать Амнезиаку', AMN_SHOW), { def: k, optional: true })].concat(detail);
      },
      defaults: { ability: S.flags[key] || '' },
      info: inp => { const ab = String(inp.ability || '').trim(), sh = show(inp);
        if (!sh.show && !ab) return null;
        return { show: sh.show, lines: [ab ? `Способность: ${ab}` : '', off ? `Амнезиак ${off}: можно показать ложное` : '', 'Эффекты способности (смерть, яд, защита) отметьте вручную в «Гримуаре» — приложение их не знает'],
          tokens: sh.tokens }; },
      apply: inp => {
        S.flags[key] = String(inp.ability || '').trim();
        const said = show(inp).show;
        log(S, `Амнезиак (${p.name})${S.flags[key] ? ': ' + S.flags[key] : ''}${inp.t && inp.t.length ? ' — выбор: ' + inp.t.map(id => nm(S, id)).join(', ') : ''}${said ? ` — показано: ${said}` : ''}`, 'action');
      },
    };
  },
  // Марионетка (вики): в 1-ю ночь разбудить Демона, показать «ЭТОТ ИГРОК», жетон Марионетки и указать на неё. Сама она просыпается
  // как роль, которой себя считает (как Пьяница), с Приспешниками не знакомится
  marionette: (S, p) => {
    const d = S.players.find(isDemon);
    return { deadOk: true, info: () => ({ show: `Демону: Марионетка — ${p.name}`, lines: [`${p.name} считает себя ${rname(p.believes)} — сама она ничего не узнаёт`],
        tokens: d ? [{ label: `Демону (${d.name})`, caption: CARD.thisPlayer, role: 'marionette', players: [p.id] }] : [] }),
      apply: () => log(S, `Демон узнаёт Марионетку: ${p.name}`, 'info') };
  },
  // Верховная Жрица (вики): каждую ночь рассказчик указывает на игрока, с которым ей, по его мнению, стоит поговорить больше всего —
  // живого или мёртвого, доброго или злого, того же или другого (сценарий Blind Hunt, 2026-10-15)
  highpriestess: (S, p, first, off) => {
    const last = S.flags['hpLast_' + p.id];
    return {
      inputs: [PL('t', 1, 'С кем, по-вашему, Жрице стоит поговорить больше всего', notSelf(p))],
      info: inp => { const t = inp.t && P(S, inp.t[0]); if (!t) return null;
        return { show: t.name, lines: [last && P(S, last) ? `Прошлой ночью: ${nm(S, last)}` : '', off ? `Жрица ${off}: можно указать на кого угодно` : ''], tokens: [{ players: [t.id] }] }; },
      apply: inp => { S.flags['hpLast_' + p.id] = inp.t[0]; log(S, `Верховная Жрица (${p.name}) узнаёт: поговорить с ${nm(S, inp.t[0])}`, 'info'); },
    };
  },
  // Аристократ (вики): в свою 1-ю ночь узнаёт 3 игроков — ровно 1 злой и 2 добрых. Пьян/отравлен — можно ложно (0 или 2+ злых)
  noble: (S, p, first, off) => {
    if (!first) return { active: false, reason: 'Аристократ узнаёт только в свою первую ночь' };
    const dist = distortion(S, p), others = S.players.filter(q => q.id !== p.id && !isTraveller(q));
    const def = stable(S, `noble:${p.id}:${dist ? 'f' : 't'}`, () => {
      const ev = shuffle(others.filter(q => q.align === 'evil')), gd = shuffle(others.filter(q => q.align === 'good'));
      return seatSort(S, (dist ? (Math.random() < 0.5 ? gd.slice(0, 3) : ev.slice(0, 2).concat(gd.slice(0, 1))) : ev.slice(0, 1).concat(gd.slice(0, 2))).map(q => q.id));
    });
    const evilN = inp => (inp.t || []).filter(id => P(S, id) && P(S, id).align === 'evil').length;
    return { inputs: [PL('t', 3, `Покажите 3 игроков: ровно 1 злой${dist ? ' (рекомендация — ложная)' : ''}`, notSelf(p))], defaults: { t: def },
      info: inp => (inp.t || []).length === 3 ? { show: seatSort(S, inp.t).map(id => nm(S, id)).join(', '), lines: [evilN(inp) === 1 ? 'Информация верная' : `Злых среди них: ${evilN(inp)} — информация ложная`,
          dist && dist.must && evilN(inp) === 1 ? 'Вортокс: нужна ЛОЖНАЯ информация' : '', ...regNote(S, inp.t)], tokens: [{ players: seatSort(S, inp.t), lead: 'Только один из этих игроков злой:' }] } : null,
      apply: inp => { S.players.forEach(q => rmTok(q, 'know', 'noble')); inp.t.forEach(id => addTok(S, P(S, id), 'know', 'noble'));
        log(S, `Аристократ (${p.name}) узнаёт: ${inp.t.map(id => nm(S, id)).join(', ')}`, 'info'); if (dist && evilN(inp) !== 1) recordAbn(S, p, 'ложная информация', dist.src); } };
  },
  // Генерал (вики): каждую ночь — кто, по мнению рассказчика, побеждает: палец вверх (добро), вниз (зло), в сторону (никто).
  // Оценку приложение прикидывает по живым добрым/злым и мёртвым злым — решаете вы (заметка пользователя 2026-10-14)
  general: (S, p, first, off) => {
    const g = generalGuess(S), dist = distortion(S, p);
    const SIDE = { good: 'ДОБРО', evil: 'ЗЛО', neither: 'НИЧЬЯ' }, THUMB = { good: 'up', evil: 'down', neither: 'side' };
    return {
      inputs: [CHOICE('side', 'Кто, по-вашему, побеждает', [{ v: 'good', l: 'Добро 👍' }, { v: 'evil', l: 'Зло 👎' }, { v: 'neither', l: 'Никто 👉' }])],
      defaults: { side: g.side },
      info: inp => { const s = inp.side || g.side;
        return { show: `${SIDE[s]} — палец ${s === 'good' ? 'вверх' : s === 'evil' ? 'вниз' : 'в сторону'}`, lines: [`Оценка приложения: ${SIDE[g.side].toLowerCase()} (${g.why}) — решаете вы`, dist ? `Генерал ${dist.label.toLowerCase()}: можно показать ложное` : ''],
          tokens: [{ caption: SIDE[s], thumb: THUMB[s] }] }; },
      apply: inp => log(S, `Генерал (${p.name}): ${SIDE[inp.side || g.side].toLowerCase()}`, 'info'),
    };
  },
  // Инженер (вики): раз за игру ночью выбирает, какие Приспешники или какой Демон в игре (не то и другое). Игроки остаются злыми,
  // меняются только роли; роль уже в игре остаётся у того же игрока. Каждого изменённого будят: «ТЕПЕРЬ ВЫ» и новая роль
  engineer: (S, p, first, off) => {
    if (once(S, p, 'engineer')) return { active: false, reason: 'Способность уже использована' };
    const minions = S.players.filter(q => realTeam(q) === 'minion' && q.role !== 'marionette'), demons = S.players.filter(isDemon);
    const targets = inp => inp.mode === 'demon' ? demons : inp.mode === 'minions' ? minions : [];
    const changes = inp => targets(inp).map((q, i) => ({ q, r: inp['r' + i] })).filter(x => x.r && x.r !== x.q.role);
    return {
      inputs: [CHOICE('mode', 'Инженер выбирает', [{ v: 'no', l: 'Отказ' }, { v: 'demon', l: 'Демона' }, { v: 'minions', l: 'Приспешников' }])], defaults: { mode: 'no' },
      more: inp => targets(inp).map((q, i) => ROLE('r' + i, `Кем станет ${q.name} (сейчас ${rname(q.role)}) — не выбрано: прежняя роль`, r => R(r).team === (inp.mode === 'demon' ? 'demon' : 'minion') && r !== 'marionette', { optional: true })),
      info: inp => { if (inp.mode === 'no' || !inp.mode) return null; const ch = changes(inp), rs = ch.map(x => x.r);
        return { show: ch.length ? ch.map(x => `${x.q.name}: ${rname(x.r)}`).join(', ') : 'Роли не меняются', lines: [
            new Set(rs).size !== rs.length ? 'Одна роль выбрана дважды — так нельзя' : '', off ? 'Инженер пьян или отравлен — роли не меняются (способность всё равно потрачена)' : '',
            'Инженер теряет способность. Сами игроки остаются злыми, меняются только роли'],
          tokens: off ? [] : ch.map(x => ({ label: x.q.name, caption: CARD.youAre, role: x.r })) }; },
      apply: inp => {
        if (!inp.mode || inp.mode === 'no') { log(S, `Инженер (${p.name}) отказывается`, 'action'); return; }
        markOnce(S, p, 'engineer'); const ch = changes(inp);
        if (off) { log(S, `Инженер (${p.name}) выбирает ${inp.mode === 'demon' ? 'Демона' : 'Приспешников'} — не работает`, 'action'); if (ch.length) recordAbn(S, p, 'роли не изменились', abnSource(S, p)); return; }
        for (const x of ch) { const old = changeRole(S, x.q, x.r, { keep: true, align: 'evil' }); log(S, `Инженер: ${x.q.name} — ${rname(old)} → ${rname(x.r)}`, 'effect'); }
        endOrphanEffects(S); rebuildRest(S); log(S, `Инженер (${p.name}) использовал способность`, 'action');
      },
    };
  },
  // Дурманщик — пассивная способность: ночью не просыпается (злые не знакомятся; умрёт — знакомство отдельными шагами ночи)
  poppygrower: () => ({ active: false, reason: 'Не просыпается: пока Дурманщик жив и трезв, злые не знакомятся; если умрёт — злые знакомятся этой ночью (шаги «Злые знакомятся»)', deadOk: true }),
  // Фермер (вики): умер ночью — живой добрый игрок становится Фермером (рассказчик выбирает), его будят: «ТЕПЕРЬ ВЫ» и жетон Фермера
  farmer: (S, p, first, off) => {
    const died = S.night.deaths.some(d => d.pid === p.id) && !p.alive;
    if (!died) return { active: false, reason: 'Фермер не умирал этой ночью', deadOk: true };
    if (off) return { active: false, reason: `Фермер умер ${off} — способность не сработала`, deadOk: true };
    return { deadOk: true, inputs: [PL('t', 1, 'Кто из живых добрых становится Фермером', q => q.alive && q.align === 'good' && q.id !== p.id)],
      info: inp => { const t = inp.t && P(S, inp.t[0]); return t ? { show: `${t.name} — теперь Фермер`, lines: [`Его прежняя роль (${rname(t.role)}) уходит из игры`], tokens: [{ label: t.name, caption: CARD.youAre, role: 'farmer' }] } : null; },
      apply: inp => { const t = P(S, inp.t[0]); const old = changeRole(S, t, 'farmer'); log(S, `Фермер: ${t.name} становится Фермером (был ${rname(old)})`, 'effect'); rebuildRest(S); } };
  },
  // Аль-Адихия (вики): каждую ночь, кроме первой, может выбрать 3 игроков (все узнают, кто). По очереди: «Аль-Адихия выбрал …
  // Вы выбираете жить?» Кивнул — жив (мёртвый оживает), покачал — умирает. Если все трое живы — все трое умирают.
  // На рассвете объявить, кто из троих жив, кто мёртв (заметка пользователя 2026-10-14: «их выбор и последствия, воскрешение»)
  alhadikhia: (S, p, first, off, base) => {
    if (demonExorcised(S, p, base)) return {};
    const ch = [{ v: 'live', l: 'Жить (кивнул)' }, { v: 'die', l: 'Умереть (покачал)' }];
    return {
      inputs: [PL('t', 3, 'Аль-Адихия выбирает 3 игроков по порядку (можно никого)', () => true, { min: 0 })],
      more: inp => (inp.t || []).length === 3 ? inp.t.map((id, i) => CHOICE('c' + i, `${i + 1}. ${nm(S, id)}: «Вы выбираете жить?»`, ch)) : [],
      info: inp => { const ids = inp.t || []; if (ids.length && ids.length < 3) return { show: 'Нужно выбрать троих — или никого', lines: [] };
        if (!ids.length) return { show: 'Никого — объявлять нечего', lines: [] };
        const res = alhOutcome(S, ids, inp);
        return { show: `Объявите всем: Аль-Адихия выбрал ${ids.map(id => nm(S, id)).join(', ')} — тишина!`, lines: [
            'Будите по очереди (1, 2, 3): «Аль-Адихия выбрал [имя]. Вы выбираете жить?» Кивок — жить, покачал — умереть',
            res ? res.text : 'Отметьте выбор каждого', off ? 'Демон пьян или отравлен: способность не работает — никто не умирает и не оживает' : ''] }; },
      apply: inp => {
        const ids = inp.t || []; S.night.data.alh = ids.slice();
        if (!ids.length) { log(S, `Аль-Адихия (${p.name}) никого не выбирает`, 'action'); return; }
        log(S, `Аль-Адихия (${p.name}) выбирает: ${ids.map((id, i) => `${i + 1}. ${nm(S, id)} — ${inp['c' + i] === 'live' ? 'жить' : 'умереть'}`).join('; ')}`, 'action');
        if (off) { recordAbn(S, p, 'выбор Аль-Адихии не сработал', abnSource(S, p)); return; }
        ids.forEach((id, i) => { const q = P(S, id); if (!q) return; if (inp['c' + i] === 'live') revive(S, q, 'Аль-Адихия: выбрал жить'); else attemptKill(S, q, 'demon', 'alhadikhia'); });
        const qs = ids.map(id => P(S, id)).filter(Boolean);
        if (qs.length === 3 && qs.every(q => q.alive)) { log(S, 'Аль-Адихия: все трое живы — все трое умирают', 'effect'); qs.forEach(q => attemptKill(S, q, 'demon', 'alhadikhia')); }
      },
    };
  },
};
// Аль-Адихия: что получится из ответов (без защит — их учтёт применение)
function alhOutcome(S, ids, inp) {
  if (ids.some((id, i) => !inp['c' + i])) return null;
  const alive = ids.map((id, i) => inp['c' + i] === 'live');
  if (alive.every(Boolean)) return { text: 'Все трое выбрали жить — все трое умирают' };
  return { text: ids.map((id, i) => `${nm(S, id)} — ${alive[i] ? (P(S, id).alive ? 'жив' : 'оживает') : 'умирает'}`).join(', ') };
}
// Генерал: грубая оценка, кто ближе к победе — по живым добрым и злым и по мёртвым злым (решает рассказчик)
function generalGuess(S) {
  const al = S.players.filter(q => q.alive && !isTraveller(q)), evil = al.filter(q => q.align === 'evil').length, good = al.length - evil;
  const deadEvil = S.players.filter(q => !q.alive && q.align === 'evil' && !isTraveller(q)).length;
  const why = `живых добрых ${good}, злых ${evil}, мёртвых злых ${deadEvil}`;
  if (!S.players.some(demonAlive)) return { side: 'good', why: 'живых Демонов нет' };
  if (al.length <= 4) return { side: 'evil', why: `живых ${al.length} — Демону осталось немного; ${why}` };
  const ratio = evil / Math.max(1, al.length);
  if (ratio >= 0.4) return { side: 'evil', why };
  if (ratio <= 0.25 && deadEvil >= 1) return { side: 'good', why };
  return { side: 'neither', why };
}
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
  highpriestess: { all: [Y('Кого показать: живого или мёртвого, доброго или злого; можно того же, что прошлой ночью (вики)'),
    Y('Например: у игрока есть важная информация, которую он не раскрыл; злой с неубедительным блефом; добрый, которому мало верят или который идёт по ложному следу')] },
  gossip: { other: [Y('Было ли дневное заявление Сплетницы верным (было ли оно — отмечено в конце дня). Если да — вы выбираете, кто умирает')] },
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
  lunatic: { all: [I('как будто он Демон — ничего не происходит'), Y('Что показать Безумцу; настоящий Демон узнаёт его выбор')] },
  clockmaker: { first: [Y('Число шагов от Демона до ближайшего Приспешника')] },
  dreamer: { all: [I('1 игрока, не себя и не Странника'), Y('1 добрую и 1 злую роль, одна из них — его; ложная — любая роль другой стороны (по умолчанию: добрая — которой нет в игре, злая — Приспешник из игры)')] },
  harpy: { all: [I('2 игроков по очереди'), Y('Будите только первого: «ОБЛАДАТЕЛЬ ЭТОЙ РОЛИ ВЫБРАЛ ВАС», жетон Гарпии, укажите на второго. Завтра первый «помешан», что второй злой, — иначе можете убить одного или обоих')] },
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
  pithag: { other: [I('1 игрока и роль; если роль уже в игре — ничего не происходит. Сторона игрока не меняется, он узнаёт новую роль'), Y('Если создан Демон — смерти этой ночью любые, на ваше усмотрение')] },
  fanggu: { other: [I('любого игрока; первый убитый так Изгой становится злым Фань Гу, а Фань Гу умирает')] },
  vigormortis: { other: [I('любого игрока'), Y('Если убит Приспешник — какой сосед-Горожанин отравлен')] },
  nodashii: { other: [I('любого игрока. Соседи-Горожане Но Даши отравлены всё время')] },
  vortox: { other: [I('любого игрока. Информация Горожан всегда ложная')] },
  huntsman: { all: [I('1 живого игрока, раз за игру; может отказаться — способность останется'), Y('Если это Девица — каким Горожанином не из игры она станет; она узнаёт новую роль')] },
  damsel: { first: [Y('Покажите Приспешникам жетон Девицы')], other: [Y('Если Девица появилась позже и Приспешники о ней ещё не знают — покажите им жетон')] },
  widow: { first: [Y('Покажите Гримуар столько, сколько нужно'), I('любого игрока: он отравлен, пока Вдова жива'), Y('1 доброго игрока: он узнаёт, что Вдова в игре (но не кто она и кого отравила)')] },
  balloonist: { first: [Y('Любой игрок: живой или мёртвый, добрый или злой')], other: [Y('Игрок с типом роли не как у показанного прошлой ночью. Пьяному или отравленному Аэронавту можно тот же тип')] },
  tinker: { other: [Y('Можете решить, что Механик умирает (днём — кнопкой на экране дня). Не заканчивайте этим игру')] },
  harlot: { other: [I('1 живого игрока, не себя'), Y('Если выбранный согласился — покажите Куртизанке его роль; можете решить, что умирают оба (по вики) или один из них. Если это Демон, не заканчивайте этим игру')] },
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
  return (inp.t || []).map(id => P(S, id)).find(q => q && actsAs(q) === 'goon' && q.alive && q !== actor && !abilityOff(S, q)) || null;
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
  // запись для правки из журнала: какой шаг, с каким выбором и был ли игрок пьян/отравлен; записи журнала шага помечаются ею
  const k = rpRec(S, { t: 'step', key: step.key, title: spec.title + (spec.who ? ` (${spec.who})` : ''), inp: JSON.parse(JSON.stringify(inp || {})), dist: spec.active && spec.dist ? spec.dist.label : null }), l0 = S.log.length;
  if (spec.active) {
    if (step.pid && !S.night.woke.includes(step.pid)) S.night.woke.push(step.pid);
    // выбор самого игрока (в рамках выбора «Игрок выбирает») — для фактов Саванта: кто, какой ролью (own — это правда его роль,
    // а не Пьяница/Философ), кого выбрал; тип, сторона, жизнь и роль выбранных — на момент выбора
    if (step.pid && S.night.data.picks && (spec.bounds || []).some(b => b.w === 'Игрок выбирает')) {
      const a = P(S, step.pid), ts = ((inp || {}).t || []).map(id => P(S, id)).filter(Boolean);
      S.night.data.picks.push({ by: a.id, role: step.id, own: a.role === step.id, team: realTeam(a), evil: a.align === 'evil', t: ts.map(q => q.id),
        types: ts.map(realTeam), roles: ts.map(q => q.role), demon: ts.filter(q => q !== a && isDemon(q)).map(q => q.id),
        bad: ts.filter(q => q.align === 'evil').map(q => q.id), dead: ts.filter(q => !q.alive).map(q => q.id) });
    }
    if (goonHit(S, step, spec, inp || {})) spec = stepSpec(S, step); // выбравший Наёмника пьян — пересчитываем шаг
    spec.apply(inp || {});
  }
  rpTag(S, l0, k);
  if (!S.result) { S.night.i += 1; if (S.night.i >= S.night.steps.length) endNight(S); }
  return { ok: true };
}
// how: 'manual' — рассказчик нажал «Пропустить» (шаг попадает в журнал, его можно выполнить позже через журнал);
// 'auto' — шаг не срабатывает и пропущен сам
function skipStep(S, how) {
  const st = currentStep(S), spec = how === 'manual' && st ? stepSpec(S, st) : null;
  const k = st ? rpRec(S, { t: 'skip', key: st.key, how: how || 'auto' }) : -1, l0 = S.log.length;
  if (spec && spec.active) {
    log(S, `Пропущен шаг: ${spec.title}${spec.who ? ` (${spec.who})` : ''}`, 'skip');
    // По (вики): «покачал головой» — следующей ночью атакует троих; пропуск шага По = никого не выбрал (заметка пользователя 2026-10-14)
    if (st.id === 'po' && !S.flags.poCharged && !abilityOff(S, P(S, st.pid))) { S.flags.poCharged = true; log(S, 'По никого не выбрал — следующей ночью атакует троих', 'action'); }
    rpTag(S, l0, k);
  }
  S.night.i += 1; if (S.night.i >= S.night.steps.length) endNight(S);
}

/* ------------------------------------------------------------ правка ночного выбора задним числом (журнал) */
// Заметка пользователя 2026-10-12: игрок не понял, что делать, рассказчик пропустил шаг или ошибся — выбор меняют через журнал,
// и приложение сразу показывает, что это за собой тянет. Как устроено: на закате (startNight) — снимок состояния (rp.base), дальше
// до следующего заката по порядку пишутся записи rp.recs: шаги ночи (выбор или пропуск) и прочие изменения (patch — разница
// состояния до и после действия, её пишет интерфейс в act). Правка = переиграть записи от снимка с новым выбором.
// Поэтому изменить можно выбор последней ночи — и ночью, и следующим днём, пока не наступила новая ночь.
function rpStart(S) {
  S.rp = null;
  const base = JSON.stringify(Object.assign({}, S, { log: [], draft: null }));
  S.rp = { id: uid(), base, logLen: S.log.length, recs: [] };
}
function rpRec(S, rec) { if (!S.rp) return -1; S.rp.recs.push(rec); return S.rp.recs.length - 1; }
function rpTag(S, from, k) { if (k < 0 || !S.rp) return; for (let i = from; i < S.log.length; i++) { S.log[i].r = k; S.log[i].w = S.rp.id; } }
const rpStrip = S => JSON.stringify(Object.assign({}, S, { log: undefined, rp: undefined }));
const jstr = v => JSON.stringify(v);
// разница состояний: объекты — по ключам; массивы — что убрали и что добавили (порядок не важен: жетоны, смерти, номинации);
// игроки — по id (порядок мест — целиком); шаги ночи — целиком
function jdiff(a, b, path) {
  if (jstr(a) === jstr(b)) return undefined;
  if (b === undefined) return { x: 1 };
  if (path === 'players' && Array.isArray(a) && Array.isArray(b)) {
    const ia = a.map(p => p.id), ib = b.map(p => p.id), ch = {};
    for (const p of b) { const o = a.find(q => q.id === p.id); if (o) { const d = jdiff(o, p, 'player'); if (d) ch[p.id] = d; } }
    return { p: { order: jstr(ia) === jstr(ib) ? null : ib, add: b.filter(p => !ia.includes(p.id)), del: ia.filter(id => !ib.includes(id)), ch } };
  }
  if (Array.isArray(a) && Array.isArray(b) && path !== 'night.steps') {
    const rm = a.map(jstr), add = [];
    for (const v of b) { const i = rm.indexOf(jstr(v)); if (i >= 0) rm.splice(i, 1); else add.push(v); }
    return { a: { rm, add } };
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const o = {};
    for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) { const d = jdiff(a[k], b[k], path ? path + '.' + k : k); if (d) o[k] = d; }
    return { o };
  }
  return { s: b };
}
function jpatch(t, d) { // возвращает новое значение
  if (!d) return t;
  if (d.x) return undefined;
  if ('s' in d) return JSON.parse(jstr(d.s));
  if (d.a) { const arr = Array.isArray(t) ? t : [];
    for (const r of d.a.rm) { const i = arr.findIndex(v => jstr(v) === r); if (i >= 0) arr.splice(i, 1); }
    for (const v of d.a.add) arr.push(JSON.parse(jstr(v))); return arr; }
  if (d.p) { let arr = Array.isArray(t) ? t : [];
    arr = arr.filter(p => !d.p.del.includes(p.id));
    for (const [id, sd] of Object.entries(d.p.ch)) { const p = arr.find(q => q.id === id); if (p) jpatch(p, sd); }
    for (const p of d.p.add) if (!arr.some(q => q.id === p.id)) arr.push(JSON.parse(jstr(p)));
    if (d.p.order) arr.sort((x, y) => { const i = d.p.order.indexOf(x.id), j = d.p.order.indexOf(y.id); return (i < 0 ? 1e3 : i) - (j < 0 ? 1e3 : j); });
    return arr; }
  if (d.o) { const obj = t && typeof t === 'object' && !Array.isArray(t) ? t : {};
    for (const [k, sd] of Object.entries(d.o)) { const v = jpatch(obj[k], sd); if (v === undefined) delete obj[k]; else obj[k] = v; }
    return obj; }
  return t;
}
// прочее изменение (не шаг ночи): интерфейс передаёт состояние до действия (rpStrip) и длину журнала до него
function recPatch(S, beforeJson, logLen) {
  if (!S.rp) return;
  const d = jdiff(JSON.parse(beforeJson), JSON.parse(rpStrip(S)), ''), lg = S.log.slice(logLen);
  if (!d && !lg.length) return;
  S.rp.recs.push({ t: 'patch', d: d || null, log: JSON.parse(jstr(lg)) });
}
const stepTitle = (S, st) => { try { const sp = stepSpec(S, st); return sp.title + (sp.who ? ` (${sp.who})` : ''); } catch (e) { return rname(st.id); } };
// переиграть запись: edits — { номер записи: { inp } или { skip: true } }; upto — остановиться перед этой записью (форма правки
// показывает шаг в том состоянии, в каком он был). Возвращает новое состояние T и заметки о том, что поменялось по ходу ночи
function replayNight(S, edits, upto) {
  const rp = S.rp, T = JSON.parse(rp.base), notes = [];
  T.log = JSON.parse(jstr(S.log.slice(0, rp.logLen)));
  T.rp = { id: rp.id, base: rp.base, logLen: rp.logLen, recs: [] };
  if (S.night && S.night.data && S.night.data.st) T.night.data.st = JSON.parse(jstr(S.night.data.st)); // те же случайные рекомендации
  for (let k = 0; k < rp.recs.length; k++) {
    if (upto === k) return { T, notes, at: k };
    const rec = rp.recs[k], ed = edits && edits[k];
    if (rec.t === 'patch') {
      if (rec.d) { const saved = { log: T.log, rp: T.rp }; jpatch(T, rec.d); Object.assign(T, saved); }
      T.log.push(...JSON.parse(jstr(rec.log || [])));
      T.rp.recs.push(JSON.parse(jstr(rec)));
      continue;
    }
    // шаги, которых не было в записи (появились из-за правки), — пропускаем, если записанный шаг ещё впереди
    let guard = 0;
    while (T.phase === 'night' && currentStep(T) && currentStep(T).key !== rec.key && T.night.steps.slice(T.night.i).some(s => s.key === rec.key) && guard++ < 80) {
      const cur = currentStep(T), sp = stepSpec(T, cur);
      if (sp.active) notes.push(`Новый шаг: ${stepTitle(T, cur)} — пропущен. Выполните его через журнал («Пропущен шаг»).`);
      skipStep(T, sp.active ? 'manual' : 'auto');
    }
    const cur = T.phase === 'night' && !T.result && currentStep(T);
    if (!cur || cur.key !== rec.key) {
      if (rec.t === 'step') notes.push(`${rec.title || rname(rec.key.split(':')[0])}: шаг больше не наступает — его действие отменено.`);
      continue;
    }
    const sp = stepSpec(T, cur), title = stepTitle(T, cur);
    if (ed ? ed.skip : rec.t === 'skip') {
      if (!ed && rec.how !== 'manual' && sp.active) notes.push(`${title}: теперь просыпается, но шаг был пропущен — выполните его через журнал («Пропущен шаг»).`);
      skipStep(T, ed || sp.active ? 'manual' : rec.how);
      continue;
    }
    if (!sp.active && rec.t === 'step') notes.push(`${title}: теперь не просыпается (${sp.reason}) — выбор не применяется.`);
    const r = applyStep(T, cur, ed ? ed.inp : rec.inp);
    if (!r.ok) { notes.push(`${title}: прежний выбор больше не подходит (${r.missing.join('; ')}) — шаг пропущен, выполните его через журнал.`); skipStep(T, 'manual'); continue; }
    const d2 = sp.active && sp.dist ? sp.dist.label : null;
    if (sp.active && !!d2 !== !!rec.dist) notes.push(`${title}: ${d2 ? `теперь ${d2.toLowerCase()} — способность не работает, информацию можно было исказить` : `больше не ${rec.dist.toLowerCase()} — способность работает; проверьте, верно ли то, что вы показали`}.`);
  }
  return { T, notes, at: rp.recs.length };
}
// правка из журнала: новое состояние, но то, что рассказчик сейчас выбирает (черновики шага и дня), остаётся как было
function editNight(S, k, edit) {
  const res = replayNight(S, { [k]: edit });
  const T = res.T, sc = currentStep(S), tc = currentStep(T);
  if (T.phase === 'night' && S.phase === 'night' && sc && tc && sc.key === tc.key && S.draft && String(S.draft.key).endsWith(':' + sc.key))
    T.draft = { key: T.n + ':' + T.night.i + ':' + tc.key, inp: JSON.parse(jstr(S.draft.inp)) };
  if (S.night && T.night && S.night.data) for (const key of ['fakeGrim', 'morn']) if (key in S.night.data) T.night.data[key] = S.night.data[key];
  if (S.phase === 'day' && T.phase === 'day' && S.day && T.day) { T.day.picks = JSON.parse(jstr(S.day.picks || {})); T.day.draft = JSON.parse(jstr(S.day.draft)); }
  T.updated = S.updated;
  return { T, notes: res.notes, changes: stateChanges(S, T) };
}
// что поменялось между состояниями — словами для рассказчика
function stateChanges(S, T) {
  const out = [], tk = t => `${TOK_RU[t.k] || t.k}${t.src && R(t.src) ? ` (${R(t.src).name})` : ''}${t.note ? `: ${R(t.note) ? R(t.note).name : t.note}` : ''}`;
  if (!!S.result !== !!T.result || (S.result && T.result && S.result.winner !== T.result.winner))
    out.push(T.result ? `Игра заканчивается: ${T.result.winner === 'good' ? 'победа добра' : 'победа зла'} (${T.result.reason})` : 'Игра больше не заканчивается — продолжается');
  for (const p of S.players) {
    const q = P(T, p.id); if (!q) { out.push(`${p.name}: нет за столом`); continue; }
    if (p.alive !== q.alive) out.push(`${p.name}: ${q.alive ? 'остаётся в живых' : 'умирает'}`);
    if (p.role !== q.role) out.push(`${p.name}: роль ${rname(p.role)} → ${rname(q.role)}`);
    if (p.align !== q.align) out.push(`${p.name}: ${q.align === 'good' ? 'теперь на стороне добра' : 'теперь на стороне зла'}`);
    if ((p.gained || null) !== (q.gained || null)) out.push(`${p.name}: способность ${q.gained ? rname(q.gained) : 'своя'}`);
    if (p.ghost !== q.ghost && !q.alive && !p.alive) out.push(`${p.name}: голос призрака ${q.ghost ? 'есть' : 'потрачен'}`);
    const [gone, came] = msDiff(p.tokens, q.tokens, jstr);
    for (const t of gone) out.push(`${p.name}: снято «${tk(t)}»`);
    for (const t of came) out.push(`${p.name}: «${tk(t)}»`);
  }
  for (const q of T.players) if (!P(S, q.id)) out.push(`${q.name}: за столом`);
  const PH = { night: 'ночь', day: 'день', over: 'игра окончена' };
  if (S.phase !== T.phase) out.push(`Сейчас: ${PH[T.phase] || T.phase} (было: ${PH[S.phase] || S.phase})`);
  else if (S.phase === 'night') { const a = currentStep(S), b = currentStep(T); if (a && b && a.key !== b.key) out.push(`Текущий шаг ночи: ${stepTitle(T, b)} (был: ${stepTitle(S, a)})`); }
  // журнал: какие записи уйдут и какие появятся
  const [logGone, logNew] = msDiff(S.log.slice(S.rp.logLen), T.log.slice(S.rp.logLen), e => e.t);
  return { list: out, logGone: logGone.map(e => e.t), logNew: logNew.map(e => e.t) };
}
// что есть только в a и только в b (повторы считаются)
function msDiff(a, b, key) {
  const kb = b.map(key), onlyA = [];
  for (const x of a) { const j = kb.indexOf(key(x)); if (j >= 0) kb[j] = null; else onlyA.push(x); }
  const ka = a.map(key), onlyB = [];
  for (const x of b) { const j = ka.indexOf(key(x)); if (j >= 0) ka[j] = null; else onlyB.push(x); }
  return [onlyA, onlyB];
}
// принять правку: новое состояние + запись в журнале (тоже часть записи — переживёт следующую правку)
function acceptEdit(T, text) {
  const l0 = T.log.length;
  log(T, text, 'effect');
  if (T.rp) T.rp.recs.push({ t: 'patch', d: null, log: JSON.parse(jstr(T.log.slice(l0))) });
  return T;
}
// запись шага для формы правки: состояние перед ним, сам шаг и что было выбрано
function editTarget(S, k) {
  if (!S.rp || !S.rp.recs[k] || S.rp.recs[k].t === 'patch') return null;
  const res = replayNight(S, null, k), st = res.T.phase === 'night' ? currentStep(res.T) : null;
  if (!st || st.key !== S.rp.recs[k].key) return null;
  return { pre: res.T, st, rec: S.rp.recs[k] };
}

/* --- предупреждения о текущей ситуации */
function situation(S) {
  const out = [];
  if (S.phase === 'setup' || S.result) return out;
  const alive = aliveCount(S);
  const demon = S.players.find(demonAlive);
  if (demon && abilityOff(S, demon)) out.push(`Демон (${demon.name}) ${abilityOff(S, demon)}`);
  if (alive <= 4) out.push(`Живых: ${alive}. При двух живых побеждает зло.`);
  if (alive === 3 && S.players.some(p => actsAs(p) === 'mayor' && p.alive && !abilityOff(S, p))) out.push('Трое живых и Мэр жив: день без казни — победа добра.');
  if (twinsBlockGood(S)) out.push('Оба близнеца живы: добро не может победить.');
  if (S.flags.mastermindDay === S.n) out.push('Дополнительный день Кукловода: казнь доброго — победа зла, злого или никого — победа добра.');
  if (S.flags.moonchildPending) out.push(`Дитя Луны (${nm(S, S.flags.moonchildPending)}) должно публично выбрать игрока.`);
  if (S.flags.klutzPending) out.push(`Растяпа (${nm(S, S.flags.klutzPending)}) должен публично выбрать игрока.`);
  if (vortoxActive(S)) out.push('Вортокс: день без казни — победа зла.');
  // Травница: оба живых соседа добрые — не могут умереть, даже при казни
  const tl = S.players.filter(p => p.alive && teaLadyProtects(S, p));
  if (tl.length) out.push(`Травница защищает: ${tl.map(p => p.name).join(' и ')} — не могут умереть никак (казнь, Ведьма, изгнание), кроме Ассасина.`);
  if (S.phase === 'day' && S.day) { const b = block(S) && P(S, block(S)); if (b && teaLadyProtects(S, b)) out.push(`На плахе ${b.name}, но его защищает Травница: казнь его не убьёт.`); }
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


const ENGINE = { canBluff, droisoned, nightDeaths, revive, psychopathKill, exeQuestions, roleWorks, makeMarionette, makeDrunk, setupRole, storytellerRole, gossipPending, setGossip, pithagAdvice, puzzleHit, puzzleGuess, politicianStats, politiciansPending, politicianSide, voteNeeds, ghostSpent, demonSeatNeighbours, generalGuess, choiceCount, newGame, newPlayer, P, nm, rname, realTeam, actsAs, aliveCount, aliveAll, coreCount, isTraveller, exile, exileThreshold, addTraveller, meetingBlocker, isDemon, distribution, setupDistribution, distCheck, unknownSetup, countTeams, randomDeal,
  amnesiacGuess, AMNESIAC_ANSWERS, storytellerKill, voteCount, voteWeight, voudonActive, bishopActive, travellerWorks, executeNow,
  judgeRuling, gunslingerShot, tinkerDies, doomsayerKill, fiddlerEnd, swapSeats, goonWarn, damselGuess, changeRole, madnessExecute, harpyKill,
  finishRoles, autoSetup, setupProblems, drawStart, drawOpen, drawClose, drawCancel, drawShown, drawLocked, drawProblem, distortion,
  randomPool, dealPool, validPool, scriptOutsiders, CARD, jinxesInPlay, startGame, startNight, currentStep, stepSpec, applyStep, skipStep,
  stepInputs, missingInputs, endNight, rpStrip, recPatch, replayNight, editNight, editTarget, acceptEdit,
  nominate, nominationPreview, recordVote, block, execute, endDay, slayerShot, voteThreshold, situation, moonchildChoose, klutzChoose,
  abilityOff, attemptKill, die, addTok, rmTok, hasTok, TOK_RU, TEAM_RU, log, checkWin, endGame, aliveNeighbours,
  townsfolkNeighbours, teaLadyProtects, phaseTag, isGoodTeam, shuffle, uid };
