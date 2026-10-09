'use strict';
/* Подсказки рассказчику для ролей, где он сам придумывает содержание: Амнезиак (способность), Савант (2 факта:
   правда и ложь), Рыбак (совет), Мецефель (тайное слово). Принципы — с вики (страницы ролей, How to Run):
   способность Амнезиака угадываемая и чуть сильнее обычного Горожанина; факты Саванта полезные, как информация
   Горожан, Демона прямо не называют; совет Рыбаку — что ДЕЛАТЬ, а не что ЕСТЬ; тайное слово — необычное. */
const IDEAS = (() => {
  const E = ENGINE;

  // Амнезиак: первые два — примеры с вики, остальные — по её принципам (похожи на способности Горожан, их можно угадать)
  const AMNESIAC = [
    'Каждую ночь выберите 2 игроков: вы узнаёте, есть ли среди них Приспешник.',
    'Каждую ночь вы узнаёте, сколько из ваших живых соседей — Горожане.',
    'Каждую ночь вы узнаёте, сколько злых среди ваших соседей — живых и мёртвых.',
    'Каждую ночь выберите игрока: вы узнаёте его тип роли (Горожанин, Изгой, Приспешник или Демон).',
    'Каждую ночь выберите игрока: вы узнаёте, пьян ли он или отравлен.',
    'Каждую ночь вы узнаёте, голосовал ли сегодня Демон.',
    'Каждую ночь вы узнаёте, номинировали ли сегодня злого игрока.',
    'Каждую ночь, кроме первой, выберите 2 игроков: вы узнаёте, одной ли они стороны.',
    'Каждую ночь вы узнаёте, сколько злых среди живых игроков.',
    'Каждую ночь вы узнаёте, сидит ли Демон не дальше 3 мест от вас.',
    'В первую ночь вы узнаёте 3 игроков, ровно 1 из которых злой.',
    'Каждую ночь вы узнаёте роль одного из мёртвых игроков.',
    'Когда умирает добрый игрок, ночью вы узнаёте его роль.',
    'Каждую ночь выберите игрока (не себя): этой ночью он не может умереть от Демона.',
    'Раз за игру днём публично выберите игрока: если это Приспешник, он умирает.',
    'Если Демон выбирает вас ночью, вы не умираете и узнаёте, кто Демон (раз за игру).',
    'Вы не можете умереть ночью, пока жив хотя бы один Изгой.',
    'Если вас казнят, Демон не убивает следующей ночью.',
    'Каждую ночь выберите игрока: если это Демон, вы узнаёте «да» (без ложной цели), но только через ночь.',
    'Каждую ночь вы узнаёте, в какой стороне от вас (слева или справа по кругу) ближе сидит злой игрок.',
  ];

  // Мецефель: необычные слова, которые не скажут случайно (вики: «Румпельштильцхен», «Константинополь»)
  const MEZ_WORDS = ['Румпельштильцхен', 'Константинополь', 'Тимбукту', 'Синхрофазотрон', 'Катавасия', 'Фантасмагория',
    'Тарабарщина', 'Кукарямба', 'Монпансье', 'Лимпопо', 'Абракадабра', 'Квинтэссенция', 'Бонбоньерка', 'Пертурбация',
    'Галиматья', 'Ихтиозавр', 'Шпингалет', 'Чебурек', 'Перламутр', 'Зюзюка', 'Мадагаскар', 'Трансцендентный'];

  const shuffle = E.shuffle, pickOne = a => a[Math.floor(Math.random() * a.length)];
  const coreOf = S => S.players.filter(p => !E.isTraveller(p));
  const join = ps => ps.map(p => p.name).join(', ').replace(/, ([^,]*)$/, ' и $1');
  const evil = p => p.align === 'evil';
  const team = p => E.realTeam(p);
  const seatNb = (S, p) => { const ps = coreOf(S), i = ps.indexOf(p), n = ps.length; return n < 2 ? [] : [ps[(i - 1 + n) % n], ps[(i + 1) % n]]; };
  const near = (k, lo, hi) => { const c = [k - 1, k + 1].filter(x => x >= lo && x <= hi); return c.length ? pickOne(c) : k; };

  // Савант: шаблоны фактов из текущей игры; каждый даёт пару «правда / ложь» одной формы
  function savantTemplates(S, sv) {
    const core = coreOf(S), others = core.filter(p => p.id !== sv.id), demon = core.find(E.isDemon), alive = core.filter(p => p.alive);
    const noDemon = others.filter(p => !E.isDemon(p));
    const T = [
      () => { const ps = shuffle(others).slice(0, 3); if (ps.length < 3) return null; const k = ps.filter(evil).length;
        return { yes: `Среди игроков ${join(ps)} злых: ${k}.`, no: `Среди игроков ${join(ps)} злых: ${near(k, 0, 3)}.` }; },
      () => { const [a, b] = shuffle(others); if (!b) return null; const s = a.align === b.align;
        return { yes: `${a.name} и ${b.name} — ${s ? 'одной стороны' : 'разных сторон'}.`, no: `${a.name} и ${b.name} — ${s ? 'разных сторон' : 'одной стороны'}.` }; },
      () => { const k = core.filter(p => team(p) === 'outsider').length; return { yes: `Изгоев в игре: ${k}.`, no: `Изгоев в игре: ${near(k, 0, 5)}.` }; },
      () => { if (!demon) return null; const y = seatNb(S, demon).some(p => team(p) === 'minion');
        return { yes: y ? 'Демон сидит рядом с Приспешником.' : 'Демон не сидит рядом ни с одним Приспешником.', no: y ? 'Демон не сидит рядом ни с одним Приспешником.' : 'Демон сидит рядом с Приспешником.' }; },
      () => { const a = pickOne(others); if (!a) return null; const y = seatNb(S, a).some(evil);
        return { yes: y ? `Хотя бы один сосед игрока ${a.name} — злой.` : `Оба соседа игрока ${a.name} — добрые.`, no: y ? `Оба соседа игрока ${a.name} — добрые.` : `Хотя бы один сосед игрока ${a.name} — злой.` }; },
      () => { const k = alive.filter(evil).length; return { yes: `Среди живых злых игроков: ${k}.`, no: `Среди живых злых игроков: ${near(k, 0, alive.length)}.` }; },
      () => { const a = pickOne(noDemon); if (!a) return null; const ty = team(a), wrong = pickOne(['townsfolk', 'outsider', 'minion'].filter(x => x !== ty));
        return { yes: `${a.name} — ${E.TEAM_RU[ty]}.`, no: `${a.name} — ${E.TEAM_RU[wrong]}.` }; },
      () => { const inPl = core.filter(p => !E.isDemon(p)).map(p => p.role), out = S.script.roles.filter(r => !core.some(p => p.role === r) && !S.bluffs.includes(r));
        if (!inPl.length || !out.length) return null; return { yes: `Роль «${E.rname(pickOne(inPl))}» есть в игре.`, no: `Роль «${E.rname(pickOne(out))}» есть в игре.` }; },
      () => { const ps = coreOf(S), i = ps.indexOf(sv), n = ps.length; let cw = 0, ccw = 0;
        for (let k = 1; k < n && !cw; k++) if (evil(ps[(i + k) % n])) cw = k;
        for (let k = 1; k < n && !ccw; k++) if (evil(ps[(i - k + n) % n])) ccw = k;
        if (!cw || cw === ccw) return null; const r = cw < ccw;
        return { yes: `Ближайший к тебе злой игрок сидит ${r ? 'по часовой стрелке' : 'против часовой стрелки'}.`, no: `Ближайший к тебе злой игрок сидит ${r ? 'против часовой стрелки' : 'по часовой стрелке'}.` }; },
      () => { const a = pickOne(others.filter(p => p.alive)); if (!a) return null; const y = !!E.abilityOff(S, a) && a.role !== 'lunatic';
        return { yes: y ? `${a.name} сейчас пьян или отравлен.` : `${a.name} сейчас трезв и здоров.`, no: y ? `${a.name} сейчас трезв и здоров.` : `${a.name} сейчас пьян или отравлен.` }; },
      () => { const last = S.flags.abnPrev; if (!last || S.n < 2) return null; const y = !last.length;
        return { yes: y ? 'Со вчерашнего утра у всех способности сработали как надо.' : 'Со вчерашнего утра чья-то способность сработала не так, как должна (ложная информация или сбой).',
          no: y ? 'Со вчерашнего утра чья-то способность сработала не так, как должна (ложная информация или сбой).' : 'Со вчерашнего утра у всех способности сработали как надо.' }; },
      () => { const ps = coreOf(S), i = ps.indexOf(sv), n = ps.length; const three = [1, 2, 3].map(k => ps[(i + k) % n]).filter(p => p !== sv); const k = three.filter(evil).length;
        return { yes: `Среди трёх игроков по часовой стрелке от тебя злых: ${k}.`, no: `Среди трёх игроков по часовой стрелке от тебя злых: ${near(k, 0, 3)}.` }; },
      () => { const [a, b] = shuffle(others); if (!b) return null; const y = !evil(a) && !evil(b);
        return { yes: y ? `${a.name} и ${b.name} — оба добрые.` : `Хотя бы один из игроков ${a.name} и ${b.name} — злой.`, no: y ? `Хотя бы один из игроков ${a.name} и ${b.name} — злой.` : `${a.name} и ${b.name} — оба добрые.` }; },
      () => { if (!demon || demon === sv) return null; const rest = shuffle(others.filter(p => p !== demon));
        if (rest.length < 4) return null; const withD = shuffle([demon, ...rest.slice(0, 3)]), without = rest.slice(0, 4);
        return { yes: `Демон — один из: ${join(withD)}.`, no: `Демон — один из: ${join(without)}.` }; },
      () => { const y = seatNb(S, sv).some(p => team(p) === 'minion');
        return { yes: y ? 'Рядом с тобой сидит Приспешник.' : 'Рядом с тобой не сидит ни один Приспешник.', no: y ? 'Рядом с тобой не сидит ни один Приспешник.' : 'Рядом с тобой сидит Приспешник.' }; },
      () => { const k = alive.filter(p => team(p) === 'minion').length; return { yes: `Живых Приспешников: ${k}.`, no: `Живых Приспешников: ${near(k, 0, 4)}.` }; },
      () => { const ps = coreOf(S), n = ps.length; let k = 0; for (let i = 0; i < n; i++) if (evil(ps[i]) && evil(ps[(i + 1) % n])) k++;
        return { yes: `Пар злых соседей в круге: ${k}.`, no: `Пар злых соседей в круге: ${near(k, 0, 3)}.` }; },
      () => { const ev = noDemon.filter(evil), gd = noDemon.filter(p => !evil(p)); if (!ev.length || !gd.length) return null;
        return { yes: `${pickOne(ev).name} — злой.`, no: `${pickOne(gd).name} — злой.` }; },
      () => { if (!demon) return null; const y = seatNb(S, demon).some(p => team(p) === 'outsider');
        return { yes: y ? 'Рядом с Демоном сидит Изгой.' : 'Рядом с Демоном не сидит ни один Изгой.', no: y ? 'Рядом с Демоном не сидит ни один Изгой.' : 'Рядом с Демоном сидит Изгой.' }; },
      () => { if (!S.script.roles.includes('drunk')) return null; const y = core.some(p => p.role === 'drunk');
        return { yes: y ? 'Пьяница в игре.' : 'Пьяницы в игре нет.', no: y ? 'Пьяницы в игре нет.' : 'Пьяница в игре.' }; },
    ];
    return T;
  }
  // пара фактов разных шаблонов: один правдивый, другой ложный, порядок случайный
  function savantPair(S, svId) {
    const sv = E.P(S, svId); if (!sv) return null;
    const res = shuffle(savantTemplates(S, sv)).map(f => { try { return f(); } catch (e) { return null; } }).filter(Boolean);
    if (res.length < 2) return null;
    const pair = [{ text: res[0].yes, truth: true }, { text: res[1].no, truth: false }];
    return Math.random() < 0.5 ? pair : pair.reverse();
  }

  // Рыбак: советы, что делать, по текущей игре (вики: «что ДЕЛАТЬ, а не что ЕСТЬ»; не называть Демона напрямую)
  function fishermanAdvice(S, fmId) {
    const core = coreOf(S), fm = E.P(S, fmId), alive = core.filter(p => p.alive && p !== fm), out = [];
    const add = t => { if (!out.includes(t)) out.push(t); };
    for (const p of alive.filter(p => !evil(p) && team(p) === 'townsfolk' && E.abilityOff(S, p))) add(`Не доверяйте информации игрока ${p.name}.`);
    const dr = core.find(p => p.role === 'drunk');
    if (dr && dr.believes) add(`Не верьте тому, кто называет себя «${E.rname(dr.believes)}».`);
    if (dr) add('Найдите Пьяницу: один из Горожан ошибается в своей роли.');
    const minions = alive.filter(p => team(p) === 'minion'), goods = alive.filter(p => !evil(p));
    if (minions.length) { const m = pickOne(minions); add(`Казните игрока ${m.name}.`); const g = pickOne(goods); if (g) add(`Казните одного из двоих: ${shuffle([m, g]).map(p => p.name).join(' или ')}.`); }
    for (const p of goods.filter(p => ['mayor', 'slayer', 'virgin', 'ravenkeeper', 'sage', 'oracle', 'tealady', 'monk', 'fortuneteller', 'undertaker'].includes(p.role))) add(`Сохраните жизнь игроку ${p.name}.`);
    for (const p of alive.filter(p => p.role === 'saint')) add(`Ни в коем случае не казните игрока ${p.name}.`);
    if (core.some(p => p.role === 'vortox' && p.alive)) add('Каждый день обязательно кого-нибудь казните.');
    if (core.some(p => p.role === 'mayor' && p.alive)) add('Если в живых останется трое — не казните никого.');
    const trusted = goods.filter(p => team(p) === 'townsfolk' && !E.abilityOff(S, p));
    if (trusted.length) add(`Доверяйте игроку ${pickOne(trusted).name}.`);
    const demon = core.find(p => E.isDemon(p) && p.alive);
    if (demon) { const nb = seatNb(S, demon).filter(p => p.alive && p !== fm); if (nb.length) add(`Присмотритесь к соседям игрока ${pickOne(nb).name}.`); }
    if (alive.some(p => team(p) === 'outsider' && !evil(p))) add('Держите живыми тех, кто называет себя Изгоями.');
    if (core.some(p => p.role === 'witch')) add('Не спешите номинировать первым: Ведьма могла вас проклясть.');
    if (core.some(p => p.role === 'scarletwoman') && alive.length >= 5) add('Казнив Демона, не расслабляйтесь: его место может занять Приспешник.');
    if (core.some(p => p.role === 'vigormortis')) add('Не тратьте казни на Приспешников — ищите Демона.');
    add('Не обращайте внимания на Приспешников — ищите Демона.');
    add('Прежде чем казнить, соберите сведения всех Горожан.');
    add('Сравните, кто кого номинировал в первый день.');
    return out;
  }

  return { AMNESIAC, MEZ_WORDS, savantPair, fishermanAdvice };
})();
