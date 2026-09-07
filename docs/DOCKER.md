# Docker Compose + Caddy

Это рекомендуемый способ self-host EpiApp.

Схема:

```text
Internet :80/:443
       -> Caddy (automatic HTTPS)
       -> private Docker network
       -> EpiApp :3000
```

Порт `3000` на хост не публикуется.

## Требования

Установите Docker Engine и Docker Compose plugin согласно документации вашего дистрибутива. Проверьте:

```bash
docker --version
docker compose version
```

DNS вашего домена уже должен указывать на сервер, а firewall/cloud firewall должен пропускать TCP 80 и 443.

## Настройка

```bash
git clone https://github.com/ivzaislu/epiapp.git
cd epiapp
git checkout epiappapk
cp .env.example .env
nano .env
```

Минимальный пример:

```dotenv
TELEGRAM_BOT_TOKEN=123456789:REPLACE_ME
TELEGRAM_ADMIN_ID=123456789
APP_DOMAIN=epiapp.example.com
APP_BASE_URL=https://epiapp.example.com
```

Для Docker значения `HOST`, `PORT` и `DATA_FILE` из `.env` не используются как внешний bind: Compose принудительно задаёт приложению `HOST=0.0.0.0`, `PORT=3000`, `DATA_FILE=/data/epiapp.json` внутри закрытой Docker-сети.

`.env` содержит секреты и уже исключён из Git.

## Запуск

```bash
docker compose up -d --build
```

Проверка:

```bash
docker compose ps
docker compose logs --tail=100 epiapp
docker compose logs --tail=100 caddy
curl https://epiapp.example.com/healthz
```

Ожидается:

```json
{"ok":true}
```

Caddy сам запросит сертификат для `APP_DOMAIN`. Если сертификат не выдаётся, сначала проверьте DNS и доступность портов 80/443 из интернета.

## Диагностика

Так как `.env` лежит в корне checkout:

```bash
npm run doctor
```

Или без локального Node.js:

```bash
docker compose run --rm --no-deps epiapp node scripts/doctor.mjs --env /dev/null
```

Второй вариант использует environment контейнера; сетевой public healthcheck должен уже работать.

## Данные

Основные данные хранятся в Docker volume `epiapp-data` как `/data/epiapp.json`. Caddy хранит свои сертификаты в отдельных volumes `caddy-data` и `caddy-config`.

Не удаляйте volumes командой `docker compose down -v`, если не хотите удалить данные EpiApp.

Обычная остановка безопасна:

```bash
docker compose down
```

Повторный запуск:

```bash
docker compose up -d
```

## Логи

```bash
docker compose logs -f epiapp
docker compose logs -f caddy
```

В production не публикуйте содержимое `.env` и не вставляйте Telegram bot token в логи/issue.

## Обновление и backup

Перед обновлением сделайте backup по [BACKUP.md](BACKUP.md), затем следуйте [UPDATE.md](UPDATE.md).
