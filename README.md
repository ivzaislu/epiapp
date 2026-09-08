# EpiApp

EpiApp — self-hosted семейное приложение для отметки регулярного приёма лекарства ребёнком, статистики и напоминаний родителям через Telegram и Android.

Проект рассчитан на **отдельный экземпляр для одной семьи**: семья поднимает свой сервер, создаёт своего Telegram-бота и подключает тот же универсальный Android APK к своему HTTPS-домену.

> EpiApp не назначает дозировку, не меняет лечение и не подсказывает, что делать при пропущенной дозе. Он хранит схему, которую внесли родители, и фиксирует пользовательские отметки.

## Что входит

- роли `admin`, `parent`, `child`;
- Telegram-auth и одноразовые семейные приглашения;
- настраиваемая таблетница: препарат, утренняя/вечерняя доза и время;
- статистика и график для родителей;
- Telegram-уведомления и эскалация при отсутствии отметки;
- универсальный Android APK, не привязанный к домену одной семьи;
- Android exact alarms, full-screen alarm, звук/вибрация и восстановление после reboot;
- одноразовый Android pairing code + server-side hashed device-token + Android Keystore;
- Docker Compose + Caddy для простого self-host с automatic HTTPS;
- systemd/Nginx вариант для ручной установки;
- JSON storage с атомарной записью;
- backup/update/migration/security документация;
- `npm run doctor` для диагностики инсталляции.

Название препарата и дозы не включаются в обычные Telegram-уведомления; они доступны внутри авторизованного EpiApp.

## Архитектура

```text
                   Telegram bot семьи
                    /      |       \
             invite   reminders   Android code
                  \       |       /
                   EpiApp server
                 HTTPS reverse proxy
                   /            \
              Web/PWA       universal APK
                              WebView UI
                                  +
                           native Android alarms
```

Один APK может подключаться к разным self-hosted серверам. При pairing пользователь вводит HTTPS-origin своего сервера и шестизначный код из своего Telegram-бота.

## Быстрый старт: Docker

Нужны сервер, домен, Docker Compose, Telegram bot token и числовой Telegram ID администратора.

```bash
git clone https://github.com/ivzaislu/epiapp.git
cd epiapp
git checkout epiappapk
cp .env.example .env
nano .env
```

Заполните минимум:

```dotenv
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ADMIN_ID=123456789
APP_DOMAIN=epiapp.example.com
APP_BASE_URL=https://epiapp.example.com
```

Затем:

```bash
docker compose up -d --build
```

Caddy публикует 80/443 и автоматически обслуживает HTTPS; Node `3000` остаётся только внутри Docker network.

Проверка:

```bash
curl https://epiapp.example.com/healthz
npm run doctor
```

Ожидаемый healthcheck:

```json
{"ok":true}
```

Полная инструкция: [docs/INSTALL.md](docs/INSTALL.md).

## Первый вход

После запуска напишите своему Telegram-боту:

```text
/start
```

Аккаунт из `TELEGRAM_ADMIN_ID` получает роль `admin`. Затем через кнопки бота можно пригласить ребёнка/второго родителя.

Для Android нажмите:

```text
📲 Подключить Android
```

Бот пришлёт адрес именно вашего сервера и одноразовый код. Универсальный APK не содержит заранее заданного `epiapp.duckdns.org` или другого семейного домена.

## Документация

- [docs/INSTALL.md](docs/INSTALL.md) — установка с нуля;
- [docs/DOCKER.md](docs/DOCKER.md) — Docker Compose + Caddy;
- [docs/SYSTEMD.md](docs/SYSTEMD.md) — Node.js + systemd;
- [docs/TELEGRAM.md](docs/TELEGRAM.md) — бот, admin и приглашения;
- [docs/ANDROID.md](docs/ANDROID.md) — универсальный APK и alarms;
- [docs/HTTPS.md](docs/HTTPS.md) — DNS, firewall и TLS;
- [docs/BACKUP.md](docs/BACKUP.md) — backup/restore;
- [docs/UPDATE.md](docs/UPDATE.md) — обновление;
- [docs/MIGRATION.md](docs/MIGRATION.md) — перенос сервера;
- [docs/SECURITY.md](docs/SECURITY.md) — модель безопасности;
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — диагностика;
- [docs/RELEASE.md](docs/RELEASE.md) — стабильная подпись Android release APK.

## Ручная установка

Для Linux с systemd и Node.js 18.19+:

```bash
sudo ./install.sh
sudo nano /etc/epiapp/epiapp.env
sudo systemctl restart epiapp
```

Node по умолчанию слушает `127.0.0.1:3000`; публикуйте его только через HTTPS reverse proxy. См. [docs/SYSTEMD.md](docs/SYSTEMD.md).

## Разработка и проверки

```bash
npm test
npm run check
bash -n install.sh
npm run doctor:offline
```

Android debug build:

```bash
gradle --no-daemon :androidApp:assembleDebug
```

CI ветки `epiappapk` проверяет Node 18.19.1, 20, 22 и реальную Android debug APK сборку.

## Данные

Один экземпляр использует один JSON store. По умолчанию:

```text
systemd: /var/lib/epiapp/epiapp.json
Docker:  /data/epiapp.json inside epiapp-data volume
```

Регулярные backup обязательны для production self-host.
