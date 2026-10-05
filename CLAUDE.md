# Гримуар рассказчика и сценарий «Everyone Can Be Evil»

Проект Алекса (Alex) по Blood on the Clocktower («Кровь на часовой башне»). Общаться по-русски.
Перенесён из сессии 2026-10-04/05 (временная папка той сессии удалена — всё нужное здесь).

## Главные правила работы
- **Не выдумывать правила.** Источник: wiki.bloodontheclocktower.com (страница роли → How to Run, Glossary).
  API: `https://wiki.bloodontheclocktower.com/api.php?action=parse&page=<Роль>&prop=wikitext&format=json`.
  Если на вики нет — сказать «решение рассказчика» или спросить пользователя.
- У пользователя **только базовая коробка**: роли Trouble Brewing, Bad Moon Rising, Sects & Violets (+ их Странники и Сказочники).
- Русские названия — из официального `app/data/ru.json` (botc-translations). Совпадают с жетонами пользователя:
  **Цирюльник** (Barber), **Фань Гу** (Fang Gu), Травница (Tea Lady), Кукловод (Mastermind), Растяпа (Klutz).
- Перед публикацией чего-либо наружу (GitHub, пуш, новые загрузки) — спросить пользователя.

## Уточнённые правила (решения пользователя и проверки по вики)
- **Изгнание Странника:** голосуют все игроки (живые и мёртвые), голос призрака НЕ тратится;
  изгнан, если голосов ≥ половины ВСЕХ игроков с округлением вверх (`exileThreshold` в engine.js). Изгнание — не казнь.
- **Странники** не считаются для «двое живых — победа зла», Блудницы (5+), Мэра; в пороге казни считаются (голосуют).
  Сторону Странника назначает рассказчик.
- **Дурманщик (Poppy Grower)** — по вики МОЖЕТ быть пьян/отравлен: если пьян/отравлен в момент смерти — злые не знакомятся;
  если стал пьян/отравлен — злые «внезапно» не узнают друг друга; если Пьяница считает себя Дурманщиком — знакомство как обычно.
  В движке это свойство роли `prevents_evil_meeting` (data), а не проверка по id.
- Шрифт **Alegreya SC нельзя для кириллицы**: строчная «у» в капители выглядит как латинская Y. Подписи — заглавными с разрядкой.

## Сценарий «Everyone Can Be Evil» (by Alex)
25 ролей, 13/4/4/4, джинксов нет. Список — `four_demons_script.json`.
- Горожане: Библиотекарь, Часовщик, Бабушка, Гадалка, Травница, Монах, Гробовщик, Азартный Игрок, Художник, Придворный, Швея, Мэр, Шут
- Изгои: Цирюльник, Затворник, Дитя Луны, Растяпа
- Приспешники: Злой Близнец, Адвокат Дьявола, Ведьма, Крёстный Отец
- Демоны: Чёрт, Пукка, Но Даши, Фань Гу

## Печатные листы (`tools/build_sheets.py` → `out/roles.pdf`, `out/night.pdf`; копии в `sheets/`)
- Лист ролей: ВСЕ 25 ролей на одной A4. Концепция «Витраж»: тонкая витражная рамка от края листа (внутренний край 7.5 мм),
  сверху дневная, с «Приспешников» плавно переходит в злую (граница вычисляется скриптом в листе). Описания полужирные ~9.8 pt.
  Шапка: название слева, витраж справа. Иконки ролей вшиты (синие у добрых, красные у злых).
- Лист ночей «Двуликий»: слева первая ночь, справа последующие (перевёрнуты на 180°), по центру окно-ланцет.
- Печать: A4, поля «Нет», масштаб 100%.

## Приложение «Гримуар рассказчика» (`app/`)
- Опубликовано как закрытый артефакт claude.ai: https://claude.ai/artifact/Y13UR68ar1MGUMRmiZfk5N (версия 6;
  возможности db+user — игра сохраняется в аккаунте). Обновлять: публиковать `app/dist/grimoire.html` на тот же URL.
- Исходники: `app/src/data.js` (генерируется), `icons.js` (генерируется), `engine.js` (правила, без DOM), `ui.js`, `style.css`.
- Возможности: подготовка (сценарий, круг, раздача с цветом добрых/злых, блефы), пошаговая ночь в официальном порядке
  с «Рамками выбора» (кто выбирает / что решает рассказчик), готовые ответы, учёт яда/защиты/смертей, день (номинации,
  голоса, изгнание), Странники и Сказочники, журнал, отмена через историю снимков (кнопка ↶ + плашка), автосохранение
  всего (включая черновики выбора и незавершённую номинацию), OLED-ночь (#000), крупные строки игроков.
- Тесты движка: `app/test/tests.js`, запуск `python tools/run_tests.py` (headless Edge). Сейчас 44/44.

## Сборка
```
python -m venv .venv
.venv\Scripts\pip install pillow numpy scipy pymupdf
.venv\Scripts\python tools\app_build_data.py   # data.js из app/data/*.json
.venv\Scripts\python tools\fetch_icons.py      # иконки (качает только недостающие)
.venv\Scripts\python tools\prep_art.py         # вырезка фона арта → art/cut
.venv\Scripts\python tools\app_build.py        # app/dist/grimoire.html + preview.html
.venv\Scripts\python tools\run_tests.py
.venv\Scripts\python tools\build_sheets.py ; .venv\Scripts\python tools\render.py   # листы → out/*.pdf
.venv\Scripts\python tools\site_build.py       # PWA для GitHub Pages → out/site (скопировать в docs/)
.venv\Scripts\python tools\desktop_build.py    # Electron: Windows + Mac (нужен tools/node_dl с Node.js 24 и npm install в app/desktop)
```
- Node.js портативный: nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip → `tools/node_dl/`; затем `npm install` в `app/desktop`.
- Mac-сборки собираются из официальных zip Electron в Python (сохраняет симлинки); без подписи — на Mac нужно
  `xattr -cr` и `codesign --force --deep --sign -`.
- Git: портативный MinGit уже лежит в `tools/git/cmd/git.exe` (в .gitignore; заново — `python tools/fetch_mingit.py`,
  но запускать из короткого пути: из длинных путей MinGit падает с «Filename too long»). GitHub CLI установлен: `C:\Program Files\GitHub CLI\gh.exe`.
  Локальный репозиторий уже создан (ветка main, первый коммит); автор коммитов — заглушка `grimoire@localhost`.

## Публикация
- **GitHub:** https://github.com/AirError/botc-grimoire (публичный; аккаунт пользователя AirError).
- **Сайт (GitHub Pages, из `main` / `docs`):** https://airerror.github.io/botc-grimoire/ — PWA для Safari на iPhone/iPad.
- Обновить сайт: `tools/site_build.py` (поднять `VERSION` — это номер кэша service worker, иначе телефоны держат старое),
  скопировать `out/site/*` в `docs/`, закоммитить и `git push` (git: `tools/git/cmd/git.exe`, вход через gh уже настроен
  в локальном конфиге репозитория). Почта коммитов: `252884166+AirError@users.noreply.github.com` — личную не использовать.
- gh в сессиях Claude Desktop видит только свой вход (AppData изолирована): если `gh auth status` говорит «не вошли» —
  запустить `gh auth login --hostname github.com --git-protocol https --web` в фоне и передать пользователю одноразовый код.
- Готовые файлы пользователя: `%USERPROFILE%\Downloads\Гримуар` (сборки, PDF, сайт, JSON, промпты).
