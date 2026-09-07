# EpiApp v1.1

Минимальная версия приложения для отметки двух ежедневных приёмов лекарства ребёнком и уведомления родителей в Telegram.

## Что уже есть

- детский мобильный экран с двумя крупными кнопками: утро / вечер;
- подтверждение перед сохранением отметки;
- защита от повторной отметки одного и того же приёма в тот же календарный день;
- история последних отметок;
- родительский экран, защищённый серверным PIN;
- настройка имени, времени утреннего/вечернего приёма и часового пояса;
- несколько Telegram-чатов родителей;
- поиск недавних чатов через Telegram Bot API и тестовое сообщение;
- PWA manifest + service worker для установки на домашний экран;
- локальное JSON-хранилище с атомарной записью;
- unit/integration-тесты на критическую логику;
- корректный `HEAD /` для health/proxy-проверок статического UI.

Приложение **не назначает дозировку, не меняет схему лечения и не подсказывает, что делать при пропущенной дозе**. Оно только фиксирует нажатие пользователя.

## Совместимость

Для ветки `v-1.1` минимальная проверяемая версия — **Node.js 18.19.0**. CI отдельно прогоняет приложение на Node.js 18.19.1, 20 и 22.

### Ubuntu 18.04

На Ubuntu 18.04 системная `glibc` обычно имеет версию 2.27. Современные пакеты/официальные Linux-сборки Node.js могут требовать более новую `glibc`, поэтому `apt install nodejs` из подключённого стороннего репозитория может завершаться ошибкой вида `Depends: libc6 (>= 2.28)`.

Не рекомендуется вручную обновлять системную `libc6/glibc` ради EpiApp: это может повредить всю ОС. Для ограниченного legacy-сервера можно использовать совместимую сборку Node из проекта Node.js Unofficial Builds (`linux-x64-glibc-217`) с обязательной проверкой SHA256. Это community-maintained вариант, а не официально поддерживаемая платформа Node.js. При возможности предпочтительнее более новая ОС и официально поддерживаемый Node.js.

Сам `install.sh` Node.js не устанавливает: он только проверяет наличие версии 18.19+.

## Запуск локально

Нужен Node.js 18.19+; внешние npm-пакеты не требуются.

```bash
PARENT_PIN=4826 npm start
```

После запуска:

- экран ребёнка: http://localhost:3000/
- экран родителей: http://localhost:3000/parent
- healthcheck: http://localhost:3000/healthz

Данные сохраняются в `data/epiapp.json`. Путь можно переопределить через `DATA_FILE`.

## Установка приложения на Linux-сервер

Installer рассчитан на сервер с **systemd** и уже установленным **Node.js 18.19+**.

Из клона ветки `v-1.1`:

```bash
sudo ./install.sh
```

Installer:

- создаёт системного пользователя и группу `epiapp`;
- копирует код в `/opt/epiapp`;
- создаёт постоянное хранилище `/var/lib/epiapp`;
- создаёт `/etc/epiapp/epiapp.env`, не перезаписывая его при повторной установке;
- при первой установке генерирует случайный 6-значный `PARENT_PIN` и выводит его в консоль;
- создаёт и включает `epiapp.service`;
- запускает сервис и проверяет `/healthz` локально.

После установки:

```bash
sudo systemctl status epiapp
sudo journalctl -u epiapp -f
sudo nano /etc/epiapp/epiapp.env
sudo systemctl restart epiapp
curl http://127.0.0.1:3000/healthz
```

Ожидаемый healthcheck:

```json
{"ok":true}
```

## Публикация через DuckDNS + Nginx + HTTPS

Проверенная схема развёртывания:

```text
Internet
  -> epiapp.duckdns.org :80/:443
  -> Nginx
  -> 127.0.0.1:3000
  -> EpiApp
```

Порт `3000` не требуется открывать в интернет.

### 1. DuckDNS

В DuckDNS домен привязывается только к публичному IP, **без порта**. Например:

```text
epiapp.duckdns.org -> 144.24.185.140
```

Проверка DNS:

```bash
getent hosts epiapp.duckdns.org
```

