# Обновление EpiApp

Перед любым обновлением сделайте backup по [BACKUP.md](BACKUP.md).

## Docker Compose

Из checkout:

```bash
git status --short
git fetch origin
git checkout epiappapk
git pull --ff-only origin epiappapk
docker compose up -d --build
```

Проверка:

```bash
docker compose ps
docker compose logs --tail=100 epiapp
curl https://YOUR_DOMAIN/healthz
npm run doctor
```

`docker compose up -d --build` не удаляет named volumes. Не используйте `docker compose down -v` при обычном обновлении.

## systemd

```bash
cd ~/epiapp
git status --short
git fetch origin
git checkout epiappapk
git pull --ff-only origin epiappapk
sudo ./install.sh
```

Installer сохраняет существующий `/etc/epiapp/epiapp.env` и данные `/var/lib/epiapp`.

Проверка:

```bash
sudo systemctl status epiapp --no-pager
sudo journalctl -u epiapp -n 100 --no-pager
curl http://127.0.0.1:3000/healthz
curl https://YOUR_DOMAIN/healthz
```

## Android APK

Новая версия APK может устанавливаться поверх старой только если она подписана тем же signing key и имеет больший `versionCode`.

Debug APK из разных CI runner не следует считать стабильным каналом обновлений. Для постоянной установки используйте release APK, подписанный стабильным ключом; см. [RELEASE.md](RELEASE.md).

Обновление APK не должно требовать нового pairing, если Android application ID, signing identity, локальное хранилище и сервер остаются теми же.

## Изменение домена

Если меняется `APP_BASE_URL`/домен, Telegram-бот после restart будет открывать новый адрес, а Android APK нужно переподключить к новому origin через новый pairing code.

Если меняется только IP за тем же DNS-именем, переподключение не требуется.

## Откат

Если новая версия сломалась:

1. не удаляйте данные;
2. восстановите предыдущий Git commit/образ;
3. если формат данных оказался несовместимым — восстановите JSON backup;
4. проверьте `/healthz`, bot и роли.

Перед миграциями формата данных релиз должен явно документировать обратную совместимость/необходимость backup.
