# Перенос EpiApp на другой сервер

Перед переносом сделайте backup по [BACKUP.md](BACKUP.md).

## Вариант A: новый VPS, тот же домен

Это самый простой перенос.

1. Сохраните production ENV и `epiapp.json`.
2. Поднимите EpiApp на новом сервере.
3. Восстановите JSON.
4. Используйте тот же `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_ID` и `APP_BASE_URL`.
5. Переключите DNS на новый IP.
6. Проверьте HTTPS и `/healthz`.

Если домен остаётся тем же и перенесён JSON с device hashes, ранее подключённые Android APK обычно продолжают работать: raw device-token остаётся на телефоне.

## Вариант B: меняется домен

1. Поднимите сервер на новом HTTPS-домене.
2. Установите новый `APP_BASE_URL`.
3. Перезапустите EpiApp, чтобы Telegram bot menu использовал новый адрес.
4. Переподключите Android APK через `Сменить сервер / переподключить` и новый pairing code.

Старая WebView cookie привязана к старому origin и не переносится на новый домен.

## Docker -> Docker

Backup JSON со старого сервера:

```bash
docker compose exec -T epiapp cat /data/epiapp.json > epiapp.json
```

На новом сервере после создания stack:

```bash
docker compose stop epiapp
docker compose run --rm --no-deps -T epiapp sh -c 'cat > /data/epiapp.json' < epiapp.json
docker compose up -d
```

## systemd -> systemd

Перенесите:

```text
/etc/epiapp/epiapp.env
/var/lib/epiapp/epiapp.json
```

На новом сервере восстановите владельца:

```bash
sudo chown epiapp:epiapp /var/lib/epiapp/epiapp.json
sudo chmod 640 /var/lib/epiapp/epiapp.json
```

## systemd <-> Docker

Формат `epiapp.json` одинаковый. Меняется только путь:

```text
systemd: /var/lib/epiapp/epiapp.json
Docker:  /data/epiapp.json inside epiapp-data volume
```

Production ENV также использует те же ключи, но Docker дополнительно использует `APP_DOMAIN` для Caddy.

## После переноса

Проверьте:

```bash
curl https://YOUR_DOMAIN/healthz
```

и:

```bash
npm run doctor
```

Затем проверьте `/start` у бота, вход admin/parent/child и одно Android-устройство до выключения старого сервера окончательно.
