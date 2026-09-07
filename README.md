# EpiApp v1.1

Семейное приложение для отметки двух ежедневных приёмов лекарства ребёнком и уведомления родителей в Telegram.

Приложение **не назначает дозировку, не меняет схему лечения и не подсказывает, что делать при пропущенной дозе**. Оно только фиксирует нажатие пользователя.

## Что есть в v1.1

- детский экран с двумя крупными кнопками: утро / вечер;
- защита от повторной отметки одного приёма в тот же календарный день;
- история последних отметок;
- Telegram Mini App авторизация вместо общего публичного доступа;
- bootstrap-администратор из `TELEGRAM_ADMIN_ID`;
- одноразовые 24-часовые приглашения ролей `child` и `parent` через Telegram-бота;
- роли: ребёнок отмечает приём, родитель/админ видит статус и меняет расписание;
- мгновенный отзыв доступа через бота;
- Telegram-уведомления администратору и всем приглашённым родителям;
- серверная проверка подписанного Telegram `initData`;
- подписанная `HttpOnly; Secure; SameSite=Strict` cookie-сессия;
- Node.js слушает только `127.0.0.1:3000`, наружу приложение публикуется через Nginx;
- PWA service worker не кэширует авторизованные HTML/API;
- локальное JSON-хранилище с атомарной записью;
- unit/integration-тесты критической логики и ролей.

## Модель доступа

Единственный первоначальный пользователь задаётся на сервере:

```dotenv
TELEGRAM_ADMIN_ID=123456789
```

Этот Telegram ID всегда имеет роль `admin`. Остальные пользователи появляются только после принятия одноразового приглашения.

Роли:

| Роль | Возможности |
| --- | --- |
| `child` | смотреть статус и отмечать утро/вечер |
| `parent` | смотреть статус, менять имя/расписание/часовой пояс, получать уведомления |
| `admin` | всё родительское + создавать приглашения и отзывать доступ |

Прямое открытие `https://epiapp.duckdns.org` не даёт доступ к данным: приватные API требуют валидную серверную Telegram-сессию. HTML-оболочка может загрузиться, но без подтверждённого Telegram-аккаунта данные и действия недоступны.

`PARENT_PIN` из ранних установок v1 больше не используется. Если он остался в старом `/etc/epiapp/epiapp.env`, его можно удалить позднее.

## Telegram-бот: подключение семьи

Бот использует тот же `TELEGRAM_BOT_TOKEN`, что и уведомления. Сервер получает команды через Bot API `getUpdates`, поэтому для этого же бота не должен одновременно работать другой long-polling consumer или webhook.

Администратор пишет боту:

```text
/start
```

Доступные admin-команды:

```text
/invite_child
/invite_parent
/users
/revoke TELEGRAM_ID
/help
```

### Приглашение ребёнка

Администратор отправляет:

```text
/invite_child
```

Бот возвращает одноразовую ссылку вида:

```text
https://t.me/YourBot?start=invite_...
```

Администратор пересылает ссылку ребёнку. Ребёнок открывает её своим Telegram-аккаунтом, бот закрепляет за этим Telegram ID роль `child` и показывает кнопку **«Открыть EpiApp»**.

### Приглашение второго родителя

Аналогично:

```text
/invite_parent
```

После принятия приглашения аккаунт получает роль `parent` и автоматически становится получателем уведомлений.

Telegram-бот не может первым начать личный чат с произвольным пользователем, поэтому первоначальную invite-ссылку администратор пересылает сам. После `/start` бот уже может отправлять сообщения этому пользователю.

### Отзыв доступа

Посмотреть пользователей:

```text
/users
```

Отозвать доступ:

```text
/revoke 123456789
```

Отзыв применяется сразу: старая cookie пользователя больше не помогает, потому что роль при каждом приватном API-запросе сверяется с серверным списком доступа.

Администратора из `TELEGRAM_ADMIN_ID` удалить через бота нельзя.

## Telegram Mini App безопасность

Браузер передаёт серверу только `Telegram.WebApp.initData`. Сервер проверяет HMAC-подпись по алгоритму Telegram Bot API и `auth_date`; `initDataUnsafe` не используется как источник доверия.

После проверки сервер выдаёт подписанную cookie-сессию:

```text
HttpOnly; Secure; SameSite=Strict
```

Сессия содержит только Telegram ID и срок действия; роль не доверяется cookie и каждый раз берётся из серверного access-list.

## Переменные окружения

Файл production-конфигурации:

```text
/etc/epiapp/epiapp.env
```

Основные переменные:

| Переменная | Обязательна | Назначение |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | да | bot token от `@BotFather`, используется для auth и уведомлений |
| `TELEGRAM_ADMIN_ID` | да | числовой Telegram ID bootstrap-администратора |
| `APP_BASE_URL` | нет | публичный HTTPS URL, по умолчанию `https://epiapp.duckdns.org` |
| `HOST` | нет | bind Node.js, по умолчанию `127.0.0.1` |
| `PORT` | нет | внутренний порт, по умолчанию `3000` |
| `DATA_FILE` | нет | JSON-хранилище, installer использует `/var/lib/epiapp/epiapp.json` |

