# Перенос EpiApp на другой сервер

Перед переносом сделайте backup по [BACKUP.md](BACKUP.md).

## VPS с Docker → Northflank

Подготовьте новый сервис по [NORTHFLANK.md](NORTHFLANK.md). Пока старый бот работает, проверьте образ и подключение к PostgreSQL через `/healthz` без его токена на новом сервисе.

На старом VPS перейдите в каталог Compose. Проверьте имя сервиса через `docker compose ps` и наличие базы командой `docker compose exec -T epiapp test -s /data/epiapp.json`. Если конфигурация отличается, подставьте фактические имя сервиса и путь.

При переключении остановите старый экземпляр и снимите окончательную копию. Команда копирования читает файл из остановленного контейнера. Сохраните его в закрытом каталоге и скачайте на доверенный компьютер по SSH/SCP.

```bash
umask 077
mkdir -p backups
backup="backups/epiapp-vps-$(date +%Y%m%d-%H%M%S).json"
docker compose stop epiapp
container_id=$(docker compose ps --all --quiet epiapp)
docker cp "${container_id}:/data/epiapp.json" "$backup"
chmod 600 "$backup"
python3 -m json.tool "$backup" >/dev/null
```

### Только история приёмов

1. Добавьте токен бота в новый сервис, проверьте `/healthz` и выполните `/start` в Telegram.
2. Если PostgreSQL пустой, заново настройте схему и пригласите ребёнка и второго родителя. Для APK запросите новую ссылку подключения.
3. В кабинете администратора откройте **30 дней → Импорт истории** и выберите сохранённый JSON-файл. Если в текущей схеме несколько препаратов или число приёмов отличается от двух, укажите соответствия старых отметок. При наличии обоих типов отметок выберите два разных приёма.
4. Проверьте количество добавленных записей и откройте старый период по дате. Повторный импорт пропускает дубли. При совпадении дня и приёма приоритет у записи из нового экземпляра.

Импорт сохраняет календарную дату и время подтверждения. В PostgreSQL добавляются только отметки, а график рассчитывается по текущей схеме.

### Полный перенос в пустой PostgreSQL

Если нужны также прежняя схема, роли и данные сопряжения, используйте полную миграцию **вместо** загрузки через кабинет. Выполните команду из checkout `web-next` на доверенном узле, который имеет доступ к приватной базе Northflank и к копии. Передайте URI через защищённую переменную окружения. Подключите производственного бота после завершения импорта.

```bash
npm install --ignore-scripts
npm run import:postgres -- /path/to/epiapp-vps.json
```

Команда откажется заменять уже существующее состояние. После смены домена запросите новую ссылку подключения Android. Если понадобится откат, сначала остановите бота на Northflank и сохраните копию новой базы, затем запустите старый контейнер командой `docker compose start epiapp`. Отметки, внесённые после переключения, останутся в PostgreSQL.

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
4. Переподключите Android APK через новую ссылку **Подключить Android** в боте.

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

Затем проверьте `/start` у бота, вход с каждой семейной ролью и одно Android-устройство. Сохраните резервную копию старого сервера до завершения проверки.
