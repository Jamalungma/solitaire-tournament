# Турнир по Косынке

## Описание
Сайт регистрации на онлайн-турнир по косынке. Участники заполняют форму, данные сохраняются на сервере.

## Стек
- Frontend: HTML/CSS/JS — index.html (главная), admin.html (админка)
- Backend: Python, FastAPI — server.py
- Данные: participants.json

## Запуск сервера
```
cd ~/solitaire-tournament
python3 -m uvicorn server:app --host 0.0.0.0 --port 8000
```

## API
- GET /participants — список всех участников
- POST /register — регистрация участника {name, email, level}
- DELETE /participants/{email} — удалить участника

## Правила
- Сервер всегда на порту 8000
- Не удалять participants.json — там живые данные

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

### Что практиковали
Построили сайт турнира по косынке с нуля:
- Счётчик участников, анимация кнопки, валидация формы
- Таблица участников, удаление, тост-уведомления
- Страница админа со статистикой и фильтрацией по уровню

### Что осталось изучить (продвинутый уровень)
- **Хуки на практике** ← следующий шаг
- Работа с git через Claude
- Агенты
- Рабочий процесс: как формулировать задачи, Plan mode
