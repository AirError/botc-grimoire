"""Патч движка: Странники, Сказочники, изгнание, свойство prevents_evil_meeting, черновик номинации в состоянии."""
from pathlib import Path

p = Path(__file__).resolve().parent.parent / "app" / "src" / "engine.js"
t = p.read_text(encoding="utf-8")

R = [
    # состояние: зона Сказочников
    ("    players: [], bluffs: [], phase: 'setup', n: 0,",
     "    players: [], fabled: [], bluffs: [], phase: 'setup', n: 0,"),
    # счёт живых: Странники не учитываются в условиях победы и порогах ролей
    ("const aliveList = S => S.players.filter(p => p.alive);\nconst aliveCount = S => aliveList(S).length;",
     "const isTraveller = p => realTeam(p) === 'traveller';\n"
     "const aliveList = S => S.players.filter(p => p.alive);\n"
     "// живые без Странников — для условий победы и порогов ролей («Странники не считаются»)\n"
     "const aliveCount = S => S.players.filter(p => p.alive && !isTraveller(p)).length;\n"
     "// все живые, включая Странников — для порога казни (Странники голосуют)\n"
     "const aliveAll = S => aliveList(S).length;\n"
     "const coreCount = S => S.players.filter(p => !isTraveller(p)).length;"),
    # смерть: изгнание
    ("  const how = { demon: 'убит Демоном', minion: 'убит Приспешником', ability: 'умер от способности',",
     "  const how = { exile: 'изгнан', demon: 'убит Демоном', minion: 'убит Приспешником', ability: 'умер от способности',"),
    # смерть носителя свойства «злые не знакомятся» → знакомство этой же ночью (если был трезв)
    ("  if (p.role === 'sweetheart') S.flags.sweetheartPending = p.id;",
     "  if (p.role === 'sweetheart') S.flags.sweetheartPending = p.id;\n"
     "  if (preventsMeeting(p) && !abilityOff(S, p)) evilMeetsTonight(S);"),
    # раскладка и проверки — только по основным игрокам
    ("function countTeams(S) {\n  const c = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };\n  for (const p of S.players) if (p.role) c[realTeam(p)]++;",
     "function countTeams(S) {\n  const c = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };\n  for (const p of S.players) if (p.role && c[realTeam(p)] !== undefined) c[realTeam(p)]++;"),
    ("  const n = S.players.length, roles = S.script.roles;",
     "  const core = S.players.filter(p => !isTraveller(p)), n = core.length, roles = S.script.roles;"),
    ("  const seats = shuffle(S.players);", "  const seats = shuffle(core);"),
    ("    p.align = p.role && !isGoodTeam(realTeam(p)) ? 'evil' : 'good';",
     "    if (isTraveller(p)) continue; // сторону Странника назначает рассказчик\n"
     "    p.align = p.role && !isGoodTeam(realTeam(p)) ? 'evil' : 'good';"),
    ("  if (S.players.length < 5) out.push('Нужно хотя бы 5 игроков');",
     "  const core = S.players.filter(p => !isTraveller(p));\n"
     "  if (core.length < 5) out.push('Нужно хотя бы 5 игроков (не считая Странников)');"),
    ("  if (S.players.length >= 5 && S.players.every(p => p.role)) {\n    const d = distribution(S.players.length, S.players.map(p => p.role)), c = countTeams(S);",
     "  if (core.length >= 5 && S.players.every(p => p.role)) {\n    const d = distribution(core.length, core.map(p => p.role)), c = countTeams(S);"),
    # ночь: знакомство злых, Сказочники
    ("      if ((id === 'minioninfo' || id === 'demoninfo') && S.players.length < 7) continue;\n      steps.push({ key: id, id, pid: null });\n      continue;\n    }",
     "      if ((id === 'minioninfo' || id === 'demoninfo') && coreCount(S) < 7) continue;\n      steps.push({ key: id, id, pid: null });\n"
     "      if (id === 'dusk' && !first && S.flags.evilWakes) {\n"
     "        steps.push({ key: 'minioninfo:meet', id: 'minioninfo', pid: null, meet: true }, { key: 'demoninfo:meet', id: 'demoninfo', pid: null, meet: true });\n"
     "        S.flags.evilWakes = false;\n      }\n      continue;\n    }\n"
     "    if (R(id) && R(id).team === 'fabled') { if ((S.fabled || []).includes(id)) steps.push({ key: 'fab:' + id, id, pid: null, fabled: true }); continue; }"),
    # день: черновик номинации внутри состояния; изгнания
    ("  S.day = { n: S.n, noms: [], executed: null, executionDeath: null, deaths: [], outsiderDied: false, demonVoted: false, minionNominated: false, nominated: [], nominators: [] };",
     "  S.day = { n: S.n, noms: [], executed: null, executionDeath: null, deaths: [], outsiderDied: false, demonVoted: false, minionNominated: false, nominated: [], nominators: [],\n"
     "    exiled: [], draft: { by: null, on: null, voters: [], stage: 'pick', spy: false } };"),
    ("const voteThreshold = S => Math.ceil(aliveCount(S) / 2);",
     "const voteThreshold = S => Math.ceil(aliveAll(S) / 2);"),
    # шаги: Сказочники, общая подсказка по способности
    ("  if (DATA.special[step.id]) return specialSpec(S, step, first);\n  const p = P(S, step.pid), role = R(step.id);",
     "  if (DATA.special[step.id]) return specialSpec(S, step, first);\n  if (step.fabled) return fabledSpec(S, step, first);\n  const p = P(S, step.pid), role = R(step.id);"),
    ("  spec.bounds = boundsFor(step.id, first).slice();\n  if (off) spec.bounds.push(",
     "  spec.bounds = boundsFor(step.id, first).slice();\n"
     "  if (!spec.bounds.length) spec.bounds.push({ w: 'Способность', t: role.ability });\n  if (off) spec.bounds.push("),
    # знакомство злых по свойству
    ("  if (step.id === 'minioninfo') spec.info = () => ({ show: `Демон: ${demon ? demon.name : '—'}`, lines: [`Приспешники: ${minions.map(m => m.name).join(', ') || '—'}`] });",
     "  if (step.id === 'minioninfo') spec.info = () => ({ show: `Демон: ${demon ? demon.name : '—'}`, lines: [`Приспешники: ${minions.map(m => m.name).join(', ') || '—'}`] });\n"
     "  const blocker = meetingBlocker(S);\n"
     "  if (step.meet) {\n"
     "    spec.title = step.id === 'minioninfo' ? 'Злые знакомятся: Приспешники' : 'Злые знакомятся: Демон';\n"
     "    spec.text = step.id === 'minioninfo' ? 'Разбудите Приспешников, пусть посмотрят друг на друга. Покажите жетон *ЭТО ДЕМОН* и укажите на Демона.'\n"
     "      : 'Разбудите Демона. Покажите жетон *ЭТО ВАШИ ПРИСПЕШНИКИ* и укажите на Приспешников.';\n"
     "    spec.bounds = [Y('Носитель свойства «злые не знакомятся» умер трезвым — злые узнают друг друга этой ночью')];\n"
     "    if (step.id === 'demoninfo') spec.info = () => ({ show: `Приспешники: ${minions.map(m => m.name).join(', ') || '—'}`, lines: [] });\n"
     "    return spec;\n  }\n"
     "  if (first && blocker && step.id === 'minioninfo') { spec.active = false; spec.reason = `в игре ${rname(blocker.role)} — Приспешники и Демон не знакомятся`; }\n"
     "  if (first && blocker && step.id === 'demoninfo') {\n"
     "    spec.text = 'Разбудите Демона. Покажите жетон *ЭТИХ РОЛЕЙ В ИГРЕ НЕТ* и 3 жетона добрых ролей, которых нет в игре. Приспешников не показывайте.';\n"
     "    spec.bounds = [Y(`В игре ${rname(blocker.role)}: Демон получает только блефы, без знакомства с Приспешниками`)];\n"
     "    spec.info = () => ({ show: `Блефы: ${S.bluffs.map(rname).join(', ')}`, lines: [] });\n"
     "    return spec;\n  }"),
    # экспорт
    ("const ENGINE = { newGame, newPlayer, P, nm, rname, realTeam, actsAs, aliveCount, isDemon,",
     "const ENGINE = { newGame, newPlayer, P, nm, rname, realTeam, actsAs, aliveCount, aliveAll, coreCount, isTraveller, exile, addTraveller, meetingBlocker, isDemon,"),
]
for a, b in R:
    assert t.count(a) == 1, "не найдено или не уникально: " + a[:80]
    t = t.replace(a, b)

