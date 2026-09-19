# Резервное копирование и восстановление

Критичные данные EpiApp разделены на две части:

1. семейные данные и device hashes в `epiapp.json`;
2. production ENV с Telegram bot token и bootstrap admin ID.

ENV содержит секреты и должен храниться отдельно от обычного backup JSON.

## Docker Compose: backup данных

Создайте каталог с ограниченными правами:

```bash
mkdir -p backups
chmod 700 backups
```

Скопируйте JSON через работающий контейнер:

```bash
docker compose exec -T epiapp cat /data/epiapp.json > "backups/epiapp-$(date +%F-%H%M%S).json"
chmod 600 backups/epiapp-*.json
```

Проверьте JSON:

```bash
python3 -m json.tool backups/epiapp-YYYY-MM-DD-HHMMSS.json >/dev/null
```

Если Python отсутствует:

```bash
node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" backups/epiapp-YYYY-MM-DD-HHMMSS.json
```

## Docker Compose: restore

Сначала остановите приложение, чтобы оно не перезаписало файл во время восстановления:

```bash
docker compose stop epiapp
```

Затем:

```bash
docker compose run --rm --no-deps -T epiapp sh -c 'cat > /data/epiapp.json' < backups/epiapp-BACKUP.json
docker compose up -d epiapp
```

Проверьте:

```bash
docker compose logs --tail=50 epiapp
curl https://YOUR_DOMAIN/healthz
```

## systemd: backup

```bash
sudo systemctl stop epiapp
sudo cp /var/lib/epiapp/epiapp.json /root/epiapp-backup-$(date +%F-%H%M%S).json
sudo chmod 600 /root/epiapp-backup-*.json
sudo systemctl start epiapp
```

Для обычного backup можно копировать и без остановки, потому что Store пишет JSON атомарно через temp+rename. Для максимально предсказуемого restore сервис нужно остановить.

## systemd: restore

```bash
sudo systemctl stop epiapp
sudo cp /root/epiapp-backup-BACKUP.json /var/lib/epiapp/epiapp.json
sudo chown epiapp:epiapp /var/lib/epiapp/epiapp.json
sudo chmod 640 /var/lib/epiapp/epiapp.json
sudo systemctl start epiapp
```

## Backup ENV

Docker:

```bash
cp .env /SECURE/OFFSERVER/LOCATION/epiapp.env
chmod 600 /SECURE/OFFSERVER/LOCATION/epiapp.env
```

systemd:

```bash
sudo cp /etc/epiapp/epiapp.env /SECURE/OFFSERVER/LOCATION/epiapp.env
sudo chmod 600 /SECURE/OFFSERVER/LOCATION/epiapp.env
```

Не храните production ENV в публичном GitHub, обычной общей папке или незашифрованном публичном облаке.

## Что нужно для полного восстановления

Минимально:

- `epiapp.json`;
- production ENV;
- домен/DNS доступ.

Caddy certificates не обязательно переносить: при исправном DNS Caddy может получить сертификат заново.

Если переносится JSON и сохраняется тот же домен, существующие Android device-tokens продолжают работать: raw token остаётся на телефоне, а его hash находится в JSON.

## Рекомендация по расписанию

Для семейного экземпляра разумно делать автоматический ежедневный backup JSON и хранить несколько предыдущих копий. Периодически проверяйте, что backup реально парсится как JSON и может быть восстановлен на тестовом экземпляре.
