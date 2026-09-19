# Troubleshooting

Начинайте с диагностики:

```bash
npm run doctor
```

Для systemd:

```bash
cd /opt/epiapp
sudo env EPIAPP_ENV_FILE=/etc/epiapp/epiapp.env node scripts/doctor.mjs
```

## `/healthz` не открывается публично

Сначала проверьте локальный сервис.

systemd:

```bash
curl http://127.0.0.1:3000/healthz
sudo systemctl status epiapp --no-pager
sudo journalctl -u epiapp -n 100 --no-pager
```

Docker:

```bash
docker compose ps
docker compose logs --tail=100 epiapp
docker compose logs --tail=100 caddy
```

Если локально работает, а снаружи нет — проверяйте DNS, firewall/security group и reverse proxy.

## Бот не запускается

Проверьте:

- `TELEGRAM_BOT_TOKEN`;
- `TELEGRAM_ADMIN_ID` — только цифры;
- `APP_BASE_URL` — публичный HTTPS origin;
- доступ сервера к `api.telegram.org`.

`npm run doctor` проверяет `getMe` без вывода токена.

## Прямой `/api/state` возвращает 401

Это нормальное поведение без авторизованной Telegram/Android session:

```text
HTTP 401 Unauthorized
```

Приватные API не должны быть доступны обычному `curl` без session.

## APK пишет, что адрес сервера некорректен

Поддерживается формат:

```text
https://epiapp.example.com
```

Не поддерживаются:

```text
http://epiapp.example.com
https://epiapp.example.com/some/path
```

Если используется нестандартный HTTPS port, укажите его в origin.

## Pairing code не принимается

Проверьте:

1. пользователь уже принял Telegram invite/является admin;
2. код получен именно у бота этого сервера;
3. прошло меньше 5 минут;
4. код ещё не использовался;
5. APK введён правильный `APP_BASE_URL`;
6. `/healthz` этого адреса отвечает `{"ok":true}`.

После слишком большого числа неверных попыток endpoint временно отвечает `429`.

## Android не показывает полноэкранный alarm

Проверьте на детском телефоне:

- разрешены Notifications;
- разрешены exact alarms / Alarms & reminders;
- разрешён full-screen alarm access, если Android имеет отдельный переключатель;
- канал EpiApp Alarm не переведён пользователем в silent;
- производитель телефона не запретил background activity/battery usage.

Даже при запрете full-screen EpiApp старается оставить high-priority уведомление.

## Alarm сработал после того, как приём уже отмечен

Откройте EpiApp на детском телефоне при наличии сети. После успешной серверной отметки native bridge отменяет оставшиеся alarms текущего слота. Фоновая синхронизация также сверяет сервер примерно каждые 30 минут.

Если отметка была сделана с другого устройства/интерфейса, локальный телефон узнает о ней при следующей синхронизации.

## Изменили время, а телефон ребёнка ещё использует старое

APK синхронизирует расписание при запуске/возврате в приложение и примерно раз в 30 минут в фоне. Android может задерживать inexact background sync из-за энергосбережения; откройте приложение вручную для немедленной синхронизации.

## После обновления APK Android не устанавливает файл поверх старого

Обычно причина — APK подписаны разными ключами. Debug builds разных сред не являются стабильным каналом обновлений. Используйте один release signing key. См. [RELEASE.md](RELEASE.md).

## Docker: Caddy не получает сертификат

Проверьте:

```bash
docker compose logs caddy
```

Типовые причины:

- DNS ещё указывает не на этот сервер;
- TCP 80/443 закрыты;
- другой процесс уже слушает 80/443;
- `APP_DOMAIN` не совпадает с DNS-именем.

## Полезная информация при issue

Можно приложить:

- версию/commit EpiApp;
- Android version/model;
- вывод `npm run doctor`, предварительно проверив, что там нет ваших приватных данных;
- обезличенные строки логов.

Никогда не прикладывайте `.env`, bot token, SSH keys или release keystore.
