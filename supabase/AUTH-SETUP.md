# Почта, Google и Discord для iwtxz.su

Страница входа и настройки подготовлены. Существующие логины, пароли, адреса страниц и настройки профилей сохраняются. Секреты OAuth/SMTP вводятся только в панели Supabase, не в `backend-config.js` и не в GitHub.

## 1. SQL

В [SQL Editor проекта](https://supabase.com/dashboard/project/aknoeytrgzkgdcttwgvb/sql/new) выполни весь файл `migrations/20261108_account_email_and_oauth.sql`. Ожидаемый результат — `Success. No rows returned`. Повторное выполнение допустимо.

## 2. Функция для входа по логину после привязки почты

Почта хранится в Supabase Auth. Чтобы после её подтверждения продолжать входить по прежнему логину, нужен небольшой серверный обработчик `account-login`. Он проверяет обычный пароль через Supabase Auth, ограничивает попытки и не выдаёт адреса почты другим посетителям.

Вариант через панель:

1. Открой [Edge Functions](https://supabase.com/dashboard/project/aknoeytrgzkgdcttwgvb/functions), создай функцию `account-login` через редактор.
2. Скопируй `functions/account-login/index.ts` в файл `index.ts` редактора, а `functions/account-login/handler.mjs` — во второй файл `handler.mjs` рядом с ним.
3. Опубликуй функцию. В её настройках отключи **Verify JWT / Enforce JWT verification**: это точка входа для пользователя, у которого ещё нет сессии. Сам пароль всегда проверяет Supabase Auth.
4. Стандартные серверные переменные `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` Supabase предоставляет функции автоматически. В сайт их переносить не нужно.
5. Открой `https://aknoeytrgzkgdcttwgvb.supabase.co/functions/v1/account-login`. После SQL и публикации ответ должен быть `{"ready":true}`. До этого сайт не разрешит менять почту, чтобы сохранить вход по логину.

Вариант через Supabase CLI из корня репозитория:

```powershell
npx supabase login
npx supabase functions deploy account-login --project-ref aknoeytrgzkgdcttwgvb --no-verify-jwt
```

## 3. Адреса возврата

В **Authentication → URL Configuration**:

- **Site URL**: `https://iwtxz.su`
- **Redirect URLs**: `https://iwtxz.su/?auth=callback`, `https://iwtxz.su/?auth=link`, `https://iwtxz.su/?auth=recovery`, `https://iwtxz.su/?auth=email`

В `backend-config.js` параметр `authSiteUrl` закреплён за `https://iwtxz.su`. Код использует корневой адрес `/?auth=...`, совпадающий со списком выше. При несовпадении разрешённого адреса Supabase возвращает на свой **Site URL**, поэтому там не должно оставаться `http://localhost:3000`. Для Google/Discord в настройках самих провайдеров остаётся адрес `/auth/v1/callback` проекта Supabase, а не адрес сайта.

После изменения адресов запроси **новое** письмо восстановления/подтверждения или начни вход через сервис заново. Старые письма могут содержать прежний адрес. В шаблонах писем ссылка должна использовать `{{ .ConfirmationURL }}`, а не статический localhost или `{{ .SiteURL }}`.

Не начинай подтверждение из локального превью: PKCE хранит проверочный код в браузере для текущего домена, и localhost не передаёт его на iwtxz.su. Для отдельного тестового окружения разработчик может явно задать `authSiteUrl` своего локального сервера и добавить его в тестовые Redirect URLs; рабочий файл сайта использует только iwtxz.su.

Ссылки из писем нужно открывать в том же браузере, где запрошена привязка или восстановление: сайт использует PKCE.

## 4. Почта и восстановление

В **Authentication → Email / SMTP Settings** подключи SMTP своего почтового сервиса: сервер, порт, логин, пароль и подтверждённый адрес отправителя, например `noreply@iwtxz.su`. Добавь DNS-записи отправителя, которые выдаёт выбранный сервис. Встроенный SMTP Supabase предназначен для тестирования и не отправляет письма обычным посетителям, не входящим в команду проекта.

В **Authentication → Sign In / Providers → Email**:

- Оставь **Confirm email выключенным** для существующей регистрации по логину. Служебные адреса `username@accounts.iwtxz.ru` не являются почтовыми ящиками.
- Выключи **Secure email change / Confirm email change on both addresses**. Иначе первая привязка потребует письмо на недоступный служебный адрес. Новый настоящий адрес всё равно нужно подтвердить по письму: постоянные аккаунты в используемой версии Supabase Auth проходят эту проверку.
- Для шаблонов **Reset Password** и **Change Email Address** оставь ссылку `{{ .ConfirmationURL }}`. Не заменяй её обычной ссылкой на главную страницу.

Пользователь входит обычным способом → **Аккаунт → Почта → Отправить подтверждение** → открывает письмо. После подтверждения доступны логин или почта с прежним паролем. На экране входа **Забыл пароль?** отправляет ссылку на привязанную почту.

## 5. Google

В [Google Cloud Console](https://console.cloud.google.com/auth/clients) создай OAuth-клиент типа **Web application**:

- JavaScript origin: `https://iwtxz.su`
- Authorized redirect URI: `https://aknoeytrgzkgdcttwgvb.supabase.co/auth/v1/callback`

Настрой экран согласия. Для посетителей вне списка тестировщиков приложение должно быть опубликовано для нужной аудитории. Скопируй **Client ID** и **Client secret** в **Supabase → Authentication → Sign In / Providers → Google** и включи провайдер. Ранее добавленный YouTube API key для этого не подходит.

Иконка Google на сайте чёрная. Вход проходит через Google, Gmail является почтой этого аккаунта.

## 6. Discord

В [Discord Developer Portal](https://discord.com/developers/applications) открой или создай приложение → **OAuth2**:

- В Redirects добавь `https://aknoeytrgzkgdcttwgvb.supabase.co/auth/v1/callback`.
- Client ID и Client Secret скопируй в **Supabase → Authentication → Sign In / Providers → Discord** и включи провайдер. Bot Token для входа не используется.

В **Supabase → Authentication → Sign In / Providers / Settings** включи **Allow manual linking / Manual linking**. Это нужно, чтобы действующий пользователь мог привязать Google или Discord к своей существующей странице.

Первый вход через сервис предлагает выбрать свободный адрес новой страницы. Владельцы существующих страниц привязывают сервис в **Аккаунт → Вход через сервисы**, предварительно войдя обычным способом. Вход через Discord и настройка публичной Discord-плашки — отдельные действия; оформление плашки открывается кнопкой в разделе «Соцсети».

## Проверка после настройки

1. Старый пользователь входит по логину и видит прежний черновик.
2. Привязывает настоящую почту, подтверждает письмо и снова входит по прежнему логину и по почте.
3. Через «Забыл пароль?» задаёт новый пароль и открывает тот же профиль.
4. Привязывает Google/Discord из аккаунта, выходит и входит через сервис: открывается прежняя страница.
5. Новый аккаунт через сервис выбирает свободный логин; чужие и зарезервированные адреса недоступны.

Справка: [Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [Discord](https://supabase.com/docs/guides/auth/social-sign-in/auth-discord), [привязка способов входа](https://supabase.com/docs/guides/auth/auth-identity-linking), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
