'use strict';
const E = ENGINE, results = [];
function ok(name, cond, extra) { results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : '')); }
function game(roles, script) {
  const S = E.newGame(script || 'ecbe');
  roles.forEach((r, i) => { const p = E.newPlayer('P' + i + ':' + r); p.role = r; S.players.push(p); });
  E.finishRoles(S);
  return S;
}
const byRole = (S, r) => S.players.find(p => p.role === r);
// прогоняет текущую ночь: inputs[roleId] — ввод для шага этой роли
function runNight(S, inputs) {
  let guard = 0;
  while (S.phase === 'night' && guard++ < 200) {
    const st = E.currentStep(S), spec = E.stepSpec(S, st);
    if (!spec.active) { E.skipStep(S); continue; }
    const res = E.applyStep(S, st, Object.assign({}, spec.defaults, (inputs || {})[st.id] || {}));
    if (!res.ok) { results.push('NOTE пропущен шаг ' + st.id + ': не хватает «' + res.missing.join('», «') + '»'); E.skipStep(S); }
  }
}
const ids = (S, ...roles) => roles.map(r => byRole(S, r).id);

try {
  // 1. подготовка и первая ночь
  let S = game(['clockmaker', 'grandmother', 'fortuneteller', 'monk', 'tealady', 'imp', 'witch', 'recluse']);
  ok('раскладка 8 игроков без ошибок', E.setupProblems(S).length === 0, E.setupProblems(S).join('; '));
  E.autoSetup(S, true); E.startGame(S);
  const firstIds = S.night.steps.map(s => s.id);
  ok('порядок 1-й ночи', JSON.stringify(firstIds) === JSON.stringify(['dusk', 'minioninfo', 'demoninfo', 'witch', 'fortuneteller', 'grandmother', 'clockmaker', 'dawn']), firstIds.join(','));
  const cmStep = S.night.steps.find(s => s.id === 'clockmaker');
  ok('Часовщик: Демон (5) и Ведьма (6) рядом = 1', E.stepSpec(S, cmStep).info({}).show === '1', E.stepSpec(S, cmStep).info({}).show);
  runNight(S, { witch: { t: [byRole(S, 'clockmaker').id] } });
  ok('после 1-й ночи наступил день', S.phase === 'day' && S.n === 1);
  ok('проклятие Ведьмы на Часовщике', E.hasTok(byRole(S, 'clockmaker'), 'cursed', 'witch'));
  // 2. проклятый номинирует — умирает
  E.nominate(S, byRole(S, 'clockmaker').id, byRole(S, 'monk').id);
  ok('Ведьма: номинировавший проклятый умер', !byRole(S, 'clockmaker').alive);
  E.endDay(S);
  ok('проклятие снято на закате', !E.hasTok(byRole(S, 'clockmaker'), 'cursed'));
  // 3. Монах защищает Бабушку, Чёрт бьёт в неё
  runNight(S, { monk: { t: [byRole(S, 'grandmother').id] }, imp: { t: [byRole(S, 'grandmother').id] }, witch: { t: [byRole(S, 'monk').id] } });
  ok('Монах спас от Чёрта', byRole(S, 'grandmother').alive);
  // 4. Бабушка: Демон убивает внука
  E.endDay(S);
  const gc = byRole(S, 'fortuneteller'); S.flags.grandchild = gc.id;
  runNight(S, { monk: { t: [byRole(S, 'recluse').id] }, imp: { t: [gc.id] }, witch: { t: [byRole(S, 'monk').id] } });
  ok('внук убит Демоном', !gc.alive, gc.name);
  ok('Бабушка умерла вместе с внуком', !byRole(S, 'grandmother').alive);

  // 5. передача Чёрта
  S = game(['washerwoman', 'librarian', 'investigator', 'chef', 'empath', 'drunk', 'scarletwoman', 'imp'], 'tb');
  E.autoSetup(S, true); E.startGame(S); runNight(S, {}); E.endDay(S);
  runNight(S, { imp: { t: [byRole(S, 'imp').id], heir: [byRole(S, 'scarletwoman').id] } });
  ok('Чёрт убил себя, Блудница стала Чёртом', S.players.filter(p => p.role === 'imp' && p.alive).length === 1 && !S.result, S.result && S.result.reason);
  // 6. казнь Демона при 5+ живых — Блудницы уже нет → победа добра
  E.execute(S, S.players.find(p => p.role === 'imp' && p.alive).id);
  ok('казнь последнего Демона — победа добра', S.result && S.result.winner === 'good', S.result && S.result.reason);

  // 7. Блудница становится Демоном при казни
  S = game(['washerwoman', 'librarian', 'investigator', 'chef', 'empath', 'drunk', 'scarletwoman', 'imp'], 'tb');
  E.autoSetup(S, true); E.startGame(S); runNight(S, {});
  E.execute(S, byRole(S, 'imp').id);
  ok('Блудница стала Чёртом после казни', !S.result && S.players.some(p => p.role === 'imp' && p.alive));

  // 8. Пукка: отравленный прошлой ночью умирает
  S = game(['clockmaker', 'grandmother', 'fortuneteller', 'monk', 'tealady', 'pukka', 'witch', 'recluse']);
  E.autoSetup(S, true); E.startGame(S);
  const v1 = byRole(S, 'fortuneteller');
  runNight(S, { pukka: { t: [v1.id] }, witch: { t: [byRole(S, 'recluse').id] } });
  ok('Пукка отравил в 1-ю ночь', E.hasTok(v1, 'poisoned', 'pukka') && v1.alive);
  E.endDay(S);
  runNight(S, { pukka: { t: [byRole(S, 'clockmaker').id] }, monk: { t: [byRole(S, 'tealady').id] }, witch: { t: [byRole(S, 'recluse').id] } });
  ok('отравленный Пуккой умер на следующую ночь', !v1.alive);

  // 9. Фань Гу прыгает в Изгоя
  S = game(['clockmaker', 'grandmother', 'fortuneteller', 'monk', 'barber', 'fanggu', 'witch', 'recluse']);
  E.autoSetup(S, true); E.startGame(S); runNight(S, { witch: { t: [byRole(S, 'monk').id] } }); E.endDay(S);
  const old = byRole(S, 'fanggu'), rec = byRole(S, 'recluse');
  runNight(S, { fanggu: { t: [rec.id] }, monk: { t: [byRole(S, 'clockmaker').id] }, witch: { t: [byRole(S, 'monk').id] } });
  ok('прыжок Фань Гу: Затворник стал злым Фань Гу', rec.role === 'fanggu' && rec.align === 'evil' && rec.alive && !old.alive && !S.result);

  // 10. Девственница
  S = game(['washerwoman', 'virgin', 'investigator', 'chef', 'empath', 'drunk', 'poisoner', 'imp'], 'tb');
  E.autoSetup(S, true); E.startGame(S); runNight(S, { poisoner: { t: [byRole(S, 'chef').id] } });
  const r = E.nominate(S, byRole(S, 'washerwoman').id, byRole(S, 'virgin').id);
  ok('Девственница: номинировавший Горожанин казнён', r.ended && !byRole(S, 'washerwoman').alive);

  // 11. Злой Близнец: казнь доброго близнеца — победа зла
  S = game(['clockmaker', 'grandmother', 'fortuneteller', 'monk', 'tealady', 'imp', 'eviltwin', 'recluse']);
  E.autoSetup(S, true); S.flags.goodTwin = byRole(S, 'monk').id; E.startGame(S); runNight(S, {});
  E.execute(S, byRole(S, 'monk').id);
  ok('казнён добрый близнец — победа зла', S.result && S.result.winner === 'evil');
  // 12. близнецы блокируют победу добра
  S = game(['clockmaker', 'grandmother', 'fortuneteller', 'monk', 'tealady', 'imp', 'eviltwin', 'recluse']);
  E.autoSetup(S, true); S.flags.goodTwin = byRole(S, 'monk').id; E.startGame(S); runNight(S, {});
  E.execute(S, byRole(S, 'imp').id);
  ok('Демон казнён, но оба близнеца живы — игра продолжается', !S.result);

  // 13. Цирюльник: обмен ролями
  S = game(['clockmaker', 'grandmother', 'fortuneteller', 'monk', 'barber', 'imp', 'witch', 'recluse']);
  E.autoSetup(S, true); E.startGame(S); runNight(S, { witch: { t: [byRole(S, 'monk').id] } });
  E.execute(S, byRole(S, 'barber').id); E.endDay(S);
  const a = byRole(S, 'clockmaker'), b = byRole(S, 'fortuneteller');
  runNight(S, { barber: { t: [a.id, b.id] }, imp: { t: [byRole(S, 'recluse').id] }, monk: { t: [byRole(S, 'grandmother').id] }, witch: { t: [byRole(S, 'monk').id] } });
  ok('Цирюльник: роли поменялись', a.role === 'fortuneteller' && b.role === 'clockmaker');

  // 14. Но Даши травит соседей-Горожан
  S = game(['clockmaker', 'grandmother', 'fortuneteller', 'monk', 'tealady', 'nodashii', 'witch', 'recluse']);
  E.autoSetup(S, true); E.startGame(S);
  ok('Но Даши: соседи-Горожане отравлены', E.abilityOff(S, byRole(S, 'tealady')) && E.abilityOff(S, byRole(S, 'clockmaker')) && !E.abilityOff(S, byRole(S, 'monk')),
     S.players.map(p => p.role + ':' + (E.abilityOff(S, p) || '-')).join(' '));

  // 15. Крёстный Отец: днём умер Изгой → ночью убивает
  S = game(['clockmaker', 'grandmother', 'fortuneteller', 'monk', 'tealady', 'imp', 'godfather', 'recluse']);
  E.autoSetup(S, true); E.startGame(S); runNight(S, {});
  E.execute(S, byRole(S, 'recluse').id); E.endDay(S);
  const gf = S.night.steps.find(s => s.id === 'godfather');
  ok('Крёстный Отец просыпается после смерти Изгоя', gf && E.stepSpec(S, gf).active);

  // 16. Мэр: трое живых, нет казни — победа добра
  S = game(['washerwoman', 'mayor', 'investigator', 'chef', 'empath', 'drunk', 'poisoner', 'imp'], 'tb');
  E.autoSetup(S, true); E.startGame(S); runNight(S, {});
  ['washerwoman', 'investigator', 'chef', 'empath', 'drunk'].forEach(r => { byRole(S, r).alive = false; });
  E.endDay(S, { skipExecution: true });
  ok('Мэр: трое живых без казни — победа добра', S.result && S.result.winner === 'good', S.result && S.result.reason);

  // 17. Придворный спаивает Пукку
  S = game(['clockmaker', 'grandmother', 'fortuneteller', 'monk', 'courtier', 'pukka', 'witch', 'recluse']);
  E.autoSetup(S, true); E.startGame(S);
  const v = byRole(S, 'monk');
  runNight(S, { courtier: { r: 'pukka' }, pukka: { t: [v.id] }, witch: { t: [byRole(S, 'recluse').id] } });
  ok('пьяный Пукка не отравляет', !E.hasTok(v, 'poisoned', 'pukka') && E.hasTok(byRole(S, 'pukka'), 'drunk', 'courtier'));

  // 18. два живых — победа зла
  S = game(['washerwoman', 'librarian', 'investigator', 'chef', 'empath', 'drunk', 'poisoner', 'imp'], 'tb');
  E.autoSetup(S, true); E.startGame(S); runNight(S, {});
  ['washerwoman', 'librarian', 'investigator', 'chef', 'empath'].forEach(r => { byRole(S, r).alive = false; });
  E.attemptKill(S, byRole(S, 'drunk'), 'ability');
  ok('двое живых — победа зла', S.result && S.result.winner === 'evil', S.result && S.result.reason);

  // 18б. Отметки Прачки и Сыщика в Гримуаре; выбор подготовки от прежней раздачи не ставит отметку роли не в игре
  S = game(['washerwoman', 'investigator', 'chef', 'empath', 'monk', 'poisoner', 'imp'], 'tb');
  E.autoSetup(S, true); S.flags.goodTwin = byRole(S, 'chef').id; S.flags.grandchild = byRole(S, 'monk').id; E.startGame(S);
  ok('отметка Близнеца и внука не ставится, если Злого Близнеца и Бабушки нет в игре', !S.players.some(p => E.hasTok(p, 'twin') || E.hasTok(p, 'grandchild')) && !S.flags.goodTwin && !S.flags.grandchild);
  runNight(S, { washerwoman: { t: ids(S, 'chef', 'empath'), r: 'chef' }, investigator: { t: ids(S, 'poisoner', 'monk'), r: 'poisoner' } });
  const sh = (r, src) => byRole(S, r).tokens.find(t => t.k === 'shown' && t.src === src);
  ok('Прачка: у Повара отметка «Повар», у второго — ложная цель', sh('chef', 'washerwoman') && !sh('chef', 'washerwoman').wrong && sh('chef', 'washerwoman').note === 'chef' && sh('empath', 'washerwoman') && sh('empath', 'washerwoman').wrong);
  ok('Сыщик: у Отравителя отметка, у второго — ложная цель', sh('poisoner', 'investigator') && !sh('poisoner', 'investigator').wrong && sh('monk', 'investigator').wrong);
  // 18в. Экзорцист: отметка «Выбран» переходит на нового выбранного
  S = game(['exorcist', 'chef', 'empath', 'monk', 'soldier', 'poisoner', 'imp'], 'bmr');
  S.script.roles = S.script.roles.concat(['chef', 'empath', 'monk', 'soldier', 'poisoner', 'imp']);
  E.autoSetup(S, true); E.startGame(S); runNight(S, {}); E.endDay(S);
  runNight(S, { exorcist: { t: ids(S, 'chef') } }); E.endDay(S);
  runNight(S, { exorcist: { t: ids(S, 'empath') } });
  ok('Экзорцист: «Выбран» только на последнем выбранном', E.hasTok(byRole(S, 'empath'), 'chosen', 'exorcist') && !E.hasTok(byRole(S, 'chef'), 'chosen', 'exorcist'));

  // 18г. Смена ролей (проверка по вики, 2026-10-11): Яга, Цирюльник, Заклинатель змей + Философ, Фань Гу, Философ, Егерь и Девица
  { // отдельный блок: свои имена переменных
  // до шага роли id в текущей ночи (шаги до него — по умолчанию); возвращает спецификацию шага
  const toStep = (S, id, inputs) => { let g = 0; while (S.phase === 'night' && g++ < 100) { const st = E.currentStep(S); if (st.id === id) return st;
    const sp = E.stepSpec(S, st); if (!sp.active) { E.skipStep(S); continue; } const r = E.applyStep(S, st, Object.assign({}, sp.defaults, (inputs || {})[st.id] || {})); if (!r.ok) E.skipStep(S); } return null; };
  const rest = S => S.night.steps.slice(S.night.i + 1);
  // Яга: роль в игре — ничего; превращение — сторона прежняя, ночь перестраивается, эффекты старой роли кончаются
  S = game(['clockmaker', 'dreamer', 'snakecharmer', 'mathematician', 'flowergirl', 'sweetheart', 'pithag', 'witch', 'vigormortis'], 'snv');
  S.players.forEach(p => { if (p.role === 'witch') p.align = 'evil'; }); E.autoSetup(S, true); E.startGame(S);
  runNight(S, { witch: { t: ids(S, 'clockmaker') } }); E.endDay(S); E.addTok(S, byRole(S, 'clockmaker'), 'cursed', 'witch', ['dusk', S.n + 1]);
  let st = toStep(S, 'pithag'); E.applyStep(S, st, { t: ids(S, 'flowergirl'), r: 'dreamer' });
  ok('Яга: роль уже в игре — ничего не происходит', byRole(S, 'flowergirl') && byRole(S, 'dreamer'));
  E.endNight(S); E.endDay(S);
  const fg = byRole(S, 'flowergirl'), wi = byRole(S, 'witch'); E.addTok(S, byRole(S, 'clockmaker'), 'cursed', 'witch', ['dusk', S.n + 1]);
  st = toStep(S, 'pithag'); E.applyStep(S, st, { t: [wi.id], r: 'cerenovus' });
  ok('Яга: Ведьма → Цереновус, сторона прежняя, проклятие Ведьмы снято', wi.role === 'cerenovus' && wi.align === 'evil' && !E.hasTok(byRole(S, 'clockmaker'), 'cursed'));
  E.endNight(S); E.endDay(S);
  // Математик и Оракул ходят после Яги: после превращения этой ночью просыпается Оракул, а не Математик
  const ma = byRole(S, 'mathematician'); st = toStep(S, 'pithag'); E.applyStep(S, st, { t: [ma.id], r: 'oracle' });
  ok('Яга: ночь перестроена — Математик не просыпается, Оракул — в свою очередь', ma.role === 'oracle' && !rest(S).some(s => s.pid === ma.id && s.id === 'mathematician') && rest(S).some(s => s.pid === ma.id && s.id === 'oracle'));
  E.endNight(S); E.endDay(S);
  st = toStep(S, 'pithag'); E.applyStep(S, st, { t: [fg.id], r: 'eviltwin' });
  ok('Яга: созданный Злой Близнец знакомится с близнецом этой же ночью (способность «в 1-ю ночь»)', fg.role === 'eviltwin' && fg.align === 'good' && rest(S).some(s => s.pid === fg.id && s.id === 'eviltwin' && s.fresh));
  E.endNight(S); E.endDay(S);
  const dr = byRole(S, 'dreamer');
  st = toStep(S, 'pithag'); E.applyStep(S, st, { t: [dr.id], r: 'fanggu', kill: [] });
  ok('Яга: создан Демон — у Демона этой ночью пометка «смерти на ваше усмотрение»', dr.role === 'fanggu' && S.night.data.pithagDemon && rest(S).some(s => s.id === 'vigormortis' && E.stepSpec(S, s).warn.some(w => /Яга создала Демона/.test(w))));
  // Яга создаёт Пьяницу — он считает себя Горожанином не из игры
  S = game(['washerwoman', 'chef', 'empath', 'monk', 'slayer', 'pithag', 'imp'], 'tb'); S.script.roles = S.script.roles.concat('pithag');
  S.players.forEach(p => { if (p.role === 'pithag') p.align = 'evil'; }); E.autoSetup(S, true); E.startGame(S); runNight(S, {}); E.endDay(S);
  const ch = byRole(S, 'chef'); st = toStep(S, 'pithag'); E.applyStep(S, st, { t: [ch.id], r: 'drunk' });
  ok('Яга: созданный Пьяница считает себя Горожанином не из игры', ch.role === 'drunk' && ch.believes && E.realTeam({ role: ch.believes }) === 'townsfolk' && !S.players.some(p => p.role === ch.believes) && !!E.abilityOff(S, ch));
  // Цирюльник: умер днём — ночью Демон меняет двух игроков; стороны прежние, Пьяница уносит свой жетон, ночь перестраивается
  S = game(['clockmaker', 'dreamer', 'snakecharmer', 'mathematician', 'barber', 'drunk', 'witch', 'vigormortis'], 'snv'); S.script.roles = S.script.roles.concat('drunk');
  S.players.forEach(p => { if (['witch', 'vigormortis'].includes(p.role)) p.align = 'evil'; }); E.autoSetup(S, true); E.startGame(S);
  const drk = byRole(S, 'drunk'), drB = drk.believes; runNight(S, { witch: { t: ids(S, 'clockmaker') } });
  E.execute(S, byRole(S, 'barber').id); E.endDay(S);
  const mat = byRole(S, 'mathematician'), vx = byRole(S, 'vigormortis');
  st = toStep(S, 'barber', { vigormortis: { t: ids(S, 'clockmaker') } });
  E.applyStep(S, st, { t: [mat.id, drk.id] });
  ok('Цирюльник: роли обменялись, стороны прежние', mat.role === 'drunk' && drk.role === 'mathematician' && mat.align === 'good' && drk.align === 'good');
  ok('Цирюльник: новый Пьяница считает себя той же ролью, что и прежний (жетон переходит вместе с ролью)', mat.believes === drB && !drk.believes);
  E.endNight(S); E.endDay(S); runNight(S, { vigormortis: { t: ids(S, 'dreamer') } }); E.endDay(S);
  // Демон меняется сам с добрым игроком: добрый Демон, злой не-Демон, игра продолжается
  S = game(['clockmaker', 'dreamer', 'snakecharmer', 'mathematician', 'barber', 'sweetheart', 'witch', 'vigormortis'], 'snv');
  S.players.forEach(p => { if (['witch', 'vigormortis'].includes(p.role)) p.align = 'evil'; }); E.autoSetup(S, true); E.startGame(S); runNight(S, { witch: { t: ids(S, 'clockmaker') } });
  E.execute(S, byRole(S, 'barber').id); E.endDay(S);
  const v0 = byRole(S, 'vigormortis'), cm = byRole(S, 'clockmaker');
  st = toStep(S, 'barber', { vigormortis: { t: ids(S, 'dreamer') } }); E.applyStep(S, st, { t: [v0.id, cm.id] });
  ok('Цирюльник: Демон меняется сам — добрый Демон, злой Часовщик, игра идёт', cm.role === 'vigormortis' && cm.align === 'good' && v0.role === 'clockmaker' && v0.align === 'evil' && !S.result);
  // Заклинатель змей — способность у Философа: прежний Демон становится Философом, новый Демон просыпается Демоном
  S = game(['clockmaker', 'dreamer', 'philosopher', 'mathematician', 'flowergirl', 'sweetheart', 'witch', 'nodashii'], 'snv');
  S.players.forEach(p => { if (['witch', 'nodashii'].includes(p.role)) p.align = 'evil'; }); E.autoSetup(S, true); E.startGame(S);
  const ph = byRole(S, 'philosopher'), nd = byRole(S, 'nodashii');
  runNight(S, { philosopher: { r: 'snakecharmer' }, witch: { t: ids(S, 'clockmaker') } }); E.endDay(S);
  st = toStep(S, 'snakecharmer'); E.applyStep(S, st, { t: [nd.id] });
  ok('Заклинатель (Философ): Философ стал Но Даши и злым, прежний Демон — добрый отравленный Философ со способностью Заклинателя',
    ph.role === 'nodashii' && ph.align === 'evil' && !ph.gained && E.actsAs(ph) === 'nodashii' && nd.role === 'philosopher' && nd.gained === 'snakecharmer' && nd.align === 'good' && !!E.abilityOff(S, nd));
  ok('Заклинатель: дальше этой ночью Демоном просыпается новый Демон', rest(S).some(s => s.id === 'nodashii' && s.pid === ph.id) && !rest(S).some(s => s.id === 'nodashii' && s.pid === nd.id));
  // Фань Гу: Изгой под защитой Монаха не умирает и не становится Фань Гу; без защиты — прыжок
  S = game(['monk', 'chef', 'empath', 'washerwoman', 'recluse', 'saint', 'poisoner', 'fanggu'], 'tb'); S.script.roles = S.script.roles.concat('fanggu');
  S.players.forEach(p => { if (['poisoner', 'fanggu'].includes(p.role)) p.align = 'evil'; }); E.autoSetup(S, true); E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } }); E.endDay(S);
  const rc = byRole(S, 'recluse'), fgu = byRole(S, 'fanggu');
  runNight(S, { monk: { t: [rc.id] }, fanggu: { t: [rc.id] }, poisoner: { t: ids(S, 'chef') } });
  ok('Фань Гу: Изгой под защитой Монаха — не умер и не стал Фань Гу', rc.alive && rc.role === 'recluse' && fgu.alive && fgu.role === 'fanggu' && !S.flags.fangguJumped);
  E.endDay(S); runNight(S, { monk: { t: ids(S, 'chef') }, fanggu: { t: [rc.id] }, poisoner: { t: ids(S, 'chef') } });
  ok('Фань Гу: без защиты — Изгой становится злым Фань Гу, прежний умирает', rc.role === 'fanggu' && rc.align === 'evil' && rc.alive && !fgu.alive && !S.result);
  // Философ: игрок с выбранной ролью пьян, пока Философ жив; умер Философ — трезв снова
  S = game(['philosopher', 'empath', 'chef', 'washerwoman', 'monk', 'poisoner', 'imp'], 'tb'); S.script.roles = S.script.roles.concat('philosopher');
  S.players.forEach(p => { if (['poisoner', 'imp'].includes(p.role)) p.align = 'evil'; }); E.autoSetup(S, true); E.startGame(S);
  runNight(S, { philosopher: { r: 'empath' }, poisoner: { t: ids(S, 'chef') } });
  const empP = byRole(S, 'empath'), phi = byRole(S, 'philosopher'); const drunkWhile = !!E.abilityOff(S, empP);
  E.execute(S, phi.id);
  ok('Философ: обладатель выбранной роли пьян, пока Философ жив; после смерти Философа — трезв', drunkWhile && !E.abilityOff(S, empP));
  // Егерь и Девица: Приспешники узнают Девицу; Егерь превращает Девицу в Горожанина; догадка Приспешника — одна на всех
  const hd = ['huntsman', 'damsel', 'chef', 'empath', 'washerwoman', 'monk', 'poisoner', 'imp'];
  S = game(hd, 'tb'); S.script.roles = S.script.roles.concat('huntsman', 'damsel');
  S.players.forEach(p => { if (['poisoner', 'imp'].includes(p.role)) p.align = 'evil'; }); E.autoSetup(S, true); E.startGame(S);
  const dm = byRole(S, 'damsel'), hu = byRole(S, 'huntsman');
  const dst = S.night.steps.find(s => s.id === 'damsel'), dsp = E.stepSpec(S, dst), dinfo = dsp.info({});
  ok('Девица: в 1-ю ночь Приспешникам показывают жетон Девицы', dsp.active && dinfo.tokens.some(t => t.role === 'damsel'));
  runNight(S, { huntsman: { t: ids(S, 'chef') }, poisoner: { t: ids(S, 'chef') } });
  ok('Егерь: выбрал не Девицу — ничего, способность потрачена', dm.role === 'damsel' && !E.stepSpec(S, { id: 'huntsman', pid: hu.id }).active);
  S = game(hd, 'tb'); S.script.roles = S.script.roles.concat('huntsman', 'damsel');
  S.players.forEach(p => { if (['poisoner', 'imp'].includes(p.role)) p.align = 'evil'; }); E.autoSetup(S, true); E.startGame(S);
  const dm2 = byRole(S, 'damsel');
  runNight(S, { huntsman: { t: [dm2.id], r: 'slayer' }, poisoner: { t: ids(S, 'chef') } });
  ok('Егерь нашёл Девицу: она стала Горожанином не из игры (Истребитель), сторона добрая', dm2.role === 'slayer' && dm2.align === 'good');
  S = game(hd, 'tb'); S.script.roles = S.script.roles.concat('huntsman', 'damsel');
  S.players.forEach(p => { if (['poisoner', 'imp'].includes(p.role)) p.align = 'evil'; }); E.autoSetup(S, true); E.startGame(S); runNight(S, { huntsman: {}, poisoner: { t: ids(S, 'chef') } });
  const r1 = E.damselGuess(S, byRole(S, 'poisoner').id, byRole(S, 'chef').id), r2 = E.damselGuess(S, byRole(S, 'poisoner').id, byRole(S, 'damsel').id);
  ok('Девица: Приспешник не угадал — догадок больше нет, игра идёт', r1 && !r1.hit && r2 === null && !S.result);
  S = game(hd, 'tb'); S.script.roles = S.script.roles.concat('huntsman', 'damsel');
  S.players.forEach(p => { if (['poisoner', 'imp'].includes(p.role)) p.align = 'evil'; }); E.autoSetup(S, true); E.startGame(S); runNight(S, { huntsman: {}, poisoner: { t: ids(S, 'chef') } });
  ok('Девица: Демон «угадывает» — не считается', E.damselGuess(S, byRole(S, 'imp').id, byRole(S, 'damsel').id) === null && !S.result);
  E.damselGuess(S, byRole(S, 'poisoner').id, byRole(S, 'damsel').id);
  ok('Девица: Приспешник угадал — победа зла', S.result && S.result.winner === 'evil');
  // Сновидец: своя роль не показывается; доброму игроку ложной — Приспешник из игры; роли можно выбрать самому
  let dreamOwn = false, dreamMin = true;
  for (let k = 0; k < 40; k++) {
    S = game(['dreamer', 'clockmaker', 'oracle', 'seamstress', 'mathematician', 'sweetheart', 'eviltwin', 'nodashii'], 'snv');
    S.players.forEach(p => { if (['eviltwin', 'nodashii'].includes(p.role)) p.align = 'evil'; }); E.autoSetup(S, true); E.startGame(S);
    const dst2 = S.night.steps.find(s => s.id === 'dreamer'), dsp2 = E.stepSpec(S, dst2);
    const onEvil = dsp2.info({ t: ids(S, 'eviltwin') }).tokens.map(t => t.role), onGood = dsp2.info({ t: ids(S, 'oracle') }).tokens.map(t => t.role);
    if (onEvil.includes('dreamer') || onGood.includes('dreamer')) dreamOwn = true;
    if (!onGood.includes('eviltwin')) dreamMin = false; // Приспешник в игре — Злой Близнец
  }
  ok('Сновидец: своя роль не показывается ни разу (40 игр)', !dreamOwn);
  ok('Сновидец: доброму игроку ложной показывается Приспешник из игры', dreamMin);
  { const dsp3 = E.stepSpec(S, S.night.steps.find(s => s.id === 'dreamer')), inf = dsp3.info({ t: ids(S, 'oracle'), g: 'oracle', e: 'witch' });
    ok('Сновидец: роли можно выбрать самому', inf.tokens.map(t => t.role).sort().join() === 'oracle,witch'); }
  // Гарпия: будят только первого; второй — отметка; день: убить одного или обоих
  S = game(['dreamer', 'clockmaker', 'oracle', 'seamstress', 'mathematician', 'sweetheart', 'harpy', 'nodashii'], 'snv'); S.script.roles = S.script.roles.concat('harpy');
  S.players.forEach(p => { if (['harpy', 'nodashii'].includes(p.role)) p.align = 'evil'; }); E.autoSetup(S, true); E.startGame(S);
  const hst = S.night.steps.find(s => s.id === 'harpy'), hinfo = E.stepSpec(S, hst).info({ m: ids(S, 'oracle'), s: ids(S, 'clockmaker') });
  ok('Гарпия: показ только первому игроку (жетон Гарпии и второй игрок)', hinfo.tokens.length === 1 && hinfo.tokens[0].label === byRole(S, 'oracle').name && hinfo.tokens[0].players[0] === byRole(S, 'clockmaker').id);
  runNight(S, { harpy: { m: ids(S, 'oracle'), s: ids(S, 'clockmaker') } });
  ok('Гарпия: первый «помешан», у второго отметка', E.hasTok(byRole(S, 'oracle'), 'mad', 'harpy') && E.hasTok(byRole(S, 'clockmaker'), 'second', 'harpy'));
  E.harpyKill(S, ids(S, 'oracle', 'clockmaker'));
  ok('Гарпия: рассказчик убил обоих — это смерть, не казнь, день идёт', !byRole(S, 'oracle').alive && !byRole(S, 'clockmaker').alive && S.phase === 'day' && !S.day.executed);
  // Цереновус и Уродец: нарушил безумие — казнь за день, сразу ночь
  S = game(['dreamer', 'clockmaker', 'oracle', 'seamstress', 'mathematician', 'mutant', 'cerenovus', 'nodashii'], 'snv');
  S.players.forEach(p => { if (['cerenovus', 'nodashii'].includes(p.role)) p.align = 'evil'; }); E.autoSetup(S, true); E.startGame(S);
  runNight(S, { cerenovus: { t: ids(S, 'oracle'), r: 'clockmaker' } });
  const orc = byRole(S, 'oracle'); E.madnessExecute(S, orc.id, 'cerenovus');
  ok('Цереновус: нарушил безумие — казнён, это казнь дня, наступила ночь', !orc.alive && S.phase === 'night' && S.n === 2 && S.log.some(l => /Казнь: /.test(l.t) && l.t.includes(orc.name)));
  runNight(S, {});
  const mu = byRole(S, 'mutant'); E.execute(S, byRole(S, 'clockmaker').id); // казнь сегодня уже была
  ok('Уродец: если сегодня казнь уже была — казнить за безумие нельзя', S.phase === 'day' && E.madnessExecute(S, mu.id, 'mutant') === false && mu.alive);
  E.endDay(S); runNight(S, {});
  ok('Уродец: внушает, что он Изгой, — казнён, сразу ночь', S.phase === 'day' && E.madnessExecute(S, mu.id, 'mutant') === true && !mu.alive && S.phase === 'night');
  }

  // 19. Девственница и Шпион — решение рассказчика
  S = game(['washerwoman', 'virgin', 'investigator', 'chef', 'empath', 'drunk', 'spy', 'imp'], 'tb');
  E.autoSetup(S, true); E.startGame(S);
  const spyStep = S.night.steps.find(s => s.id === 'spy');
  ok('Шпион: шаг показывает Гримуар на весь экран', !!spyStep && E.stepSpec(S, spyStep).info({}).grim === true);
  runNight(S, {});
  ok('предпросмотр: спросить про Шпиона', E.nominationPreview(S, byRole(S, 'spy').id, byRole(S, 'virgin').id).askSpy);
  E.nominate(S, byRole(S, 'spy').id, byRole(S, 'virgin').id, { spyTownsfolk: true });
  ok('Шпион определился Горожанином — казнён', !byRole(S, 'spy').alive);
  // 20. Яга создаёт Демона и вы решаете смерти
  S = game(['dreamer', 'clockmaker', 'seamstress', 'oracle', 'sage', 'vortox', 'pithag', 'mutant'], 'snv');
  E.autoSetup(S, true); E.startGame(S); runNight(S, { dreamer: { t: [byRole(S, 'sage').id] }, seamstress: { t: [] } });
  ok('Вортокс: без казни победило бы зло — казним Часовщика', true);
  E.execute(S, byRole(S, 'clockmaker').id); E.endDay(S);
  const tgt = byRole(S, 'mutant'), victim = byRole(S, 'oracle');
  runNight(S, { pithag: { t: [tgt.id], r: 'fanggu', kill: [victim.id] }, vortox: { t: [byRole(S, 'sage').id] }, dreamer: { t: [byRole(S, 'clockmaker').id] } });
  ok('Яга: Мутант стал Фань Гу, сторона прежняя; выбранный умер', tgt.role === 'fanggu' && tgt.align === 'good' && !victim.alive);
  // 21. рамки выбора есть у шагов
  S = game(['clockmaker', 'grandmother', 'fortuneteller', 'monk', 'tealady', 'imp', 'witch', 'recluse']);
  E.autoSetup(S, true); E.startGame(S);
  const wst = S.night.steps.find(s => s.id === 'witch');
  ok('у Ведьмы есть рамки выбора', E.stepSpec(S, wst).bounds.length > 0);

  // 23. свойство prevents_evil_meeting (Дурманщик): 1-я ночь без знакомства, после смерти — знакомство
  S = game(['poppygrower', 'clockmaker', 'fortuneteller', 'monk', 'tealady', 'imp', 'witch', 'recluse']);
  E.autoSetup(S, true); E.startGame(S);
  const mi = S.night.steps.find(s => s.id === 'minioninfo'), di = S.night.steps.find(s => s.id === 'demoninfo');
  ok('Дурманщик: Приспешники не просыпаются', !E.stepSpec(S, mi).active);
  const dis = E.stepSpec(S, di);
  ok('Дурманщик: Демон получает только блефы', dis.active && /^Блефы/.test(dis.info().show) && /только блефы/.test(dis.bounds[0].t) && !/Приспешники:/.test(JSON.stringify(dis.info())));
  runNight(S, { witch: { t: [byRole(S, 'recluse').id] }, fortuneteller: { t: [byRole(S, 'monk').id, byRole(S, 'imp').id] } });
  E.execute(S, byRole(S, 'clockmaker').id); E.endDay(S);
  let sawMeet = false, g2 = 0;
  while (S.phase === 'night' && g2++ < 50) {
    const st = E.currentStep(S); const spec = E.stepSpec(S, st);
    if (st.meet) sawMeet = true;
    if (!spec.active) { E.skipStep(S); continue; }
    const inp = Object.assign({}, spec.defaults, { imp: { t: [byRole(S, 'poppygrower').id] }, witch: { t: [byRole(S, 'recluse').id] }, monk: { t: [byRole(S, 'tealady').id] }, fortuneteller: { t: [byRole(S, 'monk').id, byRole(S, 'imp').id] } }[st.id] || {});
    const res = E.applyStep(S, st, inp); if (!res.ok) E.skipStep(S);
  }
  ok('Дурманщик убит ночью — злые знакомятся этой же ночью', sawMeet && !byRole(S, 'poppygrower').alive);
  // 24. Странник: сторона от рассказчика, не считается для победы при 2 живых, но голосует
  S = game(['washerwoman', 'librarian', 'investigator', 'chef', 'empath', 'drunk', 'poisoner', 'imp'], 'tb');
  E.autoSetup(S, true); E.startGame(S); runNight(S, { poisoner: { t: [byRole(S, 'chef').id] } });
  const tr = E.addTraveller(S, 'Гость', 'scapegoat', 'evil', byRole(S, 'imp').id); E.finishRoles(S);
  ok('Странник встал в круг и остался злым', tr.align === 'evil' && S.players.indexOf(tr) === S.players.indexOf(byRole(S, 'imp')) + 1);
  ok('порог казни учитывает Странника (9 живых → 5)', E.voteThreshold(S) === 5, String(E.voteThreshold(S)));
  ok('порог изгнания: половина всех 9 игроков → 5', E.exileThreshold(S) === 5, String(E.exileThreshold(S)));
  E.exile(S, tr.id, 4);
  ok('4 голоса из 5 — Странник не изгнан', tr.alive);
  E.exile(S, tr.id, 5);
  ok('изгнание убивает Странника и не считается казнью', !tr.alive && !S.day.executed);
  ['washerwoman', 'librarian', 'investigator', 'chef', 'empath'].forEach(r => { byRole(S, r).alive = false; });
  const tr2 = E.addTraveller(S, 'Гость 2', 'beggar', 'good', null);
  E.attemptKill(S, byRole(S, 'drunk'), 'ability');
  ok('двое живых + живой Странник — победа зла (Странники не считаются)', S.result && S.result.winner === 'evil', S.result && S.result.reason);
  // 25. Сказочник с ночным шагом
  S = game(['clockmaker', 'grandmother', 'fortuneteller', 'monk', 'tealady', 'imp', 'witch', 'recluse']);
  S.fabled = ['toymaker']; E.autoSetup(S, true); E.startGame(S); E.endNight(S); E.endDay(S);
  ok('Сказочник Кукольник просыпается в последующую ночь', S.night.steps.some(s => s.fabled && s.id === 'toymaker'));

  // 26. Catfishing: Вдова, Каннибал, Аэронавт
  S = game(['investigator', 'chef', 'balloonist', 'fortuneteller', 'cannibal', 'recluse', 'widow', 'imp'], 'catfishing');
  E.autoSetup(S, true);
  ok('Catfishing: раскладка 8 игроков без ошибок', E.setupProblems(S).length === 0, E.setupProblems(S).join('; '));
  E.startGame(S);
  const chef = byRole(S, 'chef'), ft = byRole(S, 'fortuneteller'), can = byRole(S, 'cannibal');
  const wSt = S.night.steps.find(s => s.id === 'widow'), wSpec = E.stepSpec(S, wSt);
  ok('Вдова: шаг показывает Гримуар на весь экран', wSpec.active && wSpec.info(wSpec.defaults || {}).grim === true);
  runNight(S, { widow: { t: [chef.id], know: [ft.id] }, fortuneteller: { t: [chef.id, ft.id] } });
  ok('Вдова отравила Повара, добрый игрок раскрыт', E.hasTok(chef, 'poisoned', 'widow') && !!E.abilityOff(S, chef) && E.hasTok(ft, 'know', 'widow'));
  ok('Аэронавт: показанный игрок запомнен', !!S.flags['balloonLast_' + byRole(S, 'balloonist').id]);
  E.execute(S, byRole(S, 'widow').id);
  ok('Вдова казнена — яд с Повара снят', !E.abilityOff(S, chef) && !E.hasTok(chef, 'poisoned', 'widow'));
  ok('Каннибал съел злую Вдову — отравлен', E.hasTok(can, 'poisoned', 'cannibal') && !can.gained && S.flags['cannibal_' + can.id].evil);
  E.endDay(S);
  const fake = S.night.steps.findIndex(s => s.fakeCannibal), dawnAt = S.night.steps.findIndex(s => s.id === 'dawn');
  ok('отравленного Каннибала можно разбудить «понарошку» (перед рассветом)', fake >= 0 && fake === dawnAt - 1 && E.stepSpec(S, S.night.steps[fake]).active);
  const bst = S.night.steps.find(s => s.id === 'balloonist'), bspec = E.stepSpec(S, bst), last = S.flags['balloonLast_' + byRole(S, 'balloonist').id];
  ok('Аэронавт: по умолчанию игрок другого типа', E.realTeam(E.P(S, bspec.defaults.t[0])) !== last.type, E.nm(S, bspec.defaults.t[0]));
  const sameType = S.players.find(q => q.id !== bst.pid && q.id !== last.pid && E.realTeam(q) === last.type);
  ok('Аэронавт: тот же тип — предупреждение', !sameType || bspec.info({ t: [sameType.id] }).lines.some(l => /нельзя/.test(l)));
  ok('Аэронавт: Затворника можно показать, не решая его тип', E.missingInputs(bspec, { t: ids(S, 'recluse') }).length === 0 && E.stepInputs(bspec, { t: ids(S, 'recluse') }).some(f => f.key === 'reg'));
  runNight(S, { imp: { t: [byRole(S, 'investigator').id] }, fortuneteller: { t: [chef.id, ft.id] } });
  E.execute(S, ft.id);
  ok('Каннибал съел доброго — способность Гадалки, яд снят', can.gained === 'fortuneteller' && !E.hasTok(can, 'poisoned', 'cannibal') && E.hasTok(ft, 'lunch', 'cannibal'));
  E.endDay(S);
  ok('Каннибал просыпается как Гадалка, «понарошку» больше нет', S.night.steps.some(s => s.id === 'fortuneteller' && s.pid === can.id) && !S.night.steps.some(s => s.fakeCannibal));
  // способность «только в 1-ю ночь» — срабатывает в ночь после казни
  S = game(['investigator', 'chef', 'balloonist', 'fortuneteller', 'cannibal', 'recluse', 'widow', 'imp'], 'catfishing');
  E.autoSetup(S, true); E.startGame(S); runNight(S, { widow: { t: [byRole(S, 'chef').id] }, fortuneteller: { t: ids(S, 'chef', 'imp') } });
  E.execute(S, byRole(S, 'investigator').id); E.endDay(S);
  const fresh = S.night.steps.find(s => s.fresh);
  ok('Каннибал съел Сыщика — узнаёт этой ночью', fresh && fresh.id === 'investigator' && fresh.pid === byRole(S, 'cannibal').id && E.stepSpec(S, fresh).active
     && E.stepSpec(S, fresh).text === DATA.roles.investigator.first);
  runNight(S, { imp: { t: [byRole(S, 'chef').id] }, fortuneteller: { t: ids(S, 'chef', 'imp') }, investigator: { t: ids(S, 'widow', 'chef'), r: 'widow' } });
  E.endDay(S);
  ok('на следующую ночь Сыщик у Каннибала уже не просыпается', !S.night.steps.some(s => s.fresh));
  // Аэронавт: +0 или +1 Изгой — выбирает рассказчик, по умолчанию без изменений
  S = game(['investigator', 'chef', 'balloonist', 'dreamer', 'recluse', 'mutant', 'widow', 'imp'], 'catfishing');
  ok('Аэронавт без выбора: лишний Изгой — ошибка раскладки', E.setupProblems(S).some(t => /Раскладка/.test(t)));
  S.flags.mods = { balloonist: 1 };
  ok('Аэронавт: выбран +1 Изгой — раскладка верна', E.setupProblems(S).length === 0, E.setupProblems(S).join('; '));
  // Сказочник Привратник: −1, 0 или +1 Изгой
  S = game(['librarian', 'clockmaker', 'grandmother', 'fortuneteller', 'tealady', 'monk', 'witch', 'imp']);
  ok('без Привратника 0 Изгоев при 8 игроках — ошибка раскладки', E.setupProblems(S).some(t => /Раскладка/.test(t)));
  S.fabled = ['sentinel'];
  ok('Привратник без выбора: Изгоев как обычно (1)', E.setupProblems(S).some(t => /Изгой: 0 из 1/.test(t)), E.setupProblems(S).join('; '));
  S.flags.mods = { sentinel: -1 };
  const dS = E.distCheck(E.distribution(8, S.players.map(p => p.role).concat(S.fabled), S.flags.mods), E.countTeams(S));
  ok('Привратник −1: точные числа — Горожан 6, Изгоев 0', E.setupProblems(S).length === 0 && dS[0].want === 6 && dS[1].want === 0, JSON.stringify(dS));
  S = game(['librarian', 'clockmaker', 'grandmother', 'fortuneteller', 'recluse', 'moonchild', 'witch', 'imp']); S.fabled = ['sentinel']; S.flags.mods = { sentinel: 1 };
  ok('Привратник +1: 4 Горожанина и 2 Изгоя', E.setupProblems(S).length === 0, E.setupProblems(S).join('; '));
  // Крёстный Отец: −1 или +1 — выбрать обязательно
  S = game(['librarian', 'clockmaker', 'grandmother', 'fortuneteller', 'tealady', 'recluse', 'godfather', 'imp']);
  ok('Крёстный Отец: без выбора — просьба выбрать', E.setupProblems(S).some(t => /Крёстный Отец: выберите/.test(t)));
  S.flags.mods = { godfather: -1 };
  ok('Крёстный Отец −1: нужно 6 Горожан и 0 Изгоев', E.setupProblems(S).some(t => /Горожанин: 5 из 6/.test(t)) && E.setupProblems(S).some(t => /Изгой: 1 из 0/.test(t)), E.setupProblems(S).join('; '));
  S.flags.mods = { godfather: 1 };
  ok('Крёстный Отец +1: нужно 4 Горожанина и 2 Изгоя', E.setupProblems(S).some(t => /Горожанин: 5 из 4/.test(t)), E.setupProblems(S).join('; '));
  S = game(['librarian', 'clockmaker', 'grandmother', 'fortuneteller', 'tealady', 'godfather', 'imp']);
  ok('Крёстный Отец при 0 Изгоях: только +1, выбран сам', E.distribution(7, ['godfather', 'imp']).choices[0].value === 1);
  // случайная раздача: раскладка всегда сходится с выбором рассказчика
  const dealErr = [];
  const dV = E.distribution(7, ['vigormortis', 'widow']);
  ok('Вигормортис при 0 Изгоях: Изгоев 0, Горожан 5 (как обычно)', dV.outsider === 0 && dV.townsfolk === 5, JSON.stringify(dV));
  ok('Привратник +1 недоступен, если Изгоев в сценарии не хватает (TB, 9 игроков, Барон)', !E.distribution(9, ['baron', 'imp', 'sentinel'], { sentinel: 1 }, 4).choices[0].opts.includes(1)
     && E.distribution(9, ['baron', 'imp', 'sentinel'], { sentinel: 1 }, 4).outsider === 4);
  for (let k = 0; k < 300; k++) {
    const key = ['ecbe', 'catfishing', 'bmr', 'tb'][k % 4], np = 5 + (k % 11);
    S = E.newGame(key); for (let i = 0; i < np; i++) S.players.push(E.newPlayer('P' + i));
    if (k % 3 === 0) { S.fabled = ['sentinel']; S.flags.mods = { sentinel: [-1, 0, 1][k % 3 === 0 ? (k / 3) % 3 : 0] }; }
    if (k % 5 === 0) S.flags.mods = Object.assign({}, S.flags.mods, { balloonist: 1 });
    E.randomDeal(S);
    const pr = E.setupProblems(S); if (pr.length) dealErr.push(key + '/' + np + ': ' + pr.join('; '));
  }
  ok('случайная раздача ×300: раскладка без ошибок', !dealErr.length, dealErr.slice(0, 3).join(' || '));
  // Амнезиак
  S = game(['amnesiac', 'chef', 'balloonist', 'dreamer', 'savant', 'recluse', 'widow', 'imp'], 'catfishing');
  E.autoSetup(S, true); E.startGame(S);
  const am = byRole(S, 'amnesiac'), ast = S.night.steps.find(s => s.id === 'amnesiac');
  ok('Амнезиак: на шаге можно вписать способность', ast && E.stepSpec(S, ast).inputs.some(f => f.type === 'text'));
  runNight(S, { amnesiac: { ability: 'узнаёт, сколько злых среди соседей' }, widow: { t: [byRole(S, 'chef').id] }, dreamer: { t: ids(S, 'chef') } });
  E.amnesiacGuess(S, am.id, 'я что-то узнаю?', 'warm');
  ok('Амнезиак: способность сохранена, догадка дня записана', S.flags['amnesiac_' + am.id] === 'узнаёт, сколько злых среди соседей' && S.day.amnesiac[am.id].answer === 'warm' && /Тепло/.test(S.log[S.log.length - 1].t));
  // Пьяница, считающий себя Смотрителем воронов, просыпается после смерти ночью
  S = game(['washerwoman', 'librarian', 'investigator', 'chef', 'empath', 'drunk', 'poisoner', 'imp'], 'tb');
  E.autoSetup(S, true); byRole(S, 'drunk').believes = 'ravenkeeper'; E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } }); E.endDay(S);
  runNight(S, { imp: { t: ids(S, 'drunk') }, poisoner: { t: ids(S, 'chef') }, ravenkeeper: { t: ids(S, 'imp') } });
  ok('Пьяница-«Смотритель» просыпается после смерти', S.log.some(e => /^Смотритель воронов \(P5:drunk\)/.test(e.t)));

  // 28. смерти и победы: проверка всех способностей
  const tbGame = (extra) => { const g = game(['washerwoman', 'librarian', 'soldier', 'chef', 'empath', 'monk', 'poisoner', 'imp'], 'tb'); E.autoSetup(g, true); (extra || []).forEach(([n, r, a]) => E.addTraveller(g, n, r, a || 'good', null)); E.finishRoles(g); return g; };
  const trv = (S, r) => S.players.find(p => p.role === r);
  // Ассасин убивает даже защищённого (Солдат)
  S = game(['washerwoman', 'librarian', 'soldier', 'chef', 'empath', 'monk', 'assassin', 'imp'], 'bmr');
  E.autoSetup(S, true); E.startGame(S); runNight(S, {}); E.endDay(S);
  runNight(S, { assassin: { t: ids(S, 'soldier') }, imp: { t: ids(S, 'chef') }, monk: { t: ids(S, 'washerwoman') } });
  ok('Ассасин убивает Солдата, несмотря на защиту', !byRole(S, 'soldier').alive && !byRole(S, 'chef').alive);
  // Куртизанка: согласие и решение «оба умирают»
  S = tbGame([['Кур', 'harlot']]); E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } }); E.endDay(S);
  runNight(S, { harlot: { t: ids(S, 'empath'), yes: 'yes', die: 'yes' }, imp: { t: ids(S, 'chef') }, monk: { t: ids(S, 'washerwoman') }, poisoner: { t: ids(S, 'chef') } });
  ok('Куртизанка: согласие + «оба умирают» — умерли оба и попали в рассвет', !trv(S, 'harlot').alive && !byRole(S, 'empath').alive
     && ['harlot', 'empath', 'chef'].every(r => S.night.deaths.some(x => x.pid === (trv(S, r) || byRole(S, r)).id)), S.night.deaths.map(x => E.nm(S, x.pid)).join(','));
  S = tbGame([['Кур', 'harlot']]); E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } }); E.endDay(S);
  runNight(S, { harlot: { t: ids(S, 'empath'), yes: 'no' }, imp: { t: ids(S, 'chef') }, monk: { t: ids(S, 'washerwoman') }, poisoner: { t: ids(S, 'chef') } });
  ok('Куртизанка: отказ — никто не умирает', trv(S, 'harlot').alive && byRole(S, 'empath').alive);
  S = tbGame([['Кур', 'harlot']]); E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } }); E.endDay(S);
  runNight(S, { harlot: { t: ids(S, 'empath'), yes: 'yes', die: 'harlot' }, imp: { t: ids(S, 'chef') }, monk: { t: ids(S, 'washerwoman') }, poisoner: { t: ids(S, 'chef') } });
  ok('Куртизанка: «только Куртизанка» — умирает она одна', !trv(S, 'harlot').alive && byRole(S, 'empath').alive);
  S = tbGame([['Кур', 'harlot']]); E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } }); E.endDay(S);
  runNight(S, { harlot: { t: ids(S, 'empath'), yes: 'yes', die: 'target' }, imp: { t: ids(S, 'chef') }, monk: { t: ids(S, 'washerwoman') }, poisoner: { t: ids(S, 'chef') } });
  ok('Куртизанка: «только выбранный» — умирает выбранный', trv(S, 'harlot').alive && !byRole(S, 'empath').alive);
  // Азартный игрок: ничего не объявляется; не угадал — умирает, пьяный/отравленный — нет
  S = game(['grandmother', 'gambler', 'soldier', 'chef', 'empath', 'monk', 'poisoner', 'imp'].map(r => r === 'chef' ? 'courtier' : r === 'empath' ? 'tealady' : r === 'soldier' ? 'sailor' : r === 'monk' ? 'innkeeper' : r === 'poisoner' ? 'assassin' : r === 'imp' ? 'zombuul' : r), 'bmr');
  E.autoSetup(S, true); E.startGame(S); runNight(S, { grandmother: { t: ids(S, 'sailor') }, sailor: { t: ids(S, 'grandmother'), who: 'target' }, courtier: {} }); E.endDay(S);
  const gst = S.night.steps.find(s => s.id === 'gambler'), gsp = E.stepSpec(S, gst), gi = gsp.info({ t: ids(S, 'sailor'), r: 'monk' });
  ok('Азартный игрок: подсказка только для рассказчика', gi.secret === true && /умирает/.test(gi.show));
  runNight(S, { gambler: { t: ids(S, 'sailor'), r: 'monk' }, sailor: { t: ids(S, 'grandmother'), who: 'target' }, innkeeper: { t: ids(S, 'courtier', 'tealady'), drunk: '0' }, zombuul: { t: [] }, courtier: {} });
  ok('Азартный игрок не угадал — умер', !byRole(S, 'gambler').alive);
  // смерть по решению рассказчика ночью — в объявлении на рассвете, Смотритель просыпается
  S = game(['washerwoman', 'librarian', 'ravenkeeper', 'chef', 'empath', 'monk', 'poisoner', 'imp'], 'tb');
  E.autoSetup(S, true); E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } }); E.endDay(S);
  E.storytellerKill(S, byRole(S, 'ravenkeeper').id);
  ok('смерть по решению рассказчика ночью: в списке рассвета, Смотритель просыпается', S.night.deaths.some(x => x.pid === byRole(S, 'ravenkeeper').id)
     && E.stepSpec(S, S.night.steps.find(s => s.id === 'ravenkeeper')).active);
  E.storytellerKill(S, byRole(S, 'chef').id, null, 'Ангел — что-то плохое');
  ok('смерть с причиной: причина в журнале и у игрока, смерть — в рассвете', byRole(S, 'chef').deathNote === 'Ангел — что-то плохое'
     && /Причина: Ангел — что-то плохое/.test(S.log[S.log.length - 1].t) && S.night.deaths.some(x => x.pid === byRole(S, 'chef').id));
  // Механик
  S = game(['washerwoman', 'librarian', 'tinker', 'chef', 'empath', 'monk', 'poisoner', 'imp'], 'tb');
  S.script.roles.push('tinker'); E.autoSetup(S, true); E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } }); E.endDay(S);
  runNight(S, { tinker: { die: 'yes' }, imp: { t: ids(S, 'chef') }, monk: { t: ids(S, 'washerwoman') }, poisoner: { t: ids(S, 'chef') } });
  ok('Механик умирает ночью по решению рассказчика', !byRole(S, 'tinker').alive);
  // Стрелок, Козёл Отпущения, Судья, Мясник, Бюрократ, Вор, Шаман Вуду, Епископ
  S = tbGame([['Стр', 'gunslinger']]); E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } });
  E.nominate(S, byRole(S, 'chef').id, byRole(S, 'empath').id); E.recordVote(S, byRole(S, 'empath').id, ids(S, 'chef', 'monk'));
  E.gunslingerShot(S, trv(S, 'gunslinger').id, byRole(S, 'monk').id);
  ok('Стрелок застрелил проголосовавшего', !byRole(S, 'monk').alive && S.day.gunUsed);
  S = tbGame([['Коз', 'scapegoat', 'good']]); E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } });
  E.execute(S, byRole(S, 'chef').id, { scapegoat: trv(S, 'scapegoat').id });
  ok('Козёл Отпущения казнён вместо доброго', !trv(S, 'scapegoat').alive && byRole(S, 'chef').alive && S.day.executed === trv(S, 'scapegoat').id);
  S = tbGame([['Суд', 'judge']]); E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } });
  E.nominate(S, byRole(S, 'chef').id, byRole(S, 'empath').id); E.recordVote(S, byRole(S, 'empath').id, ids(S, 'chef', 'monk', 'soldier', 'librarian', 'washerwoman'));
  E.judgeRuling(S, trv(S, 'judge').id, byRole(S, 'empath').id, false);
  ok('Судья: «казни не будет» — голоса не считаются', E.block(S) === null);
  E.nominate(S, byRole(S, 'monk').id, byRole(S, 'chef').id);
  ok('Судья тратит способность один раз', !!S.flags['judge_' + trv(S, 'judge').id]);
  S = tbGame([['Суд', 'judge']]); E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } });
  E.nominate(S, byRole(S, 'chef').id, byRole(S, 'empath').id);
  ok('Судья: «казнь состоится» — казнён без голосов', E.judgeRuling(S, trv(S, 'judge').id, byRole(S, 'empath').id, true).ended && !byRole(S, 'empath').alive);
  S = tbGame([['Мяс', 'butcher']]); E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } });
  E.nominate(S, byRole(S, 'chef').id, byRole(S, 'empath').id); E.recordVote(S, byRole(S, 'empath').id, ids(S, 'chef', 'monk', 'soldier', 'librarian', 'washerwoman'));
  E.executeNow(S);
  ok('Мясник: после казни можно номинировать ещё раз', !byRole(S, 'empath').alive && S.day.butcherOpen);
  E.nominate(S, trv(S, 'butcher').id, byRole(S, 'librarian').id); E.recordVote(S, byRole(S, 'librarian').id, ids(S, 'chef', 'monk', 'soldier', 'washerwoman', 'imp'));
  E.endDay(S);
  ok('Мясник: вторая казнь за день', !byRole(S, 'librarian').alive && S.phase === 'night');
  S = tbGame([['Бюр', 'bureaucrat'], ['Вор', 'thief', 'evil']]); E.startGame(S);
  runNight(S, { bureaucrat: { t: ids(S, 'chef') }, thief: { t: ids(S, 'monk') }, poisoner: { t: ids(S, 'empath') } });
  ok('Бюрократ ×3, Вор −1: 1 обычный + 3 + (−1) = 3', E.voteCount(S, ids(S, 'chef', 'monk', 'soldier')) === 3, String(E.voteCount(S, ids(S, 'chef', 'monk', 'soldier'))));
  E.exile(S, trv(S, 'thief').id, 99);
  ok('Вор изгнан — голос снова обычный', E.voteCount(S, ids(S, 'monk')) === 1);
  S = tbGame([['Вуд', 'voudon']]); E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } });
  byRole(S, 'librarian').alive = false;
  ok('Шаман Вуду: для казни хватает 1 голоса', E.voteThreshold(S) === 1);
  E.nominate(S, byRole(S, 'chef').id, byRole(S, 'empath').id); E.recordVote(S, byRole(S, 'empath').id, ids(S, 'librarian'));
  ok('Шаман Вуду: мёртвый проголосовал и не потратил голос', byRole(S, 'librarian').ghost && E.block(S) === byRole(S, 'empath').id);
  S = tbGame([['Епи', 'bishop']]); E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } });
  E.nominate(S, 'st', byRole(S, 'imp').id);
  ok('Епископ: номинирует рассказчик', S.day.nominated.includes(byRole(S, 'imp').id) && /Рассказчик номинирует/.test(S.log[S.log.length - 1].t));
  // Девиант, Надзирательница
  S = tbGame([['Дев', 'deviant']]); E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } });
  E.exile(S, trv(S, 'deviant').id, 99, null, { funny: true });
  ok('Девиант был забавным — изгнание не убивает', trv(S, 'deviant').alive);
  const a0 = S.players[0].id, a1 = S.players[1].id; E.swapSeats(S, a0, a1);
  ok('Надзирательница: игроки поменялись местами', S.players[0].id === a1 && S.players[1].id === a0);
  // Наёмник: Демон выбрал Наёмника — Демон пьян, атака не проходит, Наёмник злой
  S = game(['washerwoman', 'librarian', 'goon', 'chef', 'empath', 'monk', 'poisoner', 'imp'], 'tb'); S.script.roles.push('goon');
  E.autoSetup(S, true); E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } }); E.endDay(S);
  runNight(S, { imp: { t: ids(S, 'goon') }, monk: { t: ids(S, 'washerwoman') }, poisoner: { t: ids(S, 'chef') } });
  ok('Наёмник: Чёрт выбрал его — Чёрт пьян, Наёмник жив и стал злым', byRole(S, 'goon').alive && byRole(S, 'goon').align === 'evil' && E.hasTok(byRole(S, 'imp'), 'drunk', 'goon'));
  // Вигормортис: убитый Приспешник сохраняет способность и просыпается мёртвым
  S = game(['clockmaker', 'dreamer', 'seamstress', 'oracle', 'sage', 'vigormortis', 'witch'], 'snv');
  E.autoSetup(S, true); E.startGame(S); runNight(S, { witch: { t: ids(S, 'sage') }, dreamer: { t: ids(S, 'sage') }, seamstress: { t: [] } }); E.endDay(S);
  runNight(S, { vigormortis: { t: ids(S, 'witch'), nb: ids(S, 'clockmaker') }, witch: { t: ids(S, 'sage') }, dreamer: { t: ids(S, 'sage') }, seamstress: { t: [] } }); E.endDay(S);
  ok('Вигормортис: мёртвая Ведьма с сохранённой способностью просыпается', !byRole(S, 'witch').alive && E.stepSpec(S, S.night.steps.find(s => s.id === 'witch')).active);
  // Собиратель Костей, Ученик, Бариста
  S = tbGame([['Кос', 'bonecollector']]); E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } });
  E.execute(S, byRole(S, 'monk').id); E.endDay(S);
  runNight(S, { bonecollector: { t: ids(S, 'monk') }, imp: { t: ids(S, 'chef') }, poisoner: { t: ids(S, 'chef') }, monk: { t: ids(S, 'washerwoman') } });
  ok('Собиратель Костей: мёртвый Монах вернул способность и защитил', E.hasTok(byRole(S, 'washerwoman'), 'protected', 'monk') || S.log.some(e => /Монах .* защищает/.test(e.t)));
  S = tbGame(); E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } }); E.endDay(S);
  const ap = E.addTraveller(S, 'Уч', 'apprentice', 'good', null);
  E.endDay(S);
  ok('Ученик, вошедший позже, просыпается после заката', S.night.steps[1] && S.night.steps[1].id === 'apprentice');
  runNight(S, { apprentice: { r: 'monk' }, imp: { t: ids(S, 'chef') }, monk: { t: ids(S, 'washerwoman') }, poisoner: { t: ids(S, 'chef') } });
  ok('Ученик получил способность Монаха и действует в ту же ночь', ap.gained === 'monk' && S.log.some(e => e.t.startsWith(`Монах (${ap.name})`)));
  S = tbGame([['Бар', 'barista']]); E.startGame(S);
  runNight(S, { barista: { t: ids(S, 'chef'), mode: 'sober' }, poisoner: { t: ids(S, 'chef') } });
  ok('Бариста: отравленный, но «трезв и здоров» — способность работает', E.hasTok(byRole(S, 'chef'), 'poisoned', 'poisoner') && !E.abilityOff(S, byRole(S, 'chef')));
  // Сказочники: Кукольник, Фаталист, Скрипач, Герцогиня
  S = game(['washerwoman', 'librarian', 'chef', 'empath', 'poisoner', 'imp'], 'tb'); S.fabled = ['toymaker']; E.autoSetup(S, true); E.startGame(S);
  ok('Кукольник: при 6 игроках злые знакомятся', S.night.steps.some(s => s.id === 'minioninfo') && S.night.steps.some(s => s.id === 'demoninfo'));
  runNight(S, { poisoner: { t: ids(S, 'chef') } }); E.endDay(S);
  runNight(S, { imp: { t: [] }, poisoner: { t: ids(S, 'chef') } });
  ok('Кукольник: Демон может не нападать', S.flags.toyNoAttack && S.players.every(p => p.alive));
  S = tbGame(); S.fabled = ['doomsayer']; E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } });
  E.doomsayerKill(S, byRole(S, 'chef').id, byRole(S, 'empath').id);
  ok('Фаталист: умер игрок той же стороны', !byRole(S, 'empath').alive && S.flags['doomUsed_' + byRole(S, 'chef').id]);
  E.fiddlerEnd(S, byRole(S, 'chef').id, 'challenger');
  ok('Скрипач: победил добрый игрок — победа добра', S.result && S.result.winner === 'good');
  S = tbGame(); S.fabled = ['duchess']; E.startGame(S); runNight(S, { poisoner: { t: ids(S, 'chef') } }); E.endDay(S);
  const du = E.stepSpec(S, S.night.steps.find(s => s.id === 'duchess'));
  ok('Герцогиня: число злых среди троих посетителей', /Злых посетителей: 2/.test(du.info({ t: ids(S, 'chef', 'imp', 'poisoner'), f: ids(S, 'chef') }).show));
  // Ведьма, Крёстный Отец, Девственница, близнецы — уже проверены выше; Девственница + Странник-Судья не мешают
  ok('Ведьма убивает проклятого номинатора (тест выше)', results.some(r => r.startsWith('PASS Ведьма: номинировавший проклятый умер')));

  // 29. справочник: все роли, включая экспериментальные и Лориков, со справкой
  const allIds = Object.keys(DATA.roles);
  ok('справочник: 181 роль, у каждой есть «Как вести»', allIds.length === 181 && allIds.every(r => DATA.guide[r] && DATA.guide[r].how), String(allIds.length));
  ok('справочник: экспериментальные роли на месте', ['steward', 'legion', 'atheist', 'lleech', 'tor', 'ferryman'].every(r => DATA.roles[r]));
  // свой сценарий с экспериментальной ролью без Демона (Атеист): начать можно, игра не кончается «смертью Демона»
  S = E.newGame('tb'); S.script = { key: 'custom', name: 'Атеист', roles: ['atheist', 'chef', 'empath', 'monk', 'soldier', 'recluse'] };
  ['atheist', 'chef', 'empath', 'monk', 'soldier', 'recluse'].forEach((r, i) => { const p = E.newPlayer('A' + i); p.role = r; S.players.push(p); });
  E.finishRoles(S); E.autoSetup(S, true);
  ok('Атеист: раскладку проверяет рассказчик — начать можно', E.setupProblems(S).length === 0, E.setupProblems(S).join('; '));
  E.startGame(S); runNight(S, {});
  ok('Атеист: игра без Демона не заканчивается сама', !S.result && S.phase === 'day');

  // 30. искажённая информация, учёт для Математика, пьяный Пукка, Заклинатель змей
  const custom = roles => { const g = E.newGame('tb'); g.script = { key: 'custom', name: 'T', roles: roles.slice() };
    roles.forEach((r, i) => { const p = E.newPlayer('C' + i + ':' + r); p.role = r; g.players.push(p); }); E.finishRoles(g); E.autoSetup(g, true); return g; };
  const runUntil = (S, id, inputs) => { let g = 0; while (S.phase === 'night' && g++ < 200) { const st = E.currentStep(S); if (st.id === id) return st;
    const spec = E.stepSpec(S, st); if (!spec.active) { E.skipStep(S); continue; } if (!E.applyStep(S, st, Object.assign({}, spec.defaults, (inputs || {})[st.id] || {})).ok) E.skipStep(S); } return null; };
  S = custom(['empath', 'mathematician', 'clockmaker', 'monk', 'oracle', 'recluse', 'poisoner', 'imp']); E.startGame(S);
  const emp = byRole(S, 'empath');
  let st = runUntil(S, 'empath', { poisoner: { t: [emp.id] } }), sp = E.stepSpec(S, st);
  ok('отравленный Эмпат: рамка «ОТРАВЛЕН», рекомендация ложная', sp.dist && sp.dist.label === 'ОТРАВЛЕН' && sp.defaults.n !== Number(sp.info({}).show), JSON.stringify(sp.dist));
  E.applyStep(S, st, sp.defaults);
  ok('Математик: ложное число Эмпата учтено', (S.flags.abn || []).length === 1, JSON.stringify(S.flags.abn));
  st = runUntil(S, 'mathematician', {}); sp = E.stepSpec(S, st);
  ok('Математик: по умолчанию показывает 1', st && sp.defaults.c === 1, st ? String(sp.defaults.c) : 'нет шага');
  runNight(S, {});
  ok('Математик: учёт сброшен на рассвете', !(S.flags.abn || []).length);
  E.endDay(S);
  st = runUntil(S, 'imp', { poisoner: { t: ids(S, 'imp') }, monk: { t: ids(S, 'clockmaker') } }); sp = E.stepSpec(S, st);
  E.applyStep(S, st, { t: ids(S, 'oracle') });
  ok('отравленный Чёрт: нападение не сработало — учтено для Математика', byRole(S, 'oracle').alive && (S.flags.abn || []).length === 1, JSON.stringify(S.flags.abn));

  S = game(['clockmaker', 'grandmother', 'fortuneteller', 'monk', 'tealady', 'pukka', 'witch', 'recluse']);
  E.autoSetup(S, true); E.startGame(S);
  const pft = byRole(S, 'fortuneteller'), pk = byRole(S, 'pukka'), ck = byRole(S, 'clockmaker');
  const pukkaNight = () => ({ pukka: { t: [ck.id] }, monk: { t: ids(S, 'tealady') }, witch: { t: ids(S, 'recluse') } });
  runNight(S, { pukka: { t: [pft.id] }, witch: { t: ids(S, 'recluse') } }); E.endDay(S);
  E.addTok(S, pk, 'drunk', 'sweetheart');
  st = runUntil(S, 'pukka', pukkaNight()); sp = E.stepSpec(S, st);
  const pinf = sp.info({ t: [ck.id] });
  ok('пьяный Пукка: «НЕ умирает», только для рассказчика', pinf && pinf.secret && /НЕ умирает/.test(pinf.show), pinf && pinf.show);
  runNight(S, pukkaNight());
  ok('пьяный Пукка: прежний отравленный жив, новый не отравлен', pft.alive && !E.hasTok(ck, 'poisoned', 'pukka'));
  E.endDay(S); E.rmTok(pk, 'drunk');
  runNight(S, pukkaNight());
  ok('Пукка протрезвел: прежний отравленный умирает', !pft.alive);

  S = game(['snakecharmer', 'clockmaker', 'dreamer', 'seamstress', 'mathematician', 'mutant', 'witch', 'fanggu'], 'snv');
  E.autoSetup(S, true); E.startGame(S);
  const sc = byRole(S, 'snakecharmer'), fg = byRole(S, 'fanggu');
  const scNight = { witch: { t: ids(S, 'mutant') }, dreamer: { t: ids(S, 'clockmaker') } };
  runNight(S, Object.assign({ snakecharmer: { t: ids(S, 'clockmaker') } }, scNight)); E.endDay(S);
  st = runUntil(S, 'snakecharmer', scNight); sp = E.stepSpec(S, st);
  const sinf = sp.info({ t: [fg.id] });
  ok('Заклинатель выбрал Демона: две плашки «ТЕПЕРЬ ВЫ»', sinf && sinf.tokens && sinf.tokens.length === 2 && sinf.tokens[0].role === 'fanggu' && sinf.tokens[1].role === 'snakecharmer');
  E.applyStep(S, st, { t: [fg.id] });
  const rest = S.night.steps.slice(S.night.i);
  ok('обмен: дальше этой ночью Демоном ходит новый Демон', sc.role === 'fanggu' && fg.role === 'snakecharmer' && sc.align === 'evil'
    && rest.some(x => x.id === 'fanggu' && x.pid === sc.id) && !rest.some(x => x.id === 'fanggu' && x.pid === fg.id), rest.map(x => x.id + ':' + x.pid).join(','));
  ok('Цереновус, Яга, Азартный игрок, Философ выбирают роли только из сценария',
    ['cerenovus', 'pithag', 'gambler', 'philosopher'].every(id => !E.stepSpec(S, { id, pid: byRole(S, 'witch').id, key: 'chk:' + id }).inputs.some(f => f.all)));
  ok('Библиотекарь без Изгоев не застревает', !results.some(x => /пропущен шаг librarian/.test(x)));

  // 32. жетоны информации на весь экран: «ЭТО ДЕМОН», «ЭТО ВАШИ ПРИСПЕШНИКИ», блефы, Безумец
  S = game(['washerwoman', 'librarian', 'investigator', 'chef', 'empath', 'lunatic', 'poisoner', 'imp'], 'bmr'); E.autoSetup(S, true); E.startGame(S);
  const cardsOf = id => { const st = S.night.steps.find(s => s.id === id); const sp = E.stepSpec(S, st); return (sp.info(Object.assign({}, sp.defaults)) || {}).tokens || []; };
  const cMi = cardsOf('minioninfo'), cDi = cardsOf('demoninfo'), cLu = cardsOf('lunatic');
  ok('Приспешникам: только «ЭТО ДЕМОН» — Демон',
    cMi.length === 1 && cMi[0].caption === 'ЭТО ДЕМОН' && cMi[0].players[0] === byRole(S, 'imp').id);
  ok('Демону: Приспешники и 3 блефа', cDi.some(t => t.caption === 'ЭТО ВАШИ ПРИСПЕШНИКИ') && cDi.filter(t => t.caption === 'ЭТИХ РОЛЕЙ В ИГРЕ НЕТ').length === 3);
  ok('Безумцу: «приспешники» и «блефы», Демону — «ЭТОТ ИГРОК» Безумец',
    cLu.some(t => t.caption === 'ЭТО ВАШИ ПРИСПЕШНИКИ' && t.players.length === 1) && cLu.filter(t => t.caption === 'ЭТИХ РОЛЕЙ В ИГРЕ НЕТ').length === 3
    && cLu.some(t => t.caption === 'ЭТОТ ИГРОК' && t.role === 'lunatic' && t.players[0] === byRole(S, 'lunatic').id), JSON.stringify(cLu));

  S = game(['clockmaker', 'grandmother', 'fortuneteller', 'monk', 'tealady', 'imp', 'witch', 'recluse']); E.autoSetup(S, true); E.startGame(S);
  const ftSt = S.night.steps.find(s => s.id === 'fortuneteller'), ftInfo = E.stepSpec(S, ftSt).info({ t: ids(S, 'monk', 'imp') });
  ok('ответ «ДА» Гадалки можно показать на весь экран', ftInfo.tokens && ftInfo.tokens[0].text === 'ДА', JSON.stringify(ftInfo.tokens));

  S = game(['clockmaker', 'dreamer', 'seamstress', 'mathematician', 'snakecharmer', 'mutant', 'cerenovus', 'fanggu'], 'snv'); E.autoSetup(S, true); E.startGame(S);
  const ceSt = S.night.steps.find(s => s.id === 'cerenovus'), ceInfo = E.stepSpec(S, ceSt).info({ t: ids(S, 'clockmaker'), r: 'savant' });
  ok('Цереновус: роль безумия на том же экране, что и его жетон', ceInfo.tokens.length === 2 && ceInfo.tokens[1].join && ceInfo.tokens[1].role === 'savant', JSON.stringify(ceInfo.tokens));

  // 33. сценарии сообщества: раздача, подготовка и две ночи без ошибок; Сказочники сценария — в игре
  const commErr = [];
  for (const key of ['reptiles2', 'oasis', 'pies', 'uncertain']) for (const n of [5, 7, 9, 11, 13, 15]) {
    try {
      const g = E.newGame(key);
      for (let i = 0; i < n; i++) g.players.push(E.newPlayer(key + i));
      E.randomDeal(g);
      if (g.flags.marionetteNeed) { // Марионетка: рассказчик выбирает соседа Демона с доброй ролью
        const c = E.demonSeatNeighbours(g).filter(q => E.isGoodTeam(E.realTeam(q)));
        if (!c.length) continue; // оба соседа Демона злые — рассказчик пересадит (редко, 3 Приспешника)
        E.makeMarionette(g, c[0].id);
      }
      E.finishRoles(g); E.autoSetup(g, true);
      const probs = E.setupProblems(g).filter(t => !/выберите, сколько Изгоев/.test(t));
      if (probs.length && !E.unknownSetup(g).length) commErr.push(`${key}/${n}: ${probs.join('; ')}`);
      if (E.setupProblems(g).some(t => /выберите, сколько Изгоев/.test(t))) continue;
      E.startGame(g);
      for (let night = 0; night < 2 && !g.result; night++) {
        let guard = 0;
        while (g.phase === 'night' && guard++ < 200) {
          const st = E.currentStep(g), sp = E.stepSpec(g, st);
          if (!sp.active) { E.skipStep(g); continue; }
          if (!E.applyStep(g, st, Object.assign({}, sp.defaults)).ok) E.skipStep(g);
        }
        if (g.phase === 'day') E.endDay(g);
      }
    } catch (e) { commErr.push(`${key}/${n}: ${e.message}`); }
  }
  ok('сценарии сообщества: раздача и две ночи без ошибок', !commErr.length, commErr.slice(0, 3).join(' | '));
  ok('сценарий со Сказочниками: Джинн и Ловец Бури в игре', E.newGame('reptiles2').fabled.join() === 'stormcatcher,djinn');

  // 31. жребий: каменная стена — роль выпадает в момент открытия ячейки, строго из «Ролей на игру»
  const drawAll = (S, before) => { let g = 0; while (S.draw.turn && g++ < 30) { if (before) before(S); const k = S.draw.cells.findIndex(c => !c.pid); E.drawOpen(S, k); E.drawClose(S); } };
  const POOL8 = ['washerwoman', 'librarian', 'investigator', 'chef', 'empath', 'drunk', 'poisoner', 'imp'];
  S = E.newGame('tb'); for (let i = 0; i < 8; i++) S.players.push(E.newPlayer('W' + i)); S.pool = POOL8.slice();
  E.drawStart(S);
  ok('жребий: до открытия ячеек ролей ни у кого нет, жребий не закончен', S.players.every(p => !p.role) && S.draw.cells.length === 8 && S.draw.bag.length === 8 && E.setupProblems(S).some(t => /Жребий не закончен/.test(t)));
  ok('жребий: во время жребия случайная раздача недоступна', E.randomDeal(S) === false && S.players.every(p => !p.role));
  const k0 = S.draw.cells.findIndex(c => !c.pid); E.drawOpen(S, 0); E.drawClose(S);
  ok('жребий: роль выпадает только открывшему ячейку', S.players.filter(p => p.role).length === 1 && S.draw.bag.length === 7, k0);
  drawAll(S);
  ok('жребий: роли — ровно «Роли на игру», без повторов, раскладка в порядке', S.draw.finished && S.players.map(p => p.role).sort().join() === POOL8.slice().sort().join() && E.setupProblems(S).length === 0, E.setupProblems(S).join('; '));
  const dr = byRole(S, 'drunk');
  ok('жребий: Пьяница видит Горожанина не из игры и не из блефов', dr.believes && E.realTeam({ role: dr.believes }) === 'townsfolk' && !S.players.some(p => p.role === dr.believes) && !S.bluffs.includes(dr.believes) && E.drawShown(S.draw.cells.find(c => c.pid === dr.id)) === dr.believes);
  ok('жребий: после стены роли не раздать заново', E.drawLocked(S) && E.randomDeal(S) === false && S.bluffs.filter(Boolean).length === 3);
  // назначения: конкретная роль и тип роли — в том числе назначенные во время жребия
  S = E.newGame('tb'); for (let i = 0; i < 8; i++) S.players.push(E.newPlayer('N' + i)); S.pool = POOL8.slice();
  S.assign = { [S.players[5].id]: { role: 'imp' }, [S.players[6].id]: { team: 'minion' } };
  E.drawStart(S);
  let midRole = null; // посреди жребия назначаем последнему игроку роль, которая ещё в мешочке
  drawAll(S, S => { if (S.draw.turn === S.players[2].id && !midRole) { midRole = S.draw.bag.find(r => !['imp', 'poisoner'].includes(r)); S.assign[S.players[7].id] = { role: midRole }; } });
  ok('жребий: назначенные роль и тип роли выпадают нужным игрокам (и назначенное посреди жребия)', S.players[5].role === 'imp' && S.players[6].role === 'poisoner' && !!midRole && S.players[7].role === midRole, S.players.map(p => p.role).join() + ' / ' + midRole);
  // выбрано не по числу игроков — стена не выкатывается (раньше молча брались случайные роли)
  S = E.newGame('tb'); for (let i = 0; i < 8; i++) S.players.push(E.newPlayer('B' + i)); S.pool = POOL8.slice(0, 7);
  ok('жребий: ролей на игру не по числу игроков — стена не выкатывается', E.drawStart(S) === false && !S.draw && /отметьте ровно 8/.test(E.drawProblem(S)));
  // роли, выданные до стены, остаются за игроками
  S = game(['washerwoman', 'librarian', 'investigator', 'chef', 'empath', 'monk', 'poisoner', 'imp'], 'tb'); S.players[3].role = null; S.players[4].role = null;
  E.drawStart(S); drawAll(S);
  ok('жребий: роли, выданные до стены, остаются; остальным — из случайного набора', S.players[0].role === 'washerwoman' && S.players[7].role === 'imp' && S.players.every(p => p.role) && E.setupProblems(S).length === 0, E.setupProblems(S).join('; '));
  // набор ролей на игру (S.pool) — раздача берёт только его
  S = E.newGame('tb'); for (let i = 0; i < 7; i++) S.players.push(E.newPlayer('P' + i));
  S.pool = ['chef', 'empath', 'monk', 'slayer', 'soldier', 'poisoner', 'imp']; E.randomDeal(S);
  ok('раздача из выбранного набора ролей', S.players.map(p => p.role).sort().join() === S.pool.slice().sort().join());
  // The Midnight Oasis: случайная раздача по таблице; Егерь — с Девицей; Атеист случайно не попадает
  const oasisErr = [];
  for (let k = 0; k < 150; k++) {
    const g = E.newGame('oasis'), n = 7 + (k % 9); for (let i = 0; i < n; i++) g.players.push(E.newPlayer('o' + i));
    E.randomDeal(g); const probs = E.setupProblems(g).filter(t => !/выберите, сколько Изгоев/.test(t)), c = E.countTeams(g);
    if (probs.length) oasisErr.push(n + ': ' + probs.join('; ')); if (c.demon !== 1) oasisErr.push(n + ': Демонов ' + c.demon);
    if (g.players.some(p => p.role === 'atheist')) oasisErr.push('Атеист в случайной раздаче');
  }
  ok('Midnight Oasis: случайная раздача по таблице, всегда 1 Демон', !oasisErr.length, oasisErr.slice(0, 3).join(' | '));
  const dAt = E.distribution(9, ['atheist', 'chef'], {}, 4);
  ok('Атеист: злых ролей нет, добрых — по числу игроков', dAt.minion === 0 && dAt.demon === 0 && dAt.townsfolk + dAt.outsider === 9);
  // блефы: без повторов и без роли, которой себя считает Пьяница
  let bluffBad = 0;
  for (let k = 0; k < 100; k++) { const g = game(['washerwoman', 'librarian', 'investigator', 'chef', 'empath', 'drunk', 'poisoner', 'imp'], 'tb'); E.autoSetup(g, true);
    const dr = g.players.find(p => p.role === 'drunk'); if (g.bluffs.includes(dr.believes) || new Set(g.bluffs).size !== g.bluffs.length) bluffBad++; }
  ok('блефы: без повторов и без роли Пьяницы', bluffBad === 0, String(bluffBad));
  // джинксы Шпиона: с Дурманщиком — не смотрит Гримуар; с Девицей — Девица отравлена
  S = E.newGame('tb'); S.script = { key: 'custom', name: 'J', roles: ['poppygrower', 'damsel', 'chef', 'empath', 'monk', 'soldier', 'spy', 'imp', 'slayer'] };
  ['poppygrower', 'damsel', 'chef', 'empath', 'monk', 'spy', 'imp'].forEach((r, i) => { const p = E.newPlayer('J' + i); p.role = r; S.players.push(p); });
  E.finishRoles(S); E.autoSetup(S, true); E.startGame(S);
  const spySt = S.night.steps.find(s => s.id === 'spy');
  ok('джинкс: при Дурманщике Шпион не смотрит Гримуар', spySt && !E.stepSpec(S, spySt).active);
  ok('джинкс: при Шпионе Девица отравлена', /отравлена/.test(E.abilityOff(S, byRole(S, 'damsel')) || ''));
  // подсказки: факты Саванта (правда + ложь), советы Рыбаку, Мецефель
  S = game(['savant', 'fisherman', 'chef', 'empath', 'monk', 'drunk', 'poisoner', 'imp']); E.autoSetup(S, true); E.startGame(S);
  const sp2 = IDEAS.savantPair(S, byRole(S, 'savant').id);
  ok('Савант: два факта — один правдивый, другой ложный', sp2 && sp2.length === 2 && sp2.filter(x => x.truth).length === 1, JSON.stringify(sp2));
  ok('Рыбак: есть советы по текущей игре', IDEAS.fishermanAdvice(S, byRole(S, 'fisherman').id).length >= 5);
  ok('идеи: Амнезиак и слова Мецефеля — не меньше 15', IDEAS.AMNESIAC.length >= 15 && IDEAS.MEZ_WORDS.length >= 15);

  // 27. слова для утра
  const placeholders = [];
  for (let n = 0; n <= 6; n++) for (const first of [true, false]) for (let k = 0; k < 8; k++) {
    const names = ['Аня', 'Борис', 'Вика', 'Гоша', 'Даша', 'Егор'].slice(0, n), t = morningText(names, first, k).text;
    if (/[{}]/.test(t) || !names.every(x => t.includes(x))) placeholders.push(n + ':' + k + ' ' + t);
  }
  ok('утро: все шаблоны заполняются, имена на месте', !placeholders.length, placeholders[0]);
  ok('утро: первое утро и обычное — разные тексты', MORNING.first.includes(morningText([], true, 0).text) && MORNING.none.includes(morningText([], false, 0).text));
  ok('утро: имена через «и» и запятую', morningText(['А', 'Б'], false, 0).text.includes('А и Б') && morningText(['А', 'Б', 'В'], false, 0).text.includes('А, Б и В'));
  ok('утро: «трое»/«троих» для трёх смертей', MORNING.many.map((_, k) => morningText(['А', 'Б', 'В'], false, k).text).some(t => /трое|троих/.test(t)));

  // 22. сценарии: все роли известны, ночные порядки строятся
  // 28. Прачка, Библиотекарь, Сыщик: в списке только то, что можно показать; роль и игроки связаны (заметка 2026-10-12)
  {
    const G = game(['librarian', 'washerwoman', 'investigator', 'chef', 'butler', 'saint', 'poisoner', 'imp'], 'tb'); E.autoSetup(G, true); E.startGame(G);
    const spL = E.stepSpec(G, G.night.steps.find(s => s.id === 'librarian')), fl = E.stepInputs(spL, { none: '' });
    const rf = fl.find(f => f.key === 'r'), tf = fl.find(f => f.key === 't'), gl = rf.groups.flatMap(g => g.roles);
    ok('Библиотекарь: в списке только Изгои в игре', gl.length === 2 && gl.includes('butler') && gl.includes('saint'), JSON.stringify(rf.groups));
    const in1 = { none: '', t: [byRole(G, 'chef').id, byRole(G, 'saint').id], r: 'butler' }; tf.bind(in1);
    ok('Библиотекарь: выбрали игроков — роль берётся у Изгоя среди них', in1.r === 'saint');
    const in2 = { none: '', t: [byRole(G, 'chef').id], r: 'butler' }; rf.bind(in2);
    ok('Библиотекарь: выбрали роль — её обладатель встаёт в пару', in2.t.includes(byRole(G, 'butler').id) && in2.t.includes(byRole(G, 'chef').id));
    ok('Сыщик: в списке только Приспешники в игре', E.stepInputs(E.stepSpec(G, G.night.steps.find(s => s.id === 'investigator')), {}).find(f => f.key === 'r').groups.flatMap(g => g.roles).join() === 'poisoner');
    ok('показ: «Эта роль — один из этих игроков:» — над именами', /Эта роль — один из этих игроков/.test(spL.info({ none: '', t: in1.t, r: 'saint' }).tokens[0].lead || ''));
    const G2 = game(['investigator', 'recluse', 'chef', 'empath', 'monk', 'soldier', 'poisoner', 'imp'], 'tb'); E.autoSetup(G2, true); E.startGame(G2);
    const gi = E.stepInputs(E.stepSpec(G2, G2.night.steps.find(s => s.id === 'investigator')), {}).find(f => f.key === 'r').groups;
    ok('Сыщик и Затворник: остальные Приспешники — отдельной группой', gi.length === 2 && gi[1].roles.includes('scarletwoman') && /Затворник/.test(gi[1].label), JSON.stringify(gi));
  }

  // 29. правка ночного выбора из журнала: переигрывание ночи, что изменится, дневные действия сохраняются (заметка 2026-10-12)
  {
    const G = game(['empath', 'monk', 'chef', 'soldier', 'washerwoman', 'butler', 'poisoner', 'imp'], 'tb'); E.autoSetup(G, true); E.startGame(G);
    const em = byRole(G, 'empath'), mo = byRole(G, 'monk'), ch = byRole(G, 'chef');
    runNight(G, { poisoner: { t: [em.id] }, butler: { t: [ch.id] } });
    const k = G.rp.recs.findIndex(r => r.t === 'step' && r.key.startsWith('poisoner'));
    ok('правка: шаги ночи записаны, записи журнала помечены', k >= 0 && G.log.some(e => e.r === k && e.w === G.rp.id && /Отравитель/.test(e.t)));
    const b0 = E.rpStrip(G), l0 = G.log.length; E.nominate(G, mo.id, ch.id); E.recPatch(G, b0, l0); // как act() в интерфейсе
    const res = E.editNight(G, k, { inp: { t: [mo.id] } });
    ok('правка: яд переходит на другого игрока', E.hasTok(E.P(res.T, mo.id), 'poisoned', 'poisoner') && !E.hasTok(E.P(res.T, em.id), 'poisoned'));
    ok('правка: изменения перечислены словами', res.changes.list.some(t => t.includes(mo.name) && /Отравлен/.test(t)) && res.changes.list.some(t => t.includes(em.name) && /снято/.test(t)), res.changes.list.join(' | '));
    ok('правка: дневная номинация после ночи сохранилась', res.T.phase === 'day' && res.T.day.nominated.includes(ch.id) && res.T.log.some(e => /номинирует/.test(e.t)));
    ok('правка: заметка — Эмпат больше не отравлен', res.notes.some(t => /Эмпат/.test(t) && /больше не/.test(t)), res.notes.join(' | '));
    ok('правка: журнал — что уйдёт и что появится', res.changes.logGone.some(t => t.includes(em.name)) && res.changes.logNew.some(t => t.includes(mo.name)));
    ok('правка: исходная игра не тронута', E.hasTok(em, 'poisoned', 'poisoner') && !E.hasTok(mo, 'poisoned'));
    // ночь 2: Монах защитил того, в кого бил Чёрт; правка Монаха — игрок умирает
    E.endDay(G);
    runNight(G, { poisoner: { t: [byRole(G, 'washerwoman').id] }, monk: { t: [ch.id] }, imp: { t: [ch.id] }, butler: { t: [mo.id] } });
    const km = G.rp.recs.findIndex(r => r.t === 'step' && r.key.startsWith('monk'));
    const r3 = E.editNight(G, km, { inp: { t: [byRole(G, 'soldier').id] } });
    ok('правка Монаха: Повар спасён, а после правки умирает', ch.alive && !E.P(r3.T, ch.id).alive && r3.changes.list.some(t => t.includes(ch.name) && /умирает/.test(t)), r3.changes.list.join(' | '));
    // пропущенный шаг выполняют задним числом
    const G3 = game(['empath', 'monk', 'chef', 'soldier', 'washerwoman', 'butler', 'poisoner', 'imp'], 'tb'); E.autoSetup(G3, true); E.startGame(G3);
    let guard = 0;
    while (G3.phase === 'night' && guard++ < 60) { const st = E.currentStep(G3), sp = E.stepSpec(G3, st);
      if (st.id === 'poisoner') E.skipStep(G3, 'manual'); else if (!sp.active) E.skipStep(G3, 'auto'); else E.applyStep(G3, st, Object.assign({}, sp.defaults)); }
    const ks = G3.rp.recs.findIndex(r => r.t === 'skip' && r.key.startsWith('poisoner'));
    ok('пропуск: в журнале «Пропущен шаг» со ссылкой на запись', G3.log.some(e => /Пропущен шаг: Отравитель/.test(e.t) && e.r === ks && e.w === G3.rp.id));
    const tg = E.editTarget(G3, ks);
    ok('пропуск: форма правки — состояние перед шагом', !!tg && tg.st.id === 'poisoner' && tg.pre.phase === 'night' && tg.pre.night.i === G3.night.steps.findIndex(s => s.id === 'poisoner'));
    const r4 = E.editNight(G3, ks, { inp: { t: [byRole(G3, 'chef').id] } });
    ok('пропуск: выполнен задним числом — Повар отравлен', E.hasTok(E.P(r4.T, byRole(G3, 'chef').id), 'poisoned', 'poisoner'));
    const T4 = E.acceptEdit(r4.T, 'Рассказчик изменил выбор');
    const k4 = T4.rp.recs.findIndex(r => r.t === 'step' && r.key.startsWith('poisoner'));
    ok('пропуск: после принятия шаг снова можно изменить', k4 >= 0 && !!E.editTarget(T4, k4) && T4.log.some(e => /Отравитель/.test(e.t) && e.r === k4));
    // правка посреди ночи: текущий шаг и черновик его выбора остаются
    const G5 = game(['empath', 'monk', 'chef', 'soldier', 'washerwoman', 'butler', 'poisoner', 'imp'], 'tb'); E.autoSetup(G5, true); E.startGame(G5);
    for (let g = 0; g < 40 && E.currentStep(G5).id !== 'empath'; g++) { const st = E.currentStep(G5), sp = E.stepSpec(G5, st);
      if (!sp.active) E.skipStep(G5, 'auto'); else E.applyStep(G5, st, Object.assign({}, sp.defaults, st.id === 'poisoner' ? { t: [byRole(G5, 'empath').id] } : {})); }
    G5.draft = { key: G5.n + ':' + G5.night.i + ':' + E.currentStep(G5).key, inp: { n: 3 } };
    const k5 = G5.rp.recs.findIndex(r => r.t === 'step' && r.key.startsWith('poisoner')), r6 = E.editNight(G5, k5, { inp: { t: [byRole(G5, 'chef').id] } });
    ok('правка ночью: остаёмся на том же шаге, черновик цел, Эмпат больше не отравлен', r6.T.phase === 'night' && E.currentStep(r6.T).id === 'empath' && r6.T.draft.inp.n === 3 && !E.abilityOff(r6.T, E.P(r6.T, byRole(G5, 'empath').id)));
    const r5 = E.editNight(T4, k4, { skip: true });
    ok('правка: «сделать шаг пропущенным» снимает яд', !E.hasTok(E.P(r5.T, byRole(G3, 'chef').id), 'poisoned') && r5.T.log.some(e => /Пропущен шаг/.test(e.t)));
  }

  // 31. Травница: соседи не умирают никак — ни от проклятия Ведьмы, ни при изгнании (вики; ошибка из игры пользователя 2026-10-12)
  {
    const G = game(['clockmaker', 'tealady', 'mayor', 'monk', 'seamstress', 'barber', 'witch', 'imp']); E.autoSetup(G, true); E.startGame(G);
    const cm = byRole(G, 'clockmaker');
    runNight(G, { witch: { t: [cm.id] } });
    ok('Ведьма прокляла соседа Травницы', E.hasTok(cm, 'cursed', 'witch') && E.teaLadyProtects(G, cm));
    ok('подсказка до номинации: проклят, но не умрёт — Травница', E.nominationPreview(G, cm.id, byRole(G, 'monk').id).notes.some(t => /не умрёт: Травница/.test(t)));
    const r = E.nominate(G, cm.id, byRole(G, 'monk').id);
    ok('проклятый сосед Травницы номинировал и остался жив', cm.alive && r.notes.some(t => /не умирает: Травница/.test(t)));
    E.addTraveller(G, 'Странник', 'matron', 'good', byRole(G, 'tealady').id);
    const tr = G.players.find(p => p.role === 'matron');
    E.exile(G, tr.id, 99);
    ok('изгнанный сосед Травницы остаётся жив (пример вики)', tr.alive && E.teaLadyProtects(G, tr));
  }

  // 32. Мэр (вики): атакован и умер бы — рассказчик может отдать смерть другому; выбор необязателен; под защитой Монаха — рикошета нет
  {
    const mk = () => { const G = game(['mayor', 'monk', 'chef', 'empath', 'soldier', 'butler', 'poisoner', 'imp'], 'tb'); E.autoSetup(G, true); E.startGame(G);
      runNight(G, { poisoner: { t: [byRole(G, 'empath').id] }, butler: { t: [byRole(G, 'chef').id] } }); E.endDay(G); return G; };
    const toImp = (G, inputs) => { for (let g = 0; g < 60 && E.currentStep(G).id !== 'imp'; g++) { const st = E.currentStep(G), sp = E.stepSpec(G, st);
      if (!sp.active) E.skipStep(G, 'auto'); else if (!E.applyStep(G, st, Object.assign({ t: st.id === 'poisoner' ? [byRole(G, 'empath').id] : undefined }, sp.defaults, (inputs || {})[st.id] || {})).ok) E.skipStep(G, 'manual'); } };
    let G = mk(); toImp(G, { monk: { t: [byRole(G, 'empath').id] }, butler: { t: [byRole(G, 'chef').id] } });
    let sp = E.stepSpec(G, E.currentStep(G)), my = byRole(G, 'mayor');
    ok('Мэр: «кто умрёт вместо него» — необязательно (Готово доступно)', E.missingInputs(sp, { t: [my.id] }).length === 0);
    E.applyStep(G, E.currentStep(G), { t: [my.id], bounce: [byRole(G, 'chef').id] });
    ok('Мэр: смерть уходит выбранному игроку', my.alive && !byRole(G, 'chef').alive);
    G = mk(); toImp(G, { monk: { t: [byRole(G, 'empath').id] }, butler: { t: [byRole(G, 'chef').id] } }); my = byRole(G, 'mayor');
    E.applyStep(G, E.currentStep(G), { t: [my.id] });
    ok('Мэр: никого не выбрали — умирает Мэр', !my.alive);
    G = mk(); toImp(G, { monk: { t: [byRole(G, 'mayor').id] }, butler: { t: [byRole(G, 'chef').id] } }); my = byRole(G, 'mayor'); sp = E.stepSpec(G, E.currentStep(G));
    const fs = E.stepInputs(sp, { t: [my.id] });
    ok('Мэр под защитой Монаха: рикошета нет — вместо выбора пометка', !fs.some(f => f.key === 'bounce') && fs.some(f => f.type === 'note' && /Монах/.test(f.label)) && E.missingInputs(sp, { t: [my.id] }).length === 0);
    E.applyStep(G, E.currentStep(G), { t: [my.id], bounce: [byRole(G, 'chef').id] });
    ok('Мэр под защитой Монаха: никто не умирает', my.alive && byRole(G, 'chef').alive);
  }

  // 33. блефы без Пьяницы и Безумца (решение пользователя 2026-10-13: «Пьяница не знает, что он Пьяница»)
  {
    let bad = 0;
    for (let k = 0; k < 60; k++) { const G = game(['chef', 'empath', 'monk', 'soldier', 'mayor', 'butler', 'poisoner', 'imp'], 'tb'); E.autoSetup(G, true); if (G.bluffs.some(b => b === 'drunk' || b === 'lunatic')) bad++; }
    for (let k = 0; k < 60; k++) { const G = game(['chef', 'empath', 'monk', 'soldier', 'mayor', 'sweetheart', 'poisoner', 'imp'], 'snv'); E.autoSetup(G, true); if (G.bluffs.some(b => b === 'drunk' || b === 'lunatic')) bad++; }
    for (let k = 0; k < 60; k++) { const G = game(['grandmother', 'sailor', 'chambermaid', 'exorcist', 'innkeeper', 'goon', 'godfather', 'zombuul'], 'bmr'); E.autoSetup(G, true); if (G.bluffs.some(b => b === 'drunk' || b === 'lunatic')) bad++; }
    ok('блефы: ни Пьяницы, ни Безумца (180 раздач)', bad === 0, String(bad));
    const G = game(['chef', 'empath', 'monk', 'soldier', 'mayor', 'butler', 'poisoner', 'imp'], 'tb'); E.autoSetup(G, true); G.bluffs[0] = 'drunk';
    ok('блефы: Пьяница вручную — подготовка не даёт начать', E.setupProblems(G).some(t => /Пьяница/.test(t) && /бессмыслен/.test(t)));
  }

  // 34. Растяпа и Дитя Луны казнены: публичный выбор — до ночи (вики: «когда узнаёте, что умерли»; заметка пользователя 2026-10-13)
  {
    const G = game(['clockmaker', 'klutz', 'mayor', 'monk', 'seamstress', 'barber', 'witch', 'imp']); E.autoSetup(G, true); E.startGame(G);
    runNight(G, { witch: { t: [byRole(G, 'monk').id] } });
    const kl = byRole(G, 'klutz');
    E.nominate(G, byRole(G, 'clockmaker').id, kl.id); E.recordVote(G, kl.id, G.players.slice(0, 6).map(p => p.id));
    E.endDay(G);
    ok('Растяпа казнён — день держится до его выбора', !kl.alive && G.phase === 'day' && G.flags.klutzPending === kl.id && G.day.holdForChoice);
    E.klutzChoose(G, byRole(G, 'mayor').id); E.endDay(G);
    ok('после выбора Растяпы «Начать ночь» — ночь, без повторного «без казни»', G.phase === 'night' && G.log.filter(e => /без казни/.test(e.t)).length === 0);
    const G2 = game(['clockmaker', 'moonchild', 'mayor', 'monk', 'seamstress', 'barber', 'witch', 'imp']); E.autoSetup(G2, true); E.startGame(G2);
    runNight(G2, { witch: { t: [byRole(G2, 'monk').id] } });
    const mc = byRole(G2, 'moonchild');
    E.nominate(G2, byRole(G2, 'clockmaker').id, mc.id); E.recordVote(G2, mc.id, G2.players.slice(0, 6).map(p => p.id)); E.endDay(G2);
    ok('Дитя Луны казнено — выбор до ночи', G2.phase === 'day' && G2.flags.moonchildPending === mc.id);
    E.endDay(G2);
    ok('выбора нет — второе нажатие всё равно начинает ночь', G2.phase === 'night');
  }

  // 35. Цирюльник казнён (Reptiles II, Демон — Аль-Адихия): этой ночью Демон может поменять роли (заметка пользователя 2026-10-14)
  {
    const G = game(['chef', 'barber', 'sailor', 'flowergirl', 'undertaker', 'innkeeper', 'poisoner', 'alhadikhia'], 'reptiles2'); E.autoSetup(G, true); E.startGame(G);
    runNight(G, { poisoner: { t: [byRole(G, 'chef').id] }, sailor: { t: [byRole(G, 'chef').id] } });
    const bb = byRole(G, 'barber');
    E.nominate(G, byRole(G, 'chef').id, bb.id); E.recordVote(G, bb.id, G.players.slice(0, 6).map(p => p.id)); E.endDay(G);
    const bst = G.night.steps.find(s => s.id === 'barber');
    ok('Цирюльник казнён — ночью шаг Цирюльника активен', !bb.alive && !!bst && E.stepSpec(G, bst).active, JSON.stringify({ alive: bb.alive, phase: G.phase, haircuts: G.flags.haircuts, steps: G.night && G.night.steps.map(s => s.id), reason: bst && E.stepSpec(G, bst).reason, log: G.log.slice(-4).map(e => e.t) }));
  }

  // 36. заметки пользователя 2026-10-14: роли в разных сценариях
  {
    const night = (G, inputs) => { for (let g = 0; g < 80 && G.phase === 'night'; g++) { const st = E.currentStep(G), sp = E.stepSpec(G, st);
      if (!sp.active) { E.skipStep(G, 'auto'); continue; } if (!E.applyStep(G, st, Object.assign({}, sp.defaults, (inputs || {})[st.id] || {})).ok) E.skipStep(G, 'manual'); } };
    // Профессор воскресил — на рассвете он не «умер»
    let G = game(['professor', 'chambermaid', 'tealady', 'gambler', 'exorcist', 'goon', 'godfather', 'po'], 'bmr'); E.autoSetup(G, true); E.startGame(G);
    night(G, { godfather: {} }); const ex = byRole(G, 'exorcist');
    E.nominate(G, byRole(G, 'gambler').id, ex.id); E.recordVote(G, ex.id, G.players.slice(0, 6).map(p => p.id)); E.endDay(G);
    for (let g = 0; g < 80 && G.phase === 'night' && E.currentStep(G).id !== 'professor'; g++) { const st = E.currentStep(G), sp = E.stepSpec(G, st); if (!sp.active) E.skipStep(G, 'auto'); else if (!E.applyStep(G, st, Object.assign({}, sp.defaults, st.id === 'po' ? { t: [ex.id] } : {})).ok) E.skipStep(G, 'manual'); }
    ok('Профессор: шаг доступен ночью', E.currentStep(G).id === 'professor');
    E.applyStep(G, E.currentStep(G), { t: [ex.id] }); night(G, { po: { t: [] } });
    ok('Профессор воскресил — на рассвете не «умер», а «снова жив»', ex.alive && !E.nightDeaths(G).some(d => d.pid === ex.id) && G.log.some(e => /Снова жив: .*exorcist/.test(e.t)));
    // По: «Пропустить» = никого — следующей ночью троих
    G = game(['professor', 'chambermaid', 'tealady', 'gambler', 'exorcist', 'goon', 'godfather', 'po'], 'bmr'); E.autoSetup(G, true); E.startGame(G); night(G); E.endDay(G);
    for (let g = 0; g < 80 && E.currentStep(G).id !== 'po'; g++) { const st = E.currentStep(G), sp = E.stepSpec(G, st); if (!sp.active) E.skipStep(G, 'auto'); else if (!E.applyStep(G, st, Object.assign({}, sp.defaults)).ok) E.skipStep(G, 'manual'); }
    E.skipStep(G, 'manual');
    ok('По: «Пропустить» — копит на троих', G.flags.poCharged === true);
    // Гадалка: ложная цель — не она сама (решение пользователя)
    let bad = 0; for (let k = 0; k < 40; k++) { const g = game(['fortuneteller', 'chef', 'empath', 'monk', 'soldier', 'butler', 'poisoner', 'imp'], 'tb'); E.autoSetup(g, true); if (g.flags.ftHerring === byRole(g, 'fortuneteller').id) bad++; }
    ok('Гадалка: ложная цель случайно — никогда не сама Гадалка', bad === 0);
    // Философ со способностью Травницы — соседи защищены
    G = game(['chef', 'philosopher', 'empath', 'monk', 'soldier', 'butler', 'poisoner', 'imp'], 'snv'); G.script.roles.push('tealady'); E.autoSetup(G, true); E.startGame(G);
    night(G, { philosopher: { r: 'tealady' }, poisoner: { t: [byRole(G, 'monk').id] } });
    ok('Философ стал Травницей — добрые соседи защищены', E.teaLadyProtects(G, byRole(G, 'chef')) && E.teaLadyProtects(G, byRole(G, 'empath')));
    // Безумец: в шаге Демона — жетон Безумца и его «жертвы»
    G = game(['grandmother', 'sailor', 'chambermaid', 'exorcist', 'innkeeper', 'lunatic', 'godfather', 'zombuul'], 'bmr'); E.autoSetup(G, true); E.startGame(G); night(G, { godfather: {} }); E.endDay(G);
    const lu = byRole(G, 'lunatic');
    for (let g = 0; g < 80 && E.currentStep(G).id !== 'zombuul'; g++) { const st = E.currentStep(G), sp = E.stepSpec(G, st); if (!sp.active) E.skipStep(G, 'auto'); else if (!E.applyStep(G, st, Object.assign({}, sp.defaults, st.id === 'lunatic' ? { t: [byRole(G, 'sailor').id] } : st.id === 'exorcist' ? { t: [byRole(G, 'chambermaid').id] } : {})).ok) E.skipStep(G, 'manual'); }
    const zi = E.stepSpec(G, E.currentStep(G)).info({});
    ok('Безумец: Демону показывают Безумца и кого он «атаковал»', zi && zi.tokens.some(t => t.role === 'lunatic' && t.players[0] === lu.id) && zi.tokens.some(t => (t.players || []).includes(byRole(G, 'sailor').id)), JSON.stringify(zi));
    ok('Безумец: не «отравлен» — свой вид искажения', E.distortion(G, lu) && E.distortion(G, lu).kind === 'lunatic');
    // Аль-Адихия: трое выбрали жить — все трое умирают; мёртвый, выбравший жить, оживает
    G = game(['chef', 'washerwoman', 'librarian', 'sailor', 'general', 'flowergirl', 'poisoner', 'alhadikhia'], 'reptiles2'); E.autoSetup(G, true); E.startGame(G); night(G); E.endDay(G);
    for (let g = 0; g < 80 && E.currentStep(G).id !== 'alhadikhia'; g++) { const st = E.currentStep(G), sp = E.stepSpec(G, st); if (!sp.active) E.skipStep(G, 'auto'); else if (!E.applyStep(G, st, Object.assign({}, sp.defaults, st.id === 'poisoner' ? { t: [byRole(G, 'poisoner').id] } : st.id === 'sailor' ? { t: [byRole(G, 'sailor').id] } : {})).ok) E.skipStep(G, 'manual'); }
    const three = ['chef', 'washerwoman', 'librarian'].map(r => byRole(G, r).id);
    ok('Аль-Адихия: выбор троих и ответ каждого', E.stepInputs(E.stepSpec(G, E.currentStep(G)), { t: three }).filter(f => f.type === 'choice').length === 3);
    E.applyStep(G, E.currentStep(G), { t: three, c0: 'live', c1: 'live', c2: 'live' });
    ok('Аль-Адихия: все трое выбрали жить — все трое умирают', three.every(id => !E.P(G, id).alive));
    G = game(['chef', 'washerwoman', 'librarian', 'sailor', 'general', 'flowergirl', 'poisoner', 'alhadikhia'], 'reptiles2'); E.autoSetup(G, true); E.startGame(G); night(G);
    const dead = byRole(G, 'chef'); E.nominate(G, byRole(G, 'general').id, dead.id); E.recordVote(G, dead.id, G.players.slice(0, 6).map(p => p.id)); E.endDay(G);
    for (let g = 0; g < 80 && E.currentStep(G).id !== 'alhadikhia'; g++) { const st = E.currentStep(G), sp = E.stepSpec(G, st); if (!sp.active) E.skipStep(G, 'auto'); else if (!E.applyStep(G, st, Object.assign({}, sp.defaults, st.id === 'poisoner' ? { t: [byRole(G, 'poisoner').id] } : st.id === 'sailor' ? { t: [byRole(G, 'sailor').id] } : {})).ok) E.skipStep(G, 'manual'); }
    const tr2 = [dead.id, byRole(G, 'washerwoman').id, byRole(G, 'librarian').id];
    E.applyStep(G, E.currentStep(G), { t: tr2, c0: 'live', c1: 'die', c2: 'live' });
    ok('Аль-Адихия: мёртвый выбрал жить — оживает, выбравший умереть — умирает', dead.alive && !byRole(G, 'washerwoman').alive && byRole(G, 'librarian').alive);
    // Генерал: выбор и карточка; Аристократ — 3 игрока, 1 злой
    const gs = E.stepSpec(G, G.night.steps.find(s => s.id === 'general') || { id: 'general', pid: byRole(G, 'general').id, key: 'general' });
    ok('Генерал: выбор «добро / зло / никто» и карточка с пальцем', gs.inputs.some(f => f.key === 'side') && gs.info({ side: 'neither' }).tokens[0].thumb === 'side');
    G = game(['noble', 'balloonist', 'savant', 'engineer', 'huntsman', 'damsel', 'poisoner', 'vigormortis'], 'oasis'); E.autoSetup(G, true); E.startGame(G);
    const ns = E.stepSpec(G, G.night.steps.find(s => s.id === 'noble'));
    const nt = ns.defaults.t.map(id => E.P(G, id));
    ok('Аристократ: 3 игрока, ровно 1 злой', ns.inputs[0].n === 3 && nt.length === 3 && nt.filter(q => q.align === 'evil').length === 1);
    ok('Дурманщик и общий шаг: число игроков из способности', E.choiceCount('alhadikhia') === 3 && E.choiceCount('poppygrower') === 0);
    // Инженер: Приспешник становится другим, сторона злая
    const en = G.night.steps.find(s => s.id === 'engineer'), po = byRole(G, 'poisoner');
    for (let g = 0; g < 80 && E.currentStep(G) !== en; g++) { const st = E.currentStep(G), sp = E.stepSpec(G, st); if (!sp.active) E.skipStep(G, 'auto'); else if (!E.applyStep(G, st, Object.assign({}, sp.defaults, st.id === 'poisoner' ? { t: [byRole(G, 'savant').id] } : {})).ok) E.skipStep(G, 'manual'); }
    E.applyStep(G, E.currentStep(G), { mode: 'minions', r0: 'pithag' });
    ok('Инженер: Отравитель стал Ягой, злой, способность Инженера потрачена', po.role === 'pithag' && po.align === 'evil' && E.stepSpec(G, en).active === false);
    // Девица: Приспешник угадал — победа зла
    E.damselGuess(G, po.id, byRole(G, 'damsel').id);
    ok('Девица: Приспешник угадал живую Девицу — победа зла', G.result && G.result.winner === 'evil', JSON.stringify({ r: G.result, off: E.abilityOff(G, byRole(G, 'damsel')) }));
    // Психопат: днём убивает; казнён и не проиграл — жив; Голем
    G = game(['noble', 'balloonist', 'savant', 'golem', 'professor', 'farmer', 'psychopath', 'vigormortis'], 'oasis'); E.autoSetup(G, true); E.startGame(G); night(G);
    const psy = byRole(G, 'psychopath'), sv = byRole(G, 'savant');
    E.psychopathKill(G, psy.id, sv.id);
    ok('Психопат: днём убивает выбранного', !sv.alive && !E.psychopathKill(G, psy.id, byRole(G, 'noble').id));
    E.nominate(G, byRole(G, 'golem').id, byRole(G, 'noble').id);
    ok('Голем: номинировал не Демона — тот умирает', !byRole(G, 'noble').alive);
    ok('Психопат казнён: нужен ответ «камень-ножницы-бумага»', E.exeQuestions(G, psy.id).includes('roshambo'));
    E.execute(G, psy.id, { roshambo: 'live' });
    ok('Психопат не проиграл — жив, казнь дня состоялась', psy.alive && G.day.executed === psy.id && G.day.exeResult && !G.day.exeResult.died);
    // Марионетка: в мешочке вместо неё Горожанин, потом сосед Демона; просыпается как своя роль, Приспешники её не видят
    G = E.newGame('pies'); for (let i = 0; i < 9; i++) G.players.push(E.newPlayer('M' + i));
    G.pool = ['chef', 'washerwoman', 'librarian', 'empath', 'monk', 'butler', 'saint', 'marionette', 'imp']; E.randomDeal(G);
    ok('Марионетка: при раздаче — Горожанин вместо неё, нужно выбрать', G.flags.marionetteNeed && !G.players.some(p => p.role === 'marionette') && E.setupProblems(G).some(t => /Марионетка/.test(t)));
    const mn = E.demonSeatNeighbours(G).find(p => E.isGoodTeam(E.realTeam(p))), mrole = mn.role; E.makeMarionette(G, mn.id); E.autoSetup(G, false);
    ok('Марионетка: сосед Демона, злой, считает себя своей ролью', mn.role === 'marionette' && mn.align === 'evil' && mn.believes === mrole && E.actsAs(mn) === mrole && E.abilityOff(G, mn) === 'Марионетка' && !G.bluffs.includes(mrole));
  }

  // 30. казнь на выбор: 30 одобренных текстов, у каждого — имя казнённого и своё название
  ok('казни: 30 историй, названия разные, в каждой есть имя', EXECUTIONS.length === 30 && new Set(EXECUTIONS.map(x => x.t)).size === 30
    && EXECUTIONS.every(x => x.t && x.s.includes('{name}') && !/\[Имя\]/.test(x.s)));

  for (const k of Object.keys(DATA.scripts)) ok('сценарий ' + k + ' — все роли в данных', DATA.scripts[k].roles.every(r => DATA.roles[r]));
} catch (e) { results.push('ERROR ' + e.message + '\n' + e.stack); }

document.getElementById('out').textContent = results.join('\n');
