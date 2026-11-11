# EpiApp

EpiApp — приложение для одной семьи. Ребёнок подтверждает приём, родитель видит отметки и управляет схемой. Ветка `web-next` содержит сервер, веб-кабинет и Android-модуль с WebView и локальными будильниками.

> EpiApp не назначает дозировку, не меняет лечение и не подсказывает, что делать при пропущенной дозе. Он хранит схему, которую внесли родители, и фиксирует пользовательские отметки.

## Что входит

- роли `admin`, `parent`, `child`;
- Telegram-auth и одноразовые семейные приглашения;
- настраиваемая схема до шести препаратов, от одного до трёх приёмов для каждого;
- компактный список препаратов с отдельным экраном редактирования и выбором часового пояса из поддерживаемой сервером базы;
- статистика и график для родителей;
- Telegram-уведомления и эскалация при отсутствии отметки;
- раздел «Оповещения» в родительском кабинете и Android-оповещения о подтверждениях и отсутствии отметки;
- веб-кабинет с сегодняшними отметками, статистикой и импортом истории для администратора;
- подключение Android через Telegram и одноразовую ссылку;
- Northflank с постоянным хранилищем PostgreSQL;
- Docker Compose + Caddy для простого self-host с automatic HTTPS;
- systemd/Nginx вариант для ручной установки;
- JSON storage с атомарной записью;
- backup/update/migration/security документация;
- `npm run doctor` для диагностики инсталляции.

Название препарата и дозы не включаются в обычные Telegram-уведомления; они доступны внутри авторизованного EpiApp.

## Архитектура

```text
              Telegram bot семьи
               /              \
          invite            reminders
               \              /
                EpiApp server
              HTTPS reverse proxy
                      |
                  веб-кабинет
```

Кабинет открывается кнопкой бота «Открыть EpiApp». Ребёнок попадает на сегодняшние отметки, родитель видит схему и статистику. Android-модуль описан в [docs/ANDROID.md](docs/ANDROID.md).

## Northflank

Используйте Combined Service из ветки `web-next`, Dockerfile в корне и приватный PostgreSQL addon. См. инструкции по [развёртыванию на Northflank](docs/NORTHFLANK.md) и [переносу с VPS](docs/MIGRATION.md).

## Быстрый старт: Docker

Нужны сервер, домен, Docker Compose, Telegram bot token и числовой Telegram ID администратора.

```bash
git clone --branch web-next https://github.com/ivzaislu/epiapp.git
cd epiapp
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

Аккаунт из `TELEGRAM_ADMIN_ID` получает роль `admin`. Затем через кнопки бота можно пригласить ребёнка и второго родителя. Кнопка «Открыть EpiApp» открывает кабинет.

## Документация

- [docs/INSTALL.md](docs/INSTALL.md) — установка с нуля;
- [docs/DOCKER.md](docs/DOCKER.md) — Docker Compose + Caddy;
- [docs/SYSTEMD.md](docs/SYSTEMD.md) — Node.js + systemd;
- [docs/TELEGRAM.md](docs/TELEGRAM.md) — бот, admin и приглашения;
- [docs/ANDROID.md](docs/ANDROID.md) — подключение и сборка Android-модуля;
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

CI проверяет Node, PostgreSQL и Docker-образ. Workflow `Android debug prerelease` публикует тестовый APK при повышении версии на `web-next`. Подписанная release-сборка описана в [docs/RELEASE.md](docs/RELEASE.md).

## Данные

На Northflank состояние хранится в PostgreSQL. При локальном развёртывании без URI PostgreSQL приложение использует JSON:

```text
systemd: /var/lib/epiapp/epiapp.json
Docker:  /data/epiapp.json inside epiapp-data volume
```

Для обоих вариантов см. [резервное копирование](docs/BACKUP.md).
