# Установка EpiApp с нуля

Эта инструкция предназначена для отдельного семейного self-hosted экземпляра EpiApp.

EpiApp не назначает лечение и не подсказывает, что делать при пропущенной дозе. Родители сами вносят назначенную схему; приложение хранит отметки и отправляет напоминания.

## Что понадобится

- Linux-сервер с публичным IPv4/IPv6;
- домен или динамический DNS, который указывает на сервер;
- открытые входящие TCP 80 и 443;
- Telegram-аккаунт администратора;
- Telegram-бот, созданный через `@BotFather`;
- для Android — устройство Android 8.0+.

Рекомендуемый вариант установки — Docker Compose + Caddy. Caddy автоматически получает и обновляет HTTPS-сертификат, а порт Node.js не публикуется наружу.

## 1. Подготовьте DNS

Создайте DNS-запись, например:

```text
epiapp.example.com -> PUBLIC_SERVER_IP
```

Проверьте, что имя уже разрешается в правильный IP. Для динамического адреса можно использовать DuckDNS или другой DDNS.

## 2. Создайте Telegram-бота

Откройте `@BotFather`, создайте нового бота и получите bot token. Токен является секретом: не публикуйте его, не отправляйте в issue и не коммитьте в Git.

Также нужен ваш числовой Telegram user ID. Он записывается в `TELEGRAM_ADMIN_ID` и становится bootstrap-администратором экземпляра.

Подробнее: [TELEGRAM.md](TELEGRAM.md).

## 3. Скачайте EpiApp

```bash
git clone https://github.com/ivzaislu/epiapp.git
cd epiapp
git checkout epiappapk
```

## 4. Выберите способ установки

### Рекомендуется: Docker Compose

Продолжайте по [DOCKER.md](DOCKER.md).

### Альтернатива: Node.js + systemd

Продолжайте по [SYSTEMD.md](SYSTEMD.md), затем настройте HTTPS по [HTTPS.md](HTTPS.md).

## 5. Обязательные параметры

Независимо от способа установки нужны:

```dotenv
TELEGRAM_BOT_TOKEN=ваш_bot_token
TELEGRAM_ADMIN_ID=ваш_числовой_telegram_id
APP_BASE_URL=https://epiapp.example.com
```

`APP_BASE_URL` должен быть публичным HTTPS-origin без дополнительного пути. Например, `https://epiapp.example.com` допустим, а `http://...` и `https://example.com/epiapp` не подходят.

## 6. Проверьте установку

После запуска:

```bash
curl https://epiapp.example.com/healthz
```

Ожидается:

```json
{"ok":true}
```

Затем запустите диагностику:

```bash
npm run doctor
```

Для systemd-установки:

```bash
cd /opt/epiapp
sudo env EPIAPP_ENV_FILE=/etc/epiapp/epiapp.env node scripts/doctor.mjs
```

## 7. Первый вход администратора

Напишите своему боту:

```text
/start
```

Бот должен показать роль администратора и меню EpiApp.

Через него создаются приглашения ребёнка/второго родителя и коды подключения Android.

## 8. Android

Универсальный APK не содержит адрес конкретного сервера. При первом запуске он просит:

1. HTTPS-адрес вашего EpiApp (`APP_BASE_URL`);
2. одноразовый шестизначный код из кнопки бота `📲 Подключить Android`.

Подробнее: [ANDROID.md](ANDROID.md).

## После установки

Обязательно прочитайте:

- [BACKUP.md](BACKUP.md) — резервные копии;
- [UPDATE.md](UPDATE.md) — безопасное обновление;
- [SECURITY.md](SECURITY.md) — firewall, секреты и устройства;
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — диагностика проблем.
