# Футбольная лига

## Описание
Сайт любительской футбольной лиги (в репозитории solitaire-tournament — раньше тут был турнир по косынке).
Каждый тур игроки делятся на 2–4 цветные команды, команды играют короткие матчи между собой.
Сайт считает таблицу игроков, MVP тура и месяца, рейтинги, связки, ведёт лайв-матч с таймером
и подбирает равные составы. Дизайн — светлый, в стиле приложения Locals.

## Стек
- Frontend: HTML/CSS/JS в папке public/ (сервер раздаёт только её)
  - public/index.html — оболочка страницы, иконки
  - public/styles.css — стили
  - public/league.js — вся логика расчётов без интерфейса (таблица, MVP, рейтинг, ротация, подбор составов)
  - public/app.js — экраны, роутер (#/, #/tours, #/tour/ID, #/live, #/players, #/player/ИМЯ, #/stats, #/new, #/roster/ID, #/settings)
- Backend: Python, FastAPI — server.py
- Данные: вся лига одним JSON-документом. С DATABASE_URL — в Postgres (таблица league), без него — в файле league.json

## Запуск сервера
```
cd ~/solitaire-tournament
ADMIN_PASSWORD=придумай-пароль python3 -m uvicorn server:app --host 0.0.0.0 --port 8000
```
Без ADMIN_PASSWORD сайт только для чтения. На Railway задать переменные DATABASE_URL и ADMIN_PASSWORD.
Демо-данные: войти в настройках (шестерёнка/замок) и нажать «Заполнить демо-данными» (кнопка есть, пока нет туров).

## API
- GET /api/league — {data, version, live, editable}
- GET /api/live — {live, version} (сайт опрашивает каждые 4 с во время матча)
- POST /api/login {password} — проверить пароль организатора
- PUT /api/league {data, version} + заголовок X-Admin-Password — сохранить лигу (409, если версия устарела)
- PUT /api/live {live} + X-Admin-Password — текущий лайв-матч

## Тесты
- node test_league.js — логика лиги
- python -m pytest test_server.py — API (с DATABASE_URL идёт через Postgres, иначе через временный файл)

## Правила
- Сервер всегда на порту 8000
- Не удалять league.json и данные в Postgres — там живые данные; перед экспериментами скачать копию в настройках

## Контекст обучения
Пользователь — продуктовый дизайнер, новичок в разработке. Изучает Claude Code и разработку с нуля.

### Что уже изучено
- Модели Claude (Opus, Sonnet, Haiku) и переключение через /model
- Настройки: ~/.claude/settings.json, .claude/settings.json, .claude/settings.local.json
- Permissions (allow/deny/ask) и хуки
- Команды: /model, /clear, #файл
- CLAUDE.md — контекст проекта для новых сессий
- Сессии и проекты — как хранятся, как восстановить через claude --resume
- MCP серверы — подключён Playwright (браузер) и Context7 (документация библиотек)
  - Конфиг: ~/.claude/.mcp.json и VS Code settings.json (claude.mcpServers)
  - Playwright работает в терминале, Context7 — в VS Code extension
  - Bash tool: open команда открывает браузер и Finder без Playwright
- **Хуки на практике** — создание Stop хука с afplay, понимание hook событий и типов
- **Работа с git через Claude** — init, add, commit, checkout, merge, history
  - Создали репо, первый коммит, ветку feature/footer, слияние в main
  - Конфиг git user.name и user.email
  - Понимание diff и git log

### Что практиковали
Построили сайт турнира по косынке с нуля:
- Счётчик участников, анимация кнопки, валидация формы
- Таблица участников, удаление, тост-уведомления
- Страница админа со статистикой и фильтрацией по уровню

### Что уже изучено (продвинутый уровень) ✅
- **Агенты** — Explore для анализа кодовой базы, Plan для проектирования
- **Plan Mode** — планирование перед кодированием, исследование перед реализацией
- **GitHub** — полный цикл: ветки, push, PR, мержинг, синхронизация
- **Unit тесты** — Python (pytest) и JavaScript (Node.js assert)
- **CI/CD** — GitHub Actions для автоматического запуска тестов

### Что осталось изучить (если интересно)
- Деплой (Vercel, Railway, Render)
- End-to-end тесты (Playwright, Cypress)
- Docker
- Мониторинг и логирование
- OpenAPI/Swagger документация

### Заметки для следующей сессии
- Проект полностью готов к развитию — есть тесты и CI/CD
- Новые фичи можно добавлять с уверенностью через Plan → Code → Test → PR цикл
- Уменьшить использование skills для простых операций (Read/Edit достаточно)
- Проверять `/context` перед дорогими операциями
