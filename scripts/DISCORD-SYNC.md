# Синхронизация профиля iwtlu

Плашка Discord проверяет данные раз в минуту и после возвращения на вкладку. На GitHub
Pages её аватарка, отображаемый ник, username и пользовательский статус читаются из
`data/discord-profiles/484816707798564894.json`. GitHub Actions обновляет этот файл
по расписанию раз в 5 минут; запуск расписания и публикация могут задерживаться.
На Netlify дополнительно работает `/api/discord/avatar/:userId` для ника и аватарки.

## Настройка GitHub Pages

1. В Discord Developer Portal открой своего бота → **Bot** и включи
   **Presence Intent**. Бот и пользователь должны состоять на одном сервере.
2. В репозитории GitHub → **Settings → Secrets and variables → Actions** добавь
   `DISCORD_BOT_TOKEN` (токен бота) и `DISCORD_GUILD_ID` (ID общего сервера).
   Токен пользователя не нужен. Токен бота не попадает в HTML или JSON.
3. В **Settings → Pages** используй **Deploy from a branch**, ветку `main`,
   папку `/ (root)`. Workflow явно запрашивает пересборку Pages после автокоммита:
   коммит с `GITHUB_TOKEN` сам по себе её не запускает.
4. После загрузки изменений в репозиторий запусти **Actions → Sync Discord
   profiles → Run workflow**, чтобы проверить первый проход, не ожидая расписания.

Отображаемый ник выбирается так: ник на сервере → глобальное имя → username.
Обе кнопки Discord копируют username. При удалении статуса исчезает текст в плашке;
при недоступности Discord или офлайн-статусе сохраняется последний известный текст.
Если настройки приватности Discord скрывают пользовательский статус от бота,
включи его видимость для участников общего сервера.

## Локальный запуск

Нужен Node.js 22+. Скопируй `.env.example` в `.env`, заполни два Discord-параметра
и выполни `node scripts/sync-discord-avatars.mjs`. Затем открой сайт через локальный
HTTP-сервер, например `python -m http.server 8000`, и перейди на
`http://localhost:8000/iwtlu.html?demo=1`.

Проверки: `node --test scripts/test-discord-profile.mjs`.

Документация: [Discord Gateway](https://docs.discord.com/developers/events/gateway-events),
[запуск сборки Pages](https://docs.github.com/en/rest/pages/pages#request-a-github-pages-build).
