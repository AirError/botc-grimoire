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

  // 18г. Смена ролей (проверка по вики, 2026-10-11): Яга, Цирюльник, Заклинатель змей + Философ, Фань Гу, Философ, Ловчий и Девица
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
  // Заклинатель змей: яд прежнего Демона — навсегда; Яга превращает его в Демона — тот по-прежнему отравлен (вики; заметка 2026-10-17)
  S = game(['clockmaker', 'dreamer', 'snakecharmer', 'mathematician', 'flowergirl', 'sweetheart', 'pithag', 'vigormortis'], 'snv');
  S.players.forEach(p => { if (['pithag', 'vigormortis'].includes(p.role)) p.align = 'evil'; }); E.autoSetup(S, true); E.startGame(S);
  runNight(S, {}); E.endDay(S);
  const scc = byRole(S, 'snakecharmer'), vgm = byRole(S, 'vigormortis');
  st = toStep(S, 'snakecharmer'); E.applyStep(S, st, { t: [vgm.id] });
  st = toStep(S, 'pithag'); E.applyStep(S, st, { t: [vgm.id], r: 'fanggu', kill: [] });
  // Вигормортис: убитый им Приспешник сохраняет способность, пока Вигормортис жив; казнён — мёртвая Яга не просыпается, яд соседа снят
  // (вики; заметка пользователя 2026-10-17)
  {
    const V = game(['clockmaker', 'dreamer', 'oracle', 'savant', 'cerenovus', 'pithag', 'vigormortis', 'sweetheart'], 'snv');
    V.players.forEach(p => { if (['cerenovus', 'pithag', 'vigormortis'].includes(p.role)) p.align = 'evil'; }); E.autoSetup(V, true); E.startGame(V);
    runNight(V, {}); E.endDay(V);
    const hag = byRole(V, 'pithag'), vig = byRole(V, 'vigormortis'), drm = byRole(V, 'dreamer'), sav = byRole(V, 'savant'), clk = byRole(V, 'clockmaker');
    let s2 = toStep(V, 'pithag'); E.applyStep(V, s2, { t: [drm.id], r: 'nodashii', kill: [] });
    s2 = toStep(V, 'vigormortis', { nodashii: { t: [clk.id] } }); E.applyStep(V, s2, { t: [hag.id], nb: [sav.id] });
    ok('Вигормортис: убитая Яга сохраняет способность, сосед-Горожанин отравлен', !hag.alive && E.hasTok(hag, 'hasability') && E.hasTok(sav, 'poisoned', 'vigormortis'));
    E.endNight(V); E.execute(V, vig.id); E.endDay(V);
    const hs = V.phase === 'night' && V.night.steps.find(s => s.id === 'pithag');
    ok('Вигормортис казнён: мёртвая Яга без способности (не просыпается), яд соседа снят',
      V.phase === 'night' && !E.hasTok(hag, 'hasability') && !E.hasTok(sav, 'poisoned', 'vigormortis') && (!hs || !E.stepSpec(V, hs).active));
  }
  ok('Заклинатель: прежний Демон отравлен навсегда — стал Фань Гу (Яга) и по-прежнему отравлен', scc.role === 'vigormortis' && vgm.role === 'fanggu' && !!E.abilityOff(S, vgm)
    && /отравлен/.test((E.pithagAdvice(S) || { lines: [] }).lines.join(' ')));
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
  // Ловчий и Девица: Приспешники узнают Девицу; Ловчий превращает Девицу в Горожанина; догадка Приспешника — одна на всех
  const hd = ['huntsman', 'damsel', 'chef', 'empath', 'washerwoman', 'monk', 'poisoner', 'imp'];
  S = game(hd, 'tb'); S.script.roles = S.script.roles.concat('huntsman', 'damsel');
  S.players.forEach(p => { if (['poisoner', 'imp'].includes(p.role)) p.align = 'evil'; }); E.autoSetup(S, true); E.startGame(S);
  const dm = byRole(S, 'damsel'), hu = byRole(S, 'huntsman');
  const dst = S.night.steps.find(s => s.id === 'damsel'), dsp = E.stepSpec(S, dst), dinfo = dsp.info({});
  ok('Девица: в 1-ю ночь Приспешникам показывают жетон Девицы', dsp.active && dinfo.tokens.some(t => t.role === 'damsel'));
  runNight(S, { huntsman: { t: ids(S, 'chef') }, poisoner: { t: ids(S, 'chef') } });
  ok('Ловчий: выбрал не Девицу — ничего, способность потрачена', dm.role === 'damsel' && !E.stepSpec(S, { id: 'huntsman', pid: hu.id }).active);
  S = game(hd, 'tb'); S.script.roles = S.script.roles.concat('huntsman', 'damsel');
  S.players.forEach(p => { if (['poisoner', 'imp'].includes(p.role)) p.align = 'evil'; }); E.autoSetup(S, true); E.startGame(S);
  const dm2 = byRole(S, 'damsel');
  runNight(S, { huntsman: { t: [dm2.id], r: 'slayer' }, poisoner: { t: ids(S, 'chef') } });
  ok('Ловчий нашёл Девицу: она стала Горожанином не из игры (Истребитель), сторона добрая', dm2.role === 'slayer' && dm2.align === 'good');
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
    ok('Сновидец: роли можно выбрать самому', inf.tokens.map(t => t.role).sort().join() === 'oracle,witch');
    // роли по умолчанию (заметка пользователя 2026-10-17): своя сторона — настоящая, ложная добрая — нет в игре; «Нет в игре» — сверху
    let dBad = [];
    for (let k = 0; k < 30; k++) {
      const G = game(['clockmaker', 'dreamer', 'oracle', 'seamstress', 'mathematician', 'sweetheart', 'eviltwin', 'nodashii'], 'snv'); // Сновидец не сосед Но Даши — трезв
      G.players.forEach(p => { if (['eviltwin', 'nodashii'].includes(p.role)) p.align = 'evil'; }); E.autoSetup(G, true); E.startGame(G);
      const sp = E.stepSpec(G, G.night.steps.find(s => s.id === 'dreamer')), inG = r => G.players.some(p => p.role === r);
      const fd = sp.more({ t: ids(G, 'nodashii') }), fg = sp.more({ t: ids(G, 'oracle') });
      if (fd[1].def !== 'nodashii' || inG(fd[0].def) || G.bluffs.includes(fd[0].def) || fd[0].groups[0].label !== 'Нет в игре' || fd[0].groups[0].roles.some(inG)) dBad.push('Демон: ' + fd[0].def + '/' + fd[1].def);
      if (fg[0].def !== 'oracle' || fg[1].def !== 'eviltwin') dBad.push('добрый: ' + fg[0].def + '/' + fg[1].def);
      // близнецы (заметка пользователя 2026-10-17; вики): Злому Близнецу — роль доброго близнеца, доброму близнецу — Злой Близнец
      const gt = E.P(G, G.flags.goodTwin), fe = sp.more({ t: ids(G, 'eviltwin') });
      if (gt && gt.role !== 'dreamer') { const fgt = sp.more({ t: [gt.id] });
        if (fe[0].def !== gt.role || fe[1].def !== 'eviltwin' || !/доброго близнеца/.test(fe[0].label)) dBad.push('Злой Близнец: ' + fe[0].def + ' вместо ' + gt.role);
        if (fgt[0].def !== gt.role || fgt[1].def !== 'eviltwin') dBad.push('добрый близнец: ' + fgt[0].def + '/' + fgt[1].def); }
    }
    ok('Сновидец: по умолчанию настоящая роль и ложная (нет в игре; близнецам — роль второго близнеца); «Нет в игре» — первой группой', !dBad.length, dBad.slice(0, 3).join(' | '));
    // Безумец и Демон: Безумцу — Демон, которым он себя считает; Демону — Безумец
    const L = game(['clockmaker', 'dreamer', 'oracle', 'seamstress', 'mathematician', 'lunatic', 'witch', 'vigormortis'], 'snv'); L.script.roles = L.script.roles.concat('lunatic');
    L.players.forEach(p => { if (['witch', 'vigormortis'].includes(p.role)) p.align = 'evil'; }); E.autoSetup(L, true); E.startGame(L);
    const lsp = E.stepSpec(L, L.night.steps.find(s => s.id === 'dreamer')), lu = byRole(L, 'lunatic');
    const onLu = lsp.more({ t: [lu.id] }), onDe = lsp.more({ t: ids(L, 'vigormortis') });
    ok('Сновидец: Безумцу — Демон, которым он себя считает; Демону — Безумец', onLu[0].def === 'lunatic' && onLu[1].def === lu.believes && onDe[0].def === 'lunatic' && onDe[1].def === 'vigormortis',
      [onLu[0].def, onLu[1].def, lu.believes, onDe[0].def].join(' / '));
    // обмен ролями (как после Заклинателя змей): злой Часовщик и добрый Вигормортис — ложной показывается роль «напарника»
    const W = game(['clockmaker', 'dreamer', 'oracle', 'seamstress', 'mathematician', 'sweetheart', 'witch', 'vigormortis'], 'snv');
    E.autoSetup(W, true); E.startGame(W); W.players.forEach(p => { p.align = ['witch', 'clockmaker'].includes(p.role) ? 'evil' : 'good'; }); // стороны после обмена
    const wsp = E.stepSpec(W, W.night.steps.find(s => s.id === 'dreamer')), onCm = wsp.more({ t: ids(W, 'clockmaker') }), onVg = wsp.more({ t: ids(W, 'vigormortis') });
    ok('Сновидец: после обмена ролями ложная — роль «напарника» по обмену', onCm[0].def === 'clockmaker' && onCm[1].def === 'vigormortis' && onVg[0].def === 'clockmaker' && onVg[1].def === 'vigormortis',
      [onCm[0].def, onCm[1].def, onVg[0].def, onVg[1].def].join(' / ')); }
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
  // 25. Сказочник Кукольник — без своего шага: «ночь без нападения» в шаге Демона (заметка пользователя 2026-10-20)
  S = game(['clockmaker', 'grandmother', 'fortuneteller', 'monk', 'tealady', 'imp', 'witch', 'recluse']);
  S.fabled = ['toymaker']; E.autoSetup(S, true); E.startGame(S); E.endNight(S); E.endDay(S);
  ok('Сказочник Кукольник: своего шага нет, выбор — в шаге Демона', !S.night.steps.some(s => s.fabled && s.id === 'toymaker') && E.stepSpec(S, S.night.steps.find(s => s.id === 'imp')).inputs[0].key === 'toy');

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
  // сразу после заката (и шага «Странник узнаёт сторону»: способность Ученика зависит от стороны)
  const apSteps = S.night.steps.filter(s => !s.trav);
  ok('Ученик, вошедший позже, просыпается после заката', apSteps[1] && apSteps[1].id === 'apprentice' && S.night.steps.findIndex(s => s.trav) < S.night.steps.findIndex(s => s.id === 'apprentice'), S.night.steps.map(s => s.key).join(','));
  runNight(S, { apprentice: { r: 'monk' }, imp: { t: ids(S, 'chef') }, monk: { t: ids(S, 'washerwoman') }, poisoner: { t: ids(S, 'chef') } });
  ok('Ученик получил способность Монаха и действует в ту же ночь', ap.gained === 'monk' && S.log.some(e => e.t.startsWith(`Монах (${ap.name})`)));
  S = tbGame([['Бар', 'barista']]); E.startGame(S);
  runNight(S, { barista: { t: ids(S, 'chef'), mode: 'sober' }, poisoner: { t: ids(S, 'chef') } });
  ok('Бариста: отравленный, но «трезв и здоров» — способность работает', E.hasTok(byRole(S, 'chef'), 'poisoned', 'poisoner') && !E.abilityOff(S, byRole(S, 'chef')));
  // Сказочники: Кукольник, Фаталист, Скрипач, Герцогиня
  S = game(['washerwoman', 'librarian', 'chef', 'empath', 'poisoner', 'imp'], 'tb'); S.fabled = ['toymaker']; E.autoSetup(S, true); E.startGame(S);
  ok('Кукольник: при 6 игроках злые знакомятся', S.night.steps.some(s => s.id === 'minioninfo') && S.night.steps.some(s => s.id === 'demoninfo'));
  runNight(S, { poisoner: { t: ids(S, 'chef') } }); E.endDay(S);
  runNight(S, { imp: { toy: 'skip' }, poisoner: { t: ids(S, 'chef') } });
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
  // Демону «ЭТОТ ИГРОК» Безумец — на шаге Демона, а не Безумца (заметка пользователя 2026-10-15)
  ok('Безумцу: «приспешники» и «блефы»; Демону — «ЭТОТ ИГРОК» Безумец на шаге Демона',
    cLu.some(t => t.caption === 'ЭТО ВАШИ ПРИСПЕШНИКИ' && t.players.length === 1) && cLu.filter(t => t.caption === 'ЭТИХ РОЛЕЙ В ИГРЕ НЕТ').length === 3
    && !cLu.some(t => t.role === 'lunatic') && cDi.some(t => t.caption === 'ЭТОТ ИГРОК' && t.role === 'lunatic' && t.players[0] === byRole(S, 'lunatic').id), JSON.stringify(cLu));

  S = game(['clockmaker', 'grandmother', 'fortuneteller', 'monk', 'tealady', 'imp', 'witch', 'recluse']); E.autoSetup(S, true); E.startGame(S);
  const ftSt = S.night.steps.find(s => s.id === 'fortuneteller'), ftInfo = E.stepSpec(S, ftSt).info({ t: ids(S, 'monk', 'imp') });
  ok('ответ «ДА» Гадалки можно показать на весь экран', ftInfo.tokens && ftInfo.tokens[0].text === 'ДА', JSON.stringify(ftInfo.tokens));

  S = game(['clockmaker', 'dreamer', 'seamstress', 'mathematician', 'snakecharmer', 'mutant', 'cerenovus', 'fanggu'], 'snv'); E.autoSetup(S, true); E.startGame(S);
  const ceSt = S.night.steps.find(s => s.id === 'cerenovus'), ceInfo = E.stepSpec(S, ceSt).info({ t: ids(S, 'clockmaker'), r: 'savant' });
  ok('Цереновус: роль безумия на том же экране, что и его жетон', ceInfo.tokens.length === 2 && ceInfo.tokens[1].join && ceInfo.tokens[1].role === 'savant', JSON.stringify(ceInfo.tokens));

  // 33. сценарии сообщества: раздача, подготовка и две ночи без ошибок; Сказочники сценария — в игре
  const commErr = [];
  for (const key of ['reptiles2', 'oasis', 'pies', 'uncertain', 'blindhunt', 'blindhunt', 'blindhunt', 'blindhunt']) for (const n of [5, 7, 9, 11, 13, 15]) {
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
  ok('жребий: роли на экране рассказчика сразу скрыты «шторкой»', S.draw.hidden === true);
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
  // роли лежат в ячейках: какую ячейку выбрал — ту роль и получил (заметка пользователя 2026-10-15); открываем с конца
  S = E.newGame('tb'); for (let i = 0; i < 8; i++) S.players.push(E.newPlayer('C' + i)); S.pool = POOL8.slice();
  E.drawStart(S);
  const hidOk = S.draw.cells.map(c => c.hid).filter(Boolean).sort().join() === POOL8.slice().sort().join();
  let cellOk = true;
  for (let g = 0; S.draw.turn && g < 30; g++) {
    let k = S.draw.cells.length - 1; while (S.draw.cells[k].pid) k--;
    const want = S.draw.cells[k].hid, who = E.P(S, S.draw.turn); E.drawOpen(S, k); if (who.role !== want) cellOk = false; E.drawClose(S);
  }
  ok('жребий: роли разложены по ячейкам — выбранная ячейка решает роль', hidOk && cellOk && S.draw.finished);
  // назначенному — своя роль из любой ячейки; жетон из его ячейки переезжает (роли не теряются и не дублируются)
  S = E.newGame('tb'); for (let i = 0; i < 8; i++) S.players.push(E.newPlayer('D' + i)); S.pool = POOL8.slice();
  S.assign = { [S.players[0].id]: { role: 'imp' } }; E.drawStart(S);
  const kNot = S.draw.cells.findIndex(c => c.hid !== 'imp'), wasHid = S.draw.cells[kNot].hid;
  E.drawOpen(S, kNot);
  const leftHid = S.draw.cells.filter(c => !c.pid).map(c => c.hid).filter(Boolean).sort().join();
  ok('жребий: назначенному — своя роль из любой ячейки, жетон его ячейки переезжает', S.players[0].role === 'imp' && leftHid === S.draw.bag.slice().sort().join() && S.draw.bag.includes(wasHid), leftHid);
  // роль выдана до стены: ячейка «пустая», её жетон переезжает в пустую ячейку
  S = game(['washerwoman', 'librarian', 'investigator', 'chef', 'empath', 'monk', 'poisoner', 'imp'], 'tb'); for (const p of S.players.slice(1)) p.role = null;
  E.drawStart(S); const kH = S.draw.cells.findIndex(c => c.hid);
  E.drawOpen(S, kH); // первый в очереди — с ролью до стены
  ok('жребий: роль до стены — жетон ячейки не пропадает', S.players[0].role === 'washerwoman' && S.draw.cells.filter(c => !c.pid).map(c => c.hid).filter(Boolean).sort().join() === S.draw.bag.slice().sort().join());
  // набор ролей на игру (S.pool) — раздача берёт только его
  S = E.newGame('tb'); for (let i = 0; i < 7; i++) S.players.push(E.newPlayer('P' + i));
  S.pool = ['chef', 'empath', 'monk', 'slayer', 'soldier', 'poisoner', 'imp']; E.randomDeal(S);
  ok('раздача из выбранного набора ролей', S.players.map(p => p.role).sort().join() === S.pool.slice().sort().join());
  // The Midnight Oasis: случайная раздача по таблице; Ловчий — с Девицей; Атеист случайно не попадает
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

  // 32. заметки пользователя 2026-10-15
  {
    // Пьяница в «Подготовке»: выбранный Горожанин становится Пьяницей, прежний Пьяница — ролью, которой себя считал
    let G = game(['washerwoman', 'chef', 'fortuneteller', 'monk', 'empath', 'drunk', 'scarletwoman', 'imp'], 'tb'); E.autoSetup(G, true);
    const oldDr = byRole(G, 'drunk'), oldBel = oldDr.believes, ft = byRole(G, 'fortuneteller');
    E.makeDrunk(G, ft.id);
    ok('Пьяница: Гадалка стала Пьяницей-Гадалкой, прежний Пьяница — своей ролью, раскладка цела', ft.role === 'drunk' && ft.believes === 'fortuneteller' && oldDr.role === oldBel && E.setupProblems(G).length === 0, E.setupProblems(G).join('; '));
    G = game(['washerwoman', 'chef', 'fortuneteller', 'monk', 'empath', 'slayer', 'scarletwoman', 'imp'], 'tb'); E.autoSetup(G, true);
    const ch = byRole(G, 'chef'); E.setupRole(G, ch, 'drunk');
    ok('Пьяница из списка ролей: считает себя прежней ролью', ch.role === 'drunk' && ch.believes === 'chef');
    // смена роли рассказчиком в 1-ю ночь: новая роль просыпается
    G = game(['washerwoman', 'chef', 'fortuneteller', 'monk', 'empath', 'drunk', 'scarletwoman', 'imp'], 'tb'); E.autoSetup(G, true); E.startGame(G);
    E.storytellerRole(G, byRole(G, 'scarletwoman'), 'poisoner');
    ok('смена роли в 1-ю ночь: Отравитель проснётся, сторона прежняя', G.night.steps.some(s => s.id === 'poisoner') && byRole(G, 'poisoner').align === 'evil');
    // Сплетница: заявления не было — шаг не просыпается; было и верное — выбранный умирает
    G = game(['gossip', 'grandmother', 'sailor', 'chambermaid', 'exorcist', 'fool', 'assassin', 'po'], 'bmr'); E.autoSetup(G, true); E.startGame(G); runNight(G);
    const gsp = byRole(G, 'gossip');
    ok('Сплетница: в конце дня спросить о заявлении', E.gossipPending(G).includes(gsp));
    E.setGossip(G, gsp.id, false); E.endDay(G);
    let gst = G.night.steps.find(s => s.id === 'gossip');
    ok('Сплетница: заявления не было — шаг не просыпается', gst && !E.stepSpec(G, gst).active);
    G = game(['gossip', 'grandmother', 'sailor', 'chambermaid', 'exorcist', 'fool', 'assassin', 'po'], 'bmr'); E.autoSetup(G, true); E.startGame(G); runNight(G);
    E.setGossip(G, byRole(G, 'gossip').id, true, 'Демон в шляпе'); E.endDay(G);
    for (let g = 0; g < 40 && E.currentStep(G).id !== 'gossip'; g++) E.skipStep(G, 'manual');
    gst = E.currentStep(G); const gspec = E.stepSpec(G, gst), cm = byRole(G, 'chambermaid');
    ok('Сплетница: было заявление — «верно?», и только тогда — кто умирает', gspec.active && !E.stepInputs(gspec, { true: 'no' }).some(f => f.key === 't') && E.stepInputs(gspec, { true: 'yes' }).some(f => f.key === 't'));
    E.applyStep(G, gst, { true: 'yes', t: [cm.id] });
    ok('Сплетница: заявление верное — выбранный умирает', !cm.alive);
    // Безумец: Демону его показывают на шаге Демона; при 5–6 игроках — отдельный шаг сразу после Безумца
    G = game(['gossip', 'sailor', 'chambermaid', 'lunatic', 'zombuul'], 'bmr'); E.autoSetup(G, true); E.startGame(G);
    const lk = G.night.steps.findIndex(s => s.id === 'lunatic'), dk = G.night.steps.findIndex(s => s.lunatic);
    const lsp = E.stepSpec(G, G.night.steps[lk]), lin = lsp.info(lsp.defaults), din = dk >= 0 ? E.stepSpec(G, G.night.steps[dk]).info({}) : { tokens: [] };
    ok('Безумец (5 игроков): на его шаге Демону ничего, следом — «Демон узнаёт Безумца»', lk >= 0 && dk === lk + 1 && !(lin.tokens || []).some(t => /Демону/.test(t.label || ''))
      && din.tokens.some(t => t.role === 'lunatic' && t.players[0] === byRole(G, 'lunatic').id), G.night.steps.map(s => s.key).join(','));
    G = game(['gossip', 'sailor', 'chambermaid', 'exorcist', 'innkeeper', 'lunatic', 'assassin', 'zombuul'], 'bmr'); E.autoSetup(G, true); E.startGame(G);
    const dI = E.stepSpec(G, G.night.steps.find(s => s.id === 'demoninfo')).info({});
    ok('Безумец (7+): на шаге «Информация Демону» — «ЭТОТ ИГРОК» и жетон Безумца', dI.tokens.some(t => t.role === 'lunatic' && t.caption === E.CARD.thisPlayer) && !G.night.steps.some(s => s.lunatic));
    // Девица при Дурманщике: сразу после блефов Демону, каждому Приспешнику по отдельности
    G = game(['poppygrower', 'balloonist', 'savant', 'noble', 'general', 'damsel', 'poisoner', 'pithag', 'vigormortis'], 'oasis'); E.autoSetup(G, true); E.startGame(G);
    const sk = G.night.steps.map(s => s.id), dmK = sk.indexOf('damsel'), dmT = E.stepSpec(G, G.night.steps[dmK]).info({}).tokens;
    ok('Девица при Дурманщике: после блефов Демону, каждому Приспешнику отдельно', dmK === sk.indexOf('demoninfo') + 1 && dmT.length === 2 && dmT.every(t => t.role === 'damsel') && new Set(dmT.map(t => t.label)).size === 2, sk.join(','));
    // казнён мёртвый (убит Големом при номинации, голосование продолжилось): «уже мёртв», а не «не умирает»
    G = game(['noble', 'balloonist', 'savant', 'golem', 'professor', 'farmer', 'psychopath', 'vigormortis'], 'oasis'); E.autoSetup(G, true); E.startGame(G); runNight(G);
    const nb = byRole(G, 'noble'); E.nominate(G, byRole(G, 'golem').id, nb.id); E.execute(G, nb.id);
    ok('казнён мёртвый (Голем): итог «уже мёртв»', !nb.alive && G.day.exeResult.dead && !G.day.exeResult.died && E.exeQuestions(G, nb.id).length === 0);
    // Яга создала доброго Демона — окно с советами вики
    G = game(['clockmaker', 'dreamer', 'mathematician', 'flowergirl', 'artist', 'pithag', 'fanggu'], 'snv'); E.autoSetup(G, true); E.startGame(G); runNight(G); E.endDay(G);
    for (let g = 0; g < 40 && E.currentStep(G).id !== 'pithag'; g++) E.skipStep(G, 'manual');
    E.applyStep(G, E.currentStep(G), { t: [byRole(G, 'clockmaker').id], r: 'vortox', kill: [] });
    const adv = E.pithagAdvice(G);
    ok('Яга создала доброго Демона: советы вики', adv && adv.lines.some(l => /добрый Демон/.test(l)) && adv.lines.some(l => /на ваше усмотрение/.test(l)), adv && adv.lines.join(' | '));
    // Амнезиак: для способности из подсказок карточка подставляется сама; свой текст — на весь экран
    G = game(['amnesiac', 'chef', 'empath', 'monk', 'soldier', 'poisoner', 'imp'], 'tb'); E.startGame(G);
    const asp = E.stepSpec(G, G.night.steps.find(s => s.id === 'amnesiac')), afl = E.stepInputs(asp, { ability: IDEAS.AMNESIAC[1] });
    ok('Амнезиак: способность из подсказок — карточка «Число»', afl.some(f => f.key === 'kind' && f.def === 'number') && afl.some(f => f.key === 'num'));
    const atx = asp.info({ ability: 'своя', kind: 'text', say: 'Слева от вас злой' });
    ok('Амнезиак: свой текст — на весь экран', atx.tokens && atx.tokens[0].text === 'Слева от вас злой');
  }

  // 34. сценарий Blind Hunt (by Alex): Верховная Жрица, Головоломщик
  {
    ok('Blind Hunt: 22 роли, 13/4/4/1', DATA.scripts.blindhunt && DATA.scripts.blindhunt.roles.length === 22
      && ['townsfolk', 'outsider', 'minion', 'demon'].map(t => DATA.scripts.blindhunt.roles.filter(r => DATA.roles[r].team === t).length).join() === '13,4,4,1');
    let G = game(['washerwoman', 'highpriestess', 'empath', 'monk', 'soldier', 'puzzlemaster', 'poisoner', 'imp'], 'blindhunt'); E.autoSetup(G, true);
    const pmDrunk = E.P(G, G.flags.puzzleDrunk);
    ok('Головоломщик: на подготовке выбран пьяный Горожанин', pmDrunk && E.realTeam(pmDrunk) === 'townsfolk');
    E.startGame(G);
    ok('Головоломщик: выбранный пьян всю игру', /пьян/.test(E.abilityOff(G, pmDrunk) || '') && E.hasTok(pmDrunk, 'drunk', 'puzzlemaster'));
    const hp = G.night.steps.find(s => s.id === 'highpriestess'), hsp = E.stepSpec(G, hp), sol = byRole(G, 'soldier');
    const hin = hsp.info({ t: [sol.id] });
    ok('Верховная Жрица: каждую ночь — один игрок на экране', hsp.active && hsp.inputs[0].n === 1 && hin.tokens[0].players[0] === sol.id);
    runNight(G, { highpriestess: { t: [sol.id] } });
    const pm = byRole(G, 'puzzlemaster');
    ok('Головоломщик: угадал — верно; не угадал — нет', E.puzzleHit(G, pmDrunk.id) && !E.puzzleHit(G, pm.id));
    E.puzzleGuess(G, pm.id, pmDrunk.id, byRole(G, 'imp').id);
    ok('Головоломщик: догадка одна за игру', G.flags['puzzleUsed_' + pm.id] && E.hasTok(pm, 'guessused') && !E.puzzleGuess(G, pm.id, pmDrunk.id, byRole(G, 'imp').id));
  }

  // 35. заметки пользователя 2026-10-16: рассвет с воскрешением, Савант, Политик
  {
    const mb = morningText([], false, 3, ['Женя']), mm = morningText(['Саша'], false, 5, ['Женя']), m0 = morningText([], false, 1, []);
    ok('рассвет: ожил — свои тексты; смерть и воскрешение — свои', mb.total === MORNING.back.length && /Женя/.test(mb.text) && !/\{/.test(mb.text)
      && mm.total === MORNING.mixed.length && /Женя/.test(mm.text) && /Саша/.test(mm.text) && !/\{/.test(mm.text) && m0.total === MORNING.none.length, mb.text + ' | ' + mm.text);
    let G = game(['savant', 'chef', 'empath', 'monk', 'soldier', 'mayor', 'poisoner', 'spy', 'imp'], 'snv'); E.autoSetup(G, true); E.startGame(G); runNight(G);
    const sv = byRole(G, 'savant');
    let bad3 = 0, rep = 0;
    for (let k = 0; k < 200; k++) { const pr = IDEAS.savantPair(G, sv.id); if (!pr) continue;
      if (pr.some(x => !x.truth && /злых: 3\./.test(x.text))) bad3++; }
    const first = IDEAS.savantPair(G, sv.id); G.flags.savantFacts = [{ n: 1, pid: sv.id, facts: first }];
    for (let k = 0; k < 100; k++) { const pr = IDEAS.savantPair(G, sv.id); if (pr && pr.some(x => first.some(f => f.text === x.text))) rep++; }
    ok('Савант: ложь «злых: 3» не выдаётся; сказанные факты не повторяются', bad3 === 0 && rep === 0, `ложь 3: ${bad3}, повторов: ${rep}`);
    G = game(['washerwoman', 'politician', 'empath', 'monk', 'soldier', 'chef', 'poisoner', 'imp'], 'blindhunt'); E.autoSetup(G, true); E.startGame(G); runNight(G);
    const pol = byRole(G, 'politician'), mk = byRole(G, 'monk'), po = byRole(G, 'poisoner');
    E.nominate(G, pol.id, mk.id); E.recordVote(G, mk.id, [pol.id, po.id]);
    E.nominate(G, po.id, po.id); E.recordVote(G, po.id, [pol.id]);
    const ps = E.politicianStats(G, pol.id);
    ok('Политик: статистика номинаций и голосов', ps.noms === 1 && ps.nomGood === 1 && ps.voteGood === 1 && ps.voteEvil === 1, JSON.stringify(ps));
    E.endGame(G, 'evil', 'тест');
    ok('Политик: до объявления победы — решение о стороне', E.politiciansPending(G).includes(pol));
    E.politicianSide(G, pol.id, 'evil');
    ok('Политик: выбрали «Злой» — злой и побеждает со злом', pol.align === 'evil' && !E.politiciansPending(G).length);
    // голосование: сколько нужно для казни и для отмены; кто тратит голос призрака
    G = game(['washerwoman', 'librarian', 'empath', 'monk', 'soldier', 'chef', 'poisoner', 'imp'], 'tb'); E.autoSetup(G, true); E.startGame(G); runNight(G);
    const [a0, a1, a2, a3, a4, a5] = G.players;
    const th = E.voteThreshold(G), n0 = E.voteNeeds(G);
    E.nominate(G, a0.id, a1.id); E.recordVote(G, a1.id, G.players.slice(0, th + 1).map(p => p.id));
    const n1 = E.voteNeeds(G);
    ok('голосование: для казни — порог; кто-то на плахе — на 1 больше, для отмены — столько же', n0.exec === th && n0.cancel === null && n1.exec === th + 2 && n1.cancel === th + 1, JSON.stringify([th, n0, n1]));
    a5.alive = false; a5.ghost = true; a4.alive = false; a4.ghost = false;
    const gs = E.ghostSpent(G, [a5.id, a4.id, a3.id]);
    ok('голос призрака: тратит только мёртвый, у которого он был', gs.length === 1 && gs[0] === a5);
  }

  // 36. факты Саванта от пользователя (2026-10-16): данные игры подставляются, правда — правда, ложь — ложь
  {
    const facts = (G, sv, re) => IDEAS.savantTemplates(G, sv).map(f => f()).filter(r => r && re.test(r.yes));
    const roles9 = ['savant', 'poisoner', 'chef', 'empath', 'monk', 'imp', 'soldier', 'mayor', 'recluse'];
    let G = game(roles9, 'snv'); E.autoSetup(G, true); E.startGame(G);
    const sv = byRole(G, 'savant'), imp = byRole(G, 'imp');
    runNight(G, { poisoner: { t: [imp.id] } });
    // ни одного сломанного факта: правда и ложь различаются, без пустых подстановок
    let broken = [];
    for (const dir of ['cw', 'ccw']) { G.flags.seatDir = dir;
      for (let k = 0; k < 60; k++) for (const f of IDEAS.savantTemplates(G, sv)) { const r = f();
        if (r && (r.yes === r.no || /undefined|NaN|null|\{/.test(r.yes + r.no))) broken.push(r.yes + ' / ' + r.no); } }
    G.flags.seatDir = 'cw';
    ok('Савант: все шаблоны дают разные правду и ложь без пустых подстановок', !broken.length, broken.slice(0, 3).join(' | '));
    // «на местах с a по b — ровно k Приспешников / Изгоев»: правда совпадает с игрой, ложь — нет
    const W = { 'нет ни одного': 0, 'ровно один': 1, 'ровно два': 2, 'ровно три': 3, 'ровно четыре': 4 };
    const cnt = t => { const m = t.match(/с (\d+) по (\d+) (?:сидит |сидят )?(нет ни одного|ровно \S+)/); const tp = /Приспешник/.test(t) ? 'minion' : 'outsider';
      return { real: G.players.slice(m[1] - 1, +m[2]).filter(p => E.realTeam(p) === tp).length, said: W[m[3]] }; };
    let rg = 0, rgBad = 0;
    for (let k = 0; k < 80; k++) for (const r of facts(G, sv, /^На местах/)) { rg++; const y = cnt(r.yes), n = cnt(r.no); if (y.said !== y.real || n.said === n.real) rgBad++; }
    ok('Савант: «на местах с … по …» — число по игре', rg > 0 && rgBad === 0, `фактов ${rg}, ошибок ${rgBad}`);
    // ближайший злой слева/справа: по часовой — это слева; при номерах против часовой — наоборот
    const H = game(['savant', 'poisoner', 'chef', 'empath', 'monk', 'imp', 'soldier', 'mayor', 'oracle'], 'snv'); H.players.forEach(p => { p.align = ['poisoner', 'imp'].includes(p.role) ? 'evil' : 'good'; });
    const hs = byRole(H, 'savant'), side = () => facts(H, hs, /^Ближайш\S* к вам/)[0].yes;
    const cwSide = side(); H.flags.seatDir = 'ccw'; const ccwSide = side();
    ok('Савант: ближайший злой слева / справа — по направлению номеров', /слева/.test(cwSide) && /справа/.test(ccwSide), cwSide + ' | ' + ccwSide);
    H.flags.seatDir = 'cw';
    const three = facts(H, hs, /^Среди трёх ближайших/).map(r => r.yes);
    ok('Савант: трое слева от вас — по местам', three.every(t => t === (/слева/.test(t) ? 'Среди трёх ближайших игроков слева от вас злых: 1.' : 'Среди трёх ближайших игроков справа от вас злых: 0.')), three.join(' | '));
    // прошлой ночью Отравитель выбрал Демона
    const pick = facts(G, sv, /^Прошлой ночью/)[0];
    ok('Савант: «прошлой ночью один из игроков выбрал своей целью Демона»', pick && /один из игроков выбрал/.test(pick.yes) && /никто/.test(pick.no), pick && pick.yes);
    // вчерашние номинации: злой участвовал в 1 из 2
    const po = byRole(G, 'poisoner'), ch = byRole(G, 'chef'), so = byRole(G, 'soldier'), mk = byRole(G, 'monk');
    E.nominate(G, po.id, ch.id); E.nominate(G, so.id, mk.id); E.endDay(G);
    runNight(G, { poisoner: { t: [ch.id] }, monk: { t: [ch.id] }, imp: { t: [so.id] } });
    const nm = facts(G, sv, /^Вчера/)[0], pk2 = facts(G, sv, /^Прошлой ночью/)[0];
    ok('Савант: вчерашние номинации со злым — 1 из 2', nm && nm.yes === 'Вчера злой игрок (номинировавший или номинированный) участвовал в 1 из 2 номинаций.' && /в (0|2) из 2|ни в одной/.test(nm.no), nm && nm.yes + ' | ' + nm.no);
    ok('Савант: прошлой ночью Демона никто не выбирал (Демон сам себя не считается)', pk2 && /никто/.test(pk2.yes), pk2 && pk2.yes);
    // Приспешник-Эмпат: правда — число одного из живых Приспешников, ложь — ни одного
    let emBad = 0, em = 0;
    for (let k = 0; k < 40; k++) for (const r of facts(G, sv, /Эмпатом/)) { em++;
      const v = G.players.filter(p => E.realTeam(p) === 'minion' && p.alive).map(m => E.aliveNeighbours(G, m).filter(q => q.align === 'evil').length);
      if (!v.includes(+r.yes.match(/(\d)\.$/)[1]) || v.includes(+r.no.match(/(\d)\.$/)[1])) emBad++; }
    ok('Савант: «если бы Приспешник был Эмпатом» — по живым соседям', em > 0 && emBad === 0, `фактов ${em}, ошибок ${emBad}`);
    // Демон — «А» или «Б»: в правде есть настоящий Демон, в лжи — нет
    const dm = facts(G, sv, /^Демон в игре/)[0];
    ok('Савант: «Демон в игре — А или Б»', dm && dm.yes.includes(E.rname('imp')) && !dm.no.includes(E.rname('imp')), dm && dm.yes + ' | ' + dm.no);

    // 37. факты из списка пользователя (2026-10-16) и история игры; список фактов по группам
    const Hs = G.flags.hist;
    ok('история: выборы двух ночей, кто был отравлен', Hs && Hs.picks.filter(x => x.role === 'poisoner').length === 2 && Hs.poison.includes(imp.id) && Hs.poison.includes(ch.id), Hs && JSON.stringify(Hs.picks.map(x => x.role + x.n)));
    const same = facts(G, sv, /каждую ночь выбирал|выбирал разных/)[0];
    ok('Савант: «Отравитель каждую ночь выбирал одного и того же» — выбирал разных', same && /разных/.test(same.yes), same && same.yes);
    let pkBad = 0, pkN = 0;
    for (let k = 0; k < 60; k++) for (const r of facts(G, sv, /^Прошлой ночью обладатель роли/)) { pkN++;
      const chk = t => { const m = t.match(/роли «(.+?)» выбрал (?:игрока с ролью «(.+?)»|(\S+))\.$/); const x = G.night.data.picks.find(x => E.rname(x.role) === m[1]);
        return m[2] ? x.roles.some(r => E.rname(r) === m[2]) : x.types.some(tp => ({ townsfolk: 'Горожанина', outsider: 'Изгоя', minion: 'Приспешника', demon: 'Демона' })[tp] === m[3]); };
      if (!chk(r.yes) || chk(r.no)) pkBad++; }
    ok('Савант: «прошлой ночью обладатель роли … выбрал …» — по выбору ночи', pkN > 0 && pkBad === 0, `фактов ${pkN}, ошибок ${pkBad}`);
    const dp = facts(G, sv, /Демон (не )?выбирал мёртвого|Демон выбрал мёртвого/)[0];
    ok('Савант: Демон не выбирал мёртвого', dp && /не выбирал/.test(dp.yes), dp && dp.yes);
    // расстояние до злой роли: «не больше / не меньше N игроков между вами»
    let dBad = 0, dN = 0; const po2 = byRole(G, 'poisoner');
    const K = game(['savant', 'chef', 'empath', 'monk', 'poisoner', 'imp', 'soldier', 'mayor', 'oracle', 'recluse'], 'snv'), b0 = 3; // между Савантом и Отравителем — трое
    for (let k = 0; k < 60; k++) for (const r of facts(K, byRole(K, 'savant'), /^Между вами и обладателем/)) { dN++;
      const tr = t => { const m = t.match(/не (больше|меньше) (\d+)/); return m[1] === 'больше' ? b0 <= +m[2] : b0 >= +m[2]; }; if (!tr(r.yes) || tr(r.no)) dBad++; }
    ok('Савант: «между вами и Отравителем не больше / не меньше N»', dN > 0 && dBad === 0, `фактов ${dN}, ошибок ${dBad}`);
    // цепочка добрых подряд — по местам
    const chainOf = ok2 => { let best = 0; const n = G.players.length; for (let i = 0; i < n; i++) { let k = 0; while (k < n && ok2(G.players[(i + k) % n])) k++; best = Math.max(best, k); } return best; };
    let chBad = 0;
    for (let k = 0; k < 40; k++) for (const r of facts(G, sv, /^Самая длинная цепочка/)) {
      const ok2 = /добрых/.test(r.yes) ? (p => p.align !== 'evil') : /злых/.test(r.yes) ? (p => p.align === 'evil') : (p => E.realTeam(p) === 'townsfolk');
      if (+r.yes.match(/(\d+)\.$/)[1] !== chainOf(ok2) || +r.no.match(/(\d+)\.$/)[1] === chainOf(ok2)) chBad++; }
    ok('Савант: самая длинная цепочка подряд', chBad === 0, `ошибок ${chBad}`);
    // новая роль прошлой ночью (как будто Яга сделала Повара из Монаха)
    G.night.data.start.roles[ch.id] = 'monk';
    const nr = facts(G, sv, /^Прошлой ночью (появил|не появилось)/).map(r => r.yes);
    ok('Савант: «прошлой ночью появился новый Горожанин»', nr.length && nr.every(t => /новый Горожанин/.test(t)), nr.join(' | '));
    G.night.data.start.roles[ch.id] = 'chef';
    // казнь Приспешника попадает в историю
    E.nominate(G, ch.id, po2.id); E.execute(G, po2.id);
    const ex = facts(G, sv, /казнили/)[0];
    ok('Савант: «Приспешника уже казнили»', ex && /уже казнили/.test(ex.yes) && G.flags.hist.exe.some(x => x.team === 'minion'), ex && ex.yes);
    // список: все шаблоны по группам, в каждом — верный и неверный
    const list = IDEAS.savantList(G, sv.id), gi = list.map(x => IDEAS.SAVANT_GROUPS.indexOf(x.g));
    ok('Савант: список фактов по группам, без пустых', list.length >= 35 && gi.every((g, i) => g >= 0 && (!i || g >= gi[i - 1])) && list.every(x => x.yes !== x.no && !/undefined|NaN|null/.test(x.yes + x.no)), `фактов ${list.length}`);
    // во всех встроенных сценариях шаблоны не падают и не дают пустых подстановок
    let crash = [];
    for (const key of Object.keys(DATA.scripts)) { try { const Q = E.newGame(key); for (let i = 0; i < 10; i++) Q.players.push(E.newPlayer('И' + i)); E.randomDeal(Q); if (!Q.players.some(p => p.role === 'savant')) Q.players[0].role = 'savant';
      E.finishRoles(Q); E.autoSetup(Q, true); E.startGame(Q); runNight(Q); const s = Q.players.find(p => p.role === 'savant');
      for (const f of IDEAS.savantTemplates(Q, s)) { const r = f(); if (r && (r.yes === r.no || /undefined|NaN|null/.test(r.yes + r.no))) crash.push(key + ': ' + r.yes); } } catch (e) { crash.push(key + ': ' + e.message); } }
    ok('Савант: шаблоны во всех сценариях без ошибок', !crash.length, crash.slice(0, 3).join(' | '));
  }

  // 30. казнь на выбор: 30 одобренных текстов, у каждого — имя казнённого и своё название
  ok('казни: 37 историй, названия разные, в каждой есть имя', EXECUTIONS.length === 37 && new Set(EXECUTIONS.map(x => x.t)).size === 37
    && EXECUTIONS.every(x => x.t && x.s.includes('{name}') && !/\[Имя\]/.test(x.s)));

  // 31. сценарии Ильи (2026-10-19): раздачи, Казали, Оборотень, Банши, Страшила, Фокусник, Управляющий
  {
    // случайные раздачи: без проблем подготовки; с Казали Приспешников нет
    const bad = [];
    for (const key of ['bonappetit', 'nachtmahr']) for (let k = 0; k < 120; k++) {
      const n = 5 + (k % 11), Q = E.newGame(key); for (let i = 0; i < n; i++) Q.players.push(E.newPlayer('И' + i));
      E.randomDeal(Q); const pr = E.setupProblems(Q), kz = Q.players.some(p => p.role === 'kazali'), mn = Q.players.filter(p => E.realTeam(p) === 'minion').length;
      if (pr.length || (kz && mn)) bad.push(`${key} ${n}: ${pr.join('; ') || 'Казали и Приспешники: ' + mn}`);
    }
    ok('сценарии Ильи: 240 случайных раздач без проблем, при Казали нет Приспешников', !bad.length, bad.slice(0, 3).join(' | '));
    ok('Страшила и Ловчий — названия пользователя', DATA.roles.fearmonger.name === 'Страшила' && /Страшила выбрал/.test(DATA.roles.fearmonger.first) && DATA.roles.huntsman.name === 'Ловчий');
    ok('джинкс Математик + Пьяница — по-русски', /^Математик узнаёт/.test(DATA.jinxes['mathematician|drunk'] || DATA.jinxes['drunk|mathematician'] || ''));
    // Казали: раздача без Приспешников, в 1-ю ночь делает Повара Отравителем — Отравитель просыпается этой же ночью
    let G = game(['chef', 'investigator', 'librarian', 'empath', 'fortuneteller', 'monk', 'saint', 'kazali'], 'bonappetit');
    const dz = E.setupDistribution(G);
    ok('Казали: раскладка без Приспешников', dz.minion === 0 && dz.kazali === 1 && !E.setupProblems(G).length, E.setupProblems(G).join('; '));
    E.autoSetup(G, true); E.startGame(G);
    const kz = E.stepSpec(G, G.night.steps.find(s => s.id === 'kazali'));
    ok('Казали: в 1-ю ночь выбирает 1 Приспешника', kz.active && kz.inputs[0].n === 1);
    runNight(G, { kazali: { t: [byRole(G, 'chef').id], r0: 'poisoner' }, poisoner: { t: [byRole(G, 'monk').id] } });
    const ch = G.players.find(p => p.name.endsWith(':chef'));
    ok('Казали: Повар стал злым Отравителем и отравил в ту же ночь', ch.role === 'poisoner' && ch.align === 'evil' && E.hasTok(byRole(G, 'monk'), 'poisoned', 'poisoner'), ch.role);
    E.endDay(G);
    runNight(G, { kazali: { t: [byRole(G, 'empath').id] }, poisoner: { t: [byRole(G, 'saint').id] }, monk: { t: [byRole(G, 'investigator').id] } });
    ok('Казали убивает со 2-й ночи', !byRole(G, 'empath').alive);
    // Оборотень, «Кошачья лапка», Банши, Фокусник
    G = game(['chef', 'investigator', 'lycanthrope', 'banshee', 'monk', 'saint', 'poisoner', 'imp'], 'nachtmahr');
    E.autoSetup(G, true); G.flags.fauxPaw = byRole(G, 'chef').id; E.startGame(G);
    ok('«Кошачья лапка» на Поваре', E.hasTok(byRole(G, 'chef'), 'fauxpaw', 'lycanthrope') && E.fauxPawOn(G, byRole(G, 'chef')));
    runNight(G, {});
    E.endDay(G);
    runNight(G, { lycanthrope: { t: [byRole(G, 'investigator').id] }, imp: { t: [byRole(G, 'saint').id] }, monk: { t: [byRole(G, 'chef').id] }, poisoner: { t: [byRole(G, 'poisoner').id] } });
    ok('Оборотень убил доброго — Демон этой ночью не убивает', !byRole(G, 'investigator').alive && byRole(G, 'saint').alive);
    E.endDay(G);
    runNight(G, { lycanthrope: { t: [byRole(G, 'chef').id] }, imp: { t: [byRole(G, 'banshee').id] }, monk: { t: [byRole(G, 'saint').id] }, poisoner: { t: [byRole(G, 'poisoner').id] } });
    const bn = byRole(G, 'banshee');
    ok('Оборотень: «Кошачья лапка» не умирает; Демон убил Банши', byRole(G, 'chef').alive && !bn.alive);
    ok('Банши убита Демоном: голос ×2, номинирует, голос призрака не тратится', E.bansheeVotes(G, bn) && E.voteWeight(G, bn) === 2 && E.ghostSpent(G, [bn.id]).length === 0);
    E.nominate(G, bn.id, byRole(G, 'monk').id); E.recordVote(G, byRole(G, 'monk').id, [bn.id]);
    ok('Банши проголосовала дважды, голос остался', G.day.noms[0].count === 2 && bn.ghost, String(G.day.noms[0].count));
    // Банши, убитая Оборотнем, — без способности
    G = game(['chef', 'investigator', 'lycanthrope', 'banshee', 'monk', 'saint', 'poisoner', 'imp'], 'nachtmahr');
    E.autoSetup(G, true); G.flags.fauxPaw = byRole(G, 'chef').id; E.startGame(G); runNight(G, {}); E.endDay(G);
    runNight(G, { lycanthrope: { t: [byRole(G, 'banshee').id] }, imp: { t: [byRole(G, 'saint').id] }, monk: { t: [byRole(G, 'chef').id] }, poisoner: { t: [byRole(G, 'chef').id] } });
    ok('Банши, убитая Оборотнем, способности не получает', !byRole(G, 'banshee').alive && !E.bansheeVotes(G, byRole(G, 'banshee')));
    // Фокусник: Приспешникам — Демон и Фокусник, Демону — Приспешники и Фокусник
    G = game(['chef', 'investigator', 'magician', 'banshee', 'monk', 'saint', 'poisoner', 'imp'], 'nachtmahr');
    E.autoSetup(G, true); E.startGame(G);
    const mi = E.stepSpec(G, G.night.steps.find(s => s.id === 'minioninfo')).info({}), di = E.stepSpec(G, G.night.steps.find(s => s.id === 'demoninfo')).info({});
    const mg = byRole(G, 'magician').id;
    ok('Фокусник: Приспешники видят его Демоном, Демон — Приспешником', mi.tokens[0].players.includes(mg) && mi.tokens[0].players.includes(byRole(G, 'imp').id) && di.tokens.some(t => t.caption === E.CARD.minions && t.players.includes(mg)));
    // заметка пользователя 2026-10-25: «Фокусник всегда стоит последним — замешивай его»: порядок случайный, один на ночь, в карточке тот же
    const minTok = info => info.tokens.find(t => t.caption === E.CARD.minions).players;
    const di2 = E.stepSpec(G, G.night.steps.find(s => s.id === 'demoninfo')).info({});
    let lastN = 0;
    for (let k = 0; k < 40; k++) {
      const Q = game(['chef', 'investigator', 'magician', 'banshee', 'monk', 'saint', 'poisoner', 'imp'], 'nachtmahr'); E.autoSetup(Q, true); E.startGame(Q);
      const pl = E.stepSpec(Q, Q.night.steps.find(s => s.id === 'minioninfo')).info({}).tokens[0].players; if (pl[pl.length - 1] === byRole(Q, 'magician').id) lastN++;
    }
    ok('Фокусник замешан: порядок случайный, от перерисовки не меняется, в карточке рассказчика — тот же', minTok(di).join() === minTok(di2).join() && lastN > 0 && lastN < 40
      && di.lines[0] === 'Укажите как на Приспешников: ' + minTok(di).map(id => G.players.find(p => p.id === id).name).join(', '), `последним ${lastN} из 40; ${di.lines[0]}`);
    // Страшила: номинировал выбранного, его казнили — команда проигрывает
    G = game(['steward', 'chef', 'investigator', 'monk', 'soldier', 'saint', 'fearmonger', 'imp'], 'nachtmahr');
    E.autoSetup(G, true); E.startGame(G);
    const sw = E.stepSpec(G, G.night.steps.find(s => s.id === 'steward'));
    ok('Управляющий: 1-я ночь, по умолчанию — добрый игрок', sw.active && G.players.find(q => q.id === sw.defaults.t[0]).align === 'good');
    runNight(G, { fearmonger: { t: [byRole(G, 'chef').id] } });
    ok('Страшила: жетон «Страх», на рассвете объявить', E.hasTok(byRole(G, 'chef'), 'fear', 'fearmonger') && G.log.some(l => /Страшила выбрал игрока/.test(l.t)));
    ok('Страшила: подсказка при номинации', E.nominationPreview(G, byRole(G, 'fearmonger').id, byRole(G, 'chef').id).notes.some(t => /Страшила/.test(t)));
    E.nominate(G, byRole(G, 'fearmonger').id, byRole(G, 'chef').id); E.execute(G, byRole(G, 'chef').id);
    ok('Страшила: казнь выбранного — победа зла', G.result && G.result.winner === 'evil', G.result && G.result.reason);
    // проверка пользователя 2026-10-31 (вики, Страшила): объявляют только новый выбор; действует последний; казнь — только по номинации Страшилы
    const fg = (extra) => { const Q = game(['chef', 'investigator', 'monk', 'soldier', 'virgin', 'pacifist', 'fearmonger', 'imp'].concat(extra || []), 'nachtmahr'); E.autoSetup(Q, true); E.startGame(Q); return Q; };
    const fearOn = (Q, r) => ({ fearmonger: { t: [byRole(Q, r).id] } }), annN = Q => Q.log.filter(l => /объявлено: «Страшила выбрал игрока»/.test(l.t)).length;
    let F = fg(); runNight(F, fearOn(F, 'chef')); E.endDay(F); runNight(F, fearOn(F, 'chef'));
    ok('Страшила: тот же игрок во 2-ю ночь — ничего не объявляют', annN(F) === 1 && F.log.some(l => /\(тот же игрок\)/.test(l.t)));
    E.endDay(F); runNight(F, fearOn(F, 'soldier'));
    E.nominate(F, byRole(F, 'fearmonger').id, byRole(F, 'chef').id); E.execute(F, byRole(F, 'chef').id);
    ok('Страшила выбрал другого — объявлено, казнь прежнего выбора игру не заканчивает', annN(F) === 2 && !F.result && !E.hasTok(byRole(F, 'chef'), 'fear', 'fearmonger'));
    F = fg(); runNight(F, fearOn(F, 'chef'));
    E.nominate(F, byRole(F, 'investigator').id, byRole(F, 'chef').id); E.execute(F, byRole(F, 'chef').id);
    ok('Страшила: выбранного номинировал другой — казнь игру не заканчивает', !F.result);
    F = fg(); runNight(F, fearOn(F, 'chef'));
    E.nominate(F, byRole(F, 'fearmonger').id, byRole(F, 'chef').id); E.execute(F, byRole(F, 'chef').id, { pacifist: true });
    ok('Страшила: казнён, но не умер (Пацифист) — команда всё равно проигрывает', F.result && F.result.winner === 'evil' && byRole(F, 'chef').alive, F.result && F.result.reason);
    F = fg(); runNight(F, fearOn(F, 'chef'));
    E.nominate(F, byRole(F, 'fearmonger').id, byRole(F, 'chef').id); // голосов не хватило
    E.nominate(F, byRole(F, 'chef').id, byRole(F, 'virgin').id);
    ok('Страшила: выбранного потом казнила Девственница — не номинация Страшилы, игра идёт', F.day.executed === byRole(F, 'chef').id && !F.result, F.result && F.result.reason);
    F = fg(); runNight(F, fearOn(F, 'chef'));
    E.nominate(F, byRole(F, 'fearmonger').id, byRole(F, 'chef').id); E.madnessExecute(F, byRole(F, 'chef').id, 'cerenovus');
    ok('Страшила: выбранного потом казнили за безумие — игра идёт', !F.result, F.result && F.result.reason);
    F = fg(['poisoner']); runNight(F, Object.assign(fearOn(F, 'chef'), { poisoner: { t: [byRole(F, 'fearmonger').id] } }));
    E.nominate(F, byRole(F, 'fearmonger').id, byRole(F, 'chef').id); E.execute(F, byRole(F, 'chef').id);
    ok('Страшила отравлен — казнь выбранного игру не заканчивает', !F.result && !!E.abilityOff(F, byRole(F, 'fearmonger')), F.result && F.result.reason);
  }

  // 32. Teensyville (2026-10-20): раздачи на 5–6 игроков, Пиявица и джинкс с Истребителем
  {
    const bad = [];
    for (const key of ['leech', 'overtheriver', 'nogreaterjoy', 'deaddontsleep']) for (let k = 0; k < 60; k++) {
      const n = 5 + (k % 2), Q = E.newGame(key); for (let i = 0; i < n; i++) Q.players.push(E.newPlayer('И' + i));
      E.randomDeal(Q);
      if (Q.flags.marionetteNeed) { const nb = E.demonSeatNeighbours(Q).find(p => DATA.roles[p.role].team === 'townsfolk' || DATA.roles[p.role].team === 'outsider'); if (nb) E.makeMarionette(Q, nb.id); }
      const pr = E.setupProblems(Q); if (pr.length) bad.push(`${key} ${n}: ${pr.join('; ')}`);
    }
    ok('Teensyville: 240 случайных раздач на 5–6 игроков без проблем', !bad.length, [...new Set(bad)].slice(0, 3).join(' | '));
    ok('Пиявица: ночная подсказка без «The»', !/The/.test(DATA.roles.lleech.other || '') && DATA.scripts.leech.names.oracle === 'Пророк');
    let G = game(['oracle', 'undertaker', 'exorcist', 'drunk', 'devilsadvocate', 'lleech'], 'leech');
    E.autoSetup(G, true); E.startGame(G);
    const host = byRole(G, 'undertaker'), ll = byRole(G, 'lleech');
    runNight(G, { lleech: { t: [host.id] } });
    ok('Пиявица: хозяин отравлен до конца игры', E.hasTok(host, 'poisoned', 'lleech') && !!E.abilityOff(G, host));
    E.execute(G, ll.id);
    ok('Пиявица: казнь не убивает, пока хозяин жив', ll.alive && G.day.exeResult && !G.day.exeResult.died && /хозяин/.test(G.day.exeResult.why), G.day.exeResult && G.day.exeResult.why);
    E.endDay(G);
    runNight(G, { lleech: { t: [byRole(G, 'oracle').id] }, devilsadvocate: { t: [host.id] }, exorcist: { t: [host.id] } });
    ok('Пиявица убивает со 2-й ночи', !byRole(G, 'oracle').alive && host.alive);
    E.storytellerKill(G, host.id, null, 'проверка');
    ok('Пиявица: умер хозяин — умирает и она, добро побеждает', !ll.alive && G.result && G.result.winner === 'good', G.result && G.result.reason);
    // джинкс: Истребитель стреляет в хозяина — хозяин умирает (и Пиявица с ним)
    G = game(['slayer', 'juggler', 'fisherman', 'lunatic', 'marionette', 'lleech'], 'leech');
    E.autoSetup(G, true); E.startGame(G); const h2 = byRole(G, 'juggler');
    runNight(G, { lleech: { t: [h2.id] } });
    E.slayerShot(G, byRole(G, 'slayer').id, h2.id);
    ok('Джинкс Пиявица + Истребитель: выстрел в хозяина убивает его и Пиявицу', !h2.alive && !byRole(G, 'lleech').alive && G.result && G.result.winner === 'good');
  }

  // 33. советы Рыбаку (2026-10-20): группы, «почему», плохой совет пьяному, финал — кого казнить; во всех сценариях без ошибок
  {
    const crash = [];
    for (const key of Object.keys(DATA.scripts)) { try { const Q = E.newGame(key); for (let i = 0; i < 9; i++) Q.players.push(E.newPlayer('И' + i)); E.randomDeal(Q);
      if (!Q.players.some(p => p.role === 'fisherman')) Q.players[0].role = 'fisherman'; E.finishRoles(Q); E.autoSetup(Q, true); E.startGame(Q); runNight(Q);
      const fm = Q.players.find(p => p.role === 'fisherman'), adv = IDEAS.fishermanAdvice(Q, fm.id);
      if (!adv.length || adv.some(x => !x.g || !x.t || /undefined|NaN|null/.test(x.t + x.why))) crash.push(key + ': ' + JSON.stringify(adv.find(x => /undefined|NaN|null/.test(x.t + x.why)) || adv.length)); } catch (e) { crash.push(key + ': ' + e.message); } }
    ok('Рыбак: советы во всех сценариях без ошибок', !crash.length, crash.slice(0, 3).join(' | '));
    let G = game(['fisherman', 'empath', 'saint', 'poisoner', 'imp'], 'tb'); E.autoSetup(G, true); E.startGame(G); runNight(G, { poisoner: { t: [byRole(G, 'empath').id] } });
    let adv = IDEAS.fishermanAdvice(G, byRole(G, 'fisherman').id);
    ok('Рыбак: финал (5 живых — ещё нет), Святого не казнить, отравленному Эмпату не доверять',
      !adv.some(x => x.g === 'Финал') && adv.some(x => /не казните/.test(x.t) && /Святой/.test(x.why)) && adv.some(x => /Не доверяйте информации/.test(x.t) && /Эмпат/.test(x.why)));
    E.storytellerKill(G, byRole(G, 'saint').id, null, 'проверка');
    adv = IDEAS.fishermanAdvice(G, byRole(G, 'fisherman').id);
    ok('Рыбак: в финале трезвому — «Казните» Демона первым', adv[0].g === 'Финал' && adv[0].t.includes(byRole(G, 'imp').name), adv[0] && adv[0].t);
    E.addTok(G, byRole(G, 'fisherman'), 'poisoned', 'poisoner');
    adv = IDEAS.fishermanAdvice(G, byRole(G, 'fisherman').id);
    ok('Рыбак отравлен: сначала плохие советы, финального нет', /Плохой/.test(adv[0].g) && !adv.some(x => x.g === 'Финал'));
  }

  // 34. Кукольник (вики; заметка пользователя 2026-10-20): без своего шага, «Ночь без нападения» у Демона, принудительно в последнюю ночь
  {
    let G = game(['washerwoman', 'empath', 'chef', 'drunk', 'poisoner', 'imp'], 'tb'); G.fabled = ['toymaker'];
    E.autoSetup(G, true); E.startGame(G);
    ok('Кукольник: нет своего шага, злые знакомятся при 6 игроках, метка на Демоне', !G.night.steps.some(s => s.fabled) && G.night.steps.some(s => s.id === 'minioninfo') && E.hasTok(byRole(G, 'imp'), 'finalnight', 'toymaker'));
    runNight(G, {}); E.endDay(G);
    let st = G.night.steps.find(s => s.id === 'imp'), sp = E.stepSpec(G, st);
    ok('Кукольник: у Демона выбор «Ночь без нападения»', sp.active && sp.inputs[0].key === 'toy' && E.missingInputs(sp, { toy: 'skip' }).length === 0 && E.missingInputs(sp, {}).length === 1);
    runNight(G, { imp: { toy: 'skip' }, poisoner: { t: [byRole(G, 'poisoner').id] } });
    ok('Кукольник: ночь без нападения — никто не умер, метка снята', G.players.every(p => p.alive) && G.flags.toyNoAttack && !E.hasTok(byRole(G, 'imp'), 'finalnight'));
    // не отказывался — при 3 живых Демона не будят
    G = game(['washerwoman', 'empath', 'chef', 'drunk', 'poisoner', 'imp'], 'tb'); G.fabled = ['toymaker']; E.autoSetup(G, true); E.startGame(G); runNight(G, {});
    E.storytellerKill(G, byRole(G, 'washerwoman').id, null, 'тест'); E.storytellerKill(G, byRole(G, 'chef').id, null, 'тест'); E.storytellerKill(G, byRole(G, 'drunk').id, null, 'тест');
    E.endDay(G); sp = E.stepSpec(G, G.night.steps.find(s => s.id === 'imp'));
    ok('Кукольник: последняя ночь без отказа — Демон не просыпается', !sp.active && /Кукольник/.test(sp.reason), sp.reason);
    G.flags.toyNoAttack = true; sp = E.stepSpec(G, G.night.steps.find(s => s.id === 'imp'));
    ok('Кукольник: после отказа Демон нападает и в последнюю ночь', sp.active && sp.inputs[0].key === 'toy');
  }
  // 35. Безумец, считающий себя Пиявицей: в 1-ю ночь «выбирает хозяина», настоящий Демон узнаёт его выбор
  {
    const G = game(['oracle', 'undertaker', 'exorcist', 'lunatic', 'devilsadvocate', 'lleech'], 'leech'); E.autoSetup(G, true); byRole(G, 'lunatic').believes = 'lleech'; E.startGame(G);
    const lst = E.stepSpec(G, G.night.steps.find(s => s.id === 'lunatic'));
    ok('Безумец-«Пиявица»: в 1-ю ночь выбирает «хозяина»', lst.active && lst.inputs.some(f => f.key === 't' && f.n === 1));
    const G2 = game(['oracle', 'undertaker', 'exorcist', 'lunatic', 'devilsadvocate', 'lleech'], 'leech'); E.autoSetup(G2, true); byRole(G2, 'lunatic').believes = 'lleech'; E.startGame(G2);
    let dem = null, guard = 0;
    while (G2.phase === 'night' && guard++ < 30) { const st = E.currentStep(G2), sp = E.stepSpec(G2, st);
      if (st.id === 'demoninfo') dem = sp.info({});
      if (!sp.active) { E.skipStep(G2); continue; }
      const r = E.applyStep(G2, st, Object.assign({}, sp.defaults, st.id === 'lunatic' ? { t: [byRole(G2, 'oracle').id] } : st.id === 'lleech' ? { t: [byRole(G2, 'undertaker').id] } : st.id === 'devilsadvocate' ? { t: [byRole(G2, 'exorcist').id] } : {})); if (!r.ok) E.skipStep(G2); }
    ok('Безумец-«Пиявица»: Демон узнаёт его выбор, у настоящего хозяин свой', dem && dem.tokens.some(t => /Безумец «выбрал»/.test(t.sub || '') && t.players.includes(byRole(G2, 'oracle').id))
      && !E.hasTok(byRole(G2, 'oracle'), 'poisoned', 'lleech') && E.hasTok(byRole(G2, 'undertaker'), 'poisoned', 'lleech'));
  }

  // 36. Марионетка: в «Ролях на игру» можно на одну больше — лишний Горожанин вместо её жетона (заметка пользователя 2026-10-21)
  {
    const mk = () => { const Q = E.newGame('leech'); for (let i = 0; i < 6; i++) Q.players.push(E.newPlayer('И' + i));
      Q.pool = ['oracle', 'undertaker', 'exorcist', 'juggler', 'drunk', 'marionette', 'lleech']; return Q; };
    let Q = mk();
    ok('Марионетка: 7 ролей на 6 игроков — набор годится', E.validPool(Q) && E.poolMarExtra(Q) && !E.drawProblem(Q));
    E.randomDeal(Q);
    const roles = Q.players.map(p => p.role).sort().join(',');
    ok('Марионетка: розданы ровно отмеченные роли без её жетона', roles === ['oracle', 'undertaker', 'exorcist', 'juggler', 'drunk', 'lleech'].sort().join(',') && Q.flags.marionetteNeed, roles);
    const nb = E.demonSeatNeighbours(Q).find(p => DATA.roles[p.role].team === 'townsfolk'); if (nb) E.makeMarionette(Q, nb.id);
    ok('Марионетка: после выбора соседа подготовка без проблем', nb && !E.setupProblems(Q).length, E.setupProblems(Q).join('; '));
    Q = mk(); Q.pool = Q.pool.filter(r => r !== 'juggler');
    ok('Марионетка: 6 ролей тоже годится — Горожанин подберётся сам', E.validPool(Q) && !E.poolMarExtra(Q));
    Q = mk(); Q.pool = Q.pool.filter(r => r !== 'marionette').concat('slayer');
    ok('Без Марионетки 7 ролей на 6 игроков — нельзя', !E.validPool(Q) && !!E.drawProblem(Q));
  }

  // 37. заметки пользователя 2026-10-24: Девица во 2-ю ночь, Ловчий без Девицы, ложная цель Гадалки из Девицы, выбор подготовки
  // посреди игры, Фань Гу и Чёрт под защитой Монаха
  {
    const roles = ['huntsman', 'damsel', 'chef', 'empath', 'monk', 'poisoner', 'imp', 'soldier'];
    const nightSkipDamsel = G => { let g = 0; while (G.phase === 'night' && g++ < 60) { const st = E.currentStep(G), sp = E.stepSpec(G, st);
      if (st.id === 'damsel' && sp.active) { E.skipStep(G, 'manual'); continue; } if (!sp.active) { E.skipStep(G); continue; }
      const r = E.applyStep(G, st, Object.assign({}, sp.defaults)); if (!r.ok) E.skipStep(G); } };
    let G = game(roles, 'bonappetit'); E.autoSetup(G, true); E.startGame(G); runNight(G); E.endDay(G);
    ok('Девица: показана в 1-ю ночь — во 2-ю шага нет', G.phase === 'night' && !G.night.steps.some(s => s.id === 'damsel'));
    // заметка пользователя 2026-10-31 (снова «почему Девица на 2-ю ночь?»): вики — только 1-я ночь; пропустили — больше не напоминаем
    G = game(roles, 'bonappetit'); E.autoSetup(G, true); E.startGame(G);
    const sk1 = G.night.steps.map(s => s.id), dmI = sk1.indexOf('damsel');
    ok('Девица: в 1-ю ночь — сразу после «Информации Приспешникам» (лист ночи), Приспешники ещё не спят',
      dmI > 0 && dmI === sk1.indexOf('minioninfo') + 1 && /не спят/.test(E.stepSpec(G, G.night.steps[dmI]).info({}).show), sk1.join(','));
    nightSkipDamsel(G); E.endDay(G);
    ok('Девица: пропущена в 1-ю ночь — во 2-ю шага нет', G.phase === 'night' && !G.night.steps.some(s => s.id === 'damsel'), G.night.steps.map(s => s.id).join(','));
    G = game(roles.map(r => r === 'damsel' ? 'saint' : r === 'huntsman' ? 'washerwoman' : r), 'bonappetit'); E.autoSetup(G, true); E.startGame(G); runNight(G);
    E.changeRole(G, byRole(G, 'saint'), 'damsel'); E.endDay(G);
    const ds = G.night.steps.find(s => s.id === 'damsel'), dsp = ds && E.stepSpec(G, ds);
    ok('Девица вошла в игру позже — шаг в ближайшую ночь, «решение рассказчика»', dsp && dsp.active && /решение рассказчика/.test(dsp.text || ''), dsp && dsp.text);
    nightSkipDamsel(G); E.endDay(G);
    ok('Девица вошла позже, шаг пропущен — дальше шага нет', G.phase === 'night' && !G.night.steps.some(s => s.id === 'damsel'));

    const Q = E.newGame('bonappetit'); for (let i = 0; i < 8; i++) Q.players.push(E.newPlayer('Х' + i));
    Q.pool = ['huntsman', 'chef', 'empath', 'monk', 'soldier', 'saint', 'poisoner', 'imp'];
    ok('Ловчий без Девицы в «Ролях на игру» — жребий не начать', /Девиц/.test(E.drawProblem(Q)) && !E.drawStart(Q), E.drawProblem(Q));

    G = game(roles, 'bonappetit'); E.autoSetup(G, true); E.startGame(G); runNight(G); E.endDay(G);
    const dam = byRole(G, 'damsel');
    runNight(G, { huntsman: { t: [dam.id], r: 'fortuneteller' } });
    const rh = G.players.find(p => p.id === G.flags.ftHerring);
    ok('Гадалка из Девицы: ложная цель назначена сама — добрый игрок, не она, с отметкой', dam.role === 'fortuneteller' && rh && rh !== dam && rh.align === 'good' && E.hasTok(rh, 'herring', 'fortuneteller'), rh && rh.name);
    const other = G.players.find(p => p.align === 'good' && p !== rh && p !== dam);
    E.setPrepFlag(G, 'ftHerring', other.id);
    ok('Ложную цель можно сменить посреди игры — отметка переезжает', G.flags.ftHerring === other.id && E.hasTok(other, 'herring', 'fortuneteller') && G.players.filter(p => E.hasTok(p, 'herring')).length === 1);

    // решение пользователя (2026-10-25): Фань Гу под защитой выбрал Изгоя — Изгой умирает, прыжка нет, способность прыжка использована
    const H = game(['chef', 'empath', 'monk', 'poisoner', 'fanggu', 'soldier', 'saint', 'mutant'], 'bonappetit'); E.autoSetup(H, true); E.startGame(H); runNight(H); E.endDay(H);
    const f = byRole(H, 'fanggu'), sa = byRole(H, 'saint'), mu = byRole(H, 'mutant');
    runNight(H, { monk: { t: [f.id] }, fanggu: { t: [sa.id] } });
    ok('Фань Гу под защитой Монаха выбрал Изгоя — Изгой умирает, прыжка нет', f.alive && f.role === 'fanggu' && !sa.alive && sa.role === 'saint' && H.flags.fangguJumped);
    E.endDay(H); runNight(H, { fanggu: { t: [mu.id] } });
    ok('Фань Гу под защитой: способность прыжка использована — следующий Изгой просто умирает', f.alive && !mu.alive && mu.role === 'mutant');

    const I2 = game(['chef', 'empath', 'monk', 'poisoner', 'imp', 'soldier', 'saint', 'mutant'], 'bonappetit'); E.autoSetup(I2, true); E.startGame(I2); runNight(I2); E.endDay(I2);
    const imp = byRole(I2, 'imp'), po = byRole(I2, 'poisoner');
    runNight(I2, { monk: { t: [imp.id] }, imp: { t: [imp.id], heir: [po.id] } });
    ok('Чёрт под защитой Монаха убивает себя — ничего, нового Чёрта нет (вики)', imp.alive && imp.role === 'imp' && po.role === 'poisoner');
  }

  // 38. Пукка (вики: «Players that the Pukka kills are still poisoned at their time of death»; вопрос пользователя 2026-10-25 про Банши)
  {
    const G = game(['chef', 'empath', 'banshee', 'soldier', 'monk', 'poisoner', 'pukka', 'saint'], 'nachtmahr'); E.autoSetup(G, true); E.startGame(G);
    const bn = byRole(G, 'banshee'), so = byRole(G, 'soldier'), ch = byRole(G, 'chef');
    const calm = t => ({ pukka: { t: [t.id] }, poisoner: { t: [ch.id] }, monk: { t: [ch.id] } });
    runNight(G, calm(bn)); E.endDay(G);
    runNight(G, calm(so));
    ok('Банши убита Пуккой — отравлена в момент смерти: способности нет, не объявляют', !bn.alive && !E.hasTok(bn, 'hasability') && !E.hasTok(bn, 'poisoned', 'pukka'));
    E.endDay(G); runNight(G, calm(byRole(G, 'empath')));
    ok('Солдат, отравленный Пуккой, умирает (без способности)', !so.alive);

    const B = game(['chef', 'empath', 'banshee', 'soldier', 'monk', 'poisoner', 'imp', 'saint'], 'nachtmahr'); E.autoSetup(B, true); E.startGame(B); runNight(B); E.endDay(B);
    const b2 = byRole(B, 'banshee');
    runNight(B, { imp: { t: [b2.id] }, poisoner: { t: [byRole(B, 'chef').id] }, monk: { t: [byRole(B, 'chef').id] } });
    ok('Банши убита Чёртом — способность есть', !b2.alive && E.hasTok(b2, 'hasability', 'banshee'));

    const R2 = game(['ravenkeeper', 'chef', 'empath', 'monk', 'soldier', 'poisoner', 'pukka', 'saint'], 'tb'); E.autoSetup(R2, true); E.startGame(R2);
    const rk = byRole(R2, 'ravenkeeper'), c2 = byRole(R2, 'chef'), quiet = t => ({ pukka: { t: [t.id] }, poisoner: { t: [c2.id] }, monk: { t: [c2.id] } });
    runNight(R2, quiet(rk)); E.endDay(R2);
    const st = runUntil(R2, 'ravenkeeper', quiet(byRole(R2, 'empath'))), sp = st && E.stepSpec(R2, st);
    ok('Смотритель убит Пуккой — просыпается отравленным (ложная информация)', !rk.alive && sp && sp.active && !!sp.dist, sp && JSON.stringify(sp.dist));
    runNight(R2, quiet(byRole(R2, 'empath')));
    ok('Смотритель убит Пуккой — яд снят на рассвете', !E.hasTok(rk, 'poisoned', 'pukka'));
  }

  // 39. Крёстный Отец и Ловчий (заметка пользователя 2026-10-26; вики: Крёстный Отец «remove one Outsider and add one Townsfolk» — при 0 Изгоях
  // убирать некого; Ловчий — «if the Damsel is not in play, remove a Townsfolk and add the Damsel»)
  {
    let d = E.distribution(7, ['godfather', 'huntsman', 'damsel'], {}, 4);
    const gf = d.choices.find(c => c.id === 'godfather'), hu = d.choices.find(c => c.id === 'huntsman');
    ok('7 игроков, Изгоев 0: Крёстный Отец — только +1, с пояснением', gf.opts.join() === '1' && /убрать Изгоя нельзя/.test(gf.why), gf.why);
    ok('Крёстный Отец +1 и Ловчий: можно «Девица — одна из этих Изгоев» (итого 1 Изгой) или сверху (2)', hu.opts.join() === '0,1');
    d = E.distribution(7, ['godfather', 'huntsman', 'damsel'], { huntsman: 0 }, 4);
    ok('Девица — добавленный Крёстным Изгой: 4 Горожанина, 1 Изгой', d.townsfolk === 4 && d.outsider === 1);
    d = E.distribution(8, ['godfather', 'huntsman', 'damsel'], { godfather: -1, huntsman: 0 }, 4);
    ok('8 игроков, Крёстный Отец −1: Изгоев 0 — Девица только сверху (итого 1)', d.choices.find(c => c.id === 'huntsman').opts.join() === '1' && d.outsider === 1 && d.townsfolk === 5);
  }

  // 40. заметки пользователя 2026-10-27: Дурманщик, Странники (Гном, Гангстер, Хохотун), правдоподобная ложь
  {
    const G = game(['poppygrower', 'huntsman', 'damsel', 'chef', 'empath', 'soldier', 'poisoner', 'imp'], 'blindhunt'); E.autoSetup(G, true); E.startGame(G);
    const pg = byRole(G, 'poppygrower'), dm = byRole(G, 'damsel'), ch = byRole(G, 'chef');
    runNight(G, { poisoner: { t: [ch.id] }, huntsman: { t: [] } }); E.endDay(G);
    const st = runUntil(G, 'huntsman', { imp: { t: [pg.id] }, poisoner: { t: [ch.id] } }), sp = st && E.stepSpec(G, st);
    if (st) E.applyStep(G, st, Object.assign({}, sp.defaults, { t: [dm.id] }));
    const rest = G.night.steps.slice(G.night.i);
    ok('Дурманщик убит ночью, потом Ловчий превратил Девицу — шаги знакомства злых этой ночью остались', !pg.alive && dm.role !== 'damsel'
      && rest.some(s => s.meet && s.id === 'minioninfo') && rest.some(s => s.meet && s.id === 'demoninfo'), rest.map(s => s.key).join(','));

    const T = game(['chef', 'empath', 'monk', 'soldier', 'saint', 'poisoner', 'imp'], 'tb');
    const gn = E.addTraveller(T, 'Гном', 'gnome', 'good'), gg = E.addTraveller(T, 'Гангстер', 'gangster', 'evil'), ck = E.addTraveller(T, 'Хохотун', 'cacklejack', 'good');
    E.autoSetup(T, true); E.startGame(T);
    const am = E.gnomeAmigo(T, gn);
    ok('Гном: друг — игрок его стороны, с жетоном «Друг Гнома»', am && am !== gn && am.align === gn.align && E.hasTok(am, 'amigo', 'gnome'));
    runNight(T, { poisoner: { t: [byRole(T, 'chef').id] } });
    const nominator = T.players.find(p => p.alive && p !== am && p !== gn && !E.isTraveller(p) && p.role !== 'soldier');
    E.nominate(T, nominator.id, am.id); E.gnomeKill(T, gn.id, nominator.id);
    ok('Гном убивает номинировавшего друга', !nominator.alive);
    const nb = E.aliveNeighbours(T, gg); E.gangsterKill(T, gg.id, nb[0].id);
    ok('Гангстер: сосед умирает, способность на сегодня потрачена', !nb[0].alive || /не умирает|защищ/.test(JSON.stringify(T.log.slice(-2))), nb[0].name);
    const safe = T.players.find(p => p.alive && !E.isTraveller(p)); E.cacklejackPick(T, ck.id, safe.id);
    ok('Хохотун: выбранный днём получает «НЕ Я»', E.hasTok(safe, 'notme', 'cacklejack'));
    E.endDay(T);
    const cst = runUntil(T, 'cacklejack', {}), csp = cst && E.stepSpec(T, cst);
    // любой другой игрок, кроме «НЕ Я» и самого Хохотуна (раньше брался Повар — а «НЕ Я» по жребию мог достаться ему же)
    const okT = csp && csp.active && !csp.inputs[0].filter(safe) && csp.inputs[0].filter(T.players.find(p => p !== safe && p !== ck && !E.isTraveller(p)));
    const vic = T.players.find(p => p !== safe && p !== ck && p.role === 'empath') || T.players.find(p => p !== safe && p !== ck && !E.isTraveller(p));
    if (cst) E.applyStep(T, cst, { t: [vic.id], r: 'washerwoman' });
    ok('Хохотун: ночью роль меняет не «НЕ Я»; новая роль, сторона прежняя', okT && vic.role === 'washerwoman' && !E.hasTok(safe, 'notme', 'cacklejack'), vic.role);

    // Эмпат отравлен, оба соседа злые: ложь — не 3 (возможно 0–2)
    let bad = 0;
    for (let k = 0; k < 30; k++) {
      const Q = game(['poisoner', 'empath', 'imp', 'chef', 'monk', 'soldier', 'saint'], 'tb'); E.autoSetup(Q, true); E.startGame(Q);
      const qs = runUntil(Q, 'empath', { poisoner: { t: [byRole(Q, 'empath').id] } }), qsp = qs && E.stepSpec(Q, qs);
      if (!qsp || qsp.defaults.n > 2 || qsp.defaults.n < 0) bad++;
    }
    ok('Отравленный Эмпат: ложное число — только возможное (0–2)', bad === 0, `плохих: ${bad}`);
  }

  // 41. заметки пользователя 2026-10-28: Странник узнаёт сторону (шаг ночи / карточка дня), друг Гнома выбирается при входе
  {
    const G = game(['chef', 'empath', 'monk', 'soldier', 'saint', 'poisoner', 'imp'], 'tb');
    const gb = E.addTraveller(G, 'Добрый', 'beggar', 'good'), ev = E.addTraveller(G, 'Злой', 'gunslinger', 'evil');
    E.autoSetup(G, true); E.startGame(G);
    const keys = G.night.steps.map(s => s.key), di = keys.indexOf('demoninfo');
    ok('Странники с начала игры — шаг «Странник узнаёт сторону» в 1-ю ночь сразу после блефов Демону',
      di >= 0 && keys[di + 1] === 'trav:' + gb.id && keys[di + 2] === 'trav:' + ev.id, keys.join(','));
    const evs = E.stepSpec(G, G.night.steps[di + 2]), inf = evs.info({}), imp = byRole(G, 'imp');
    ok('Злому Страннику — жест «злой» и ЭТО ДЕМОН с Демоном, без Приспешников', evs.active && inf.tokens[0].thumb === 'down'
      && inf.tokens.some(t => t.caption === 'ЭТО ДЕМОН' && t.players.length === 1 && t.players[0] === imp.id), JSON.stringify(inf.tokens));
    const gi = E.stepSpec(G, G.night.steps[di + 1]).info({});
    ok('Доброму Страннику — только жест «добрый»', gi.tokens.length === 1 && gi.tokens[0].thumb === 'up');
    runNight(G, { poisoner: { t: [byRole(G, 'chef').id] } });
    ok('Показали — во 2-ю ночь шага нет', G.flags.travShown[gb.id] === true && G.flags.travShown[ev.id] === true);
    const late = E.addTraveller(G, 'Поздний', 'thief', 'evil');
    ok('Странник вошёл днём — сторона ещё не показана (карточка дня)', G.flags.travShown[late.id] === false);
    E.endDay(G);
    const k2 = G.night.steps.map(s => s.key);
    ok('Не показали днём — шаг этой ночью сразу после заката', k2[k2.indexOf('dusk') + 1] === 'trav:' + late.id && !k2.includes('trav:' + gb.id), k2.join(','));
    const nightly = E.addTraveller(G, 'Ночной', 'bureaucrat', 'good');
    ok('Странник вошёл ночью — шаг следующим', G.night.steps[G.night.i + 1].key === 'trav:' + nightly.id);
    ok('Шаг показа не путается с ночным шагом самого Странника', G.night.steps.filter(s => s.id === 'bureaucrat').every(s => !s.trav));

    const T = game(['chef', 'empath', 'monk', 'soldier', 'saint', 'poisoner', 'imp'], 'tb'); E.autoSetup(T, true); E.startGame(T);
    runNight(T, { poisoner: { t: [byRole(T, 'chef').id] } });
    const goodP = T.players.find(p => p.align === 'good' && p.role === 'empath'), evilP = byRole(T, 'poisoner');
    const g1 = E.addTraveller(T, 'Гном', 'gnome', 'good', null, goodP.id);
    ok('Гном: друг — выбранный при входе игрок его стороны', E.gnomeAmigo(T, g1) === goodP && E.hasTok(goodP, 'amigo', 'gnome'));
    const T2 = game(['chef', 'empath', 'monk', 'soldier', 'saint', 'poisoner', 'imp'], 'tb'); E.autoSetup(T2, true); E.startGame(T2);
    runNight(T2, { poisoner: { t: [byRole(T2, 'chef').id] } });
    const g2 = E.addTraveller(T2, 'Гном', 'gnome', 'good', null, byRole(T2, 'poisoner').id), a2 = E.gnomeAmigo(T2, g2);
    ok('Гном: выбран игрок другой стороны — друг подбирается случайно из его стороны', a2 && a2.align === 'good' && a2 !== g2, a2 && a2.name);
  }

  // 42. заметка пользователя 2026-10-28: Teensyville на 12 игроков — ролей не хватает (последняя ячейка стены пустая)
  {
    const mk = n => { const Q = E.newGame('deaddontsleep'); for (let i = 0; i < n; i++) Q.players.push(E.newPlayer('И' + i)); return Q; };
    const Q12 = mk(12), Q8 = mk(8), Q6 = mk(6);
    ok('The Dead Don\'t Sleep на 12: стена не выкатывается — не хватает ролей, хватит на 11', /не хватает ролей на 12 игроков.*на 11/.test(E.drawProblem(Q12)) && !E.randomDeal(Q12), E.drawProblem(Q12));
    ok('The Dead Don\'t Sleep на 8: ролей хватает, но предупреждение «рассчитан на 5–6»', !E.drawProblem(Q8) && /рассчитан на 5–6/.test(E.scriptOverMax(Q8)));
    ok('The Dead Don\'t Sleep на 6: ни проблем, ни предупреждения', !E.drawProblem(Q6) && !E.scriptOverMax(Q6) && !E.scriptShort(Q6));
    E.randomDeal(Q8); ok('The Dead Don\'t Sleep на 8: случайная раздача без проблем', !E.setupProblems(Q8).length, E.setupProblems(Q8).join('; '));
  }

  // 43. заметка пользователя 2026-10-29: Дитя Луны (Яга сварила из Сновидца) казнено — выбор до ночи; пьяные Дитя Луны и Растяпа
  // тоже выбирают, но ничего не происходит
  {
    const G = game(['innkeeper', 'dreamer', 'empath', 'slayer', 'savant', 'pithag', 'zombuul'], 'deaddontsleep'); E.autoSetup(G, true); E.startGame(G);
    runNight(G, {}); E.endDay(G);
    const dr = byRole(G, 'dreamer');
    runNight(G, { pithag: { t: [dr.id], r: 'moonchild' }, zombuul: { t: [] } });
    E.nominate(G, byRole(G, 'empath').id, dr.id); E.recordVote(G, dr.id, G.players.filter(p => p.alive).map(p => p.id)); E.endDay(G);
    ok('Дитя Луны от Яги казнено — день держится до его выбора', G.phase === 'day' && G.day.holdForChoice && G.flags.moonchildPending === dr.id && !G.flags.moonchildOff);
    const goodT = G.players.find(p => p.alive && p.align === 'good'); E.moonchildChoose(G, goodT.id);
    ok('Дитя Луны выбрало — цель записана', G.flags.moonchildTarget === goodT.id && !G.flags.moonchildPending);

    const Q = game(['innkeeper', 'dreamer', 'empath', 'slayer', 'moonchild', 'klutz', 'pithag', 'zombuul'], 'deaddontsleep'); E.autoSetup(Q, true); E.startGame(Q);
    const mc = byRole(Q, 'moonchild'), kl = byRole(Q, 'klutz'), ev = byRole(Q, 'pithag');
    mc.tokens.push({ k: 'drunk', src: 'innkeeper', exp: 'dusk', n: 99 }); kl.tokens.push({ k: 'drunk', src: 'innkeeper', exp: 'dusk', n: 99 });
    E.storytellerKill(Q, mc.id); E.storytellerKill(Q, kl.id);
    ok('Пьяные Дитя Луны и Растяпа всё равно выбирают (способность не работает)', Q.flags.moonchildPending === mc.id && !!Q.flags.moonchildOff && Q.flags.klutzPending === kl.id && !!Q.flags.klutzOff);
    E.moonchildChoose(Q, byRole(Q, 'empath').id); E.klutzChoose(Q, ev.id);
    ok('Пьяное Дитя Луны: выбор без цели; пьяный Растяпа выбрал злого — игра идёт', !Q.flags.moonchildTarget && !Q.result);
  }

  // 44. заметки пользователя 2026-10-30: «Роли на игру» с неверными типами не раздаются; Трактирщик — пьян тот, кого выбрали
  {
    const mk = pool => { const Q = E.newGame('deaddontsleep'); for (let i = 0; i < 6; i++) Q.players.push(E.newPlayer('И' + i)); Q.pool = pool; return Q; };
    const bad = mk(['innkeeper', 'dreamer', 'empath', 'slayer', 'klutz', 'moonchild', 'pithag'].slice(0, 5).concat(['zombuul'])); // 4 Горожанина, 1 Изгой, без Приспешника
    ok('«Роли на игру» с неверными типами: стена и раздача не идут, понятно почему', /не сходятся с раскладкой/.test(E.drawProblem(bad)) && !E.randomDeal(bad) && bad.players.every(p => !p.role), E.drawProblem(bad));
    const good = mk(['innkeeper', 'dreamer', 'empath', 'klutz', 'pithag', 'zombuul']); // 6 игроков: 3/1/1/1
    ok('«Роли на игру» по таблице — раздаются', !E.poolProblem(good) && E.randomDeal(good) && !E.setupProblems(good).length, E.poolProblem(good) + ' | ' + E.setupProblems(good).join('; '));
    const vg = mk(['innkeeper', 'dreamer', 'empath', 'slayer', 'pithag', 'vigormortis']); // Вигормортис: −1 Изгой → 4/0/1/1
    ok('«Роли на игру» с Вигормортисом (−1 Изгой) — сдвиг учтён', !E.poolProblem(vg), E.poolProblem(vg));
    const gf = mk(['innkeeper', 'dreamer', 'empath', 'klutz', 'godfather', 'zombuul']); gf.flags.mods = {};
    ok('«Роли на игру» с Крёстным Отцом без выбора сдвига — просит выбрать', /выберите/.test(E.poolProblem(gf)) || !E.poolProblem(gf), E.poolProblem(gf));

    const G = game(['innkeeper', 'dreamer', 'empath', 'slayer', 'savant', 'pithag', 'zombuul'], 'deaddontsleep'); E.autoSetup(G, true); E.startGame(G);
    runNight(G, {}); E.endDay(G);
    const ph = byRole(G, 'pithag'), dr = byRole(G, 'dreamer');
    const st = runUntil(G, 'innkeeper', {}), sp = E.stepSpec(G, st), more = sp.more({ t: [dr.id, ph.id] });
    ok('Трактирщик: «кто пьян» — кнопки с именами', more.length === 1 && more[0].options.map(o => o.l).join() === [dr.name, ph.name].join());
    E.applyStep(G, st, { t: [dr.id, ph.id], drunk: '1' });
    ok('Трактирщик: пьян выбранный (второй нажатый) — Яга, не Сновидец', !!E.abilityOff(G, ph) && !E.abilityOff(G, dr));
  }

  // 45. проверка Банши по вики (просьба пользователя 2026-10-30)
  {
    const G = game(['banshee', 'chef', 'empath', 'monk', 'soldier', 'poisoner', 'imp'], 'nachtmahr'); E.autoSetup(G, true); E.startGame(G);
    const b = byRole(G, 'banshee'), imp = byRole(G, 'imp');
    ok('Живая Банши голосует и номинирует как все (вес 1)', E.voteWeight(G, b) === 1 && !E.bansheeVotes(G, b));
    runNight(G, { poisoner: { t: [byRole(G, 'chef').id] } }); E.endDay(G);
    runNight(G, { imp: { t: [b.id] }, poisoner: { t: [byRole(G, 'chef').id] } });
    ok('Банши убита Демоном: «есть способность», объявление на рассвете, голос мёртвой — 2', !b.alive && E.hasTok(b, 'hasability', 'banshee') && E.bansheeVotes(G, b) && E.voteWeight(G, b) === 2);
    ok('Банши подняла одну руку — 1 голос', E.voteCount(G, [b.id], [b.id]) === 1 && E.voteCount(G, [b.id], []) === 2);
    const on = G.players.find(p => p.alive && p !== imp); E.nominate(G, b.id, on.id); E.recordVote(G, on.id, [b.id], []);
    ok('Мёртвая Банши голосует без траты голоса призрака', b.ghost === true);
    E.revive(G, b, 'Рассказчик воскрешает');
    ok('Воскрешённая Банши — как обычный живой игрок (метки нет, вес 1)', b.alive && !E.hasTok(b, 'hasability', 'banshee') && E.voteWeight(G, b) === 1);

    const Q = game(['banshee', 'chef', 'empath', 'monk', 'soldier', 'poisoner', 'imp'], 'nachtmahr'); E.autoSetup(Q, true); E.startGame(Q);
    const qb = byRole(Q, 'banshee'); runNight(Q, { poisoner: { t: [byRole(Q, 'chef').id] } });
    E.nominate(Q, byRole(Q, 'chef').id, qb.id); E.recordVote(Q, qb.id, Q.players.filter(p => p.alive).map(p => p.id)); E.endDay(Q);
    ok('Казнённая Банши — без способности, голос призрака тратится', !qb.alive && !E.hasTok(qb, 'hasability', 'banshee') && E.voteWeight(Q, qb) === 1);
  }

  for (const k of Object.keys(DATA.scripts)) ok('сценарий ' + k + ' — все роли в данных', DATA.scripts[k].roles.every(r => DATA.roles[r]));
} catch (e) { results.push('ERROR ' + e.message + '\n' + e.stack); }

document.getElementById('out').textContent = results.join('\n');
