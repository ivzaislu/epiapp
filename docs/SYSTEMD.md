# Ручная установка: Node.js + systemd

Этот способ подходит, если Docker использовать не хочется. Рекомендуется современный поддерживаемый Linux и Node.js 20/22. Минимально тестируется Node.js 18.19.1.

## Установка приложения

```bash
git clone https://github.com/ivzaislu/epiapp.git
cd epiapp
git checkout epiappapk
sudo ./install.sh
```

Installer создаёт:

```text
/opt/epiapp                  код приложения
/etc/epiapp/epiapp.env       production ENV
/var/lib/epiapp/epiapp.json  данные
/etc/systemd/system/epiapp.service
```

Сервис работает отдельным системным пользователем `epiapp` и по умолчанию слушает только `127.0.0.1:3000`.

## Настройка ENV

```bash
sudo nano /etc/epiapp/epiapp.env
```

Минимум:

```dotenv
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ADMIN_ID=123456789
APP_BASE_URL=https://epiapp.example.com
HOST=127.0.0.1
PORT=3000
DATA_FILE=/var/lib/epiapp/epiapp.json
```

`APP_DOMAIN` нужен только bundled Docker/Caddy stack и для systemd может оставаться примером/пустым.

После изменения:

```bash
sudo systemctl restart epiapp
sudo systemctl status epiapp --no-pager
curl http://127.0.0.1:3000/healthz
```

## HTTPS

Node.js не нужно выставлять напрямую в интернет. Настройте Nginx/Caddy перед ним. Пример Nginx находится в:

```text
deploy/nginx/epiapp.conf.example
```

Публично открывайте 80/443, а `3000` оставляйте закрытым. Подробности: [HTTPS.md](HTTPS.md).

## Диагностика

```bash
cd /opt/epiapp
sudo env EPIAPP_ENV_FILE=/etc/epiapp/epiapp.env node scripts/doctor.mjs
```

Логи:

```bash
sudo journalctl -u epiapp -n 100 --no-pager
sudo journalctl -u epiapp -f
```

## Ubuntu 18.04

Ubuntu 18.04 использует старую glibc. Современные официальные Node.js binaries могут не запускаться. Не заменяйте системную glibc вручную ради EpiApp. Для legacy-сервера возможна совместимая community-сборка Node.js, но предпочтительнее миграция на поддерживаемую ОС.

## Обновление

Installer сохраняет существующий `/etc/epiapp/epiapp.env` и `/var/lib/epiapp`. Перед обновлением всё равно делайте backup. См. [UPDATE.md](UPDATE.md).
