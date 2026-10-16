'use strict';
/* Подсказки рассказчику для ролей, где он сам придумывает содержание: Амнезиак (способность), Савант (2 факта:
   правда и ложь; часть шаблонов — от пользователя, 2026-10-16), Рыбак (совет), Мецефель (тайное слово). Принципы — с вики (страницы ролей, How to Run):
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
  // что показать Амнезиаку на экране для каждой способности из списка (по порядку; заметка пользователя 2026-10-15):
  // yesno — ДА/НЕТ, number — число, role — жетон роли, player — указать на игроков, text — свой текст, none — ничего
  const AMNESIAC_KIND = ['yesno', 'number', 'number', 'text', 'yesno', 'yesno', 'yesno', 'yesno', 'number', 'yesno',
    'player', 'role', 'role', 'none', 'none', 'player', 'none', 'none', 'yesno', 'text'];

  // Мецефель: необычные слова, которые не скажут случайно (вики: «Румпельштильцхен», «Константинополь»)
  const MEZ_WORDS = ['Румпельштильцхен', 'Константинополь', 'Тимбукту', 'Синхрофазотрон', 'Катавасия', 'Фантасмагория',
    'Тарабарщина', 'Кукарямба', 'Монпансье', 'Лимпопо', 'Абракадабра', 'Квинтэссенция', 'Бонбоньерка', 'Пертурбация',
    'Галиматья', 'Ихтиозавр', 'Шпингалет', 'Чебурек', 'Перламутр', 'Зюзюка', 'Мадагаскар', 'Трансцендентный'];

  const shuffle = E.shuffle, pickOne = a => a[Math.floor(Math.random() * a.length)];
  const coreOf = S => S.players.filter(p => !E.isTraveller(p));
  const join = ps => ps.map(p => p.name).join(', ').replace(/, ([^,]*)$/, ' и $1');
  const evil = p => p.align === 'evil';
  const team = p => E.realTeam(p);
  // места за столом — все игроки по номерам, вместе со Странниками (соседи — как у Эмпата и Повара). at(S, p, k) — k-й игрок
  // по часовой стрелке от p (k < 0 — против). Номера идут по часовой или против (S.flags.seatDir); по часовой — значит слева
  // от сидящего лицом в круг
  const at = (S, p, k) => { const ps = S.players, n = ps.length, d = S.flags.seatDir === 'ccw' ? -1 : 1; return ps[((ps.indexOf(p) + d * k) % n + n) % n]; };
  const seatNb = (S, p) => S.players.length < 2 ? [] : [at(S, p, -1), at(S, p, 1)];
  // ложное число рядом с верным, в пределах [lo, hi]; такого нет — null (шаблон не годится: ложь была бы очевидной)
  const near = (k, lo, hi) => { const c = [k - 1, k + 1].filter(x => x >= lo && x <= hi); return c.length ? pickOne(c) : null; };
  // пара «правда / ложь»: yn — утверждение да/нет (y — верно ли a, иначе верно b); num — число k и ложное f в одной фразе
  const yn = (y, a, b) => y ? { yes: a, no: b } : { yes: b, no: a };
  const num = (k, f, text) => f === null ? null : { yes: text(k), no: text(f) };
  // «на местах с 1 по 6 сидят ровно два Приспешника»
  const NOUN = { minion: ['Приспешник', 'Приспешника', 'Приспешников'], outsider: ['Изгой', 'Изгоя', 'Изгоев'] };
  const NUMW = ['', 'ровно один', 'ровно два', 'ровно три', 'ровно четыре'];
  const seatsText = (a, b, t, k) => !k ? `На местах с ${a} по ${b} нет ни одного ${NOUN[t][1]}.`
    : `На местах с ${a} по ${b} ${k === 1 ? 'сидит' : 'сидят'} ${NUMW[k] || 'ровно ' + k} ${NOUN[t][k === 1 ? 0 : k < 5 ? 1 : 2]}.`;
  // «в X номинациях прошедшего дня был задействован хотя бы один злой игрок» (пользователь, 2026-10-16)
  const ofN = n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'номинации' : 'номинаций'}`;
  const nomText = (k, n) => n === 1 ? `Вчера в единственной номинации ${k ? '' : 'не '}участвовал злой игрок (${k ? 'номинировавший или номинированный' : 'ни номинировавший, ни номинированный'}).`
    : k ? `Вчера злой игрок (номинировавший или номинированный) участвовал в ${k} из ${ofN(n)}.`
      : `Вчера ни в одной из ${ofN(n)} не участвовал злой игрок (ни номинировавший, ни номинированный).`;

  // Савант: шаблоны фактов из текущей игры; каждый даёт пару «правда / ложь» одной формы. Ложь — правдоподобная: не выходит
  // за то, что игроки и так знают (сколько Приспешников и злых по таблице, сколько Изгоев в сценарии). У шаблона есть группа g —
  // так факты разложены в списке на вкладке «Гримуар» (заметка пользователя 2026-10-16). Часть шаблонов — от пользователя (2026-10-16)
  const GROUPS = ['Игроки', 'Соседи и места', 'Вы', 'Роли и раскладка', 'Вчера и прошлая ночь', 'Вся игра'];
  // способности «раз за игру» (по тексту способности) и флаг, которым приложение отмечает трату (флаг + id игрока);
  // Ночной Дозорный, Художник и Волшебник трату не отмечают — с ними факты о трате не строятся
  const ONCE = ['engineer', 'nightwatchman', 'courtier', 'seamstress', 'philosopher', 'huntsman', 'professor', 'artist', 'slayer', 'fisherman',
    'golem', 'puzzlemaster', 'assassin', 'wizard', 'bonecollector'];
  const ONCE_FLAG = { engineer: 'engineer_', courtier: 'courtier_', seamstress: 'seamstress_', philosopher: 'philosopher_', huntsman: 'huntsman_',
    professor: 'professor_', slayer: 'slayerUsed_', fisherman: 'fishUsed_', golem: 'golemUsed_', puzzlemaster: 'puzzleUsed_', assassin: 'assassin_',
    bonecollector: 'bonecollector_' };
  // роли, способные передать Демона другому игроку; роли, от которых кто-то бывает пьян или отравлен
  const MOVERS = ['imp', 'scarletwoman', 'fanggu', 'snakecharmer', 'barber', 'pithag', 'lilmonsta', 'summoner'];
  const DROISON = ['poisoner', 'sailor', 'innkeeper', 'courtier', 'minstrel', 'goon', 'pukka', 'philosopher', 'sweetheart', 'nodashii', 'vigormortis',
    'snakecharmer', 'widow', 'puzzlemaster', 'lleech'];
  const ACC = { townsfolk: 'Горожанина', outsider: 'Изгоя', minion: 'Приспешника', demon: 'Демона' };
  const pl = (n, f) => f[n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2];
  const cap = s => s[0].toUpperCase() + s.slice(1);
  const holder = r => `обладатель роли «${E.rname(r)}»`;
  // расстояние по кругу (соседи — 1)
  const dist = (S, a, b) => { const n = S.players.length, d = Math.abs(S.players.indexOf(a) - S.players.indexOf(b)); return Math.min(d, n - d); };
  const isDemonRole = r => DATA.roles[r] && DATA.roles[r].team === 'demon';

  function savantTemplates(S, sv) {
    const core = coreOf(S), others = core.filter(p => p.id !== sv.id), demon = core.find(E.isDemon), alive = core.filter(p => p.alive);
    const noDemon = others.filter(p => !E.isDemon(p)), nEvil = core.filter(evil).length, nMin = core.filter(p => team(p) === 'minion').length;
    const scriptOut = E.scriptOutsiders(S), half = Math.floor(S.players.length / 2), H = S.flags.hist;
    const outs = core.filter(p => team(p) === 'outsider'), mins = core.filter(p => team(p) === 'minion');
    // прошлая ночь (днём; записи с этой версии приложения — pv)
    const NG = S.phase === 'day' && S.night && S.night.data && S.night.data.pv ? S.night.data : null;
    // ложь «злых среди троих» — не больше 2 и не больше, чем злых в игре (заметки пользователя 2026-10-14 и 2026-10-16:
    // «3 из 3 злые — слишком очевидная ложь»)
    const lie3 = k => near(k, 0, Math.min(2, S.players.filter(evil).length));
    // роли сценария в игре и не в игре (без Демонов — о них свой факт; без своей роли Саванта и Пьяницы — у него свой факт)
    const inPl = [...new Set(core.filter(p => !E.isDemon(p) && p.role !== sv.role && p.role !== 'drunk').map(p => p.role))];
    const outPl = S.script.roles.filter(r => DATA.roles[r] && !isDemonRole(r) && r !== 'drunk' && !core.some(p => p.role === r));
    const T = [], add = (g, f) => { f.g = g; T.push(f); };
    // на местах с a по b (номера мест, как в кругах приложения) — сколько ролей типа t
    const range = t => () => {
      const ps = S.players, n = ps.length, L = Math.round(n / 2); if (n < 5) return null;
      const a = 1 + Math.floor(Math.random() * (n - L + 1)), b = a + L - 1, tot = core.filter(p => team(p) === t).length;
      const k = ps.slice(a - 1, b).filter(p => team(p) === t).length;
      return num(k, near(k, 0, t === 'minion' ? Math.min(L, tot) : Math.min(L, Math.max(1, tot), scriptOut)), k => seatsText(a, b, t, k));
    };

    // — Игроки
    add('Игроки', () => { const ps = shuffle(others).slice(0, 3); if (ps.length < 3) return null; const k = ps.filter(evil).length;
      return num(k, lie3(k), k => `Среди игроков ${join(ps)} злых: ${k}.`); });
    add('Игроки', () => { const [a, b] = shuffle(others); if (!b) return null;
      return yn(a.align === b.align, `${a.name} и ${b.name} — одной стороны.`, `${a.name} и ${b.name} — разных сторон.`); });
    add('Игроки', () => { const [a, b] = shuffle(others); if (!b) return null;
      return yn(!evil(a) && !evil(b), `${a.name} и ${b.name} — оба добрые.`, `Хотя бы один из игроков ${a.name} и ${b.name} — злой.`); });
    add('Игроки', () => { const a = pickOne(noDemon); if (!a) return null; const ty = team(a), wrong = pickOne(['townsfolk', 'outsider', 'minion'].filter(x => x !== ty));
      return { yes: `${a.name} — ${E.TEAM_RU[ty]}.`, no: `${a.name} — ${E.TEAM_RU[wrong]}.` }; });
    add('Игроки', () => { const ev = noDemon.filter(evil), gd = noDemon.filter(p => !evil(p)); if (!ev.length || !gd.length) return null;
      return { yes: `${pickOne(ev).name} — злой.`, no: `${pickOne(gd).name} — злой.` }; });
    add('Игроки', () => { if (!demon || demon === sv) return null; const rest = shuffle(others.filter(p => p !== demon));
      if (rest.length < 4) return null; const withD = shuffle([demon, ...rest.slice(0, 3)]), without = rest.slice(0, 4);
      return { yes: `Демон — один из: ${join(withD)}.`, no: `Демон — один из: ${join(without)}.` }; });
    add('Игроки', () => { const a = pickOne(others.filter(p => p.alive)); if (!a) return null;
      return yn(!!E.droisoned(S, a), `${a.name} сейчас пьян или отравлен.`, `${a.name} сейчас трезв и здоров.`); });

    // — Соседи и места
    add('Соседи и места', () => { const a = pickOne(others); if (!a) return null;
      return yn(seatNb(S, a).some(evil), `Хотя бы один сосед игрока ${a.name} — злой.`, `Оба соседа игрока ${a.name} — добрые.`); });
    // «(Живые) соседи [х] / ваши соседи — в одной команде» (пользователь, 2026-10-16): соседи как у Эмпата — ближайшие живые
    add('Соседи и места', () => { const a = pickOne(core); if (!a) return null; const nb = E.aliveNeighbours(S, a); if (nb.length < 2) return null;
      const me = a === sv, dead = seatNb(S, a).some(p => !p.alive);
      const who = me ? (dead ? 'Ваши ближайшие живые соседи' : 'Ваши соседи') : dead ? `Ближайшие живые соседи игрока ${a.name}` : `Соседи игрока ${a.name}`;
      return yn(nb[0].align === nb[1].align, `${who} — одной стороны.`, `${who} — разных сторон.`); });
    add('Соседи и места', () => { if (S.players.length < 4) return null;
      return yn(!S.players.some(p => seatNb(S, p).every(evil)), 'У каждого игрока хотя бы один сосед — добрый.', 'У кого-то из игроков оба соседа — злые.'); });
    add('Соседи и места', () => { if (!demon) return null;
      return yn(seatNb(S, demon).some(p => team(p) === 'minion'), 'Демон сидит рядом с Приспешником.', 'Демон не сидит рядом ни с одним Приспешником.'); });
    add('Соседи и места', () => { if (!demon) return null;
      return yn(seatNb(S, demon).some(p => team(p) === 'outsider'), 'Рядом с Демоном сидит Изгой.', 'Рядом с Демоном не сидит ни один Изгой.'); });
    add('Соседи и места', () => { if (!demon) return null; const k = seatNb(S, demon).filter(p => team(p) === 'townsfolk').length;
      return num(k, pickOne([0, 1, 2].filter(x => x !== k)), k => !k ? 'Рядом с Демоном не сидит ни один Горожанин.' : k === 1 ? 'Рядом с Демоном сидит один Горожанин.' : 'Рядом с Демоном сидят два Горожанина.'); });
    add('Соседи и места', () => { const ps = S.players, e = ps.filter(evil).length; let k = 0; for (const p of ps) if (evil(p) && evil(at(S, p, 1))) k++;
      return num(k, near(k, 0, Math.max(0, e - 1)), k => `Пар злых соседей за столом: ${k}.`); });
    add('Соседи и места', range('minion'));
    add('Соседи и места', range('outsider'));
    // «есть пара Приспешников на расстоянии N»: ложь — расстояние, на котором не сидит ни одна пара
    add('Соседи и места', () => { if (mins.length < 2) return null; const ds = [];
      for (let i = 0; i < mins.length; i++) for (let j = i + 1; j < mins.length; j++) ds.push(dist(S, mins[i], mins[j]) - 1);
      const f = pickOne([...Array(half).keys()].filter(x => !ds.includes(x))); if (f === undefined) return null;
      return num(pickOne(ds), f, k => k ? `Есть два Приспешника, между которыми ${k === 1 ? 'сидит' : 'сидят'} ${k} ${pl(k, ['игрок', 'игрока', 'игроков'])}.` : 'Есть два Приспешника, сидящих рядом.'); });
    add('Соседи и места', () => { if (!outs.length) return null;
      return yn(outs.every(o => seatNb(S, o).some(p => team(p) === 'minion')), 'Каждый Изгой сидит рядом с Приспешником.', 'Не каждый Изгой сидит рядом с Приспешником.'); });
    add('Соседи и места', () => { if (!demon || !outs.length) return null; const d = Math.min(...outs.map(o => dist(S, demon, o)));
      return num(d, near(d, 1, half), d => d === 1 ? 'Ближайший к Демону Изгой — его сосед.'
        : `Между Демоном и ближайшим к нему Изгоем ${d === 2 ? 'сидит' : 'сидят'} ${d - 1} ${pl(d - 1, ['игрок', 'игрока', 'игроков'])}.`); });
    add('Соседи и места', () => { const kind = pickOne(['good', 'evil', 'townsfolk']), ok = p => kind === 'good' ? !evil(p) : kind === 'evil' ? evil(p) : team(p) === 'townsfolk';
      const ps = S.players, cnt = ps.filter(ok).length; let best = 0;
      if (cnt === ps.length) best = cnt; else for (const p of ps) { let k = 0; while (k < ps.length && ok(at(S, p, k))) k++; best = Math.max(best, k); }
      const w = { good: 'добрых игроков', evil: 'злых игроков', townsfolk: 'Горожан' }[kind];
      return best ? num(best, near(best, 1, cnt), k => `Самая длинная цепочка ${w}, сидящих подряд: ${k}.`) : null; });
    add('Соседи и места', () => { const kind = pickOne(['outsider', 'once', 'droison']), ok = p => kind === 'outsider' ? team(p) === 'outsider' : (kind === 'once' ? ONCE : DROISON).includes(p.role);
      const cnt = S.players.filter(ok).length; let k = 0; for (const p of S.players) if (ok(p) && ok(at(S, p, 1))) k++;
      const w = { outsider: 'Изгоев', once: 'игроков со способностью «раз за игру»', droison: 'игроков, чьи роли делают других пьяными или отравленными' }[kind];
      return num(k, near(k, 0, Math.max(0, cnt - 1)), k => `Пар сидящих рядом ${w}: ${k}.`); });

    // — Вы
    add('Вы', () => yn(seatNb(S, sv).some(p => team(p) === 'minion'), 'Вы сидите рядом с Приспешником.', 'Вы не сидите рядом ни с одним Приспешником.'));
    add('Вы', () => yn(seatNb(S, sv).some(p => team(p) === 'outsider'), 'Вы сидите рядом с Изгоем.', 'Вы не сидите рядом ни с одним Изгоем.'));
    add('Вы', () => { if (S.players.length < 4) return null; const line = !evil(sv) && [[-2, -1], [-1, 1], [1, 2]].some(ks => ks.every(k => !evil(at(S, sv, k))));
      return yn(line, 'Вы находитесь в линии из трёх добрых игроков, сидящих подряд.', 'Вы не находитесь ни в одной линии из трёх добрых игроков, сидящих подряд.'); });
    // ближайший злой слева или справа, или оба на одном расстоянии
    add('Вы', () => { const n = S.players.length; let l = 0, r = 0;
      for (let k = 1; k < n && !l; k++) if (evil(at(S, sv, k))) l = k;
      for (let k = 1; k < n && !r; k++) if (evil(at(S, sv, -k))) r = k;
      if (!l) return null;
      const F = { eq: 'Ближайшие к вам злые игроки слева и справа сидят на одинаковом расстоянии от вас.',
        l: 'Ближайший к вам злой игрок сидит слева от вас.', r: 'Ближайший к вам злой игрок сидит справа от вас.' };
      const t = l === r ? 'eq' : l < r ? 'l' : 'r';
      return { yes: F[t], no: F[pickOne(Object.keys(F).filter(x => x !== t))] }; });
    add('Вы', () => { const side = pickOne([1, -1]), three = [...new Set([1, 2, 3].map(k => at(S, sv, side * k)))].filter(p => p !== sv);
      if (three.length < 3) return null; const k = three.filter(evil).length;
      return num(k, lie3(k), k => `Среди трёх ближайших игроков ${side > 0 ? 'слева' : 'справа'} от вас злых: ${k}.`); });
    // «[злая роль] сидит не дальше / не ближе N мест от вас» — считаем игроков между вами (Демона по роли не называем)
    add('Вы', () => { const e = pickOne(mins.filter(p => p !== sv)); if (!e) return null; const b = dist(S, sv, e) - 1, hi = half - 1;
      const inr = xs => xs.filter(x => x >= 1 && x <= hi), V = { max: [inr([b, b + 1]), inr([b - 1, b - 2])], min: [inr([b, b - 1]), inr([b + 1, b + 2])] };
      const ks = Object.keys(V).filter(k => V[k][0].length && V[k][1].length); if (!ks.length) return null; const k = pickOne(ks);
      const t = x => `Между вами и обладателем роли «${E.rname(e.role)}» сидит не ${k === 'max' ? 'больше' : 'меньше'} ${x} ${x === 1 ? 'игрока' : 'игроков'}.`;
      return { yes: t(pickOne(V[k][0])), no: t(pickOne(V[k][1])) }; });
    add('Вы', () => { const nb = E.aliveNeighbours(S, sv); if (!nb.length) return null; const k = nb.filter(p => E.droisoned(S, p)).length;
      return num(k, pickOne([0, 1, 2].filter(x => x !== k && x <= nb.length)) ?? null, k => !k ? 'Никто из ваших живых соседей не пьян и не отравлен.'
        : k === 1 ? 'Один из ваших живых соседей пьян или отравлен.' : 'Оба ваших живых соседа пьяны или отравлены.'); });
    add('Вы', () => { if (!sv.alive || team(sv) !== 'townsfolk' || core.some(p => p !== sv && p.alive && ONCE.includes(p.role) && !ONCE_FLAG[p.role])) return null;
      const spent = p => (ONCE_FLAG[p.role] && S.flags[ONCE_FLAG[p.role] + p.id]) || (p.role === 'virgin' && S.flags['virginUsed_' + p.id]);
      const acting = p => p.alive && team(p) === 'townsfolk' && !evil(p) && !E.abilityOff(S, p) && !spent(p);
      return yn(acting(sv) && !core.some(p => p !== sv && acting(p)), 'Вы — единственный живой и трезвый Горожанин, у которого ещё есть способность.',
        'Вы — не единственный живой и трезвый Горожанин, у которого ещё есть способность.'); });

    // — Роли и раскладка
    add('Роли и раскладка', () => { const k = outs.length; return num(k, near(k, 0, scriptOut), k => `Изгоев в игре: ${k}.`); });
    add('Роли и раскладка', () => { if (S.flags.demonless || core.some(p => p.role === 'atheist') || !scriptOut) return null; const d = E.distribution(core.length, [], {}); if (!d) return null;
      return yn(outs.length !== d.outsider, 'В игре нестандартное количество Изгоев.', 'В игре стандартное количество Изгоев.'); });
    add('Роли и раскладка', () => { if (!inPl.length || !outPl.length) return null; const o = outPl.filter(r => !S.bluffs.includes(r)); if (!o.length) return null;
      return { yes: `Роль «${E.rname(pickOne(inPl))}» есть в игре.`, no: `Роль «${E.rname(pickOne(o))}» есть в игре.` }; });
    add('Роли и раскладка', () => { if (!inPl.length || !outPl.length) return null; return { yes: `Роли «${E.rname(pickOne(outPl))}» в игре нет.`, no: `Роли «${E.rname(pickOne(inPl))}» в игре нет.` }; });
    // «В игре один из Демонов — Но Даши или Вигормортис»: правда — настоящий Демон и ещё один; ложь — два Демона не из игры
    add('Роли и раскладка', () => { if (!demon) return null; const inG = core.filter(E.isDemon).map(p => p.role);
      const out = shuffle(S.script.roles.filter(r => isDemonRole(r) && !inG.includes(r))); if (out.length < 2) return null;
      const q = (x, y) => `Демон в игре — «${E.rname(x)}» или «${E.rname(y)}».`;
      return { yes: q(...shuffle([demon.role, out[0]])), no: q(out[0], out[1]) }; });
    add('Роли и раскладка', () => { if (!S.script.roles.includes('drunk')) return null; return yn(core.some(p => p.role === 'drunk'), 'Пьяница в игре.', 'Пьяницы в игре нет.'); });
    add('Роли и раскладка', () => { const k = alive.filter(evil).length; return num(k, near(k, alive.some(E.isDemon) ? 1 : 0, nEvil), k => `Злых среди живых игроков: ${k}.`); });
    add('Роли и раскладка', () => { const k = alive.filter(p => team(p) === 'minion').length; return num(k, near(k, 0, nMin), k => `Живых Приспешников: ${k}.`); });
    add('Роли и раскладка', () => { if (!outs.length) return null; return yn(outs.every(p => !p.alive), 'Все Изгои мертвы.', 'Хотя бы один Изгой жив.'); });
    // «Если бы один из Приспешников был Эмпатом…»: ложь — число, которого не узнал бы ни один живой Приспешник
    add('Роли и раскладка', () => { const ms = mins.filter(p => p.alive); if (!ms.length) return null;
      const v = ms.map(m => E.aliveNeighbours(S, m).filter(evil).length), f = pickOne([0, 1, 2].filter(x => !v.includes(x))); if (f === undefined) return null;
      const who = nMin < 2 ? 'Приспешник' : `один из ${ms.length < nMin ? 'живых ' : ''}Приспешников`;
      return num(pickOne(v), f, k => `Если бы ${who} был Эмпатом, он узнал бы число ${k}.`); });
    add('Роли и раскладка', () => { if (!S.script.roles.some(r => ONCE.includes(r))) return null; const k = core.filter(p => ONCE.includes(p.role)).length;
      return num(k, near(k, 0, k + 1), k => k ? `В игре ролей со способностью «раз за игру»: ${k}.` : 'В игре нет ни одной роли со способностью «раз за игру».'); });
    add('Роли и раскладка', () => { const os = core.filter(p => ONCE.includes(p.role)); if (!os.length || os.some(p => !ONCE_FLAG[p.role])) return null;
      const k = os.filter(p => S.flags[ONCE_FLAG[p.role] + p.id]).length;
      return num(k, near(k, 0, os.length), k => k ? `Способностей «раз за игру» уже использовано: ${k}.` : 'Ни одной способности «раз за игру» ещё не использовано.'); });
    add('Роли и раскладка', () => { if (!demon) return null; const k = core.filter(p => p.alive && MOVERS.includes(p.role)).length;
      return num(k, near(k, 0, k + 1), k => !k ? 'В игре нет ни одной роли, которая может передать Демона другому игроку.'
        : k === 1 ? 'В игре ровно одна роль, которая может передать Демона другому игроку.' : `В игре ролей, которые могут передать Демона другому игроку: ${k}.`); });

    // — Вчера и прошлая ночь
    const GN = 'Вчера и прошлая ночь';
    add(GN, () => { const pk = S.phase === 'day' && S.night && S.night.data.picks; if (!pk) return null;
      return yn(pk.some(x => x.demon.length), 'Прошлой ночью один из игроков выбрал своей целью Демона.', 'Прошлой ночью никто из игроков не выбирал своей целью Демона.'); });
    // «Сновидец выбрал Приспешника», «Заклинатель выбрал [роль / тип]», «[роль] выбрана [Приспешником]»: выбор одной роли (не Демона)
    add(GN, () => { if (!NG) return null; const x = pickOne(NG.picks.filter(x => x.own && x.team !== 'demon' && x.t.length)); if (!x) return null;
      const who = `Прошлой ночью ${holder(x.role)} выбрал`;
      if (Math.random() < 0.5) { const have = [...new Set(x.types)].filter(t => ACC[t]), not = Object.keys(ACC).filter(t => !have.includes(t));
        if (!have.length || !not.length) return null;
        return { yes: `${who} ${ACC[pickOne(have)]}.`, no: `${who} ${ACC[pickOne(not)]}.` }; }
      const have = x.roles.filter(r => DATA.roles[r] && !isDemonRole(r)), not = [...new Set(core.map(p => p.role))].filter(r => DATA.roles[r] && !isDemonRole(r) && !x.roles.includes(r) && r !== x.role);
      if (!have.length || !not.length) return null;
      return { yes: `${who} игрока с ролью «${E.rname(pickOne(have))}».`, no: `${who} игрока с ролью «${E.rname(pickOne(not))}».` }; });
    add(GN, () => { if (!NG) return null; const ev = Math.random() < 0.5, ws = new Set(S.night.woke.map(id => E.P(S, id)).filter(p => p && !E.isTraveller(p) && evil(p) === ev));
      const k = ws.size, w = ev ? 'злых' : 'добрых';
      return num(k, near(k, 0, core.filter(p => evil(p) === ev).length), k => k ? `Прошлой ночью по своей способности просыпались ${w} игроков: ${k}.`
        : `Прошлой ночью по своей способности не просыпался ни один ${ev ? 'злой' : 'добрый'} игрок.`); });
    add(GN, () => { if (!NG || !NG.start) return null; const ch = S.players.filter(p => NG.start.roles[p.id] !== undefined && NG.start.roles[p.id] !== p.role);
      const F = [[ch.some(p => ['minion', 'demon'].includes(team(p))), 'Прошлой ночью появилась новая злая роль.'], [ch.some(p => team(p) === 'townsfolk'), 'Прошлой ночью появился новый Горожанин.'],
        [!ch.length, 'Прошлой ночью не появилось ни одной новой роли.']];
      const y = F.filter(f => f[0]), n = F.filter(f => !f[0]); if (!y.length || !n.length) return null;
      return { yes: pickOne(y)[1], no: pickOne(n)[1] }; });
    add(GN, () => { if (!NG) return null; const ds = S.night.deaths.filter(d => { const p = E.P(S, d.pid); return p && !p.alive; }); if (!ds.length) return null;
      return yn(!ds.some(d => d.cause === 'demon'), 'Прошлой ночью никто не умер от выбора Демона.', 'Прошлой ночью кто-то умер от выбора Демона.'); });
    add(GN, () => { if (!NG || !NG.start || NG.dawnDeadEvil === undefined || !S.script.roles.includes('oracle')) return null;
      return yn(NG.dawnDeadEvil !== NG.start.deadEvil, 'Прошлой ночью число Оракула изменилось.', 'Прошлой ночью число Оракула не изменилось.'); });
    add(GN, () => { if (!NG || !NG.off) return null; const k = NG.off.length;
      return num(k, near(k, 0, alive.length), k => !k ? 'Прошлой ночью никто не был пьян или отравлен.' : k === 1 ? 'Прошлой ночью пьян или отравлен был ровно один игрок.'
        : `Прошлой ночью пьяны или отравлены были ровно ${k} ${pl(k, ['игрок', 'игрока', 'игроков'])}.`); });
    add(GN, () => { if (!NG || !NG.newPoison || !S.script.roles.some(r => DROISON.includes(r))) return null;
      return yn(NG.newPoison.length > 0, 'Прошлой ночью кто-то был отравлен впервые за игру.', 'Прошлой ночью никто не был отравлен впервые за игру.'); });
    add(GN, () => { if (!NG) return null; const d = S.players.find(p => E.hasTok(p, 'drunk', 'sweetheart')); if (!d) return null;
      return yn(S.night.woke.includes(d.id), 'Игрок, которого опьянила Душечка, прошлой ночью просыпался.', 'Игрок, которого опьянила Душечка, прошлой ночью не просыпался.'); });
    add(GN, () => { if (!NG) return null; const nb = seatNb(S, sv); if (nb.length < 2 || nb[0] === nb[1]) return null;
      const k = nb.filter(q => NG.picks.some(x => x.by !== q.id && x.t.includes(q.id))).length;
      return num(k, pickOne([0, 1, 2].filter(x => x !== k)), k => !k ? 'Прошлой ночью никто не выбирал своей способностью ваших соседей.'
        : k === 1 ? 'Прошлой ночью другие игроки выбирали своей способностью одного из ваших соседей.' : 'Прошлой ночью другие игроки выбирали своей способностью обоих ваших соседей.'); });
    add(GN, () => { if (!NG) return null; const tp = NG.picks.filter(x => x.team === 'townsfolk'); if (!tp.length) return null;
      const k = new Set(tp.filter(x => x.bad.some(id => id !== x.by)).map(x => x.by)).size;
      return num(k, near(k, 0, new Set(tp.map(x => x.by)).size), k => k ? `Прошлой ночью злого игрока выбрали своей способностью Горожан: ${k}.`
        : 'Прошлой ночью ни один Горожанин не выбрал своей способностью злого игрока.'); });
    add(GN, () => { if (!NG) return null; const ev = NG.picks.filter(x => x.evil); if (!ev.length) return null;
      if (Math.random() < 0.5) return yn(ev.some(x => x.t.includes(x.by)), 'Прошлой ночью злой игрок выбрал своей способностью себя.', 'Прошлой ночью ни один злой игрок не выбирал своей способностью себя.');
      return yn(ev.some(x => x.bad.some(id => id !== x.by)), 'Прошлой ночью злой игрок выбрал своей способностью другого злого игрока.',
        'Прошлой ночью ни один злой игрок не выбирал своей способностью другого злого игрока.'); });
    add(GN, () => { if (!NG) return null; const dp = NG.picks.filter(x => x.team === 'demon'); if (!dp.length) return null;
      return yn(dp.some(x => x.dead.length), 'Прошлой ночью Демон выбрал мёртвого игрока.', 'Прошлой ночью Демон не выбирал мёртвого игрока.'); });
    add(GN, () => { if (S.n < 2) return null; const ns = (S.flags.nomHist || []).filter(x => x.n === S.n - 1); if (!ns.length) return null;
      const ev = x => x.onAlign === 'evil' || (!!x.by && (x.byAlign || (E.P(S, x.by) || {}).align) === 'evil'), k = ns.filter(ev).length;
      return num(k, near(k, 0, ns.length), k => nomText(k, ns.length)); });
    add(GN, () => { const last = S.flags.abnPrev; if (!last || S.n < 2) return null;
      return yn(!last.length, 'Со вчерашнего утра у всех способности сработали как надо.', 'Со вчерашнего утра чья-то способность сработала не так, как должна (ложная информация или сбой).'); });

    // — Вся игра (история — только у игр, начатых с этой версии: S.flags.hist)
    add('Вся игра', () => { if (!H) return null; const by = {};
      for (const x of H.picks) if (x.team === 'minion' && x.own && x.t.length) (by[x.by + '|' + x.role] = by[x.by + '|' + x.role] || []).push(x);
      const key = pickOne(Object.keys(by).filter(k => new Set(by[k].map(x => x.n)).size >= 2)); if (!key) return null;
      const xs = by[key], who = cap(holder(xs[0].role));
      return yn(xs.every(x => x.t[0] === xs[0].t[0]), `${who} каждую ночь выбирал одного и того же игрока.`, `${who} выбирал разных игроков.`); });
    add('Вся игра', () => { const rh = S.flags.ftHerring; if (!H || !rh) return null; const ft = H.picks.filter(x => x.role === 'fortuneteller' && x.own); if (!ft.length) return null;
      return yn(ft.some(x => x.t.includes(rh)), 'Гадалка хотя бы раз за игру выбирала свою ложную цель.', 'Гадалка ни разу за игру не выбирала свою ложную цель.'); });
    add('Вся игра', () => { if (!H || !nMin || !H.exe.length) return null;
      return yn(H.exe.some(x => x.team === 'minion'), 'Приспешника уже казнили в этой игре.', 'Пока не казнили ни одного Приспешника.'); });
    add('Вся игра', () => { if (!H || S.n < 2) return null; const p = pickOne(core.filter(q => !E.isDemon(q) && q.role !== 'drunk' && DATA.roles[q.role])); if (!p) return null;
      const r = `«${E.rname(p.role)}»`;
      return yn(H.abn.includes(p.id), `Способность обладателя роли ${r} хотя бы раз за игру сработала не так, как должна (ложная информация или сбой).`,
        `Способность обладателя роли ${r} за всю игру ни разу не дала сбоя или ложной информации.`); });
    add('Вся игра', () => { if (!H) return null; const mp = H.picks.filter(x => x.team === 'minion' && x.t.length); if (!mp.length) return null;
      return yn(!mp.some(x => x.bad.length), 'За всю игру Приспешники выбирали своей способностью только добрых игроков.', 'Хотя бы раз Приспешник выбрал своей способностью злого игрока.'); });
    add('Вся игра', () => { if (!H || !H.teams) return null; const t = pickOne(['outsider', 'townsfolk']), now = core.filter(p => team(p) === t).length, was = H.teams[t];
      const w = t === 'outsider' ? 'Изгоев' : 'Горожан', F = { more: `${w} сейчас больше, чем в начале игры.`, less: `${w} сейчас меньше, чем в начале игры.`, same: `${w} сейчас столько же, сколько в начале игры.` };
      const k = now > was ? 'more' : now < was ? 'less' : 'same'; return { yes: F[k], no: F[pickOne(Object.keys(F).filter(x => x !== k))] }; });
    add('Вся игра', () => { if (!H || S.phase !== 'day') return null;
      return yn(H.off.includes(sv.id) || !!E.droisoned(S, sv), 'Вы были пьяны или отравлены в какой-то момент игры.', 'Вы ни разу за игру не были пьяны или отравлены.'); });
    return T;
  }
  const usedFacts = S => new Set((S.flags.savantFacts || []).flatMap(x => x.facts.map(f => f.text)));
  const runT = f => { try { return f(); } catch (e) { return null; } };
  // пара фактов разных шаблонов: один правдивый, другой ложный, порядок случайный. Факты, уже сказанные в этой игре
  // (S.flags.savantFacts), не повторяются — ни сам факт, ни его противоположность (заметка пользователя 2026-10-16)
  function savantPair(S, svId) {
    const sv = E.P(S, svId); if (!sv) return null;
    const used = usedFacts(S);
    const res = shuffle(savantTemplates(S, sv)).map(runT).filter(r => r && !used.has(r.yes) && !used.has(r.no));
    if (res.length < 2) return null;
    const pair = [{ text: res[0].yes, truth: true }, { text: res[1].no, truth: false }];
    return Math.random() < 0.5 ? pair : pair.reverse();
  }
  // все факты для выбора рассказчиком (вкладка «Гримуар»): по одному из каждого шаблона — верный и неверный, по группам
  function savantList(S, svId) {
    const sv = E.P(S, svId); if (!sv) return [];
    const used = usedFacts(S);
    return savantTemplates(S, sv).map(f => { const r = runT(f); return r && !used.has(r.yes) && !used.has(r.no) ? { g: f.g, yes: r.yes, no: r.no } : null; })
      .filter(Boolean).sort((a, b) => GROUPS.indexOf(a.g) - GROUPS.indexOf(b.g));
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

  return { AMNESIAC, AMNESIAC_KIND, MEZ_WORDS, SAVANT_GROUPS: GROUPS, savantPair, savantList, savantTemplates, fishermanAdvice };
})();
