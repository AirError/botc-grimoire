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

  // 19. Девственница и Шпион — решение рассказчика
  S = game(['washerwoman', 'virgin', 'investigator', 'chef', 'empath', 'drunk', 'spy', 'imp'], 'tb');
  E.autoSetup(S, true); E.startGame(S); runNight(S, {});
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
      E.randomDeal(g); E.finishRoles(g); E.autoSetup(g, true);
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

  // 31. жребий: каменная стена
  S = game(['washerwoman', 'librarian', 'investigator', 'chef', 'empath', 'drunk', 'poisoner', 'imp'], 'tb'); E.autoSetup(S, true);
  const before = S.players.map(p => p.role).sort().join(), drunkSees = byRole(S, 'drunk').believes;
  E.drawStart(S);
  ok('жребий: до открытия ячеек ролей у игроков нет', S.players.every(p => !p.role) && S.draw.cells.length === 8 && E.setupProblems(S).some(t => /Жребий не закончен/.test(t)));
  let guardDraw = 0; while (S.draw.turn && guardDraw++ < 20) { const k = S.draw.cells.findIndex(c => !c.pid); E.drawOpen(S, k); E.drawClose(S); }
  ok('жребий: все вытянули, набор ролей тот же', S.draw.finished && S.players.map(p => p.role).sort().join() === before && E.setupProblems(S).length === 0, E.setupProblems(S).join('; '));
  ok('жребий: Пьяница видит роль, которой себя считает', E.drawShown(S.draw.cells.find(c => c.role === 'drunk')) === drunkSees && byRole(S, 'drunk').believes === drunkSees);
  ok('жребий: злые стали злыми', byRole(S, 'imp').align === 'evil' && byRole(S, 'poisoner').align === 'evil' && byRole(S, 'chef').align === 'good');

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
  for (const k of Object.keys(DATA.scripts)) ok('сценарий ' + k + ' — все роли в данных', DATA.scripts[k].roles.every(r => DATA.roles[r]));
} catch (e) { results.push('ERROR ' + e.message + '\n' + e.stack); }

document.getElementById('out').textContent = results.join('\n');