# новые функции — перед блоком «шаги ночи»
ADD = r"""
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

// изгнание Странника: не казнь, за день может быть сколько угодно
function exile(S, pid, votes, passed) {
  const p = P(S, pid);
  log(S, `Изгнание Странника ${p.name}: ${votes} голос.`, 'day');
  if (!passed) { log(S, `${p.name} не изгнан`, 'day'); return; }
  S.day.exiled = (S.day.exiled || []).concat(pid);
  die(S, p, 'exile', null);
}

function fabledSpec(S, step, first) {
  const role = R(step.id);
  return { title: role.name, who: 'Сказочник', team: 'fabled', text: (first ? role.first : role.other) || '', active: true, reason: '',
    inputs: [PL('t', 2, 'Выбор (если нужен)', () => true, { min: 0 })], defaults: {}, warn: [], info: () => null,
    apply: inp => log(S, `${role.name}${inp.t && inp.t.length ? ': ' + inp.t.map(id => nm(S, id)).join(', ') : ''}`, 'action'),
    bounds: [{ w: 'Способность', t: role.ability }] };
}

/* ------------------------------------------------------------ шаги ночи */
"""
anchor = "/* ------------------------------------------------------------ шаги ночи */\n"
assert t.count(anchor) == 1
t = t.replace(anchor, ADD.lstrip("\n"), 1)
p.write_text(t, encoding="utf-8", newline="\n")
print("ok")