### 2. Nginx reverse proxy

Пример конфигурации находится в `deploy/nginx/epiapp.conf.example`. Если используется другое имя хоста, замените `server_name`.

```bash
sudo cp deploy/nginx/epiapp.conf.example /etc/nginx/sites-available/epiapp
sudo ln -sf /etc/nginx/sites-available/epiapp /etc/nginx/sites-enabled/epiapp
sudo nginx -t
sudo systemctl reload nginx
```

Проверка цепочки Nginx -> EpiApp до включения TLS:

```bash
curl -H 'Host: epiapp.duckdns.org' http://127.0.0.1/healthz
```

### 3. Firewall / iptables

Если в `INPUT` есть общий `REJECT`/`DROP`, правила для 80 и 443 должны находиться **до него**.

Сначала посмотреть правила:

```bash
sudo iptables -L INPUT -n -v --line-numbers
```

Безопасный вариант добавить разрешения в начало цепочки:

```bash
sudo iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
```

Не используйте `iptables -F` на удалённом сервере: можно потерять SSH-доступ.

Для сохранения правил после перезагрузки на Debian/Ubuntu:

```bash
sudo apt install -y iptables-persistent
sudo netfilter-persistent save
```

Если VPS использует отдельный cloud firewall/security list/NSG, там тоже должны быть разрешены входящие TCP 80 и 443.

### 4. HTTPS через Certbot

На legacy Ubuntu 18.04 удобнее использовать актуальный Certbot через snap:

```bash
sudo apt update
sudo apt install -y snapd
sudo snap install core
sudo snap refresh core
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/local/bin/certbot
```

Получить и автоматически подключить сертификат к Nginx:

```bash
sudo certbot --nginx -d epiapp.duckdns.org
```

После установки:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl https://epiapp.duckdns.org/healthz
curl -I https://epiapp.duckdns.org/
```

Проверка автоматического продления:

```bash
sudo certbot renew --dry-run
```

Успешный `renew --dry-run` подтверждает, что механизм продления сертификата настроен.

## Telegram

Чтобы включить Telegram, добавьте токен в `/etc/epiapp/epiapp.env`:

```dotenv
TELEGRAM_BOT_TOKEN=123456:your-bot-token
```

Токен не храните в Git и не публикуйте. После изменения:

```bash
sudo systemctl restart epiapp
```

Дальше:

1. Создайте бота через официальный `@BotFather` и получите token.
2. Напишите созданному боту любое сообщение с аккаунта родителя.
3. Откройте `/parent`, введите PIN и нажмите **«Найти недавние чаты»**.
4. Выберите чат, сохраните настройки и нажмите **«Отправить тест»**.

При отметке ребёнком родитель получает сообщение вида:

```text
✅ Аня: утренний приём отмечен в 08:04.
```

Название лекарства, дозировка и диагноз в Telegram не отправляются.

## Проверки

```bash
npm test
npm run check
bash -n install.sh
```

CI ветки `v-1.1` выполняет эти проверки на Node.js 18.19.1, 20 и 22.

## Переменные окружения

| Переменная | Обязательна | Назначение |
| --- | --- | --- |
| `PARENT_PIN` | для родительских настроек | PIN, который проверяется только на сервере |
| `TELEGRAM_BOT_TOKEN` | для Telegram | токен бота; не передаётся в браузер |
| `PORT` | нет | порт, по умолчанию `3000` |
| `DATA_FILE` | нет | путь к JSON-хранилищу |

## Ограничения

Эта версия рассчитана на один серверный экземпляр и семейный MVP. JSON-хранилище и PIN без rate limiting не являются полной production-аутентификацией. Для постоянной эксплуатации важны резервное копирование, контроль доступа к серверу и дальнейшее усиление аутентификации родителей.

Node.js 18.19 поддерживается в `v-1.1` из-за ограничения legacy-сервера; при возможности перейти на более новую ОС следует использовать современную поддерживаемую версию Node.js.

WhatsApp пока не включён: сначала стабилизируем основной сценарий и Telegram, затем можно добавить официальный WhatsApp Business/Cloud API как второй канал уведомлений.
