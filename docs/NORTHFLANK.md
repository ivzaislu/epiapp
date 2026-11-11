# Развёртывание EpiApp на Northflank

Разворачивайте ветку `web-next`. Один сервис запускает Node.js API, веб-кабинет, Telegram-бота и планировщик напоминаний. Постоянное состояние семьи хранится в отдельном PostgreSQL addon. Для переноса с VPS см. [MIGRATION.md](MIGRATION.md).

## Подготовка сервиса

1. Создайте проект Northflank и приватный PostgreSQL addon в этом же проекте. Привяжите URI подключения из addon через secret group с именем переменной `DATABASE_URL` или `POSTGRES_URI`. Подключите secret group к сервису как runtime environment.
2. Создайте Combined Service из `ivzaislu/epiapp`, выберите `web-next` и `Dockerfile` в корне репозитория. Приложение запускается из этого образа, без Compose и Caddy.
3. В **Networking** добавьте публичный порт `3000` с протоколом HTTP. Northflank предоставит публичный HTTPS-адрес для этого порта.
4. В **Health checks** добавьте HTTP readiness probe на порт `3000`, путь `/healthz`. Эндпоинт проверяет чтение PostgreSQL и возвращает `503`, если хранилище недоступно.
5. Используйте одну реплику без автомасштабирования. Чтобы при обновлении два процесса не опрашивали одного Telegram-бота одновременно, используйте стратегию `recreate`, если она доступна в настройках сервиса. Иначе остановите старую реплику перед запуском новой.

| Переменная | Значение |
| --- | --- |
| `DATABASE_URL` | Внутренний PostgreSQL URI из addon. Можно использовать `POSTGRES_URI` вместо него. |
| `EPIAPP_REQUIRE_POSTGRES` | `1`. При отсутствии URI сервер завершит запуск и не создаст временное JSON-хранилище. |
| `TELEGRAM_BOT_TOKEN` | Токен бота в runtime secrets. При переносе старого бота добавьте токен после остановки его процесса на VPS. |
| `TELEGRAM_ADMIN_ID` | Числовой Telegram ID администратора. |
| `HOST`, `PORT` | `0.0.0.0`, `3000`. Эти значения уже заданы в Dockerfile. |
| `ANDROID_APK_URL` | Необязательно: HTTPS-ссылка на конкретный APK для кнопки скачивания в боте. По умолчанию `v0.7.4-debug` из GitHub Releases. |
| `APP_BASE_URL` | Публичный HTTPS-origin без пути, например `https://epiapp.example.com`. Для автоматически выданного домена можно оставить пустым. EpiApp возьмёт первый адрес из `NF_HOSTS`. |

`APP_DOMAIN` относится к Compose/Caddy. PostgreSQL URI, токен бота и резервные копии не добавляйте в Git.

См. официальные инструкции Northflank по [сборке и сервису](https://northflank.com/docs/v1/application/getting-started/build-and-deploy-your-code), [PostgreSQL](https://northflank.com/docs/v1/application/databases-and-persistence/deploy-databases-on-northflank/deploy-postgresql-on-northflank), [переменным окружения](https://northflank.com/docs/v1/application/secure/inject-secrets) и [health checks](https://northflank.com/docs/v1/application/observe/configure-health-checks).

## Проверка запуска

1. Проверьте в логах строку `EpiApp storage: PostgreSQL`. В терминале контейнера выполните `npm run doctor:offline`. Он проверяет наличие конфигурации, а подключение к PostgreSQL проверяет `/healthz`.
2. Откройте `https://<домен>/healthz` и убедитесь, что ответ — `{"ok":true}`.
3. Отправьте боту `/start`, откройте кабинет и проверьте адрес, роли и статистику. Убедитесь, что после перезапуска приложения данные сохраняются.
4. На отдельной тестовой семье проверьте отметку от детского профиля, обновление статистики у родителя, доставку Telegram-уведомления и поведение будильника на Android.

## Резервные копии

Включите расписание резервных копий для PostgreSQL addon. Перед обновлением или полным переносом сделайте ручную копию. Храните токен бота и настройки среды отдельно от данных. См. [резервное копирование и восстановление Northflank](https://northflank.com/docs/v1/application/databases-and-persistence/backup-restore-and-import-data).
