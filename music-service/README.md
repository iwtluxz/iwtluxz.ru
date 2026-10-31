# Музыкальная библиотека iwtxz

Отдельный процесс на VPS скачивает один публичный трек YouTube, SoundCloud,
Bandcamp или Vimeo через yt-dlp, преобразует в MP3 и хранит на диске сервера.
Профиль воспроизводит полученный HTTPS-файл; перемотка работает через HTTP Range.
Spotify и другие каталоги без доступного аудио не поддерживаются. Доступность
конкретного трека зависит от площадки, региона и блокировок IP сервера.

Сайт остаётся на GitHub Pages. Для API нужен HTTPS-домен с A-записью на VPS,
например `music.iwtxz.ru`, и входящие TCP 80/443. SSH нужен для установки.
На сервере требуются Python 3.11+, FFmpeg и JavaScript runtime Node.js 22+
или Deno для YouTube. Актуальные требования — в
[документации yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

Пример установки в Ubuntu/Debian после проверки уже работающих сервисов:

```sh
apt-get update
apt-get install -y python3-venv ffmpeg
useradd --system --home /var/lib/iwtxz-music --shell /usr/sbin/nologin iwtxz-music
mkdir -p /opt/iwtxz-music
# Скопировать app.py и requirements.txt в /opt/iwtxz-music/
python3 -m venv /opt/iwtxz-music/venv
/opt/iwtxz-music/venv/bin/pip install -r /opt/iwtxz-music/requirements.txt
```

Создать `/etc/iwtxz-music.env` (права 600):

```ini
MUSIC_PUBLIC_ORIGIN=https://music.iwtxz.ru
MUSIC_DATA_DIR=/var/lib/iwtxz-music
SUPABASE_URL=https://aknoeytrgzkgdcttwgvb.supabase.co
SUPABASE_PUBLISHABLE_KEY=публичный_publishable_key_из_backend-config.js
MUSIC_ALLOWED_ORIGINS=https://iwtxz.ru,https://www.iwtxz.ru
YTDLP_BIN=/opt/iwtxz-music/venv/bin/yt-dlp
YTDLP_JS_RUNTIME=node:/usr/bin/node
```

Установить `iwtxz-music.service` в `/etc/systemd/system/`, выполнить
`systemctl daemon-reload` и `systemctl enable --now iwtxz-music`.
Настроить существующий HTTPS reverse proxy на `127.0.0.1:8787`, не открывая
8787 наружу. Например, отдельный блок Caddy:

```caddy
music.iwtxz.ru {
    reverse_proxy 127.0.0.1:8787
}
```

После проверки `https://music.iwtxz.ru/health` указать этот HTTPS-origin в
`backend-config.js` → `musicApiUrl` и обновить версии ассетов. Изменение базы
Supabase для библиотеки не требуется: настройки хранят обычный URL музыки.

API проверяет access token через Supabase Auth и существующий `profile_accounts`.
Списки треков и задачи доступны только владельцу. Service-role ключ не нужен.
Аудиофайл публичен по случайному UUID, как медиа опубликованных профилей.
Токены и cookies музыкальных сервисов не сохраняются; закрытые, платные и
недоступные площадкой треки возвращают ошибку.

Лимиты: 30 треков / 150 МБ на аккаунт, 8 добавлений в час, трек до 15 минут
и итогового размера 24 МБ, одна загрузка одновременно. При свободном месте менее
350 МБ новые загрузки не принимаются. При удалении из списка файл сохраняется,
чтобы уже опубликованная страница продолжала работать; архив тоже входит в квоту.

Состояние находится в `/var/lib/iwtxz-music`: SQLite и `media/`. Сохранять при
обновлениях и включить в резервные копии. Обновлять yt-dlp в venv при изменении
площадок. Пароль VPS, приватные SSH-ключи и конфигурацию сервера не коммитить.

На текущем VPS API обслуживается существующим nginx через отдельный vhost
`/etc/nginx/conf.d/iwtxz-music.conf`; сертификат Let's Encrypt обновляет certbot.
Загрузчик использует IPv4. DNS провайдера возвращал NXDOMAIN для YouTube,
поэтому только сервису через systemd drop-in `iwtxz-music.service.d/dns.conf`
подставлен отдельный `resolv.conf` с резолверами 1.1.1.1 и 8.8.8.8:

```ini
[Service]
BindReadOnlyPaths=/etc/iwtxz-music-resolv.conf:/etc/resolv.conf
```

Системный DNS и службы панели управления не менялись. Скачивание YouTube
с преобразованием в MP3 проверено на этом VPS. Соединение с SoundCloud
завершается таймаутом; поддержка его ссылок в коде не устраняет ограничение
сети сервера. Ошибка загрузки показывается в библиотеке.

Проверки без облачных аккаунтов и без скачивания настоящих треков:

```sh
python -m unittest discover -s music-service -v
```
