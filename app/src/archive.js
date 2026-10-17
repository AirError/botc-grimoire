'use strict';
/* Прошлые игры — вкладка «Журнал» (просьба пользователя 2026-10-18). Начатая игра сама попадает в архив, когда кончается, и ещё раз —
   когда рассказчик начинает новую или загружает другую (запись по id игры обновляется, а не дублируется). Хранится отдельно от игры,
   как заметки: IndexedDB, без него — localStorage. Новая игра и отмена архив не трогают. В записи — итог, игроки (роль в начале
   и в конце, сторона, жив ли), блефы, Сказочники и весь журнал партии. */
let GAMES = [];                       // записи, новые — первыми
const GAMES_DB = 'botc-grimoire-games', GAMES_LS = 'botc-grimoire-games-v1', GAMES_MAX = 200;
let gamesIdb = null, gamesTimer = null;

function gamesOpen() {
  return new Promise(res => {
    try {
      const rq = indexedDB.open(GAMES_DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('games', { keyPath: 'id' });
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
const gamesTx = (mode, fn) => new Promise((res, rej) => {
  const tx = gamesIdb.transaction('games', mode), st = tx.objectStore('games'), out = fn(st);
  tx.oncomplete = () => res(out && out.result); tx.onerror = () => rej(tx.error);
});
// без IndexedDB — localStorage: места мало (около 5 МБ на всё), не влезает — храним меньше игр
function gamesSaveLs() {
  for (const k of [GAMES_MAX, 40, 15, 5]) { try { localStorage.setItem(GAMES_LS, JSON.stringify(GAMES.slice(0, k))); return true; } catch (e) { /* меньше */ } }
  return false;
}
async function gamesLoad() {
  gamesIdb = await gamesOpen();
  try {
    if (gamesIdb) GAMES = (await gamesTx('readonly', st => st.getAll())) || [];
    else GAMES = JSON.parse(localStorage.getItem(GAMES_LS) || '[]');
  } catch (e) { GAMES = []; }
  GAMES.sort((a, b) => b.saved - a.saved);
  if (typeof render === 'function' && typeof S !== 'undefined' && S && typeof UI !== 'undefined' && UI.tab === 'log') render();
}
// запись о партии (копия — дальше игра меняется без неё)
function gameRecord(s) {
  const st = (s.flags && s.flags.startRoles) || {};
  return JSON.parse(JSON.stringify({
    id: s.id, created: s.created, saved: Date.now(), script: s.script ? s.script.name : '', n: s.n || 0, phase: s.phase, result: s.result || null,
    players: s.players.map((p, i) => ({ seat: i + 1, name: p.name, role: p.role, believes: p.believes || null, align: p.align, alive: p.alive,
      tr: !!(p.role && DATA.roles[p.role] && DATA.roles[p.role].team === 'traveller'),
      start: st[p.id] ? st[p.id].role : null, startBelieves: st[p.id] ? st[p.id].believes : null, startAlign: st[p.id] ? st[p.id].align : null })),
    bluffs: (s.bluffs || []).filter(Boolean), fabled: s.fabled || [], log: s.log || [],
  }));
}
// в архив — только начатые игры (подготовку без ночей не храним)
const gameStarted = s => !!(s && s.id && s.phase && s.phase !== 'setup' && s.players && s.players.length);
async function gameArchive(s) {
  if (!gameStarted(s)) return false;
  const rec = gameRecord(s);
  GAMES = [rec].concat(GAMES.filter(g => g.id !== rec.id)).slice(0, GAMES_MAX);
  if (gamesIdb) { try { await gamesTx('readwrite', st => st.put(rec)); return true; } catch (e) { return gamesSaveLs(); } }
  return gamesSaveLs();
}
// игра окончена — сохраняем сразу (и после правок конца игры, например решения о Политике), не чаще раза в 1,5 с
function gameArchiveSoon(s) { clearTimeout(gamesTimer); gamesTimer = setTimeout(() => gameArchive(s), 1500); }
async function gameDelete(id) {
  GAMES = GAMES.filter(g => g.id !== id);
  if (gamesIdb) { try { await gamesTx('readwrite', st => st.delete(id)); } catch (e) { /* уже удалена */ } } else gamesSaveLs();
}
gamesLoad();