Пример находится в `.env.example`.

### Миграция существующего сервера v1/v1.1

Installer сохраняет существующий `/etc/epiapp/epiapp.env`, поэтому после обновления добавьте свой Telegram ID вручную:

```bash
sudo nano /etc/epiapp/epiapp.env
```

Минимально должны быть:

```dotenv
TELEGRAM_BOT_TOKEN=ВАШ_СУЩЕСТВУЮЩИЙ_ТОКЕН
TELEGRAM_ADMIN_ID=ВАШ_ЧИСЛОВОЙ_TELEGRAM_ID
APP_BASE_URL=https://epiapp.duckdns.org
HOST=127.0.0.1
PORT=3000
DATA_FILE=/var/lib/epiapp/epiapp.json
```

Не публикуйте bot token и не коммитьте production ENV в Git.

## Установка / обновление

Нужен systemd и Node.js 18.19+.

```bash
git checkout v-1.1
git pull origin v-1.1
sudo ./install.sh
```

Installer:

- создаёт пользователя `epiapp`;
- копирует приложение в `/opt/epiapp`;
- хранит данные в `/var/lib/epiapp`;
- сохраняет существующий `/etc/epiapp/epiapp.env`;
- обновляет systemd unit;
- **перезапускает** `epiapp.service`, чтобы новый код действительно загрузился;
- проверяет локальный `/healthz`.

Проверки:

```bash
sudo systemctl status epiapp
sudo journalctl -u epiapp -f
curl http://127.0.0.1:3000/healthz
```

Ожидается:

```json
{"ok":true}
```

После настройки Telegram в журнале должна появиться строка вида:

```text
EpiApp Telegram bot: @YourBot
```

## Публикация через DuckDNS + Nginx + HTTPS

Проверенная схема:

```text
Internet
  -> epiapp.duckdns.org :80/:443
  -> Nginx
  -> 127.0.0.1:3000
  -> EpiApp
```

Node.js по умолчанию bind-ится только к `127.0.0.1`, поэтому порт `3000` не должен быть публичным.

### Nginx

Пример конфигурации: `deploy/nginx/epiapp.conf.example`.

```bash
sudo cp deploy/nginx/epiapp.conf.example /etc/nginx/sites-available/epiapp
sudo ln -sf /etc/nginx/sites-available/epiapp /etc/nginx/sites-enabled/epiapp
sudo nginx -t
sudo systemctl reload nginx
```

Проверка proxy:

```bash
curl -H 'Host: epiapp.duckdns.org' http://127.0.0.1/healthz
```

### Firewall

Публично нужны только TCP 80 и 443. Если в `iptables INPUT` есть общий `REJECT`/`DROP`, разрешающие правила должны стоять до него.

```bash
sudo iptables -L INPUT -n -v --line-numbers
```

Не используйте `iptables -F` на удалённом сервере.

### HTTPS

Пример с Certbot:

```bash
sudo certbot --nginx -d epiapp.duckdns.org
sudo nginx -t
sudo systemctl reload nginx
curl https://epiapp.duckdns.org/healthz
curl -I https://epiapp.duckdns.org/
sudo certbot renew --dry-run
```

Telegram Mini App должен открываться по HTTPS.

## Ubuntu 18.04 / Node.js

Для ветки `v-1.1` минимальная проверяемая версия — Node.js **18.19.0**. CI прогоняет Node.js 18.19.1, 20 и 22.

Ubuntu 18.04 использует старую glibc; современные официальные Node.js binaries могут требовать более новую libc. Не обновляйте системную glibc вручную ради EpiApp. На legacy-сервере допустима совместимая community-сборка Node.js Unofficial Builds `linux-x64-glibc-217` с проверкой SHA256. При возможности предпочтительнее обновить ОС.

## Уведомления

После отметки ребёнком Telegram получает администратор и все пользователи роли `parent`:

```text
✅ Аня: утренний приём отмечен в 08:04.
```

Название лекарства, дозировка и диагноз в Telegram не отправляются.

## Проверки разработки

```bash
npm test
npm run check
bash -n install.sh
```

CI выполняет их на Node.js 18.19.1, 20 и 22.

## Ограничения

Версия рассчитана на один семейный серверный экземпляр. Access-list, приглашения и отметки хранятся в одном JSON-файле; для этого MVP это намеренно простая архитектура. Нужны регулярные резервные копии `/var/lib/epiapp/epiapp.json` и защита SSH/server credentials.

WhatsApp пока не включён: сначала стабилизируем Telegram-auth flow, затем официальный WhatsApp Business/Cloud API можно добавить как второй канал уведомлений.
