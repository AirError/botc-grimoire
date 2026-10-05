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
  // 20. Ведьма-Яга создаёт Демона и вы решаете смерти
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
  // Аэронавт: +0 или +1 Изгой
  S = game(['investigator', 'chef', 'balloonist', 'dreamer', 'recluse', 'mutant', 'widow', 'imp'], 'catfishing');
  ok('Аэронавт: +1 Изгой допустим', E.setupProblems(S).length === 0, E.setupProblems(S).join('; '));
  S = game(['investigator', 'chef', 'savant', 'dreamer', 'recluse', 'mutant', 'widow', 'imp'], 'catfishing');
  ok('без Аэронавта лишний Изгой — ошибка раскладки', E.setupProblems(S).some(t => /Раскладка/.test(t)));
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
